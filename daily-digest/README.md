# 每日 Telegram 摘要（Supabase Edge Function + Cron）

把原本在 Windows 工作排程器執行的 `node digest.mjs send`，改成完全由 Supabase 雲端執行。電腦不用開機、不用登入，也不受公司電腦 Proxy 影響。

```text
Supabase Cron（每天 00:00 UTC = 台灣 08:00）
  → Edge Function：daily-digest
  → 讀取 dashboards（service_role）
  → Telegram Bot API
  → 寫入 digest_runs（避免同一天重複發送）
```

摘要內容與 `ai-worker/digest.mjs` 相同：逾期任務、今天到期、其他未完成、AI 待辦、AI 進行中、等你確認。

## 會用到的 Secrets

多數可以直接沿用現有 `telegram-task` 的設定；Edge Function secrets 是整個專案共用。

| Secret | 必要 | 說明 |
|---|---|---|
| `BOT_TOKEN` | 是 | Telegram Bot token，沿用 `telegram-task` |
| `ALLOWED_CHAT_ID` | 是 | 接收摘要的 chat id，沿用 `telegram-task` |
| `DASH_ID` | 是 | 看板文件金鑰 |
| `DIGEST_CRON_SECRET` | 是 | 本函式專用觸發密鑰，由 `setup.sql` 產生 |
| `SUPABASE_SERVICE_ROLE_KEY` | 平台注入 | Edge Function 預設可用；不需要手動放進瀏覽器 |
| `DASH_URL` / `DASH_KEY` | 否 | 只有在平台沒有注入 Supabase 變數時才需要 |
| `DIGEST_MAX_ITEMS` | 否 | 每區最多幾筆，預設 `8`（1–20） |
| `DIGEST_MAX_CHARS` | 否 | 訊息上限，預設 `3900`（500–4096） |

`DIGEST_CRON_SECRET` 不要寫進 Git、不要貼到公開頻道。它只能觸發摘要，不是 service_role。

## 安裝步驟

### 1. 建立資料表與 Cron 密鑰

Supabase Dashboard → **SQL Editor** → 貼上 [`setup.sql`](./setup.sql) → **Run**。

> 如果 `create extension` 失敗，先到 **Database → Extensions** 啟用 `pg_cron`、`pg_net`、`pgcrypto`，再重新執行 `setup.sql`。

成功後會：

- 建立 `public.digest_runs`（一天一列，防止重複發送）
- 在 Vault 建立 `digest_cron_secret`
- 最後一個查詢會顯示 `decrypted_secret`

把那個值記下來，下一步要貼到 Edge Function secret `DIGEST_CRON_SECRET`。

> `setup.sql` 可重複執行；已存在的密鑰不會被覆蓋。

### 2. 部署 Edge Function

Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**：

- 名稱：`daily-digest`
- 貼上 [`index.ts`](./index.ts)
- **Verify JWT**：關閉
- 按 **Deploy**

這個函式用 `x-digest-secret` 驗證，不需要 Supabase JWT。關閉 JWT 後，沒有密鑰的人仍然不能發送。

### 3. 設定 Edge Function secrets

Supabase Dashboard → **Edge Functions** → **Secrets**（或 Project Settings → Edge Functions）：

確認或新增：

```text
BOT_TOKEN=<沿用 telegram-task>
ALLOWED_CHAT_ID=<你的 chat id>
DASH_ID=<看板文件金鑰>
DIGEST_CRON_SECRET=<setup.sql 輸出的值>
```

`SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 由平台自動注入，通常不用設定。

### 4. 測試預覽（不發送）

把下面兩個值換成你的專案與密鑰：

```powershell
$url = "https://<PROJECT_REF>.supabase.co/functions/v1/daily-digest"
$secret = "<DIGEST_CRON_SECRET>"
```

先預覽：

```powershell
curl.exe -sS -X POST $url -H "Content-Type: application/json" -H "x-digest-secret: $secret" -d '{"preview":true}'
```

回應會包含 `"preview": true`、`chars` 與 `text`。確認內容正確但沒有發送。

### 5. 測試發送

```powershell
curl.exe -sS -X POST $url -H "Content-Type: application/json" -H "x-digest-secret: $secret" -d '{}'
```

成功會看到：

```json
{ "ok": true, "sent": true, "date": "2026-10-28", "chars": 649 }
```

同一天再呼叫會回傳 `skipped: true`。要強制重發：

```powershell
curl.exe -sS -X POST $url -H "Content-Type: application/json" -H "x-digest-secret: $secret" -d '{"force":true}'
```

確認 Telegram 收到訊息，且資料表有紀錄：

```sql
select * from public.digest_runs order by digest_date desc limit 5;
```

### 6. 建立 Cron 排程

打開 [`cron.sql`](./cron.sql)，把 `<PROJECT_REF>` 換成你的 Supabase 專案代號，貼到 SQL Editor 執行。

排程是：

```text
0 0 * * *   → 00:00 UTC = 台灣時間 08:00
```

Supabase Cron 使用 UTC，所以不要直接寫 `0 8 * * *`，否則會變成台灣時間 16:00。

確認排程：

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'daily-telegram-digest';
```

查看執行紀錄：

```sql
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'daily-telegram-digest'
)
order by start_time desc
limit 10;
```

`pg_net` 是非同步的；Cron 的 SQL 成功只代表請求已排入佇列。要看 Edge Function 的 HTTP 回應：

```sql
select id, status_code, content, created
from net._http_response
order by created desc
limit 10;
```

### 7. 停用本機排程

**先確認雲端已成功發送至少一次**，再停用本機的每日摘要，避免重複推播。

先停用（保留設定，方便隨時恢復）：

```powershell
Disable-ScheduledTask -TaskName AIWorker-DailyDigest
```

觀察幾天都正常後，再移除：

```powershell
Unregister-ScheduledTask -TaskName AIWorker-DailyDigest -Confirm:$false
```

不要停用 `AIWorker-Todo`；AI 任務仍然需要本機的 OpenCode Worker 執行。

## 驗證清單

- [ ] `setup.sql` 執行成功，`digest_runs` 存在
- [ ] `daily-digest` Edge Function 已部署，Verify JWT 關閉
- [ ] `DIGEST_CRON_SECRET` 與 Vault 的值一致
- [ ] `preview` 回傳正確摘要
- [ ] 手動 `{}` 發送成功，Telegram 收到
- [ ] `digest_runs` 有一筆今天日期
- [ ] `cron.job` 有 `daily-telegram-digest`，`active = true`
- [ ] 本機 `AIWorker-DailyDigest` 已停用
- [ ] 隔天 08:00 雲端自動發送成功

## 疑難排解

| 狀況 | 檢查 |
|---|---|
| `401 unauthorized` | `x-digest-secret` 是否等於 Edge Function secret `DIGEST_CRON_SECRET`；Vault 的值是否相同 |
| `500 DIGEST_CRON_SECRET 尚未設定` | 到 Edge Function secrets 新增 `DIGEST_CRON_SECRET`，重新部署或等待生效 |
| `500 缺少 secrets` | 確認 `BOT_TOKEN`、`ALLOWED_CHAT_ID`、`DASH_ID` 與 service_role 都存在 |
| `讀取 digest_runs 失敗` / `relation does not exist` | 先執行 `setup.sql` |
| `找不到文件` | `DASH_ID` 是否等於看板「文件金鑰」 |
| `Telegram sendMessage 失敗` | Bot token 是否正確、chat id 是否正確、Bot 是否被封鎖 |
| Cron 沒有執行 | `cron.job.active` 是否為 `true`；`pg_cron` / `pg_net` 是否啟用；看 `cron.job_run_details` |
| 有執行但 Telegram 沒收到 | 看 Edge Functions → `daily-digest` → Logs；確認函式回傳 `ok: true` |
| 重複收到 | 本機 `AIWorker-DailyDigest` 是否已停用；同一天只會發一次，`force` 會強制重發 |
| 專案免費方案閒置 | 免費專案長期沒有活動會暫停；Cron 有活動通常可避免，但不要依賴這點 |

## 安全性

- `daily-digest` 的 Verify JWT 關閉，但所有 POST 都必須帶正確的 `x-digest-secret`。
- `digest_runs` 開啟 RLS，且撤銷 `anon` / `authenticated` 權限，只有 service_role 能存取。
- `service_role` 只存在於 Edge Function 執行環境，不會進到瀏覽器。
- `DIGEST_CRON_SECRET` 只放在 Edge Function secrets 與 Supabase Vault，不寫進程式碼或 Git。
- 這個函式只讀取 `dashboards`，不會修改任務或 AI 工作區。
