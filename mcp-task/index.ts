// Supabase Edge Function: mcp-task
// 遠端 MCP Server：讓老闆的 AI 助手新增一般任務，並發 Telegram 通知。
//
// 部署：Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor
//      名稱：mcp-task
//      JWT verification：關閉（改用 Bearer token 驗證）
// Secrets：
//   DASH_URL / DASH_KEY / DASH_ID   既有看板同步設定
//   BOT_TOKEN / ALLOWED_CHAT_ID     既有 Telegram Bot 設定（選用，沒有就不通知）
//   MCP_ASSIGNED_BY          任務擁有者標記，預設 boss
//   MCP_TOKEN                舊版單一 token（選用；遷移到 token registry 後可刪除）
//   MCP_ALLOWED_ORIGIN       選用；若有瀏覽器 Origin，限制來源
//
// 先執行同資料夾的 setup.sql 與 token-registry.sql。
// 每個 MCP Client 使用 mcp_clients 資料表中的一組 token，Server 會用
// SHA-256 hash 查出名稱，寫入任務的 sender 欄位。

const LEGACY_MCP_TOKEN = (Deno.env.get('MCP_TOKEN') || '').trim();
const DASH_URL = (Deno.env.get('DASH_URL') || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '')
  .replace(/\/+$/, '');
const DASH_KEY = (Deno.env.get('DASH_KEY') || '').trim();
const DASH_ID = (Deno.env.get('DASH_ID') || '').trim();
const BOT_TOKEN = (Deno.env.get('BOT_TOKEN') || Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim();
const CHAT_ID = (Deno.env.get('ALLOWED_CHAT_ID') || Deno.env.get('TELEGRAM_CHAT_ID') || '').trim();
const ASSIGNED_BY = (Deno.env.get('MCP_ASSIGNED_BY') || 'boss').trim() || 'boss';
const ALLOWED_ORIGIN = (Deno.env.get('MCP_ALLOWED_ORIGIN') || '').trim();

const SERVER_NAME = 'work-dashboard-task';
const SERVER_TITLE = 'Mickey 工作儀錶板任務';
const SERVER_VERSION = '1.1.0';
const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const PRIORITY_LABEL = { high: '高', mid: '中', low: '低' };
const STATUS_LABEL = { todo: '待辦', doing: '進行中', done: '完成' };

class ToolError extends Error {}
class AuthUnavailableError extends Error {}

type McpClient = {
  name: string;
  source: 'registry' | 'legacy';
};

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function lookupRegistryClient(token: string): Promise<string | null> {
  if (!DASH_URL || !DASH_KEY) return null;

  const tokenHash = await sha256Hex(token);
  let res: Response;
  try {
    res = await fetch(`${DASH_URL}/rest/v1/rpc/resolve_mcp_client`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ p_token_hash: tokenHash }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuthUnavailableError(
      `MCP token registry 連線失敗：${oneLine(message, 160)}`,
    );
  }

  const text = await res.text();
  if (!res.ok) {
    if (/resolve_mcp_client|function .* not found|does not exist/i.test(text)) {
      throw new AuthUnavailableError(
        'MCP token registry 尚未建立，請先執行 mcp-task/token-registry.sql。',
      );
    }
    throw new AuthUnavailableError(
      `MCP token registry 查詢失敗 (${res.status})：${tail(text)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AuthUnavailableError('MCP token registry 回應不是 JSON。');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.name) return null;
  return String(row.name);
}

async function authenticate(req: Request): Promise<McpClient | null> {
  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : '';
  if (!token) return null;

  if (DASH_URL && DASH_KEY) {
    try {
      const name = await lookupRegistryClient(token);
      if (name) return { name, source: 'registry' };
    } catch (err) {
      if (!(err instanceof AuthUnavailableError)) throw err;
      // registry 尚未建立時，舊版單一 token 仍可運作。
      if (LEGACY_MCP_TOKEN && safeEqual(token, LEGACY_MCP_TOKEN)) {
        console.error(
          'mcp-task registry unavailable; using legacy token',
          err instanceof Error ? err.message : String(err),
        );
        return { name: ASSIGNED_BY, source: 'legacy' };
      }
      throw err;
    }
  }

  if (LEGACY_MCP_TOKEN && safeEqual(token, LEGACY_MCP_TOKEN)) {
    return { name: ASSIGNED_BY, source: 'legacy' };
  }

  if (!LEGACY_MCP_TOKEN && (!DASH_URL || !DASH_KEY)) {
    throw new AuthUnavailableError(
      'MCP Server 尚未設定 MCP_TOKEN 或 DASH_URL / DASH_KEY。',
    );
  }
  return null;
}

function todayTW() {
  // 台灣固定 UTC+8，沒有日光節約時間；用位移避免依賴 Edge Runtime 的 ICU 時區資料。
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tw.toISOString().slice(0, 10);
}

function tail(text, max = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(-max) : s;
}

function oneLine(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function requireDashboardConfig() {
  if (!DASH_URL || !DASH_KEY || !DASH_ID) {
    throw new ToolError('MCP Server 尚未設定 DASH_URL / DASH_KEY / DASH_ID。');
  }
}

function sbHeaders() {
  return {
    apikey: DASH_KEY,
    Authorization: `Bearer ${DASH_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function sbGet() {
  requireDashboardConfig();
  const url =
    `${DASH_URL}/rest/v1/dashboards?id=eq.${encodeURIComponent(DASH_ID)}` +
    '&select=payload&limit=1';
  const res = await fetch(url, {
    headers: sbHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ToolError(`讀取看板失敗 (${res.status})：${tail(text)}`);
  }
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new ToolError('Supabase 回應不是 JSON。');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ToolError('找不到看板資料，請確認 DASH_ID 是否正確。');
  }
  return rows[0].payload || {};
}

async function appendTaskOnce(task, dedupeKey) {
  requireDashboardConfig();
  const res = await fetch(`${DASH_URL}/rest/v1/rpc/append_task_once`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({
      p_id: DASH_ID,
      p_task: task,
      p_dedupe_key: dedupeKey || null,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/append_task_once|function .* not found|does not exist/i.test(text)) {
      throw new ToolError('資料庫尚未建立 append_task_once，請先執行 mcp-task/setup.sql。');
    }
    throw new ToolError(`寫入任務失敗 (${res.status})：${tail(text)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ToolError('Supabase 寫入回應不是 JSON。');
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || result.ok !== true) {
    throw new ToolError(`寫入任務失敗：${tail(JSON.stringify(result || {}))}`);
  }
  return result;
}

async function tgNotify(task) {
  if (!BOT_TOKEN || !CHAT_ID) {
    return { ok: false, skipped: true, error: '未設定 BOT_TOKEN / ALLOWED_CHAT_ID' };
  }

  const lines = [
    '📥 MCP 交辦新任務',
    `[${PRIORITY_LABEL[task.priority] || '中'}] ${task.title}`,
    `截止：${task.due || '未定'}`,
  ];
  if (task.sender) lines.push(`交辦人：${task.sender}`);
  if (task.note) lines.push(`備註：${oneLine(task.note, 180)}`);
  lines.push(`任務 ID：${task.id}`);

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: lines.join('\n'),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* 下面統一處理 */
    }
    if (!res.ok || !data || data.ok !== true) {
      return {
        ok: false,
        error: `Telegram ${res.status}：${tail((data && data.description) || text)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Telegram 連線失敗：${tail(err.message || String(err))}` };
  }
}

function normalizePriority(value) {
  const raw = String(value == null ? 'mid' : value).trim().toLowerCase();
  const map = {
    high: 'high',
    mid: 'mid',
    low: 'low',
    '高': 'high',
    '中': 'mid',
    '低': 'low',
  };
  if (!map[raw]) {
    throw new ToolError('priority 必須是 high / mid / low，或 高 / 中 / 低。');
  }
  return map[raw];
}

function normalizeDue(value) {
  let s = String(value == null ? '' : value).trim().replace(/\//g, '-');
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ToolError('due 必須是 YYYY-MM-DD，例如 2026-10-30。');
  }
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new ToolError('due 不是有效日期。');
  }
  return s;
}

function cleanText(value, max, field) {
  const s = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
  if (s.length > max) throw new ToolError(`${field} 太長，最多 ${max} 字。`);
  return s;
}

async function resolveProject(project) {
  const raw = String(project == null ? '' : project).trim();
  if (!raw) return null;

  const payload = await sbGet();
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const found = projects.find(
    (p) =>
      p &&
      (String(p.id) === raw ||
        String(p.name || '').trim().toLowerCase() === raw.toLowerCase()),
  );
  if (!found) {
    const names = projects
      .map((p) => String((p && p.name) || '').trim())
      .filter(Boolean)
      .slice(0, 30);
    throw new ToolError(
      `找不到專案「${raw}」。可用專案：${names.length ? names.join('、') : '目前沒有專案'}`,
    );
  }
  return {
    id: String(found.id),
    name: String(found.name || '').trim(),
  };
}

async function createTask(args, client: McpClient) {
  const title = cleanText(args.title, 200, 'title').replace(/\s+/g, ' ');
  if (!title) throw new ToolError('title 是必填欄位。');

  const note = cleanText(args.note, 2000, 'note');
  const priority = normalizePriority(args.priority);
  const due = normalizeDue(args.due);
  const externalId = cleanText(args.externalId, 120, 'externalId') || null;
  const project = await resolveProject(args.project);
  const sender = oneLine(client && client.name, 80) || ASSIGNED_BY;

  const task = {
    id: `mcp_${crypto.randomUUID()}`,
    title,
    status: 'todo',
    priority,
    due,
    projectId: project ? project.id : null,
    note: note || `來自 MCP（${sender} 交辦）`,
    createdAt: todayTW(),
    completedAt: null,
    source: 'mcp',
    assignedBy: ASSIGNED_BY,
    sender,
    externalId,
  };

  const appended = await appendTaskOnce(task, externalId);
  if (appended.duplicate) {
    const existing = appended.task || {};
    const text = [
      '這筆任務已經存在，沒有重複新增。',
      `標題：${existing.title || title}`,
      existing.sender ? `交辦人：${existing.sender}` : '',
      `任務 ID：${existing.id || '(未知)'}`,
      existing.due ? `截止：${existing.due}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return toolResult(text, { ok: true, duplicate: true, task: existing });
  }

  const notify = await tgNotify(task);
  const text = [
    '已新增一般任務',
    `標題：${task.title}`,
    `交辦人：${task.sender}`,
    `優先：${PRIORITY_LABEL[task.priority]}`,
    `截止：${task.due || '未定'}`,
    project ? `專案：${project.name || project.id}` : '',
    `任務 ID：${task.id}`,
    notify.ok ? 'Telegram：已通知 Mickey' : `Telegram：未通知（${notify.error}）`,
  ]
    .filter(Boolean)
    .join('\n');

  return toolResult(text, {
    ok: true,
    duplicate: false,
    task,
    telegram: notify,
  });
}

async function listProjects() {
  const payload = await sbGet();
  const projects = (Array.isArray(payload.projects) ? payload.projects : [])
    .filter((p) => p && p.name)
    .map((p) => ({
      id: String(p.id || ''),
      name: String(p.name || ''),
      desc: String(p.desc || ''),
    }));

  if (!projects.length) {
    return toolResult('目前沒有專案。', { ok: true, projects: [] });
  }

  const text = [
    `目前專案（${projects.length}）：`,
    ...projects.map((p) => `• ${p.name}（ID：${p.id}）`),
  ].join('\n');
  return toolResult(text, { ok: true, projects });
}

async function listAssignedTasks(args) {
  const raw = String(args.status == null ? 'open' : args.status).trim().toLowerCase();
  const status =
    raw === 'all' || raw === '全部'
      ? 'all'
      : raw === 'done' || raw === '完成'
        ? 'done'
        : 'open';

  const payload = await sbGet();
  const tasks = (Array.isArray(payload.tasks) ? payload.tasks : [])
    .filter(
      (t) =>
        t &&
        (String(t.source || '') === 'mcp' || String(t.assignedBy || '') === ASSIGNED_BY),
    )
    .filter((t) => {
      if (status === 'all') return true;
      if (status === 'done') return String(t.status || '') === 'done';
      return String(t.status || 'todo') !== 'done';
    })
    .sort((a, b) => {
      const da = String(a.due || '9999-12-31');
      const db = String(b.due || '9999-12-31');
      if (da !== db) return da < db ? -1 : 1;
      const rank = { high: 0, mid: 1, low: 2 };
      return (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3);
    })
    .slice(0, 20);

  const label = status === 'done' ? '已完成' : status === 'all' ? '全部' : '未完成';
  if (!tasks.length) {
    return toolResult(`目前沒有${label}的 MCP 交辦任務。`, {
      ok: true,
      status,
      count: 0,
      tasks: [],
    });
  }

  const text = [
    `MCP 交辦任務（${label}，${tasks.length} 筆）：`,
    ...tasks.map((t) => {
      const due = t.due ? ` — ${t.due}` : '';
      const pr = PRIORITY_LABEL[t.priority] || '中';
      const sender = t.sender ? `｜${t.sender}` : '';
      return `• [${pr}] ${t.title}${due}（${STATUS_LABEL[t.status] || t.status || '待辦'}）${sender}`;
    }),
  ].join('\n');

  return toolResult(text, {
    ok: true,
    status,
    count: tasks.length,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due: t.due || null,
      projectId: t.projectId || null,
      sender: t.sender || t.assignedBy || null,
      createdAt: t.createdAt || null,
    })),
  });
}

function toolResult(text, structured = null, isError = false) {
  const result = {
    content: [{ type: 'text', text: String(text || '') }],
    isError: Boolean(isError),
  };
  if (structured !== null && structured !== undefined) {
    result.structuredContent = structured;
  }
  return result;
}

const TOOLS = [
  {
    name: 'create_task',
    title: '新增一般任務',
    description:
      '在工作儀錶板的一般任務區新增一筆待辦，並發 Telegram 通知 Mickey。只有使用者明確交辦或要求新增任務時才可使用；不要用於 AI 工作區。交辦人由 Bearer token 自動判定。',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '任務標題，必填，最多 200 字。',
        },
        note: {
          type: 'string',
          description: '補充說明或交付內容，最多 2000 字。',
        },
        due: {
          type: 'string',
          description: '到期日，格式 YYYY-MM-DD；不確定可省略。',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        },
        priority: {
          type: 'string',
          enum: ['high', 'mid', 'low', '高', '中', '低'],
          default: 'mid',
          description: '優先級；預設中。',
        },
        project: {
          type: 'string',
          description: '專案名稱或專案 ID；可先用 list_projects 查詢。',
        },
        externalId: {
          type: 'string',
          description:
            '去識別碼。若你的工具可能重試，請帶相同的值，伺服器會避免重複新增。',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'list_projects',
    title: '查詢專案',
    description: '列出工作儀錶板目前的專案名稱與 ID，讓 create_task 可以指定專案。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'list_assigned_tasks',
    title: '查詢 MCP 交辦任務',
    description:
      '只列出由 MCP 交辦的一般任務與狀態，包含交辦人；不會回傳其他私人任務。',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'done', 'all', '未完成', '完成', '全部'],
          default: 'open',
          description: 'open＝未完成、done＝已完成、all＝全部；預設 open。',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

const TOOL_NAMES = TOOLS.map((tool) => tool.name);

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error };
}

async function callTool(name, args, client: McpClient) {
  if (name === 'create_task') return await createTask(args || {}, client);
  if (name === 'list_projects') return await listProjects();
  if (name === 'list_assigned_tasks') return await listAssignedTasks(args || {});
  throw new ToolError(`未知工具：${name}`);
}

async function handleRpc(message, client: McpClient) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message && message.id, -32600, 'Invalid Request');
  }

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (method.startsWith('notifications/')) return null;

  if (method === 'initialize') {
    const requested = params && typeof params.protocolVersion === 'string'
      ? params.protocolVersion
      : '';
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested)
      ? requested
      : '2025-06-18';
    return rpcResult(id, {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: SERVER_NAME,
        title: SERVER_TITLE,
        version: SERVER_VERSION,
      },
      instructions:
        '這是 Mickey 的工作儀錶板任務入口。只有使用者明確交辦或要求新增任務時，才呼叫 create_task。任務一律進一般任務區，不要寫入 AI 工作區。需要專案時先呼叫 list_projects。建立後回報任務 ID 與截止日。交辦人由 Bearer token 自動判定，不需要在參數中填寫。',
    });
  }

  if (method === 'ping') return rpcResult(id, {});

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = params && params.name;
    if (typeof toolName !== 'string' || !toolName) {
      return rpcError(id, -32602, 'Invalid params: tools/call 需要 name');
    }
    if (!TOOL_NAMES.includes(toolName)) {
      return rpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    try {
      const args = params.arguments && typeof params.arguments === 'object'
        ? params.arguments
        : {};
      const result = await callTool(toolName, args, client);
      return rpcResult(id, result);
    } catch (err) {
      if (err instanceof ToolError) {
        return rpcResult(id, toolResult(err.message, null, true));
      }
      console.error('mcp-task tool error', toolName, err);
      return rpcResult(
        id,
        toolResult(`工具執行失敗：${oneLine(err.message || String(err), 240)}`, null, true),
      );
    }
  }

  if (method === 'resources/list') return rpcResult(id, { resources: [] });
  if (method === 'resources/templates/list') {
    return rpcResult(id, { resourceTemplates: [] });
  }
  if (method === 'prompts/list') return rpcResult(id, { prompts: [] });

  if (isNotification) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = ALLOWED_ORIGIN
    ? origin === ALLOWED_ORIGIN
      ? origin
      : ''
    : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status, req, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: {
        ...headers,
        Allow: 'POST, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }

  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGIN && origin !== ALLOWED_ORIGIN) {
    return jsonResponse(
      rpcError(null, -32003, 'Origin not allowed'),
      403,
      req,
    );
  }

  let client: McpClient | null = null;
  try {
    client = await authenticate(req);
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      console.error('mcp-task auth unavailable', err.message);
      return jsonResponse(rpcError(null, -32603, err.message), 503, req);
    }
    console.error('mcp-task auth error', err);
    return jsonResponse(rpcError(null, -32603, 'Internal error'), 500, req);
  }
  if (!client) {
    return jsonResponse(rpcError(null, -32001, 'Unauthorized'), 401, req);
  }

  let message;
  try {
    message = await req.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'), 400, req);
  }

  if (Array.isArray(message)) {
    return jsonResponse(
      rpcError(null, -32600, 'Batch requests are not supported'),
      400,
      req,
    );
  }

  try {
    const response = await handleRpc(message, client);
    if (response === null) {
      return new Response(null, { status: 202, headers });
    }
    return jsonResponse(response, 200, req);
  } catch (err) {
    console.error('mcp-task unhandled error', err);
    return jsonResponse(
      rpcError(message && message.id, -32603, 'Internal error'),
      500,
      req,
    );
  }
});
