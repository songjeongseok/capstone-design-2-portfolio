import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {snapshotLegacy,prepareMigration} from '../collaboration/modules/legacy-migration.mjs';
import {createApiClient,readJSON,toDesignRecord} from './fixtures/api-client.mjs';
import {analyzeRecord,aggregateReviews} from '../collaboration/modules/review-core.mjs';
const original=readFileSync(new URL('./fixtures/legacy-original.html',import.meta.url),'utf8');
const patched='<script>'+readFileSync(new URL('../legacy-app.js',import.meta.url),'utf8')+'</script>';
function context(html){
 const map=new Map(),fields={},alerts=[];
 const el=id=>fields[id]??=( {value:'',files:[],hidden:false,disabled:false,isConnected:true,dataset:{},
   textContent:'',innerHTML:'',focus(){},reset(){},addEventListener(){},closest(){return null}} );
 const sandbox={console,TextEncoder,crypto,URL,Blob,Response,Headers,DOMException,
   localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},
   document:{getElementById:el,querySelector:el},location:{hash:'#/s/s3'},
   window:{addEventListener(){},open(){return null}},alert:s=>alerts.push(s),confirm:()=>true,prompt:()=>null,
   setTimeout:()=>0,FileReader:class{readAsDataURL(){this.result='data:image/png;base64,TEST';this.onload();}}};
 vm.createContext(sandbox);
 let script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace("hydrateAuth();window.addEventListener('hashchange',route);route();",'');
 vm.runInContext(script,sandbox);
 vm.runInContext("renderStudent=async()=>{};route=async()=>{};",sandbox);
 return {sandbox,map,el,alerts,run:s=>vm.runInContext(s,sandbox)};
}
function fill(c){c.el('fWeek').value='2';c.el('fTitle').value='시험 기록';c.el('fDesc').value='대지 면적 200㎡';}
test('original modal label null failure is reproducible',()=>{const c=context(original);assert.throws(()=>c.run("openAuth('login')"),/null/)});
test('original unauthenticated submit omits id and loses selected image',async()=>{const c=context(original);fill(c);c.el('fImg').files=[{type:'image/png',size:10}];await c.run("submitUpload({preventDefault(){}},'s3')");const row=JSON.parse(c.map.get('dku_local_uploads_v1'))[0];assert.equal(row.id,undefined);assert.equal(row.imageUrl,null)});
test('patch opens register and login modals',()=>{const c=context(patched);c.run("openAuth('register');openAuth('login')");assert.equal(c.el('label[for="authName"]').hidden,true)});
test('patch blocks anonymous submission',async()=>{const c=context(patched);fill(c);await c.run("submitUpload({preventDefault(){}},'s3')");assert.equal(c.map.has('dku_local_uploads_v1'),false)});
test('patch retains id and selected local image',async()=>{const c=context(patched);fill(c);c.run("currentUser={studentId:'s3'}");c.el('fImg').files=[{type:'image/png',size:10}];await c.run("submitUpload({preventDefault(){}},'s3')");const row=JSON.parse(c.map.get('dku_local_uploads_v1'))[0];assert.ok(row.id);assert.match(row.imageUrl,/^data:image/);assert.equal(row.reviewStatus,'not-configured')});
test('patch storage error leaves records intact and restores button',async()=>{const c=context(patched);fill(c);c.run("currentUser={studentId:'s3'};saveLocalUploads=()=>{throw new Error('QuotaExceededError')}");await c.run("submitUpload({preventDefault(){}},'s3')");assert.equal(c.map.size,0);assert.equal(c.el('upBtn').disabled,false);assert.match(c.alerts[0],/저장하지 못했습니다/)});
test('patch corrupt JSON is not silently overwritten',async()=>{const c=context(patched);fill(c);c.map.set('dku_local_uploads_v1','{bad');c.run("currentUser={studentId:'s3'}");await c.run("submitUpload({preventDefault(){}},'s3')");assert.equal(c.map.get('dku_local_uploads_v1'),'{bad')});
test('patch hide and restore retain the original',async()=>{const c=context(patched);c.map.set('dku_local_uploads_v1',JSON.stringify([{id:'test-1',studentId:'s3',week:1}]));c.run("currentUser={studentId:'s3'}");await c.run("deleteUpload('s3','test-1')");assert.equal(JSON.parse(c.map.get('dku_local_uploads_v1')).length,1);assert.deepEqual(JSON.parse(c.map.get('dku_deleted_uploads_v1')),['test-1']);await c.run("restoreUpload('s3','test-1')");assert.deepEqual(JSON.parse(c.map.get('dku_deleted_uploads_v1')),[])});
test('patch keeps local generated review even without db',async()=>{const c=context(patched);fill(c);c.run("currentUser={studentId:'s3'};sampleApi=async()=>({text:'시험 의견'})");await c.run("submitUpload({preventDefault(){}},'s3')");assert.equal(JSON.parse(c.map.get('dku_local_uploads_v1'))[0].aiComment,'시험 의견')});
test('patch report uses registered display name',async()=>{const c=context(patched);c.map.set('dku_capstone_students_v1',JSON.stringify([{name:'시험학생',studentId:'s3'}]));c.run("window.open=()=>({document:{write:s=>window.reportHTML=s,close(){}},focus(){},print(){}})");await c.run("downloadStudentReport('s3')");assert.match(c.sandbox.window.reportHTML,/시험학생/)});
test('extracted analysis is identical to legacy results',()=>{const c=context(original);const row={id:'s1_w2_sample',title:'단면',description:'채광 20%'};assert.deepEqual(analyzeRecord(row),JSON.parse(JSON.stringify(c.run(`analyzeRecord(${JSON.stringify(row)})`))));assert.equal(aggregateReviews([]).total,0)});
test('migration is read-only, deterministic, lossless and does not conflate missing ids',async()=>{const c=context(original);const rows=[{studentId:'s3',week:1,title:'A',imageUrl:'x'},{studentId:'s3',week:2,title:'B'},{id:'same',studentId:'s3',week:3},{id:'same',studentId:'s4',week:4}];c.map.set('dku_local_uploads_v1',JSON.stringify(rows));c.map.set('dku_deleted_uploads_v1','[null,"undefined"]');const before=JSON.stringify([...c.map]);const snap=snapshotLegacy(c.sandbox.localStorage),a=await prepareMigration(snap),b=await prepareMigration(snap);assert.deepEqual(a,b);assert.equal(new Set(a.records.map(r=>r.id)).size,4);assert.equal(a.counts.source,a.counts.prepared);assert.equal(a.records[0].imageUrl,'x');assert.equal(a.records[0].deleted,false);assert.equal(JSON.stringify([...c.map]),before)});
test('migration rejects malformed source',async()=>{await assert.rejects(()=>prepareMigration({raw:{dku_local_uploads_v1:'{bad'}}))});
test('migration does not export password hashes as new accounts',async()=>{const c=context(original);c.map.set('dku_capstone_students_v1',JSON.stringify([{name:'시험',email:'test@example.invalid',studentId:'s1',passwordHash:'secret'}]));const plan=await prepareMigration(snapshotLegacy(c.sandbox.localStorage));assert.equal('passwordHash' in plan.memberMappingCandidates[0],false)});
test('preview writes rejected without invoking network',async()=>{const api=createApiClient({fetchImpl:()=>{throw Error('network should not be called')}});await assert.rejects(()=>readJSON(api,'/api/files/upload',{method:'POST'}),/미리보기/)});
test('server 401 not treated as success',async()=>{const api=createApiClient({mode:'server',fetchImpl:async()=>new Response('{"error":"인증 필요"}',{status:401,headers:{'Content-Type':'application/json'}})});await assert.rejects(()=>readJSON(api,'/api/auth/me'),/인증 필요/)});
test('static HTML fallback not treated as API success',async()=>{const api=createApiClient({mode:'server',fetchImpl:async()=>new Response('<html/>',{headers:{'Content-Type':'text/html'}})});await assert.rejects(()=>readJSON(api,'/api/auth/me'),/JSON/)});
test('mapping preserves description image ID and weeks beyond preview six',()=>{const row=toDesignRecord({id:'r1',studentId:'s1',week:15,title:'제목',description:'설명',imageUrl:'https://example.invalid/image'});assert.equal(row.week,'W15');assert.equal(row.description,'설명');assert.equal(row.attachments[0].url,'https://example.invalid/image');assert.equal(row.legacyArchiveId,'s1')});
test('legacy edit retains prior content and rejects ambiguous IDs',async()=>{const c=context(patched);c.map.set('dku_local_uploads_v1',JSON.stringify([{id:'test-1',studentId:'s3',week:1,title:'원본',description:'원본 내용'}]));c.run("currentUser={studentId:'s3'};prompt=()=> '수정 내용'");await c.run("editUpload('s3','test-1')");const row=JSON.parse(c.map.get('dku_local_uploads_v1'))[0];assert.equal(row.history[0].title,'원본');assert.equal(row.reviewStatus,'stale');const before=c.map.get('dku_local_uploads_v1');await c.run("editUpload('s3','undefined')");assert.equal(c.map.get('dku_local_uploads_v1'),before)});
