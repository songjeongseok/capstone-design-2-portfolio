import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {fields,identity} from '../collaboration/modules/shared.mjs';
const scrypt=promisify(scryptCallback),sha=v=>createHash('sha256').update(v).digest('hex');
async function passwordHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex');}
async function verify(password,stored){const [salt,h]=stored.split(':');return timingSafeEqual(await scrypt(String(password),salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}),Buffer.from(h,'hex'));}
const failure=(status,message)=>Object.assign(Error(message),{status});
const member=u=>({id:u.id,studentId:u.archive_id,name:u.name,email:u.email,role:u.role,status:u.status});
export async function createApp({databasePath=':memory:',origin,adminEmail,adminPassword,now=Date.now}={}){
 const base=new URL(origin);if(base.origin!==origin||!(base.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('APP_ORIGIN은 HTTPS origin 또는 localhost여야 합니다.');
 const db=new DatabaseSync(databasePath);db.exec(`PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,archive_id TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('student','instructor')),status TEXT NOT NULL CHECK(status IN ('pending','active')),created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id),body TEXT NOT NULL,version INTEGER NOT NULL,deleted_at INTEGER,import_key TEXT,UNIQUE(owner_id,import_key));
 CREATE TABLE IF NOT EXISTS versions(record_id TEXT REFERENCES records(id),version INTEGER,body TEXT NOT NULL,PRIMARY KEY(record_id,version));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,action TEXT,target TEXT,created_at INTEGER);`);
 const query=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const log=(actor,action,target)=>run('INSERT INTO audit(actor,action,target,created_at) VALUES(?,?,?,?)',actor,action,target,now());
 if(!query("SELECT id FROM users WHERE role='instructor'")){
  const v=identity({email:adminEmail,password:adminPassword,name:'담당 교수자'});
  run('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)',randomUUID(),v.email,v.name,'teacher_'+randomUUID(),await passwordHash(v.password),'instructor','active',now());
 }
 const dummy=await passwordHash(randomBytes(24).toString('hex')),limits=new Map();
 function limit(ip){const key=ip||'unknown';let v=limits.get(key);if(!v||v.until<=now()){v={count:0,until:now()+600000};limits.set(key,v);}if(++v.count>20)throw failure(429,'로그인 시도가 많습니다. 잠시 후 다시 시도하세요.');if(limits.size>10000)for(const [k,v] of limits)if(v.until<=now())limits.delete(k);}
 function user(request,{pending=false}={}){const token=/(?:^|;\s*)capstone_session=([^;]+)/.exec(request.headers.get('cookie')||'')?.[1];const u=token?query('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?',sha(token),now()):null;if(!u)throw failure(401,'로그인해 주세요.');if(!pending&&u.status!=='active')throw failure(403,'교수자 승인 대기 중입니다.');return u;}
 function teacher(u){if(u.role!=='instructor')throw failure(403,'교수자 권한이 필요합니다.');}
 function owned(id,u){const r=query('SELECT * FROM records WHERE id=?',id);if(!r||r.owner_id!==u.id)throw failure(404,'본인 기록을 찾을 수 없습니다.');return r;}
 function readable(id,u){const r=query('SELECT * FROM records WHERE id=?',id);if(!r||(u.role!=='instructor'&&r.owner_id!==u.id))throw failure(404,'기록을 찾을 수 없습니다.');return r;}
 const decode=r=>JSON.parse(r.body);
 async function body(req){if(!req.headers.get('content-type')?.startsWith('application/json'))throw failure(415,'JSON 요청만 허용합니다.');let bytes=0;const chunks=[];for await(const chunk of req.body||[]){bytes+=chunk.length;if(bytes>12*1024*1024)throw failure(413,'요청 크기가 너무 큽니다.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure(400,'JSON 형식 오류');}}
 const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
 const cookie=(value,age)=>`capstone_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${base.protocol==='https:'?'; Secure':''}`;
 const saveVersion=(r,next,actor,action)=>{run('INSERT INTO versions VALUES(?,?,?)',r.id,r.version,r.body);run('UPDATE records SET body=?,version=?,deleted_at=? WHERE id=?',JSON.stringify(next),next.version,next.deletedAt,r.id);log(actor,action,r.id);};
 async function handle(request,{ip='unknown'}={}){
  try{
   const url=new URL(request.url),path=url.pathname;if(url.origin!==origin)throw failure(421,'잘못된 요청 주소');
   if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==origin)throw failure(403,'동일 출처 요청만 허용합니다.');
   if(path==='/api/capabilities'&&request.method==='GET')return json({mode:'server',sharedStorage:true,aiConfigured:false,emailVerification:false,imageMaxBytes:2097152,accountApproval:'instructor'});
   if(path==='/api/auth/signup'&&request.method==='POST'){
    limit(ip);const v=identity(await body(request));if(query('SELECT id FROM users WHERE email=?',v.email))throw failure(409,'이미 등록된 이메일입니다.');const id=randomUUID();
    run('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)',id,v.email,v.name,'student_'+randomUUID(),await passwordHash(v.password),'student','pending',now());log(id,'signup',id);return json({pending:true},201);
   }
   if(path==='/api/auth/login'&&request.method==='POST'){
    limit(ip);const input=await body(request);if(typeof input.password!=='string'||input.password.length>128)throw failure(400,'비밀번호 형식 오류');
    const u=query('SELECT * FROM users WHERE email=?',String(input.email||'').trim().toLowerCase()),valid=await verify(input.password,u?.password_hash||dummy);if(!u||!valid)throw failure(401,'이메일 또는 비밀번호가 일치하지 않습니다.');const token=randomBytes(32).toString('hex');run('DELETE FROM sessions WHERE expires_at<=?',now());run('INSERT INTO sessions VALUES(?,?,?)',sha(token),u.id,now()+43200000);return json(member(u),200,{'set-cookie':cookie(token,43200)});
   }
   if(path==='/api/auth/logout'&&request.method==='POST'){const token=/(?:^|;\s*)capstone_session=([^;]+)/.exec(request.headers.get('cookie')||'')?.[1];if(token)run('DELETE FROM sessions WHERE token_hash=?',sha(token));return json({ok:true},200,{'set-cookie':cookie('',0)});}
   if(path==='/api/auth/me'&&request.method==='GET')return json(member(user(request,{pending:true})));
   const u=user(request);
   if(path==='/api/members'&&request.method==='GET')return json((u.role==='instructor'?all("SELECT * FROM users WHERE role='student' ORDER BY created_at"):[u]).map(member));
   let match=path.match(/^\/api\/members\/([^/]+)\/approve$/);
   if(match&&request.method==='POST'){teacher(u);const target=query("SELECT * FROM users WHERE id=? AND role='student'",match[1]);if(!target)throw failure(404,'학생을 찾을 수 없습니다.');atomic(()=>{run("UPDATE users SET status='active' WHERE id=?",target.id);log(u.id,'approve',target.id);});return json({ok:true});}
   if(path==='/api/records'&&request.method==='GET'){
    const every=url.searchParams.get('all')==='true',trash=url.searchParams.get('trash')==='true';if(every)teacher(u);const rows=every?all('SELECT * FROM records'):all('SELECT * FROM records WHERE owner_id=?',u.id);return json(rows.filter(r=>Boolean(r.deleted_at)===trash).map(decode));
   }
   if(path==='/api/records'&&request.method==='POST'){
    const v=fields(await body(request)),record={...v,id:randomUUID(),studentId:u.archive_id,version:1,createdAt:now(),updatedAt:now(),deletedAt:null,reviewStatus:'not-configured',aiComment:''};atomic(()=>{run('INSERT INTO records VALUES(?,?,?,?,?,?)',record.id,u.id,JSON.stringify(record),1,null,null);log(u.id,'create',record.id);});return json(record,201);
   }
   match=path.match(/^\/api\/records\/([^/]+)(?:\/(history|restore|review))?$/);
   if(match){
    const [,id,action]=match;
    if(action==='history'&&request.method==='GET'){const r=readable(id,u);const old=decode(r);return json([...(old.legacyHistory||[]),...all('SELECT body FROM versions WHERE record_id=? ORDER BY version',id).map(decode)]);}
    if(action==='review'&&request.method==='POST'){owned(id,u);throw failure(503,'AI 검토 제공자가 연결되지 않았습니다.');}
    if((!action&&['PATCH','DELETE'].includes(request.method))||(action==='restore'&&request.method==='POST')){
     const input=await body(request);const r=owned(id,u);if(input.expectedVersion!==r.version)throw failure(409,'다른 창에서 변경된 기록입니다. 새로고침하세요.');const old=decode(r);let next;
     if(request.method==='PATCH'){if(r.deleted_at)throw failure(409,'휴지통에서 먼저 복원하세요.');next={...old,...fields(input),reviewStatus:'stale'};}
     else next={...old,deletedAt:action==='restore'?null:now()};next.version=r.version+1;next.updatedAt=now();atomic(()=>saveVersion(r,next,u.id,action||request.method));return json(next);
    }
   }
   if(path==='/api/backup'&&request.method==='GET'){
    const records=all('SELECT * FROM records WHERE owner_id=?',u.id).map(r=>({...decode(r),history:all('SELECT body FROM versions WHERE record_id=? ORDER BY version',r.id).map(decode)}));
    return json({kind:'capstone-workspace-backup',createdAt:new Date(now()).toISOString(),workspace:{schemaVersion:2,revision:0,members:[member(u)],records,imports:[]}});
   }
   if(path==='/api/import'&&request.method==='POST'){
    const {backup}=await body(request);if(backup?.kind!=='capstone-workspace-backup'||backup.workspace?.schemaVersion!==2||!Array.isArray(backup.workspace.members)||!Array.isArray(backup.workspace.records))throw failure(400,'백업 형식 오류');
    const source=backup.workspace.members.find(m=>m.email===u.email);if(!source)throw failure(403,'같은 이메일의 본인 자료만 가져올 수 있습니다.');let count=0;
    atomic(()=>{for(const row of backup.workspace.records.filter(r=>r.studentId===source.studentId)){
     const key=sha(JSON.stringify([source.studentId,row.id,row.version]));if(query('SELECT id FROM records WHERE owner_id=? AND import_key=?',u.id,key))continue;
     const v=fields(row),record={...v,id:randomUUID(),studentId:u.archive_id,version:1,createdAt:Number(row.createdAt)||now(),updatedAt:now(),deletedAt:row.deletedAt?now():null,aiComment:String(row.aiComment||''),reviewStatus:row.aiComment?'legacy-unverified':'not-configured',legacyHistory:[...(row.legacyHistory||[]),...(row.history||[])]};
     run('INSERT INTO records VALUES(?,?,?,?,?,?)',record.id,u.id,JSON.stringify(record),1,record.deletedAt,key);log(u.id,'import',record.id);count++;
    }});return json({count},201);
   }
   throw failure(404,'API를 찾을 수 없습니다.');
  }catch(error){const status=error.status||(error.code?.startsWith('ERR_SQLITE')?500:400);return json({error:status===500?'서버 저장 오류':error.message},status);}
 }
 return {handle,close:()=>db.close()};
}
