# 工作儀錶板（Work Dashboard）

個人工作儀錶板：任務、專案、會議與私人行程、文件、工時統計與工作報表，外加 AI 工作區與收納常用網站的摸魚區；單一頁面、純前端、無依賴。

## 功能

| 頁面 | 功能 |
|---|---|
| 總覽 | KPI（本週到期／進行中／逾期／完成率）、今日焦點、近期行程（會議＋私人行程）、專案進度 |
| 任務 | 看板（可拖放換狀態）⇄ 清單、篩選（高優先／本週／逾期）、新增/編輯/刪除 |
| AI 工作區 | 位於任務頁子頁：AI 待辦、處理進度、等待確認、完成四區；任務指示、進度、結果、更新紀錄；複製 JSON／Agent 指令、套用 Agent 更新 |
| 專案 | 進度自動計算、里程碑點擊切換、未完成任務數 |
| 會議 | 月曆（翻頁，會議／私人行程雙色圓點）、點日期查看當天行程、新增私人行程（支援多日行程）、即將到來與歷史紀錄、行動項追蹤、**一鍵轉任務** |
| 文件 | 知識庫卡片、搜尋、標籤篩選、外部連結 |
| 統計 | **工時統計**：工時記錄、本週工時圖、近四週完成率；**工作報表**：日／週／月切換、完成／到期未完成清單、會議行動項、里程碑、依專案工時、複製摘要、CSV 匯出 |
| 摸魚區 | 常用網站收藏：卡片式、favicon、點擊開新分頁、新增/編輯/刪除 |
| 設定 | JSON 匯出／匯入（也可直接把 .json 拖進頁面）、**Supabase 雲端同步**、示範資料、清除資料 |

其他：Ctrl+K 全域搜尋、深淺色跟隨系統、五種主色即時切換、Telegram Bot（訊息 → 按鈕選任務／私人行程／會議／AI 待辦，支援多日行程，見 `telegram-bot/README.md`）。AI 工作區另提供 `window.wdAI` 瀏覽器 API，方便未來的 AI Agent 讀取與更新。

> 工作報表口徑：完成數依「完成日」，未完成依「到期日」；兩者分開呈現。行動項與里程碑自 v1.2 起記錄完成日（`doneAt`），較早完成的舊資料不會列入期間統計。私人行程只顯示於行事曆，不列入工作報表與工時統計。

## 檔案

```
index.html    入口（部署時的主要檔案）
styles.css    樣式
app.js        核心邏輯（資料、儲存、互動）
telegram-bot/ Telegram → 任務／私人行程／會議（Supabase Edge Function，選用）
prototype.html  早期風格原型（可刪除）
README.md     本說明
```

## 使用

直接雙擊 `index.html` 即可使用。資料儲存在瀏覽器 localStorage（每個瀏覽器獨立），定期用「設定 → 匯出 JSON」備份。

如果想用本機伺服器開啟（例如 Chrome 的檔案存取限制較嚴時）：

```powershell
cd C:\Users\m9552\work-dashboard
python -m http.server 8080
# 瀏覽 http://localhost:8080
```

## 跨裝置同步（Supabase 免費版）

讓不同瀏覽器／裝置共用同一份資料。Supabase 是免費的 Postgres 雲端資料庫，之後要搬到自己的伺服器時，把它換成自訂 API 即可。

### 一次性設定

1. 到 [supabase.com](https://supabase.com) 註冊 → **New project**（免費方案）
2. 左側選單 **SQL Editor** → 貼上以下 SQL → **Run**：

```sql
create table if not exists dashboards (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table dashboards enable row level security;
create policy "anon all" on dashboards
  for all using (true) with check (true);
```

3. **Project Settings** 裡兩個頁面各拿一半：
   - **Data API** 頁 → 複製 **API URL**（`https://xxxx.supabase.co`）
   - **API Keys** 頁 → 複製 **anon public key**（或新版 **Publishable key**）
   - ⚠️ 不要使用 `service_role`／`Secret key`（伺服器專用、權限全開）
4. 儀錶板 → **設定 → 雲端同步**：
   - 貼上 Project URL 與 anon key
   - 自訂一組「**文件金鑰**」（像密碼，多台裝置要填一樣的）
   - 按「**測試連線**」→ 成功後按「**備份到雲端**」

### 日常使用

- 另一台裝置：填相同設定 → 按「**從雲端還原**」
- 開啟「**每次變更後自動上傳**」：本機編輯約 2.5 秒後自動同步到雲端
- 開啟「**自動接收雲端變更**」：每 30 秒檢查雲端，別台裝置或 Telegram 的更新會自動出現
- 開啟網頁時若偵測到雲端版本較新，會跳出詢問是否載入

### 透過 Telegram 新增任務（選用）

設定一支 Telegram Bot，就能直接傳「買牛奶 明天」把任務寫進雲端；按「AI 待辦」則會把需求放進「任務 → AI 工作區」。詳見 [`telegram-bot/README.md`](telegram-bot/README.md)。

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

### 注意

- 「文件金鑰」等於這份資料的密碼，請勿外流
- 免費專案閒置 7 天會暫停，回 Supabase 官網按 Restore 即可
- 之後要搬到自己的伺服器：把同步邏輯改用你自己的 API（同樣是 URL＋金鑰＋GET/PUT JSON 即可）

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新的 repository（例如 `work-dashboard`，Public）。
2. 在此資料夾初始化並推送：

```powershell
cd C:\Users\m9552\work-dashboard
git init
git add index.html styles.css app.js README.md
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
- **v1.7**：GitHub 專案面板（顯示 issue、PR 狀態）
- **v2**：Google Calendar／Outlook 日曆整合（OAuth）、信件待辦萃取
- 雲端同步：✅ 已完成（Supabase；可自訂 API 替換）
- Telegram 收集：✅ 任務／私人行程／會議（按鈕確認；Edge Function）
