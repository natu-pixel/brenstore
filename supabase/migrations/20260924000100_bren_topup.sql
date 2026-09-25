-- LOCAL-PROVISIONAL: inspect the intended remote schema before deploying.
-- Game top-up products: provider-linked plans, player-ID checkout snapshots and
-- per-unit delivery tracking with automatic fulfillment through the provider API.

alter table bren_private.bren_plans
  add column kind text not null default 'seat' check (kind in ('seat', 'topup')),
  add column provider_package_id text check (provider_package_id is null or provider_package_id ~ '^[0-9]{1,10}$'),
  add check ((kind = 'topup') = (provider_package_id is not null));

alter table bren_private.bren_order_items
  add column player_id text check (player_id is null or player_id ~ '^[0-9]{6,20}$');

-- Timeline ties: events written in one transaction share now(), so uuid order was arbitrary.
alter table bren_private.bren_order_events
  add column seq bigint generated always as identity;

create table bren_private.bren_topup_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references bren_private.bren_orders(id) on delete restrict,
  order_item_id uuid not null references bren_private.bren_order_items(id) on delete restrict,
  plan_id uuid not null references bren_private.bren_plans(id) on delete restrict,
  unit_index integer not null check (unit_index between 1 and 9),
  player_id text not null check (player_id ~ '^[0-9]{6,20}$'),
  package_id text not null check (package_id ~ '^[0-9]{1,10}$'),
  package_name text not null check (length(btrim(package_name)) between 1 and 160),
  status text not null default 'queued' check (status in ('queued', 'processing', 'delivered', 'failed')),
  provider_order_id text check (provider_order_id is null or length(provider_order_id) between 1 and 120),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  last_error text not null default '' check (length(last_error) <= 1000),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id, unit_index),
  check ((status = 'delivered') = (delivered_at is not null))
);
create index bren_topup_deliveries_order on bren_private.bren_topup_deliveries (order_id, id);
create index bren_topup_deliveries_open on bren_private.bren_topup_deliveries (status)
  where status in ('queued', 'processing');
alter table bren_private.bren_topup_deliveries enable row level security;
revoke all on bren_private.bren_topup_deliveries from public, anon, authenticated, service_role;

create or replace view bren_private.bren_plan_rows as
select p.id, p.name, p.slug, p.description, p.category_id, c.name as category_name,
  p.brand_key, p.initial, p.color_start, p.color_end, p.usd_minor, p.etb_minor,
  p.usd_compare_minor, p.etb_compare_minor, p.capacity,
  coalesce(a.allocated, 0)::integer as allocated,
  case when p.kind = 'topup' then null
    else (p.capacity - coalesce(a.allocated, 0))::integer end as available,
  p.low_stock_threshold, p.billing_days, p.status, p.featured, p.updated_at,
  p.kind, p.provider_package_id
from bren_private.bren_plans p left join bren_private.bren_categories c on c.id = p.category_id
left join (
  select plan_id, sum(qty) as allocated from bren_private.bren_allocations
    where released_at is null group by plan_id
) a on a.plan_id = p.id;
revoke all on bren_private.bren_plan_rows from public, anon, authenticated, service_role;

-- Service-role-only delivery workflow for the bren-topup Edge Function.
create function public.bren_topup_pending(p_order_id uuid, p_retry_failed boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  row_order bren_orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  if p_retry_failed is null then p_retry_failed := false; end if;
  select * into row_order from bren_orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Order not found.'; end if;
  if row_order.status not in ('paid', 'fulfilled') then
    raise exception using errcode = '23514', message = 'Order is not awaiting top-up delivery.';
  end if;
  if not exists (select 1 from bren_topup_deliveries where order_id = p_order_id) then
    raise exception using errcode = '23514', message = 'Order has no top-up deliveries.';
  end if;
  if p_retry_failed then
    update bren_topup_deliveries set status = 'queued', provider_order_id = null, updated_at = now()
      where order_id = p_order_id and status = 'failed';
  end if;
  return jsonb_build_object(
    'order_id', row_order.id,
    'order_status', row_order.status,
    'deliveries', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'unit_index', d.unit_index,
        'player_id', d.player_id, 'package_id', d.package_id, 'package_name', d.package_name,
        'status', d.status, 'provider_order_id', d.provider_order_id, 'attempts', d.attempts)
        order by d.order_item_id, d.unit_index), '[]'::jsonb)
      from bren_topup_deliveries d
      where d.order_id = p_order_id and d.status in ('queued', 'processing')));
end;
$$;
create function public.bren_topup_started(p_delivery_id uuid, p_provider_order_id text) returns void
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  if p_provider_order_id is null or length(btrim(p_provider_order_id)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Invalid provider order id.';
  end if;
  update bren_topup_deliveries set status = 'processing',
    provider_order_id = left(btrim(p_provider_order_id), 120), attempts = attempts + 1,
    last_error = '', updated_at = now()
    where id = p_delivery_id and status in ('queued', 'processing');
  if not found then raise exception using errcode = 'P0002', message = 'Delivery not found or already final.'; end if;
end;
$$;
create function public.bren_topup_finished(p_delivery_id uuid, p_ok boolean, p_error text default '') returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  row_delivery bren_topup_deliveries%rowtype;
  row_order bren_orders%rowtype;
  remaining integer;
  error_value text := left(btrim(coalesce(p_error, '')), 1000);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  if p_ok is null then raise exception using errcode = '22023', message = 'Delivery outcome is required.'; end if;
  select * into row_delivery from bren_topup_deliveries where id = p_delivery_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Delivery not found.'; end if;
  if row_delivery.status = 'delivered' then
    return jsonb_build_object('delivery_status', row_delivery.status, 'order_status',
      (select status from bren_orders where id = row_delivery.order_id));
  end if;
  if p_ok then
    update bren_topup_deliveries set status = 'delivered', delivered_at = now(),
      last_error = '', updated_at = now() where id = row_delivery.id;
    insert into bren_order_events (order_id, actor_id, action, note)
      values (row_delivery.order_id, null, 'topup_delivered', row_delivery.package_name ||
        ' unit ' || row_delivery.unit_index || ' delivered to player ' || row_delivery.player_id || '.');
  else
    if error_value = '' then error_value := 'Provider reported a failure.'; end if;
    update bren_topup_deliveries set status = 'failed', last_error = error_value, updated_at = now()
      where id = row_delivery.id;
    insert into bren_order_events (order_id, actor_id, action, note, internal)
      values (row_delivery.order_id, null, 'topup_failed', 'Top-up failed for ' || row_delivery.package_name ||
        ' unit ' || row_delivery.unit_index || ': ' || left(error_value, 500), true);
  end if;
  select * into row_order from bren_orders where id = row_delivery.order_id for update;
  if p_ok and row_order.status = 'paid' and not exists (
    select 1 from bren_topup_deliveries where order_id = row_order.id and status <> 'delivered') then
    update bren_orders set status = 'fulfilled', updated_at = now() where id = row_order.id;
    insert into bren_order_events (order_id, actor_id, action, note)
      values (row_order.id, null, 'fulfilled', 'All top-up deliveries completed.');
    perform bren_audit('topup_order_fulfilled', null, row_order.id, 'Top-up order fulfilled automatically');
  end if;
  return jsonb_build_object('delivery_status', case when p_ok then 'delivered' else 'failed' end,
    'order_status', (select status from bren_orders where id = row_delivery.order_id));
end;
$$;
revoke all on function public.bren_topup_pending(uuid, boolean) from public, anon, authenticated;
revoke all on function public.bren_topup_started(uuid, text) from public, anon, authenticated;
revoke all on function public.bren_topup_finished(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.bren_topup_pending(uuid, boolean) to service_role;
grant execute on function public.bren_topup_started(uuid, text) to service_role;
grant execute on function public.bren_topup_finished(uuid, boolean, text) to service_role;

create or replace function public.bren_mutate(action text, input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  actor uuid;
  target uuid;
  category uuid;
  order_key uuid;
  plan_ids uuid[];
  row_plan bren_plans%rowtype;
  row_order bren_orders%rowtype;
  row_item bren_order_items%rowtype;
  row_payment bren_payments%rowtype;
  row_allocation bren_allocations%rowtype;
  row_staff bren_staff%rowtype;
  item jsonb;
  canonical_items jsonb := '[]'::jsonb;
  fingerprint text;
  chosen_currency text;
  title text;
  slug_value text;
  description_value text;
  phone_value text;
  telegram_value text;
  note_value text;
  state_value text;
  role_value text;
  reference_value text;
  kind_value text;
  package_value text;
  player_value text;
  has_topup boolean := false;
  has_seat boolean := false;
  usd bigint;
  etb bigint;
  usd_compare bigint;
  etb_compare bigint;
  price bigint;
  amount bigint;
  total bigint := 0;
  allocated bigint;
  quantity integer;
  capacity_value integer;
  old_capacity integer;
  archived_value boolean;
  active_value boolean;
  allocation_id uuid;
begin
  actor := bren_require_actor();
  if action = 'save_category' then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(input, array['id', 'name', 'slug', 'sort_order', 'archived']);
    target := bren_uuid(input, 'id', true);
    title := bren_text(input, 'name', 1, 160);
    slug_value := bren_text(input, 'slug', 1, 120);
    archived_value := bren_bool(input, 'archived');
    perform bren_int(input, 'sort_order', -1000000, 1000000);
    if slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception using errcode = '22023', message = 'Invalid category slug.';
    end if;
    -- Catalog edits serialize with checkout's shared lock, including category visibility.
    perform pg_advisory_xact_lock(73190523002);
    if target is null then
      insert into bren_categories (name, slug, sort_order, archived)
        values (title, slug_value, (input ->> 'sort_order')::integer, archived_value) returning id into target;
    else
      perform 1 from bren_categories where id = target for update;
      if not found then raise exception using errcode = 'P0002', message = 'Category not found.'; end if;
      if archived_value and exists (select 1 from bren_plans where category_id = target and status = 'active') then
        raise exception using errcode = '23514', message = 'Archive or reassign active plans before archiving their category.';
      end if;
      update bren_categories set name = title, slug = slug_value,
        sort_order = (input ->> 'sort_order')::integer, archived = archived_value, updated_at = now()
        where id = target;
    end if;
    perform bren_audit(action, actor, target, 'Saved category ' || title);

  elsif action = 'save_plan' then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(input, array['id', 'name', 'slug', 'description', 'category_id', 'brand_key', 'initial',
      'color_start', 'color_end', 'usd_minor', 'etb_minor', 'usd_compare_minor', 'etb_compare_minor',
      'billing_days', 'status', 'featured', 'low_stock_threshold', 'kind', 'provider_package_id']);
    target := bren_uuid(input, 'id', true);
    category := bren_uuid(input, 'category_id', true);
    title := bren_text(input, 'name', 1, 160);
    slug_value := bren_text(input, 'slug', 1, 120);
    description_value := bren_text(input, 'description', 0, 5000, '');
    state_value := bren_text(input, 'status', 1, 20);
    kind_value := bren_text(input, 'kind', 1, 10, 'seat');
    package_value := nullif(bren_text(input, 'provider_package_id', 0, 10, ''), '');
    usd := bren_int(input, 'usd_minor', 0, 1000000000000, null, true);
    etb := bren_int(input, 'etb_minor', 0, 1000000000000, null, true);
    usd_compare := bren_int(input, 'usd_compare_minor', 0, 1000000000000, null, true);
    etb_compare := bren_int(input, 'etb_compare_minor', 0, 1000000000000, null, true);
    perform bren_text(input, 'initial', 1, 8);
    perform bren_int(input, 'billing_days', 1, 3650);
    perform bren_int(input, 'low_stock_threshold', 0, 1000000);
    perform bren_bool(input, 'featured');
    if bren_text(input, 'brand_key', 0, 80) !~ '^[a-zA-Z0-9_-]*$'
      or bren_text(input, 'color_start', 7, 7) !~ '^#[0-9a-fA-F]{6}$'
      or bren_text(input, 'color_end', 7, 7) !~ '^#[0-9a-fA-F]{6}$'
      or slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception using errcode = '22023', message = 'Invalid plan slug or brand styling.';
    end if;
    if state_value not in ('draft', 'active', 'archived') then
      raise exception using errcode = '22023', message = 'Invalid plan status.';
    end if;
    if kind_value not in ('seat', 'topup') then
      raise exception using errcode = '22023', message = 'Invalid plan kind.';
    end if;
    if kind_value = 'topup' and package_value is null then
      raise exception using errcode = '22023', message = 'Top-up plans require a provider package.';
    end if;
    if kind_value = 'seat' and package_value is not null then
      raise exception using errcode = '22023', message = 'Provider packages are only valid for top-up plans.';
    end if;
    if (usd_compare is not null and (usd is null or usd_compare <= usd))
      or (etb_compare is not null and (etb is null or etb_compare <= etb)) then
      raise exception using errcode = '22023', message = 'Comparison prices must exceed their currency price.';
    end if;
    perform pg_advisory_xact_lock(73190523002);
    if category is not null and not exists (select 1 from bren_categories where id = category) then
      raise exception using errcode = '22023', message = 'Category not found.';
    end if;
    if state_value = 'active' and (coalesce(usd, 0) <= 0 or coalesce(etb, 0) <= 0
      or not exists (select 1 from bren_categories where id = category and not archived)) then
      raise exception using errcode = '23514', message = 'Publishing requires an active category and positive USD and ETB prices.';
    end if;
    if target is null then
      insert into bren_plans (name, slug, description, category_id, brand_key, initial, color_start, color_end,
        usd_minor, etb_minor, usd_compare_minor, etb_compare_minor, billing_days, status, featured,
        low_stock_threshold, kind, provider_package_id)
      values (title, slug_value, description_value, category, btrim(input ->> 'brand_key'), btrim(input ->> 'initial'),
        btrim(input ->> 'color_start'), btrim(input ->> 'color_end'), usd, etb, usd_compare, etb_compare,
        (input ->> 'billing_days')::integer, state_value, (input ->> 'featured')::boolean,
        (input ->> 'low_stock_threshold')::integer, kind_value, package_value) returning id into target;
    else
      perform 1 from bren_plans where id = target for update;
      if not found then raise exception using errcode = 'P0002', message = 'Plan not found.'; end if;
      -- Kind changes rewrite fulfillment of later confirmations; existing snapshots lock the choice in.
      if exists (select 1 from bren_plans where id = target and kind <> kind_value)
        and exists (select 1 from bren_order_items where plan_id = target) then
        raise exception using errcode = '23514', message = 'Plans with existing orders cannot change product type.';
      end if;
      update bren_plans set name = title, slug = slug_value, description = description_value, category_id = category,
        brand_key = btrim(input ->> 'brand_key'), initial = btrim(input ->> 'initial'),
        color_start = btrim(input ->> 'color_start'), color_end = btrim(input ->> 'color_end'),
        usd_minor = usd, etb_minor = etb, usd_compare_minor = usd_compare, etb_compare_minor = etb_compare,
        billing_days = (input ->> 'billing_days')::integer, status = state_value,
        featured = (input ->> 'featured')::boolean, low_stock_threshold = (input ->> 'low_stock_threshold')::integer,
        kind = kind_value, provider_package_id = package_value, updated_at = now() where id = target;
    end if;
    perform bren_audit(action, actor, target, 'Saved plan ' || title);

  elsif action = 'adjust_capacity' then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(input, array['plan_id', 'capacity', 'reason']);
    target := bren_uuid(input, 'plan_id');
    capacity_value := bren_int(input, 'capacity', 0, 1000000)::integer;
    note_value := bren_text(input, 'reason', 1, 1000);
    select capacity, kind into old_capacity, kind_value from bren_plans where id = target for update;
    if not found then raise exception using errcode = 'P0002', message = 'Plan not found.'; end if;
    if kind_value <> 'seat' then
      raise exception using errcode = '23514', message = 'Top-up plans are provider-delivered and have no seat capacity.';
    end if;
    select coalesce(sum(qty), 0) into allocated from bren_allocations where plan_id = target and released_at is null;
    if capacity_value < allocated then
      raise exception using errcode = '23514', message = 'Capacity cannot be lower than active allocations.';
    end if;
    update bren_plans set capacity = capacity_value, updated_at = now() where id = target;
    insert into bren_movements (plan_id, kind, delta, reason, actor_id)
      values (target, 'capacity', capacity_value - old_capacity, note_value, actor);
    perform bren_audit(action, actor, target, 'Capacity ' || old_capacity || ' → ' || capacity_value || ': ' || note_value);

  elsif action = 'create_order' then
    perform bren_keys(input, array['idempotency_key', 'currency', 'name', 'phone', 'telegram', 'items']);
    order_key := bren_uuid(input, 'idempotency_key');
    chosen_currency := bren_text(input, 'currency', 3, 3);
    title := bren_text(input, 'name', 1, 160);
    phone_value := bren_text(input, 'phone', 1, 80);
    telegram_value := bren_text(input, 'telegram', 0, 80, '');
    if chosen_currency not in ('USD', 'ETB') then
      raise exception using errcode = '22023', message = 'Unsupported currency.';
    end if;
    if jsonb_typeof(input -> 'items') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Items must be an array.';
    end if;
    if jsonb_array_length(input -> 'items') not between 1 and 50 then
      raise exception using errcode = '22023', message = 'An order must contain 1 to 50 distinct plans.';
    end if;
    for item in select value from jsonb_array_elements(input -> 'items') loop
      perform bren_keys(item, array['plan_id', 'qty', 'unit_minor', 'player_id']);
      player_value := bren_text(item, 'player_id', 0, 20, '');
      canonical_items := canonical_items || jsonb_build_array(jsonb_build_object(
        'plan_id', bren_uuid(item, 'plan_id'), 'qty', bren_int(item, 'qty', 1, 9),
        'unit_minor', bren_int(item, 'unit_minor', 1, 1000000000000), 'player_id', player_value));
    end loop;
    select array_agg((value ->> 'plan_id')::uuid order by value ->> 'plan_id'),
      jsonb_agg(value order by value ->> 'plan_id') into plan_ids, canonical_items
      from jsonb_array_elements(canonical_items);
    if (select count(distinct p) from unnest(plan_ids) p) <> cardinality(plan_ids) then
      raise exception using errcode = '22023', message = 'Duplicate plans are not allowed.';
    end if;
    fingerprint := encode(sha256(convert_to(jsonb_build_object('name', title, 'phone', phone_value,
      'telegram', telegram_value, 'currency', chosen_currency, 'items', canonical_items)::text, 'UTF8')), 'hex');
    -- Same customer/key is serialized before checking either the fingerprint or catalog.
    perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || order_key::text, 0));
    select * into row_order from bren_orders where customer_id = actor and idempotency_key = order_key;
    if found then
      if row_order.payload_fingerprint <> fingerprint then
        raise exception using errcode = '23505', message = 'Idempotency key already used with a different payload.';
      end if;
      return jsonb_build_object('id', row_order.id);
    end if;
    perform pg_advisory_xact_lock_shared(73190523002);
    -- Shared plan locks keep quoted prices and capacity stable through snapshot persistence.
    perform id from bren_plans where id = any(plan_ids) order by id for share;
    if exists (select 1 from bren_plans where id = any(plan_ids) and kind = 'topup')
      and exists (select 1 from bren_plans where id = any(plan_ids) and kind = 'seat') then
      raise exception using errcode = '23514', message = 'Top-up and subscription plans must be ordered separately.';
    end if;
    for item in select value from jsonb_array_elements(canonical_items) loop
      select * into row_plan from bren_plans where id = (item ->> 'plan_id')::uuid;
      if not found or row_plan.status <> 'active' or not exists (
        select 1 from bren_categories where id = row_plan.category_id and not archived) then
        raise exception using errcode = '23514', message = 'A selected plan is not available for ordering.';
      end if;
      if row_plan.kind = 'topup' then
        has_topup := true;
        if (item ->> 'player_id') !~ '^[0-9]{6,20}$' then
          raise exception using errcode = '22023', message = 'A numeric player ID of 6 to 20 digits is required for top-up plans.';
        end if;
      else
        has_seat := true;
        if (item ->> 'player_id') <> '' then
          raise exception using errcode = '22023', message = 'Player ID is only valid for top-up plans.';
        end if;
      end if;
      quantity := (item ->> 'qty')::integer;
      price := case chosen_currency when 'USD' then row_plan.usd_minor else row_plan.etb_minor end;
      if price is null or price <= 0 or price <> (item ->> 'unit_minor')::bigint then
        raise exception using errcode = '23514', message = 'A price changed. Review your cart before submitting again.';
      end if;
      if row_plan.kind = 'seat' then
        select coalesce(sum(qty), 0) into allocated from bren_allocations
          where plan_id = row_plan.id and released_at is null;
        if row_plan.capacity - allocated < quantity then
          raise exception using errcode = '23514', message = 'Insufficient seats for a selected plan.';
        end if;
      end if;
      total := total + price * quantity;
    end loop;
    insert into bren_orders (customer_id, customer_name, phone, telegram, currency, total_minor,
      idempotency_key, payload_fingerprint)
    values (actor, title, phone_value, telegram_value, chosen_currency, total, order_key, fingerprint)
      returning id into target;
    insert into bren_order_items (order_id, plan_id, name, description, qty, unit_minor, billing_days, player_id)
    select target, p.id, p.name, p.description, (v.value ->> 'qty')::integer,
      case chosen_currency when 'USD' then p.usd_minor else p.etb_minor end, p.billing_days,
      nullif(v.value ->> 'player_id', '')
    from jsonb_array_elements(canonical_items) v join bren_plans p on p.id = (v.value ->> 'plan_id')::uuid;
    insert into bren_order_events (order_id, actor_id, action, note)
      values (target, actor, 'created', case when has_topup
        then 'Order submitted. Top-ups are delivered automatically after payment confirmation.'
        else 'Order submitted. Pending orders do not reserve seats.' end);
    perform bren_audit(action, actor, target, 'Created pending order');

  elsif action = 'confirm_payment' then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(input, array['id', 'reference', 'amount_minor', 'currency']);
    target := bren_uuid(input, 'id');
    reference_value := bren_text(input, 'reference', 1, 200);
    amount := bren_int(input, 'amount_minor', 1, 450000000000000);
    chosen_currency := bren_text(input, 'currency', 3, 3);
    if chosen_currency not in ('USD', 'ETB') then
      raise exception using errcode = '22023', message = 'Unsupported currency.';
    end if;
    select * into row_order from bren_orders where id = target for update;
    if not found then raise exception using errcode = 'P0002', message = 'Order not found.'; end if;
    if row_order.total_minor <> amount or row_order.currency <> chosen_currency then
      raise exception using errcode = '23514', message = 'Payment amount and currency must exactly match the order.';
    end if;
    if row_order.payment_status = 'confirmed' then
      select * into row_payment from bren_payments where order_id = target;
      if row_payment.reference = reference_value and row_payment.amount_minor = amount
        and row_payment.currency = chosen_currency then
        return jsonb_build_object('id', target);
      end if;
      raise exception using errcode = '23505', message = 'Order was already confirmed with different payment details.';
    end if;
    if row_order.status <> 'pending' then
      raise exception using errcode = '23514', message = 'Only pending orders can be paid.';
    end if;
    -- All inventory-changing commands lock plan rows first, sorted by UUID for multi-item orders.
    perform p.id from bren_plans p join bren_order_items i on i.plan_id = p.id
      where i.order_id = target order by p.id for update of p;
    for row_item in select * from bren_order_items where order_id = target order by plan_id loop
      select * into row_plan from bren_plans where id = row_item.plan_id;
      if row_plan.kind = 'topup' then
        -- Provider-delivered: queue one delivery per unit instead of allocating seats.
        insert into bren_topup_deliveries (order_id, order_item_id, plan_id, unit_index,
          player_id, package_id, package_name)
        select target, row_item.id, row_item.plan_id, u.unit_index, row_item.player_id,
          row_plan.provider_package_id, row_plan.name
        from generate_series(1, row_item.qty) as u(unit_index);
      else
        select coalesce(sum(qty), 0) into allocated from bren_allocations
          where plan_id = row_plan.id and released_at is null;
        if row_plan.capacity - allocated < row_item.qty then
          raise exception using errcode = '23514', message = 'Insufficient seats. No payment or allocation was recorded.';
        end if;
        insert into bren_allocations (order_id, order_item_id, plan_id, qty, started_at, ends_at)
          values (target, row_item.id, row_item.plan_id, row_item.qty, now(),
            now() + make_interval(days => row_item.billing_days)) returning id into allocation_id;
        insert into bren_movements (plan_id, allocation_id, kind, delta, reason, actor_id)
          values (row_item.plan_id, allocation_id, 'allocation', -row_item.qty, 'Manual payment confirmed', actor);
      end if;
    end loop;
    if not exists (select 1 from bren_order_items where order_id = target) then
      raise exception using errcode = '23514', message = 'Order contains no items.';
    end if;
    if exists (select 1 from bren_payments where lower(btrim(reference)) = lower(reference_value)) then
      raise exception using errcode = '23505', message = 'Payment reference has already been recorded.';
    end if;
    insert into bren_payments (order_id, reference, amount_minor, currency, confirmed_by)
      values (target, reference_value, amount, chosen_currency, actor);
    update bren_orders set status = 'paid', payment_status = 'confirmed', updated_at = now() where id = target;
    insert into bren_order_events (order_id, actor_id, action, note)
      values (target, actor, 'payment_confirmed', case when exists (
        select 1 from bren_topup_deliveries where order_id = target)
        then 'Manual payment confirmed; top-up delivery queued.'
        else 'Manual payment confirmed; seats allocated.' end);
    perform bren_audit(action, actor, target, 'Confirmed ' || chosen_currency || ' ' || to_char(amount::numeric / 100, 'FM999999999999990.00'));

  elsif action in ('fulfill_order', 'cancel_order') then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(input, array['id', 'note']);
    target := bren_uuid(input, 'id');
    note_value := bren_text(input, 'note', 0, 2000, '');
    select * into row_order from bren_orders where id = target for update;
    if not found then raise exception using errcode = 'P0002', message = 'Order not found.'; end if;
    if action = 'fulfill_order' then
      if row_order.status <> 'paid' then
        raise exception using errcode = '23514', message = 'Only paid orders can be fulfilled.';
      end if;
      if exists (select 1 from bren_topup_deliveries where order_id = target and status in ('queued', 'processing')) then
        raise exception using errcode = '23514', message = 'Top-up deliveries are still in progress.';
      end if;
      state_value := 'fulfilled';
    else
      if row_order.status <> 'pending' then
        raise exception using errcode = '23514', message = 'Only unpaid pending orders can be cancelled.';
      end if;
      state_value := 'cancelled';
    end if;
    update bren_orders set status = state_value, updated_at = now() where id = target;
    insert into bren_order_events (order_id, actor_id, action, note)
      values (target, actor, state_value, 'Order ' || state_value || '.');
    if note_value <> '' then
      insert into bren_order_events (order_id, actor_id, action, note, internal)
        values (target, actor, 'staff_note', note_value, true);
    end if;
    perform bren_audit(action, actor, target, 'Order ' || state_value);

  elsif action = 'release_allocation' then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(input, array['id', 'reason']);
    target := bren_uuid(input, 'id');
    note_value := bren_text(input, 'reason', 1, 1000);
    select * into row_allocation from bren_allocations where id = target;
    if not found then raise exception using errcode = 'P0002', message = 'Allocation not found.'; end if;
    perform 1 from bren_plans where id = row_allocation.plan_id for update;
    select * into row_allocation from bren_allocations where id = target for update;
    if row_allocation.released_at is not null then
      raise exception using errcode = '23514', message = 'Allocation has already been released.';
    end if;
    update bren_allocations set released_at = now(), released_by = actor, release_reason = note_value where id = target;
    insert into bren_movements (plan_id, allocation_id, kind, delta, reason, actor_id)
      values (row_allocation.plan_id, target, 'release', row_allocation.qty, note_value, actor);
    insert into bren_order_events (order_id, actor_id, action, note, internal)
      values (row_allocation.order_id, actor, 'allocation_released', note_value, true);
    perform bren_audit(action, actor, target, 'Released allocation after manual access removal: ' || note_value);

  elsif action in ('add_order_note', 'add_customer_note') then
    perform bren_require_role(array['owner', 'manager', 'support']);
    perform bren_keys(input, array['id', 'note']);
    target := bren_uuid(input, 'id');
    note_value := bren_text(input, 'note', 1, 2000);
    if action = 'add_order_note' then
      if not exists (select 1 from bren_orders where id = target) then
        raise exception using errcode = 'P0002', message = 'Order not found.';
      end if;
      insert into bren_order_events (order_id, actor_id, action, note, internal)
        values (target, actor, 'staff_note', note_value, true);
    else
      if not exists (select 1 from bren_profiles where id = target) then
        raise exception using errcode = '22023', message = 'Customer not found.';
      end if;
      insert into bren_customer_notes (customer_id, actor_id, note) values (target, actor, note_value);
    end if;
    perform bren_audit(action, actor, target, 'Added internal note');

  elsif action = 'save_profile' then
    perform bren_keys(input, array['name', 'phone', 'telegram']);
    title := bren_text(input, 'name', 1, 160);
    phone_value := bren_text(input, 'phone', 0, 80, '');
    telegram_value := bren_text(input, 'telegram', 0, 80, '');
    target := actor;
    update bren_profiles set name = title, phone = phone_value, telegram = telegram_value,
      updated_at = now() where id = actor;

  elsif action = 'update_staff' then
    perform bren_keys(input, array['id', 'role', 'active']);
    target := bren_uuid(input, 'id');
    role_value := bren_text(input, 'role', 1, 20);
    active_value := bren_bool(input, 'active');
    if role_value not in ('owner', 'manager', 'support') then
      raise exception using errcode = '22023', message = 'Invalid staff role.';
    end if;
    -- Recheck the actor after waiting: another owner may have just suspended them.
    perform pg_advisory_xact_lock(73190523001);
    perform bren_require_role(array['owner']);
    select * into row_staff from bren_staff where id = target for update;
    if not found then raise exception using errcode = 'P0002', message = 'Staff member not found.'; end if;
    update bren_staff set role = role_value, active = active_value, updated_at = now() where id = target;
    perform bren_audit(action, actor, target, 'Staff role ' || role_value || ', active=' || active_value);

  elsif action = 'save_settings' then
    perform bren_require_role(array['owner']);
    perform bren_keys(input, array['store_name', 'telegram_url', 'manual_payment_instructions']);
    title := bren_text(input, 'store_name', 1, 160);
    telegram_value := bren_text(input, 'telegram_url', 0, 500, '');
    note_value := bren_text(input, 'manual_payment_instructions', 0, 10000, '');
    if telegram_value <> '' and telegram_value !~ '^https://t[.]me/[A-Za-z0-9_/?=&+-]+$' then
      raise exception using errcode = '22023', message = 'Telegram URL must use https://t.me/.';
    end if;
    update bren_settings set store_name = title, telegram_url = telegram_value,
      manual_payment_instructions = note_value, updated_at = now() where singleton;
    perform bren_audit(action, actor, null, 'Updated store settings');
    return '{}'::jsonb;
  else
    raise exception using errcode = '22023', message = 'Unknown action.';
  end if;
  return jsonb_build_object('id', target);
end;
$$;
revoke all on function public.bren_mutate(text, jsonb) from public, anon;
grant execute on function public.bren_mutate(text, jsonb) to authenticated;

create or replace function public.bren_read(resource text, args jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  actor uuid;
  actor_role text;
  page_number integer;
  page_limit integer;
  row_offset bigint;
  search_query text;
  state_filter text;
  kind_filter text;
  category_filter uuid;
  plan_filter uuid;
  target uuid;
  result jsonb;
  usd_total numeric;
  etb_total numeric;
begin
  perform bren_keys(args, array['page', 'page_size', 'query', 'status', 'kind', 'category_id', 'id', 'plan_id']);
  page_number := bren_int(args, 'page', 1, 1000000000, 1)::integer;
  page_limit := bren_int(args, 'page_size', 1, 100, 20)::integer;
  row_offset := (page_number::bigint - 1) * page_limit;
  search_query := lower(bren_text(args, 'query', 0, 200, ''));
  state_filter := bren_text(args, 'status', 0, 30, '');
  kind_filter := bren_text(args, 'kind', 0, 10, '');
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
    -- Provider linkage is staff-only; the public catalog never exposes provider_package_id.
    select coalesce(jsonb_agg(to_jsonb(p) - 'provider_package_id' order by p.featured desc, c.sort_order, p.name, p.id), '[]'::jsonb)
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
    if kind_filter not in ('', 'seat', 'topup') then
      raise exception using errcode = '22023', message = 'Invalid plan kind filter.';
    end if;
    with filtered as (
      select p.* from bren_plan_rows p
      where (state_filter = '' or p.status = state_filter)
        and (kind_filter = '' or p.kind = kind_filter)
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
        'description', i.description, 'qty', i.qty, 'unit_minor', i.unit_minor, 'billing_days', i.billing_days,
        'player_id', i.player_id)
        order by i.name, i.id), '[]'::jsonb) from bren_order_items i where order_id = target),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'actor_id', e.actor_id,
        'action', e.action, 'note', e.note, 'created_at', e.created_at) order by e.created_at, e.seq), '[]'::jsonb)
        from bren_order_events e where order_id = target
          and (not e.internal or actor_role in ('owner', 'manager', 'support'))),
      'payment', (select jsonb_build_object('reference', p.reference, 'amount_minor', p.amount_minor,
        'currency', p.currency, 'confirmed_by', p.confirmed_by, 'confirmed_at', p.confirmed_at)
        from bren_payments p where order_id = target),
      'deliveries', (select coalesce(jsonb_agg(
        case when actor_role in ('owner', 'manager', 'support') then
          jsonb_build_object('id', d.id, 'order_item_id', d.order_item_id, 'unit_index', d.unit_index,
            'player_id', d.player_id, 'package_id', d.package_id, 'package_name', d.package_name,
            'status', d.status, 'provider_order_id', d.provider_order_id, 'attempts', d.attempts,
            'last_error', d.last_error, 'delivered_at', d.delivered_at)
        else
          jsonb_build_object('id', d.id, 'order_item_id', d.order_item_id, 'unit_index', d.unit_index,
            'player_id', d.player_id, 'package_name', d.package_name, 'status', d.status,
            'delivered_at', d.delivered_at)
        end order by d.order_item_id, d.unit_index), '[]'::jsonb)
        from bren_topup_deliveries d where d.order_id = target)) into result;

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
      'low_stock', (select count(*) from bren_plan_rows where status = 'active'
        and available is not null and available <= low_stock_threshold),
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
