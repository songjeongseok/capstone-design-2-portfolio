// Read-only preparation. Never writes/removes any legacy localStorage key.
export const LEGACY_KEYS = [
  'dku_capstone_students_v1', 'dku_current_student',
  'dku_local_uploads_v1', 'dku_deleted_uploads_v1'
];
export function snapshotLegacy(storage) {
  return { schemaVersion: 1, capturedAt: new Date().toISOString(),
    raw: Object.fromEntries(LEGACY_KEYS.map(key => [key, storage.getItem(key)])) };
}
function arrayFrom(snapshot, key) {
  const value = JSON.parse(snapshot.raw[key] ?? '[]');
  if (!Array.isArray(value)) throw new Error(`${key}: 배열 형식이 아닙니다. 가져오기를 중단합니다.`);
  return value;
}
export async function prepareMigration(snapshot) {
  const members = arrayFrom(snapshot, LEGACY_KEYS[0]);
  const rows = arrayFrom(snapshot, LEGACY_KEYS[2]);
  const tombstones = arrayFrom(snapshot, LEGACY_KEYS[3]);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(snapshot.raw))))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const validDeleted = new Set(tombstones.filter(id=>typeof id==='string' && id && id!=='undefined'));
  const issues = tombstones.filter(id=>typeof id!=='string' || !id || id==='undefined')
    .map(value=>({type:'ambiguous-deletion', value, action:'담당자가 원본과 대조해야 함'}));
  const seen = new Set(rows.filter(r=>r && typeof r.id==='string' && r.id).map(r=>r.id));
  const used = new Set();
  const records = rows.map((row, index) => {
    if (!row || typeof row!=='object' || Array.isArray(row)) throw new Error(`기록 ${index}: 형식 오류`);
    let id = typeof row.id==='string' && row.id && row.id!=='undefined' ? row.id : null;
    if (!id || used.has(id)) {
      issues.push({type:id?'duplicate-id':'missing-id',index,oldId:id});
      let suffix=0;
      const prefix=`legacy_${digest}_${index}`;
      id=prefix;
      while (seen.has(id) || used.has(id)) id=`${prefix}_${++suffix}`;
    }
    used.add(id);
    if (!Number.isInteger(row.week) || row.week<1) issues.push({type:'invalid-week',index,value:row.week});
    return {...row,id, legacyId:row.id ?? null, legacyIndex:index,
      source:'legacy-local', deleted:validDeleted.has(row.id),
      reviewStatus:row.aiComment?'legacy-unverified':'not-configured'};
  });
  return {schemaVersion:2, sourceDigest:digest, records, issues,
    // Never send legacy password hashes or unverified browser sessions to the new auth service.
    memberMappingCandidates:members.map(({name,email,studentId,signupOrder})=>({name,email,legacyArchiveId:studentId,signupOrder})),
    counts:{source:rows.length,prepared:records.length,deleted:records.filter(r=>r.deleted).length}};
}
export function downloadSnapshot(snapshot) {
  // Contains private data and hashes: keep offline; never commit this backup to GitHub.
  const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url; a.download='capstone-private-local-backup.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
