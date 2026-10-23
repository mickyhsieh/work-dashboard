-- MCP Client token registry
-- 在 Supabase Dashboard → SQL Editor 貼上執行。可重複執行。
--
-- 設計：
--   * 每個 MCP Client（人／助手／機器）一組 token。
--   * 資料表只存 token 的 SHA-256 hash，不存明文。
--   * Edge Function 收到 Bearer token 後，用 RPC 查詢對應名稱。
--   * 在 Supabase Dashboard → Table Editor → mcp_clients 管理：
--       新增列＝發 token；active=false＝停用；刪除列＝撤銷。
--   * 資料表開啟 RLS 且不建立 policy，anon/authenticated 不能直接讀取。
--   * 只有 security definer 的 resolve_mcp_client() 可以查詢並更新 last_used_at；
--     此函式只開放 service_role，瀏覽器與 anon 不能呼叫。

create extension if not exists pgcrypto;

create table if not exists public.mcp_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists mcp_clients_name_idx
  on public.mcp_clients (name);

alter table public.mcp_clients enable row level security;

-- 不建立任何 policy；一般 anon/authenticated 不能直接存取。
revoke all on table public.mcp_clients from anon, authenticated;
grant all on table public.mcp_clients to service_role;

create or replace function public.resolve_mcp_client(p_token_hash text)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if p_token_hash is null or length(trim(p_token_hash)) <> 64 then
    return;
  end if;

  select c.id, c.name
    into v_id, v_name
    from public.mcp_clients c
   where c.token_hash = lower(trim(p_token_hash))
     and c.active = true
   limit 1;

  if v_id is null then
    return;
  end if;

  update public.mcp_clients c
     set last_used_at = now()
   where c.id = v_id;

  return query select v_id, v_name;
end;
$$;

revoke all on function public.resolve_mcp_client(text) from public, anon, authenticated;
grant execute on function public.resolve_mcp_client(text) to service_role;

comment on table public.mcp_clients is
  'MCP Bearer token registry；只存 SHA-256 hash。由 Supabase Dashboard 管理。';
comment on column public.mcp_clients.name is
  '顯示在任務 sender 與 Telegram 的交辦人名稱。';
comment on column public.mcp_clients.token_hash is
  'token 的 SHA-256 hex；不要存明文 token。';
comment on column public.mcp_clients.active is
  'false 表示立即停用，不必重新部署 Edge Function。';
comment on column public.mcp_clients.last_used_at is
  '最近一次通過此 token 驗證的時間。';

notify pgrst, 'reload schema';
