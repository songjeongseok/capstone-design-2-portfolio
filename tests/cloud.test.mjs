import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CloudStore} from '../collaboration/modules/cloud-store.mjs';
import {makeReview} from '../api/review.js';

const id='a645b60d-3c50-4486-bd78-b779d888a7ca';
function store(handler) {
  const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k),removeItem:k=>values.delete(k)};
  return new CloudStore({url:'https://demo.supabase.co',publicKey:'sb_publishable_test'},storage,handler);
}
test('email login sends no password; account creation and sign-in are distinct',async()=>{
  const calls=[],s=store(async(url,init)=>{calls.push([url,JSON.parse(init.body)]);return Response.json({});});
  await s.requestCode('class@example.invalid','교수',true);await s.requestCode('class@example.invalid',null,false);
  assert.deepEqual(calls.map(v=>v[1]),[{email:'class@example.invalid',create_user:true,data:{name:'교수'}},{email:'class@example.invalid',create_user:false}]);
});
test('invalid OTP never opens a session',async()=>{
  const s=store(async()=>Response.json({error_code:'otp_expired'},{status:403}));
  await assert.rejects(s.verifyCode('class@example.invalid','123456'),/인증번호/);assert.equal(await s.me(),null);
});
test('valid OTP uses user bearer for DB; parallel expiry refresh rotates token once',async()=>{
  let refresh=0;const s=store(async(url,init)=>{
    if (url.includes('/verify'))return Response.json({access_token:'a',refresh_token:'r',expires_in:1});
    if (url.includes('/token?')) {refresh++;return Response.json({access_token:'b',refresh_token:'rr',expires_in:3600});}
    assert.equal(init.headers.Authorization,'Bearer b');return Response.json({status:'pending'});
  });
  await s.verifyCode('s@example.invalid','123456');await Promise.all([s.me(),s.me()]);assert.equal(refresh,1);
});
test('cloud import sends only the signed-in student records and preserves history',async()=>{
  const calls=[];const s=store(async()=>{});s.me=async()=>({email:'s@example.invalid'});
  s.rpc=async(op,p)=>{calls.push(p);return {count:1};};
  const row={id:'old',studentId:'s1',week:15,title:'발표',description:'채광 계획',version:3,history:[{title:'수정 전'}]};
  await s.importBackup({kind:'capstone-workspace-backup',workspace:{schemaVersion:2,members:[{studentId:'s1',email:'s@example.invalid',passwordHash:'PRIVATE'}],records:[row,{...row,studentId:'s2',title:'OTHER'}]}});
  assert.equal(calls[0].records.length,1);assert.deepEqual(calls[0].records[0].history,row.history);assert.doesNotMatch(JSON.stringify(calls),/PRIVATE|OTHER/);
});
const env={AI_GATEWAY_API_KEY:'gateway-test',SUPABASE_URL:'https://demo.supabase.co',SUPABASE_PUBLISHABLE_KEY:'pub-test',SUPABASE_SECRET_KEY:'sb_secret_test'};
async function invoke({settings=env,authorization='Bearer user-test',method='POST',callback}={}) {
  const seen=[];
  const fn=makeReview(settings,async(endpoint,init)=>{
    const data=JSON.parse(init.body);seen.push({url:String(endpoint),...init,data});
    const custom=callback?.(data);if(custom)return custom;
    if(data.op==='review_input') return Response.json({owner:id,title:'단면',description:'남측 채광',email:'DO_NOT_SEND',imageUrl:'DO_NOT_SEND'});
    if(data.op==='start')return Response.json({job:id});
    if(data.messages)return Response.json({choices:[{finish_reason:'stop',message:{content:'채광 근거를 단면에 표시하세요.'}}]});
    return Response.json({saved:true});
  });
  const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  await fn({method,headers:{authorization},body:{id,version:1}},res);
  return {res,seen};
}
test('provider readiness reveals no secrets and disabled/unauthenticated reviews make no calls',async()=>{
  const missing=await invoke({settings:{}});assert.equal(missing.res.code,503);assert.equal(missing.seen.length,0);
  assert.deepEqual((await invoke({method:'GET'})).res.body,{configured:true});
  const anon=await invoke({authorization:''});assert.equal(anon.res.code,401);assert.equal(anon.seen.length,0);
});
test('review uses caller scope, reserves quota, sends only design text, saves after completion',async()=>{
  const {res,seen}=await invoke();assert.equal(res.code,200);assert.deepEqual(seen.map(c=>c.data.op||'generate'),['review_input','start','generate','finish']);
  assert.equal(seen[0].headers.Authorization,'Bearer user-test');assert.equal(seen[1].headers.apikey,'sb_secret_test');assert.equal(seen[1].headers.Authorization,undefined);
  assert.doesNotMatch(seen[2].body,/DO_NOT_SEND|user-test|sb_secret_test/);assert.match(seen[2].body,/남측 채광/);
});
test('permission and quota failures stop before provider usage',async()=>{
  for (const [op,error,code] of [['review_input',Response.json({}, {status:403}),403],['start',Response.json({code:'P0001',message:'24시간 제한'},{status:400}),429]]) {
    const {res,seen}=await invoke({callback:data=>data.op===op?error:null});assert.equal(res.code,code);assert.ok(!seen.some(c=>c.data.messages));
  }
});
test('provider failure or incomplete response does not write a review',async()=>{
  for (const provider of [Response.json({},{status:402}),Response.json({choices:[{finish_reason:'length',message:{content:'부분 응답'}}]})]) {
    const {res,seen}=await invoke({callback:data=>data.messages?provider:null});assert.equal(res.code,502);assert.equal(seen.at(-1).data.op,'fail');assert.ok(!seen.some(c=>c.data.op==='finish'));
  }
});
test('concurrent revision change is surfaced even after generation',async()=>{
  assert.equal((await invoke({callback:data=>data.op==='finish'?Response.json({saved:false}):null})).res.code,409);
});
