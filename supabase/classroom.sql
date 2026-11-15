-- Run once (safe to reapply) in the dedicated course project's Supabase SQL Editor.
begin;
create schema if not exists capstone;
revoke all on schema capstone from public, anon, authenticated;
create table if not exists capstone.members (
  id uuid primary key references auth.users(id), email text not null,
  name text not null, role text not null default 'student' check(role in ('student','instructor')),
  status text not null default 'pending' check(status in ('pending','active'))
);
create table if not exists capstone.records (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references capstone.members(id),
  version integer not null default 1, body jsonb not null, import_key text,
  unique(owner_id,import_key)
);
create index if not exists capstone_records_by_owner on capstone.records(owner_id,id);
create table if not exists capstone.history (
  record_id uuid references capstone.records(id), version integer not null,
  snapshot jsonb not null, primary key(record_id,version)
);
create table if not exists capstone.review_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, record_id uuid not null,
  version integer not null, started_at timestamptz not null default now(), state text not null
);
create index if not exists capstone_jobs_by_owner on capstone.review_jobs(owner_id,started_at);
alter table capstone.members enable row level security;
alter table capstone.records enable row level security;
alter table capstone.history enable row level security;
alter table capstone.review_jobs enable row level security;
revoke all on all tables in schema capstone from public,anon,authenticated;

create or replace function capstone.member_json(m capstone.members) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',m.id,'studentId',m.id,'name',m.name,'email',m.email,'role',m.role,'status',m.status)
$$;
create or replace function capstone.record_json(r capstone.records) returns jsonb
language sql stable set search_path='' as $$
  select (r.body-'legacyHistory') || jsonb_build_object('id',r.id,'studentId',r.owner_id,'version',r.version)
$$;
create or replace function capstone.design_fields(v jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare img text:=nullif(v->>'imageUrl',''); w int:=(v->>'week')::int;
  t text:=trim(v->>'title'); d text:=trim(v->>'description'); raw bytea; mimetype text;
begin
  if w is null or w not between 1 and 99 or coalesce(length(t),0) not between 1 and 200
    or coalesce(length(d),0) not between 1 and 30000 then raise exception '주차·제목·설명을 확인하세요.'; end if;
  if img is not null then
    if length(img)>2796250 or img !~ '^data:image/(png|jpeg|webp);base64,' then raise exception '이미지 형식 또는 크기 오류'; end if;
    mimetype:=split_part(split_part(img,';',1),'/',2);
    raw:=decode(split_part(img,',',2),'base64');
    if octet_length(raw)>2097152 or not (case mimetype
      when 'png' then substring(raw from 1 for 8)=decode('89504e470d0a1a0a','hex')
      when 'jpeg' then substring(raw from 1 for 3)=decode('ffd8ff','hex')
      when 'webp' then substring(raw from 1 for 4)=decode('52494646','hex') and substring(raw from 9 for 4)=decode('57454250','hex')
      else false end) then raise exception '이미지 내용을 확인하세요.'; end if;
  end if;
  return jsonb_build_object('week',w,'title',t,'description',d,'imageUrl',img);
end $$;
create or replace function capstone.remember() returns trigger
language plpgsql set search_path='' as $$
begin
  insert into capstone.history values(old.id,old.version,capstone.record_json(old));
  new.version:=old.version+1;
  new.body:=new.body||jsonb_build_object('updatedAt',floor(extract(epoch from now())*1000)::bigint);
  return new;
end $$;
drop trigger if exists keep_version on capstone.records;
create trigger keep_version before update on capstone.records for each row execute function capstone.remember();

create or replace function public.capstone_workspace(op text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); m capstone.members; r capstone.records; stamp bigint:=floor(extract(epoch from now())*1000)::bigint;
  mail text; display_name text; result jsonb; item jsonb; entry jsonb; addition jsonb; changed int; imported int:=0;
begin
  if uid is null or not coalesce((auth.jwt()->'amr') @> '[{"method":"otp"}]'::jsonb,false) then
    raise exception using errcode='42501',message='이메일 인증번호로 다시 로그인하세요.';
  end if;
  select lower(u.email),coalesce(nullif(left(trim(u.raw_user_meta_data->>'name'),80),''),split_part(u.email,'@',1))
    into mail,display_name from auth.users u where u.id=uid and u.email_confirmed_at is not null;
  if mail is null then raise exception using errcode='42501',message='이메일 인증이 필요합니다.'; end if;
  if op='me' then
    insert into capstone.members(id,email,name) values(uid,mail,display_name) on conflict(id) do nothing;
  end if;
  select * into m from capstone.members where id=uid;
  if m.id is null then raise exception '먼저 로그인하세요.'; end if;
  if op='me' then return capstone.member_json(m); end if;
  if m.status<>'active' then raise exception using errcode='42501',message='담당 교수자 승인 대기 중입니다.'; end if;
  case op
  when 'members' then
    select coalesce(jsonb_agg(capstone.member_json(s) order by s.name,s.id),'[]') into result
      from capstone.members s where (m.role='instructor' and s.role='student') or s.id=uid;
    return result;
  when 'approve' then
    if m.role<>'instructor' then raise exception using errcode='42501',message='교수자 승인 권한이 필요합니다.'; end if;
    update capstone.members set status='active' where id=(p->>'id')::uuid and role='student';
    if not found then raise exception '학생을 찾을 수 없습니다.'; end if;
    return '{"ok":true}';
  when 'list' then
    if coalesce((p->>'all')::boolean,false) and m.role<>'instructor' then raise exception using errcode='42501',message='교수자 권한이 필요합니다.'; end if;
    select coalesce(jsonb_agg(page.data order by page.id),'[]') into result from (
      select s.id,capstone.record_json(s) as data from capstone.records s
      where (s.owner_id=uid or (m.role='instructor' and (p->>'all')::boolean))
        and ((s.body->>'deletedAt') is not null)=coalesce((p->>'trash')::boolean,false)
        and (p->>'after' is null or s.id>(p->>'after')::uuid)
      order by s.id limit 4
    ) page;
    return result;
  when 'create' then
    insert into capstone.records(owner_id,body) values(uid,capstone.design_fields(p)||
      jsonb_build_object('createdAt',stamp,'updatedAt',stamp,'deletedAt',null,'reviewStatus','unreviewed','aiComment',''))
      returning * into r;
    return capstone.record_json(r);
  when 'import' then
    if lower(p->>'email') is distinct from mail or jsonb_typeof(p->'records') is distinct from 'array' then raise exception '개인 백업 형식 오류'; end if;
    for item in select value from jsonb_array_elements(p->'records') loop
      if coalesce(length(item->>'key'),0) not between 1 and 500 then raise exception '백업 식별자 오류'; end if;
      entry:=capstone.design_fields(item);
      if jsonb_typeof(item->'history') is distinct from 'array' then raise exception '수정 이력 형식 오류'; end if;
      addition:=jsonb_build_object('createdAt',coalesce((item->>'createdAt')::bigint,stamp),'updatedAt',stamp,
        'deletedAt',(item->>'deletedAt')::bigint,'legacyHistory',item->'history','aiComment',left(coalesce(item->>'aiComment',''),30000),
        'reviewStatus',case when coalesce(item->>'aiComment','')='' then 'unreviewed' else 'legacy-unverified' end);
      insert into capstone.records(owner_id,body,import_key) values(uid,entry||addition,item->>'key')
        on conflict(owner_id,import_key) do nothing;
      get diagnostics changed=row_count; imported:=imported+changed;
    end loop;
    return jsonb_build_object('count',imported);
  else
    select * into r from capstone.records where id=(p->>'id')::uuid and
      (owner_id=uid or (op='history' and m.role='instructor')) for update;
    if r.id is null then raise exception '기록을 찾을 수 없습니다.'; end if;
    if op='history' then
      select coalesce(jsonb_agg(h.snapshot order by h.version),'[]') into result from capstone.history h where h.record_id=r.id;
      return coalesce(r.body->'legacyHistory','[]')||result;
    end if;
    if r.version is distinct from (p->>'expectedVersion')::int then raise exception '다른 창에서 변경된 기록입니다. 새로고침하세요.'; end if;
    if op='review_input' and r.body->>'deletedAt' is null then
      return jsonb_build_object('owner',uid,'title',r.body->>'title','description',r.body->>'description');
    elsif op='edit' and r.body->>'deletedAt' is null then
      addition:=capstone.design_fields(p)||'{"reviewStatus":"stale"}'::jsonb;
    elsif op='trash' then addition:=jsonb_build_object('deletedAt',stamp);
    elsif op='restore' then addition:='{"deletedAt":null}'::jsonb;
    else raise exception '현재 상태에서 요청할 수 없습니다.'; end if;
    update capstone.records set body=body||addition where id=r.id returning * into r;
    return capstone.record_json(r);
  end case;
end $$;
revoke all on function public.capstone_workspace(text,jsonb) from public,anon,service_role;
grant execute on function public.capstone_workspace(text,jsonb) to authenticated;

create or replace function public.capstone_review_job(op text, p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r capstone.records; j capstone.review_jobs; memo text;
begin
  if op='start' then
    perform pg_advisory_xact_lock(hashtextextended(p->>'owner',0));
    select * into r from capstone.records where id=(p->>'id')::uuid and owner_id=(p->>'owner')::uuid for update;
    if r.id is null or r.version is distinct from (p->>'version')::int or r.body->>'deletedAt' is not null then raise exception '기록이 변경되었습니다.'; end if;
    if exists(select 1 from capstone.review_jobs where record_id=r.id and version=r.version and state='running' and started_at>now()-interval '2 minutes') then raise exception '이미 검토 중입니다.'; end if;
    if (select count(*) from capstone.review_jobs where owner_id=r.owner_id and started_at>now()-interval '24 hours')>=5 then raise exception '24시간 동안 최대 5회 검토할 수 있습니다.'; end if;
    insert into capstone.review_jobs(owner_id,record_id,version,state) values(r.owner_id,r.id,r.version,'running') returning * into j;
    return jsonb_build_object('job',j.id);
  end if;
  select * into j from capstone.review_jobs where id=(p->>'job')::uuid and state='running' for update;
  if j.id is null then raise exception '검토 요청을 찾을 수 없습니다.'; end if;
  if op='fail' then update capstone.review_jobs set state='failed' where id=j.id; return '{"saved":false}'; end if;
  memo:=trim(p->>'comment');
  if op<>'finish' or coalesce(length(memo),0) not between 1 and 12000 then raise exception '검토 응답 오류'; end if;
  update capstone.records set body=body||jsonb_build_object('reviewStatus','succeeded','aiComment',memo)
    where id=j.record_id and version=j.version and body->>'deletedAt' is null;
  if not found then update capstone.review_jobs set state='stale' where id=j.id; return '{"saved":false}'; end if;
  update capstone.review_jobs set state='done' where id=j.id;
  return '{"saved":true}';
end $$;
revoke all on function public.capstone_review_job(text,jsonb) from public,anon,authenticated;
grant execute on function public.capstone_review_job(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
