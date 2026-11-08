export class ServerStore{
 constructor(){this.mode='server';}
 async request(path,{method='GET',data}={}){const res=await fetch('/api'+path,{method,credentials:'same-origin',headers:data?{'content-type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{})});let result;try{result=await res.json();}catch{throw Error('서버 응답 형식을 확인하세요.');}if(!res.ok)throw Object.assign(Error(result.error||'서버 요청 실패'),{status:res.status});return result;}
 async me(){try{return await this.request('/auth/me');}catch(e){if(e.status===401)return null;throw e;}}
 signup(v){return this.request('/auth/signup',{method:'POST',data:v});}
 login(v){return this.request('/auth/login',{method:'POST',data:v});}
 logout(){return this.request('/auth/logout',{method:'POST',data:{}});}
 members(){return this.request('/members');}
 records({all=false,trash=false}={}){return this.request('/records?all='+all+'&trash='+trash);}
 save(v){return this.request('/records'+(v.id?'/'+encodeURIComponent(v.id):''),{method:v.id?'PATCH':'POST',data:v});}
 trash(id,expectedVersion,restore=false){return this.request('/records/'+encodeURIComponent(id)+(restore?'/restore':''),{method:restore?'POST':'DELETE',data:{expectedVersion}});}
 history(id){return this.request('/records/'+encodeURIComponent(id)+'/history');}
 approve(id){return this.request('/members/'+encodeURIComponent(id)+'/approve',{method:'POST',data:{}});}
 review(id){return this.request('/records/'+encodeURIComponent(id)+'/review',{method:'POST',data:{}});}
 backup(){return this.request('/backup');}
 importBackup(backup){return this.request('/import',{method:'POST',data:{backup}});}
 async importLegacy(){throw Error('기존 브라우저 화면에서 자료를 가져온 후 JSON 백업을 서버에 제출하세요. 서버는 이전 계정과 세션을 신뢰하지 않습니다.');}
}
