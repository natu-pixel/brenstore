create function public.bren_mutate(action text, input jsonb default '{}'::jsonb) returns jsonb
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
      'billing_days', 'status', 'featured', 'low_stock_threshold']);
    target := bren_uuid(input, 'id', true);
    category := bren_uuid(input, 'category_id', true);
    title := bren_text(input, 'name', 1, 160);
    slug_value := bren_text(input, 'slug', 1, 120);
    description_value := bren_text(input, 'description', 0, 5000, '');
    state_value := bren_text(input, 'status', 1, 20);
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
        usd_minor, etb_minor, usd_compare_minor, etb_compare_minor, billing_days, status, featured, low_stock_threshold)
      values (title, slug_value, description_value, category, btrim(input ->> 'brand_key'), btrim(input ->> 'initial'),
        btrim(input ->> 'color_start'), btrim(input ->> 'color_end'), usd, etb, usd_compare, etb_compare,
        (input ->> 'billing_days')::integer, state_value, (input ->> 'featured')::boolean,
        (input ->> 'low_stock_threshold')::integer) returning id into target;
    else
      perform 1 from bren_plans where id = target for update;
      if not found then raise exception using errcode = 'P0002', message = 'Plan not found.'; end if;
      update bren_plans set name = title, slug = slug_value, description = description_value, category_id = category,
        brand_key = btrim(input ->> 'brand_key'), initial = btrim(input ->> 'initial'),
        color_start = btrim(input ->> 'color_start'), color_end = btrim(input ->> 'color_end'),
        usd_minor = usd, etb_minor = etb, usd_compare_minor = usd_compare, etb_compare_minor = etb_compare,
        billing_days = (input ->> 'billing_days')::integer, status = state_value,
        featured = (input ->> 'featured')::boolean, low_stock_threshold = (input ->> 'low_stock_threshold')::integer,
        updated_at = now() where id = target;
    end if;
    perform bren_audit(action, actor, target, 'Saved plan ' || title);

  elsif action = 'adjust_capacity' then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(input, array['plan_id', 'capacity', 'reason']);
    target := bren_uuid(input, 'plan_id');
    capacity_value := bren_int(input, 'capacity', 0, 1000000)::integer;
    note_value := bren_text(input, 'reason', 1, 1000);
    select capacity into old_capacity from bren_plans where id = target for update;
    if not found then raise exception using errcode = 'P0002', message = 'Plan not found.'; end if;
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
      perform bren_keys(item, array['plan_id', 'qty', 'unit_minor']);
      canonical_items := canonical_items || jsonb_build_array(jsonb_build_object(
        'plan_id', bren_uuid(item, 'plan_id'), 'qty', bren_int(item, 'qty', 1, 9),
        'unit_minor', bren_int(item, 'unit_minor', 1, 1000000000000)));
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
    for item in select value from jsonb_array_elements(canonical_items) loop
      select * into row_plan from bren_plans where id = (item ->> 'plan_id')::uuid;
      if not found or row_plan.status <> 'active' or not exists (
        select 1 from bren_categories where id = row_plan.category_id and not archived) then
        raise exception using errcode = '23514', message = 'A selected plan is not available for ordering.';
      end if;
      quantity := (item ->> 'qty')::integer;
      price := case chosen_currency when 'USD' then row_plan.usd_minor else row_plan.etb_minor end;
      if price is null or price <= 0 or price <> (item ->> 'unit_minor')::bigint then
        raise exception using errcode = '23514', message = 'A price changed. Review your cart before submitting again.';
      end if;
      select coalesce(sum(qty), 0) into allocated from bren_allocations
        where plan_id = row_plan.id and released_at is null;
      if row_plan.capacity - allocated < quantity then
        raise exception using errcode = '23514', message = 'Insufficient seats for a selected plan.';
      end if;
      total := total + price * quantity;
    end loop;
    insert into bren_orders (customer_id, customer_name, phone, telegram, currency, total_minor,
      idempotency_key, payload_fingerprint)
    values (actor, title, phone_value, telegram_value, chosen_currency, total, order_key, fingerprint)
      returning id into target;
    insert into bren_order_items (order_id, plan_id, name, description, qty, unit_minor, billing_days)
    select target, p.id, p.name, p.description, (v.value ->> 'qty')::integer,
      case chosen_currency when 'USD' then p.usd_minor else p.etb_minor end, p.billing_days
    from jsonb_array_elements(canonical_items) v join bren_plans p on p.id = (v.value ->> 'plan_id')::uuid;
    insert into bren_order_events (order_id, actor_id, action, note)
      values (target, actor, 'created', 'Order submitted. Pending orders do not reserve seats.');
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
        and row_payment.currency = chosen_currency then return jsonb_build_object('id', target); end if;
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
      values (target, actor, 'payment_confirmed', 'Manual payment confirmed; seats allocated.');
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
        raise exception using errcode = 'P0002', message = 'Customer not found.';
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
