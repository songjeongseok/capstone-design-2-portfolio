// Replace the preview-only _e wrapper through createApiClient; do NOT enable server mode before acceptance tests.
export function createApiClient({mode='preview', previewRole='student', fetchImpl=globalThis.fetch}={}) {
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  return async function api(path, options={}) {
    const method=(options.method||'GET').toUpperCase();
    if (!path.startsWith('/api/')) throw new Error('허용되지 않은 API 경로');
    if (mode==='preview') {
      if(method!=='GET') return json({error:'디자인 미리보기입니다. 저장과 AI 처리는 연결되지 않았습니다.'},409);
      if(path.endsWith('/me')) return json({user:{id:'preview',name:'미리보기',studentId:'미리보기 계정',role:previewRole}});
      return json({files:[],reviews:[],threads:[],posts:[],summary:{files:0,students:0,size:'0 KB'}});
    }
    if(mode!=='server') return json({error:'공동 저장 서버가 설정되지 않았습니다.'},503);
    const headers=new Headers(options.headers||{});
    // Browser sets multipart boundaries for FormData; JSON requests must explicitly declare JSON.
    if(typeof options.body==='string' && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
    // Same-origin cookie session plus server-side Origin/CSRF checks required.
    const response=await fetchImpl(path,{...options,method,headers,credentials:'include'});
    if(!(response.headers.get('Content-Type')||'').includes('application/json'))
      throw new Error('API 응답이 JSON이 아닙니다. 정적 호스팅 오류 페이지 또는 서버 설정을 확인하세요.');
    return response;
  };
}
export async function readJSON(api,path,options) {
  const response=await api(path,options), body=await response.json();
  if(!response.ok) throw new Error(body.error||`요청 실패 ${response.status}`);
  return body;
}
export function weekLabel(week) {
  if(!Number.isInteger(week)||week<1) throw new Error('주차 형식 오류');
  return `W${String(week).padStart(2,'0')}`;
}
export function toDesignRecord(row) {
  // A submission is not an attachment. Keep description, image and archive ID intact.
  if(!row.id) throw new Error('식별자 복구가 먼저 필요합니다.');
  return {...row, week:weekLabel(row.week), name:row.title||'제목 없음',
    title:row.title||'', description:row.description||'',
    legacyArchiveId:row.studentId, attachments:row.attachments||(
      row.imageUrl?[{id:`${row.id}:legacy-image`,url:row.imageUrl,name:row.title||'기존 이미지',legacy:true}]:[])};
}
