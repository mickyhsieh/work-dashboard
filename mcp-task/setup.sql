-- MCP 任務入口：原子追加 + externalId 去重
-- 在 Supabase Dashboard → SQL Editor 貼上執行。可重複執行。
--
-- 為什麼不直接用 append_task？
-- MCP Client 可能因網路逾時重試同一個 tools/call。
-- 這個函式會在同一個資料庫交易內鎖住看板資料列，先檢查 externalId；
-- 已存在就回傳 duplicate，不會重複新增任務。

create or replace function append_task_once(
  p_id text,
  p_task jsonb,
  p_dedupe_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_existing jsonb;
  v_count integer;
  v_now_ms bigint;
begin
  if p_task is null or jsonb_typeof(p_task) <> 'object' then
    raise exception 'p_task must be a JSON object';
  end if;

  if coalesce(p_task->>'title', '') = '' then
    raise exception 'p_task.title is required';
  end if;

  select payload into v_payload
    from dashboards
   where id = p_id
   for update;

  if v_payload is null then
    raise exception 'dashboard not found: %', p_id;
  end if;

  if p_dedupe_key is not null and length(trim(p_dedupe_key)) > 0 then
    select e.value into v_existing
      from jsonb_array_elements(coalesce(v_payload->'tasks', '[]'::jsonb)) as e(value)
     where e.value->>'externalId' = p_dedupe_key
     limit 1;

    if v_existing is not null then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'task', v_existing
      );
    end if;
  end if;

  v_now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  update dashboards
     set payload = jsonb_set(
           jsonb_set(
             payload,
             '{tasks}',
             coalesce(payload->'tasks', '[]'::jsonb) || p_task,
             true
           ),
           '{modifiedAt}',
           to_jsonb(v_now_ms),
           true
         ),
         updated_at = now()
   where id = p_id
  returning jsonb_array_length(payload->'tasks') into v_count;

  if v_count is null then
    raise exception 'dashboard not found: %', p_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'taskCount', v_count
  );
end;
$$;

grant execute on function append_task_once(text, jsonb, text) to anon, authenticated;
