# MCP 任務入口（mcp-task）

讓老闆的 AI 助手（OpenCode、Hermes Agent 或其他支援 Remote MCP 的 Client）把交辦事項直接放進工作儀錶板的**一般任務區**，建立後立即發 Telegram 通知。

## 邊界

- 只寫入 `tasks`（一般任務），**不寫入 `aiTasks`**。
- 只開放三個工具：
  - `create_task`：新增一般任務
  - `list_projects`：查專案名稱／ID
  - `list_assigned_tasks`：查老闆自己交辦的任務（只回傳 `source=mcp` 或 `assignedBy=boss` 的資料）
- 使用獨立的 `MCP_TOKEN` Bearer 驗證，不需要把 Supabase anon key 給老闆。
- 任務建立成功後才發 Telegram；Telegram 失敗不會回滾任務，只會在回應中提示。
- 已開啟的看板會在 30 秒內自動接收雲端變更；若同一個看板分頁剛好有本機修改，先重新整理再編輯，避免舊資料覆蓋新任務。

## 架構

```text
老闆的 AI 助手（OpenCode / Hermes）
        │  HTTPS + Authorization: Bearer <MCP_TOKEN>
        ▼
Supabase Edge Function：mcp-task
        │  REST/RPC（使用既有 DASH_KEY）
        ▼
Supabase dashboards.payload.tasks
        │
        └─ Telegram Bot API → Mickey
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.ts` | Supabase Edge Function，Remote MCP Server |
| `setup.sql` | 建立 `append_task_once()`，原子追加＋`externalId` 去重 |
| `opencode.example.jsonc` | 老闆 OpenCode V2 的 MCP 設定範例 |

## 部署步驟

### 1. 建立資料庫函式

Supabase Dashboard → **SQL Editor** → 新查詢 → 貼上 `setup.sql` → Run。

成功後應該有：

```sql
select proname
from pg_proc
where proname = 'append_task_once';
```

### 2. 部署 Edge Function

Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**。

- Function name：`mcp-task`
- 將 `index.ts` 完整貼進去
- **Verify JWT：關閉**（重要）
- Deploy

> 為什麼要關 JWT？
> OpenCode 送的是我們的 `MCP_TOKEN`，不是 Supabase JWT。若 Edge Function 開啟 JWT 驗證，請求會在進入程式前就被 Supabase 擋下，回 401。

部署後網址會像：

```text
https://<PROJECT_REF>.supabase.co/functions/v1/mcp-task
```

### 3. 設定 Secrets

Supabase Dashboard → **Edge Functions** → **Secrets**（或 Project Settings → Edge Functions）。

如果 Telegram Bot 已經在用，以下通常已存在，不用重複設定：

| Secret | 說明 |
|---|---|
| `DASH_URL` | `https://<PROJECT_REF>.supabase.co`（不要加 `/rest/v1`） |
| `DASH_KEY` | 既有的 anon / publishable key |
| `DASH_ID` | 看板 ID |
| `BOT_TOKEN` | Telegram Bot Token（選用） |
| `ALLOWED_CHAT_ID` | Mickey 的 Telegram Chat ID（選用） |

新增：

| Secret | 說明 |
|---|---|
| `MCP_TOKEN` | 老闆 AI 助手使用的 Bearer token，必填 |
| `MCP_ASSIGNED_BY` | 選用，預設 `boss` |
| `MCP_ALLOWED_ORIGIN` | 選用，限制瀏覽器 Origin；Server-to-Server 可不設 |

產生一組高強度 token（在本機 PowerShell 執行，不要把輸出貼到對話）：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

把同一組 token 設到 Supabase 的 `MCP_TOKEN`，以及老闆電腦的 `MCP_TASK_TOKEN` 環境變數。**Token 不要寫進 `opencode.jsonc`。**

### 4. 測試 MCP

先在本機設定環境變數（目前這個 PowerShell 視窗有效）：

```powershell
$env:MCP_TASK_TOKEN = "<剛才產生的 token>"
$url = "https://<PROJECT_REF>.supabase.co/functions/v1/mcp-task"
$headers = @{
  Authorization = "Bearer $env:MCP_TASK_TOKEN"
  "Content-Type" = "application/json"
  "MCP-Protocol-Version" = "2025-06-18"
}
```

`initialize`：

```powershell
$body = @{
  jsonrpc = "2.0"
  id = 1
  method = "initialize"
  params = @{
    protocolVersion = "2025-06-18"
    capabilities = @{}
    clientInfo = @{ name = "powershell-test"; version = "1.0" }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
```

`tools/list`：

```powershell
$body = @{ jsonrpc = "2.0"; id = 2; method = "tools/list"; params = @{} } |
  ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
```

新增測試任務（故意用 `externalId` 測去重）：

```powershell
$body = @{
  jsonrpc = "2.0"
  id = 3
  method = "tools/call"
  params = @{
    name = "create_task"
    arguments = @{
      title = "測試：MCP 新增任務"
      note = "來自部署測試，可刪除"
      due = "2026-10-30"
      priority = "high"
      externalId = "test-mcp-001"
    }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
```

再執行一次同樣的 `create_task`，應該回傳 `duplicate: true`，且看板不會多一筆。最後到工作儀錶板確認「任務 → 我的任務」出現資料，Telegram 也應收到通知。

## 老闆的 OpenCode V2 設定

把 `opencode.example.jsonc` 的內容合併到老闆的 OpenCode 設定檔：

- 專案設定：`opencode.jsonc`
- 全域設定（Windows）：`%USERPROFILE%\.config\opencode\opencode.json`

OpenCode V2 的遠端 MCP 放在 `mcp.servers`，不是舊版的 `mcp` 直屬項目。

設定範例：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "mickey-tasks": {
        "type": "remote",
        "url": "https://<PROJECT_REF>.supabase.co/functions/v1/mcp-task",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:MCP_TASK_TOKEN}"
        }
      }
    }
  }
}
```

老闆電腦要先設定環境變數：

```powershell
[Environment]::SetEnvironmentVariable("MCP_TASK_TOKEN", "<token>", "User")
```

設定完要**重開 OpenCode**，再確認：

```powershell
opencode mcp list
```

應該看到 `mickey-tasks  connected`。進入 OpenCode 後，工具會以類似 `mickey_tasks_create_task` 的名稱出現；直接對助手說「幫我交辦：下週五前整理 Q4 預算，備註…」即可。

### Hermes Agent

若 Hermes 支援標準 Remote MCP，設定同樣是：

- URL：`https://<PROJECT_REF>.supabase.co/functions/v1/mcp-task`
- Header：`Authorization: Bearer <MCP_TOKEN>`

若 Hermes 不支援 Remote MCP 或自訂 header，先不要硬接；改用其他支援 MCP 的 Client，或之後再接公司 HCL Notes REST API。

## 工具說明

### `create_task`

| 參數 | 必填 | 說明 |
|---|---|---|
| `title` | 是 | 任務標題，最多 200 字 |
| `note` | 否 | 補充說明，最多 2000 字 |
| `due` | 否 | `YYYY-MM-DD`；不確定可省略 |
| `priority` | 否 | `high` / `mid` / `low`，也接受 `高` / `中` / `低` |
| `project` | 否 | 專案名稱或 ID；不確定先用 `list_projects` |
| `externalId` | 否 | 去識別碼；重試時帶相同值可避免重複 |

建立的任務會帶：

```json
{
  "source": "mcp",
  "assignedBy": "boss",
  "externalId": "由 Client 提供或 null"
}
```

### `list_projects`

無參數，回傳專案 `id`、`name`、`desc`。

### `list_assigned_tasks`

參數 `status`：`open`（預設）／`done`／`all`，也接受 `未完成`／`完成`／`全部`。只回傳老闆交辦的任務，最多 20 筆。

## 疑難排解

| 症狀 | 原因／處理 |
|---|---|
| `401 Unauthorized` | `MCP_TOKEN` 與 `MCP_TASK_TOKEN` 不一致，或 Header 沒帶 `Bearer ` |
| Supabase 回 401，但 Function log 沒進來 | Edge Function 的 **Verify JWT** 還開著，關掉後重新部署 |
| `404` | URL 少了 `/functions/v1/mcp-task`，或 Function 名稱不同 |
| `append_task_once` 不存在 | 還沒執行 `setup.sql`；若剛建立，等幾秒或執行 `notify pgrst, 'reload schema';` |
| 任務有建立但 Telegram 沒通知 | `BOT_TOKEN` / `ALLOWED_CHAT_ID` 未設定，或 Chat ID 不對；看 Function log |
| 任務重複 | Client 重試但沒有帶相同 `externalId`；請助手重試時帶固定值 |
| `list_projects` 找不到專案 | 專案名稱必須與看板完全一致（英文不分大小寫） |

## 安全建議

- `MCP_TOKEN` 等同密碼，只給老闆的 AI 助手使用；不要放在 Git、截圖或對話。
- 定期輪換：更新 Supabase `MCP_TOKEN`，同步更新老闆電腦的 `MCP_TASK_TOKEN`。
- Edge Function 只用 `DASH_KEY`（anon / publishable）呼叫 RPC，不需要 `service_role`。
- `MCP_ALLOWED_ORIGIN` 只是額外的瀏覽器限制，不是主要驗證；主要驗證仍是 Bearer token。
- 目前 RLS 允許 anon 讀寫整個看板；若之後要收紧，應改成登入制並重新設計 RLS，而不是只依賴 MCP token。
