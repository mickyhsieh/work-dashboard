-- Telegram 任務收集：原子追加函式
-- 在 Supabase Dashboard → SQL Editor 貼上執行一次即可。
--
-- 為什麼需要它？
-- 直接「讀取整份資料 → 修改 → 寫回」在同時有網頁與 Telegram 寫入時，
-- 可能互相覆蓋。這個函式在資料庫內一次完成追加，不會蓋掉其他任務。

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
