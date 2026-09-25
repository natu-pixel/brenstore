begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('b0000000-0000-4000-8000-000000000001', 'bootstrap-unconfirmed@example.invalid', null, '{"name":"Unconfirmed"}'),
  ('b0000000-0000-4000-8000-000000000002', 'bootstrap-owner@example.invalid', now(), '{"name":"Confirmed"}'),
  ('b0000000-0000-4000-8000-000000000003', 'bootstrap-other@example.invalid', now(), '{"name":"Other"}');

select ok(has_function_privilege('postgres', 'bren_private.bootstrap_owner(uuid)', 'EXECUTE'),
  'Postgres can execute deliberate bootstrap');
select ok(not has_function_privilege('anon', 'bren_private.bootstrap_owner(uuid)', 'EXECUTE'),
  'Anonymous cannot execute bootstrap');
select ok(not has_function_privilege('authenticated', 'bren_private.bootstrap_owner(uuid)', 'EXECUTE'),
  'Authenticated cannot execute bootstrap');
select ok(not has_function_privilege('service_role', 'bren_private.bootstrap_owner(uuid)', 'EXECUTE'),
  'Service role cannot execute bootstrap');
select throws_ok($$select bren_private.bootstrap_owner('b0000000-0000-4000-8000-000000000099')$$,
  '22023', 'Auth user does not exist.', 'Bootstrap rejects nonexistent Auth identity');
select throws_ok($$select bren_private.bootstrap_owner(null)$$,
  '22023', 'Auth user does not exist.', 'Bootstrap rejects missing identity');
select throws_ok($$select bren_private.bootstrap_owner('b0000000-0000-4000-8000-000000000001')$$,
  '23514', 'Owner bootstrap requires a confirmed email.', 'Bootstrap rejects unconfirmed email');
select is((select count(*)::integer from bren_private.bren_staff), 0, 'Rejected bootstrap leaves staff empty');
select lives_ok($$select bren_private.bootstrap_owner('b0000000-0000-4000-8000-000000000002')$$,
  'Confirmed Auth user can deliberately bootstrap first owner');
select is((select role from bren_private.bren_staff where id='b0000000-0000-4000-8000-000000000002'),
  'owner', 'Bootstrap assigns owner role');
select ok((select active from bren_private.bren_staff where id='b0000000-0000-4000-8000-000000000002'),
  'Bootstrapped owner is active');
select is((select count(*)::integer from bren_private.bren_activity where action='owner_bootstrap'
  and actor_id='b0000000-0000-4000-8000-000000000002' and entity_id=actor_id),
  1, 'Bootstrap records an immutable attributed audit');
select throws_ok($$select bren_private.bootstrap_owner('b0000000-0000-4000-8000-000000000003')$$,
  '23514', 'An active owner already exists.', 'Bootstrap cannot grant another owner');
select throws_ok($$select bren_private.bootstrap_owner('b0000000-0000-4000-8000-000000000002')$$,
  '23514', 'An active owner already exists.', 'Bootstrap retries cannot create duplicate grants or audits');
select is((select count(*)::integer from bren_private.bren_activity where action='owner_bootstrap'), 1,
  'Failed repeat bootstrap creates no audit');

select * from finish();
rollback;
