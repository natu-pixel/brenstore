create or replace function public.bren_mutate(action text, input jsonb default '{}'::jsonb) returns jsonb
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
  note_value text;
begin
  if action not in ('save_service', 'save_plan', 'delete_plan') then return bren_mutate_core(action, input); end if;
  actor := bren_require_actor();
  perform bren_require_role(array['owner', 'manager']);
  perform pg_advisory_xact_lock(73190523002);
  target := bren_uuid(input, 'id', true);
  if action = 'delete_plan' then
    perform bren_keys(input, array['id', 'name', 'note']);
    target := bren_uuid(input, 'id');
    note_value := bren_text(input, 'note', 1, 2000);
    perform bren_text(input, 'name', 1, 160);
    select * into previous from bren_plans where id = target for update;
    if not found then raise exception using errcode = 'P0002', message = 'Plan not found. Refresh the plan list.'; end if;
    if previous.name <> btrim(input->>'name') then
      raise exception using errcode = '23514', message = 'This plan was renamed. Refresh and review it before deleting.';
    end if;
    if previous.capacity <> 0
      or exists (select 1 from bren_order_items where plan_id = target)
      or exists (select 1 from bren_allocations where plan_id = target)
      or exists (select 1 from bren_movements where plan_id = target)
      or exists (select 1 from bren_topup_deliveries where plan_id = target) then
      raise exception using errcode = '23514',
        message = 'This plan has stock, orders or inventory history and cannot be deleted. Use Edit > Status > Archived to remove it from sale while preserving records.';
    end if;
    delete from bren_plans where id = target;
    perform bren_audit(action, actor, target, 'Deleted plan ' || previous.name || ': ' || note_value);
    return jsonb_build_object('id', target);
  end if;

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
notify pgrst, 'reload schema';
