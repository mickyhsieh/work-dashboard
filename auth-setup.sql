-- ============================================================
-- 工作儀錶板：登入白名單與 RLS
-- 在 Supabase Dashboard → SQL Editor 貼上執行。可重複執行。
--
-- 這個檔案會：
--   1. 建立 dashboard_members（誰可以登入看板）
--   2. 讓 dashboards 只有 authenticated 且在白名單內的會員能讀寫
--   3. 收回 anon 對寫入 RPC 的執行權，改由 service_role 使用
--
-- 執行順序建議：
--   A. 先重新部署 mcp-task / telegram-task，讓它們使用 service_role
--      （Edge Functions 會優先讀 SUPABASE_SERVICE_ROLE_KEY；若沒有，
--       再把 DASH_KEY secret 改成 service_role key）。
--   B. AI Worker 的 .env 也把 DASH_KEY 改成 service_role key
--      （或設定 SUPABASE_SERVICE_ROLE_KEY，會優先使用）。
--   C. 再執行本檔，否則 Telegram／MCP／AI Worker 會因 anon 權限被收回而 401。
-- ============================================================

-- ---------- 1. 登入白名單 ----------
create table if not exists public.dashboard_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'member' check (role in ('owner', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists dashboard_members_email_idx
  on public.dashboard_members (lower(email));

alter table public.dashboard_members enable row level security;

-- 一般使用者只能讀自己的白名單列；新增／停用由管理者用 Table Editor
-- 或 service_role 操作。
revoke all on table public.dashboard_members from anon, authenticated;
grant select on table public.dashboard_members to authenticated;
grant all on table public.dashboard_members to service_role;

drop policy if exists "members read own" on public.dashboard_members;
create policy "members read own" on public.dashboard_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- 供 RLS policy 使用的 membership 檢查；security definer 讓它可以在
-- 不開放 dashboard_members 給 anon 的情況下讀取白名單。
create or replace function public.is_dashboard_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.dashboard_members m
     where m.user_id = auth.uid()
       and m.active = true
  );
$$;

revoke all on function public.is_dashboard_member() from public, anon, authenticated;
grant execute on function public.is_dashboard_member() to authenticated;

-- ---------- 2. dashboards：只允許白名單會員 ----------
alter table public.dashboards enable row level security;

drop policy if exists "anon all" on public.dashboards;
drop policy if exists "authenticated all" on public.dashboards;
drop policy if exists "members all" on public.dashboards;

-- 清除其他舊的 permissive policy，避免它們和新的會員 policy 形成 OR，
-- 讓已登入但不在白名單的人仍可存取。只保留下面重建的 members all。
do $$
declare
  r record;
begin
  for r in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'dashboards'
       and policyname <> 'members all'
  loop
    execute format('drop policy if exists %I on public.dashboards', r.policyname);
  end loop;
end $$;

create policy "members all" on public.dashboards
  for all
  to authenticated
  using (public.is_dashboard_member())
  with check (public.is_dashboard_member());

-- anon 連表權限都收回；authenticated 仍透過上面的 RLS policy 限制。
revoke all on table public.dashboards from anon;
grant select, insert, update, delete on table public.dashboards to authenticated;
grant all on table public.dashboards to service_role;

-- ---------- 3. 寫入 RPC 改成 service_role 專用 ----------
-- 這些函式是 security definer；如果還留著 anon EXECUTE，匿名請求就能
-- 繞過 RLS 直接寫 dashboards。用 to_regprocedure 讓本檔在函式尚未建立
-- 時也能執行。
do $$
begin
  if to_regprocedure('public.append_task(text,jsonb)') is not null then
    execute 'revoke all on function public.append_task(text, jsonb) from public, anon, authenticated';
    execute 'grant execute on function public.append_task(text, jsonb) to service_role';
  end if;

  if to_regprocedure('public.append_task_once(text,jsonb,text)') is not null then
    execute 'revoke all on function public.append_task_once(text, jsonb, text) from public, anon, authenticated';
    execute 'grant execute on function public.append_task_once(text, jsonb, text) to service_role';
  end if;

  if to_regprocedure('public.save_telegram_pending(text,text,bigint,jsonb)') is not null then
    execute 'revoke all on function public.save_telegram_pending(text, text, bigint, jsonb) from public, anon, authenticated';
    execute 'grant execute on function public.save_telegram_pending(text, text, bigint, jsonb) to service_role';
  end if;

  if to_regprocedure('public.discard_telegram_pending(text,text)') is not null then
    execute 'revoke all on function public.discard_telegram_pending(text, text) from public, anon, authenticated';
    execute 'grant execute on function public.discard_telegram_pending(text, text) to service_role';
  end if;

  if to_regprocedure('public.commit_telegram_pending(text,text,text,text)') is not null then
    execute 'revoke all on function public.commit_telegram_pending(text, text, text, text) from public, anon, authenticated';
    execute 'grant execute on function public.commit_telegram_pending(text, text, text, text) to service_role';
  end if;

  if to_regprocedure('public.resolve_mcp_client(text)') is not null then
    execute 'revoke all on function public.resolve_mcp_client(text) from public, anon, authenticated';
    execute 'grant execute on function public.resolve_mcp_client(text) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- 4. 建立第一個會員
-- 先在 Supabase Dashboard → Authentication → Users 建立使用者
-- （建議勾選 Auto Confirm User），再把 email 換成你的帳號執行：
-- ============================================================
-- insert into public.dashboard_members (user_id, email, role)
-- select id, email, 'owner'
--   from auth.users
--  where lower(email) = lower('you@example.com')
-- on conflict (user_id) do update
--   set email = excluded.email,
--       role = 'owner',
--       active = true;

-- 確認白名單：
-- select user_id, email, role, active, created_at
--   from public.dashboard_members
--  order by created_at;
