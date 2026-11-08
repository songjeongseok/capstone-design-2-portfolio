import {fields,identity,publicMember} from './shared.mjs';
import {snapshotLegacy,prepareMigration} from './legacy-migration.mjs';
export const STORE_KEY='dku_capstone_workspace_v2', SESSION_KEY='dku_capstone_workspace_session_v2';
const hex=buffer=>Array.from(new Uint8Array(buffer),n=>n.toString(16).padStart(2,'0')).join('');
async function hash(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256));}
export class LocalStore{
 constructor(storage,session){this.storage=storage;this.session=session;this.mode='local';}
 read(){const value=this.storage.getItem(STORE_KEY);const s=value?JSON.parse(value):{schemaVersion:2,revision:0,members:[],records:[],imports:[]};if(s.schemaVersion!==2||!Array.isArray(s.members)||!Array.isArray(s.records)||!Array.isArray(s.imports)||!Number.isInteger(s.revision))throw Error('저장 형식 오류: 덮어쓰지 않았습니다. 원본을 백업하세요.');return s;}
 write(s,revision){if(this.read().revision!==revision)throw Error('다른 창에서 변경됐습니다. 새로고침 후 다시 시도하세요.');s.revision=revision+1;this.storage.setItem(STORE_KEY,JSON.stringify(s));}
 async me(){const id=this.session.getItem(SESSION_KEY);return this.read().members.find(m=>m.id===id)?publicMember(this.read().members.find(m=>m.id===id)):null;}
 async owner(){const u=await this.me();if(!u)throw Error('로그인해 주세요.');return u;}
 async signup(input){const v=identity(input),s=this.read();if(s.members.some(m=>m.email===v.email))throw Error('이미 등록된 이메일입니다.');const salt=crypto.randomUUID(),passwordHash=await hash(v.password,salt);const m={id:crypto.randomUUID(),studentId:'local_'+crypto.randomUUID(),name:v.name,email:v.email,salt,passwordHash,role:'student',status:'active'};s.members.push(m);this.write(s,s.revision);this.session.setItem(SESSION_KEY,m.id);return publicMember(m);}
 async login({email,password}){
  email=email.trim().toLowerCase();let s=this.read(),m=s.members.find(m=>m.email===email);
  if(m){if(await hash(password,m.salt)!==m.passwordHash)throw Error('이메일 또는 비밀번호가 일치하지 않습니다.');}
  else{
   const old=JSON.parse(this.storage.getItem('dku_capstone_students_v1')||'[]');if(!Array.isArray(old))throw Error('이전 계정 형식 오류');
   const digest=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password)));const match=old.find(m=>m.email===email&&m.passwordHash===digest);
   if(!match)throw Error('이메일 또는 비밀번호가 일치하지 않습니다.');
   const salt=crypto.randomUUID();m={id:crypto.randomUUID(),studentId:match.studentId,name:match.name,email,salt,passwordHash:await hash(password,salt),role:'student',status:'active',legacy:true};s.members.push(m);this.write(s,s.revision);
  }
  this.session.setItem(SESSION_KEY,m.id);return publicMember(m);
 }
 async logout(){this.session.removeItem(SESSION_KEY);}
 async members(){await this.owner();return this.read().members.map(publicMember);}
 async records({all=false,trash=false}={}){const u=await this.owner();return this.read().records.filter(r=>(all||r.studentId===u.studentId)&&Boolean(r.deletedAt)===trash);}
 async save(input){const u=await this.owner(),s=this.read();const existing=s.records.find(r=>r.id===input.id&&r.studentId===u.studentId);const retained=existing?.imageUrl&&input.imageUrl===existing.imageUrl;const v=fields({...input,imageUrl:retained?null:input.imageUrl});if(retained)v.imageUrl=existing.imageUrl;let r;
  if(input.id){const i=s.records.findIndex(r=>r.id===input.id&&r.studentId===u.studentId);if(i<0)throw Error('본인 기록만 수정할 수 있습니다.');const old=s.records[i];if(old.deletedAt||old.version!==input.expectedVersion)throw Error('기록이 변경됐습니다. 새로고침하세요.');const {history,...previous}=old;r={...old,...v,version:old.version+1,updatedAt:Date.now(),reviewStatus:'stale',history:[...(history||[]),previous]};s.records[i]=r;}
  else{r={...v,id:crypto.randomUUID(),studentId:u.studentId,version:1,createdAt:Date.now(),updatedAt:Date.now(),deletedAt:null,history:[],reviewStatus:'not-configured',aiComment:''};s.records.push(r);}
  this.write(s,s.revision);return r;
 }
 async trash(id,expectedVersion,restore=false){const u=await this.owner(),s=this.read(),r=s.records.find(r=>r.id===id&&r.studentId===u.studentId);if(!r)throw Error('본인 기록만 변경할 수 있습니다.');if(r.version!==expectedVersion)throw Error('기록이 변경됐습니다.');const {history,...previous}=r;r.history=[...(history||[]),previous];r.deletedAt=restore?null:Date.now();r.version++;r.updatedAt=Date.now();this.write(s,s.revision);}
 async history(id){const u=await this.owner(),r=this.read().records.find(r=>r.id===id&&r.studentId===u.studentId);if(!r)throw Error('본인 기록만 조회할 수 있습니다.');return [...(r.legacyHistory||[]),...(r.history||[])];}
 async backup(){await this.owner();return {kind:'capstone-workspace-backup',createdAt:new Date().toISOString(),workspace:this.read(),legacy:snapshotLegacy(this.storage)};}
 async importLegacy(){const u=await this.owner(),plan=await prepareMigration(snapshotLegacy(this.storage));if(plan.issues.some(i=>['invalid-week','ambiguous-deletion'].includes(i.type)))throw Error('주차 또는 삭제 식별자가 모호합니다. 원본 백업 후 담당자가 확인해야 합니다.');const s=this.read();let count=0;
  for(const row of plan.records.filter(r=>r.studentId===u.studentId)){const sourceRow=JSON.parse(this.storage.getItem('dku_local_uploads_v1')||'[]')[row.legacyIndex];const rowDigest=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sourceRow))));const key='legacy:'+u.studentId+':'+row.legacyIndex+':'+rowDigest;if(s.imports.includes(key))continue;s.records.push({...row,id:crypto.randomUUID(),version:1,deletedAt:row.deleted?Date.now():null,history:[],legacyHistory:row.history||[],legacyOriginal:row,updatedAt:Date.now()});s.imports.push(key);count++;}this.write(s,s.revision);return {count};
 }
 async importBackup(backup){const u=await this.owner(),s=this.read();if(backup?.kind!=='capstone-workspace-backup'||backup.workspace?.schemaVersion!==2)throw Error('새 화면에서 내보낸 백업이 아닙니다.');const member=backup.workspace.members.find(m=>m.email===u.email);if(!member)throw Error('같은 이메일의 본인 자료만 가져올 수 있습니다.');let count=0;
  for(const row of backup.workspace.records.filter(r=>r.studentId===member.studentId)){const key='backup:'+member.studentId+':'+row.id+':'+row.version;if(s.imports.includes(key))continue;const data=fields(row);s.records.push({...data,id:crypto.randomUUID(),studentId:u.studentId,version:1,createdAt:row.createdAt||Date.now(),updatedAt:Date.now(),deletedAt:row.deletedAt||null,reviewStatus:row.aiComment?'legacy-unverified':'not-configured',aiComment:String(row.aiComment||''),history:[],legacyHistory:[...(row.legacyHistory||[]),...(row.history||[])]});s.imports.push(key);count++;}this.write(s,s.revision);return {count};
 }
 async approve(){throw Error('교수자 승인 기능은 서버 모드에서만 사용할 수 있습니다.');}
 async review(){throw Error('AI 검토 서버가 연결되지 않았습니다. 키워드 사전 점검만 사용할 수 있습니다.');}
}
