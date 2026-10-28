-- 每日 Telegram 摘要：雲端版資料表與 Vault secret
-- 在 Supabase Dashboard → SQL Editor 貼上執行。可重複執行。
--
-- 這個檔案只建立：
--   1. public.digest_runs：記錄每天是否已發送，避免重複推播
--   2. Vault 的 digest_cron_secret：讓 pg_cron 呼叫 Edge Function 時帶入
--
-- Cron 排程在 cron.sql；請先部署 daily-digest Edge Function，再執行 cron.sql。

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.digest_runs (
  digest_date date primary key,
  sent_at timestamptz not null default now(),
  chars integer not null default 0,
  chat_id text not null default '',
  dashboard_updated_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.digest_runs is
  '每日 Telegram 摘要發送紀錄；一天一列，用來避免重複推播。';

alter table public.digest_runs enable row level security;

-- 只允許 service_role 存取；瀏覽器與 anon 不能讀取。
revoke all on table public.digest_runs from anon, authenticated;
grant select, insert, update, delete on table public.digest_runs to service_role;

-- 建立 Cron 專用密鑰（只建立一次；已存在就不覆蓋）。
-- 建立後把下面的 decrypted_secret 複製到 Edge Function secret：
--   DIGEST_CRON_SECRET
do $$
declare
  generated text;
begin
  if not exists (
    select 1 from vault.secrets where name = 'digest_cron_secret'
  ) then
    generated := encode(gen_random_bytes(32), 'hex');
    perform vault.create_secret(
      generated,
      'digest_cron_secret',
      'Daily digest cron secret'
    );
  end if;
end
$$;

select decrypted_secret
from vault.decrypted_secrets
where name = 'digest_cron_secret';
