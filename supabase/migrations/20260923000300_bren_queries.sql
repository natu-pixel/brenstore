create view bren_private.bren_plan_rows as
select p.id, p.name, p.slug, p.description, p.category_id, c.name as category_name,
  p.brand_key, p.initial, p.color_start, p.color_end, p.usd_minor, p.etb_minor,
  p.usd_compare_minor, p.etb_compare_minor, p.capacity,
  coalesce(a.allocated, 0)::integer as allocated,
  (p.capacity - coalesce(a.allocated, 0))::integer as available,
  p.low_stock_threshold, p.billing_days, p.status, p.featured, p.updated_at
from bren_private.bren_plans p left join bren_private.bren_categories c on c.id = p.category_id
left join (
  select plan_id, sum(qty) as allocated from bren_private.bren_allocations
    where released_at is null group by plan_id
) a on a.plan_id = p.id;
create view bren_private.bren_order_rows as
select id, reference, customer_id, customer_name, phone, telegram, currency, total_minor,
  status, payment_status, created_at, updated_at
from bren_private.bren_orders;
create view bren_private.bren_customer_rows as
select id, name, email, phone, telegram, created_at from bren_private.bren_profiles;
revoke all on bren_private.bren_plan_rows, bren_private.bren_order_rows,
  bren_private.bren_customer_rows from public, anon, authenticated, service_role;

create function public.bren_read(resource text, args jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  actor uuid;
  actor_role text;
  page_number integer;
  page_limit integer;
  row_offset bigint;
  search_query text;
  state_filter text;
  category_filter uuid;
  plan_filter uuid;
  target uuid;
  result jsonb;
  usd_total numeric;
  etb_total numeric;
begin
  perform bren_keys(args, array['page', 'page_size', 'query', 'status', 'category_id', 'id', 'plan_id']);
  page_number := bren_int(args, 'page', 1, 1000000000, 1)::integer;
  page_limit := bren_int(args, 'page_size', 1, 100, 20)::integer;
  row_offset := (page_number::bigint - 1) * page_limit;
  search_query := lower(bren_text(args, 'query', 0, 200, ''));
  state_filter := bren_text(args, 'status', 0, 30, '');
  category_filter := case when args ->> 'category_id' = '' then null else bren_uuid(args, 'category_id', true) end;
  plan_filter := case when args ->> 'plan_id' = '' then null else bren_uuid(args, 'plan_id', true) end;
  target := bren_uuid(args, 'id', true);

  if resource not in ('catalog', 'public_categories', 'public_settings') then
    actor := bren_require_actor();
    actor_role := bren_role(actor);
    if resource in ('dashboard', 'orders', 'customers', 'customer') then
      perform bren_require_role(array['owner', 'manager', 'support']);
    elsif resource in ('plans', 'categories', 'inventory', 'allocations', 'movements') then
      perform bren_require_role(array['owner', 'manager']);
    elsif resource in ('team', 'settings', 'activity') then
      perform bren_require_role(array['owner']);
    end if;
  end if;

  if resource = 'catalog' then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.featured desc, c.sort_order, p.name, p.id), '[]'::jsonb)
    into result from bren_plan_rows p join bren_categories c on c.id = p.category_id
    where p.status = 'active' and not c.archived
      and (category_filter is null or p.category_id = category_filter)
      and (search_query = '' or strpos(lower(p.name || ' ' || p.description || ' ' || c.name), search_query) > 0);

  elsif resource = 'public_categories' then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug,
      'sort_order', sort_order, 'archived', archived) order by sort_order, name, id), '[]'::jsonb)
      into result from bren_categories where not archived;

  elsif resource in ('public_settings', 'settings', 'payment_instructions') then
    select case resource
      when 'public_settings' then jsonb_build_object('store_name', store_name, 'telegram_url', telegram_url)
      when 'payment_instructions' then jsonb_build_object('telegram_url', telegram_url,
        'manual_payment_instructions', manual_payment_instructions)
      else jsonb_build_object('store_name', store_name, 'telegram_url', telegram_url,
        'manual_payment_instructions', manual_payment_instructions) end
      into result from bren_settings where singleton;

  elsif resource in ('plans', 'inventory') then
    if state_filter not in ('', 'draft', 'active', 'archived') then
      raise exception using errcode = '22023', message = 'Invalid plan status filter.';
    end if;
    with filtered as (
      select p.* from bren_plan_rows p
      where (state_filter = '' or p.status = state_filter)
        and (category_filter is null or p.category_id = category_filter)
        and (plan_filter is null or p.id = plan_filter)
        and (search_query = '' or strpos(lower(p.name || ' ' || p.slug || ' ' || coalesce(p.category_name, '')), search_query) > 0)
    ), paged as (select * from filtered order by name, id limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.name, p.id) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource = 'categories' then
    if state_filter not in ('', 'active', 'archived') then
      raise exception using errcode = '22023', message = 'Invalid category status filter.';
    end if;
    with filtered as (
      select id, name, slug, sort_order, archived from bren_categories c
      where (state_filter = '' or c.archived = (state_filter = 'archived'))
        and (search_query = '' or strpos(lower(c.name || ' ' || c.slug), search_query) > 0)
    ), paged as (select * from filtered order by sort_order, name, id limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.name, p.id) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource in ('orders', 'my_orders') then
    if state_filter not in ('', 'pending', 'paid', 'fulfilled', 'cancelled') then
      raise exception using errcode = '22023', message = 'Invalid order status filter.';
    end if;
    with filtered as (
      select o.* from bren_order_rows o
      where (resource = 'orders' or o.customer_id = actor)
        and (state_filter = '' or o.status = state_filter)
        and (search_query = '' or strpos(lower(o.reference || ' ' || o.customer_name || ' ' || o.phone || ' ' || o.telegram), search_query) > 0)
    ), paged as (select * from filtered order by created_at desc, id desc limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource = 'order' then
    if target is null then raise exception using errcode = '22023', message = 'Order id is required.'; end if;
    if not exists (select 1 from bren_orders where id = target and
      (customer_id = actor or actor_role in ('owner', 'manager', 'support'))) then
      raise exception using errcode = '42501', message = 'Order not found or access denied.';
    end if;
    select jsonb_build_object(
      'order', (select to_jsonb(o) from bren_order_rows o where id = target),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'plan_id', i.plan_id, 'name', i.name,
        'description', i.description, 'qty', i.qty, 'unit_minor', i.unit_minor, 'billing_days', i.billing_days)
        order by i.name, i.id), '[]'::jsonb) from bren_order_items i where order_id = target),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'actor_id', e.actor_id,
        'action', e.action, 'note', e.note, 'created_at', e.created_at) order by e.created_at, e.id), '[]'::jsonb)
        from bren_order_events e where order_id = target
          and (not e.internal or actor_role in ('owner', 'manager', 'support'))),
      'payment', (select jsonb_build_object('reference', p.reference, 'amount_minor', p.amount_minor,
        'currency', p.currency, 'confirmed_by', p.confirmed_by, 'confirmed_at', p.confirmed_at)
        from bren_payments p where order_id = target)) into result;

  elsif resource = 'profile' then
    select to_jsonb(p) into result from bren_customer_rows p where id = actor;

  elsif resource = 'customers' then
    with filtered as (
      select p.* from bren_customer_rows p where search_query = ''
        or strpos(lower(p.name || ' ' || p.email || ' ' || p.phone || ' ' || p.telegram), search_query) > 0
    ), paged as (select * from filtered order by created_at desc, id desc limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource = 'customer' then
    if target is null or not exists (select 1 from bren_profiles where id = target) then
      raise exception using errcode = 'P0002', message = 'Customer not found.';
    end if;
    select jsonb_build_object('customer', (select to_jsonb(p) from bren_customer_rows p where id = target),
      'orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc, o.id desc), '[]'::jsonb)
        from bren_order_rows o where customer_id = target),
      'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'actor_id', n.actor_id,
        'action', n.action, 'note', n.note, 'created_at', n.created_at) order by n.created_at, n.id), '[]'::jsonb)
        from bren_customer_notes n where customer_id = target)) into result;

  elsif resource = 'team' then
    if state_filter not in ('', 'active', 'suspended') then
      raise exception using errcode = '22023', message = 'Invalid staff status filter.';
    end if;
    with filtered as (
      select s.id, p.name, p.email, s.role, s.active, s.invited_at
      from bren_staff s join bren_profiles p on p.id = s.id
      where (state_filter = '' or s.active = (state_filter = 'active'))
        and (search_query = '' or strpos(lower(p.name || ' ' || p.email || ' ' || s.role), search_query) > 0)
    ), paged as (select * from filtered order by name, email, id limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.name, p.email, p.id) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource = 'allocations' then
    if state_filter not in ('', 'active', 'released') then
      raise exception using errcode = '22023', message = 'Invalid allocation status filter.';
    end if;
    with filtered as (
      select a.id, a.order_id, o.reference as order_reference, a.plan_id, i.name as plan_name,
        o.customer_name, a.qty, a.started_at, a.ends_at, a.released_at, a.release_reason
      from bren_allocations a join bren_orders o on o.id = a.order_id join bren_order_items i on i.id = a.order_item_id
      where (plan_filter is null or a.plan_id = plan_filter)
        and (state_filter = '' or (state_filter = 'active' and a.released_at is null)
          or (state_filter = 'released' and a.released_at is not null))
        and (search_query = '' or strpos(lower(o.reference || ' ' || o.customer_name || ' ' || i.name), search_query) > 0)
    ), paged as (select * from filtered order by started_at desc, id desc limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.started_at desc, p.id desc) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource = 'movements' then
    with filtered as (
      select m.id, m.plan_id, p.name as plan_name, m.delta, m.reason, m.created_at
      from bren_movements m join bren_plans p on p.id = m.plan_id
      where (plan_filter is null or m.plan_id = plan_filter)
        and (search_query = '' or strpos(lower(p.name || ' ' || m.reason), search_query) > 0)
    ), paged as (select * from filtered order by created_at desc, id desc limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource = 'activity' then
    with filtered as (
      select a.* from bren_activity a where search_query = ''
        or strpos(lower(a.action || ' ' || a.summary), search_query) > 0
    ), paged as (select * from filtered order by created_at desc, id desc limit page_limit offset row_offset)
    select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc) from paged p), '[]'::jsonb),
      'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;

  elsif resource = 'dashboard' then
    if actor_role in ('owner', 'manager') then
      select coalesce(sum(amount_minor) filter (where currency = 'USD'), 0),
        coalesce(sum(amount_minor) filter (where currency = 'ETB'), 0) into usd_total, etb_total from bren_payments;
      if usd_total > 9007199254740991 or etb_total > 9007199254740991 then
        raise exception using errcode = '22003', message = 'Financial totals exceed the safe display range.';
      end if;
    end if;
    select jsonb_build_object(
      'pending_orders', (select count(*) from bren_orders where status = 'pending'),
      'active_plans', (select count(*) from bren_plans where status = 'active'),
      'available_seats', (select coalesce(sum(available), 0) from bren_plan_rows where status = 'active'),
      'low_stock', (select count(*) from bren_plan_rows where status = 'active' and available <= low_stock_threshold),
      'confirmed_usd_minor', usd_total, 'confirmed_etb_minor', etb_total,
      'recent_orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc, o.id desc), '[]'::jsonb)
        from (select * from bren_order_rows order by created_at desc, id desc limit 8) o)) into result;
  else
    raise exception using errcode = '22023', message = 'Unknown resource.';
  end if;
  return result;
end;
$$;
revoke all on function public.bren_read(text, jsonb) from public;
grant execute on function public.bren_read(text, jsonb) to anon, authenticated;
