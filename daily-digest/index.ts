// Supabase Edge Function: daily-digest
// 由 Supabase Cron 每天 08:00（Asia/Taipei）呼叫，讀取 dashboards 後發送
// Telegram 待辦摘要。不再依賴本機 Windows 工作排程器。
//
// 部署：Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor
//      名稱：daily-digest
//      JWT verification：關閉（改用 x-digest-secret 驗證）
// Secrets（多數可沿用 telegram-task 的設定）：
//   BOT_TOKEN               Telegram Bot token
//   ALLOWED_CHAT_ID         接收摘要的 chat id
//   DASH_ID                 看板文件金鑰
//   DIGEST_CRON_SECRET      本函式專用觸發密鑰（必要）
//   DASH_URL / DASH_KEY     選用；通常自動使用 SUPABASE_URL /
//                           SUPABASE_SERVICE_ROLE_KEY
//   DIGEST_MAX_ITEMS        選用，每區最多幾筆（預設 8）
//   DIGEST_MAX_CHARS        選用，訊息字數上限（預設 3900）
//
// 先執行同資料夾的 setup.sql 建立 digest_runs 與 Cron 所需的 Vault secret。
// 這個函式只讀取 dashboards，不會修改看板資料。

const TZ = 'Asia/Taipei';
const PRIORITY_LABEL = { high: '高', mid: '中', low: '低' };
const PRIORITY_RANK = { high: 0, mid: 1, low: 2 };

function getEnv(key) {
  if (typeof Deno !== 'undefined' && Deno.env) {
    return (Deno.env.get(key) || '').trim();
  }
  if (typeof process !== 'undefined' && process.env) {
    return (process.env[key] || '').trim();
  }
  return '';
}

function clampInt(raw, fallback, min, max) {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

const BOT_TOKEN = getEnv('BOT_TOKEN');
const ALLOWED_CHAT_ID = getEnv('ALLOWED_CHAT_ID');
const DASH_ID = getEnv('DASH_ID');
const DASH_URL = (getEnv('DASH_URL') || getEnv('SUPABASE_URL') || '')
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '')
  .replace(/\/+$/, '');
const DASH_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY') || getEnv('DASH_KEY');
const CRON_SECRET = getEnv('DIGEST_CRON_SECRET');
const MAX_ITEMS = clampInt(getEnv('DIGEST_MAX_ITEMS'), 8, 1, 20);
const MAX_CHARS = clampInt(getEnv('DIGEST_MAX_CHARS'), 3900, 500, 4096);

/* ================= 日期工具（全部用 UTC 運算，避免伺服器時區影響） ================= */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(value, n) {
  const d = parseDate(value);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

function dayDiff(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function fmtMD(value) {
  const d = parseDate(value);
  return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '';
}

function wdName(value) {
  const d = parseDate(value);
  return d ? ['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()] : '';
}

/** 取得台灣時間的今天（YYYY-MM-DD）。 */
function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => (parts.find((part) => part.type === type) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/* ================= 摘要內容（與 ai-worker/digest.mjs 相同規則） ================= */

function priorityLabel(p) {
  return PRIORITY_LABEL[p] || '中';
}

function priorityRank(p) {
  return PRIORITY_RANK[p] ?? 3;
}

function dueText(due, today) {
  if (!due) return '未定';
  if (due === today) return '今天';
  if (due === addDays(today, 1)) return '明天';
  if (due < today) {
    const n = dayDiff(due, today);
    return `逾期 ${n} 天（${fmtMD(due)}）`;
  }
  return fmtMD(due);
}

function projectName(projects, id) {
  if (!id) return '';
  const project = projects.find((item) => item && item.id === id);
  return project && project.name ? String(project.name) : '';
}

function sortGeneral(a, b) {
  const da = a.due || '9999-12-31';
  const db = b.due || '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  const pa = priorityRank(a.priority);
  const pb = priorityRank(b.priority);
  if (pa !== pb) return pa - pb;
  return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
}

function oneLine(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function buildDigest(payload, dateStr) {
  const today = dateStr || taipeiToday();
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const aiTasks = Array.isArray(payload.aiTasks) ? payload.aiTasks : [];
  const projects = Array.isArray(payload.projects) ? payload.projects : [];

  const open = tasks.filter(
    (task) => task && task.title && String(task.status || 'todo') !== 'done',
  );
  const overdue = open
    .filter((task) => task.due && task.due < today)
    .sort(sortGeneral);
  const dueToday = open
    .filter((task) => task.due === today)
    .sort(sortGeneral);
  const other = open
    .filter((task) => !task.due || task.due > today)
    .sort(sortGeneral);

  const aiTodo = aiTasks
    .filter((task) => task && task.title && task.status === 'todo')
    .sort(sortGeneral);
  const aiDoing = aiTasks
    .filter((task) => task && task.title && task.status === 'doing')
    .sort(sortGeneral);
  const aiWaiting = aiTasks
    .filter((task) => task && task.title && task.status === 'waiting')
    .sort(sortGeneral);

  const aiToday = aiTodo.filter((task) => !task.due || task.due <= today);
  const aiLater = aiTodo.filter((task) => task.due && task.due > today);

  const lines = [];
  lines.push(`☀️ 早安，${fmtMD(today)}（週${wdName(today)}）`);
  lines.push('');

  const generalSummary = [];
  if (overdue.length) generalSummary.push(`逾期 ${overdue.length}`);
  if (dueToday.length) generalSummary.push(`今天 ${dueToday.length}`);
  if (other.length) generalSummary.push(`其他 ${other.length}`);
  lines.push(
    generalSummary.length
      ? `📋 一般任務：${generalSummary.join('｜')}`
      : '📋 一般任務：沒有未完成項目 🎉',
  );

  const aiSummary = [];
  if (aiTodo.length) aiSummary.push(`待辦 ${aiTodo.length}`);
  if (aiDoing.length) aiSummary.push(`進行中 ${aiDoing.length}`);
  if (aiWaiting.length) aiSummary.push(`等待確認 ${aiWaiting.length}`);
  lines.push(
    aiSummary.length
      ? `🤖 AI 工作區：${aiSummary.join('｜')}`
      : `🤖 AI 工作區：${aiTasks.length ? '目前沒有待辦' : '目前沒有任務'}`,
  );

  const pushSection = (title, items, formatter) => {
    if (!items.length) return;
    lines.push('', title);
    items.slice(0, MAX_ITEMS).forEach((item) => lines.push(formatter(item)));
    if (items.length > MAX_ITEMS) {
      lines.push(`…還有 ${items.length - MAX_ITEMS} 筆`);
    }
  };

  const generalLine = (task) => {
    const project = projectName(projects, task.projectId);
    const status = task.status === 'doing' ? '（進行中）' : '';
    const projectText = project ? `（${project}）` : '';
    return `• [${priorityLabel(task.priority)}] ${task.title}${status}${projectText} — ${dueText(task.due, today)}`;
  };

  pushSection(`⏰ 逾期未完成（${overdue.length}）`, overdue, generalLine);
  pushSection(`🎯 今天到期（${dueToday.length}）`, dueToday, generalLine);

  if (other.length) {
    lines.push('', `📌 其他未完成（${other.length}）`);
    other.slice(0, Math.min(MAX_ITEMS, 5)).forEach((task) => {
      const project = projectName(projects, task.projectId);
      const projectText = project ? `（${project}）` : '';
      lines.push(
        `• [${priorityLabel(task.priority)}] ${task.title}${projectText} — ${dueText(task.due, today)}`,
      );
    });
    if (other.length > Math.min(MAX_ITEMS, 5)) {
      lines.push(`…還有 ${other.length - Math.min(MAX_ITEMS, 5)} 筆未列出`);
    }
  }

  if (aiToday.length) {
    lines.push('', `🤖 AI 今天要跑（${aiToday.length}）`);
    aiToday.slice(0, MAX_ITEMS).forEach((task) => {
      lines.push(
        `• [${priorityLabel(task.priority)}] ${task.title} — ${dueText(task.due, today)}` +
          (Number(task.progress) > 0 ? `（${task.progress}%）` : ''),
      );
    });
    if (aiToday.length > MAX_ITEMS) lines.push(`…還有 ${aiToday.length - MAX_ITEMS} 筆`);
  }

  if (aiLater.length) {
    lines.push('', `🗓️ AI 之後排程（${aiLater.length}）`);
    aiLater.slice(0, Math.min(MAX_ITEMS, 5)).forEach((task) => {
      lines.push(
        `• [${priorityLabel(task.priority)}] ${task.title} — ${dueText(task.due, today)}`,
      );
    });
    if (aiLater.length > Math.min(MAX_ITEMS, 5)) {
      lines.push(`…還有 ${aiLater.length - Math.min(MAX_ITEMS, 5)} 筆`);
    }
  }

  if (aiDoing.length) {
    lines.push('', `⚙️ AI 進行中（${aiDoing.length}）`);
    aiDoing.slice(0, MAX_ITEMS).forEach((task) => {
      lines.push(
        `• ${task.title} — ${Number(task.progress) || 0}%` +
          (task.waitingFor ? `（${oneLine(task.waitingFor, 40)}）` : ''),
      );
    });
    if (aiDoing.length > MAX_ITEMS) lines.push(`…還有 ${aiDoing.length - MAX_ITEMS} 筆`);
  }

  if (aiWaiting.length) {
    lines.push('', `⏳ 等你確認（${aiWaiting.length}）`);
    aiWaiting.slice(0, MAX_ITEMS).forEach((task) => {
      const reason = task.waitingFor ? ` — ${oneLine(task.waitingFor, 50)}` : '';
      lines.push(`• [${priorityLabel(task.priority)}] ${task.title}${reason}`);
    });
    if (aiWaiting.length > MAX_ITEMS) lines.push(`…還有 ${aiWaiting.length - MAX_ITEMS} 筆`);
  }

  if (!open.length && !aiTasks.length) {
    lines.push('', '今天沒有待辦，享受一下空檔 ☕');
  }

  lines.push('', '—— AI Worker 每日摘要');

  let text = lines.join('\n');
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS - 20).replace(/\n[^\n]*$/, '') + '\n…（已截斷）';
  }
  return text;
}

/* ================= Supabase ================= */

function mask(value) {
  if (!value) return '(未設定)';
  if (value.length <= 10) return value.slice(0, 2) + '…';
  return value.slice(0, 4) + '…' + value.slice(-4);
}

function tail(value, max = 300) {
  const text = String(value || '').trim();
  return text.length > max ? '…' + text.slice(-max) : text;
}

function sbHeaders(extra) {
  const headers = {
    apikey: DASH_KEY,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
  // 舊版 service_role 是 JWT（eyJ…），新版是 sb_secret_…；兩者都放進
  // Authorization，PostgREST 才會以 service_role 執行並繞過 RLS。
  if (DASH_KEY.startsWith('eyJ') || DASH_KEY.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${DASH_KEY}`;
  }
  return headers;
}

async function sbGet() {
  const url =
    `${DASH_URL}/rest/v1/dashboards?id=eq.${encodeURIComponent(DASH_ID)}` +
    '&select=payload,updated_at&limit=1';
  const res = await fetch(url, {
    headers: sbHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase 讀取失敗 (${res.status})：${tail(text)}`);
  }
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error('Supabase 回應不是 JSON，請確認 DASH_URL 是否正確');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `找不到文件「${mask(DASH_ID)}」。請確認 DASH_ID 與看板文件金鑰相同。`,
    );
  }
  return { payload: rows[0].payload || {}, updatedAt: rows[0].updated_at || null };
}

async function getDigestRun(date) {
  const url =
    `${DASH_URL}/rest/v1/digest_runs?digest_date=eq.${encodeURIComponent(date)}` +
    '&select=digest_date,sent_at&limit=1';
  const res = await fetch(url, {
    headers: sbHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `讀取 digest_runs 失敗 (${res.status})：${tail(text)}。請先執行 setup.sql。`,
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function saveDigestRun(date, chars, updatedAt) {
  const url = `${DASH_URL}/rest/v1/digest_runs?on_conflict=digest_date`;
  const res = await fetch(url, {
    method: 'POST',
    headers: sbHeaders({
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify({
      digest_date: date,
      sent_at: new Date().toISOString(),
      chars,
      chat_id: ALLOWED_CHAT_ID,
      dashboard_updated_at: updatedAt || null,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`寫入 digest_runs 失敗 (${res.status})：${tail(text)}`);
  }
}

/* ================= Telegram ================= */

async function tgSend(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: ALLOWED_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* 下面統一處理 */
  }
  if (!res.ok || !data || data.ok !== true) {
    const description = data && data.description ? data.description : tail(raw);
    throw new Error(`Telegram sendMessage 失敗 (${res.status})：${description}`);
  }
  return data.result;
}

/* ================= HTTP ================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function handler(req) {
  if (req.method === 'GET') {
    return json({ ok: true, service: 'daily-digest' });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  if (!CRON_SECRET) {
    return json(
      { ok: false, error: 'DIGEST_CRON_SECRET 尚未設定' },
      500,
    );
  }
  const provided =
    req.headers.get('x-digest-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(provided, CRON_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!BOT_TOKEN || !ALLOWED_CHAT_ID || !DASH_ID || !DASH_URL || !DASH_KEY) {
    return json(
      {
        ok: false,
        error:
          '缺少 secrets：需要 BOT_TOKEN、ALLOWED_CHAT_ID、DASH_ID，以及 service_role（SUPABASE_SERVICE_ROLE_KEY 或 DASH_KEY）',
      },
      500,
    );
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    /* 空 body 視為一般排程觸發 */
  }

  const preview = body && body.preview === true;
  const force = body && body.force === true;
  const date =
    preview &&
    typeof body.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : taipeiToday();

  try {
    if (!preview) {
      const existing = await getDigestRun(date);
      if (existing && existing.sent_at && !force) {
        return json({
          ok: true,
          skipped: true,
          reason: 'already sent',
          date,
          sentAt: existing.sent_at,
        });
      }
    }

    const { payload, updatedAt } = await sbGet();
    const text = buildDigest(payload, date);

    if (preview) {
      return json({
        ok: true,
        preview: true,
        date,
        chars: text.length,
        text,
      });
    }

    await tgSend(text);
    await saveDigestRun(date, text.length, updatedAt);
    return json({ ok: true, sent: true, date, chars: text.length });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error && error.message ? error.message : String(error),
      },
      500,
    );
  }
}

// Deno 會在這裡啟動 HTTP server；Node 測試匯入時不會執行。
if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler);
}

export { buildDigest, handler };
