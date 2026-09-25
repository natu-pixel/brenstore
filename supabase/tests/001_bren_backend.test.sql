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
create function public.bren_test_plan(plan_id uuid, plan_name text default 'Plan A',
  price bigint default 1250, plan_status text default 'active') returns jsonb
language sql as $$
  select jsonb_build_object('id', plan_id, 'name', plan_name, 'slug', 'test-' || plan_id::text,
    'description', 'Original description', 'category_id', '10000000-0000-4000-8000-000000000001',
    'brand_key', 'test', 'initial', 'T', 'color_start', '#112233', 'color_end', '#445566',
    'usd_minor', price, 'etb_minor', 50000, 'usd_compare_minor', null, 'etb_compare_minor', null,
    'billing_days', 30, 'status', plan_status, 'featured', false, 'low_stock_threshold', 2)
$$;
grant execute on function public.bren_test_plan(uuid, text, bigint, text) to authenticated;
create function public.bren_test_order(order_key uuid, plan_id uuid default '20000000-0000-4000-8000-000000000001',
  quantity integer default 1, price bigint default 1250) returns jsonb
language sql as $$
  select jsonb_build_object('idempotency_key', order_key, 'currency', 'USD', 'name', 'Customer A',
    'phone', '+251900000000', 'telegram', '@customer',
    'items', jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'qty', quantity, 'unit_minor', price)))
$$;
grant execute on function public.bren_test_order(uuid, uuid, integer, bigint) to authenticated;
create table public.bren_test_ids (key text primary key, id uuid not null);
grant select, insert on public.bren_test_ids to authenticated;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'bren-test-owner@example.invalid', '{"full_name":"Owner"}'),
  ('a0000000-0000-4000-8000-000000000002', 'bren-test-manager@example.invalid', '{"name":"Manager"}'),
  ('a0000000-0000-4000-8000-000000000003', 'bren-test-support@example.invalid', '{"name":"Support"}'),
  ('a0000000-0000-4000-8000-000000000004', 'bren-test-suspended@example.invalid', '{"name":"Suspended"}'),
  ('a0000000-0000-4000-8000-000000000005', 'bren-test-customer-a@example.invalid', '{"name":"Customer A","role":"owner"}'),
  ('a0000000-0000-4000-8000-000000000006', 'bren-test-customer-b@example.invalid', '{"name":"Customer B"}'),
  ('a0000000-0000-4000-8000-000000000007', 'bren-test-invite@example.invalid', '{"name":"Invited"}');
insert into bren_private.bren_staff (id, role, active)
values
  ('a0000000-0000-4000-8000-000000000001', 'owner', true),
  ('a0000000-0000-4000-8000-000000000002', 'manager', true),
  ('a0000000-0000-4000-8000-000000000003', 'support', true),
  ('a0000000-0000-4000-8000-000000000004', 'owner', false);
insert into bren_private.bren_categories (id, name, slug)
  values ('10000000-0000-4000-8000-000000000001', 'Category A', 'bren-test-category');
insert into bren_private.bren_plans (id, name, slug, description, category_id, brand_key, initial,
  color_start, color_end, usd_minor, etb_minor, billing_days, status, capacity)
values
  ('20000000-0000-4000-8000-000000000001', 'Plan A', 'bren-test-plan-a', 'Original description',
    '10000000-0000-4000-8000-000000000001', 'test', 'T', '#112233', '#445566', 1250, 50000, 30, 'active', 5),
  ('20000000-0000-4000-8000-000000000002', 'Plan B', 'bren-test-plan-b', 'Second description',
    '10000000-0000-4000-8000-000000000001', 'test', 'T', '#112233', '#445566', 2000, 90000, 60, 'active', 1),
  ('20000000-0000-4000-8000-000000000003', 'Draft', 'bren-test-draft', '',
    null, 'test', 'T', '#112233', '#445566', null, null, 30, 'draft', 0);

select ok((select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'bren_private' and c.relkind = 'r'), 'RLS enabled on every private table');
select is((select count(*)::integer from bren_private.bren_profiles
  where id::text like 'a0000000-%'), 7, 'Auth trigger creates profiles');
select ok(not exists (select 1 from bren_private.bren_staff
  where id = 'a0000000-0000-4000-8000-000000000005'), 'Auth metadata cannot grant owner');
select ok(not has_function_privilege('authenticated', 'public.bren_register_staff(uuid,text,uuid)', 'EXECUTE'),
  'Registration helper is not executable by authenticated');
select ok(not has_function_privilege('anon', 'public.bren_staff_lookup_email(text)', 'EXECUTE'),
  'Lookup helper is not executable by anonymous');

set local role anon;
select bren_test_login(null, 'anon');
select is(jsonb_array_length(bren_read('catalog')), 2, 'Anonymous catalog contains only active plans');
select is(jsonb_typeof(bren_read('catalog') -> 0 -> 'usd_minor'), 'number', 'Money is a JSON number');
select ok(bren_read('catalog') -> 0 ? 'usd_compare_minor', 'Nullable plan keys are present');
select ok(not ((bren_read('catalog') -> 0) ? 'customer_id'), 'Catalog contains no customer data');
select is(jsonb_array_length(bren_read('public_categories')), 1, 'Active categories are public');
select ok(not (bren_read('public_settings') ? 'manual_payment_instructions'), 'Public settings exclude payment instructions');
select throws_ok($$select bren_read('profile')$$, '42501', 'Authentication required.', 'Anonymous profile denied');
select throws_ok($$select bren_read('orders')$$, '42501', 'Authentication required.', 'Anonymous orders denied');
select throws_ok($$select bren_read('payment_instructions')$$, '42501', 'Authentication required.', 'Anonymous payment instructions denied');
select throws_ok($$select bren_mutate('create_order', '{}')$$, '42501', null, 'Anonymous mutation denied');
select throws_ok($$select * from bren_private.bren_profiles$$, '42501', null, 'Anonymous direct table reads denied');
select throws_ok($$insert into bren_private.bren_categories (name,slug) values ('X','x')$$,
  '42501', null, 'Anonymous direct DML denied');
reset role;

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000005');
select is(bren_my_role(), null::text, 'Customer role is null, ignoring malicious metadata');
select is(bren_read('profile') ->> 'email', 'bren-test-customer-a@example.invalid', 'Customer reads own profile');
select lives_ok($$select bren_read('payment_instructions')$$, 'Customer may read payment instructions');
select throws_ok($$select bren_read('dashboard')$$, '42501', 'Permission denied.', 'Customer dashboard denied');
select throws_ok($$select bren_read('customers')$$, '42501', 'Permission denied.', 'Customer directory denied');
select throws_ok($$select bren_read('team')$$, '42501', 'Permission denied.', 'Customer team denied');
select throws_ok($$select bren_read('plans')$$, '42501', 'Permission denied.', 'Customer admin plans denied');
select throws_ok($$select bren_mutate('save_profile', '{"name":"X","phone":"","telegram":"","role":"owner"}')$$,
  '22023', 'Unexpected input field.', 'Profile cannot set a role');
select throws_ok($$update bren_private.bren_staff set role='owner'$$,
  '42501', null, 'Customer direct staff updates denied');
select throws_ok($$select bren_register_staff('a0000000-0000-4000-8000-000000000005','owner',
  'a0000000-0000-4000-8000-000000000001')$$, '42501', null, 'Customer cannot call privileged registration');
select lives_ok($$select bren_mutate('save_profile', '{"name":"Customer A saved","phone":"123","telegram":"@a"}')$$,
  'Customer saves allowed profile fields');
select is(bren_read('profile') ->> 'name', 'Customer A saved', 'Profile persisted');
select throws_ok($$select bren_read('my_orders', '{"page_size":101}')$$,
  '22023', 'page_size is out of range.', 'Page size capped at 100');
select throws_ok($$select bren_read('my_orders', '{"page":0}')$$,
  '22023', 'page is out of range.', 'Page must be positive');
select throws_ok($$select bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 0))$$, '22023', 'qty is out of range.', 'Zero quantity rejected');
select throws_ok($$select bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 10))$$, '22023', 'qty is out of range.', 'Quantity above nine rejected');
select throws_ok($$select bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000001'),
  '{items,0,qty}', '1.5'))$$, '22023', 'qty is out of range.', 'Fractional quantity rejected');
select throws_ok($$select bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000001'),
  '{items,0,unit_minor}', '"1250"'))$$, '22023', 'unit_minor must be an integer.', 'String money rejected');
select throws_ok($$select bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 1, -1))$$,
  '22023', 'unit_minor is out of range.', 'Negative price rejected');
select throws_ok($$select bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 1, 1000000000001))$$,
  '22023', 'unit_minor is out of range.', 'Unsafe price bound rejected');
select throws_ok($$select bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 1, 1200))$$,
  '23514', 'A price changed. Review your cart before submitting again.', 'Stale quote rejected');
select throws_ok($$select bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000001'),
  '{currency}', '"EUR"'))$$, '22023', 'Unsupported currency.', 'Unsupported currency rejected');
select throws_ok($$select bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000001'),
  '{items}', '[]'))$$, '22023', 'An order must contain 1 to 50 distinct plans.', 'Empty items rejected');
select throws_ok($$select bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000001'),
  '{items}', '[{"plan_id":"20000000-0000-4000-8000-000000000001","qty":1,"unit_minor":1250},
    {"plan_id":"20000000-0000-4000-8000-000000000001","qty":1,"unit_minor":1250}]'))$$,
  '22023', 'Duplicate plans are not allowed.', 'Duplicate plans rejected');
select throws_ok($$select bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000003'))$$,
  '23514', 'A selected plan is not available for ordering.', 'Draft cannot be ordered');
insert into bren_test_ids values ('order-a',
  (bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001')) ->> 'id')::uuid);
select is((bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001')) ->> 'id')::uuid,
  (select id from bren_test_ids where key = 'order-a'), 'Same payload/key returns same order');
select throws_ok($$select bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000001'),
  '{name}', '"Changed"'))$$, '23505', 'Idempotency key already used with a different payload.', 'Conflicting idempotency key rejected');
select is((bren_read('my_orders') ->> 'total')::integer, 1, 'Only one persisted order after retry');
select is((bren_read('catalog') -> 0 ->> 'available')::integer, 5, 'Pending order does not reserve stock');
select is(bren_read('order', jsonb_build_object('id', (select id from bren_test_ids where key='order-a'))) -> 'payment',
  'null'::jsonb, 'Pending payment explicitly null');
select is((bren_read('order', jsonb_build_object('id', (select id from bren_test_ids where key='order-a'))) #>>
  '{order,total_minor}')::bigint, 1250::bigint, 'Server computed exact total');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference','X','amount_minor',1250,'currency','USD'))$$,
  '42501', 'Permission denied.', 'Customer cannot confirm own payment');
reset role;

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000006');
select is((bren_read('my_orders') ->> 'total')::integer, 0, 'Customer B sees no customer A orders');
select throws_ok($$select bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a')))$$,
  '42501', 'Order not found or access denied.', 'Other customer detail denied');
insert into bren_test_ids values ('order-b',
  (bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001')) ->> 'id')::uuid);
select isnt((select id from bren_test_ids where key='order-a'), (select id from bren_test_ids where key='order-b'),
  'Idempotency key scope is per customer');
reset role;

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000003');
select is(bren_my_role(), 'support', 'Support role resolves');
select lives_ok($$select bren_read('orders')$$, 'Support reads orders');
select lives_ok($$select bren_read('customers')$$, 'Support reads customers');
select is(bren_read('dashboard') -> 'confirmed_usd_minor', 'null'::jsonb, 'Support USD financial summary is null');
select is(bren_read('dashboard') -> 'confirmed_etb_minor', 'null'::jsonb, 'Support ETB financial summary is null');
select throws_ok($$select bren_read('plans')$$, '42501', 'Permission denied.', 'Support plans denied');
select throws_ok($$select bren_read('categories')$$, '42501', 'Permission denied.', 'Support categories denied');
select throws_ok($$select bren_read('inventory')$$, '42501', 'Permission denied.', 'Support inventory denied');
select throws_ok($$select bren_read('allocations')$$, '42501', 'Permission denied.', 'Support allocations denied');
select throws_ok($$select bren_read('movements')$$, '42501', 'Permission denied.', 'Support movements denied');
select throws_ok($$select bren_read('settings')$$, '42501', 'Permission denied.', 'Support settings denied');
select throws_ok($$select bren_read('activity')$$, '42501', 'Permission denied.', 'Support activity denied');
select throws_ok($$select bren_mutate('adjust_capacity',
  '{"plan_id":"20000000-0000-4000-8000-000000000001","capacity":10,"reason":"No"}')$$,
  '42501', 'Permission denied.', 'Support cannot change capacity');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference','X','amount_minor',1250,'currency','USD'))$$,
  '42501', 'Permission denied.', 'Support cannot confirm payment');
select lives_ok($$select bren_mutate('add_order_note', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'note','Secret internal order note'))$$, 'Support can add internal order note');
select lives_ok($$select bren_mutate('add_customer_note',
  '{"id":"a0000000-0000-4000-8000-000000000005","note":"Secret customer note"}')$$, 'Support adds customer note');
select is(jsonb_array_length(bren_read('customer', '{"id":"a0000000-0000-4000-8000-000000000005"}') -> 'notes'),
  1, 'Staff customer details include internal notes');
select ok(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a')))::text
  like '%Secret internal order note%', 'Staff sees internal order note');
reset role;
set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000005');
select ok(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a')))::text
  not like '%Secret%', 'Customer never sees internal order notes');
reset role;

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000004');
select is(bren_my_role(), null::text, 'Suspended owner loses role');
select throws_ok($$select bren_read('orders')$$, '42501', 'Permission denied.', 'Suspended staff cannot read orders');
select throws_ok($$select bren_mutate('save_settings',
  '{"store_name":"Hijacked","telegram_url":"","manual_payment_instructions":""}')$$,
  '42501', 'Permission denied.', 'Suspended owner cannot mutate settings');
select lives_ok($$select bren_read('profile')$$, 'Suspension preserves own customer profile access');
reset role;

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000002');
select is(bren_my_role(), 'manager', 'Manager role resolves');
select lives_ok($$select bren_read('inventory')$$, 'Manager inventory allowed');
select lives_ok($$select bren_read('plans', '{"page":1,"page_size":20,"query":"","status":"","category_id":""}')$$,
  'Empty admin category filter is accepted');
select throws_ok($$select bren_read('team')$$, '42501', 'Permission denied.', 'Manager team denied');
select throws_ok($$select bren_mutate('update_staff',
  '{"id":"a0000000-0000-4000-8000-000000000002","role":"owner","active":true}')$$,
  '42501', 'Permission denied.', 'Manager cannot promote self');
select throws_ok($$select bren_mutate('save_plan', bren_test_plan('20000000-0000-4000-8000-000000000003',
  'Draft', 0))$$, '23514', 'Publishing requires an active category and positive USD and ETB prices.', 'Cannot publish zero price');
select throws_ok($$select bren_mutate('save_category',
  '{"id":"10000000-0000-4000-8000-000000000001","name":"Category A","slug":"bren-test-category","sort_order":0,"archived":true}')$$,
  '23514', 'Archive or reassign active plans before archiving their category.', 'Cannot archive category with active plans');
select throws_ok($$select bren_mutate('adjust_capacity',
  '{"plan_id":"20000000-0000-4000-8000-000000000001","capacity":8,"reason":""}')$$,
  '22023', 'reason has an invalid length.', 'Capacity requires reason');
select lives_ok($$select bren_mutate('save_plan', bren_test_plan('20000000-0000-4000-8000-000000000001',
  'Renamed plan', 1500, 'archived'))$$, 'Manager archives and changes catalog price');
select lives_ok($$select bren_mutate('save_plan', bren_test_plan('20000000-0000-4000-8000-000000000001',
  'Renamed plan', 1500, 'archived') || '{"description":"Changed description","billing_days":90}'::jsonb)$$,
  'Manager changes live description and billing term');
select is(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a'))) #>>
  '{items,0,name}', 'Plan A', 'Order item name snapshot survives catalog edit');
select is((bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a'))) #>>
  '{items,0,unit_minor}')::integer, 1250, 'Order price snapshot survives catalog edit');
select is(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a'))) #>>
  '{items,0,description}', 'Original description', 'Order description snapshot retained');
select is((bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a'))) #>>
  '{items,0,billing_days}')::integer, 30, 'Order billing snapshot retained');
select throws_ok($$select bren_mutate('fulfill_order', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'note','No'))$$,
  '23514', 'Only paid orders can be fulfilled.', 'Cannot fulfill unpaid order');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference','PAY-A','amount_minor',1249,'currency','USD'))$$,
  '23514', 'Payment amount and currency must exactly match the order.', 'Incorrect amount rejected');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference','PAY-A','amount_minor',1250,'currency','ETB'))$$,
  '23514', 'Payment amount and currency must exactly match the order.', 'Incorrect currency rejected');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference',' ','amount_minor',1250,'currency','USD'))$$,
  '22023', 'reference has an invalid length.', 'Verified payment reference required');
select lives_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference','PAY-A','amount_minor',1250,'currency','USD'))$$,
  'Manager confirms historical quote despite catalog price change');
select lives_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference','PAY-A','amount_minor',1250,'currency','USD'))$$,
  'Identical confirmation is idempotent');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'reference','DIFFERENT','amount_minor',1250,'currency','USD'))$$,
  '23505', 'Order was already confirmed with different payment details.', 'Conflicting confirmation rejected');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-b'), 'reference',' pay-a ','amount_minor',1250,'currency','USD'))$$,
  '23505', 'Payment reference has already been recorded.', 'Payment reference cannot pay two orders');
select is((bren_read('allocations') ->> 'total')::integer, 1, 'Duplicate payment did not double allocate');
select is(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-b'))) #>>
  '{order,status}', 'pending', 'Duplicate reference leaves second order pending');
select throws_ok($$select bren_mutate('adjust_capacity',
  '{"plan_id":"20000000-0000-4000-8000-000000000001","capacity":0,"reason":"Shrink"}')$$,
  '23514', 'Capacity cannot be lower than active allocations.', 'Capacity cannot shrink below allocations');
select throws_ok($$select bren_mutate('cancel_order', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'note','Cancel'))$$,
  '23514', 'Only unpaid pending orders can be cancelled.', 'Cannot cancel confirmed order');
select lives_ok($$select bren_mutate('fulfill_order', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-a'), 'note','Private delivery note'))$$, 'Paid order can be fulfilled');
select lives_ok($$select bren_mutate('cancel_order', jsonb_build_object('id',
  (select id from bren_test_ids where key='order-b'), 'note','Private cancellation note'))$$, 'Unpaid order can be cancelled');
select is((bren_read('allocations') ->> 'total')::integer, 1, 'Fulfillment does not consume more seats');
select lives_ok($$select bren_mutate('save_plan', bren_test_plan('20000000-0000-4000-8000-000000000001'))$$,
  'Plan can be republished');
select is((bren_read('dashboard') ->> 'confirmed_usd_minor')::bigint, 1250::bigint, 'Confirmed revenue is not duplicated');
select is((bren_read('dashboard') ->> 'confirmed_etb_minor')::bigint, 0::bigint, 'ETB financial total is separate');
insert into bren_test_ids select 'allocation-a', (bren_read('allocations') #>> '{rows,0,id}')::uuid;
select throws_ok($$select bren_mutate('release_allocation', jsonb_build_object('id',
  (select id from bren_test_ids where key='allocation-a'), 'reason',''))$$,
  '22023', 'reason has an invalid length.', 'Release requires manual-removal reason');
select lives_ok($$select bren_mutate('release_allocation', jsonb_build_object('id',
  (select id from bren_test_ids where key='allocation-a'), 'reason','Access manually removed'))$$, 'Explicit release succeeds');
select throws_ok($$select bren_mutate('release_allocation', jsonb_build_object('id',
  (select id from bren_test_ids where key='allocation-a'), 'reason','Again'))$$,
  '23514', 'Allocation has already been released.', 'Allocation cannot release twice');
select is((bren_read('allocations', '{"status":"active"}') ->> 'total')::integer, 0, 'Released allocation not active');
select is((bren_read('allocations', '{"status":"released"}') ->> 'total')::integer, 1, 'Released history retained');
select is((bren_read('dashboard') ->> 'confirmed_usd_minor')::bigint, 1250::bigint, 'Release does not imply a refund');
reset role;

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000005');
select is((bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000001')) ->> 'id')::uuid,
  (select id from bren_test_ids where key='order-a'), 'Creation retry returns original fulfilled order');
select ok(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a')))::text
  not like '%Private delivery note%', 'Fulfillment staff note is hidden from customer');
select ok(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='order-a')))::text
  not like '%Access manually removed%', 'Release internal note is hidden from customer');
insert into bren_test_ids values ('multi',
  (bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000003'),
    '{items}', '[{"plan_id":"20000000-0000-4000-8000-000000000001","qty":1,"unit_minor":1250},
    {"plan_id":"20000000-0000-4000-8000-000000000002","qty":1,"unit_minor":2000}]')) ->> 'id')::uuid);
insert into bren_test_ids values ('single-b',
  (bren_mutate('create_order', bren_test_order('30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002', 1, 2000)) ->> 'id')::uuid);
insert into bren_test_ids values ('etb',
  (bren_mutate('create_order', jsonb_set(bren_test_order('30000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000001', 1, 50000), '{currency}', '"ETB"')) ->> 'id')::uuid);
reset role;
set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000002');
select lives_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='single-b'), 'reference','PAY-B','amount_minor',2000,'currency','USD'))$$,
  'Last seat in second plan allocated');
select throws_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='multi'), 'reference','PAY-MULTI','amount_minor',3250,'currency','USD'))$$,
  '23514', 'Insufficient seats. No payment or allocation was recorded.', 'Multi-item insufficient stock rejects entire confirmation');
select is((bren_read('plans', '{"plan_id":"20000000-0000-4000-8000-000000000001"}') #>> '{rows,0,allocated}')::integer,
  0, 'First item allocation rolled back on second-item failure');
select is(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='multi'))) -> 'payment',
  'null'::jsonb, 'Failed multi-item payment not persisted');
select is(bren_read('order', jsonb_build_object('id',(select id from bren_test_ids where key='multi'))) #>> '{order,status}',
  'pending', 'Failed multi-item order stays pending');
select lives_ok($$select bren_mutate('confirm_payment', jsonb_build_object('id',
  (select id from bren_test_ids where key='etb'), 'reference','PAY-ETB','amount_minor',50000,'currency','ETB'))$$,
  'ETB confirmation uses independent price');
select is((bren_read('dashboard') ->> 'confirmed_usd_minor')::bigint, 3250::bigint, 'USD totals aggregate only USD');
select is((bren_read('dashboard') ->> 'confirmed_etb_minor')::bigint, 50000::bigint, 'ETB totals aggregate only ETB');
select is((bren_read('orders', '{"query":"Customer A","page_size":1,"page":2}') ->> 'total')::integer,
  5, 'Filtered pagination total is full count');
select is(jsonb_array_length(bren_read('orders', '{"query":"Customer A","page_size":1,"page":2}') -> 'rows'),
  1, 'Pagination limits rows');
select is(bren_read('orders', '{"query":"Customer A","page_size":1,"page":2}'),
  bren_read('orders', '{"query":"Customer A","page_size":1,"page":2}'), 'Pagination is deterministic');
reset role;

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000001');
select is(bren_my_role(), 'owner', 'Owner role resolves');
select lives_ok($$select bren_read('team')$$, 'Owner reads team');
select lives_ok($$select bren_read('activity')$$, 'Owner reads immutable audit');
select lives_ok($$select bren_mutate('save_settings',
  '{"store_name":"Verified Store","telegram_url":"https://t.me/bren_test","manual_payment_instructions":"Private instructions"}')$$,
  'Owner saves settings');
select is(bren_read('public_settings') ->> 'store_name', 'Verified Store', 'Public store settings reflect saved values');
select ok(not (bren_read('public_settings') ? 'manual_payment_instructions'), 'Saved instructions remain private');
select throws_ok($$select bren_mutate('save_settings',
  '{"store_name":"Store","telegram_url":"javascript:alert(1)","manual_payment_instructions":""}')$$,
  '22023', 'Telegram URL must use https://t.me/.', 'Unsafe Telegram URL rejected');
select throws_ok($$select bren_mutate('update_staff',
  '{"id":"a0000000-0000-4000-8000-000000000001","role":"manager","active":true}')$$,
  '23514', 'The last active owner cannot be removed.', 'Last owner cannot be demoted');
select throws_ok($$select bren_mutate('update_staff',
  '{"id":"a0000000-0000-4000-8000-000000000001","role":"owner","active":false}')$$,
  '23514', 'The last active owner cannot be removed.', 'Last owner cannot be suspended');
select lives_ok($$select bren_mutate('update_staff',
  '{"id":"a0000000-0000-4000-8000-000000000002","role":"owner","active":true}')$$, 'Owner promotes second owner');
select lives_ok($$select bren_mutate('update_staff',
  '{"id":"a0000000-0000-4000-8000-000000000001","role":"manager","active":true}')$$, 'One of two owners may demote self');
select is(bren_my_role(), 'manager', 'Demotion applies immediately');
select throws_ok($$select bren_read('team')$$, '42501', 'Permission denied.', 'Demoted owner loses team access immediately');
select throws_ok($$delete from bren_private.bren_activity$$, '42501', null, 'Even staff has no direct audit DML');
reset role;

set local role service_role;
select bren_test_login(null, 'service_role');
select is(bren_staff_lookup_email('BREN-TEST-INVITE@example.invalid'),
  'a0000000-0000-4000-8000-000000000007'::uuid, 'Service-role email lookup is case insensitive');
select is(bren_staff_lookup_email('missing@example.invalid'), null::uuid, 'Unknown lookup returns null');
select throws_ok($$select bren_register_staff('a0000000-0000-4000-8000-000000000007','support',
  'a0000000-0000-4000-8000-000000000001')$$, '42501', 'An active owner must authorize invitations.',
  'Service helper rejects an actor who is no longer owner');
select throws_ok($$select bren_register_staff('a0000000-0000-4000-8000-000000000007','support',
  'a0000000-0000-4000-8000-000000000004')$$, '42501', 'An active owner must authorize invitations.',
  'Service helper rejects suspended owner');
select lives_ok($$select bren_register_staff('a0000000-0000-4000-8000-000000000007','support',
  'a0000000-0000-4000-8000-000000000002')$$, 'Service helper registers authorized invitation');
select throws_ok($$select bren_register_staff('a0000000-0000-4000-8000-000000000007','owner',
  'a0000000-0000-4000-8000-000000000002')$$, '23505', 'Staff member already exists; use team role management.',
  'Invitation cannot silently overwrite an existing staff role');
reset role;

select is((select count(*)::integer from bren_private.bren_payments), 3, 'Only successful distinct payments persisted');
select is((select count(*)::integer from bren_private.bren_activity where action='staff_invited'), 1,
  'Invitation has immutable audit trail');
select throws_ok($$update bren_private.bren_order_items set unit_minor=1$$,
  '42501', 'Historical records are immutable.', 'Order snapshots are immutable');
select throws_ok($$update bren_private.bren_payments set amount_minor=1$$,
  '42501', 'Historical records are immutable.', 'Confirmed payments are immutable');
select throws_ok($$delete from bren_private.bren_activity$$,
  '42501', 'Historical records are immutable.', 'Audit is immutable even through privileged accidental DML');
select throws_ok($$delete from bren_private.bren_staff where id='a0000000-0000-4000-8000-000000000002'$$,
  '23514', 'The last active owner cannot be removed.', 'Last owner delete guarded');
update auth.users set email='bren-test-updated@example.invalid',
  raw_user_meta_data='{"full_name":"Synced name","role":"owner","active":true}'
  where id='a0000000-0000-4000-8000-000000000005';
select is((select name from bren_private.bren_profiles where id='a0000000-0000-4000-8000-000000000005'),
  'Synced name', 'Auth metadata update syncs display name');
select is((select email from bren_private.bren_profiles where id='a0000000-0000-4000-8000-000000000005'),
  'bren-test-updated@example.invalid', 'Auth email update syncs email');
select is((select phone from bren_private.bren_profiles where id='a0000000-0000-4000-8000-000000000005'),
  '123', 'Auth metadata sync preserves independently saved phone');
select ok(not exists (select 1 from bren_private.bren_staff where id='a0000000-0000-4000-8000-000000000005'),
  'Metadata updates cannot elevate customer');

set local role authenticated;
select bren_test_login('a0000000-0000-4000-8000-000000000002');
insert into bren_test_ids values ('created-category', (bren_mutate('save_category',
  '{"name":"New category","slug":"bren-test-new-category","sort_order":8,"archived":false}') ->> 'id')::uuid);
select is((bren_read('categories', '{"query":"New category"}') ->> 'total')::integer, 1,
  'Category creation persists and is searchable');
insert into bren_test_ids values ('created-plan', (bren_mutate('save_plan',
  (bren_test_plan('20000000-0000-4000-8000-000000000009', 'Brand new plan', 1400, 'draft') - 'id')
  || jsonb_build_object('category_id', (select id from bren_test_ids where key='created-category'))) ->> 'id')::uuid);
select is((bren_read('plans', jsonb_build_object('plan_id',
  (select id from bren_test_ids where key='created-plan'))) #>> '{rows,0,capacity}')::integer, 0,
  'New plan capacity is always zero');
select lives_ok($$select bren_mutate('save_category', jsonb_build_object('id',
  (select id from bren_test_ids where key='created-category'), 'name','New category','slug','bren-test-new-category',
  'sort_order',8,'archived',true))$$, 'Category referenced only by draft plans can archive');
select throws_ok($$select bren_mutate('save_plan',
  bren_test_plan((select id from bren_test_ids where key='created-plan'), 'New active', 1400)
    || jsonb_build_object('category_id',(select id from bren_test_ids where key='created-category')))$$,
  '23514', 'Publishing requires an active category and positive USD and ETB prices.', 'Cannot publish in archived category');
reset role;

update bren_private.bren_allocations set started_at=now()-interval '90 days', ends_at=now()-interval '30 days'
  where order_id=(select id from bren_test_ids where key='single-b');
select is((select allocated from bren_private.bren_plan_rows where id='20000000-0000-4000-8000-000000000002'),
  1, 'Expired service dates do not automatically free seats');

select * from finish();
rollback;
