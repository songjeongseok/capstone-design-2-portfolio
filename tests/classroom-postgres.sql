-- Only run in a new disposable database. Auth functions model validated JWT claims.
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql as $$ select current_setting('test.uid')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select current_setting('test.claims')::jsonb $$;
\ir ../supabase/classroom.sql
\ir ../supabase/classroom.sql
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111','faculty@example.invalid',now(),'{"name":"교수"}'),
 ('22222222-2222-4222-8222-222222222222','s1@example.invalid',now(),'{"name":"학생 1"}'),
 ('33333333-3333-4333-8333-333333333333','s2@example.invalid',now(),'{"name":"학생 2"}');
set test.claims='{"amr":[{"method":"otp"}]}';
set test.uid='11111111-1111-4111-8111-111111111111';
select public.capstone_workspace('me');
update capstone.members set role='instructor',status='active' where id=auth.uid();
set role authenticated;
set test.uid='22222222-2222-4222-8222-222222222222';
select public.capstone_workspace('me');
do $$begin
  begin perform public.capstone_workspace('list'); raise exception 'unexpected permission'; exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.capstone_review_job(text,jsonb)','execute') or has_schema_privilege('authenticated','capstone','usage') then raise exception 'private objects exposed'; end if;
end$$;
set test.uid='11111111-1111-4111-8111-111111111111';
select public.capstone_workspace('approve','{"id":"22222222-2222-4222-8222-222222222222"}');
set test.uid='22222222-2222-4222-8222-222222222222';
select set_config('test.record',public.capstone_workspace('create','{"week":15,"title":"초안","description":"남측 채광"}')->>'id',false);
select public.capstone_workspace('edit',jsonb_build_object('id',current_setting('test.record'),'expectedVersion',1,'week',15,'title','수정안','description','남측 채광 단면'));
select public.capstone_workspace('trash',jsonb_build_object('id',current_setting('test.record'),'expectedVersion',2));
select public.capstone_workspace('restore',jsonb_build_object('id',current_setting('test.record'),'expectedVersion',3));
do $$begin
 if jsonb_array_length(public.capstone_workspace('history',jsonb_build_object('id',current_setting('test.record'))))<>3 then raise exception 'history lost'; end if;
end$$;
set test.uid='33333333-3333-4333-8333-333333333333';
select public.capstone_workspace('me');
set test.uid='11111111-1111-4111-8111-111111111111';
select public.capstone_workspace('approve','{"id":"33333333-3333-4333-8333-333333333333"}');
set test.uid='33333333-3333-4333-8333-333333333333';
do $$declare rejected boolean:=false;begin
 begin perform public.capstone_workspace('review_input',jsonb_build_object('id',current_setting('test.record'),'expectedVersion',4));
 exception when raise_exception then rejected:=true; end;
 if not rejected or public.capstone_workspace('list')<>'[]'::jsonb then raise exception 'other student data visible'; end if;
end$$;
set test.uid='22222222-2222-4222-8222-222222222222';
select public.capstone_workspace('review_input',jsonb_build_object('id',current_setting('test.record'),'expectedVersion',4));
reset role;
set role service_role;
select set_config('test.job',public.capstone_review_job('start',jsonb_build_object('id',current_setting('test.record'),'owner',current_setting('test.uid'),'version',4))->>'job',false);
select public.capstone_review_job('finish',jsonb_build_object('job',current_setting('test.job'),'comment','단면 검토 의견'));
reset role;
set role authenticated;
do $$declare row_data jsonb:=public.capstone_workspace('list')->0;begin
 if row_data->>'reviewStatus'<>'succeeded' or (row_data->>'version')::int<>5 then raise exception 'review not saved'; end if;
end$$;
set test.claims='{"amr":[{"method":"password"}]}';
do $$begin
 begin perform public.capstone_workspace('me'); raise exception 'unexpected password session'; exception when insufficient_privilege then null; end;
end$$;
