# Telegram → 任務（Supabase Edge Function）

用 Telegram 傳訊息就能新增儀錶板任務。整套運作在 Supabase 免費方案內，不需要自己的伺服器。

```
Telegram → Bot → Supabase Edge Function（telegram-task）
        → Postgres 函式 append_task（原子追加）
        → dashboards 資料列 → 儀錶板 30 秒內自動更新
```

> 目前只支援**任務**；會議／行程之後會加進同一支 function。

---

## 你會用到的指令

| 訊息 | 結果 |
|---|---|
| `買牛奶` | 新增任務，到期日＝今天 |
| `買牛奶 明天` | 到期日＝明天 |
| `寫週報 週五 #高` | 週五到期、高優先 |
| `回診 10/25` | 10/25 到期 |
| `回診 10月25日` | 同上 |
| `/today` | 回覆今天的待辦與逾期任務 |
| `/id` | 顯示你的 Telegram chat id（設定授權用） |
| `/help` | 指令說明 |

日期支援：`今天`、`明天`、`後天`、`大後天`、`週一`～`週日`、`下週一`～`下週日`、`10/25`、`10-25`、`10月25日`、`2026-10-25`。
優先級：`#高`、`#中`、`#低`（或單獨的 `高`／`低`）。

---

## 安裝步驟

### 0. 事前準備

從儀錶板「設定 → 雲端同步」或 Supabase 後台取得：

- **DASH_URL**：`https://xxxx.supabase.co`（不要加 `/rest/v1`）
- **DASH_KEY**：anon / publishable key（設定頁的「anon / publishable key」）
- **DASH_ID**：文件金鑰（`dashboards.id`，也等於你的資料密碼）

### 1. 建立 Telegram Bot

1. 在 Telegram 搜尋 **@BotFather**
2. 傳 `/newbot`，依指示取名稱與使用者名稱（結尾必須是 `bot`）
3. 記下 **token**（長得像 `123456789:AAH...`）

選用：`/setcommands` 貼上以下內容，聊天室就會有指令選單：

```
add - 新增任務
today - 今天待辦
id - 取得 chat id
help - 說明
```

### 2. 建立資料庫函式

Supabase Dashboard → **SQL Editor** → 貼上 [`setup.sql`](./setup.sql) → **Run**。

成功後 `append_task` 會出現在 Database → Functions。

### 3. 部署 Edge Function

1. Supabase Dashboard → **Edge Functions** → **Deploy a new function**
2. 選 **Via Editor**
3. 函式名稱填 **`telegram-task`**
4. 把 [`index.ts`](./index.ts) 全部內容貼進編輯器 → **Deploy**

### 4. 關閉 JWT 驗證（重要）

Telegram 呼叫 webhook 時不會帶 Supabase 金鑰，因此：

1. 打開 `telegram-task` 的函式詳情頁
2. 找到 **Verify JWT / JWT verification** 開關，**關閉**
3. 存取安全改由下面的 `WEBHOOK_SECRET` 驗證

> 若找不到開關，也可用 CLI：`supabase functions deploy telegram-task --no-verify-jwt`

### 5. 設定 Secrets

Dashboard → **Edge Functions → Secrets**（<https://supabase.com/dashboard/project/_/functions/secrets>）新增：

| Key | Value |
|---|---|
| `BOT_TOKEN` | BotFather 給的 token |
| `WEBHOOK_SECRET` | 自己產生的隨機字串（建議 32 字元以上英數） |
| `DASH_URL` | `https://xxxx.supabase.co` |
| `DASH_KEY` | anon / publishable key |
| `DASH_ID` | 文件金鑰 |
| `ALLOWED_CHAT_ID` | 先留空或填 `0`，第 7 步再填 |

- Secret 名稱**不能**以 `SUPABASE_` 開頭（平台保留）。
- 新增 secret 後**不需要重新部署**，下一次呼叫就會生效。
- `DASH_KEY` 用 anon / publishable 即可，不需要 service role。

### 6. 註冊 Webhook

把下面三個地方換成你的值，貼到瀏覽器打開：

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-task&secret_token=<WEBHOOK_SECRET>
```

成功會看到：

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

檢查狀態：

```
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

`last_error_message` 若顯示 401，代表 `WEBHOOK_SECRET` 與 `secret_token` 不一致。
要重設時先開 `deleteWebhook`，再重新 `setWebhook`。

### 7. 授權你的帳號

1. 在 Telegram 對 bot 傳 **`/id`**
2. 它會回覆你的 chat id，例如 `123456789`
3. 回到 Supabase → Secrets → 把 `ALLOWED_CHAT_ID` 改成這個號碼 → Save
4. 傳 `/start`，應該看到使用說明
5. 傳 `買牛奶 明天`，bot 會回覆 ✅

> 授權號碼設定前，bot 只會回覆「尚未設定授權」，不會寫入任何資料。

### 8. 開啟儀錶板自動更新

儀錶板 → **設定 → 雲端同步** → 勾選 **「自動接收雲端變更（每 30 秒）」**。

之後在 Telegram 新增的任務，最慢 30 秒會出現在看板；重新整理頁面則會立即看到。

---

## 運作細節

- **原子寫入**：`append_task` 在資料庫內直接 append 到 `payload.tasks`，不會讀取整份資料再覆蓋，因此不會蓋掉其他任務。
- **去重**：每則 Telegram 訊息以 `chatId:message_id` 標記（欄位 `tgMsgId`），webhook 重送時不會重複新增。
- **時區**：日期以台灣時間（UTC+8）計算。
- **觸發來源**：任務的備註會寫「來自 Telegram」，方便辨識。

## 疑難排解

| 症狀 | 可能原因／解法 |
|---|---|
| Telegram 完全沒回應 | 檢查 `getWebhookInfo`、Edge Functions → Logs；JWT 驗證是否已關閉 |
| `401 Unauthorized` | `secret_token` 與 `WEBHOOK_SECRET` 不一致 |
| Bot 回「尚未設定授權」 | `ALLOWED_CHAT_ID` 尚未填或填錯 |
| Bot 回「找不到雲端資料列」 | `DASH_ID` 打錯（要與儀錶板的文件金鑰相同） |
| `RPC 404` / `function not found` | `setup.sql` 還沒執行 |
| 儀錶板沒出現新任務 | 設定頁是否勾了「自動接收雲端變更」；或重新整理頁面 |
| 一直回「已處理過」 | 同一則訊息被重送，屬正常保護 |
| 專案暫時失效 | Supabase 免費專案閒置 7 天會暫停，回後台按 Restore |

## 安全建議

- `BOT_TOKEN`、`WEBHOOK_SECRET`、`DASH_ID` 只放在 Supabase Secrets，**不要**寫進程式碼或 commit。
- `DASH_ID` 等同資料密碼；外流的人可以用 anon key 讀寫你的資料。
- Bot 只回應 `ALLOWED_CHAT_ID` 指定的帳號。
- 若要撤銷 token：BotFather → `/revoke` → 更新 `BOT_TOKEN` secret → 重新 `setWebhook`。

## 之後要加會議／行程

在同一支 `telegram-task` function 增加 `/meeting` 指令，並在 `setup.sql` 加一個 `append_meeting` 函式即可；其餘設定不變。
