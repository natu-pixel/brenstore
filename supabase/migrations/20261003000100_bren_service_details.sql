-- Storefront presentation for services: badge, copy, features, requirements and notes.
-- Additive only; plans, stock, orders and snapshots are unchanged.
alter table bren_private.bren_services
  add column badge text check (badge in ('recommended', 'popular', 'premium')),
  add column tagline text not null default '' check (length(tagline) <= 160),
  add column description text not null default '' check (length(description) <= 4000),
  add column features text[] not null default '{}' check (cardinality(features) <= 30),
  add column requirements text[] not null default '{}' check (cardinality(requirements) <= 30),
  add column notes text not null default '' check (length(notes) <= 2000);

create function bren_private.bren_text_list(data jsonb, key text) returns text[]
language plpgsql immutable set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  result text[];
begin
  if not (data ? key) or data -> key = 'null'::jsonb then return '{}'; end if;
  if jsonb_typeof(data -> key) <> 'array' or jsonb_array_length(data -> key) > 30
    or exists (select 1 from jsonb_array_elements(data -> key) e
      where jsonb_typeof(e) <> 'string' or length(btrim(e #>> '{}')) not between 1 and 300) then
    raise exception using errcode = '22023', message = key || ' must be up to 30 items of 1-300 characters.';
  end if;
  select coalesce(array_agg(btrim(e) order by ordinal), '{}') into result
    from jsonb_array_elements_text(data -> key) with ordinality as items(e, ordinal);
  return result;
end;
$$;
revoke all on function bren_private.bren_text_list(jsonb, text) from public, anon, authenticated, service_role;

alter function public.bren_mutate(text, jsonb) set schema bren_private;
alter function bren_private.bren_mutate(text, jsonb) rename to bren_mutate_catalog;
revoke all on function bren_private.bren_mutate_catalog(text, jsonb) from public, anon, authenticated, service_role;
create function public.bren_mutate(action text, input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  actor uuid;
  target uuid;
  badge_value text;
begin
  if action <> 'save_service_details' then return bren_mutate_catalog(action, input); end if;
  actor := bren_require_actor();
  perform bren_require_role(array['owner', 'manager']);
  perform pg_advisory_xact_lock(73190523002);
  perform bren_keys(input, array['id', 'badge', 'tagline', 'description', 'features', 'requirements', 'notes']);
  target := bren_uuid(input, 'id');
  badge_value := nullif(bren_text(input, 'badge', 0, 20, ''), '');
  if badge_value not in ('recommended', 'popular', 'premium') then
    raise exception using errcode = '22023', message = 'Choose Recommended, Popular, Premium or no badge.';
  end if;
  update bren_services set badge = badge_value,
    tagline = bren_text(input, 'tagline', 0, 160, ''),
    description = bren_text(input, 'description', 0, 4000, ''),
    features = bren_text_list(input, 'features'),
    requirements = bren_text_list(input, 'requirements'),
    notes = bren_text(input, 'notes', 0, 2000, ''),
    updated_at = now()
  where id = target;
  if not found then raise exception using errcode = 'P0002', message = 'Service not found.'; end if;
  perform bren_audit(action, actor, target, 'Saved storefront details for ' || (select name from bren_services where id = target));
  return jsonb_build_object('id', target);
end;
$$;
revoke all on function public.bren_mutate(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_mutate(text, jsonb) to authenticated;

alter function public.bren_read(text, jsonb) set schema bren_private;
alter function bren_private.bren_read(text, jsonb) rename to bren_read_catalog;
revoke all on function bren_private.bren_read_catalog(text, jsonb) from public, anon, authenticated, service_role;
create function public.bren_read(resource text, args jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  result jsonb;
begin
  if resource <> 'public_services' then return bren_read_catalog(resource, args); end if;
  perform bren_keys(args, array[]::text[]);
  -- Only services with at least one published plan are visible to the public.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'slug', s.slug, 'category_id', s.category_id, 'category_name', c.name,
    'brand_key', s.brand_key, 'initial', s.initial, 'color_start', s.color_start, 'color_end', s.color_end,
    'badge', s.badge, 'tagline', s.tagline, 'description', s.description,
    'features', to_jsonb(s.features), 'requirements', to_jsonb(s.requirements), 'notes', s.notes
  ) order by c.sort_order, s.name, s.id), '[]'::jsonb) into result
  from bren_services s join bren_categories c on c.id = s.category_id
  where not c.archived and exists (select 1 from bren_plans p where p.service_id = s.id and p.status = 'active');
  return result;
end;
$$;
revoke all on function public.bren_read(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_read(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
