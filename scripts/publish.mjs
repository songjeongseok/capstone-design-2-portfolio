import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';

const target=new URL('../dist/',import.meta.url),root=new URL('../',import.meta.url);
const {SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:publicKey}=process.env;
let config;
if (url || publicKey) {
  if (!url || new URL(url).protocol!=='https:' || !publicKey) throw Error('SUPABASE_URL 및 공개 키를 함께 설정하세요.');
  let valid=publicKey.startsWith('sb_publishable_');
  if (!valid && publicKey.startsWith('eyJ')) {
    try {valid=JSON.parse(Buffer.from(publicKey.split('.')[1],'base64url')).role==='anon';} catch {}
  }
  if (!valid) throw Error('SUPABASE_PUBLISHABLE_KEY에는 공개 키만 사용할 수 있습니다.');
  config={mode:'cloud',url:new URL(url).origin,publicKey};
}
await mkdir(target,{recursive:true});
for (const name of ['index.html','캡스톤디자인2포트폴리오.html','portfolio-hero.jpg','legacy-app.js','collaboration','배포가이드.md','INTEGRATION.md']) {
  await cp(new URL(name,root),new URL(name,target),{recursive:true});
}
const path=new URL('collaboration/runtime-config.js',target);
const fallback=await readFile(new URL('collaboration/runtime-config.js',root),'utf8');
await writeFile(path,config?'window.CAPSTONE_CONFIG=Object.freeze('+JSON.stringify(config)+');\n':fallback);
