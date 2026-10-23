# MCP 任務入口（mcp-task）

讓老闆的 AI 助手（OpenCode、Hermes Agent 或其他支援 Remote MCP 的 Client）把交辦事項直接放進工作儀錶板的**一般任務區**，建立後立即發 Telegram 通知。

每個 MCP Client 使用自己的 Bearer token；Server 會用 token 查出交辦人名稱，寫入任務的 `sender` 欄位。這樣看板與 Telegram 都能看出「是誰丟過來的」。

## 邊界

- 只寫入 `tasks`（一般任務），**不寫入 `aiTasks`**。
- 只開放三個工具：
  - `create_task`：新增一般任務
  - `list_projects`：查專案名稱／ID
  - `list_assigned_tasks`：查 MCP 交辦任務（只回傳 `source=mcp` 或 `assignedBy=boss` 的資料）
- 每個 Client 一組 token，token 只存 SHA-256 hash 在 `mcp_clients` 資料表。
- `MCP_TOKEN` 是舊版單一 token 的相容模式；遷移完成後建議刪除。
- 任務建立成功後才發 Telegram；Telegram 失敗不會回滾任務，只會在回應中提示。
- 已開啟的看板會在 30 秒內自動接收雲端變更；若同一個看板分頁剛好有本機修改，先重新整理再編輯，避免舊資料覆蓋新任務。

## 如何辨識 MCP 任務與交辦人

- 看板卡片與清單會顯示 `MCP` 徽章。
- 任務頁的篩選列有「MCP 交辦」，只顯示 MCP 任務。
- 打開任務編輯視窗時，標題旁會顯示「MCP 交辦 · 交辦人名稱」。
- 看板卡片、清單與報表的副標也會顯示「某某 交辦」。
- 資料欄位：
  - `source: "mcp"`：來源是 MCP。
  - `assignedBy: "boss"`：任務擁有者，預設由 `MCP_ASSIGNED_BY` 決定。
  - `sender`：由 token 對應到的實際交辦人／助手名稱。
  - `externalId`：去識別碼，用於重試去重。
- 舊任務沒有 `sender` 時，UI 會退回顯示 `assignedBy`（通常是「老闆」）。

## 架構

```text
老闆的 OpenCode / Hermes / 其他 Client
        │  Authorization: Bearer <各自的 token>
        ▼
Supabase Edge Function：mcp-task
        │  1. SHA-256(token)
        │  2. RPC resolve_mcp_client(hash)
        ▼
public.mcp_clients（只存 token hash、名稱、active、last_used_at）
        │  回傳 sender 名稱
        ▼
Supabase dashboards.payload.tasks（source=mcp、sender=...）
        │
        └─ Telegram Bot API → Mickey（含交辦人）
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.ts` | Supabase Edge Function，Remote MCP Server |
| `setup.sql` | 建立 `append_task_once()`，原子追加＋`externalId` 去重 |
| `token-registry.sql` | 建立 `mcp_clients` 與 `resolve_mcp_client()` token 驗證 |
| `token.mjs` | 在本機產生 token、SHA-256 與可直接貼上的 SQL |
| `opencode.example.jsonc` | OpenCode V2 的 MCP 設定範例 |

## 部署步驟

### 1. 建立資料庫函式

Supabase Dashboard → **SQL Editor** → 新查詢。

依序執行：

1. `setup.sql`
2. `token-registry.sql`

成功後可確認：

```sql
select proname
from pg_proc
where proname in ('append_task_once', 'resolve_mcp_client');
```

以及：

```sql
select id, name, active, created_at, last_used_at
from public.mcp_clients
order by created_at;
```

### 2. 部署 Edge Function

Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**。

- Function name：`mcp-task`
- 將 `index.ts` 完整貼進去
- **Verify JWT：關閉**（重要）
- Deploy

> 為什麼要關 JWT？
> OpenCode 送的是我們自己的 Bearer token，不是 Supabase JWT。若 Edge Function 開啟 JWT 驗證，請求會在進入程式前就被 Supabase 擋下，回 401。

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

選用：

| Secret | 說明 |
|---|---|
| `MCP_ASSIGNED_BY` | 任務擁有者，預設 `boss`；會寫入 `assignedBy` |
| `MCP_TOKEN` | **舊版單一 token**。遷移到 `mcp_clients` 後建議刪除 |
| `MCP_ALLOWED_ORIGIN` | 選用；限制瀏覽器 Origin，Server-to-Server 可不設 |

`DASH_KEY` 使用 anon / publishable key 即可；`resolve_mcp_client()` 是 `security definer`，一般使用者不能直接讀 `mcp_clients`。

### 4. 建立第一個 MCP Client token

在專案根目錄執行：

```powershell
node mcp-task/token.mjs "老闆的 OpenCode"
```

輸出會包含：

- `Token`：只顯示一次，請用安全通道交給該 Client。
- `SHA-256`：貼到資料庫的 `token_hash`。
- 一段 `insert` SQL：可直接貼到 SQL Editor。

> 若 PowerShell 顯示中文亂碼，先執行 `chcp 65001`，或 `name` 先用英文（例如 `Boss-OpenCode`）。

建議到 Supabase Dashboard → **Table Editor** → `mcp_clients` → **Insert row**，填入：

| 欄位 | 值 |
|---|---|
| `name` | 例如 `老闆的 OpenCode`、`Hermes`、`特助 A` |
| `token_hash` | `token.mjs` 輸出的 SHA-256 |
| `active` | `true` |
| `note` | 選填，例如「老闆筆電」 |

也可以直接執行 `token.mjs` 輸出的 SQL。

**不要把明文 token 放進資料表、Git、截圖或對話。** 資料表只需要 hash。

### 5. 測試 MCP

先在本機設定環境變數（目前這個 PowerShell 視窗有效）：

```powershell
$env:MCP_TASK_TOKEN = "<剛才產生的 token>"
$url = "https://<PROJECT_REF>.supabase.co/functions/v1/mcp-task"
$headers = @{
  Authorization = "Bearer $env:MCP_TASK_TOKEN"
  "MCP-Protocol-Version" = "2025-06-18"
}

# Windows PowerShell 5.1 直接傳字串時可能用非 UTF-8 編碼，中文會變成 ?。
# 一律先轉成 UTF-8 byte[] 再送出。
function Invoke-Mcp($id, $method, $params) {
  $json = @{
    jsonrpc = "2.0"
    id = $id
    method = $method
    params = $params
  } | ConvertTo-Json -Depth 10
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  Invoke-RestMethod -Uri $url -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes
}
```

`initialize`：

```powershell
Invoke-Mcp 1 "initialize" @{
  protocolVersion = "2025-06-18"
  capabilities = @{}
  clientInfo = @{ name = "powershell-test"; version = "1.0" }
}
```

`tools/list`：

```powershell
Invoke-Mcp 2 "tools/list" @{}
```

新增測試任務：

```powershell
Invoke-Mcp 3 "tools/call" @{
  name = "create_task"
  arguments = @{
    title = "測試：MCP 新增任務"
    note = "來自部署測試，可刪除"
    due = "2026-10-30"
    priority = "high"
    externalId = "test-mcp-002"
  }
}
```

回應中的 `task.sender` 應該是你在 `mcp_clients.name` 設定的名稱，例如 `老闆的 OpenCode`。Telegram 通知也會多一行「交辦人：老闆的 OpenCode」。

再執行一次同樣的 `create_task`，應該回傳 `duplicate: true`，且看板不會多一筆。

如果之前用字串送出，中文已經變成 `?`，那筆資料無法還原；請刪除該測試任務，或改用新的 `externalId` 再測一次。

## 管理 MCP token

### 誰可以申請 token？

由你（MCP Server 管理者）產生並分配，**不是每個人自行註冊**。流程是：

1. 對方告訴你他要用的名稱（例如「老闆的 OpenCode」）。
2. 你執行 `token.mjs` 產生 token。
3. 你在 Supabase Table Editor 新增 `mcp_clients` 列。
4. 你把 token 用安全通道交給對方，對方設定成自己的 `MCP_TASK_TOKEN`。

如果兩個人或兩個助手共用同一組 token，Server 會視為同一個身份，無法區分。`mcp_clients.name` 也請盡量唯一；同名 token 在任務上會顯示相同交辦人。

### 從舊版單一 `MCP_TOKEN` 遷移

目前的 OpenCode 可能還在使用 `MCP_TOKEN`，所有任務都會記成 `assignedBy=boss`。要切換到可辨識交辦人的模式：

1. 用 `token.mjs` 為該 OpenCode 產生新 token。
2. 在 `mcp_clients` 新增一列（例如 `name = "老闆的 OpenCode"`）。
3. 把 OpenCode 的 `MCP_TASK_TOKEN` 改成新 token，重開 OpenCode。
4. 建立一筆測試任務，確認回應與看板顯示 `sender = 老闆的 OpenCode`。
5. 確認沒問題後，刪除 Supabase Secret `MCP_TOKEN`。

刪除 `MCP_TOKEN` 後，舊 token 會立即失效；其他還沒遷移的 Client 也會被擋下，所以請先確認所有 Client 都已換成 registry token。

### 用 Supabase Dashboard 管理

可以。日常管理都在：

**Supabase Dashboard → Table Editor → `mcp_clients`**

| 操作 | 做法 |
|---|---|
| 發新 token | 新增一列，填 `name`、`token_hash`、`active=true` |
| 停用 | 把 `active` 改成 `false`，下一個請求立即失效 |
| 撤銷 | 刪除該列（或保留列但設 `active=false`） |
| 查使用狀況 | 看 `last_used_at` |
| 輪替 token | 新增一列新 token；Client 換成新 token 後，把舊列停用 |
| 改名 | 直接改 `name`；只影響之後的任務，舊任務保留當時的 `sender` |

`last_used_at` 由 `resolve_mcp_client()` 在每次通過驗證時更新，不需要人工維護。

### 為什麼不建議用 Supabase Secrets 管理多組 token？

Secrets 適合放「Server 的全域設定」，不適合放多個使用者 token：

- 儲存後不能查看原值，只能覆寫或刪除。
- 沒有名稱、active、last_used_at 等欄位。
- 輪替一個人就要改整個 secret。
- 沒有列表／審計介面。

所以 `MCP_TOKEN` 只保留作為舊版相容；新架構請用 `mcp_clients`。

### 可以放在工作儀錶板裡管理嗎？

目前不建議。工作儀錶板的資料層仍是 anon 可讀寫，沒有登入與管理員權限；把 token 管理介面放進去會讓有看板存取權的人也能發 token。

如果你要的是「在自己的工作儀錶板管理」，下一步需要先加登入／管理員權限，再做 admin 頁面。現階段用 Supabase Dashboard 的 Table Editor 最安全也最省事。

## 老闆的 OpenCode V2 設定

把 `opencode.example.jsonc` 的內容合併到老闆的 OpenCode 設定檔：

- 專案設定：`opencode.jsonc`
- 全域設定（Windows）：`%USERPROFILE%\.config\opencode\opencode.json`

OpenCode V2 的遠端 MCP 放在 `mcp.servers`，不是舊版的 `mcp` 直屬項目。

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

老闆電腦要先設定自己的 token：

```powershell
[Environment]::SetEnvironmentVariable("MCP_TASK_TOKEN", "<該 Client 的 token>", "User")
```

設定完要**重開 OpenCode**，再確認：

```powershell
opencode mcp list
```

應該看到 `mickey-tasks  connected`。進入 OpenCode 後，工具會以類似 `mickey_tasks_create_task` 的名稱出現；直接對助手說「幫我交辦：下週五前整理 Q4 預算，備註…」即可。

## Hermes Agent

若 Hermes 支援標準 Remote MCP，設定同樣是：

- URL：`https://<PROJECT_REF>.supabase.co/functions/v1/mcp-task`
- Header：`Authorization: Bearer <該 Hermes 的 token>`

建議幫 Hermes 建一列獨立的 `mcp_clients`，例如 `name = "Hermes"`，這樣看板就能區分是 OpenCode 還是 Hermes 丟的。

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
  "sender": "由 token 對應的名稱",
  "externalId": "由 Client 提供或 null"
}
```

`create_task` **沒有** `sender` 參數；交辦人一定由 Server 的 token 驗證結果決定，Client 不能自己填。

### `list_projects`

無參數，回傳專案 `id`、`name`、`desc`。

### `list_assigned_tasks`

參數 `status`：`open`（預設）／`done`／`all`，也接受 `未完成`／`完成`／`全部`。只回傳 MCP 交辦的任務，最多 20 筆；每筆會包含 `sender`。

## 疑難排解

| 症狀 | 原因／處理 |
|---|---|
| `401 Unauthorized` | token 不正確、`active=false`、`token_hash` 與 token 不一致，或 Header 沒帶 `Bearer ` |
| `503` 且訊息提到 token registry | 尚未執行 `token-registry.sql`，或 `DASH_URL` / `DASH_KEY` 沒設定 |
| `resolve_mcp_client` 不存在 | 執行 `token-registry.sql`；若剛建立，等幾秒或執行 `notify pgrst, 'reload schema';` |
| Supabase 回 401，但 Function log 沒進來 | Edge Function 的 **Verify JWT** 還開著，關掉後重新部署 |
| `404` | URL 少了 `/functions/v1/mcp-task`，或 Function 名稱不同 |
| `append_task_once` 不存在 | 還沒執行 `setup.sql`；若剛建立，等幾秒或執行 `notify pgrst, 'reload schema';` |
| 任務有建立但 Telegram 沒通知 | `BOT_TOKEN` / `ALLOWED_CHAT_ID` 未設定，或 Chat ID 不對；看 Function log |
| 任務重複 | Client 重試但沒有帶相同 `externalId`；請助手重試時帶固定值 |
| 看板上的交辦人是「老闆」而不是預期名稱 | 可能還在用舊 `MCP_TOKEN`，或 token 對到舊的 `mcp_clients` 列；確認 Client 用的是新 token |
| 中文變成 `?` 或亂碼 | Windows PowerShell 5.1 的 `Invoke-RestMethod` 用非 UTF-8 編碼送字串；改用 UTF-8 `byte[]`（見測試段落）。OpenCode 正常會送 UTF-8。 |
| `list_projects` 找不到專案 | 專案名稱必須與看板完全一致（英文不分大小寫） |

## 安全建議

- 每個 Client 一組 token；不要共用。
- 資料表只存 SHA-256 hash，明文 token 只交給對方一次。
- token 外洩時，把 `mcp_clients.active` 設為 `false` 即可立即撤銷，不需要重新部署。
- 定期輪替：建立新列、更新 Client、停用舊列。
- 遷移完成後刪除 Supabase Secret `MCP_TOKEN`，避免舊 token 繼續以「老闆」身份寫入。
- `MCP_ALLOWED_ORIGIN` 只是額外的瀏覽器限制，不是主要驗證；主要驗證仍是 Bearer token。
- 目前看板 RLS 允許 anon 讀寫整個看板；若之後要收緊，應改成登入制並重新設計 RLS，而不是只依賴 MCP token。
