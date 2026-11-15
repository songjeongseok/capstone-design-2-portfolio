import {fields} from './shared.mjs';

const authErrors = {
  over_email_send_rate_limit: '메일 재발송 제한에 도달했습니다. 잠시 후 다시 시도하세요.',
  email_address_not_authorized: '학생 주소로 메일을 보내려면 담당자의 SMTP 설정이 필요합니다.',
  otp_expired: '인증번호가 만료되었거나 올바르지 않습니다.',
  signup_disabled: '가입할 수 없습니다. 신규 계정은 학생 가입을 선택하세요.'
};

export class CloudStore {
  constructor(config, storage = sessionStorage, request = fetch) {
    this.url = config.url;
    this.key = config.publicKey;
    this.sessionKey = 'capstone:otp:' + config.url;
    this.storage = storage;
    this.fetch = request;
  }

  async send(path, data, token) {
    const response = await this.fetch(this.url + path, {
      method: 'POST', headers: {apikey:this.key, 'Content-Type':'application/json',
        ...(token ? {Authorization:'Bearer ' + token} : {})},
      body:JSON.stringify(data), cache:'no-store', credentials:'omit'
    });
    const result = await response.text();
    const value = result ? JSON.parse(result) : {};
    if (!response.ok) {
      const code = value.error_code || value.code;
      throw Object.assign(Error(authErrors[code] || value.message || value.msg || '공동 서버 요청 실패'), {status:response.status});
    }
    return value;
  }

  requestCode(email, name, create) {
    return this.send('/auth/v1/otp', {email,create_user:create,...(create ? {data:{name}} : {})});
  }

  saveSession(value) {
    if (!value.access_token || !value.refresh_token || !Number(value.expires_in)) throw Error('인증 응답을 확인하세요.');
    this.storage.setItem(this.sessionKey, JSON.stringify({
      access:value.access_token, refresh:value.refresh_token, expires:Date.now()+value.expires_in*1000
    }));
  }

  async verifyCode(email, token) {
    this.saveSession(await this.send('/auth/v1/verify', {email,token,type:'email'}));
  }

  async token() {
    const saved = JSON.parse(this.storage.getItem(this.sessionKey) || 'null');
    if (!saved) return null;
    if (saved.expires > Date.now()+30000) return saved.access;
    if (!this.refreshing) this.refreshing = this.send('/auth/v1/token?grant_type=refresh_token', {refresh_token:saved.refresh})
      .then(v => {this.saveSession(v);return v.access_token;})
      .catch(e => {if ([400,401,403].includes(e.status)) {this.storage.removeItem(this.sessionKey);return null;}throw e;})
      .finally(() => {this.refreshing=null;});
    return this.refreshing;
  }

  async rpc(op, p={}) {
    const token = await this.token();
    if (!token) throw Error('인증번호로 다시 로그인하세요.');
    return this.send('/rest/v1/rpc/capstone_workspace', {op,p}, token);
  }

  async me() {return await this.token() ? this.rpc('me') : null;}
  async logout() {
    const token = await this.token();
    try {if (token) await this.send('/auth/v1/logout?scope=local', {}, token);}
    finally {this.storage.removeItem(this.sessionKey);}
  }
  members() {return this.rpc('members');}
  approve(id) {return this.rpc('approve', {id});}
  async records({all=false,trash=false}={}) {
    const result=[];
    let after=null;
    for (;;) {
      const page=await this.rpc('list', {all,trash,after});
      result.push(...page);
      if (page.length<4) return result;
      after=page.at(-1).id;
    }
  }
  save(row) {
    return this.rpc(row.id?'edit':'create',{...fields(row), id:row.id, expectedVersion:row.expectedVersion});
  }
  trash(id,expectedVersion,restore=false) {return this.rpc(restore?'restore':'trash',{id,expectedVersion});}
  history(id) {return this.rpc('history',{id});}
  async review(id,version) {
    const token=await this.token();
    if (!token) throw Error('다시 로그인하세요.');
    const res=await this.fetch('/api/review', {method:'POST',headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id,version})});
    const data=await res.json();
    if (!res.ok || !data.saved) throw Error(data.error || '검토 결과가 저장되지 않았습니다.');
  }
  async backup() {
    const member=await this.me();
    const records=[...await this.records(),...await this.records({trash:true})];
    for (const record of records) record.history=await this.history(record.id);
    return {kind:'capstone-workspace-backup',createdAt:new Date().toISOString(),
      workspace:{schemaVersion:2,revision:0,members:[member],records,imports:[]}};
  }
  async importBackup(backup) {
    const member=await this.me(), workspace=backup?.workspace;
    if (backup?.kind!=='capstone-workspace-backup'||workspace?.schemaVersion!==2||!Array.isArray(workspace.members)||!Array.isArray(workspace.records)) throw Error('개인 백업 JSON을 확인하세요.');
    const source=workspace.members.find(m=>String(m.email).toLowerCase()===member.email);
    if (!source) throw Error('같은 이메일의 본인 백업만 가져올 수 있습니다.');
    const records=workspace.records.filter(r=>r.studentId===source.studentId).map(r=>{
      if (!r.id || !r.version) throw Error('백업 기록의 식별자 또는 버전이 없습니다.');
      return {...fields(r),key:JSON.stringify([r.studentId,r.id,r.version]),createdAt:r.createdAt||null,
        deletedAt:r.deletedAt||null,aiComment:r.aiComment||'',history:[...(r.legacyHistory||[]),...(r.history||[])]};
    });
    return this.rpc('import',{email:member.email,records});
  }
}
