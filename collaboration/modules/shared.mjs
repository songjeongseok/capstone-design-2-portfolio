export const MAX_IMAGE_BYTES=2*1024*1024;
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function imageData(value){
 if(value==null||value==='')return null;
 if(typeof value!=='string')throw Error('이미지 형식 오류');
 const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!m||m[2].length%4)throw Error('PNG·JPEG·WebP 이미지 데이터만 허용합니다.');
 const binary=atob(m[2]);if(binary.length>MAX_IMAGE_BYTES)throw Error('이미지는 2MB 이하만 허용합니다.');
 const valid=m[1]==='png'?binary.startsWith('\x89PNG\r\n\x1a\n'):m[1]==='jpeg'?binary.startsWith('\xff\xd8\xff'):binary.startsWith('RIFF')&&binary.slice(8,12)==='WEBP';
 if(!valid)throw Error('파일 내용과 이미지 형식이 다릅니다.');return value;
}
export function safeImage(value){try{return imageData(value)||'';}catch{return '';}}
export function fields(input){
 const week=Number(input.week),title=String(input.title??'').trim(),description=String(input.description??'').trim();
 if(!Number.isInteger(week)||week<1||week>99)throw Error('주차는 1~99 사이 정수로 입력하세요.');
 if(!title||title.length>200||!description||description.length>30000)throw Error('제목(200자 이하)과 내용(30,000자 이하)을 확인하세요.');
 return {week,title,description,imageUrl:imageData(input.imageUrl)};
}
export function identity(input){
 const email=String(input.email??'').trim().toLowerCase(),name=String(input.name??'').trim(),password=String(input.password??'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Error('이메일을 확인하세요.');
 if(!name||name.length>80)throw Error('이름을 확인하세요.');
 if(password.length<10||password.length>128)throw Error('비밀번호는 10~128자로 입력하세요.');
 return {email,name,password};
}
export async function readImage(file){
 if(!file)return null;if(file.size>MAX_IMAGE_BYTES)throw Error('이미지는 2MB 이하만 허용합니다.');
 const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('이미지를 읽을 수 없습니다.'));r.readAsDataURL(file);});return imageData(data);
}
export const publicMember=({id,studentId,name,email,role,status})=>({id,studentId,name,email,role,status});
export function exportJSON(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
