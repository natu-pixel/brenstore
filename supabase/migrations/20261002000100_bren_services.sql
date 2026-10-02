-- Additive catalog relationships. Stock remains an independent pool per plan.
create table bren_private.bren_services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references bren_private.bren_categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 160),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  brand_key text not null check (brand_key ~ '^[a-zA-Z0-9_-]{0,80}$'),
  initial text not null check (length(initial) between 1 and 8),
  color_start text not null check (color_start ~ '^#[0-9a-fA-F]{6}$'),
  color_end text not null check (color_end ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, slug),
  unique (id, category_id)
);
alter table bren_private.bren_services enable row level security;
revoke all on bren_private.bren_services from public, anon, authenticated, service_role;

alter table bren_private.bren_plans
  add column service_id uuid,
  add column option_code text check (option_code in ('single_user', 'on_mail')),
  add column users_included integer check (users_included between 1 and 1000),
  add constraint bren_plan_service_category foreign key (service_id, category_id)
    references bren_private.bren_services(id, category_id) on delete restrict,
  add check (service_id is null or (kind = 'seat' and category_id is not null)),
  add check (option_code is null or service_id is not null),
  add check (option_code is not null or users_included is null),
  add check (option_code is distinct from 'single_user' or users_included = 1);

-- Only known explicit brands/exact aliases establish a legacy service link.
-- Descriptions, prices, capacities, IDs and historical snapshots are untouched.
with presets(key, name, aliases) as (values
  ('netflix', 'Netflix', array['netflix']),
  ('prime-video', 'Prime Video', array['prime video', 'amazon prime video']),
  ('disney-plus', 'Disney+', array['disney+', 'disney plus']),
  ('hbo', 'HBO Max', array['hbo max', 'hbo', 'max']),
  ('apple-tv', 'Apple TV+', array['apple tv+', 'apple tv plus', 'apple tv']),
  ('crunchyroll', 'Crunchyroll', array['crunchyroll']),
  ('paramount-plus', 'Paramount+', array['paramount+', 'paramount plus']),
  ('youtube', 'YouTube Premium', array['youtube premium', 'youtube'])
), matched as (
  select p.*, s.key, s.name as service_name,
    row_number() over (partition by p.category_id, s.key order by p.id) as position
  from bren_private.bren_plans p join presets s on lower(btrim(p.brand_key)) = s.key
    or (btrim(p.brand_key) = '' and lower(btrim(p.name)) = any(s.aliases))
  where p.kind = 'seat' and p.category_id is not null
)
insert into bren_private.bren_services (category_id, name, slug, brand_key, initial, color_start, color_end)
select category_id, service_name, key, key, initial, color_start, color_end from matched where position = 1;

update bren_private.bren_plans p set service_id = s.id
from bren_private.bren_services s
where p.category_id = s.category_id and p.kind = 'seat'
  and (lower(btrim(p.brand_key)) = s.brand_key or (btrim(p.brand_key) = '' and (
    lower(btrim(p.name)) = lower(s.name)
    or (s.brand_key = 'prime-video' and lower(btrim(p.name)) = 'amazon prime video')
    or (s.brand_key = 'disney-plus' and lower(btrim(p.name)) = 'disney plus')
    or (s.brand_key = 'hbo' and lower(btrim(p.name)) in ('hbo', 'max'))
    or (s.brand_key = 'apple-tv' and lower(btrim(p.name)) in ('apple tv', 'apple tv plus'))
    or (s.brand_key = 'paramount-plus' and lower(btrim(p.name)) = 'paramount plus')
    or (s.brand_key = 'youtube' and lower(btrim(p.name)) = 'youtube')
  )));

with classified as (
  select p.id, p.service_id, p.billing_days, p.status,
    case lower(btrim(p.name))
      when lower(s.name || ' - 1 user') then 'single_user'
      when lower(s.name || ' - On mail') then 'on_mail' end as code
  from bren_private.bren_plans p join bren_private.bren_services s on s.id = p.service_id
), counted as (
  select *, count(*) filter (where status <> 'archived')
    over (partition by service_id, code, billing_days) as duplicates from classified
)
update bren_private.bren_plans p set option_code = c.code,
  users_included = case when c.code = 'single_user' then 1 end
from counted c where p.id = c.id and c.code is not null and (c.duplicates <= 1 or c.status = 'archived');

create unique index bren_plan_service_option_term on bren_private.bren_plans(service_id, option_code, billing_days)
  where option_code is not null and status <> 'archived';
create index bren_plan_service on bren_private.bren_plans(service_id);

create or replace view bren_private.bren_plan_rows as
select p.id, p.name, p.slug, p.description, p.category_id, c.name as category_name,
  coalesce(s.brand_key, p.brand_key) as brand_key, coalesce(s.initial, p.initial) as initial,
  coalesce(s.color_start, p.color_start) as color_start, coalesce(s.color_end, p.color_end) as color_end,
  p.usd_minor, p.etb_minor, p.usd_compare_minor, p.etb_compare_minor, p.capacity,
  coalesce(a.allocated, 0)::integer as allocated,
  case when p.kind = 'topup' then null else (p.capacity - coalesce(a.allocated, 0))::integer end as available,
  p.low_stock_threshold, p.billing_days, p.status, p.featured, p.updated_at, p.kind, p.provider_package_id,
  p.service_id, s.name as service_name, p.option_code, p.users_included
from bren_private.bren_plans p
left join bren_private.bren_categories c on c.id = p.category_id
left join bren_private.bren_services s on s.id = p.service_id
left join (
  select plan_id, sum(qty) as allocated from bren_private.bren_allocations
  where released_at is null group by plan_id
) a on a.plan_id = p.id;

alter table bren_private.bren_order_items
  add column service_name text,
  add column option_code text,
  add column users_included integer;

create function bren_private.bren_snapshot_option() returns trigger
language plpgsql set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  select s.name, p.option_code, p.users_included into new.service_name, new.option_code, new.users_included
    from bren_plans p left join bren_services s on s.id = p.service_id where p.id = new.plan_id;
  return new;
end;
$$;
create trigger bren_order_option_snapshot before insert on bren_private.bren_order_items
  for each row execute function bren_private.bren_snapshot_option();

-- Keep the existing payment/top-up dispatcher intact as a private helper.
alter function public.bren_mutate(text, jsonb) set schema bren_private;
alter function bren_private.bren_mutate(text, jsonb) rename to bren_mutate_core;
revoke all on function bren_private.bren_mutate_core(text, jsonb) from public, anon, authenticated, service_role;
create function public.bren_mutate(action text, input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  actor uuid;
  target uuid;
  service uuid;
  category uuid;
  code text;
  included integer;
  previous bren_plans%rowtype;
  result jsonb;
begin
  if action not in ('save_service', 'save_plan') then return bren_mutate_core(action, input); end if;
  actor := bren_require_actor();
  perform bren_require_role(array['owner', 'manager']);
  perform pg_advisory_xact_lock(73190523002);
  target := bren_uuid(input, 'id', true);
  category := bren_uuid(input, 'category_id', true);
  if action = 'save_service' then
    perform bren_keys(input, array['id', 'name', 'slug', 'category_id', 'brand_key', 'initial', 'color_start', 'color_end']);
    if not exists (select 1 from bren_categories where id = category and not archived) then
      raise exception using errcode = '23514', message = 'Choose an active category for the service.';
    end if;
    perform bren_text(input, 'name', 1, 160);
    perform bren_text(input, 'initial', 1, 8);
    if bren_text(input, 'slug', 1, 120) !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or bren_text(input, 'brand_key', 0, 80) !~ '^[a-zA-Z0-9_-]*$'
      or bren_text(input, 'color_start', 7, 7) !~ '^#[0-9a-fA-F]{6}$'
      or bren_text(input, 'color_end', 7, 7) !~ '^#[0-9a-fA-F]{6}$' then
      raise exception using errcode = '22023', message = 'Invalid service slug or brand styling.';
    end if;
    if target is null then
      insert into bren_services (name, slug, category_id, brand_key, initial, color_start, color_end)
      values (btrim(input->>'name'), btrim(input->>'slug'), category, btrim(input->>'brand_key'),
        btrim(input->>'initial'), input->>'color_start', input->>'color_end') returning id into target;
    else
      if not exists (select 1 from bren_services where id = target) then
        raise exception using errcode = 'P0002', message = 'Service not found.';
      end if;
      if exists (select 1 from bren_plans where service_id = target and category_id <> category) then
        raise exception using errcode = '23514', message = 'Unlink existing plans before changing the service category.';
      end if;
      update bren_services set name = btrim(input->>'name'), slug = btrim(input->>'slug'), category_id = category,
        brand_key = btrim(input->>'brand_key'), initial = btrim(input->>'initial'),
        color_start = input->>'color_start', color_end = input->>'color_end', updated_at = now() where id = target;
    end if;
    perform bren_audit(action, actor, target, 'Saved service ' || btrim(input->>'name'));
    return jsonb_build_object('id', target);
  end if;

  select * into previous from bren_plans where id = target;
  -- Older clients may omit these fields; absence must not erase a saved relationship.
  service := case when input ? 'service_id' then bren_uuid(input, 'service_id', true) else previous.service_id end;
  code := case when input ? 'option_code' then nullif(bren_text(input, 'option_code', 0, 20, ''), '') else previous.option_code end;
  included := case when input ? 'users_included' then bren_int(input, 'users_included', 1, 1000, null, true)::integer else previous.users_included end;
  if service is not null and (coalesce(input->>'kind', 'seat') <> 'seat' or not exists (
    select 1 from bren_services where id = service and category_id = category
  )) then
    raise exception using errcode = '23514', message = 'The service must belong to the selected category; top-ups cannot use subscription options.';
  end if;
  if (code is not null and (service is null or code not in ('single_user', 'on_mail')))
    or (code is null and included is not null)
    or (code = 'single_user' and included is distinct from 1)
    or (code = 'on_mail' and included is null and (input ? 'option_code' or input ? 'users_included')) then
    raise exception using errcode = '23514', message = 'Choose a service and option, and enter users included (1 for the single-user option).';
  end if;
  if code is not null and input->>'status' <> 'archived' and exists (
    select 1 from bren_plans where service_id = service and option_code = code
      and billing_days = bren_int(input, 'billing_days', 1, 3650)
      and status <> 'archived' and id is distinct from target
  ) then
    raise exception using errcode = '23514', message = 'This service already has that option and billing term. Edit it or archive it first.';
  end if;
  -- Detach within this transaction so category/type edits can be validated by the core.
  update bren_plans set service_id = null, option_code = null, users_included = null where id = target;
  result := bren_mutate_core(action, input - array['service_id', 'option_code', 'users_included']);
  target := (result->>'id')::uuid;
  update bren_plans set service_id = service, option_code = code, users_included = included where id = target;
  return result;
end;
$$;
revoke all on function public.bren_mutate(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_mutate(text, jsonb) to authenticated;

alter function public.bren_read(text, jsonb) set schema bren_private;
alter function bren_private.bren_read(text, jsonb) rename to bren_read_core;
revoke all on function bren_private.bren_read_core(text, jsonb) from public, anon, authenticated, service_role;
create function public.bren_read(resource text, args jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  result jsonb;
  service uuid;
  category uuid;
  target uuid;
  page_number integer;
  page_limit integer;
  search_query text;
  state_filter text;
begin
  if resource = 'services' or (resource = 'plans' and args ? 'service_id') then
    perform bren_require_role(array['owner', 'manager']);
    perform bren_keys(args, array['page', 'page_size', 'query', 'category_id', 'service_id', 'id', 'status']);
    service := bren_uuid(args, 'service_id', true);
    target := bren_uuid(args, 'id', true);
    category := case when args->>'category_id' = '' then null else bren_uuid(args, 'category_id', true) end;
    page_number := bren_int(args, 'page', 1, 1000000000, 1)::integer;
    page_limit := bren_int(args, 'page_size', 1, 100, 20)::integer;
    search_query := lower(bren_text(args, 'query', 0, 200, ''));
    state_filter := bren_text(args, 'status', 0, 30, '');
    if state_filter not in ('', 'draft', 'active', 'archived') then
      raise exception using errcode = '22023', message = 'Invalid plan status filter.';
    end if;
    if resource = 'services' then
      with filtered as (
        select s.*, c.name as category_name from bren_services s join bren_categories c on c.id = s.category_id
        where (category is null or s.category_id = category) and (target is null or s.id = target)
          and (search_query = '' or strpos(lower(s.name || ' ' || s.slug), search_query) > 0)
      ), paged as (select * from filtered order by name, id limit page_limit offset (page_number::bigint - 1) * page_limit)
      select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by name, id) from paged p), '[]'::jsonb),
        'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;
    else
      if service is null then raise exception using errcode = '22023', message = 'Service id is required.'; end if;
      with filtered as (
        select * from bren_plan_rows p where p.service_id = service
          and (category is null or p.category_id = category)
          and (state_filter = '' or p.status = state_filter)
          and (search_query = '' or strpos(lower(p.name || ' ' || p.slug), search_query) > 0)
      ), paged as (select * from filtered order by option_code, billing_days, id limit page_limit offset (page_number::bigint - 1) * page_limit)
      select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by option_code, billing_days, id) from paged p), '[]'::jsonb),
        'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_limit) into result;
    end if;
    return result;
  end if;
  result := bren_read_core(resource, args);
  if resource = 'order' then
    -- Ownership is checked by the core before reading the immutable option snapshots.
    select jsonb_set(result, '{items}', coalesce(jsonb_agg(item || jsonb_build_object(
      'service_name', i.service_name, 'option_code', i.option_code, 'users_included', i.users_included
    ) order by ordinal), '[]'::jsonb)) into result
    from jsonb_array_elements(result->'items') with ordinality as elements(item, ordinal)
    join bren_order_items i on i.id = (item->>'id')::uuid;
  end if;
  return result;
end;
$$;
revoke all on function public.bren_read(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_read(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
