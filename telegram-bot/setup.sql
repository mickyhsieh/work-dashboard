-- Telegram 收集：按鈕待確認 + 原子追加（任務／私人行程／會議）
-- 在 Supabase Dashboard → SQL Editor 貼上執行。舊版可整份重跑，不會影響既有資料。
--
-- 為什麼需要它？
-- 直接「讀取整份資料 → 修改 → 寫回」在同時有網頁與 Telegram 寫入時，
-- 可能互相覆蓋。這些函式在資料庫內一次完成追加；按鈕的待確認資料
-- 存在 telegram_pending 資料列，按下按鈕後才寫入 dashboards。

create or replace function append_task(p_id text, p_task jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_task is null or jsonb_typeof(p_task) <> 'object' then
    raise exception 'p_task must be a JSON object';
  end if;

  update dashboards
     set payload = jsonb_set(
           jsonb_set(
             payload,
             '{tasks}',
             coalesce(payload->'tasks', '[]'::jsonb) || p_task,
             true
           ),
           '{modifiedAt}',
           to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint),
           true
         ),
         updated_at = now()
   where id = p_id
  returning jsonb_array_length(payload->'tasks') into v_count;

  if v_count is null then
    raise exception 'dashboard not found: %', p_id;
  end if;

  return jsonb_build_object('ok', true, 'taskCount', v_count);
end;
$$;

grant execute on function append_task(text, jsonb) to anon, authenticated;

-- ============================================================
-- 按鈕流程：待確認資料表（只有 RPC 能存取）
-- ============================================================
create table if not exists telegram_pending (
  token text primary key,
  chat_id text not null,
  message_id bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table telegram_pending enable row level security;
revoke all on table telegram_pending from anon, authenticated;

-- 儲存待確認內容（最多保留 2 天）
create or replace function save_telegram_pending(
  p_token text,
  p_chat_id text,
  p_message_id bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 8 then
    raise exception 'invalid pending token';
  end if;
  if p_chat_id is null or p_chat_id = '' then
    raise exception 'missing chat id';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be a JSON object';
  end if;
  if coalesce(p_payload->>'title', '') = '' or coalesce(p_payload->>'date', '') = '' then
    raise exception 'pending title/date required';
  end if;

  delete from telegram_pending where created_at < now() - interval '2 days';

  insert into telegram_pending(token, chat_id, message_id, payload)
  values (p_token, p_chat_id, p_message_id, p_payload)
  on conflict (token) do update
    set chat_id = excluded.chat_id,
        message_id = excluded.message_id,
        payload = excluded.payload,
        created_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- 取消按鈕：刪除待確認資料
create or replace function discard_telegram_pending(
  p_token text,
  p_chat_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from telegram_pending
   where token = p_token and chat_id = p_chat_id;
  return found;
end;
$$;

-- 按下任務／私人行程／會議：取出待確認資料，原子追加到對應陣列
create or replace function commit_telegram_pending(
  p_id text,
  p_token text,
  p_chat_id text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending jsonb;
  v_payload jsonb;
  v_key text;
  v_item jsonb;
  v_count integer;
  v_now_ms bigint;
  v_dup boolean;
begin
  if p_kind not in ('task', 'event', 'meeting') then
    raise exception 'invalid kind: %', p_kind;
  end if;

  v_key := case p_kind
    when 'task' then 'tasks'
    when 'event' then 'events'
    else 'meetings'
  end;

  delete from telegram_pending where created_at < now() - interval '2 days';

  select payload into v_pending
    from telegram_pending
   where token = p_token and chat_id = p_chat_id
   for update;

  if v_pending is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select payload into v_payload
    from dashboards
   where id = p_id
   for update;

  if v_payload is null then
    raise exception 'dashboard not found: %', p_id;
  end if;

  select exists (
    select 1
      from jsonb_array_elements(coalesce(v_payload->v_key, '[]'::jsonb)) e
     where e->>'tgMsgId' = v_pending->>'tgMsgId'
  ) into v_dup;

  if v_dup then
    delete from telegram_pending where token = p_token and chat_id = p_chat_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'kind', p_kind);
  end if;

  v_now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  if p_kind = 'task' then
    v_item := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'title', v_pending->>'title',
      'status', 'todo',
      'priority', coalesce(v_pending->>'priority', 'mid'),
      'due', v_pending->>'date',
      'projectId', null,
      'note', '來自 Telegram',
      'createdAt', to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD'),
      'completedAt', null,
      'tgMsgId', v_pending->>'tgMsgId'
    );
  elsif p_kind = 'event' then
    v_item := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'title', v_pending->>'title',
      'date', v_pending->>'date',
      'time', coalesce(v_pending->>'time', ''),
      'location', '',
      'note', '來自 Telegram',
      'createdAt', to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD'),
      'tgMsgId', v_pending->>'tgMsgId'
    );
  else
    v_item := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'title', v_pending->>'title',
      'date', v_pending->>'date',
      'time', coalesce(v_pending->>'time', ''),
      'location', '',
      'attendees', '',
      'notes', '來自 Telegram',
      'actionItems', '[]'::jsonb,
      'createdAt', to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD'),
      'tgMsgId', v_pending->>'tgMsgId'
    );
  end if;

  v_payload := jsonb_set(
    jsonb_set(
      v_payload,
      array[v_key],
      coalesce(v_payload->v_key, '[]'::jsonb) || v_item,
      true
    ),
    '{modifiedAt}',
    to_jsonb(v_now_ms),
    true
  );

  update dashboards
     set payload = v_payload,
         updated_at = now()
   where id = p_id
  returning jsonb_array_length(payload->v_key) into v_count;

  delete from telegram_pending where token = p_token and chat_id = p_chat_id;

  return jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'item', v_item,
    'count', v_count
  );
end;
$$;

grant execute on function save_telegram_pending(text, text, bigint, jsonb) to anon, authenticated;
grant execute on function discard_telegram_pending(text, text) to anon, authenticated;
grant execute on function commit_telegram_pending(text, text, text, text) to anon, authenticated;
