# 工作儀錶板（Work Dashboard）

個人工作儀錶板：任務、專案、會議與私人行程、文件、工時統計與工作報表，外加 AI 工作區與收納常用網站的摸魚區；單一頁面、純前端、無依賴。雲端版使用 Supabase Auth 登入，登入後才載入儀錶板。

## 功能

| 頁面 | 功能 |
|---|---|
| 登入 | Supabase Auth email／密碼、session 自動續期、登出；未登入不載入儀錶板 |
| 總覽 | KPI（本週到期／進行中／逾期／完成率）、今日焦點、近期行程（會議＋私人行程）、專案進度 |
| 任務 | 看板（可拖放換狀態）⇄ 清單、篩選（高優先／本週／逾期）、新增/編輯/刪除 |
| AI 工作區 | 位於任務頁子頁：AI 待辦、處理進度、等待確認、完成四區；任務指示、進度、結果、更新紀錄；複製 JSON／Agent 指令、套用 Agent 更新 |
| 專案 | 進度自動計算、里程碑點擊切換、未完成任務數 |
| 會議 | 月曆（翻頁，會議／私人行程雙色圓點）、點日期查看當天行程、新增私人行程（支援多日行程）、即將到來與歷史紀錄、行動項追蹤、**一鍵轉任務** |
| 文件 | 知識庫卡片、搜尋、標籤篩選、外部連結 |
| 統計 | **工時統計**：工時記錄、本週工時圖、近四週完成率；**工作報表**：日／週／月切換、完成／到期未完成清單、會議行動項、里程碑、依專案工時、複製摘要、CSV 匯出 |
| 摸魚區 | 常用網站收藏：卡片式、favicon、點擊開新分頁、新增/編輯/刪除 |
| 設定 | JSON 匯出／匯入（也可直接把 .json 拖進頁面）、**Supabase 雲端同步**、示範資料、清除資料 |

其他：Ctrl+K 全域搜尋、深淺色跟隨系統、五種主色即時切換、Telegram Bot（訊息 → 按鈕選任務／私人行程／會議／AI 待辦，支援多日行程，見 `telegram-bot/README.md`）、MCP 任務入口（老闆的 AI 助手可直接新增一般任務並發 Telegram，見 `mcp-task/README.md`）。AI 工作區另提供 `window.wdAI` 瀏覽器 API，方便未來的 AI Agent 讀取與更新。

> 工作報表口徑：完成數依「完成日」，未完成依「到期日」；兩者分開呈現。行動項與里程碑自 v1.2 起記錄完成日（`doneAt`），較早完成的舊資料不會列入期間統計。私人行程只顯示於行事曆，不列入工作報表與工時統計。

## 檔案

```
index.html    入口（登入頁＋儀錶板外殼）
auth.js       Supabase Auth 登入、session refresh、登出與載入 app.js
auth-setup.sql 登入白名單、dashboards RLS 與 RPC 權限
styles.css    樣式
app.js        核心邏輯（資料、儲存、互動）
telegram-bot/ Telegram → 任務／私人行程／會議（Supabase Edge Function，選用）
mcp-task/     Remote MCP → MCP 交辦的一般任務（Supabase Edge Function，選用）
prototype.html  早期風格原型（可刪除）
README.md     本說明
```

## 使用

本版本需要先登入。建議用本機伺服器或 GitHub Pages 開啟；直接雙擊 `index.html` 也可以載入登入頁，但 Supabase Auth／CORS 以 `https://` 或 `http://localhost` 最穩定。

```powershell
cd C:\Users\m9552\work-dashboard
python -m http.server 8080
# 瀏覽 http://localhost:8080
```

登入成功後，資料才會載入並顯示。資料存在瀏覽器 localStorage（每個瀏覽器獨立），雲端同步是選用的；定期用「設定 → 匯出 JSON」備份。

## 登入與跨裝置同步（Supabase）

讓不同瀏覽器／裝置共用同一份資料，並用 Supabase Auth 保護。Supabase 是免費的 Postgres 雲端資料庫，之後要搬到自己的伺服器時，把它換成自訂 API 即可。

### 一次性設定

1. 到 [supabase.com](https://supabase.com) 註冊 → **New project**（免費方案）。
2. **Authentication → Users → Add user** 建立登入帳號（Email + 密碼）。
   - 建議勾選 **Auto Confirm User**，或先到信箱完成驗證。
   - 到 **Authentication → Providers → Email** 關閉 **Allow new users to sign up**；帳號只由管理者建立。
3. **SQL Editor** 先建立 `dashboards`（如果還沒有），再執行 [`auth-setup.sql`](auth-setup.sql)：

```sql
create table if not exists public.dashboards (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.dashboards enable row level security;
```

`auth-setup.sql` 會建立 `dashboard_members` 白名單、把 `dashboards` 改成僅限登入會員，並收回 anon 對寫入 RPC 的執行權。若已經在用 Telegram Bot 或 MCP，請先重新部署 Edge Functions（讓它們使用 service_role）再執行這個 SQL，否則它們會因 anon 權限被收回而失敗。

4. 把剛剛建立的帳號加入白名單（把 email 換成你的）：

```sql
insert into public.dashboard_members (user_id, email, role)
select id, email, 'owner'
  from auth.users
 where lower(email) = lower('you@example.com')
on conflict (user_id) do update
  set email = excluded.email, role = 'owner', active = true;
```

5. **Project Settings → Data API** 複製 **Project URL**（`https://xxxx.supabase.co`）；**API Keys** 複製 **anon / publishable key**。
   - ⚠️ 瀏覽器只使用 anon / publishable key，**不要**使用 `service_role`／Secret key。
6. 開啟儀錶板，在登入頁的「Supabase 連線設定」填入 Project URL、anon key 與文件金鑰（`dashboards.id`，多台裝置要相同），再輸入 Email／密碼登入。
7. 登入後到 **設定 → 雲端同步** 按「**測試連線**」→「**備份到雲端**」。

> MCP、Telegram Bot 與 AI Worker 是伺服器端程式，改用 `service_role` 存取 `dashboards`；詳見各子資料夾的 README。`service_role` 不可出現在瀏覽器、截圖或 Git。

### 日常使用

- 另一台裝置：用同一個 Supabase 專案與文件金鑰登入 → 按「**從雲端還原**」
- 開啟「**每次變更後自動上傳**」：本機編輯約 2.5 秒後自動同步到雲端
- 開啟「**自動接收雲端變更**」：每 30 秒檢查雲端，別台裝置或 Telegram 的更新會自動出現
- 開啟網頁時若偵測到雲端版本較新，會跳出詢問是否載入
- 登出只清除登入 session；本機快取仍保留。共用電腦請在瀏覽器設定中清除此網站資料。

### 透過 Telegram 新增任務（選用）

設定一支 Telegram Bot，就能直接傳「買牛奶 明天」把任務寫進雲端；按「AI 待辦」則會把需求放進「任務 → AI 工作區」。詳見 [`telegram-bot/README.md`](telegram-bot/README.md)。

### 透過 MCP 新增一般任務（選用）

如果老闆使用 OpenCode 或支援 Remote MCP 的 AI 助手，可以讓助手直接呼叫 `create_task`，把交辦事項放進「任務 → 我的任務」，建立後發 Telegram 通知。每個 MCP Client 使用自己的 token，Server 會自動記錄交辦人；看板會顯示 `MCP` 徽章與交辦人，也可以用「MCP 交辦」篩選。MCP Server 只開放新增一般任務、查專案、查 MCP 交辦任務，不會寫入 AI 工作區。部署與 OpenCode 設定見 [`mcp-task/README.md`](mcp-task/README.md)。

### AI 工作區與 Agent

AI 工作區在「任務」頁的子頁，資料存在 `state.aiTasks`，雲端同步時位於 `dashboards.payload.aiTasks`。每筆任務包含：

```json
{
  "id": "任務 id",
  "title": "整理會議逐字稿",
  "instruction": "給 AI 的背景與指示",
  "status": "todo | doing | waiting | done",
  "progress": 0,
  "priority": "high | mid | low",
  "owner": "AI Agent",
  "due": "2026-10-25",
  "waitingFor": "等待人工確認的原因",
  "result": "完成結果",
  "createdAt": "2026-10-22",
  "updatedAt": "2026-10-22T08:00:00.000Z",
  "completedAt": null,
  "history": []
}
```

未來的 AI Agent 若透過瀏覽器自動化操作，可在 Console 直接呼叫：

```js
wdAI.list()                                  // 讀取全部任務
wdAI.list('todo')                            // 只讀待辦
wdAI.add({ title: '新任務', instruction: '…' })
wdAI.update(id, { status: 'doing', progress: 40, note: '開始處理' })
wdAI.update(id, { status: 'waiting', waitingFor: '請確認名單' })
wdAI.complete(id, '已完成並輸出摘要')          // 自動設為 done / 100%
wdAI.apply([{ id, status: 'doing', progress: 60 }])
```

AI 工作區下方也提供「複製 AI 待辦 JSON」、「複製 Agent 指令」、「套用 Agent 更新」，可把任務資料交給雲端 Agent，再把回傳的 JSON 貼回來。Agent 直接寫 Supabase 時，請先取得最新 payload，以 `id` 更新 `payload.aiTasks`，保留其他任務與 dashboard 欄位，並更新 `updated_at`，避免覆蓋其他裝置的變更。

若 Telegram 顯示已新增 AI 待辦、但看板沒看到，請到「任務 → AI 工作區」，按最下方的「檢查／補回雲端 AI 待辦」。它會直接讀取目前同步設定指向的雲端資料列，顯示雲端 AI 待辦筆數，並可把本機缺少的項目補回。若顯示 0 筆，代表 Telegram 的 `DASH_URL`／`DASH_ID` 與看板同步設定不同，或雲端資料已被其他分頁覆蓋。

### 注意

- 登入只保護雲端資料與畫面；本機 localStorage 仍是明文。共用電腦請登出並清除網站資料。
- `dashboard_members` 內的所有帳號共用同一份看板；若需要每人獨立資料，還要再做 per-user 文件對應。
- `dashboard_members` 是登入白名單；停用某個帳號只要把 `active` 改成 `false`。
- 免費專案閒置 7 天會暫停，回 Supabase 官網按 Restore 即可。
- 之後要搬到自己的伺服器：把同步邏輯改用你自己的 API（同樣是 URL＋金鑰＋GET/PUT JSON 即可）。

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新的 repository（例如 `work-dashboard`，Public）。
2. 在此資料夾初始化並推送：

```powershell
cd C:\Users\m9552\work-dashboard
git init
git add index.html auth.js auth-setup.sql styles.css app.js README.md
git commit -m "工作儀錶板 v1"
git branch -M main
git remote add origin https://github.com/<你的帳號>/work-dashboard.git
git push -u origin main
```

> 如果 `git push` 出現連線逾時（公司網路／代理），請使用 opencode 的 github-proxy-fallback 技能，或先執行：
> `git config --global http.proxy http://<proxy>:<port>`

3. 到 repo → Settings → Pages → Build and deployment：
   - Source：**Deploy from a branch**
   - Branch：**main** / **/(root)** → Save
4. 等 1～2 分鐘，網址即為：

```
https://<你的帳號>.github.io/work-dashboard/
```

日後更新：改完檔案後執行 `git add -A`、`git commit -m "update"`、`git push` 即可。

## 備份建議

- 設定頁「匯出 JSON」一鍵下載全部資料
- 換電腦或瀏覽器時：開啟網站 → 設定 → 匯入 JSON
- 網頁版與本機版共用同一套格式，可互相匯入

## 路線圖

- **v1.6**：AI 工作區（AI 待辦、進度、等待確認、完成、Agent API）✅
- **v1.7**：Supabase Auth 登入、dashboard_members 白名單、RLS 收緊與 service_role 伺服器存取 ✅
- **v1.8**：GitHub 專案面板（顯示 issue、PR 狀態）
- **v2**：Google Calendar／Outlook 日曆整合（OAuth）、信件待辦萃取
- 雲端同步：✅ 已完成（Supabase；可自訂 API 替換）
- Telegram 收集：✅ 任務／私人行程／會議（按鈕確認；Edge Function）
- MCP 任務入口：✅ 老闆 AI 助手 → 一般任務（Remote MCP；Edge Function）
