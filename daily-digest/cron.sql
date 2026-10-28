-- 每日 Telegram 摘要：Supabase Cron 排程
-- 先完成：
--   1. 執行 setup.sql
--   2. 部署 daily-digest Edge Function
--   3. 在 Edge Function secrets 設定 DIGEST_CRON_SECRET（值同 setup.sql 輸出的密鑰）
--
-- 再把下面的 <PROJECT_REF> 換成你的 Supabase 專案代號，於 SQL Editor 執行。
-- Cron 使用 UTC；00:00 UTC = 台灣時間 08:00。

select cron.schedule(
  'daily-telegram-digest',
  '0 0 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-digest-secret',
      (select decrypted_secret
       from vault.decrypted_secrets
       where name = 'digest_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);

-- 查看排程
select jobid, jobname, schedule, active
from cron.job
where jobname = 'daily-telegram-digest';

-- 查看最近執行結果（排程執行後）
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'daily-telegram-digest'
)
order by start_time desc
limit 10;
