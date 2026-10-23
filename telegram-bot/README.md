# Telegram → 任務／私人行程／會議／AI 待辦（Supabase Edge Function）

用 Telegram 傳訊息，Bot 會先顯示按鈕；按下「任務／私人行程／會議／AI 待辦」後才寫入儀錶板。整套運作在 Supabase 免費方案內，不需要自己的伺服器。

```
Telegram → Bot → Supabase Edge Function（telegram-task）
        → telegram_pending（等待按鈕確認）
        → commit_telegram_pending（原子追加到 tasks／events／meetings／aiTasks）
        → dashboards 資料列 → 儀錶板 30 秒內自動更新
```

> 支援**任務、私人行程、會議、AI 待辦**。私人行程可設定 2 天以上的多日區間；會議的地點、參與者與行動項可之後在儀錶板補上；AI 待辦會直接進入「任務 → AI 工作區」。

---

## 你會用到的指令

| 訊息 | 結果 |
|---|---|
| `買牛奶` | Bot 顯示按鈕；按「任務」後新增，到期日＝今天 |
| `買牛奶 明天` | 按「任務」後新增，到期日＝明天 |
| `寫週報 週五 #高` | 按「任務」後新增，週五到期、高優先 |
| `牙醫回診 10/25 18:30` | 按「私人行程」後新增 |
| `出差 10/25-10/27` | 按「私人行程」後新增 3 天行程 |
| `旅遊 10/25 到 10/27` | 同上，`~`、`～`、`至` 也可以 |
| `出差 10/25 三天` | 按「私人行程」後新增 10/25～10/27 |
| `旅遊 明天 兩天一夜` | 按「私人行程」後新增 2 天行程 |
| `專案會議 週五 14:00` | 按「會議」後新增 |
| `整理競品資料 明天` | 按「AI 待辦」後放到任務 → AI 工作區的 AI 待辦 |
| `/today` | 回覆今天的待辦與逾期任務 |
| `/test` | 送出一顆測試按鈕，確認聊天室能顯示 inline keyboard |
| `/diag` | 檢查 Secrets、Webhook、按鈕暫存 RPC，以及目前 `DASH_ID` 的雲端 AI 待辦筆數 |
| `/id` | 顯示你的 Telegram chat id（設定授權用） |
| `/help` | 指令說明 |

> 看不到按鈕時，先傳 `/test`。如果 `/test` 也沒有按鈕，通常是 `telegram-task` 還是舊版，請重新 Deploy `index.ts`。如果 `/test` 有按鈕、但一般訊息沒有，通常是 `setup.sql` 的按鈕暫存函式尚未建立或未更新。

- 日期：`今天`、`明天`、`後天`、`大後天`、`週一`～`週日`、`下週一`～`下週日`、`10/25`、`10-25`、`10月25日`、`2026-10-25`。
- 多日區間：`10/25-10/27`、`10/25~10/27`、`10/25 到 10/27`、`明天到後天`；按「私人行程」才會使用結束日期。
- 天數寫法：`10/25 三天`、`明天 兩天`、`三天兩夜`（日期與天數之間要留空格；只寫天數則從今天起算）。
- 時間：`18:30`、`下午3點`、`晚上8點半`（私人行程／會議會使用；留空＝全天）。
- 優先級：`#高`、`#中`、`#低`（或單獨的 `高`／`低`），會用在任務與 AI 待辦。
- AI 待辦會保留原始需求、日期與優先級；多日區間與時間只使用開始日期，不會建立多日 AI 任務。
- 按下按鈕前都不會寫入；按「取消」也不會留下資料。

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
add - 新增任務／行程／會議
today - 今天待辦
id - 取得 chat id
help - 說明
```

### 2. 建立資料庫函式

Supabase Dashboard → **SQL Editor** → 貼上 [`setup.sql`](./setup.sql) → **Run**。

成功後 Database → Functions 會看到 `append_task`、`save_telegram_pending`、`discard_telegram_pending`、`commit_telegram_pending`。

> 已經安裝過舊版的人：**直接整份重跑一次**，會補上按鈕流程需要的資料表與函式，不會影響既有任務。

### 3. 部署 Edge Function

1. Supabase Dashboard → **Edge Functions** → **Deploy a new function**
2. 選 **Via Editor**
3. 函式名稱填 **`telegram-task`**
4. 把 [`index.ts`](./index.ts) 全部內容貼進編輯器 → **Deploy**

> 改過程式碼就一定要重新 Deploy；只改 Secrets 才不用。

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
5. 傳 `買牛奶 明天`，Bot 會顯示「任務／AI 待辦／私人行程／會議／取消」按鈕
6. 按「任務」，看到 ✅ 後即完成

> 授權號碼設定前，bot 只會回覆「尚未設定授權」，不會寫入任何資料。按鈕按下去之前也不會寫入。

多日行程可再測：傳 `出差 10/25-10/27` 或 `出差 10/25 三天`，按「私人行程」，行事曆應該在 10/25、10/26、10/27 都顯示綠點。

### 8. 開啟儀錶板自動更新

儀錶板 → **設定 → 雲端同步** → 勾選 **「自動接收雲端變更（每 30 秒）」**。

之後在 Telegram 新增的任務，最慢 30 秒會出現在看板；重新整理頁面則會立即看到。

---

## 運作細節

- **先確認才寫入**：收到訊息只會建立一筆 `telegram_pending`（保留 2 天）並回覆按鈕；按下任務／私人行程／會議／AI 待辦才會寫入儀錶板。
- **原子寫入**：`commit_telegram_pending` 在資料庫內直接 append 到 `tasks`、`events`、`meetings` 或 `aiTasks`，不會讀取整份資料再覆蓋。
- **去重**：每則 Telegram 訊息以 `chatId:message_id` 標記（欄位 `tgMsgId`）；webhook 重送或重複按按鈕時不會重複新增。
- **時區**：日期以台灣時間（UTC+8）計算。
- **觸發來源**：備註會寫「來自 Telegram」，方便辨識。
- **私人行程**：可建立單日或多日行程；行事曆會在區間內的每一天顯示綠點，但不列入工作報表與工時統計。
- **會議**：先用標題、日期、時間建立；地點、參與者、行動項可在儀錶板補上。會議仍為單日。

## 疑難排解

| 症狀 | 可能原因／解法 |
|---|---|
| Telegram 完全沒回應 | 檢查 `getWebhookInfo`、Edge Functions → Logs；JWT 驗證是否已關閉 |
| `401 Unauthorized` | `secret_token` 與 `WEBHOOK_SECRET` 不一致 |
| Bot 回「尚未設定授權」 | `ALLOWED_CHAT_ID` 尚未填或填錯 |
| Bot 回「無法建立按鈕」 | `setup.sql` 還沒更新／重跑，或 Edge Function 還沒重新 Deploy |
| 完全看不到按鈕 | 先傳 `/test`。沒有測試按鈕＝`telegram-task` 還是舊版，重新貼上最新 `index.ts` 並 Deploy |
| `/test` 有按鈕，但一般訊息沒有 | 按鈕暫存失敗；到 Supabase SQL Editor 重跑 `setup.sql`，再傳 `/diag` 確認 |
| 有按鈕但按了沒反應 | Edge Function 是否已重新 Deploy；到 Logs 看 `callback_query` 是否進來 |
| 按鈕有反應但寫入失敗 | 重新 Deploy 最新 `index.ts`（舊版少了 `p_id`，`commit_telegram_pending` 會失敗） |
| Bot 回「這個選項已失效或已處理過」 | 待確認超過 2 天，或這個按鈕已經按過；重新傳訊息即可 |
| Bot 回「結束日期不能早於開始日期」 | 多日區間順序寫反了；改成 `10/25-10/27` 這種由早到晚的格式 |
| Bot 回「找不到雲端資料列」 | `DASH_ID` 打錯（要與儀錶板的文件金鑰相同） |
| `RPC 404` / `function not found` | `setup.sql` 還沒執行，或要等 Supabase schema cache 更新 |
| 儀錶板沒出現新項目 | 設定頁是否勾了「自動接收雲端變更」；或重新整理頁面 |
| Telegram 說已新增 AI 待辦，但看板沒有 | 到「任務 → AI 工作區」按「檢查／補回雲端 AI 待辦」；再傳 `/diag` 看「雲端 AI 待辦」筆數。若 `/diag` 有、看板檢查是 0，代表 `DASH_URL`／`DASH_ID` 與看板同步設定不同；若兩邊都是 0，可能被其他分頁的自動上傳覆蓋 |
| 一直回「已處理過」 | 同一則訊息被重送或重複按按鈕，屬正常保護 |
| 專案暫時失效 | Supabase 免費專案閒置 7 天會暫停，回後台按 Restore |

## 安全建議

- `BOT_TOKEN`、`WEBHOOK_SECRET`、`DASH_ID` 只放在 Supabase Secrets，**不要**寫進程式碼或 commit。
- `DASH_ID` 等同資料密碼；外流的人可以用 anon key 讀寫你的資料。
- Bot 只回應 `ALLOWED_CHAT_ID` 指定的帳號。
- `telegram_pending` 已開啟 RLS 且不開放 anon 直接存取，只能透過受保護的 RPC 操作。
- 若要撤銷 token：BotFather → `/revoke` → 更新 `BOT_TOKEN` secret → 重新 `setWebhook`。

## 升級舊版

1. SQL Editor 重新執行整份 [`setup.sql`](./setup.sql)。
2. Edge Functions → `telegram-task` → 貼上新版 [`index.ts`](./index.ts) → Deploy。
3. Secrets、Webhook 不用改。
4. 對 Bot 傳 `/test`，確認出現測試按鈕；再傳 `/diag`，確認「按鈕暫存 RPC：正常」。
5. 傳 `買牛奶 明天`，確認出現五個按鈕；按「任務」後確認寫入成功。
6. 再傳 `整理競品資料 明天`，按「AI 待辦」，確認出現在「任務 → AI 工作區 → AI 待辦」。
