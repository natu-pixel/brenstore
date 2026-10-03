-- Owners can remove team members. Staff access is always removed; a never-accepted invitation
-- (no sign-in, no store history) also deletes the pending Auth account so its link stops working.
alter function public.bren_mutate(text, jsonb) set schema bren_private;
alter function bren_private.bren_mutate(text, jsonb) rename to bren_mutate_details;
revoke all on function bren_private.bren_mutate_details(text, jsonb) from public, anon, authenticated, service_role;
create function public.bren_mutate(action text, input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  actor uuid;
  target uuid;
  staff_row bren_staff%rowtype;
  target_email text;
  pending boolean;
  deleted boolean := false;
begin
  if action <> 'remove_staff' then return bren_mutate_details(action, input); end if;
  actor := bren_require_actor();
  perform bren_keys(input, array['id', 'email']);
  target := bren_uuid(input, 'id');
  -- Same lock as role changes and the last-owner guard; recheck the actor after waiting.
  perform pg_advisory_xact_lock(73190523001);
  perform bren_require_role(array['owner']);
  if target = actor then
    raise exception using errcode = '23514', message = 'You cannot remove yourself. Another owner must remove your access.';
  end if;
  select * into staff_row from bren_staff where id = target for update;
  if not found then raise exception using errcode = 'P0002', message = 'Team member not found.'; end if;
  select email into target_email from bren_profiles where id = target;
  if input ? 'email' and lower(bren_text(input, 'email', 0, 320, '')) is distinct from lower(coalesce(target_email, '')) then
    raise exception using errcode = '23514', message = 'This team member changed. Reload the team list and try again.';
  end if;
  select u.last_sign_in_at is null into pending from auth.users u where u.id = target;
  delete from bren_staff where id = target;
  if coalesce(pending, false) then
    begin
      delete from bren_profiles where id = target;
      delete from auth.users where id = target;
      deleted := true;
    exception when foreign_key_violation then
      deleted := false;
    end;
  end if;
  perform bren_audit(action, actor, target, 'Removed ' || staff_row.role || ' ' || coalesce(nullif(target_email, ''), target::text)
    || case when deleted then '; pending invitation cancelled' else '; sign-in kept as a customer account' end);
  return jsonb_build_object('id', target, 'account_deleted', deleted);
end;
$$;
revoke all on function public.bren_mutate(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_mutate(text, jsonb) to authenticated;

alter function public.bren_read(text, jsonb) set schema bren_private;
alter function bren_private.bren_read(text, jsonb) rename to bren_read_details;
revoke all on function bren_private.bren_read_details(text, jsonb) from public, anon, authenticated, service_role;
create function public.bren_read(resource text, args jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  result jsonb;
begin
  -- The core read enforces the Owner-only team permission before rows are enriched.
  result := bren_read_details(resource, args);
  if resource = 'team' then
    select jsonb_set(result, '{rows}', coalesce(jsonb_agg(item || jsonb_build_object(
      'pending', coalesce((select u.last_sign_in_at is null from auth.users u where u.id = (item->>'id')::uuid), false)
    ) order by ordinal), '[]'::jsonb)) into result
    from jsonb_array_elements(result->'rows') with ordinality as rows(item, ordinal);
  end if;
  return result;
end;
$$;
revoke all on function public.bren_read(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_read(text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
