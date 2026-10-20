# 工作儀錶板（Work Dashboard）

個人工作儀錶板：任務、專案、會議、文件、工時統計，外加一個收納常用網站的摸魚區；單一頁面、純前端、無依賴。

## 功能

| 頁面 | 功能 |
|---|---|
| 總覽 | KPI（本週到期／進行中／逾期／完成率）、今日焦點、近期會議、專案進度 |
| 任務 | 看板（可拖放換狀態）⇄ 清單、篩選（高優先／本週／逾期）、新增/編輯/刪除 |
| 專案 | 進度自動計算、里程碑點擊切換、未完成任務數 |
| 會議 | 月曆（翻頁）、即將到來與歷史紀錄、行動項追蹤、**一鍵轉任務** |
| 文件 | 知識庫卡片、搜尋、標籤篩選、外部連結 |
| 統計 | 工時記錄、本週工時圖、近四週完成率 |
| 摸魚區 | 常用網站收藏：卡片式、favicon、點擊開新分頁、新增/編輯/刪除 |
| 設定 | JSON 匯出／匯入（也可直接把 .json 拖進頁面）、**Supabase 雲端同步**、示範資料、清除資料 |

其他：Ctrl+K 全域搜尋、深淺色跟隨系統、五種主色即時切換。

## 檔案

```
index.html    入口（部署時的主要檔案）
styles.css    樣式
app.js        核心邏輯（資料、儲存、互動）
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
- 開啟網頁時若偵測到雲端版本較新，會跳出詢問是否載入

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

- **v1.5**：GitHub 專案面板（顯示 issue、PR 狀態）
- **v2**：Google Calendar／Outlook 日曆整合（OAuth）、信件待辦萃取
- 雲端同步：✅ 已完成（Supabase；可自訂 API 替換）
