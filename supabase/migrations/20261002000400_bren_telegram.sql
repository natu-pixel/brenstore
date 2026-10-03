create table bren_private.bren_telegram_requests (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text not null check (telegram_user_id ~ '^[1-9][0-9]{0,15}$'),
  name text not null,
  username text not null,
  token_hash bytea not null unique,
  customer_id uuid references bren_private.bren_profiles(id),
  state text not null default 'pending' check (state in ('pending', 'approved', 'connected', 'rejected', 'superseded', 'revoked')),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);
create index bren_telegram_requests_user on bren_private.bren_telegram_requests(telegram_user_id);
create table bren_private.bren_telegram_links (
  telegram_user_id text primary key check (telegram_user_id ~ '^[1-9][0-9]{0,15}$'),
  customer_id uuid not null unique references bren_private.bren_profiles(id),
  request_id uuid not null unique references bren_private.bren_telegram_requests(id),
  name text not null,
  username text not null,
  linked_at timestamptz not null default now()
);
create table bren_private.bren_telegram_limits (
  bucket text primary key,
  count integer not null,
  resets_at timestamptz not null
);
create index bren_telegram_limits_expiry on bren_private.bren_telegram_limits(resets_at);
alter table bren_private.bren_telegram_requests enable row level security;
alter table bren_private.bren_telegram_links enable row level security;
alter table bren_private.bren_telegram_limits enable row level security;
revoke all on bren_private.bren_telegram_requests, bren_private.bren_telegram_links,
  bren_private.bren_telegram_limits from public, anon, authenticated, service_role;

create function bren_private.bren_telegram_limit(key text, maximum integer, seconds integer) returns integer
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare counter bren_telegram_limits%rowtype;
begin
  delete from bren_telegram_limits where resets_at < now() - interval '1 day';
  insert into bren_telegram_limits as l (bucket, count, resets_at)
    values (key, 1, now() + make_interval(secs => seconds))
  on conflict (bucket) do update set
    count = case when l.resets_at <= now() then 1 else least(l.count + 1, maximum + 1) end,
    resets_at = case when l.resets_at <= now() then excluded.resets_at else l.resets_at end
  returning * into counter;
  return case when counter.count > maximum
    then greatest(1, ceil(extract(epoch from counter.resets_at - now()))::integer) else 0 end;
end;
$$;

create function public.bren_bot_allow(telegram_user_id text, link_start boolean) returns integer
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare retry integer; user_retry integer;
begin
  if telegram_user_id is null or telegram_user_id !~ '^[1-9][0-9]{0,15}$' then
    raise exception using errcode = '22023', message = 'Invalid Telegram user ID.';
  end if;
  retry := bren_telegram_limit('bot:global', 600, 60);
  user_retry := bren_telegram_limit('bot:' || telegram_user_id, 60, 60);
  retry := greatest(retry, user_retry);
  if link_start then
    user_retry := bren_telegram_limit('start:' || telegram_user_id, 5, 600);
    retry := greatest(retry, user_retry);
  end if;
  return retry;
end;
$$;
revoke all on function public.bren_bot_allow(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.bren_bot_allow(text, boolean) to service_role;

create function bren_private.bren_telegram_request_state(r bren_private.bren_telegram_requests) returns text
language sql stable set search_path = pg_catalog as $$
  select case when r.state in ('pending', 'approved') and r.expires_at <= now() then 'expired' else r.state end
$$;

create function public.bren_telegram(op text, input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  actor uuid := bren_require_actor();
  request bren_telegram_requests%rowtype;
  connection bren_telegram_links%rowtype;
  token text;
  state_value text;
begin
  if bren_telegram_limit('web:' || actor::text, 60, 60) > 0 then
    raise exception using errcode = 'PT429', message = 'Too many connection requests. Wait a minute and retry.';
  end if;
  perform pg_advisory_xact_lock(73190523003);
  if op in ('status', 'unlink') then
    perform bren_keys(input, array[]::text[]);
    select * into connection from bren_telegram_links where customer_id = actor;
    if op = 'unlink' then
      delete from bren_telegram_links where customer_id = actor;
      update bren_telegram_requests set state = 'revoked'
        where customer_id = actor and state in ('pending', 'approved', 'connected');
      perform bren_audit('telegram_unlink', actor, null, 'Disconnected Telegram access');
      return jsonb_build_object('linked', false, 'connection', null);
    end if;
    return jsonb_build_object('linked', connection.customer_id is not null,
      'connection', case when connection.customer_id is not null then jsonb_build_object(
        'name', connection.name, 'username', connection.username, 'linked_at', connection.linked_at) else null end);
  end if;
  if op not in ('preview', 'approve', 'reject') or op is null then
    raise exception using errcode = '22023', message = 'Unknown connection operation.';
  end if;
  perform bren_keys(input, array['token']);
  token := bren_text(input, 'token', 43, 43);
  if token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '22023', message = 'Invalid connection link.';
  end if;
  select * into request from bren_telegram_requests where token_hash = sha256(convert_to(token, 'UTF8'));
  if not found or (request.customer_id is not null and request.customer_id <> actor) then
    raise exception using errcode = 'PT410', message = 'This connection link is unavailable. Start again in your bot.';
  end if;
  state_value := bren_telegram_request_state(request);
  if op <> 'preview' then
    if state_value not in ('pending', 'approved') then
      raise exception using errcode = 'PT410', message = 'This connection link is no longer active. Start again in your bot.';
    end if;
    if op = 'approve' and exists (select 1 from bren_telegram_links
      where customer_id = actor or telegram_user_id = request.telegram_user_id) then
      raise exception using errcode = 'PT409', message = 'An account is already connected. Disconnect it before linking another.';
    end if;
    state_value := case op when 'approve' then 'approved' else 'rejected' end;
    update bren_telegram_requests set customer_id = actor, state = state_value where id = request.id;
    perform bren_audit('telegram_' || op, actor, request.id, 'Telegram connection ' || state_value);
  end if;
  return jsonb_build_object('state', state_value, 'name', request.name, 'username', request.username,
    'expires_at', request.expires_at);
end;
$$;
revoke all on function public.bren_telegram(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_telegram(text, jsonb) to authenticated;

create function bren_private.bren_bot_order_summary(o bren_private.bren_orders) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object('id', o.id, 'reference', o.reference, 'currency', o.currency,
    'total_minor', o.total_minor, 'status', o.status, 'payment_status', o.payment_status,
    'source', o.source, 'created_at', o.created_at, 'updated_at', o.updated_at)
$$;

create function public.bren_bot(op text, telegram_user_id text, input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, bren_private, pg_temp as $$
declare
  tg text := telegram_user_id;
  request bren_telegram_requests%rowtype;
  connection bren_telegram_links%rowtype;
  row_order bren_orders%rowtype;
  target uuid;
  token text;
  state_value text;
  page_number integer;
  page_limit integer;
  result jsonb;
begin
  if tg is null or tg !~ '^[1-9][0-9]{0,15}$' then
    raise exception using errcode = '22023', message = 'Invalid Telegram user ID.';
  end if;
  if op not in ('link.start', 'link.status', 'link.confirm', 'account.status', 'catalog.list',
    'order.create', 'order.list', 'order.get') or op is null then
    raise exception using errcode = '22023', message = 'Unknown bot operation.';
  end if;
  if op like 'link.%' then
    perform pg_advisory_xact_lock(73190523003);
    if op = 'link.start' then
      perform bren_keys(input, array['token', 'name', 'username']);
      token := bren_text(input, 'token', 43, 43);
      if token !~ '^[A-Za-z0-9_-]{43}$' then
        raise exception using errcode = '22023', message = 'Invalid connection token.';
      end if;
      if exists (select 1 from bren_telegram_links l where l.telegram_user_id = tg) then
        raise exception using errcode = 'PT409', message = 'Disconnect the existing account on the website first.', detail = 'LINK_CONFLICT';
      end if;
      update bren_telegram_requests r set state = 'superseded'
        where r.telegram_user_id = tg and r.state in ('pending', 'approved');
      insert into bren_telegram_requests (telegram_user_id, name, username, token_hash)
        values (tg, bren_text(input, 'name', 0, 128, ''), bren_text(input, 'username', 0, 80, ''),
          sha256(convert_to(token, 'UTF8'))) returning * into request;
      return jsonb_build_object('request_id', request.id, 'expires_at', request.expires_at);
    end if;
    perform bren_keys(input, array['request_id']);
    target := bren_uuid(input, 'request_id');
    select * into request from bren_telegram_requests r where r.id = target and r.telegram_user_id = tg;
    if not found then
      raise exception using errcode = 'PT410', message = 'Connection request unavailable. Start again.', detail = 'LINK_UNAVAILABLE';
    end if;
    state_value := bren_telegram_request_state(request);
    if op = 'link.confirm' then
      if state_value = 'connected' and exists (
        select 1 from bren_telegram_links l where l.request_id = request.id and l.telegram_user_id = tg
      ) then
        return jsonb_build_object('request_id', request.id, 'state', 'connected', 'expires_at', request.expires_at,
          'customer_name', (select name from bren_profiles where id = request.customer_id));
      end if;
      if state_value = 'pending' then
        raise exception using errcode = 'PT409', message = 'Approve this request on the website first.', detail = 'LINK_NOT_APPROVED';
      end if;
      if state_value <> 'approved' then
        raise exception using errcode = 'PT410', message = 'Connection request no longer active. Start again.', detail = 'LINK_UNAVAILABLE';
      end if;
      if exists (select 1 from bren_telegram_links l where l.telegram_user_id = tg or l.customer_id = request.customer_id) then
        raise exception using errcode = 'PT409', message = 'An account is already connected. Disconnect it first.', detail = 'LINK_CONFLICT';
      end if;
      insert into bren_telegram_links (telegram_user_id, customer_id, request_id, name, username)
        values (tg, request.customer_id, request.id, request.name, request.username);
      update bren_telegram_requests set state = 'connected' where id = request.id;
      state_value := 'connected';
      perform bren_audit('telegram_link', request.customer_id, request.id, 'Connected Telegram access');
    end if;
    return jsonb_build_object('request_id', request.id, 'state', state_value, 'expires_at', request.expires_at,
      'customer_name', case when state_value in ('approved', 'connected')
        then (select name from bren_profiles where id = request.customer_id) else null end);
  end if;

  if op = 'catalog.list' then
    perform bren_keys(input, array[]::text[]);
    return jsonb_build_object('categories', public.bren_read('public_categories'),
      'plans', public.bren_read('catalog'));
  end if;
  -- Hold the active link through reads/creation; unlink must wait for this transaction.
  select * into connection from bren_telegram_links l where l.telegram_user_id = tg for share;
  if op = 'account.status' then
    perform bren_keys(input, array[]::text[]);
    return jsonb_build_object('linked', connection.customer_id is not null, 'customer_name',
      case when connection.customer_id is not null then (select name from bren_profiles where id = connection.customer_id) else null end);
  end if;
  if connection.customer_id is null then
    raise exception using errcode = 'PT403', message = 'Connect your website account before ordering.', detail = 'ACCOUNT_NOT_LINKED';
  end if;
  if op = 'order.create' then
    result := bren_create_order(connection.customer_id, input, 'telegram');
    target := (result->>'id')::uuid;
  elsif op = 'order.list' then
    perform bren_keys(input, array['page', 'page_size']);
    page_number := bren_int(input, 'page', 1, 1000000000, 1)::integer;
    page_limit := bren_int(input, 'page_size', 1, 100, 20)::integer;
    select jsonb_build_object('rows', coalesce(jsonb_agg(summary order by created_at desc, id desc), '[]'::jsonb),
      'total', (select count(*) from bren_orders where customer_id = connection.customer_id),
      'page', page_number, 'page_size', page_limit) into result
    from (select id, created_at, bren_bot_order_summary(o) as summary from bren_orders o
      where customer_id = connection.customer_id order by created_at desc, id desc
      limit page_limit offset (page_number::bigint - 1) * page_limit) page;
    return result;
  else
    perform bren_keys(input, array['id']);
    target := bren_uuid(input, 'id');
  end if;
  select * into row_order from bren_orders where id = target and customer_id = connection.customer_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'Order not found.', detail = 'NOT_FOUND';
  end if;
  return jsonb_build_object('order', bren_bot_order_summary(row_order),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'plan_id', i.plan_id, 'name', i.name, 'qty', i.qty, 'unit_minor', i.unit_minor,
      'billing_days', i.billing_days, 'service_name', i.service_name, 'option_code', i.option_code,
      'users_included', i.users_included) order by i.name, i.id), '[]'::jsonb)
      from bren_order_items i where order_id = target),
    'deliveries', (select jsonb_build_object('total', count(*),
      'delivered', count(*) filter (where status = 'delivered'), 'failed', count(*) filter (where status = 'failed'))
      from bren_topup_deliveries where order_id = target),
    'payment_instructions', (select manual_payment_instructions from bren_settings where singleton));
end;
$$;
revoke all on function public.bren_bot(text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bren_bot(text, text, jsonb) to service_role;
notify pgrst, 'reload schema';
