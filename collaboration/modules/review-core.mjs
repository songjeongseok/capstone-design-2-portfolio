const recordSpecs={
  s1_w1_sample:'대상지 286㎡ · 1980년대 인쇄소 · 철골 프레임/북측 채광창 보존',
  s1_w2_sample:'건폐율 70% · 공용 마당 3.6m · 오픈 스튜디오/재료 보관/전시 벽',
  s1_w3_sample:'공용 작업실 4.2m · 집중 작업실 2.7m · 채광 우물 · 흡음 패널',
  s1_w4_sample:'노출 콘크리트 · 자작나무 합판 · 청회색 리놀륨 · 폴리카보네이트',
  s2_w1_sample:'유휴 1층 198㎡ · 기존 기둥 간격 4.8m · 커뮤니티 키친/학습 코너',
  s2_w2_sample:'주민/어린이/반입 3중 동선 · 시선축 12m · 피크타임 20명 · 무장애 회전',
  s2_w3_sample:'남향 창 · 외부 롤스크린 · 열회수 환기 · 재활용 유리 타일 · 저VOC 도장'
};
const reviewRules={
  spatial:{label:'공간 구성',weight:.25,terms:['대지','면적','프로그램','배치','공용','작업실','공간']},
  circulation:{label:'동선·무장애',weight:.20,terms:['동선','시선축','출입','반입','회전','폭','휠체어','접근']},
  technical:{label:'구조·시공',weight:.20,terms:['구조','기둥','철골','단면','접합','프레임','치수','모듈']},
  environment:{label:'환경·재료',weight:.20,terms:['채광','일사','환기','흡음','재료','콘크리트','저VOC','에너지']},
  evidence:{label:'검증 근거',weight:.15,terms:['㎡','m','%','1:','수치','기준','피크타임','인증']}
};
function analyzeRecord(u){
  const text=`${u.title||''} ${u.description||''} ${recordSpecs[u.id]||''}`.toLowerCase();
  const result={};let total=0,evidence=0;
  Object.entries(reviewRules).forEach(([key,rule])=>{const hits=rule.terms.filter(t=>text.includes(t.toLowerCase())).length;const score=Math.min(96,Math.round(44+hits*10+(text.length>180?8:0)));result[key]={score,hits};total+=score*rule.weight;if(key==='evidence')evidence=hits});
  const lowest=Object.entries(result).sort((a,b)=>a[1].score-b[1].score)[0][0];
  return {scores:result,total:Math.round(total),evidence,weakest:reviewRules[lowest].label,priority:result[lowest].score<65?'높음':result[lowest].score<78?'중간':'낮음'};
}
function aggregateReviews(uploads){
  if(!uploads.length)return {total:0,evidence:0,weakest:'자료 없음',priority:'높음',scores:{}};
  const analyses=uploads.map(analyzeRecord),scores={};Object.keys(reviewRules).forEach(k=>scores[k]=Math.round(analyses.reduce((sum,a)=>sum+a.scores[k].score,0)/analyses.length));
  const weak=Object.entries(scores).sort((a,b)=>a[1]-b[1])[0][0];
  return {total:Math.round(analyses.reduce((sum,a)=>sum+a.total,0)/analyses.length),evidence:analyses.reduce((sum,a)=>sum+a.evidence,0),weakest:reviewRules[weak].label,priority:scores[weak]<65?'높음':scores[weak]<78?'중간':'낮음',scores};
}

export { recordSpecs, reviewRules, analyzeRecord, aggregateReviews };
