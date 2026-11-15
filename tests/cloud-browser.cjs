const {chromium}=require('playwright-core');
const {readFile}=require('node:fs/promises');
const {strict:assert}=require('node:assert');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || 'google-chrome',args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const faults=[];page.on('pageerror',e=>faults.push(e.message));
 let rows=[],user={id:'test',studentId:'test',email:'s@example.invalid',name:'시험학생',role:'student',status:'active'},mail=0,review=0;
 const origin='https://classroom.example.invalid';
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  const json=v=>route.fulfill({json:v,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, GET, OPTIONS'}});
  if(req.method()==='OPTIONS')return json({});
  if(u.host==='test.supabase.co'){
   const data=req.postDataJSON();
   if(u.pathname.endsWith('/otp')){assert.equal(data.create_user,true);mail++;return json({});}
   if(u.pathname.endsWith('/verify')){assert.equal(data.token,'123456');return json({access_token:'test',refresh_token:'test-r',expires_in:3600});}
   if(data.op==='me')return json(user);
   if(data.op==='list')return json(data.p.trash?[]:rows);
   if(data.op==='members')return json([user]);
   if(data.op==='create'){rows=[{...data.p,id:'record',version:1,studentId:'test',reviewStatus:'unreviewed'}];return json(rows[0]);}
   throw Error('unexpected operation '+data.op);
  }
  if(u.pathname==='/api/review'){
    if(req.method()==='GET')return json({configured:true});
    assert.equal(req.postDataJSON().version,1);review++;rows[0].reviewStatus='succeeded';rows[0].aiComment='단면에서 남측 채광을 검토하세요.';return json({saved:true});
  }
  if(u.pathname.endsWith('runtime-config.js'))return route.fulfill({contentType:'text/javascript',body:"window.CAPSTONE_CONFIG={mode:'cloud',url:'https://test.supabase.co',publicKey:'sb_publishable_test'}"});
  let path=u.pathname;if(path.endsWith('/'))path+='index.html';
  try {return await route.fulfill({body:await readFile('.'+path),contentType:path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/collaboration/');
 await page.getByRole('button',{name:'학생 계정 만들기'}).click();
 await page.getByLabel('이름',{exact:true}).fill('시험학생');
 await page.getByLabel('이메일',{exact:true}).fill(user.email);
 await page.getByRole('button',{name:'이메일로 인증번호 받기'}).click();
 await page.getByLabel('이메일 인증번호',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'인증번호 확인'}).click();
 await page.getByRole('button',{name:'설계자료 제출'}).click();
 await page.getByLabel('주차',{exact:true}).fill('15');
 await page.getByLabel('제목',{exact:true}).fill('대지 분석');
 await page.getByLabel('설계 진행 내용').fill('남측 채광과 보행 접근');
 await page.getByRole('button',{name:'기록 저장'}).click();
 page.on('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'AI 설계 검토 요청'}).click();
 await page.getByText('단면에서 남측 채광을 검토하세요.').waitFor();
 assert.equal(mail,1);assert.equal(review,1);assert.deepEqual(faults,[]);
 await page.goto(origin+'/collaboration/?local=1');
 await page.getByLabel('비밀번호').waitFor();
 assert.equal(await page.getByText('이 브라우저에만 저장 · 공동 인증 미연결').count(),1);
 console.log('Passed simulated 390px browser flow: signup, email code, submit, review, access to legacy local mode.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
