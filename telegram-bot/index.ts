// Supabase Edge Function: telegram-task
// 接收 Telegram webhook，把訊息新增成儀錶板任務（寫入 Supabase dashboards）
//
// 部署：Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor
//      名稱請用 telegram-task，貼上本檔內容後按 Deploy
// Secrets：BOT_TOKEN / WEBHOOK_SECRET / DASH_URL / DASH_KEY / DASH_ID / ALLOWED_CHAT_ID
// 詳細步驟見同資料夾 README.md

// ===== PARSER START =====
var TZ_OFFSET = 8 * 60 * 60 * 1000; // Asia/Taipei (UTC+8)
var WD_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
var PRI_LABEL = { high: '高', mid: '中', low: '低' };

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}
function twDate(ts) {
  return new Date((ts || Date.now()) + TZ_OFFSET);
}
function ymd(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function todayTW() {
  return ymd(twDate());
}
function fmtDate(s) {
  var p = String(s).split('-').map(Number);
  var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return p[0] + '/' + pad2(p[1]) + '/' + pad2(p[2]) + '（週' + WD_NAMES[dt.getUTCDay()] + '）';
}
function validYmd(y, m, d) {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  var dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return ymd(dt);
}
function parseDateToken(raw) {
  var t = String(raw || '').trim();
  if (!t) return null;
  var now = twDate();
  var base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (t === '今天' || t === '今日') return ymd(base);
  if (t === '明天' || t === '明日') { base.setUTCDate(base.getUTCDate() + 1); return ymd(base); }
  if (t === '後天') { base.setUTCDate(base.getUTCDate() + 2); return ymd(base); }
  if (t === '大後天') { base.setUTCDate(base.getUTCDate() + 3); return ymd(base); }

  var m = t.match(/^(下)?(?:週|周|星期|禮拜)([日天一二三四五六])$/);
  if (m) {
    var idx = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }[m[2]];
    if (idx === undefined) return null;
    if (!m[1]) {
      var delta = (idx - base.getUTCDay() + 7) % 7;
      base.setUTCDate(base.getUTCDate() + delta);
      return ymd(base);
    }
    var mon = new Date(base);
    mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7) + 7);
    mon.setUTCDate(mon.getUTCDate() + ((idx + 6) % 7));
    return ymd(mon);
  }

  m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{4})年(\d{1,2})月(\d{1,2})[日號]?$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})月(\d{1,2})[日號]?$/);
  if (m) return validYmd(now.getUTCFullYear(), +m[1], +m[2]);
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return validYmd(now.getUTCFullYear(), +m[1], +m[2]);
  return null;
}
function parsePriority(tok) {
  var t = String(tok || '').replace(/^[#!]/, '').trim().toLowerCase();
  if (t === '高' || t === 'high') return 'high';
  if (t === '中' || t === 'mid') return 'mid';
  if (t === '低' || t === 'low') return 'low';
  return null;
}
function parseTaskInput(input) {
  var text = String(input || '').trim();
  text = text.replace(/^(\/add|\/task)(\s+|$)/i, '');
  var toks = text.split(/\s+/).filter(function (x) { return !!x; });
  var due = '';
  var priority = 'mid';
  var prioSet = false;
  var titleParts = [];

  for (var i = 0; i < toks.length; i++) {
    var tok = toks[i];
    if (!due) {
      var d = parseDateToken(tok);
      if (d) { due = d; continue; }
    }
    var p = parsePriority(tok);
    var explicit = /^[#!]/.test(tok);
    // 沒有 # 的「高/低/中」只有在任務名稱後面才視為優先級，避免吃掉標題
    if (p && !prioSet && (explicit || titleParts.length > 0)) {
      priority = p;
      prioSet = true;
      continue;
    }
    titleParts.push(tok);
  }

  // 沒有空白的情況：「買牛奶明天」
  if (!due && titleParts.length === 1) {
    var m = titleParts[0].match(/^(.*?)(今天|今日|明天|明日|後天|大後天)$/);
    if (m && m[1]) {
      titleParts[0] = m[1];
      due = parseDateToken(m[2]) || '';
    }
  }

  return { title: titleParts.join(' ').trim(), due: due || todayTW(), priority: priority };
}
// ===== PARSER END =====

var BOT_TOKEN = (Deno.env.get('BOT_TOKEN') || '').trim();
var WEBHOOK_SECRET = (Deno.env.get('WEBHOOK_SECRET') || '').trim();
var DASH_URL = (Deno.env.get('DASH_URL') || '').trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '')
  .replace(/\/+$/, '');
var DASH_KEY = (Deno.env.get('DASH_KEY') || '').trim();
var DASH_ID = (Deno.env.get('DASH_ID') || '').trim();
var ALLOWED = (Deno.env.get('ALLOWED_CHAT_ID') || '').trim();

var HELP_TEXT = [
  '🐟 工作儀錶板 Bot',
  '',
  '直接傳訊息就能新增任務：',
  '・買牛奶',
  '・買牛奶 明天',
  '・寫週報 週五 #高',
  '・回診 10/25',
  '',
  '日期：今天／明天／後天、週一～週日、10/25、10月25日',
  '優先：加上 #高 #中 #低',
  '',
  '指令：',
  '/today 今天待辦',
  '/id 取得你的 chat id',
  '/help 說明',
  '',
  '目前只支援任務，會議／行程之後推出。'
].join('\n');

function errText(e) {
  var s = (e && e.message) ? e.message : String(e);
  return s.replace(/\s+/g, ' ').slice(0, 120);
}
function tgSend(chatId, text) {
  if (!BOT_TOKEN) return Promise.resolve();
  return fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, disable_web_page_preview: true })
  }).catch(function () {});
}
function sbHeaders() {
  var h = { 'apikey': DASH_KEY, 'Content-Type': 'application/json' };
  if (DASH_KEY.indexOf('eyJ') === 0) h['Authorization'] = 'Bearer ' + DASH_KEY;
  return h;
}
function sbGet(query) {
  return fetch(DASH_URL + '/rest/v1/' + query, { headers: sbHeaders() }).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (t) {
        throw new Error('Supabase ' + r.status + '：' + t.slice(0, 160));
      });
    }
    return r.json();
  });
}
function rowQuery(select) {
  return 'dashboards?id=eq.' + encodeURIComponent(DASH_ID) + '&select=' + select + '&limit=1';
}
function appendTask(task) {
  return fetch(DASH_URL + '/rest/v1/rpc/append_task', {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({ p_id: DASH_ID, p_task: task })
  }).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (t) {
        throw new Error('RPC ' + r.status + '：' + t.slice(0, 160));
      });
    }
    return r.json().catch(function () { return null; });
  });
}
function buildAddedText(task) {
  return [
    '✅ 已新增任務',
    '',
    task.title,
    '📅 ' + fmtDate(task.due) + '・優先：' + (PRI_LABEL[task.priority] || '中'),
    '',
    '儀錶板最慢 30 秒內會自動出現（需開啟「自動接收雲端變更」）。'
  ].join('\n');
}
function buildTodayText() {
  return sbGet(rowQuery('payload')).then(function (rows) {
    if (!rows.length) return '找不到雲端資料列，請確認 DASH_ID（文件金鑰）。';
    var tasks = (rows[0].payload && Array.isArray(rows[0].payload.tasks)) ? rows[0].payload.tasks : [];
    var t0 = todayTW();
    var todo = tasks.filter(function (x) { return x && x.status !== 'done' && x.due === t0; });
    var overdue = tasks.filter(function (x) { return x && x.status !== 'done' && x.due && x.due < t0; });
    var lines = ['📋 今天 ' + fmtDate(t0)];
    if (!todo.length) {
      lines.push('今天沒有到期任務 🎉');
    } else {
      todo.slice(0, 15).forEach(function (x, i) {
        lines.push((i + 1) + '. ' + x.title + (x.status === 'doing' ? '（進行中）' : ''));
      });
      if (todo.length > 15) lines.push('…還有 ' + (todo.length - 15) + ' 筆');
      lines.push('共 ' + todo.length + ' 筆');
    }
    if (overdue.length) {
      lines.push('', '⏰ 逾期 ' + overdue.length + ' 筆');
      overdue.slice(0, 10).forEach(function (x) {
        lines.push('・' + x.title + '（' + String(x.due).slice(5).replace('-', '/') + '）');
      });
      if (overdue.length > 10) lines.push('…還有 ' + (overdue.length - 10) + ' 筆');
    }
    return lines.join('\n');
  });
}
function parseMsg(text) {
  var t = String(text || '').trim();
  if (t.charAt(0) === '/') {
    var m = t.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
    if (m) return { cmd: m[1].toLowerCase(), rest: (m[2] || '').trim() };
  }
  return { cmd: '', rest: t };
}

Deno.serve(async function (req) {
  if (req.method === 'GET') return new Response('telegram-task ok', { status: 200 });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  var secret = req.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!BOT_TOKEN || !DASH_URL || !DASH_KEY || !DASH_ID) {
    return new Response('missing secrets', { status: 500 });
  }

  var update;
  try {
    update = await req.json();
  } catch (e) {
    return new Response('bad json', { status: 400 });
  }

  var msg = update && update.message;
  if (!msg || !msg.chat || typeof msg.text !== 'string') return new Response('ok', { status: 200 });
  if (msg.from && msg.from.is_bot) return new Response('ok', { status: 200 });

  var chatId = msg.chat.id;
  var chatKey = String(chatId);
  var text = msg.text.trim();

  // /id 永遠可用，方便第一次設定授權
  if (/^\/id(@\w+)?$/i.test(text)) {
    var stateText = ALLOWED
      ? '授權狀態：已設定'
      : '授權狀態：尚未設定\n把上面的號碼填到 Supabase secret ALLOWED_CHAT_ID';
    await tgSend(chatId, '你的 chat id：' + chatKey + '\n' + stateText);
    return new Response('ok', { status: 200 });
  }

  if (!ALLOWED || ALLOWED !== chatKey) {
    await tgSend(chatId, ALLOWED
      ? '⛔ 未授權使用這個 bot。'
      : '⛔ 尚未設定授權。\n你的 chat id：' + chatKey + '\n請把這個號碼填到 Supabase secret ALLOWED_CHAT_ID（存檔後再試）。');
    return new Response('ok', { status: 200 });
  }

  var parsed = parseMsg(text);
  var cmd = parsed.cmd;

  if (cmd === 'start' || cmd === 'help' || (!cmd && /^(help|說明|指令)$/i.test(text))) {
    await tgSend(chatId, HELP_TEXT);
    return new Response('ok', { status: 200 });
  }

  if (cmd === 'today') {
    try {
      await tgSend(chatId, await buildTodayText());
    } catch (e) {
      await tgSend(chatId, '⚠️ 讀取失敗：' + errText(e));
    }
    return new Response('ok', { status: 200 });
  }

  if (cmd && cmd !== 'add' && cmd !== 'task') {
    await tgSend(chatId, '目前支援：直接傳任務內容、/add、/today、/help、/id');
    return new Response('ok', { status: 200 });
  }

  var input = cmd ? parsed.rest : text;
  var t = parseTaskInput(input);
  if (!t.title) {
    await tgSend(chatId, '請輸入任務名稱，例如：\n買牛奶 明天');
    return new Response('ok', { status: 200 });
  }

  try {
    var rows = await sbGet(rowQuery('payload'));
    if (!rows.length) {
      await tgSend(chatId, '找不到雲端資料列，請確認 DASH_ID（文件金鑰）是否正確。');
      return new Response('ok', { status: 200 });
    }
    var tasks = (rows[0].payload && Array.isArray(rows[0].payload.tasks)) ? rows[0].payload.tasks : [];
    var tgMsgId = chatKey + ':' + msg.message_id;
    var dup = tasks.some(function (x) { return x && x.tgMsgId === tgMsgId; });
    if (dup) {
      await tgSend(chatId, 'ℹ️ 這則訊息已經處理過了。');
      return new Response('ok', { status: 200 });
    }

    var task = {
      id: crypto.randomUUID(),
      title: t.title,
      status: 'todo',
      priority: t.priority,
      due: t.due,
      projectId: null,
      note: '來自 Telegram',
      createdAt: todayTW(),
      completedAt: null,
      tgMsgId: tgMsgId
    };
    await appendTask(task);
    await tgSend(chatId, buildAddedText(task));
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('telegram-task error', e);
    await tgSend(chatId, '⚠️ 寫入失敗，請稍後再試（' + errText(e) + '）');
    return new Response('error', { status: 500 });
  }
});
