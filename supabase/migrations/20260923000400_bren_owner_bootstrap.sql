-- Deliberate operator-only bootstrap, never exposed as a client or service-role RPC.
create function bren_private.bootstrap_owner(user_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
begin
  perform pg_advisory_xact_lock(73190523001);
  if exists (select 1 from bren_staff where role = 'owner' and active) then
    raise exception using errcode = '23514', message = 'An active owner already exists.';
  end if;
  if user_id is null or not exists (select 1 from auth.users u where u.id = user_id) then
    raise exception using errcode = '22023', message = 'Auth user does not exist.';
  end if;
  if not exists (select 1 from auth.users u where u.id = user_id
    and u.email_confirmed_at is not null and coalesce(u.email, '') <> '') then
    raise exception using errcode = '23514', message = 'Owner bootstrap requires a confirmed email.';
  end if;
  if exists (select 1 from bren_staff where id = user_id) then
    raise exception using errcode = '23505', message = 'Staff member already exists; use deliberate privileged recovery.';
  end if;
  insert into bren_staff (id, role, active) values (user_id, 'owner', true);
  perform bren_audit('owner_bootstrap', user_id, user_id, 'Deliberate first-owner bootstrap');
end;
$$;
revoke all on function bren_private.bootstrap_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function bren_private.bootstrap_owner(uuid) to postgres;
