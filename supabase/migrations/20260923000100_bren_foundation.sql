-- LOCAL-PROVISIONAL: inspect the intended remote schema before deploying.
-- Deliberately fail on a naming collision rather than replace unknown objects.
create schema bren_private authorization postgres;
revoke all on schema bren_private from public, anon, authenticated, service_role;
alter default privileges in schema bren_private revoke execute on functions from public;
alter default privileges in schema bren_private revoke all on tables from public, anon, authenticated;

create table bren_private.bren_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  name text not null default '' check (length(name) <= 160),
  email text not null default '',
  phone text not null default '' check (length(phone) <= 80),
  telegram text not null default '' check (length(telegram) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table bren_private.bren_staff (
  id uuid primary key references bren_private.bren_profiles(id) on delete restrict,
  role text not null check (role in ('owner', 'manager', 'support')),
  active boolean not null default true,
  invited_at timestamptz,
  invited_by uuid references bren_private.bren_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table bren_private.bren_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  sort_order integer not null default 0 check (sort_order between -1000000 and 1000000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table bren_private.bren_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  description text not null default '' check (length(description) <= 5000),
  category_id uuid references bren_private.bren_categories(id) on delete restrict,
  brand_key text not null check (brand_key ~ '^[a-zA-Z0-9_-]{0,80}$'),
  initial text not null check (length(initial) between 1 and 8),
  color_start text not null check (color_start ~ '^#[0-9a-fA-F]{6}$'),
  color_end text not null check (color_end ~ '^#[0-9a-fA-F]{6}$'),
  usd_minor bigint check (usd_minor between 0 and 1000000000000),
  etb_minor bigint check (etb_minor between 0 and 1000000000000),
  usd_compare_minor bigint check (usd_compare_minor between 0 and 1000000000000),
  etb_compare_minor bigint check (etb_compare_minor between 0 and 1000000000000),
  billing_days integer not null check (billing_days between 1 and 3650),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  featured boolean not null default false,
  low_stock_threshold integer not null default 3 check (low_stock_threshold between 0 and 1000000),
  capacity integer not null default 0 check (capacity between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (usd_compare_minor is null or (usd_minor is not null and usd_compare_minor > usd_minor)),
  check (etb_compare_minor is null or (etb_minor is not null and etb_compare_minor > etb_minor)),
  check (status <> 'active' or (category_id is not null and usd_minor > 0 and etb_minor > 0
    and usd_minor is not null and etb_minor is not null))
);
create table bren_private.bren_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('BR-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  customer_id uuid not null references bren_private.bren_profiles(id) on delete restrict,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 160),
  phone text not null check (length(btrim(phone)) between 1 and 80),
  telegram text not null default '' check (length(telegram) <= 80),
  currency text not null check (currency in ('USD', 'ETB')),
  total_minor bigint not null check (total_minor between 1 and 450000000000000),
  status text not null default 'pending' check (status in ('pending', 'paid', 'fulfilled', 'cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'confirmed')),
  idempotency_key uuid not null,
  payload_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key),
  check ((status in ('pending', 'cancelled') and payment_status = 'pending')
    or (status in ('paid', 'fulfilled') and payment_status = 'confirmed'))
);
create table bren_private.bren_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references bren_private.bren_orders(id) on delete restrict,
  plan_id uuid not null references bren_private.bren_plans(id) on delete restrict,
  name text not null,
  description text not null,
  qty integer not null check (qty between 1 and 9),
  unit_minor bigint not null check (unit_minor between 1 and 1000000000000),
  billing_days integer not null check (billing_days between 1 and 3650),
  unique (order_id, plan_id)
);
create table bren_private.bren_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references bren_private.bren_orders(id) on delete restrict,
  method text not null default 'manual' check (method = 'manual'),
  reference text not null check (length(btrim(reference)) between 1 and 200),
  amount_minor bigint not null check (amount_minor between 1 and 450000000000000),
  currency text not null check (currency in ('USD', 'ETB')),
  confirmed_by uuid not null references bren_private.bren_profiles(id),
  confirmed_at timestamptz not null default now()
);
create unique index bren_payments_reference_unique
  on bren_private.bren_payments (method, lower(btrim(reference)));
create table bren_private.bren_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references bren_private.bren_orders(id) on delete restrict,
  order_item_id uuid not null unique references bren_private.bren_order_items(id) on delete restrict,
  plan_id uuid not null references bren_private.bren_plans(id) on delete restrict,
  qty integer not null check (qty between 1 and 9),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  released_at timestamptz,
  released_by uuid references bren_private.bren_profiles(id),
  release_reason text,
  check (ends_at > started_at),
  check ((released_at is null and released_by is null and release_reason is null) or
    (released_at is not null and released_by is not null and release_reason is not null
      and length(btrim(release_reason)) between 1 and 1000))
);
create table bren_private.bren_movements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references bren_private.bren_plans(id),
  allocation_id uuid references bren_private.bren_allocations(id),
  kind text not null check (kind in ('capacity', 'allocation', 'release')),
  delta integer not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  actor_id uuid not null references bren_private.bren_profiles(id),
  created_at timestamptz not null default now()
);
create table bren_private.bren_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references bren_private.bren_orders(id),
  actor_id uuid references bren_private.bren_profiles(id),
  action text not null,
  note text not null default '',
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create table bren_private.bren_customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references bren_private.bren_profiles(id),
  actor_id uuid not null references bren_private.bren_profiles(id),
  action text not null default 'customer_note',
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table bren_private.bren_activity (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_id uuid references bren_private.bren_profiles(id),
  entity_id uuid,
  summary text not null,
  created_at timestamptz not null default now()
);
create table bren_private.bren_settings (
  singleton boolean primary key default true check (singleton),
  store_name text not null default 'Brenstore' check (length(btrim(store_name)) between 1 and 160),
  telegram_url text not null default '' check (telegram_url = '' or telegram_url ~ '^https://t[.]me/[A-Za-z0-9_/?=&+-]+$'),
  manual_payment_instructions text not null default '' check (length(manual_payment_instructions) <= 10000),
  updated_at timestamptz not null default now()
);
insert into bren_private.bren_settings (singleton) values (true);

create index bren_orders_customer_date on bren_private.bren_orders (customer_id, created_at desc, id);
create index bren_orders_status_date on bren_private.bren_orders (status, created_at desc, id);
create index bren_plans_category_status on bren_private.bren_plans (category_id, status);
create index bren_allocations_active_plan on bren_private.bren_allocations (plan_id) where released_at is null;
create index bren_order_events_order on bren_private.bren_order_events (order_id, created_at, id);
create index bren_customer_notes_customer on bren_private.bren_customer_notes (customer_id, created_at, id);
create index bren_movements_plan_date on bren_private.bren_movements (plan_id, created_at desc, id);
create index bren_activity_date on bren_private.bren_activity (created_at desc, id);

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'bren_private' loop
    execute format('alter table bren_private.%I enable row level security', t.tablename);
    execute format('revoke all on bren_private.%I from public, anon, authenticated, service_role', t.tablename);
  end loop;
end;
$$;

create function bren_private.bren_require_actor() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from bren_profiles where id = actor) then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  return actor;
end;
$$;
create function bren_private.bren_role(actor uuid) returns text
language sql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
  select role from bren_staff where id = actor and active
$$;
create function bren_private.bren_require_role(allowed text[]) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare actor uuid := bren_require_actor();
begin
  if coalesce(bren_role(actor) = any(allowed), false) = false then
    raise exception using errcode = '42501', message = 'Permission denied.';
  end if;
  return actor;
end;
$$;
create function public.bren_my_role() returns text
language sql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
  select bren_role(auth.uid())
$$;
revoke all on function public.bren_my_role() from public, anon;
grant execute on function public.bren_my_role() to authenticated;

create function bren_private.bren_keys(data jsonb, allowed text[]) returns void
language plpgsql immutable set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  if data is null or jsonb_typeof(data) <> 'object' then
    raise exception using errcode = '22023', message = 'A JSON object is required.';
  end if;
  if exists (select 1 from jsonb_object_keys(data) k where not (k = any(allowed))) then
    raise exception using errcode = '22023', message = 'Unexpected input field.';
  end if;
end;
$$;
create function bren_private.bren_text(data jsonb, key text, min_len integer, max_len integer,
  fallback text default null) returns text
language plpgsql immutable set search_path = pg_catalog, bren_private, pg_temp as $$
declare value text;
begin
  if not (data ? key) or data -> key = 'null'::jsonb then value := fallback;
  elsif jsonb_typeof(data -> key) = 'string' then value := btrim(data ->> key);
  else raise exception using errcode = '22023', message = key || ' must be text.';
  end if;
  if value is null or length(value) not between min_len and max_len then
    raise exception using errcode = '22023', message = key || ' has an invalid length.';
  end if;
  return value;
end;
$$;
create function bren_private.bren_int(data jsonb, key text, minimum bigint, maximum bigint,
  fallback bigint default null, nullable boolean default false) returns bigint
language plpgsql immutable set search_path = pg_catalog, bren_private, pg_temp as $$
declare value numeric;
begin
  if not (data ? key) or data -> key = 'null'::jsonb then
    if nullable then return null; end if;
    value := fallback;
  elsif jsonb_typeof(data -> key) = 'number' then value := (data ->> key)::numeric;
  else raise exception using errcode = '22023', message = key || ' must be an integer.';
  end if;
  if value is null or value <> trunc(value) or value not between minimum and maximum then
    raise exception using errcode = '22023', message = key || ' is out of range.';
  end if;
  return value::bigint;
end;
$$;
create function bren_private.bren_bool(data jsonb, key text) returns boolean
language plpgsql immutable set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  if jsonb_typeof(data -> key) is distinct from 'boolean' then
    raise exception using errcode = '22023', message = key || ' must be a boolean.';
  end if;
  return (data ->> key)::boolean;
end;
$$;
create function bren_private.bren_uuid(data jsonb, key text, optional boolean default false) returns uuid
language plpgsql immutable set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  if optional and (not (data ? key) or data -> key = 'null'::jsonb) then return null; end if;
  if jsonb_typeof(data -> key) is distinct from 'string' or
    (data ->> key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = key || ' must be a UUID.';
  end if;
  return (data ->> key)::uuid;
end;
$$;
create function bren_private.bren_audit(action text, actor uuid, entity uuid, summary text) returns void
language sql volatile set search_path = pg_catalog, bren_private, pg_temp as $$
  insert into bren_activity (action, actor_id, entity_id, summary) values (action, actor, entity, summary)
$$;
create function bren_private.bren_immutable() returns trigger
language plpgsql set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  raise exception using errcode = '42501', message = 'Historical records are immutable.';
end;
$$;
create trigger bren_items_immutable before update or delete on bren_private.bren_order_items
  for each row execute function bren_private.bren_immutable();
create trigger bren_payments_immutable before update or delete on bren_private.bren_payments
  for each row execute function bren_private.bren_immutable();
create trigger bren_movements_immutable before update or delete on bren_private.bren_movements
  for each row execute function bren_private.bren_immutable();
create trigger bren_events_immutable before update or delete on bren_private.bren_order_events
  for each row execute function bren_private.bren_immutable();
create trigger bren_notes_immutable before update or delete on bren_private.bren_customer_notes
  for each row execute function bren_private.bren_immutable();
create trigger bren_activity_immutable before update or delete on bren_private.bren_activity
  for each row execute function bren_private.bren_immutable();

create function bren_private.bren_sync_auth_profile() returns trigger
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare display_name text;
begin
  display_name := case
    when jsonb_typeof(new.raw_user_meta_data -> 'full_name') = 'string' then new.raw_user_meta_data ->> 'full_name'
    when jsonb_typeof(new.raw_user_meta_data -> 'name') = 'string' then new.raw_user_meta_data ->> 'name'
    else null end;
  insert into bren_profiles (id, email, name)
    values (new.id, coalesce(new.email, ''), left(coalesce(display_name, ''), 160))
  on conflict (id) do update set email = excluded.email,
    name = case when display_name is not null then excluded.name else bren_profiles.name end,
    updated_at = now();
  return new;
end;
$$;
create trigger bren_sync_auth_profile after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function bren_private.bren_sync_auth_profile();
insert into bren_private.bren_profiles (id, email, name, created_at)
select id, coalesce(email, ''),
  left(coalesce(case when jsonb_typeof(raw_user_meta_data -> 'full_name') = 'string' then raw_user_meta_data ->> 'full_name'
    when jsonb_typeof(raw_user_meta_data -> 'name') = 'string' then raw_user_meta_data ->> 'name' end, ''), 160),
  coalesce(created_at, now())
from auth.users on conflict (id) do nothing;

create function bren_private.bren_staff_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  perform pg_advisory_xact_lock(73190523001);
  if old.active and old.role = 'owner' and
    (tg_op = 'DELETE' or not new.active or new.role <> 'owner') then
    if not exists (select 1 from bren_staff where active and role = 'owner' and id <> old.id) then
      raise exception using errcode = '23514', message = 'The last active owner cannot be removed.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger bren_staff_guard before update or delete on bren_private.bren_staff
  for each row execute function bren_private.bren_staff_guard();

create function public.bren_staff_lookup_email(email text) returns uuid
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  if email is null or length(btrim(email)) not between 3 and 320 then
    raise exception using errcode = '22023', message = 'Invalid email.';
  end if;
  return (select id from auth.users u where lower(u.email) = lower(btrim(bren_staff_lookup_email.email)) limit 1);
end;
$$;
create function public.bren_register_staff(user_id uuid, staff_role text, actor_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  perform pg_advisory_xact_lock(73190523001);
  if bren_role(actor_id) is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'An active owner must authorize invitations.';
  end if;
  if staff_role is null or staff_role not in ('owner', 'manager', 'support') then
    raise exception using errcode = '22023', message = 'Invalid staff role.';
  end if;
  if not exists (select 1 from bren_profiles where id = user_id) then
    raise exception using errcode = '22023', message = 'Auth user does not exist.';
  end if;
  if exists (select 1 from bren_staff where id = user_id) then
    raise exception using errcode = '23505', message = 'Staff member already exists; use team role management.';
  end if;
  insert into bren_staff (id, role, active, invited_at, invited_by)
    values (user_id, staff_role, true, now(), actor_id);
  perform bren_audit('staff_invited', actor_id, user_id, 'Invited staff as ' || staff_role);
end;
$$;
revoke all on function public.bren_staff_lookup_email(text) from public, anon, authenticated;
revoke all on function public.bren_register_staff(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.bren_staff_lookup_email(text) to service_role;
grant execute on function public.bren_register_staff(uuid, text, uuid) to service_role;
revoke all on all functions in schema bren_private from public, anon, authenticated, service_role;
