begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- These helpers and fixtures exist only inside the rollback-only test transaction.
create function public.bren_test_login(who uuid, token_role text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  perform set_config('request.jwt.claim.role', token_role, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', token_role)::text, true);
end;
$$;
grant execute on function public.bren_test_login(uuid, text) to anon, authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-4000-8000-000000000001', 'pgtap-topup-owner@example.invalid', '{"name":"Owner"}'),
  ('c0000000-0000-4000-8000-000000000002', 'pgtap-topup-customer@example.invalid', '{"name":"Customer"}');
insert into bren_private.bren_staff (id, role, active)
  values ('c0000000-0000-4000-8000-000000000001', 'owner', true);
insert into bren_private.bren_categories (id, name, slug)
  values ('c1000000-0000-4000-8000-000000000001', 'Gaming', 'pgtap-topup-gaming');
insert into bren_private.bren_plans (id, name, slug, description, category_id, brand_key, initial,
  color_start, color_end, usd_minor, etb_minor, billing_days, status, capacity, kind, provider_package_id)
values
  ('d0000000-0000-4000-8000-000000000001', 'FF 100 Diamonds', 'pgtap-ff-100', 'Instant top-up',
    'c1000000-0000-4000-8000-000000000001', 'free-fire-diamonds', 'FF', '#b45309', '#78350f',
    250, 30000, 1, 'active', 0, 'topup', '6'),
  ('d0000000-0000-4000-8000-000000000002', 'Seat plan', 'pgtap-seat', 'Shared subscription',
    'c1000000-0000-4000-8000-000000000001', 'test', 'S', '#112233', '#445566',
    250, 30000, 30, 'active', 3, 'seat', null);

-- Schema invariants.
select throws_ok($x$insert into bren_private.bren_plans (name, slug, brand_key, initial, color_start,
    color_end, billing_days, kind) values ('Bad', 'pgtap-bad', 'test', 'B', '#112233', '#445566', 1, 'topup')$x$,
  '23514', null, 'Top-up plans must link a provider package');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'bren_private' and c.relname = 'bren_topup_deliveries'),
  'Delivery tracking enforces row-level security');
select ok(not has_table_privilege('anon', 'bren_private.bren_topup_deliveries', 'SELECT'),
  'Anonymous cannot read deliveries');
select ok(not has_table_privilege('authenticated', 'bren_private.bren_topup_deliveries', 'SELECT'),
  'Authenticated cannot read deliveries');
select ok(not has_table_privilege('service_role', 'bren_private.bren_topup_deliveries', 'SELECT'),
  'Service role reads deliveries only through guarded functions');

-- Service-only function privileges.
select ok(not has_function_privilege('anon', 'public.bren_topup_pending(uuid, boolean)', 'EXECUTE'),
  'Anonymous cannot read the top-up queue');
select ok(not has_function_privilege('authenticated', 'public.bren_topup_pending(uuid, boolean)', 'EXECUTE'),
  'Authenticated cannot read the top-up queue');
select ok(has_function_privilege('service_role', 'public.bren_topup_pending(uuid, boolean)', 'EXECUTE'),
  'Service role reads the top-up queue');
select ok(not has_function_privilege('authenticated', 'public.bren_topup_started(uuid, text)', 'EXECUTE'),
  'Authenticated cannot start deliveries');
select ok(has_function_privilege('service_role', 'public.bren_topup_started(uuid, text)', 'EXECUTE'),
  'Service role starts deliveries');
select ok(not has_function_privilege('authenticated', 'public.bren_topup_finished(uuid, boolean, text)', 'EXECUTE'),
  'Authenticated cannot finish deliveries');
select ok(has_function_privilege('service_role', 'public.bren_topup_finished(uuid, boolean, text)', 'EXECUTE'),
  'Service role finishes deliveries');

-- Public catalog exposes kind but never provider linkage, and top-ups show no seat availability.
select is((select value ->> 'kind' from jsonb_array_elements(public.bren_read('catalog', '{}'::jsonb)) value
  where value ->> 'id' = 'd0000000-0000-4000-8000-000000000001'), 'topup', 'Catalog marks the plan as a top-up');
select is((select (value -> 'available') = 'null'::jsonb from jsonb_array_elements(public.bren_read('catalog', '{}'::jsonb)) value
  where value ->> 'id' = 'd0000000-0000-4000-8000-000000000001'), true, 'Catalog lists top-ups without seat availability');
select is((select coalesce(bool_and(not (value ? 'provider_package_id')), true)
  from jsonb_array_elements(public.bren_read('catalog', '{}'::jsonb))),
  true, 'Public catalog never exposes provider package linkage');

-- Customer order placement rules.
set local role authenticated;
select bren_test_login('c0000000-0000-4000-8000-000000000002');
select throws_ok($x$select public.bren_mutate('create_order', jsonb_build_object('idempotency_key',
    'e0000000-0000-4000-8000-000000000001', 'currency', 'USD', 'name', 'Customer', 'phone', '+251900000000',
    'items', jsonb_build_array(jsonb_build_object('plan_id', 'd0000000-0000-4000-8000-000000000001', 'qty', 2, 'unit_minor', 250))))$x$,
  '22023', 'A numeric player ID of 6 to 20 digits is required for top-up plans.', 'Top-up orders require a player ID');
select throws_ok($x$select public.bren_mutate('create_order', jsonb_build_object('idempotency_key',
    'e0000000-0000-4000-8000-000000000002', 'currency', 'USD', 'name', 'Customer', 'phone', '+251900000000',
    'items', jsonb_build_array(
      jsonb_build_object('plan_id', 'd0000000-0000-4000-8000-000000000001', 'qty', 1, 'unit_minor', 250, 'player_id', '123456789'),
      jsonb_build_object('plan_id', 'd0000000-0000-4000-8000-000000000002', 'qty', 1, 'unit_minor', 250))))$x$,
  '23514', 'Top-up and subscription plans must be ordered separately.', 'Mixed top-up and seat orders are rejected');
select lives_ok($x$select public.bren_mutate('create_order', jsonb_build_object('idempotency_key',
    'e0000000-0000-4000-8000-000000000003', 'currency', 'USD', 'name', 'Customer', 'phone', '+251900000000',
    'items', jsonb_build_array(jsonb_build_object('plan_id', 'd0000000-0000-4000-8000-000000000001', 'qty', 2, 'unit_minor', 250, 'player_id', '123456789'))))$x$,
  'Customer places a two-unit top-up order');
reset role;
select is((select player_id from bren_private.bren_order_items where plan_id = 'd0000000-0000-4000-8000-000000000001'),
  '123456789', 'The player ID snapshot is stored on the immutable order item');

-- Payment confirmation queues per-unit deliveries instead of seat allocations.
set local role authenticated;
select bren_test_login('c0000000-0000-4000-8000-000000000001');
select lives_ok($x$select public.bren_mutate('confirm_payment', jsonb_build_object('id',
    (select id from bren_private.bren_orders where idempotency_key = 'e0000000-0000-4000-8000-000000000003'),
    'reference', 'pgtap-reference', 'amount_minor', 500, 'currency', 'USD'))$x$,
  'Owner confirms the verified payment');
reset role;
select is((select count(*)::integer from bren_private.bren_topup_deliveries where status = 'queued'),
  2, 'Confirmation queues one delivery per unit');
select is((select count(*)::integer from bren_private.bren_allocations),
  0, 'Top-up confirmation creates no seat allocations');

-- Service-role delivery flow fulfills the order automatically.
select bren_test_login(null, 'service_role');
select throws_ok($x$select public.bren_topup_pending('c0000000-0000-4000-8000-000000000099', false)$x$,
  'P0002', 'Order not found.', 'Queue lookup rejects unknown orders');
select lives_ok($x$select public.bren_topup_pending(
    (select id from bren_private.bren_orders where idempotency_key = 'e0000000-0000-4000-8000-000000000003'), false)$x$,
  'Service role reads the queued deliveries');
select lives_ok($x$select public.bren_topup_started(d.id, 'pgtap-provider-1')
    from bren_private.bren_topup_deliveries d where d.unit_index = 1$x$,
  'First unit starts with a provider order id');
select lives_ok($x$select public.bren_topup_finished(d.id, true, '')
    from bren_private.bren_topup_deliveries d where d.unit_index = 1$x$,
  'First unit completes');
select is((select status from bren_private.bren_orders where idempotency_key = 'e0000000-0000-4000-8000-000000000003'),
  'paid', 'Order stays paid until every unit is delivered');
select lives_ok($x$select public.bren_topup_started(d.id, 'pgtap-provider-2')
    from bren_private.bren_topup_deliveries d where d.unit_index = 2$x$,
  'Second unit starts');
select lives_ok($x$select public.bren_topup_finished(d.id, true, '')
    from bren_private.bren_topup_deliveries d where d.unit_index = 2$x$,
  'Second unit completes');
select is((select status from bren_private.bren_orders where idempotency_key = 'e0000000-0000-4000-8000-000000000003'),
  'fulfilled', 'The order fulfills automatically when the last unit delivers');
select is((select count(*)::integer from bren_private.bren_order_events where action = 'topup_delivered'),
  2, 'Each delivered unit is recorded on the order timeline');
select is((select count(*)::integer from bren_private.bren_activity where action = 'topup_order_fulfilled'),
  1, 'Automatic fulfillment writes one audit entry');

-- Browser tokens cannot use the delivery workflow even though the guard passes role checks.
-- (The revoked EXECUTE grant rejects the call before or regardless of the in-function guard.)
set local role authenticated;
select bren_test_login('c0000000-0000-4000-8000-000000000001');
select throws_ok($x$select public.bren_topup_pending(
    (select id from bren_private.bren_orders where idempotency_key = 'e0000000-0000-4000-8000-000000000003'), false)$x$,
  '42501', null, 'Owner browser sessions cannot read the delivery queue');

select * from finish();
rollback;
