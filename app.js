/* ============================================================
   工作儀錶板 v1.7 — 核心邏輯
   純前端、無依賴；資料存於 localStorage
   ============================================================ */
(function(){
'use strict';

/* ================= 工具 ================= */
function $(s, c){ return (c || document).querySelector(s); }
function $$(s, c){ return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(m){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
  });
}
function pad(n){ return (n < 10 ? '0' : '') + n; }
function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today(){ return ymd(new Date()); }
function parseD(s){ var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays(s, n){ var d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); }
function dayDiff(a, b){ return Math.round((parseD(b) - parseD(a)) / 86400000); }
function eventEnd(ev){ return (ev && ev.endDate && ev.endDate >= ev.date) ? ev.endDate : (ev ? ev.date : ''); }
function eventDays(ev){ return (ev && ev.date) ? Math.max(1, dayDiff(ev.date, eventEnd(ev)) + 1) : 1; }
function eventRangeLabel(ev){
  if(!ev || !ev.date) return '';
  var end = eventEnd(ev);
  if(end && end !== ev.date) return fmtMD(ev.date) + '–' + fmtMD(end) + '・' + eventDays(ev) + ' 天';
  return fmtMD(ev.date);
}
function eachDateRange(start, end, fn){
  if(!start) return;
  var last = (end && end >= start) ? end : start;
  var d = parseD(start);
  var e = parseD(last);
  var guard = 0;
  while(d <= e && guard < 3700){
    fn(ymd(d));
    d.setDate(d.getDate() + 1);
    guard++;
  }
}
function startOfWeek(s){ var d = parseD(s); var wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return ymd(d); }
function fmtMD(s){ var d = parseD(s); return (d.getMonth() + 1) + '/' + d.getDate(); }
function wdName(s){ return ['日','一','二','三','四','五','六'][parseD(s).getDay()]; }
function dueLabel(s){
  if(!s) return '';
  var t = today();
  if(s === t) return '今天';
  if(s === addDays(t, 1)) return '明天';
  if(s === addDays(t, -1)) return '昨天';
  return fmtMD(s);
}
function isOverdue(t){ return t.due && t.status !== 'done' && t.due < today(); }

/* ================= 常數 ================= */
var ST = { todo:'待辦', doing:'進行中', done:'完成' };
var AI_ST = { todo:'AI 待辦', doing:'處理中', waiting:'等待確認', done:'完成' };
var AI_STATUSES = ['todo','doing','waiting','done'];
var PRI = { high:'高', mid:'中', low:'低' };
var PRI_RANK = { high:0, mid:1, low:2 };
var TITLES = { overview:'總覽', tasks:'任務', projects:'專案', meetings:'日曆', docs:'文件', stats:'統計', fun:'摸魚區', settings:'設定' };
var LS_KEY = 'wd-v1-state';
var LS_SYNC = 'wd-sync';

/* ================= 狀態 ================= */
var state = loadState();
function loadState(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if(raw){
      var obj = JSON.parse(raw);
      if(obj && obj.tasks) return normalize(obj);
    }
  }catch(e){}
  var s = seed();
  try{ localStorage.setItem(LS_KEY, JSON.stringify(s)); }catch(e){}
  return s;
}
function normalize(obj){
  var o = {
    version: 1,
    modifiedAt: obj.modifiedAt || null,
    tasks: obj.tasks || [],
    projects: obj.projects || [],
    meetings: obj.meetings || [],
    events: obj.events || [],
    docs: obj.docs || [],
    hours: obj.hours || [],
    links: obj.links || [],
    aiTasks: Array.isArray(obj.aiTasks) ? obj.aiTasks : []
  };
  o.tasks.forEach(function(t){
    if(!t.status) t.status = 'todo';
    if(!t.priority) t.priority = 'mid';
    if(t.due === undefined) t.due = null;
    if(t.projectId === undefined) t.projectId = null;
    if(t.note == null) t.note = '';
  });
  o.projects.forEach(function(p){
    if(!Array.isArray(p.milestones)) p.milestones = [];
    p.milestones.forEach(function(m){ if(m.doneAt === undefined) m.doneAt = null; });
  });
  o.meetings.forEach(function(m){
    if(!Array.isArray(m.actionItems)) m.actionItems = [];
    m.actionItems.forEach(function(a){
      if(a.doneAt === undefined) a.doneAt = null;
      if(a.convertedTaskId === undefined) a.convertedTaskId = null;
    });
  });
  o.events.forEach(function(ev){
    if(ev.title == null) ev.title = '';
    if(ev.date == null) ev.date = '';
    if(ev.endDate == null) ev.endDate = '';
    if(ev.endDate && ev.date && ev.endDate < ev.date) ev.endDate = '';
    if(ev.time == null) ev.time = '';
    if(ev.location == null) ev.location = '';
    if(ev.note == null) ev.note = '';
  });
  o.docs.forEach(function(d){ if(!Array.isArray(d.tags)) d.tags = []; });
  o.links.forEach(function(l){
    if(l.title == null) l.title = '';
    if(l.url == null) l.url = '';
    if(l.note == null) l.note = '';
  });
  o.aiTasks = o.aiTasks.map(normalizeAITask);
  return o;
}
function saveState(){
  state.modifiedAt = Date.now();
  try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){ toast('儲存失敗：瀏覽器儲存空間不足'); }
  scheduleAutoPush();
}
function commit(){ saveState(); render(); }

/* 示範資料（日期相對今天，隨時載入都合理） */
function seed(){
  var t = today();
  var p1 = uid(), p2 = uid();
  var aiStamp = new Date().toISOString();
  return {
    version: 1,
    modifiedAt: Date.now(),
    projects: [
      { id: p1, name: '青廣招生計畫', desc: '年度招生：簡章、表單、宣傳、面談', createdAt: t,
        milestones: [
          { title:'簡章定稿', done:true, doneAt: addDays(t, -9) }, { title:'報名表單上線', done:true, doneAt: addDays(t, -2) },
          { title:'宣傳開跑', done:false }, { title:'面談', done:false }, { title:'公告錄取', done:false }
        ] },
      { id: p2, name: '官網改版', desc: '品牌更新、首頁重設計', createdAt: t,
        milestones: [
          { title:'Wireframe', done:true, doneAt: addDays(t, -7) }, { title:'視覺設計', done:false },
          { title:'前端開發', done:false }, { title:'內容搬遷', done:false }, { title:'上線', done:false }
        ] }
    ],
    tasks: [
      { id: uid(), title:'青廣招生簡章校稿回覆印刷廠', status:'doing', priority:'high', due: addDays(t, 4), projectId: p1, note:'', createdAt:t, completedAt:null },
      { id: uid(), title:'新版官網首頁 wireframe', status:'doing', priority:'high', due: t, projectId: p2, note:'', createdAt:t, completedAt:null },
      { id: uid(), title:'招生表單自動回覆信文案', status:'doing', priority:'mid', due: addDays(t, 2), projectId: p1, note:'', createdAt:t, completedAt:null },
      { id: uid(), title:'整理卓青會議逐字稿行動項', status:'todo', priority:'mid', due: t, projectId: null, note:'逐字稿已產生，待轉成任務', createdAt:t, completedAt:null },
      { id: uid(), title:'回覆信件退信名單清理結果', status:'todo', priority:'low', due: addDays(t, 1), projectId: null, note:'', createdAt:t, completedAt:null },
      { id: uid(), title:'志工培訓簡報 v2 大綱', status:'todo', priority:'mid', due: addDays(t, 3), projectId: null, note:'', createdAt:t, completedAt:null },
      { id: uid(), title:'卓青名單彙整', status:'done', priority:'mid', due: addDays(t, -3), projectId: p1, note:'', createdAt:t, completedAt: addDays(t, -1) },
      { id: uid(), title:'會議紀錄歸檔', status:'done', priority:'low', due: addDays(t, -4), projectId: null, note:'', createdAt:t, completedAt: addDays(t, -2) }
    ],
    meetings: [
      { id: uid(), title:'卓青籌備會議', date: addDays(t, 2), time:'14:00', location:'會議室', attendees:'5 人',
        notes:'確認場地與分工',
        actionItems:[
          { id: uid(), text:'確認場地佈置分工', done:false, convertedTaskId:null },
          { id: uid(), text:'更新報名表單文案', done:false, convertedTaskId:null },
          { id: uid(), text:'通知志工時間', done:true, doneAt: addDays(t, -1), convertedTaskId:null }
        ] },
      { id: uid(), title:'官網改版討論', date: addDays(t, 4), time:'10:00', location:'線上', attendees:'3 人',
        notes:'議程待排', actionItems:[] },
      { id: uid(), title:'招生進度追蹤', date: addDays(t, 8), time:'09:30', location:'會議室', attendees:'4 人',
        notes:'', actionItems:[ { id: uid(), text:'回報宣傳素材進度', done:false, convertedTaskId:null } ] },
      { id: uid(), title:'官網改版 kickoff', date: addDays(t, -5), time:'15:00', location:'線上', attendees:'3 人',
        notes:'決議：沿用現有品牌色', actionItems:[] },
      { id: uid(), title:'卓青會議（逐字稿）', date: addDays(t, -8), time:'14:00', location:'會議室', attendees:'6 人',
        notes:'逐字稿已生成 5 個行動項', actionItems:[] }
    ],
    events: [
      { id: uid(), title:'牙醫回診', date: addDays(t, 1), time:'18:30', location:'牙醫診所', note:'記得帶健保卡', createdAt:t },
      { id: uid(), title:'家庭聚餐', date: addDays(t, 6), time:'', location:'家裡', note:'', createdAt:t }
    ],
    docs: [
      { id: uid(), title:'青廣招生簡章（草稿）', url:'', tags:['招生','文件'], note:'待回覆印刷廠校稿版本', createdAt:t },
      { id: uid(), title:'官網改版需求整理', url:'', tags:['官網','文件'], note:'kickoff 決議與參考網站', createdAt:t },
      { id: uid(), title:'會議逐字稿資料夾', url:'', tags:['會議'], note:'本機路徑：C:\\Users\\m9552', createdAt:t }
    ],
    hours: [
      { id: uid(), date: addDays(t, -1), projectId: p1, hours: 3, note:'簡章校稿' },
      { id: uid(), date: addDays(t, -1), projectId: p2, hours: 2, note:'wireframe' },
      { id: uid(), date: addDays(t, -2), projectId: p1, hours: 4, note:'表單文案' },
      { id: uid(), date: addDays(t, -3), projectId: null, hours: 2, note:'會議與紀錄' }
    ],
    links: [
      { id: uid(), title:'YouTube', url:'https://www.youtube.com', note:'休息一下', createdAt:t },
      { id: uid(), title:'GitHub', url:'https://github.com', note:'逛逛有趣的專案', createdAt:t },
      { id: uid(), title:'巴哈姆特', url:'https://www.gamer.com.tw', note:'', createdAt:t }
    ],
    aiTasks: [
      { id: uid(), title:'整理本週會議逐字稿', instruction:'從逐字稿萃取決議與行動項，整理成可直接轉任務的清單。',
        status:'todo', progress:0, priority:'high', owner:'AI Agent', due:t, waitingFor:'', result:'',
        createdAt:t, updatedAt:aiStamp, startedAt:null, completedAt:null, history:[] },
      { id: uid(), title:'官網改版競品資料蒐集', instruction:'整理 3 個競品首頁的版型、導覽與 CTA，輸出比較表。',
        status:'doing', progress:45, priority:'mid', owner:'AI Agent', due:addDays(t, 2), waitingFor:'', result:'',
        createdAt:t, updatedAt:aiStamp, startedAt:aiStamp, completedAt:null,
        history:[{ at:aiStamp, status:'doing', progress:45, note:'已完成兩個競品，正在整理第三個' }] },
      { id: uid(), title:'招生表單回覆信草稿', instruction:'依招生簡章產生家長回覆信，語氣親切、300 字內。',
        status:'waiting', progress:80, priority:'mid', owner:'AI Agent', due:t, waitingFor:'請確認是否提到早鳥優惠與退款規則。', result:'',
        createdAt:t, updatedAt:aiStamp, startedAt:aiStamp, completedAt:null,
        history:[{ at:aiStamp, status:'waiting', progress:80, note:'草稿完成，等待人工確認' }] },
      { id: uid(), title:'會議紀錄歸檔摘要', instruction:'把上週會議紀錄濃縮成 5 點摘要，標記負責人與期限。',
        status:'done', progress:100, priority:'low', owner:'AI Agent', due:addDays(t, -2), waitingFor:'', result:'已產出 5 點摘要，並標記 3 位負責人。',
        createdAt:t, updatedAt:aiStamp, startedAt:aiStamp, completedAt:addDays(t, -1),
        history:[{ at:aiStamp, status:'done', progress:100, note:'已交付摘要' }] }
    ]
  };
}

/* 查找 */
function findTask(id){ for(var i=0;i<state.tasks.length;i++) if(state.tasks[i].id===id) return state.tasks[i]; return null; }
function isMCPTask(x){ return !!x && (x.source === 'mcp' || x.assignedBy === 'boss'); }
function mcpSender(x){
  var s = x && (x.sender || x.assignedBy);
  if(!s) return '未知';
  return s === 'boss' ? '老闆' : String(s);
}
function mcpBadge(x, text){
  if(!isMCPTask(x)) return '';
  return '<span class="src-badge" title="由 ' + esc(mcpSender(x)) + ' 交辦">' + esc(text || 'MCP') + '</span>';
}
function findProject(id){ for(var i=0;i<state.projects.length;i++) if(state.projects[i].id===id) return state.projects[i]; return null; }
function findMeeting(id){ for(var i=0;i<state.meetings.length;i++) if(state.meetings[i].id===id) return state.meetings[i]; return null; }
function findEvent(id){ for(var i=0;i<state.events.length;i++) if(state.events[i].id===id) return state.events[i]; return null; }
function findAITask(id){ for(var i=0;i<state.aiTasks.length;i++) if(state.aiTasks[i].id===id) return state.aiTasks[i]; return null; }
function findDoc(id){ for(var i=0;i<state.docs.length;i++) if(state.docs[i].id===id) return state.docs[i]; return null; }
function findLink(id){ for(var i=0;i<state.links.length;i++) if(state.links[i].id===id) return state.links[i]; return null; }
function projName(id){ var p = id ? findProject(id) : null; return p ? p.name : ''; }

/* ================= 主題 ================= */
var mq = window.matchMedia('(prefers-color-scheme: dark)');
var themeMode = 'system';
try{ themeMode = localStorage.getItem('wd-theme') || 'system'; }catch(e){}
var accent = 'orange';
try{ accent = localStorage.getItem('wd-accent') || 'orange'; }catch(e){}
function applyTheme(){
  var resolved = (themeMode === 'system') ? (mq.matches ? 'dark' : 'light') : themeMode;
  document.documentElement.dataset.theme = resolved;
  $$('[data-mode]').forEach(function(b){ b.classList.toggle('on', b.dataset.mode === themeMode); });
}
function applyAccent(){
  document.documentElement.dataset.accent = accent;
  $$('[data-accent]').forEach(function(b){ if(b.classList.contains('sw')) b.classList.toggle('on', b.dataset.accent === accent); });
}
if(mq.addEventListener) mq.addEventListener('change', function(){ if(themeMode === 'system') applyTheme(); });

/* ================= 通用 UI ================= */
var modalRoot = $('#modal-root');
var pendingYes = null;
function openModal(inner){
  modalRoot.innerHTML = '<div class="overlay">' + inner + '</div>';
  var f = modalRoot.querySelector('[data-autofocus]') || modalRoot.querySelector('input,select,textarea,button');
  if(f) setTimeout(function(){ f.focus(); }, 0);
}
function closeModal(){ modalRoot.innerHTML = ''; pendingYes = null; }
function toast(msg){
  var box = $('#toasts');
  var d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  box.appendChild(d);
  setTimeout(function(){ d.remove(); }, 2600);
}
function confirmBox(msg, onYes){
  pendingYes = onYes;
  openModal(
    '<div class="modal" style="max-width:400px">' +
      '<div class="modal-b" style="padding-top:18px"><p style="margin:0;font-size:14px">' + esc(msg) + '</p></div>' +
      '<div class="modal-f"><div class="spacer"></div>' +
        '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
        '<button type="button" class="btn btn-danger" data-action="confirm-yes">確定</button>' +
      '</div>' +
    '</div>');
}
function segHTML(name, val, opts, width){
  return '<div class="seg' + (width ? '' : ' wide') + '"' + (width ? ' style="width:' + width + 'px"' : '') + ' data-seg="' + name + '">' +
    opts.map(function(o){
      return '<button type="button" class="' + (o[0] === val ? 'on' : '') + '" data-action="seg-pick" data-val="' + o[0] + '">' + o[1] + '</button>';
    }).join('') +
    '<input type="hidden" name="' + name + '" value="' + val + '">' +
  '</div>';
}
function pillPRI(p){ return '<span class="pill p-' + p + '">' + PRI[p] + '</span>'; }
function pillST(s){
  var cls = s === 'done' ? 'p-done' : (s === 'doing' ? 'p-info' : 'p-low');
  return '<span class="pill ' + cls + '">' + ST[s] + '</span>';
}

/* ================= 導覽 ================= */
var currentView = 'overview';
function go(view){
  currentView = view;
  $('#page-title').textContent = (view === 'tasks' && taskArea === 'ai') ? 'AI 工作區' : (TITLES[view] || '總覽');
  $$('.view').forEach(function(v){ v.classList.toggle('on', v.id === 'view-' + view); });
  $$('.nav a').forEach(function(a){ a.classList.toggle('active', a.dataset.view === view); });
  updateTopbarAdd();
  window.scrollTo(0, 0);
  if(view === 'settings') refreshCloudTime();
}
function updateTopbarAdd(){
  var btn = $('.topbar .btn-primary');
  if(!btn) return;
  var ai = currentView === 'tasks' && taskArea === 'ai';
  btn.dataset.action = ai ? 'open-ai-task' : 'open-task';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' + (ai ? '新增 AI 任務' : '新增任務');
}

/* ================= 渲染：總覽 ================= */
function renderOverview(){
  var t = today();
  var ws = startOfWeek(t), we = addDays(ws, 6);
  var openTasks = state.tasks.filter(function(x){ return x.status !== 'done'; });
  var dueWeek = openTasks.filter(function(x){ return x.due && x.due >= ws && x.due <= we; });
  var doing = state.tasks.filter(function(x){ return x.status === 'doing'; });
  var overdue = openTasks.filter(function(x){ return x.due && x.due < t; });
  var doneWeek = state.tasks.filter(function(x){ return x.completedAt && x.completedAt >= ws && x.completedAt <= we; });
  var denom = doneWeek.length + dueWeek.length;
  var rate = denom ? Math.round(100 * doneWeek.length / denom) : 0;
  var todayDue = dueWeek.filter(function(x){ return x.due === t; }).length;

  var focus = openTasks.filter(function(x){ return x.due && x.due <= t; })
    .sort(function(a, b){ return (a.due < b.due ? -1 : a.due > b.due ? 1 : PRI_RANK[a.priority] - PRI_RANK[b.priority]); })
    .slice(0, 6);

  var upcoming = scheduleList().filter(function(it){ return (it.endDate || it.date) >= t; })
    .sort(scheduleSort)
    .slice(0, 3);

  var h = '';
  h += '<div class="kpis">';
  h += '<div class="card kpi"><div><div class="l">本週到期<small>含今天 ' + todayDue + ' 項</small></div></div><div class="n">' + dueWeek.length + '</div></div>';
  h += '<div class="card kpi"><div><div class="l">進行中<small>待辦 ' + openTasks.filter(function(x){return x.status==='todo'}).length + ' 項</small></div></div><div class="n">' + doing.length + '</div></div>';
  h += '<div class="card kpi"><div><div class="l">逾期<small>' + (overdue.length ? '需要處理' : '狀態良好') + '</small></div></div><div class="n' + (overdue.length ? ' red' : '') + '">' + overdue.length + '</div></div>';
  h += '<div class="card kpi"><div><div class="l">本週完成率<small>完成 ' + doneWeek.length + ' / 應處理 ' + denom + '</small></div></div>';
  h += '<div class="donut" style="background:conic-gradient(var(--green) 0 ' + rate + '%,var(--surface-2) ' + rate + '% 100%)"><b>' + rate + '%</b></div></div>';
  h += '</div>';

  h += '<div class="grid-2">';
  /* 今日焦點 */
  h += '<div class="card"><div class="card-h">今日焦點 <span class="cnt">逾期與今天到期，依優先級排序</span></div>';
  if(focus.length){
    focus.forEach(function(x){
      var sub = [];
      if(isOverdue(x)) sub.push('<span class="od">' + dueLabel(x.due) + '・逾期</span>');
      else sub.push(dueLabel(x.due));
      if(x.projectId) sub.push(esc(projName(x.projectId)));
      h += '<div class="trow" data-action="open-task" data-id="' + x.id + '">' +
        '<span class="check" data-action="toggle-task" data-id="' + x.id + '"></span>' +
        '<span class="t">' + esc(x.title) + '<small>' + sub.join('・') + '</small></span>' +
        pillPRI(x.priority) + '</div>';
    });
  } else {
    h += '<div class="empty">今天沒有到期任務，可以推進手上的專案</div>';
  }
  h += '</div>';

  /* 右欄 */
  h += '<div class="stack">';
  h += '<div class="card"><div class="card-h">近期行程 <button type="button" class="ibtn" data-action="open-day" data-date="' + t + '" title="查看或新增行程">＋</button></div>';
  if(upcoming.length){
    upcoming.forEach(function(it){ h += scheduleMeetHTML(it); });
  } else {
    h += '<div class="empty">沒有即將到來的會議或行程</div>';
  }
  h += '</div>';

  h += aiOverviewHTML();

  h += '<div class="card"><div class="card-h">專案進度</div><div class="card-b">';
  var ps = state.projects.slice(0, 3);
  if(ps.length){
    ps.forEach(function(p, i){
      var pct = projPct(p);
      h += '<div style="' + (i ? 'margin-top:14px' : '') + '">' +
        '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px">' +
        '<span>' + esc(p.name) + '</span><span class="dim">' + pct + '%</span></div>' +
        '<div class="prog' + (i % 2 ? ' green' : '') + '"><i style="width:' + pct + '%"></i></div>' +
        (function(){ var nm = nextMilestone(p); return nm ? '<div class="next" style="margin-top:6px">下一個：' + esc(nm.title) + '</div>' : ''; })() +
        '</div>';
    });
  } else {
    h += '<div class="empty">尚未建立專案</div>';
  }
  h += '</div></div>';
  h += '</div></div>';

  $('#view-overview').innerHTML = h;
}

function projPct(p){
  var linked = state.tasks.filter(function(x){ return x.projectId === p.id; });
  if(linked.length){
    return Math.round(100 * linked.filter(function(x){ return x.status === 'done'; }).length / linked.length);
  }
  var ms = p.milestones || [];
  if(ms.length) return Math.round(100 * ms.filter(function(m){ return m.done; }).length / ms.length);
  return 0;
}
function nextMilestone(p){
  var ms = (p.milestones || []).filter(function(m){ return !m.done; });
  return ms.length ? ms[0] : null;
}

/* ================= 渲染：任務 ================= */
var taskViewMode = 'board';
var taskFilter = 'all';
function filteredTasks(){
  var t = today(), ws = startOfWeek(t), we = addDays(ws, 6);
  var arr = state.tasks.slice();
  if(taskFilter === 'high') arr = arr.filter(function(x){ return x.priority === 'high'; });
  else if(taskFilter === 'week') arr = arr.filter(function(x){ return x.due && x.due >= ws && x.due <= we; });
  else if(taskFilter === 'overdue') arr = arr.filter(function(x){ return x.due && x.status !== 'done' && x.due < t; });
  else if(taskFilter === 'mcp') arr = arr.filter(isMCPTask);
  return arr;
}
function taskSortFor(st){
  return function(a, b){
    if(st === 'done'){
      return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
    }
    var ad = a.due || '9999-12-31', bd = b.due || '9999-12-31';
    if(ad !== bd) return ad < bd ? -1 : 1;
    return PRI_RANK[a.priority] - PRI_RANK[b.priority];
  };
}
function taskCard(x){
  var cls = 'kcard' + (x.status === 'done' ? ' done' : (x.priority === 'high' ? ' high' : (x.priority === 'mid' ? ' mid' : '')));
  var left = [];
  if(x.status === 'done'){ if(x.completedAt) left.push(fmtMD(x.completedAt) + ' 完成'); }
  else if(x.due){ left.push(isOverdue(x) ? '<span class="od">' + dueLabel(x.due) + '・逾期</span>' : dueLabel(x.due) + '到期'); }
  if(x.projectId) left.push(esc(projName(x.projectId)));
  if(isMCPTask(x)) left.push(esc(mcpSender(x)) + ' 交辦');
  var badge = mcpBadge(x);
  return '<div class="' + cls + '" draggable="true" data-action="open-task" data-id="' + x.id + '">' +
    '<div class="kt' + (x.status === 'done' ? ' done' : '') + '">' + esc(x.title) + '</div>' +
    '<div class="kmeta"><span class="kl">' + left.join('・') + '</span><span class="kr">' + badge + pillPRI(x.priority) + '</span></div>' +
  '</div>';
}
function renderTasks(){
  var el = $('#view-tasks');
  var h = '<div class="task-area-switch">' +
    segHTML('taskarea', taskArea, [['tasks','我的任務'],['ai','AI 工作區']], 220) +
  '</div>';
  if(taskArea === 'ai'){
    h += renderAIWorkspace();
    el.innerHTML = h;
    return;
  }
  var chips = [['all','全部'],['high','高優先'],['week','本週到期'],['overdue','逾期'],['mcp','MCP 交辦']];
  h += '<div class="toolbar">' +
    segHTML('tasksview', taskViewMode, [['board','看板'],['list','清單']], 150) +
    chips.map(function(c){
      return '<button class="chip' + (taskFilter === c[0] ? ' on' : '') + '" data-action="set-taskfilter" data-val="' + c[0] + '">' + c[1] + '</button>';
    }).join('') +
    '<button class="btn btn-primary push" data-action="open-task"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增任務</button>' +
  '</div>';

  var list = filteredTasks();
  if(taskViewMode === 'board'){
    h += '<div class="board">';
    ['todo','doing','done'].forEach(function(st){
      var arr = list.filter(function(x){ return x.status === st; }).sort(taskSortFor(st));
      h += '<div class="col"><div class="card"><div class="card-h">' + ST[st] + ' <span class="cnt">' + arr.length + '</span></div>' +
        '<div class="card-b" data-drop-status="' + st + '">' +
        (arr.length ? arr.map(taskCard).join('') : '<div class="empty">' + (st === 'done' ? '完成的任務會出現在這' : '拖曳任務到此') + '</div>') +
        '</div></div></div>';
    });
    h += '</div>';
  } else {
    h += '<div class="card">';
    if(list.length){
      var sorted = list.sort(function(a, b){
        if(a.status === 'done' && b.status === 'done') return taskSortFor('done')(a, b);
        if(a.status === 'done') return 1;
        if(b.status === 'done') return -1;
        return taskSortFor('todo')(a, b);
      });
      sorted.forEach(function(x){
        var sub = [];
        var pn = projName(x.projectId);
        if(pn) sub.push(esc(pn));
        if(x.status === 'done'){ if(x.completedAt) sub.push(fmtMD(x.completedAt) + ' 完成'); }
        else if(x.due) sub.push(isOverdue(x) ? '<span class="od">' + dueLabel(x.due) + '・逾期</span>' : dueLabel(x.due) + '到期');
        if(isMCPTask(x)) sub.push(esc(mcpSender(x)) + ' 交辦');
        h += '<div class="trow" data-action="open-task" data-id="' + x.id + '">' +
          '<span class="check' + (x.status === 'done' ? ' done' : '') + '" data-action="toggle-task" data-id="' + x.id + '"></span>' +
          '<span class="t' + (x.status === 'done' ? ' done' : '') + '">' + esc(x.title) + '<small>' + sub.join('・') + '</small></span>' +
          mcpBadge(x) +
          pillST(x.status) + pillPRI(x.priority) + '</div>';
      });
    } else {
      h += '<div class="empty">沒有符合條件的任務</div>';
    }
    h += '</div>';
  }
  el.innerHTML = h;
}
function toggleTask(id){
  var x = findTask(id);
  if(!x) return;
  if(x.status === 'done'){ x.status = 'todo'; x.completedAt = null; }
  else { x.status = 'done'; x.completedAt = today(); }
  commit();
}
function setTaskStatus(id, status){
  var x = findTask(id);
  if(!x || x.status === status) return;
  x.status = status;
  x.completedAt = (status === 'done') ? today() : null;
  commit();
  toast('已移至「' + ST[status] + '」');
}

/* ================= AI 工作區 ================= */
var TASK_AREA_KEY = 'wd-task-area';
var taskArea = 'tasks';
try{ taskArea = localStorage.getItem(TASK_AREA_KEY) === 'ai' ? 'ai' : 'tasks'; }catch(e){}

function aiNow(){ return new Date().toISOString(); }
function aiClamp(n){ n = Math.round(+n || 0); return Math.max(0, Math.min(100, n)); }
function normalizeAITask(t){
  t = t || {};
  if(!t.id) t.id = uid();
  if(t.title == null) t.title = '';
  if(t.instruction == null) t.instruction = '';
  if(t.owner == null) t.owner = 'AI Agent';
  if(AI_STATUSES.indexOf(t.status) < 0) t.status = 'todo';
  if(!PRI[t.priority]) t.priority = 'mid';
  t.progress = aiClamp(t.progress);
  if(t.status === 'done') t.progress = 100;
  if(t.status === 'todo') t.progress = 0;
  if(t.due === undefined) t.due = null;
  if(t.waitingFor == null) t.waitingFor = '';
  if(t.result == null) t.result = '';
  if(t.createdAt == null) t.createdAt = today();
  if(t.updatedAt == null) t.updatedAt = '';
  if(t.startedAt === undefined) t.startedAt = null;
  if(t.completedAt === undefined) t.completedAt = null;
  if(t.status === 'done' && !t.completedAt) t.completedAt = today();
  if(t.status !== 'done') t.completedAt = null;
  if(!Array.isArray(t.history)) t.history = [];
  t.history = t.history.filter(function(x){ return x && typeof x === 'object'; }).map(function(x){
    return {
      at: x.at || '',
      status: AI_ST[x.status] ? x.status : t.status,
      progress: aiClamp(x.progress),
      note: x.note == null ? '' : String(x.note)
    };
  }).slice(-40);
  return t;
}
function aiLog(t, note){
  if(!Array.isArray(t.history)) t.history = [];
  t.history.push({ at: aiNow(), status: t.status, progress: t.progress, note: note || '' });
  if(t.history.length > 40) t.history = t.history.slice(-40);
}
function aiCounts(){
  var c = { todo:0, doing:0, waiting:0, done:0, total: state.aiTasks.length };
  state.aiTasks.forEach(function(t){ if(c[t.status] != null) c[t.status]++; });
  return c;
}
function aiSortFor(status){
  return function(a, b){
    if(status === 'done') return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
    var ad = a.due || '9999-12-31', bd = b.due || '9999-12-31';
    if(ad !== bd) return ad < bd ? -1 : 1;
    var pr = PRI_RANK[a.priority] - PRI_RANK[b.priority];
    if(pr) return pr;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  };
}
function aiPatch(t, patch, logNote){
  patch = patch || {};
  ['title','instruction','owner','waitingFor','result'].forEach(function(k){
    if(patch[k] !== undefined) t[k] = String(patch[k] == null ? '' : patch[k]);
  });
  if(patch.due !== undefined) t.due = patch.due || null;
  if(patch.priority && PRI[patch.priority]) t.priority = patch.priority;
  if(patch.status && AI_ST[patch.status]) t.status = patch.status;
  if(patch.progress !== undefined) t.progress = aiClamp(patch.progress);
  if(t.status === 'done'){
    t.progress = 100;
    if(!t.completedAt) t.completedAt = today();
  } else {
    t.completedAt = null;
    if(t.status === 'todo') t.progress = 0;
  }
  if(t.status === 'doing' && !t.startedAt) t.startedAt = aiNow();
  t.updatedAt = aiNow();
  aiLog(t, logNote !== undefined ? logNote : (patch.note || ''));
  return t;
}
function aiCreate(data){
  data = data || {};
  var newId = data.id || uid();
  if(findAITask(newId)) newId = uid();
  var t = normalizeAITask({
    id: newId,
    title: data.title,
    instruction: data.instruction,
    status: data.status || 'todo',
    progress: data.progress || 0,
    priority: data.priority || 'mid',
    owner: data.owner || 'AI Agent',
    due: data.due,
    waitingFor: data.waitingFor,
    result: data.result,
    createdAt: data.createdAt || today(),
    updatedAt: aiNow(),
    startedAt: data.startedAt || null,
    completedAt: data.completedAt || null,
    history: data.history || []
  });
  aiLog(t, data.logNote || data.note || '建立 AI 任務');
  return t;
}
function aiCopy(t){ return JSON.parse(JSON.stringify(t)); }
function aiJSON(){ return JSON.stringify(state.aiTasks.map(aiCopy), null, 2); }
function aiPromptText(){
  var payload = { schemaVersion: 1, generatedAt: aiNow(), tasks: state.aiTasks.map(aiCopy) };
  return [
    '你是工作儀錶板的 AI Agent。以下是 AI 工作區目前資料：',
    JSON.stringify(payload, null, 2),
    '',
    '請只回傳 JSON 陣列，每筆更新格式：',
    '{"id":"任務 id","status":"todo|doing|waiting|done","progress":0-100,"waitingFor":"等待確認原因","result":"完成結果","note":"本次更新說明"}',
    '規則：status=done 時 progress 必須是 100；不確定的欄位可省略；不要改 id。'
  ].join('\n');
}
function setTaskArea(val){
  taskArea = val === 'ai' ? 'ai' : 'tasks';
  try{ localStorage.setItem(TASK_AREA_KEY, taskArea); }catch(e){}
  if(currentView === 'tasks'){
    $('#page-title').textContent = taskArea === 'ai' ? 'AI 工作區' : '任務';
    updateTopbarAdd();
    renderTasks();
  }
}
function openAIWorkspace(){
  taskArea = 'ai';
  try{ localStorage.setItem(TASK_AREA_KEY, taskArea); }catch(e){}
  go('tasks');
  renderTasks();
}
function aiQuickActions(t){
  function b(status, label, primary){
    return '<button type="button" class="ai-act' + (primary ? ' primary' : '') + '" data-action="aiws-status" data-id="' + t.id + '" data-status="' + status + '">' + label + '</button>';
  }
  if(t.status === 'todo') return b('doing', '開始處理', true);
  if(t.status === 'doing') return b('waiting', '等待確認') + b('done', '完成', true);
  if(t.status === 'waiting') return b('doing', '退回處理') + b('done', '確認完成', true);
  return b('todo', '重新開啟');
}
function aiCardHTML(t){
  var meta = [];
  if(t.owner) meta.push(esc(t.owner));
  if(t.due) meta.push('到期 ' + dueLabel(t.due));
  if(t.updatedAt) meta.push(relTime(t.updatedAt) + '更新');
  var body = '';
  if(t.status === 'waiting'){
    body = '<div class="ai-callout wait"><b>等待確認</b><span>' + esc(t.waitingFor || '等待人工確認') + '</span></div>';
  } else if(t.status === 'done'){
    body = '<div class="ai-callout done"><b>完成結果</b><span>' + esc(t.result || '已完成') + '</span></div>';
  } else if(t.instruction){
    body = '<div class="ai-desc">' + esc(t.instruction) + '</div>';
  }
  return '<div class="ai-card ' + t.status + '" data-action="open-ai-task" data-id="' + t.id + '">' +
    '<div class="ai-card-top"><span class="ai-col-dot ' + t.status + '"></span>' + pillPRI(t.priority) + '</div>' +
    '<div class="ai-title">' + esc(t.title) + '</div>' +
    body +
    '<div class="ai-progress"><div class="ai-bar"><i style="width:' + t.progress + '%"></i></div><span>' + t.progress + '%</span></div>' +
    '<div class="ai-meta">' + meta.join('・') + '</div>' +
    '<div class="ai-actions">' + aiQuickActions(t) + '</div>' +
  '</div>';
}
function renderAIWorkspace(){
  var h = '<div class="ai-intro kbd-note">AI Agent 可讀取與更新此區；等待確認的項目需要你回覆。</div>';
  h += '<div class="board ai-board">';
  AI_STATUSES.forEach(function(st){
    var arr = state.aiTasks.filter(function(t){ return t.status === st; }).sort(aiSortFor(st));
    var empty = st === 'todo' ? '尚無 AI 待辦' : st === 'doing' ? 'Agent 開始處理後會移到這' : st === 'waiting' ? '需要你確認時會移到這' : '完成的項目會留在這';
    h += '<div class="col ai-col-' + st + '"><div class="card"><div class="card-h">' +
      '<span class="ai-col-title"><span class="ai-col-dot ' + st + '"></span>' + AI_ST[st] + '</span>' +
      ' <span class="cnt">' + arr.length + '</span></div>' +
      '<div class="card-b">' + (arr.length ? arr.map(aiCardHTML).join('') : '<div class="empty">' + empty + '</div>') + '</div>' +
    '</div></div>';
  });
  h += '</div>';
  h += aiAgentPanelHTML();
  return h;
}
function aiAgentPanelHTML(){
  var h = '<div class="card ai-agent"><div class="card-h">AI Agent 介面 <span class="cnt">雲端同步時位於 payload.aiTasks</span></div><div class="card-b">';
  h += '<div class="ai-agent-grid">' +
    '<div><p class="kbd-note" style="margin-top:0">瀏覽器自動化可直接呼叫：</p>' +
      '<div class="ai-code">wdAI.list()<br>wdAI.update(id, { status: "doing", progress: 50 })<br>wdAI.complete(id, "完成結果")</div></div>' +
    '<div><p class="kbd-note" style="margin-top:0">雲端 Agent 可讀寫：</p>' +
      '<p class="kbd-note"><code>dashboards.payload.aiTasks</code></p>' +
      '<p class="kbd-note">狀態：<code>todo</code> / <code>doing</code> / <code>waiting</code> / <code>done</code>；進度 0–100。</p></div>' +
  '</div>';
  h += '<div class="ai-agent-actions">' +
    '<button type="button" class="btn btn-ghost" data-action="aiws-copy-json">複製 AI 待辦 JSON</button>' +
    '<button type="button" class="btn btn-ghost" data-action="aiws-copy-prompt">複製 Agent 指令</button>' +
    '<button type="button" class="btn btn-ghost" data-action="aiws-apply">套用 Agent 更新</button>' +
    '<button type="button" class="btn btn-ghost" data-action="aiws-cloud-merge">檢查／補回雲端 AI 待辦</button>' +
  '</div>';
  h += '</div></div>';
  return h;
}
function aiCloudMerge(){
  syncCfgFromInputs();
  if(!sbReady()){ toast('請先到設定完成雲端同步'); return; }
  sbFetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=payload,updated_at&limit=1', { headers: sbHeaders() })
    .then(function(r){ if(!r.ok) throw { res: r }; return r.json(); })
    .then(function(arr){
      if(!arr || !arr.length){ toast('雲端還沒有資料列，請先確認同步設定'); return; }
      var remote = arr[0];
      var cloud = (remote.payload && Array.isArray(remote.payload.aiTasks)) ? remote.payload.aiTasks : [];
      var seen = {};
      state.aiTasks.forEach(function(t){
        if(t && t.id) seen['id:' + t.id] = true;
        if(t && t.tgMsgId) seen['tg:' + t.tgMsgId] = true;
      });
      var missing = cloud.filter(function(t){
        if(!t || typeof t !== 'object' || !t.title) return false;
        if(t.id && seen['id:' + t.id]) return false;
        if(t.tgMsgId && seen['tg:' + t.tgMsgId]) return false;
        return true;
      });
      if(!cloud.length){
        toast('雲端 AI 待辦 0 筆：請確認 Telegram 的 Project URL／文件金鑰與本頁相同');
        return;
      }
      if(!missing.length){
        openAIWorkspace();
        toast('雲端 AI 待辦 ' + cloud.length + ' 筆，本機已同步');
        return;
      }
      confirmBox('雲端 AI 待辦 ' + cloud.length + ' 筆，本機缺少 ' + missing.length + ' 筆（雲端更新 ' + fmtDT(remote.updated_at) + '）。要補回並開啟 AI 工作區嗎？', function(){
        missing.forEach(function(t){ state.aiTasks.push(normalizeAITask(aiCopy(t))); });
        saveState(); openAIWorkspace();
        toast('已從雲端補回 ' + missing.length + ' 筆 AI 待辦');
      });
    })
    .catch(function(err){ toast('讀取雲端 AI 待辦失敗：' + syncErrMsg(err.res, err)); });
}
function aiOverviewHTML(){
  var c = aiCounts();
  var waiting = state.aiTasks.filter(function(t){ return t.status === 'waiting'; });
  var doing = state.aiTasks.filter(function(t){ return t.status === 'doing'; });
  var h = '<div class="card ai-mini"><div class="card-h">AI 工作區 <button type="button" class="ibtn" data-action="open-ai" title="開啟 AI 工作區">→</button></div><div class="card-b">';
  if(!c.total){
    h += '<div class="empty">尚無 AI 任務</div>';
  } else {
    h += '<div class="ai-mini-grid">' + AI_STATUSES.map(function(st){
      return '<div class="m"><b>' + c[st] + '</b><span>' + AI_ST[st].replace('AI ', '') + '</span></div>';
    }).join('') + '</div>';
    if(waiting.length){
      h += '<div class="ai-mini-note wait">等待確認：<b>' + esc(waiting[0].title) + '</b>' + (waiting.length > 1 ? ' 等 ' + waiting.length + ' 項' : '') + '</div>';
    } else if(doing.length){
      h += '<div class="ai-mini-note">Agent 正在處理：<b>' + esc(doing[0].title) + '</b></div>';
    }
  }
  h += '</div></div>';
  return h;
}

/* ================= 渲染：專案 ================= */
function renderProjects(){
  var el = $('#view-projects');
  var h = '<div class="toolbar"><button class="btn btn-primary push" data-action="open-project"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增專案</button></div>';
  if(state.projects.length){
    h += '<div class="grid-eq">';
    state.projects.forEach(function(p){
      var pct = projPct(p);
      var linked = state.tasks.filter(function(x){ return x.projectId === p.id && x.status !== 'done'; });
      var ms = p.milestones || [];
      var nextDone = null;
      ms.forEach(function(m, idx){ if(!m.done && nextDone === null) nextDone = idx; });
      h += '<div class="card">' +
        '<div class="card-h"><span>' + esc(p.name) + '</span>' +
        '<span style="display:flex;gap:6px;align-items:center"><span class="pill p-info">' + pct + '%</span>' +
        '<button type="button" class="ibtn" data-action="open-project" data-id="' + p.id + '" title="編輯">✎</button></span></div>' +
        '<div class="card-b">' +
        (p.desc ? '<div class="dim" style="margin-bottom:10px">' + esc(p.desc) + '</div>' : '') +
        '<div class="prog"><i style="width:' + pct + '%"></i></div>' +
        '<div class="ms-row">' +
        (ms.length ? ms.map(function(m, idx){
          var cls = m.done ? 'done' : (idx === nextDone ? 'now' : '');
          return '<span class="ms ' + cls + '" data-action="toggle-ms" data-pid="' + p.id + '" data-idx="' + idx + '" title="點擊切換完成">' + (m.done ? '✓ ' : '') + esc(m.title) + '</span>';
        }).join('') : '<span class="dim">尚未設定里程碑</span>') +
        '</div>' +
        '<div class="next">' +
        (function(){ var nm = nextMilestone(p); return nm ? '下一個里程碑：' + esc(nm.title) + '・' : ''; })() +
        '未完成任務 ' + linked.length + ' 項</div>' +
        '</div></div>';
    });
    h += '</div>';
  } else {
    h += '<div class="card"><div class="empty">尚未建立專案，點右上「新增專案」開始</div></div>';
  }
  el.innerHTML = h;
}
function toggleMilestone(pid, idx){
  var p = findProject(pid);
  if(!p || !p.milestones[idx]) return;
  var m = p.milestones[idx];
  m.done = !m.done;
  m.doneAt = m.done ? today() : null;
  commit();
}

/* ================= 行事曆：會議＋私人行程 ================= */
function scheduleList(){
  var arr = [];
  state.meetings.forEach(function(m){
    arr.push({ type:'meeting', id:m.id, date:m.date, time:m.time || '', data:m });
  });
  state.events.forEach(function(ev){
    arr.push({ type:'event', id:ev.id, date:ev.date, endDate:eventEnd(ev), time:ev.time || '', data:ev });
  });
  return arr;
}
function scheduleSort(a, b){
  var at = a.dayTime !== undefined ? a.dayTime : (a.time || '');
  var bt = b.dayTime !== undefined ? b.dayTime : (b.time || '');
  return (a.date + 'T' + (at || '00:00')).localeCompare(b.date + 'T' + (bt || '00:00'));
}
function dayItems(date){
  return scheduleList().filter(function(it){
    if(it.type === 'event') return it.date <= date && date <= (it.endDate || it.date);
    return it.date === date;
  }).map(function(it){
    if(it.type !== 'event') return it;
    var copy = {};
    Object.keys(it).forEach(function(k){ copy[k] = it[k]; });
    var days = Math.max(1, dayDiff(it.date, it.endDate || it.date) + 1);
    var idx = Math.max(1, dayDiff(it.date, date) + 1);
    copy.days = days;
    copy.dayIndex = idx;
    copy.dayTime = idx === 1 ? (it.time || '') : '';
    return copy;
  }).sort(scheduleSort);
}
function scheduleMeetHTML(it){
  var x = it.data;
  var isEv = it.type === 'event';
  var meta = isEv
    ? [eventDays(x) > 1 ? eventRangeLabel(x) : (x.time || '全天'), x.location]
    : [x.time || '全天', x.attendees, x.location];
  var tags = '';
  if(isEv){
    tags = '<span class="pill p-ev">私人行程</span>';
    if(eventDays(x) > 1 && x.date < today() && eventEnd(x) >= today()) tags += '<span class="pill p-info">進行中</span>';
  } else {
    var actions = x.actionItems || [];
    var undone = actions.filter(function(a){ return !a.done; }).length;
    tags = '<span class="pill p-info">會議</span>' +
      (undone ? '<span class="pill p-mid">未結 ' + undone + '</span>' :
        (actions.length ? '<span class="pill p-done">已結案</span>' : ''));
  }
  return '<div class="meet' + (isEv ? ' ev' : '') + '" data-action="' + (isEv ? 'open-event' : 'open-meeting') + '" data-id="' + x.id + '">' +
    '<div class="datechip' + (isEv ? ' ev' : '') + '"><b>' + parseD(x.date).getDate() + '</b><span>週' + wdName(x.date) + '</span></div>' +
    '<div class="body"><div style="font-weight:600">' + esc(x.title) + '</div>' +
    '<div class="dim">' + meta.filter(function(v){ return v; }).map(esc).join('・') + '</div>' +
    '<div class="meet-tags">' + tags + '</div></div></div>';
}
function dayRowHTML(it){
  var x = it.data;
  var isEv = it.type === 'event';
  var sub = isEv
    ? ['私人行程', it.days > 1 ? '第 ' + it.dayIndex + '/' + it.days + ' 天' : '', x.location]
    : ['會議', x.location, ((x.actionItems || []).length ? '行動項 ' + (x.actionItems || []).length : '')];
  return '<div class="day-row" data-action="' + (isEv ? 'open-event' : 'open-meeting') + '" data-id="' + x.id + '">' +
    '<span class="day-time">' + esc(isEv && it.dayTime !== undefined ? (it.dayTime || '全天') : (x.time || '全天')) + '</span>' +
    '<span class="day-main"><b>' + esc(x.title) + '</b><small>' + sub.filter(function(v){ return v; }).map(esc).join('・') + '</small></span>' +
    '<span class="pill ' + (isEv ? 'p-ev' : 'p-info') + '">' + (isEv ? '私人' : '會議') + '</span>' +
  '</div>';
}
function openDayModal(date){
  var d = parseD(date);
  var items = dayItems(date);
  var h = '<div class="modal day-modal">' +
    '<div class="modal-h"><span>' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 <span class="cnt">週' + wdName(date) + '</span></span>' +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      (items.length
        ? '<div class="day-list">' + items.map(dayRowHTML).join('') + '</div>'
        : '<div class="empty" style="padding:18px 0">這天還沒有安排</div>') +
    '</div>' +
    '<div class="modal-f">' +
      '<button type="button" class="btn btn-ghost" data-action="open-event" data-date="' + date + '">＋ 私人行程</button>' +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn btn-primary" data-action="open-meeting" data-date="' + date + '">＋ 會議</button>' +
    '</div>' +
  '</div>';
  openModal(h);
}

/* ================= 渲染：會議 ================= */
var calY, calM;
(function(){ var d = new Date(); calY = d.getFullYear(); calM = d.getMonth(); })();
function calHTML(){
  var first = new Date(calY, calM, 1).getDay();
  var dim = new Date(calY, calM + 1, 0).getDate();
  var prevDim = new Date(calY, calM, 0).getDate();
  var meetDates = {}, eventDates = {};
  state.meetings.forEach(function(m){ meetDates[m.date] = 1; });
  state.events.forEach(function(ev){
    eachDateRange(ev.date, eventEnd(ev), function(d){ eventDates[d] = 1; });
  });
  var h = ['日','一','二','三','四','五','六'].map(function(w){ return '<div class="wd">' + w + '</div>'; }).join('');
  var i, ds;
  for(i = 0; i < first; i++) h += '<div class="day mut">' + (prevDim - first + 1 + i) + '</div>';
  for(i = 1; i <= dim; i++){
    ds = calY + '-' + pad(calM + 1) + '-' + pad(i);
    var cls = 'day' + (ds === today() ? ' today' : '');
    var dots = (meetDates[ds] ? '<span class="dot"></span>' : '') + (eventDates[ds] ? '<span class="dot ev"></span>' : '');
    h += '<div class="' + cls + '" data-action="cal-day" data-date="' + ds + '">' + i + (dots ? '<span class="dots">' + dots + '</span>' : '') + '</div>';
  }
  var tail = (7 - ((first + dim) % 7)) % 7;
  for(i = 1; i <= tail; i++) h += '<div class="day mut">' + i + '</div>';
  return h;
}
function renderMeetings(){
  var t = today();
  var all = scheduleList();
  var upcoming = all.filter(function(it){ return (it.endDate || it.date) >= t; }).sort(scheduleSort);
  var past = all.filter(function(it){ return (it.endDate || it.date) < t; }).sort(function(a, b){ return scheduleSort(b, a); });

  var h = '<div class="toolbar meet-toolbar">' +
    '<span class="kbd-note"><span class="legend-dot"></span>會議　<span class="legend-dot ev"></span>私人行程　點日期查看當天行程</span>' +
    '<span class="meet-tools push">' +
      '<button type="button" class="btn btn-ghost" data-action="open-event">＋ 私人行程</button>' +
      '<button type="button" class="btn btn-primary" data-action="open-meeting">＋ 新增會議</button>' +
    '</span>' +
  '</div>';

  h += '<div class="grid-2">';
  h += '<div class="card"><div class="cal-h">' +
    '<button type="button" class="ibtn" data-action="cal-prev">‹</button>' +
    '<b>' + calY + ' 年 ' + (calM + 1) + ' 月</b>' +
    '<button type="button" class="ibtn" data-action="cal-next">›</button>' +
    '<span class="cnt push">會議與私人行程</span>' +
  '</div><div class="cal" id="cal-grid">' + calHTML() + '</div></div>';

  h += '<div class="stack">';
  h += '<div class="card"><div class="card-h"><span>即將到來</span><span class="cnt">會議與私人行程</span></div>';
  if(upcoming.length){
    upcoming.slice(0, 5).forEach(function(it){ h += scheduleMeetHTML(it); });
  } else {
    h += '<div class="empty">沒有即將到來的會議或行程</div>';
  }
  h += '</div>';

  h += '<div class="card"><div class="card-h">最近紀錄</div>';
  if(past.length){
    past.slice(0, 5).forEach(function(it){
      var x = it.data;
      if(it.type === 'event'){
        h += '<div class="trow" data-action="open-event" data-id="' + x.id + '">' +
          '<span class="t">' + esc(x.title) + '<small>' + eventRangeLabel(x) + '・私人行程' + (x.location ? '・' + esc(x.location) : '') + '</small></span>' +
          '<span class="pill p-ev">私人</span></div>';
      } else {
        h += '<div class="trow" data-action="open-meeting" data-id="' + x.id + '">' +
          '<span class="t">' + esc(x.title) + '<small>' + fmtMD(x.date) + '・行動項 ' + x.actionItems.length + '</small></span>' +
          '<span class="pill p-low">已結束</span></div>';
      }
    });
  } else {
    h += '<div class="empty">還沒有歷史紀錄</div>';
  }
  h += '</div>';
  h += '</div></div>';

  $('#view-meetings').innerHTML = h;
}

/* ================= 渲染：文件 ================= */
var docSearch = '';
var docTag = '';
function renderDocs(){
  var el = $('#view-docs');
  var tags = {};
  state.docs.forEach(function(d){ (d.tags || []).forEach(function(tg){ tags[tg] = 1; }); });
  var tagList = Object.keys(tags);

  var h = '<div class="toolbar">' +
    '<input id="doc-search" placeholder="搜尋文件標題、備註、標籤…" value="' + esc(docSearch) + '" style="max-width:260px">' +
    tagList.map(function(tg){
      return '<button class="chip' + (docTag === tg ? ' on' : '') + '" data-action="doc-tag" data-tag="' + esc(tg) + '">#' + esc(tg) + '</button>';
    }).join('') +
    '<button class="btn btn-primary push" data-action="open-doc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增文件</button>' +
  '</div><div id="doc-list"></div>';
  el.innerHTML = h;
  renderDocsList();
}
function renderDocsList(){
  var listEl = $('#doc-list');
  if(!listEl) return;
  var q = docSearch.toLowerCase();
  var list = state.docs.filter(function(d){
    if(docTag && (d.tags || []).indexOf(docTag) < 0) return false;
    if(!q) return true;
    var hay = (d.title + ' ' + (d.note || '') + ' ' + (d.url || '') + ' ' + (d.tags || []).join(' ')).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  if(!list.length){
    listEl.innerHTML = '<div class="card"><div class="empty">' + (state.docs.length ? '沒有符合搜尋的文件' : '還沒有文件，點右上「新增文件」建立第一個') + '</div></div>';
    return;
  }
  listEl.innerHTML = '<div class="doc-grid">' + list.map(function(d){
    return '<div class="card doc-card" data-action="open-doc" data-id="' + d.id + '">' +
      '<div class="card-b">' +
        '<div style="font-weight:600;margin-bottom:6px">' + esc(d.title) + '</div>' +
        ((d.tags || []).length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' + d.tags.map(function(tg){ return '<span class="pill p-low">#' + esc(tg) + '</span>'; }).join('') + '</div>' : '') +
        (d.note ? '<div class="doc-note">' + esc(d.note) + '</div>' : '') +
      '</div>' +
      '<div class="card-f">' +
        (d.url ? '<a class="link" href="' + esc(d.url) + '" target="_blank" rel="noopener" data-action="doc-link">開啟連結</a>' : '<span class="dim">無連結</span>') +
        '<div class="spacer"></div>' +
        '<button type="button" class="ibtn" data-action="open-doc" data-id="' + d.id + '" title="編輯">✎</button>' +
        '<button type="button" class="ibtn" data-action="del-doc" data-id="' + d.id + '" title="刪除">✕</button>' +
      '</div></div>';
  }).join('') + '</div>';
}

/* ================= 渲染：摸魚區 ================= */
function normUrl(u){
  u = String(u || '').trim();
  if(!u) return '';
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
function urlHost(u){
  try{ return new URL(u).hostname.replace(/^www\./i, ''); }catch(e){ return ''; }
}
function pickColor(s){
  s = String(s || '?');
  var sum = 0;
  for(var i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) % 360;
  return 'hsl(' + sum + ', 52%, 42%)';
}
function renderFun(){
  var el = $('#view-fun');
  var h = '<div class="toolbar">' +
    '<span class="kbd-note">點卡片直接開新分頁；✎ 編輯、✕ 刪除</span>' +
    '<button class="btn btn-primary push" data-action="open-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增連結</button>' +
  '</div>';
  if(!state.links.length){
    h += '<div class="card"><div class="empty">這裡還空空的 🐟<br>按右上「新增連結」，把平常會逛的網站收進來吧</div></div>';
  } else {
    h += '<div class="link-grid">' + state.links.map(function(l){
      var host = urlHost(l.url);
      var letter = (l.title || host || '?').trim().charAt(0).toUpperCase();
      var fav = host ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64' : '';
      return '<div class="card link-card" data-action="open-link-url" data-url="' + esc(l.url) + '">' +
        '<div class="link-ico" style="background:' + pickColor(l.title || host) + '">' +
          '<span>' + esc(letter) + '</span>' +
          (fav ? '<img src="' + esc(fav) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
        '</div>' +
        '<div class="link-body">' +
          '<div class="link-title">' + esc(l.title || host || '未命名連結') + '</div>' +
          '<div class="link-sub">' + (host ? esc(host) : '未設定網址') + (l.note ? '・' + esc(l.note) : '') + '</div>' +
        '</div>' +
        '<div class="link-acts">' +
          '<button type="button" class="ibtn" data-action="open-link" data-id="' + l.id + '" title="編輯">✎</button>' +
          '<button type="button" class="ibtn" data-action="del-link" data-id="' + l.id + '" title="刪除">✕</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }
  el.innerHTML = h;
}

/* ================= 渲染：統計 ================= */
var statsTab = 'hours';
try{
  var savedStatsTab = localStorage.getItem('wd-stats-tab');
  if(savedStatsTab === 'report' || savedStatsTab === 'hours') statsTab = savedStatsTab;
}catch(e){}
var reportRangeMode = 'week';
var reportAnchor = today();

function statsTabsHTML(){
  return '<div class="toolbar stats-toolbar"><div class="seg stats-tabs">' +
    [['hours','工時統計'],['report','工作報表']].map(function(o){
      return '<button type="button" class="' + (statsTab === o[0] ? 'on' : '') + '" data-action="stats-tab" data-val="' + o[0] + '">' + o[1] + '</button>';
    }).join('') +
  '</div></div>';
}
function renderStats(){
  $('#view-stats').innerHTML = statsTabsHTML() + (statsTab === 'report' ? reportStatsHTML() : hoursStatsHTML());
}
function hoursStatsHTML(){
  var t = today();
  var ws = startOfWeek(t);
  var days = [];
  for(var i = 0; i < 7; i++) days.push(addDays(ws, i));
  var weekHours = days.map(function(d){
    return state.hours.filter(function(x){ return x.date === d; }).reduce(function(s, x){ return s + (+x.hours || 0); }, 0);
  });
  var totalH = weekHours.reduce(function(a, b){ return a + b; }, 0);
  var activeDays = weekHours.filter(function(v){ return v > 0; }).length;
  var maxH = Math.max.apply(null, weekHours.concat([1]));

  var doneWeek = state.tasks.filter(function(x){ return x.completedAt && x.completedAt >= ws && x.completedAt <= addDays(ws, 6); });

  /* 近四週完成率 */
  var rates = [], labels = ['三週前','兩週前','上週','本週'];
  for(var w = 3; w >= 0; w--){
    var mon = addDays(ws, -7 * w), sun = addDays(mon, 6);
    var done = state.tasks.filter(function(x){ return x.completedAt && x.completedAt >= mon && x.completedAt <= sun; }).length;
    var dueNot = state.tasks.filter(function(x){ return x.due && x.due >= mon && x.due <= sun && x.status !== 'done'; }).length;
    var den = done + dueNot;
    rates.push(den ? Math.round(100 * done / den) : 0);
  }

  var recentHours = state.hours.slice().sort(function(a, b){ return String(b.date).localeCompare(String(a.date)); }).slice(0, 10);

  var h = '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">';
  h += '<div class="card kpi"><div><div class="l">本週工時<small>共 ' + activeDays + ' 個工作天有紀錄</small></div></div><div class="n">' + (Math.round(totalH * 10) / 10) + '<span style="font-size:13px;font-weight:400"> 小時</span></div></div>';
  h += '<div class="card kpi"><div><div class="l">本週完成<small>任務完成數</small></div></div><div class="n">' + doneWeek.length + '</div></div>';
  h += '<div class="card kpi"><div><div class="l">平均每工作日<small>以有紀錄的日子計算</small></div></div><div class="n">' + (activeDays ? (Math.round(totalH / activeDays * 10) / 10) : 0) + '<span style="font-size:13px;font-weight:400"> 小時</span></div></div>';
  h += '</div>';

  h += '<div class="grid-eq">';
  h += '<div class="card"><div class="card-h">本週工時 <span class="cnt">' + fmtMD(ws) + ' ～ ' + fmtMD(addDays(ws, 6)) + '</span></div><div class="card-b">' +
    '<div class="bars">' + weekHours.map(function(v){
      return '<div class="b"><i style="' + (v === 0 ? 'height:3px;opacity:.25' : 'height:' + Math.max(4, Math.round(v / maxH * 100)) + '%') + '"></i></div>';
    }).join('') + '</div>' +
    '<div class="blabels"><em>一</em><em>二</em><em>三</em><em>四</em><em>五</em><em>六</em><em>日</em></div>' +
  '</div></div>';
  h += '<div class="card"><div class="card-h">近四週完成率 <span class="cnt">完成 / 應處理</span></div><div class="card-b">' +
    '<div class="bars">' + rates.map(function(v){
      return '<div class="b"><i class="g" style="' + (v === 0 ? 'height:3px;opacity:.25' : 'height:' + Math.max(4, v) + '%') + '"></i></div>';
    }).join('') + '</div>' +
    '<div class="blabels">' + labels.map(function(l){ return '<em>' + l + '</em>'; }).join('') + '</div>' +
  '</div></div>';
  h += '</div>';

  h += '<div class="card" style="margin-top:14px"><div class="card-h">記錄工時</div><div class="card-b">' +
    '<form data-form="hours">' +
      '<div class="row3" style="margin-bottom:12px">' +
        '<div class="field" style="margin:0"><label>日期</label><input type="date" name="date" value="' + t + '"></div>' +
        '<div class="field" style="margin:0"><label>時數</label><input type="number" name="hours" min="0.5" max="24" step="0.5" placeholder="2"></div>' +
        '<div class="field" style="margin:0"><label>專案</label><select name="projectId"><option value="">（無專案）</option>' +
          state.projects.map(function(p){ return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>備註</label><input name="note" placeholder="做了什麼（選填）"></div>' +
      '<button class="btn btn-primary" type="submit">＋ 新增紀錄</button>' +
    '</form>' +
  '</div></div>';

  h += '<div class="card" style="margin-top:14px"><div class="card-h">最近紀錄</div>';
  if(recentHours.length){
    recentHours.forEach(function(x){
      h += '<div class="trow" style="cursor:default">' +
        '<span class="t">' + (x.note ? esc(x.note) : '（無備註）') + '<small>' + fmtMD(x.date) + (x.projectId ? '・' + esc(projName(x.projectId)) : '') + '</small></span>' +
        '<span class="pill p-info">' + x.hours + ' 小時</span>' +
        '<button type="button" class="ibtn" data-action="del-hour" data-id="' + x.id + '" title="刪除">✕</button>' +
      '</div>';
    });
  } else {
    h += '<div class="empty">還沒有工時紀錄</div>';
  }
  h += '</div>';

  return h;
}

/* ================= 渲染：工作報表 ================= */
function fmtYMD(s){ var d = parseD(s); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
function fmtNum(n){ return Math.round((+n || 0) * 10) / 10; }
function overdueDays(due){
  var n = Math.round((parseD(today()) - parseD(due)) / 86400000);
  return n > 0 ? n : 0;
}
function reportRange(){
  var mode = reportRangeMode;
  var a = reportAnchor || today();
  var s, e, label, sub;
  if(mode === 'day'){
    s = e = a;
    label = fmtYMD(a) + '（週' + wdName(a) + '）';
    sub = '共 1 天';
  } else if(mode === 'month'){
    s = a.slice(0, 7) + '-01';
    var d0 = parseD(s);
    var last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0);
    e = ymd(last);
    label = d0.getFullYear() + ' 年 ' + (d0.getMonth() + 1) + ' 月';
    sub = fmtMD(s) + ' ～ ' + fmtMD(e) + '・共 ' + last.getDate() + ' 天';
  } else {
    s = startOfWeek(a);
    e = addDays(s, 6);
    label = fmtYMD(s) + ' ～ ' + (parseD(s).getFullYear() === parseD(e).getFullYear() ? fmtMD(e) : fmtYMD(e));
    sub = '週一～週日・共 7 天';
  }
  return { mode: mode, start: s, end: e, label: label, sub: sub };
}
function inReportRange(d, r){ return !!d && d >= r.start && d <= r.end; }
function meetingStatus(m){
  var t = today();
  if(m.date < t) return '已舉行';
  if(m.date === t) return '今天';
  return '預定';
}
function buildReport(){
  var r = reportRange();
  var t = today();
  var done = [], created = [], openDue = [], overdue = [], noDue = [], hours = [];
  state.tasks.forEach(function(x){
    if(x.completedAt && inReportRange(x.completedAt, r)) done.push(x);
    if(x.createdAt && inReportRange(x.createdAt, r)) created.push(x);
    if(x.status !== 'done' && x.due && inReportRange(x.due, r)) openDue.push(x);
    if(x.status !== 'done' && x.due && x.due < t) overdue.push(x);
    if(x.status !== 'done' && !x.due) noDue.push(x);
  });
  state.hours.forEach(function(x){ if(inReportRange(x.date, r)) hours.push(x); });

  done.sort(function(a, b){
    var ac = String(a.completedAt || ''), bc = String(b.completedAt || '');
    if(ac !== bc) return ac < bc ? 1 : -1;
    return PRI_RANK[a.priority] - PRI_RANK[b.priority];
  });
  openDue.sort(function(a, b){
    var ad = a.due || '9999-12-31', bd = b.due || '9999-12-31';
    if(ad !== bd) return ad < bd ? -1 : 1;
    return PRI_RANK[a.priority] - PRI_RANK[b.priority];
  });
  overdue.sort(function(a, b){ return String(a.due).localeCompare(String(b.due)); });
  hours.sort(function(a, b){ return String(b.date).localeCompare(String(a.date)); });

  var meetings = state.meetings.filter(function(m){ return inReportRange(m.date, r); })
    .sort(function(a, b){ return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });

  var aiTotal = 0, aiDone = 0;
  meetings.forEach(function(m){
    (m.actionItems || []).forEach(function(a){
      aiTotal++;
      if(a.done) aiDone++;
    });
  });

  var msDone = [], msOpen = [], hasLegacyMsDone = false;
  state.projects.forEach(function(p){
    (p.milestones || []).forEach(function(m, idx){
      if(m.done && !m.doneAt) hasLegacyMsDone = true;
      if(m.done && m.doneAt && inReportRange(m.doneAt, r)) msDone.push({ p: p, m: m, idx: idx });
      if(!m.done) msOpen.push({ p: p, m: m, idx: idx });
    });
  });
  msDone.sort(function(a, b){ return String(b.m.doneAt).localeCompare(String(a.m.doneAt)); });

  var totalHours = 0, hourSet = {};
  hours.forEach(function(x){ totalHours += (+x.hours || 0); hourSet[x.date] = 1; });

  var denom = done.length + openDue.length;
  var rate = denom ? Math.round(100 * done.length / denom) : 0;

  var buckets = {};
  state.projects.forEach(function(p){
    buckets[p.id] = { id: p.id, name: p.name, done: 0, open: 0, hours: 0 };
  });
  function bucket(pid){
    if(pid && buckets[pid]) return buckets[pid];
    if(!buckets['']) buckets[''] = { id: '', name: '（無專案）', done: 0, open: 0, hours: 0 };
    return buckets[''];
  }
  done.forEach(function(x){ bucket(x.projectId).done++; });
  openDue.forEach(function(x){ bucket(x.projectId).open++; });
  hours.forEach(function(x){ bucket(x.projectId).hours += (+x.hours || 0); });

  var byProject = state.projects.map(function(p){ return buckets[p.id]; })
    .filter(function(p){ return p.done || p.open || p.hours; });
  if(buckets[''] && (buckets[''].done || buckets[''].open || buckets[''].hours)) byProject.push(buckets['']);

  return {
    range: r, done: done, created: created, openDue: openDue, overdue: overdue,
    noDue: noDue, hours: hours, totalHours: totalHours, hourDays: Object.keys(hourSet).length,
    meetings: meetings, aiTotal: aiTotal, aiDone: aiDone,
    msDone: msDone, msOpen: msOpen, hasLegacyMsDone: hasLegacyMsDone,
    byProject: byProject, rate: rate
  };
}
function reportTaskRow(x, doneMode){
  var sub = [];
  if(doneMode){
    if(x.completedAt) sub.push(fmtMD(x.completedAt) + ' 完成');
  } else if(x.due){
    var od = overdueDays(x.due);
    if(od > 0) sub.push('<span class="od">' + fmtMD(x.due) + ' 到期・逾 ' + od + ' 天</span>');
    else if(x.due === today()) sub.push('今天到期');
    else sub.push(fmtMD(x.due) + ' 到期');
  }
  if(x.projectId && projName(x.projectId)) sub.push(esc(projName(x.projectId)));
  if(isMCPTask(x)) sub.push(esc(mcpSender(x)) + ' 交辦');
  return '<div class="trow" data-action="open-task" data-id="' + x.id + '">' +
    '<span class="rep-ico' + (doneMode ? ' ok' : '') + '">' + (doneMode ? '✓' : '') + '</span>' +
    '<span class="t">' + esc(x.title) + '<small>' + sub.join('・') + '</small></span>' +
    mcpBadge(x) +
    pillPRI(x.priority) + '</div>';
}
function reportStatsHTML(){
  var R = buildReport();
  var r = R.range;
  var h = '';

  h += '<div class="report-bar">';
  h += '<div class="seg report-range">' + [['day','日'],['week','週'],['month','月']].map(function(o){
    return '<button type="button" class="' + (r.mode === o[0] ? 'on' : '') + '" data-action="report-range" data-val="' + o[0] + '">' + o[1] + '</button>';
  }).join('') + '</div>';
  h += '<div class="report-nav">' +
    '<button type="button" class="ibtn" data-action="report-prev" title="上一段">‹</button>' +
    '<span class="rl"><b>' + esc(r.label) + '</b><small>' + esc(r.sub) + '</small></span>' +
    '<button type="button" class="ibtn" data-action="report-next" title="下一段">›</button>' +
    '<button type="button" class="btn btn-ghost" data-action="report-today">今天</button>' +
  '</div>';
  h += '<div class="report-acts push">' +
    '<button type="button" class="btn btn-ghost" data-action="report-copy">複製摘要</button>' +
    '<button type="button" class="btn btn-ghost" data-action="report-csv">CSV</button>' +
  '</div>';
  h += '</div>';

  h += '<div class="kpis report-kpis">';
  h += '<div class="card kpi"><div><div class="l">任務完成<small>期間新增 ' + R.created.length + ' 件</small></div></div><div class="n">' + R.done.length + '</div></div>';
  h += '<div class="card kpi"><div><div class="l">到期未完成<small>' + (R.overdue.length ? '目前逾期（全部）' + R.overdue.length + ' 件' : '沒有逾期') + '</small></div></div><div class="n' + (R.openDue.length ? ' red' : '') + '">' + R.openDue.length + '</div></div>';
  h += '<div class="card kpi"><div><div class="l">完成率<small>完成 ' + R.done.length + ' / 應處理 ' + (R.done.length + R.openDue.length) + '</small></div></div><div class="n">' + R.rate + '<span style="font-size:13px;font-weight:400">%</span></div></div>';
  h += '<div class="card kpi"><div><div class="l">工時<small>' + R.hourDays + ' 天有紀錄</small></div></div><div class="n">' + fmtNum(R.totalHours) + '<span style="font-size:13px;font-weight:400"> 小時</span></div></div>';
  h += '</div>';

  h += '<div class="report-mini card">' +
    '<div class="rm"><b>' + R.meetings.length + '</b><span>會議場次</span></div>' +
    '<div class="rm"><b>' + R.aiDone + '<em>/' + R.aiTotal + '</em></b><span>行動項完成</span></div>' +
    '<div class="rm"><b>' + R.msDone.length + '</b><span>里程碑完成</span></div>' +
  '</div>';

  h += '<div class="grid-eq report-section">';
  h += '<div class="card"><div class="card-h"><span>已完成任務 <span class="cnt">' + R.done.length + '</span></span></div>';
  if(R.done.length) R.done.forEach(function(x){ h += reportTaskRow(x, true); });
  else h += '<div class="empty">這段期間還沒有完成的任務</div>';
  h += '</div>';
  h += '<div class="card"><div class="card-h"><span>到期未完成 <span class="cnt">' + R.openDue.length + '</span></span></div>';
  if(R.openDue.length) R.openDue.forEach(function(x){ h += reportTaskRow(x, false); });
  else h += '<div class="empty">這段期間沒有到期未完成的任務</div>';
  h += '</div></div>';
  h += '<div class="report-note">完成數依「完成日」；未完成依「到期日」且以目前狀態計算。兩者分母不同，分開呈現、不混算。</div>';
  if(R.noDue.length) h += '<div class="report-note">另有 ' + R.noDue.length + ' 項未完成任務沒有到期日，不列入期間統計（可到任務頁補上）。</div>';

  h += '<div class="card report-section">';
  h += '<div class="card-h"><span>會議與行動項 <span class="cnt">' + R.meetings.length + ' 場・行動項 ' + R.aiDone + '/' + R.aiTotal + '</span></span></div>';
  if(R.meetings.length){
    R.meetings.forEach(function(m){
      var items = m.actionItems || [];
      var md = items.filter(function(a){ return a.done; }).length;
      h += '<div class="rep-meet">';
      h += '<div class="rep-meet-h" data-action="open-meeting" data-id="' + m.id + '">' +
        '<span class="rep-mdate">' + fmtMD(m.date) + '<small>週' + wdName(m.date) + '</small></span>' +
        '<span class="rep-mtitle">' + esc(m.title) + '</span>' +
        (items.length ? '<span class="pill ' + (md === items.length ? 'p-done' : 'p-info') + '">' + md + '/' + items.length + '</span>' : '<span class="dim">無行動項</span>') +
      '</div>';
      if(items.length){
        h += '<div class="rep-ais">';
        items.forEach(function(a){
          h += '<div class="aitem">' +
            '<span class="check' + (a.done ? ' done' : '') + '" data-action="ai-toggle" data-mid="' + m.id + '" data-ai="' + a.id + '"></span>' +
            '<span class="ai-text' + (a.done ? ' done' : '') + '">' + esc(a.text) + '</span>' +
            (a.done && a.doneAt ? '<span class="dim">' + fmtMD(a.doneAt) + '</span>' : '') +
          '</div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
  } else {
    h += '<div class="empty">這段期間沒有會議</div>';
  }
  h += '</div>';

  h += '<div class="grid-eq report-section">';
  h += '<div class="card"><div class="card-h"><span>里程碑完成 <span class="cnt">' + R.msDone.length + '</span></span></div>';
  if(R.msDone.length){
    R.msDone.forEach(function(it){
      h += '<div class="trow" data-action="open-project" data-id="' + it.p.id + '">' +
        '<span class="check done" data-action="toggle-ms" data-pid="' + it.p.id + '" data-idx="' + it.idx + '" title="點擊取消完成"></span>' +
        '<span class="t">' + esc(it.m.title) + '<small>' + esc(it.p.name) + '・' + fmtMD(it.m.doneAt) + ' 完成</small></span>' +
      '</div>';
    });
  } else {
    h += '<div class="empty">這段期間沒有完成的里程碑</div>';
  }
  if(R.hasLegacyMsDone) h += '<div class="card-f kbd-note">完成日自 v1.2 開始記錄；較早完成的里程碑不會列入期間統計。</div>';
  h += '</div>';
  h += '<div class="card"><div class="card-h"><span>目前未完成 <span class="cnt">全部專案</span></span></div>';
  if(R.msOpen.length){
    R.msOpen.forEach(function(it){
      h += '<div class="trow" data-action="open-project" data-id="' + it.p.id + '">' +
        '<span class="check" data-action="toggle-ms" data-pid="' + it.p.id + '" data-idx="' + it.idx + '" title="點擊標記完成"></span>' +
        '<span class="t">' + esc(it.m.title) + '<small>' + esc(it.p.name) + '</small></span>' +
      '</div>';
    });
  } else {
    h += '<div class="empty">所有里程碑都完成了</div>';
  }
  h += '</div></div>';

  h += '<div class="card report-section">';
  h += '<div class="card-h"><span>依專案 <span class="cnt">完成／到期未完成／工時</span></span></div>';
  if(R.byProject.length){
    h += '<div class="rep-prow rep-phead"><span class="nm">專案</span><span class="v">完成</span><span class="v">未完成</span><span class="v">工時</span></div>';
    R.byProject.forEach(function(p){
      h += '<div class="rep-prow"><span class="nm">' + esc(p.name) + '</span>' +
        '<span class="v"><b>' + p.done + '</b></span>' +
        '<span class="v"><b>' + p.open + '</b></span>' +
        '<span class="v"><b>' + fmtNum(p.hours) + '</b></span></div>';
    });
    h += '<div class="rep-prow rep-ptotal"><span class="nm">合計</span>' +
      '<span class="v"><b>' + R.done.length + '</b></span>' +
      '<span class="v"><b>' + R.openDue.length + '</b></span>' +
      '<span class="v"><b>' + fmtNum(R.totalHours) + '</b></span></div>';
  } else {
    h += '<div class="empty">這段期間沒有專案活動</div>';
  }
  h += '</div>';

  return h;
}
function shiftReport(dir){
  var a = reportAnchor || today();
  if(reportRangeMode === 'day'){ reportAnchor = addDays(a, dir); return; }
  if(reportRangeMode === 'week'){ reportAnchor = addDays(a, 7 * dir); return; }
  var d = parseD(a);
  var target = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  var last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  reportAnchor = ymd(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)));
}
function reportSummaryText(R){
  var kind = R.range.mode === 'day' ? '工作日報' : (R.range.mode === 'month' ? '工作月報' : '工作週報');
  var lines = [];
  lines.push(kind + ' ' + R.range.label);
  lines.push('任務完成 ' + R.done.length + '（新增 ' + R.created.length + '）｜到期未完成 ' + R.openDue.length + '｜完成率 ' + R.rate + '%');
  if(R.overdue.length) lines.push('目前逾期（全部）' + R.overdue.length + ' 件');
  if(R.noDue.length) lines.push('另有 ' + R.noDue.length + ' 項未完成任務沒有到期日');
  lines.push('工時 ' + fmtNum(R.totalHours) + ' 小時（' + R.hourDays + ' 天）｜會議 ' + R.meetings.length + ' 場｜行動項 ' + R.aiDone + '/' + R.aiTotal);

  if(R.done.length){
    lines.push('');
    lines.push('【已完成任務】');
    R.done.forEach(function(x){
      lines.push('- ' + x.title + '（' + (projName(x.projectId) || '無專案') + '）' + (x.completedAt ? ' ' + fmtMD(x.completedAt) : ''));
    });
  }
  if(R.openDue.length){
    lines.push('');
    lines.push('【到期未完成】');
    R.openDue.forEach(function(x){
      var od = overdueDays(x.due);
      lines.push('- ' + x.title + '（' + (projName(x.projectId) || '無專案') + '）' + fmtMD(x.due) + (od ? '，逾期 ' + od + ' 天' : ''));
    });
  }
  if(R.meetings.length){
    lines.push('');
    lines.push('【會議】');
    R.meetings.forEach(function(m){
      var its = m.actionItems || [];
      var md = its.filter(function(a){ return a.done; }).length;
      lines.push('- ' + fmtMD(m.date) + ' ' + m.title + (its.length ? '（行動項 ' + md + '/' + its.length + '）' : ''));
    });
  }
  var aiLines = [];
  R.meetings.forEach(function(m){
    (m.actionItems || []).forEach(function(a){
      aiLines.push('- [' + (a.done ? 'x' : ' ') + '] ' + a.text + '（' + m.title + '）');
    });
  });
  if(aiLines.length){
    lines.push('');
    lines.push('【行動項】');
    lines = lines.concat(aiLines);
  }
  if(R.msDone.length){
    lines.push('');
    lines.push('【期間完成里程碑】');
    R.msDone.forEach(function(it){ lines.push('- ' + it.m.title + '（' + it.p.name + '）' + fmtMD(it.m.doneAt)); });
  }
  if(R.msOpen.length){
    lines.push('');
    lines.push('【目前未完成里程碑】');
    R.msOpen.forEach(function(it){ lines.push('- ' + it.m.title + '（' + it.p.name + '）'); });
  }
  if(R.byProject.length){
    lines.push('');
    lines.push('【依專案】');
    R.byProject.forEach(function(p){
      lines.push('- ' + p.name + '：完成 ' + p.done + '／未完成 ' + p.open + '／工時 ' + fmtNum(p.hours));
    });
  }
  return lines.join('\n');
}
function fallbackCopy(text, msg, title){
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  var ok = false;
  try{ ok = document.execCommand('copy'); }catch(e){}
  ta.remove();
  if(ok) toast(msg || '已複製工作報表摘要');
  else showCopyModal(text, title);
}
function showCopyModal(text, title){
  openModal('<div class="modal" style="max-width:640px">' +
    '<div class="modal-h">' + esc(title || '工作報表摘要') + '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b"><p class="kbd-note" style="margin-top:0">瀏覽器不允許自動複製，請全選下面文字後按 Ctrl+C（Mac：⌘C）。</p>' +
      '<textarea rows="14" readonly data-autofocus>' + esc(text) + '</textarea></div>' +
    '<div class="modal-f"><div class="spacer"></div><button type="button" class="btn btn-ghost" data-action="close-modal">關閉</button></div>' +
  '</div>');
  var ta = $('#modal-root textarea');
  if(ta) setTimeout(function(){ ta.focus(); ta.select(); }, 30);
}
function copyReportSummary(){
  var text = reportSummaryText(buildReport());
  if(navigator.clipboard && navigator.clipboard.writeText){
    try{
      navigator.clipboard.writeText(text).then(function(){ toast('已複製工作報表摘要'); }, function(){ fallbackCopy(text); });
      return;
    }catch(e){}
  }
  fallbackCopy(text);
}
function csvCell(v){
  return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
}
function downloadText(filename, text, mime){
  var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}
function exportReportCSV(){
  var R = buildReport();
  var rows = [['類型','專案','名稱','狀態','日期','到期日','完成日','備註']];
  R.done.forEach(function(x){
    rows.push(['任務', projName(x.projectId) || '（無專案）', x.title, '完成', x.completedAt || '', x.due || '', x.completedAt || '', x.note || '']);
  });
  R.openDue.forEach(function(x){
    rows.push(['任務', projName(x.projectId) || '（無專案）', x.title, ST[x.status] || '', x.due || '', x.due || '', '', x.note || '']);
  });
  R.meetings.forEach(function(m){
    rows.push(['會議', '', m.title, meetingStatus(m), m.date, '', '', [m.time, m.location].filter(function(v){ return v; }).join(' ')]);
  });
  R.meetings.forEach(function(m){
    (m.actionItems || []).forEach(function(a){
      rows.push(['行動項', '', a.text, a.done ? '完成' : '未完成', m.date, '', a.doneAt || '', '會議：' + m.title]);
    });
  });
  R.msDone.forEach(function(it){
    rows.push(['里程碑', it.p.name, it.m.title, '完成', it.m.doneAt || '', '', it.m.doneAt || '', '期間完成']);
  });
  R.msOpen.forEach(function(it){
    rows.push(['里程碑', it.p.name, it.m.title, '未完成', '', '', '', '目前未完成（全部專案）']);
  });
  R.hours.forEach(function(x){
    rows.push(['工時', projName(x.projectId) || '（無專案）', x.note || '工時紀錄', '', x.date, '', '', x.hours + ' 小時']);
  });
  var csv = '\uFEFF' + rows.map(function(row){ return row.map(csvCell).join(','); }).join('\r\n');
  var name = '工作報表_' + R.range.mode + '_' + R.range.start + (R.range.end !== R.range.start ? '_' + R.range.end : '') + '.csv';
  downloadText(name, csv, 'text/csv;charset=utf-8');
  toast('已匯出 CSV');
}

/* ================= 渲染：設定 ================= */
function renderSettings(){
  var h = '';
  h += syncCardHTML();
  h += '<div class="card appearance-card" style="margin-bottom:14px"><div class="card-h">外觀</div><div class="card-b">';
  h += '<label class="mini-label">主題</label>';
  h += '<div class="seg wide">' + [['system','系統'],['light','淺色'],['dark','深色']].map(function(o){
    return '<button type="button" class="' + (themeMode === o[0] ? 'on' : '') + '" data-mode="' + o[0] + '">' + o[1] + '</button>';
  }).join('') + '</div>';
  h += '<label class="mini-label" style="margin-top:14px">主色</label>';
  h += '<div class="swatches big">' + [['orange','橙'],['blue','藍'],['teal','青綠'],['violet','紫'],['graphite','石墨']].map(function(o){
    return '<button type="button" class="sw' + (accent === o[0] ? ' on' : '') + '" data-accent="' + o[0] + '" title="' + o[1] + '"></button>';
  }).join('') + '</div>';
  h += '</div></div>';
  h += '<div class="grid-eq">';
  h += '<div class="card"><div class="card-h">資料管理</div><div class="card-b">';
  h += '<p class="kbd-note" style="margin-top:0">資料儲存在這台電腦的瀏覽器（localStorage）。建議定期匯出備份；換裝置時用匯入還原。也可以直接把 JSON 檔拖進這個頁面匯入。</p>';
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap">';
  h += '<button type="button" class="btn btn-ghost" data-action="export-json">匯出 JSON</button>';
  h += '<button type="button" class="btn btn-ghost" data-action="import-json">匯入 JSON</button>';
  h += '</div>';
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">';
  h += '<button type="button" class="btn btn-ghost" data-action="seed-demo">載入示範資料</button>';
  h += '<button type="button" class="btn btn-danger" data-action="clear-all">清除所有資料</button>';
  h += '</div>';
  h += '<input type="file" id="import-file" accept=".json,application/json" class="hide">';
  h += '</div></div>';
  h += '<div class="stack">';
  h += '<div class="card"><div class="card-h">整合（規劃中）</div>';
  h += '<div class="prow">GitHub 專案 <span class="dim">顯示 issue、PR 狀態</span><span class="pill p-low push">v1.8</span></div>';
  h += '<div class="prow">Google Calendar <span class="dim">同步行程</span><span class="pill p-low push">v2</span></div>';
  h += '<div class="prow">Outlook / 信件 <span class="dim">摘要與待辦萃取</span><span class="pill p-low push">v2</span></div>';
  h += '</div>';
  h += '<div class="card"><div class="card-h">關於</div><div class="card-b">';
  h += '<p class="kbd-note" style="margin:0 0 8px">工作儀錶板 v1.7・純前端、無依賴・支援登入權限、AI 工作區、多日私人行程、Supabase 雲端同步與 Telegram 按鈕收集</p>';
  h += '<p class="kbd-note" style="margin:0">部署：將此資料夾上傳到 GitHub repo，開啟 Pages（main / root）即可上線，詳見 README.md。</p>';
  h += '</div></div>';
  h += '</div></div>';
  $('#view-settings').innerHTML = h;
  updateSyncUI();
}

/* ================= 全域渲染 ================= */
function render(){
  renderOverview();
  renderTasks();
  renderProjects();
  renderMeetings();
  renderDocs();
  renderFun();
  renderStats();
  renderSettings();
  var t = today();
  $('#today-label').textContent = parseD(t).getFullYear() + ' 年 ' + (parseD(t).getMonth() + 1) + ' 月 ' + parseD(t).getDate() + ' 日（週' + wdName(t) + '）';
}

/* ================= 彈窗：任務 ================= */
function openTaskModal(id){
  var t = id ? findTask(id) : null;
  if(id && !t) return;
  var isEdit = !!t;
  t = t || { id:'', title:'', status:'todo', priority:'mid', due: today(), projectId:'', note:'' };
  var h = '<form class="modal" data-form="task" data-id="' + t.id + '">' +
    '<div class="modal-h"><span>' + (isEdit ? '編輯任務' : '新增任務') +
      (isMCPTask(t) ? ' ' + mcpBadge(t, 'MCP 交辦 · ' + mcpSender(t)) : '') +
      '</span><button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<div class="field"><label>標題</label><input name="title" data-autofocus value="' + esc(t.title) + '" placeholder="要完成的事…"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>專案</label><select name="projectId"><option value="">（無專案）</option>' +
          state.projects.map(function(p){ return '<option value="' + p.id + '"' + (p.id === t.projectId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>到期日</label><input type="date" name="due" value="' + (t.due || '') + '"></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>狀態</label>' + segHTML('status', t.status, [['todo','待辦'],['doing','進行中'],['done','完成']]) + '</div>' +
        '<div class="field"><label>優先級</label>' + segHTML('priority', t.priority, [['high','高'],['mid','中'],['low','低']]) + '</div>' +
      '</div>' +
      '<div class="field" style="margin-bottom:0"><label>備註</label><textarea name="note" rows="3" placeholder="補充說明（選填）">' + esc(t.note) + '</textarea></div>' +
    '</div>' +
    '<div class="modal-f">' +
      (isEdit ? '<button type="button" class="btn btn-danger" data-action="del-task" data-id="' + t.id + '">刪除</button>' : '') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button type="submit" class="btn btn-primary">儲存</button>' +
    '</div>' +
  '</form>';
  openModal(h);
}
function saveTaskForm(f){
  var title = f.elements['title'].value.trim();
  if(!title){ toast('請輸入標題'); return; }
  var data = {
    title: title,
    status: f.elements['status'].value,
    priority: f.elements['priority'].value,
    due: f.elements['due'].value || null,
    projectId: f.elements['projectId'].value || null,
    note: f.elements['note'].value.trim()
  };
  var id = f.dataset.id;
  if(id){
    var t = findTask(id);
    if(!t) return;
    var wasDone = t.status === 'done';
    Object.keys(data).forEach(function(k){ t[k] = data[k]; });
    if(t.status === 'done' && !wasDone) t.completedAt = today();
    if(t.status !== 'done') t.completedAt = null;
  } else {
    state.tasks.push({
      id: uid(), title: data.title, status: data.status, priority: data.priority,
      due: data.due, projectId: data.projectId, note: data.note,
      createdAt: today(), completedAt: data.status === 'done' ? today() : null
    });
  }
  saveState(); render(); closeModal(); toast(isEditText(id) ? '已更新任務' : '已新增任務');
}
function isEditText(id){ return !!id; }
function delTask(id){
  confirmBox('確定要刪除這個任務嗎？', function(){
    state.tasks = state.tasks.filter(function(x){ return x.id !== id; });
    state.meetings.forEach(function(m){
      (m.actionItems || []).forEach(function(a){ if(a.convertedTaskId === id) a.convertedTaskId = null; });
    });
    saveState(); render(); closeModal(); toast('已刪除任務');
  });
}

/* ================= 彈窗：AI 工作區 ================= */
function aiHistoryHTML(t){
  var items = (t.history || []).slice(-6).reverse();
  if(!items.length) return '';
  return '<div class="ai-history"><div class="mini-label">最近更新</div>' + items.map(function(x){
    var when = x.at ? relTime(x.at) : '';
    return '<div class="ai-history-row"><span>' + esc(AI_ST[x.status] || x.status) + ' · ' + aiClamp(x.progress) + '%</span>' +
      '<span class="dim">' + esc(when) + '</span>' +
      (x.note ? '<div class="ai-history-note">' + esc(x.note) + '</div>' : '') + '</div>';
  }).join('') + '</div>';
}
function openAITaskModal(id){
  var t = id ? findAITask(id) : null;
  if(id && !t) return;
  var isEdit = !!t;
  t = t || { id:'', title:'', instruction:'', status:'todo', progress:0, priority:'mid', owner:'AI Agent', due:today(), waitingFor:'', result:'', history:[] };
  var statusOpts = AI_STATUSES.map(function(s){
    return '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + AI_ST[s] + '</option>';
  }).join('');
  var priOpts = ['high','mid','low'].map(function(p){
    return '<option value="' + p + '"' + (t.priority === p ? ' selected' : '') + '>' + PRI[p] + '</option>';
  }).join('');
  var h = '<form class="modal ai-modal" data-form="ai" data-id="' + esc(t.id) + '">' +
    '<div class="modal-h">' + (isEdit ? '編輯 AI 任務' : '新增 AI 任務') +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<p class="kbd-note" style="margin:0 0 12px">任務會同步到 AI 工作區；Agent 可讀取與更新狀態、進度與結果。</p>' +
      '<div class="field"><label>標題</label><input name="title" data-autofocus value="' + esc(t.title) + '" placeholder="例如：整理本週會議逐字稿"></div>' +
      '<div class="field"><label>給 AI 的指示</label><textarea name="instruction" rows="3" placeholder="背景、輸入資料、期望輸出、限制條件…">' + esc(t.instruction) + '</textarea></div>' +
      '<div class="row3">' +
        '<div class="field"><label>狀態</label><select name="status">' + statusOpts + '</select></div>' +
        '<div class="field"><label>優先級</label><select name="priority">' + priOpts + '</select></div>' +
        '<div class="field"><label>進度（0–100）</label><input type="number" name="progress" min="0" max="100" step="5" value="' + aiClamp(t.progress) + '"></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>負責 Agent</label><input name="owner" value="' + esc(t.owner) + '" placeholder="AI Agent"></div>' +
        '<div class="field"><label>到期日</label><input type="date" name="due" value="' + esc(t.due || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>等待確認原因</label><textarea name="waitingFor" rows="2" placeholder="需要人工確認的事項（選填）">' + esc(t.waitingFor) + '</textarea></div>' +
      '<div class="field"><label>完成結果</label><textarea name="result" rows="3" placeholder="Agent 完成後回報的成果（選填）">' + esc(t.result) + '</textarea></div>' +
      (isEdit ? '<div class="field"><label>本次更新備註（會寫入紀錄）</label><input name="logNote" placeholder="例如：完成資料蒐集"></div>' : '') +
      (isEdit ? aiHistoryHTML(t) : '') +
    '</div>' +
    '<div class="modal-f">' +
      (isEdit ? '<button type="button" class="btn btn-danger" data-action="del-ai-task" data-id="' + esc(t.id) + '">刪除</button>' : '') +
      '<span style="margin-left:auto"></span>' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button type="submit" class="btn btn-primary">' + (isEdit ? '儲存' : '新增') + '</button>' +
    '</div>' +
  '</form>';
  openModal(h);
}
function saveAIForm(f){
  var id = f.dataset.id;
  var data = {
    title: f.elements['title'].value.trim(),
    instruction: f.elements['instruction'].value.trim(),
    status: f.elements['status'].value,
    priority: f.elements['priority'].value,
    progress: +f.elements['progress'].value,
    owner: f.elements['owner'].value.trim(),
    due: f.elements['due'].value || null,
    waitingFor: f.elements['waitingFor'].value.trim(),
    result: f.elements['result'].value.trim()
  };
  if(!data.title){ toast('請輸入標題'); return; }
  if(data.status === 'done') data.progress = 100;
  if(data.status === 'todo') data.progress = 0;
  var note = f.elements['logNote'] ? f.elements['logNote'].value.trim() : '';
  if(id){
    var t = findAITask(id);
    if(!t) return;
    aiPatch(t, data, note || '手動更新');
  } else {
    state.aiTasks.push(aiCreate({ title:data.title, instruction:data.instruction, status:data.status, priority:data.priority, progress:data.progress, owner:data.owner, due:data.due, waitingFor:data.waitingFor, result:data.result, logNote:note || '建立 AI 任務' }));
  }
  saveState(); render(); closeModal(); toast(id ? '已更新 AI 任務' : '已新增 AI 任務');
}
function delAITask(id){
  confirmBox('確定要刪除這個 AI 任務嗎？', function(){
    state.aiTasks = state.aiTasks.filter(function(x){ return x.id !== id; });
    saveState(); render(); closeModal(); toast('已刪除 AI 任務');
  });
}
function setAIStatus(id, status){
  var t = findAITask(id);
  if(!t || !AI_ST[status] || t.status === status) return;
  var patch = { status:status };
  if(status === 'doing' && t.status === 'todo' && t.progress === 0) patch.progress = 10;
  aiPatch(t, patch, '狀態改為「' + AI_ST[status] + '」');
  saveState(); render(); toast('已移至「' + AI_ST[status] + '」');
}
function openAIUpdateModal(){
  var exampleId = state.aiTasks[0] ? state.aiTasks[0].id : 'ai_task_id';
  var ph = '[{"id":"' + exampleId + '","status":"doing","progress":40,"note":"已開始處理"},{"id":"...","status":"done","progress":100,"result":"已完成"}]';
  var h = '<form class="modal ai-modal" data-form="ai-update">' +
    '<div class="modal-h">套用 Agent 更新<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<p class="kbd-note" style="margin:0 0 10px">貼上 Agent 回傳的 JSON 陣列。可用 <code>id</code> 更新既有任務；沒有 id 但有 <code>title</code> 時會新增任務。</p>' +
      '<div class="field" style="margin-bottom:0"><label>JSON 更新</label><textarea name="payload" rows="12" placeholder="' + esc(ph) + '"></textarea></div>' +
    '</div>' +
    '<div class="modal-f"><span style="margin-left:auto"></span><button type="button" class="btn btn-ghost" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary">套用更新</button></div>' +
  '</form>';
  openModal(h);
}
function aiApplyPayload(raw){
  var data;
  try{ data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch(e){ toast('JSON 格式錯誤'); return null; }
  var list = Array.isArray(data) ? data : (data && Array.isArray(data.updates) ? data.updates : (data && Array.isArray(data.aiTasks) ? data.aiTasks : (data && Array.isArray(data.tasks) ? data.tasks : null)));
  if(!list){ toast('請提供 JSON 陣列或 updates 陣列'); return null; }
  var updated = 0, added = 0;
  list.forEach(function(u){
    if(!u || typeof u !== 'object') return;
    var t = u.id ? findAITask(u.id) : null;
    if(t){ aiPatch(t, u, u.note || 'Agent 更新'); updated++; }
    else if(u.title){ state.aiTasks.push(aiCreate(u)); added++; }
  });
  if(!updated && !added){ toast('沒有可套用的更新'); return null; }
  saveState(); render();
  return { updated:updated, added:added };
}
function applyAIUpdateForm(f){
  var res = aiApplyPayload(f.elements['payload'].value.trim());
  if(!res) return;
  closeModal();
  toast('已套用 ' + res.updated + ' 筆更新' + (res.added ? '、新增 ' + res.added + ' 筆' : ''));
}
function copyText(text, msg){
  if(navigator.clipboard && navigator.clipboard.writeText){
    try{
      navigator.clipboard.writeText(text).then(function(){ toast(msg); }, function(){ fallbackCopy(text, msg, '複製內容'); });
      return;
    }catch(e){}
  }
  fallbackCopy(text, msg, '複製內容');
}
function copyAIJSON(){ copyText(aiJSON(), '已複製 AI 待辦 JSON'); }
function copyAIPrompt(){ copyText(aiPromptText(), '已複製 Agent 指令'); }

/* ================= 彈窗：專案 ================= */
function openProjectModal(id){
  var p = id ? findProject(id) : null;
  if(id && !p) return;
  var isEdit = !!p;
  p = p || { id:'', name:'', desc:'', milestones:[] };
  var msText = (p.milestones || []).map(function(m){ return m.title; }).join('\n');
  var h = '<form class="modal" data-form="project" data-id="' + p.id + '">' +
    '<div class="modal-h">' + (isEdit ? '編輯專案' : '新增專案') +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<div class="field"><label>名稱</label><input name="name" data-autofocus value="' + esc(p.name) + '" placeholder="專案名稱"></div>' +
      '<div class="field"><label>說明</label><input name="desc" value="' + esc(p.desc || '') + '" placeholder="一句話描述（選填）"></div>' +
      '<div class="field" style="margin-bottom:0"><label>里程碑（一行一個）</label><textarea name="milestones" rows="4" placeholder="簡章定稿\n報名表單上線\n宣傳開跑">' + esc(msText) + '</textarea></div>' +
    '</div>' +
    '<div class="modal-f">' +
      (isEdit ? '<button type="button" class="btn btn-danger" data-action="del-project" data-id="' + p.id + '">刪除</button>' : '') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button type="submit" class="btn btn-primary">儲存</button>' +
    '</div>' +
  '</form>';
  openModal(h);
}
function saveProjectForm(f){
  var name = f.elements['name'].value.trim();
  if(!name){ toast('請輸入專案名稱'); return; }
  var desc = f.elements['desc'].value.trim();
  var lines = f.elements['milestones'].value.split('\n').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
  var id = f.dataset.id;
  var old = id ? findProject(id) : null;
  var oldMs = old ? (old.milestones || []) : [];
  var ms = lines.map(function(title){
    var prev = null;
    for(var i = 0; i < oldMs.length; i++){ if(oldMs[i].title === title) prev = oldMs[i]; }
    return { title: title, done: prev ? !!prev.done : false, doneAt: prev && prev.done ? (prev.doneAt || null) : null };
  });
  if(old){
    old.name = name; old.desc = desc; old.milestones = ms;
  } else {
    state.projects.push({ id: uid(), name: name, desc: desc, milestones: ms, createdAt: today() });
  }
  saveState(); render(); closeModal(); toast(old ? '已更新專案' : '已新增專案');
}
function delProject(id){
  confirmBox('刪除專案不會刪除其任務，只會解除關聯。確定嗎？', function(){
    state.projects = state.projects.filter(function(p){ return p.id !== id; });
    state.tasks.forEach(function(t){ if(t.projectId === id) t.projectId = null; });
    state.hours.forEach(function(x){ if(x.projectId === id) x.projectId = null; });
    saveState(); render(); closeModal(); toast('已刪除專案');
  });
}

/* ================= 彈窗：會議 ================= */
function openMeetingModal(id, presetDate){
  var m = id ? findMeeting(id) : null;
  if(id && !m) return;
  var isEdit = !!m;
  m = m || { id:'', title:'', date: presetDate || today(), time:'', location:'', attendees:'', notes:'', actionItems: [] };
  var h = '<form class="modal" data-form="meeting" data-id="' + m.id + '">' +
    '<div class="modal-h">' + (isEdit ? '編輯會議' : '新增會議') +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<div class="field"><label>標題</label><input name="title" data-autofocus value="' + esc(m.title) + '" placeholder="會議名稱"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>日期</label><input type="date" name="date" value="' + (m.date || '') + '"></div>' +
        '<div class="field"><label>時間</label><input type="time" name="time" value="' + (m.time || '') + '"></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>地點</label><input name="location" value="' + esc(m.location || '') + '" placeholder="會議室 / 線上"></div>' +
        '<div class="field"><label>參與者</label><input name="attendees" value="' + esc(m.attendees || '') + '" placeholder="5 人 / 名單"></div>' +
      '</div>' +
      '<div class="field"><label>備註</label><textarea name="notes" rows="2" placeholder="議程、決議、重點…">' + esc(m.notes || '') + '</textarea></div>' +
      '<div class="field" style="margin-bottom:0"><label>行動項' + (isEdit ? '（可一鍵轉為任務）' : '（儲存後即可管理）') + '</label>' +
        (isEdit ? '<div id="meet-actions" data-mid="' + m.id + '">' + actionsInner(m) + '</div>' : '<div class="dim">建立會議後，可以逐項追蹤並轉成任務。</div>') +
      '</div>' +
    '</div>' +
    '<div class="modal-f">' +
      (isEdit ? '<button type="button" class="btn btn-danger" data-action="del-meeting" data-id="' + m.id + '">刪除</button>' : '') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button type="submit" class="btn btn-primary">儲存</button>' +
    '</div>' +
  '</form>';
  openModal(h);
}
function actionsInner(m){
  var h = '';
  if(!m.actionItems.length){
    h += '<div class="dim" style="padding:4px 0">還沒有行動項</div>';
  } else {
    m.actionItems.forEach(function(a){
      h += '<div class="aitem">' +
        '<span class="check' + (a.done ? ' done' : '') + '" data-action="ai-toggle" data-mid="' + m.id + '" data-ai="' + a.id + '"></span>' +
        '<span class="ai-text' + (a.done ? ' done' : '') + '">' + esc(a.text) + '</span>' +
        (a.convertedTaskId
          ? '<span class="pill p-done" style="cursor:pointer" data-action="open-task" data-id="' + a.convertedTaskId + '" title="查看任務">已轉任務</span>'
          : '<button type="button" class="chip" data-action="ai-convert" data-mid="' + m.id + '" data-ai="' + a.id + '">轉任務</button>') +
        '<button type="button" class="ibtn" data-action="ai-del" data-mid="' + m.id + '" data-ai="' + a.id + '" title="刪除">✕</button>' +
      '</div>';
    });
  }
  h += '<div class="ai-add"><input id="ai-new" placeholder="新增行動項…"><button type="button" class="btn btn-ghost" data-action="ai-add" data-mid="' + m.id + '">新增</button></div>';
  return h;
}
function refreshActions(mid){
  var c = $('#meet-actions');
  if(c && c.dataset.mid === mid){
    var m = findMeeting(mid);
    if(m) c.innerHTML = actionsInner(m);
  }
}
function saveMeetingForm(f){
  var title = f.elements['title'].value.trim();
  if(!title){ toast('請輸入會議標題'); return; }
  if(!f.elements['date'].value){ toast('請選擇日期'); return; }
  var data = {
    title: title,
    date: f.elements['date'].value,
    time: f.elements['time'].value,
    location: f.elements['location'].value.trim(),
    attendees: f.elements['attendees'].value.trim(),
    notes: f.elements['notes'].value.trim()
  };
  var id = f.dataset.id;
  if(id){
    var m = findMeeting(id);
    if(!m) return;
    Object.keys(data).forEach(function(k){ m[k] = data[k]; });
  } else {
    state.meetings.push({
      id: uid(), title: data.title, date: data.date, time: data.time,
      location: data.location, attendees: data.attendees, notes: data.notes, actionItems: []
    });
  }
  saveState(); render(); closeModal(); toast(id ? '已更新會議' : '已新增會議');
}
function delMeeting(id){
  confirmBox('確定要刪除這場會議嗎？行動項會一併刪除（已轉出的任務不受影響）。', function(){
    state.meetings = state.meetings.filter(function(m){ return m.id !== id; });
    saveState(); render(); closeModal(); toast('已刪除會議');
  });
}

/* ================= 彈窗：私人行程 ================= */
function openEventModal(id, presetDate){
  var ev = id ? findEvent(id) : null;
  if(id && !ev) return;
  var isEdit = !!ev;
  ev = ev || { id:'', title:'', date: presetDate || today(), endDate:'', time:'', location:'', note:'' };
  var h = '<form class="modal" data-form="event" data-id="' + ev.id + '">' +
    '<div class="modal-h">' + (isEdit ? '編輯私人行程' : '新增私人行程') +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<div class="field"><label>標題</label><input name="title" data-autofocus value="' + esc(ev.title) + '" placeholder="例如：牙醫回診、接送小孩"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>開始日期</label><input type="date" name="date" value="' + (ev.date || '') + '"></div>' +
        '<div class="field"><label>結束日期 <span class="cnt">（選填）</span></label><input type="date" name="endDate" value="' + (ev.endDate || '') + '"></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>時間 <span class="cnt">（留空＝全天）</span></label><input type="time" name="time" value="' + (ev.time || '') + '"></div>' +
        '<div class="field"><label>地點（選填）</label><input name="location" value="' + esc(ev.location || '') + '" placeholder="診所、學校、餐廳…"></div>' +
      '</div>' +
      '<div class="field"><label>備註（選填）</label><textarea name="note" rows="3" placeholder="要帶的東西、聯絡方式…">' + esc(ev.note || '') + '</textarea></div>' +
      '<div class="kbd-note">多日行程會在行事曆的每一天顯示綠點；私人行程不列入工作報表。</div>' +
    '</div>' +
    '<div class="modal-f">' +
      (isEdit ? '<button type="button" class="btn btn-danger" data-action="del-event" data-id="' + ev.id + '">刪除</button>' : '') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button type="submit" class="btn btn-primary">儲存</button>' +
    '</div>' +
  '</form>';
  openModal(h);
}
function saveEventForm(f){
  var title = f.elements['title'].value.trim();
  if(!title){ toast('請輸入行程標題'); return; }
  var date = f.elements['date'].value;
  var endDate = f.elements['endDate'].value;
  if(!date){ toast('請選擇開始日期'); return; }
  if(endDate && endDate < date){ toast('結束日期不能早於開始日期'); return; }
  var data = {
    title: title,
    date: date,
    endDate: endDate && endDate > date ? endDate : '',
    time: f.elements['time'].value,
    location: f.elements['location'].value.trim(),
    note: f.elements['note'].value.trim()
  };
  var id = f.dataset.id;
  if(id){
    var ev = findEvent(id);
    if(!ev) return;
    Object.keys(data).forEach(function(k){ ev[k] = data[k]; });
  } else {
    state.events.push({
      id: uid(), title: data.title, date: data.date, endDate: data.endDate, time: data.time,
      location: data.location, note: data.note, createdAt: today()
    });
  }
  saveState(); render(); closeModal(); toast(id ? '已更新私人行程' : '已新增私人行程');
}
function delEvent(id){
  confirmBox('確定要刪除這個私人行程嗎？', function(){
    state.events = state.events.filter(function(ev){ return ev.id !== id; });
    saveState(); render(); closeModal(); toast('已刪除私人行程');
  });
}
function aiToggle(mid, aid){
  var m = findMeeting(mid); if(!m) return;
  var a = null;
  m.actionItems.forEach(function(x){ if(x.id === aid) a = x; });
  if(!a) return;
  a.done = !a.done;
  a.doneAt = a.done ? today() : null;
  saveState(); refreshActions(mid); render();
}
function aiDel(mid, aid){
  confirmBox('刪除這個行動項？', function(){
    var m = findMeeting(mid); if(!m) return;
    m.actionItems = m.actionItems.filter(function(x){ return x.id !== aid; });
    saveState(); refreshActions(mid); render(); toast('已刪除行動項');
  });
}
function aiAdd(mid){
  var m = findMeeting(mid); if(!m) return;
  var inp = $('#ai-new'); if(!inp) return;
  var text = inp.value.trim();
  if(!text) return;
  m.actionItems.push({ id: uid(), text: text, done: false, doneAt: null, convertedTaskId: null });
  saveState(); refreshActions(mid); render();
}
function aiConvert(mid, aid){
  var m = findMeeting(mid); if(!m) return;
  var a = null;
  m.actionItems.forEach(function(x){ if(x.id === aid) a = x; });
  if(!a || a.convertedTaskId) return;
  var task = {
    id: uid(), title: a.text, status: 'todo', priority: 'mid', due: today(), projectId: null,
    note: '來自會議：' + m.title + '（' + fmtMD(m.date) + '）',
    createdAt: today(), completedAt: null
  };
  state.tasks.push(task);
  a.convertedTaskId = task.id;
  saveState(); refreshActions(mid); render(); toast('已轉為任務');
}

/* ================= 彈窗：文件 ================= */
function openDocModal(id){
  var d = id ? findDoc(id) : null;
  if(id && !d) return;
  var isEdit = !!d;
  d = d || { id:'', title:'', url:'', tags:[], note:'' };
  var h = '<form class="modal" data-form="doc" data-id="' + d.id + '">' +
    '<div class="modal-h">' + (isEdit ? '編輯文件' : '新增文件') +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<div class="field"><label>標題</label><input name="title" data-autofocus value="' + esc(d.title) + '" placeholder="文件或連結名稱"></div>' +
      '<div class="field"><label>連結</label><input name="url" value="' + esc(d.url || '') + '" placeholder="https://…（選填）"></div>' +
      '<div class="field"><label>標籤（以逗號分隔）</label><input name="tags" value="' + esc((d.tags || []).join(', ')) + '" placeholder="招生, 文件"></div>' +
      '<div class="field" style="margin-bottom:0"><label>備註</label><textarea name="note" rows="3" placeholder="摘要、重點（選填）">' + esc(d.note || '') + '</textarea></div>' +
    '</div>' +
    '<div class="modal-f">' +
      (isEdit ? '<button type="button" class="btn btn-danger" data-action="del-doc" data-id="' + d.id + '">刪除</button>' : '') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button type="submit" class="btn btn-primary">儲存</button>' +
    '</div>' +
  '</form>';
  openModal(h);
}
function saveDocForm(f){
  var title = f.elements['title'].value.trim();
  if(!title){ toast('請輸入標題'); return; }
  var tags = f.elements['tags'].value.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
  var data = { title: title, url: f.elements['url'].value.trim(), tags: tags, note: f.elements['note'].value.trim() };
  var id = f.dataset.id;
  if(id){
    var d = findDoc(id);
    if(!d) return;
    Object.keys(data).forEach(function(k){ d[k] = data[k]; });
  } else {
    state.docs.push({ id: uid(), title: data.title, url: data.url, tags: data.tags, note: data.note, createdAt: today() });
  }
  saveState(); render(); closeModal(); toast(id ? '已更新文件' : '已新增文件');
}
function delDoc(id){
  confirmBox('確定要刪除這份文件嗎？', function(){
    state.docs = state.docs.filter(function(d){ return d.id !== id; });
    saveState(); render(); closeModal(); toast('已刪除文件');
  });
}

/* ================= 彈窗：摸魚區連結 ================= */
function openLinkModal(id){
  var l = id ? findLink(id) : null;
  if(id && !l) return;
  var isEdit = !!l;
  l = l || { id:'', title:'', url:'', note:'' };
  var h = '<form class="modal" data-form="link" data-id="' + l.id + '">' +
    '<div class="modal-h">' + (isEdit ? '編輯連結' : '新增連結') +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
    '<div class="modal-b">' +
      '<div class="field"><label>名稱</label><input name="title" data-autofocus value="' + esc(l.title) + '" placeholder="例如：YouTube"></div>' +
      '<div class="field"><label>網址</label><input name="url" value="' + esc(l.url) + '" placeholder="https://…（只貼網域也可以）"></div>' +
      '<div class="field" style="margin-bottom:0"><label>備註（選填）</label><textarea name="note" rows="2" placeholder="為什麼放在這裡…">' + esc(l.note) + '</textarea></div>' +
    '</div>' +
    '<div class="modal-f">' +
      (isEdit ? '<button type="button" class="btn btn-danger" data-action="del-link" data-id="' + l.id + '">刪除</button>' : '') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button type="submit" class="btn btn-primary">儲存</button>' +
    '</div>' +
  '</form>';
  openModal(h);
}
function saveLinkForm(f){
  var title = f.elements['title'].value.trim();
  var url = normUrl(f.elements['url'].value);
  if(!title){ toast('請輸入名稱'); return; }
  if(!url){ toast('請輸入網址'); return; }
  if(!urlHost('' + url)){ toast('網址格式看起來不對，請確認'); return; }
  var note = f.elements['note'].value.trim();
  var id = f.dataset.id;
  if(id){
    var l = findLink(id);
    if(!l) return;
    l.title = title; l.url = url; l.note = note;
  } else {
    state.links.push({ id: uid(), title: title, url: url, note: note, createdAt: today() });
  }
  saveState(); render(); closeModal(); toast(id ? '已更新連結' : '已新增連結');
}
function delLink(id){
  confirmBox('確定要刪除這個連結嗎？', function(){
    state.links = state.links.filter(function(l){ return l.id !== id; });
    saveState(); render(); closeModal(); toast('已刪除連結');
  });
}

/* ================= 設定：匯入 / 匯出 ================= */
function exportJSON(){
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'work-dashboard-' + today() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  toast('已匯出 JSON');
}
function importFile(file){
  if(!file) return;
  var r = new FileReader();
  r.onload = function(){
    var obj = null;
    try{ obj = JSON.parse(r.result); }catch(e){}
    if(!obj || typeof obj !== 'object' || !Array.isArray(obj.tasks) || !Array.isArray(obj.projects)){
      toast('匯入失敗：檔案格式不正確');
      return;
    }
    confirmBox('匯入會覆蓋目前所有資料，確定嗎？', function(){
      state = normalize(obj);
      saveState(); render(); toast('已匯入資料');
    });
  };
  r.readAsText(file);
}

/* ================= 雲端同步（Supabase 免費版） ================= */
var syncCfg = loadSync();
var pushTimer = null;
var applyingCloud = false;

function loadSync(){
  var d = { url:'', anonKey:'', docId:'', autoPush:false, autoPull:true, lastSyncAt:null, lastPushAt:null, lastPullAt:null, cloudUpdatedAt:undefined };
  try{
    var raw = localStorage.getItem(LS_SYNC);
    if(raw){
      var o = JSON.parse(raw);
      for(var k in d){ if(o[k] !== undefined) d[k] = o[k]; }
    }
  }catch(e){}
  return d;
}
function saveSyncCfg(){
  try{ localStorage.setItem(LS_SYNC, JSON.stringify(syncCfg)); }catch(e){}
}
function sbReady(){ return !!(syncCfg.url && syncCfg.anonKey && syncCfg.docId); }
function sbBase(){
  return String(syncCfg.url).trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/+$/, '');
}
function sbKey(){ return String(syncCfg.anonKey).trim(); }
function sbHeaders(){
  /* 瀏覽器只帶 apikey；登入使用者的 access token 由 WDAuth.fetch 加上
     Authorization: Bearer <access_token>。不要把 anon key 當成登入身份。 */
  return { 'apikey': sbKey(), 'Content-Type': 'application/json' };
}
function sbFetch(url, options){
  if(window.WDAuth && typeof window.WDAuth.fetch === 'function'){
    return window.WDAuth.fetch(url, options);
  }
  return fetch(url, options);
}
function syncCfgFromInputs(){
  var u = $('#sync-url'), k = $('#sync-key'), d = $('#sync-doc');
  if(u) syncCfg.url = u.value.trim();
  if(k) syncCfg.anonKey = k.value.trim();
  if(d) syncCfg.docId = d.value.trim();
  saveSyncCfg();
}
function syncErrMsg(res, err){
  if(!res && err && /failed to fetch|networkerror|load failed|fetch/i.test(String(err.message || err))){
    return '無法連線（檢查 Project URL 與網路）';
  }
  if(res){
    if(res.status === 401) return '登入已過期或權限不足，請重新登入';
    if(res.status === 403) return '權限不足（確認 dashboard_members 白名單與 RLS 設定）';
    if(res.status === 404) return '找不到資料表或登入函式（請先執行 auth-setup.sql）';
    return 'HTTP ' + res.status;
  }
  return String((err && err.message) || err || '未知錯誤');
}
function sbTest(){
  syncCfgFromInputs();
  if(!sbReady()){ toast('請先完成 Supabase 連線設定，並填入文件金鑰'); return; }
  var statusEl = $('#sync-status');
  function show(msg, isErr){
    if(statusEl){
      statusEl.dataset.msg = '1';
      statusEl.textContent = msg;
      statusEl.style.color = isErr ? 'var(--red)' : 'var(--green)';
    }
  }
  var base = sbBase();
  if(!/^https:\/\//i.test(base)){ show('連線失敗：Project URL 必須以 https:// 開頭', true); toast('Project URL 必須以 https:// 開頭'); return; }
  if(/supabase\.com\/dashboard/i.test(base)){ show('連線失敗：這是 Supabase Dashboard 網址，請改用 Data API 頁的 API URL（https://xxxx.supabase.co）', true); toast('URL 貼成 Dashboard 網址了'); return; }
  show('測試中…', false);
  sbFetch(base + '/rest/v1/dashboards?select=id&limit=1', { headers: sbHeaders() })
    .then(function(r){
      if(!r.ok) return r.text().then(function(txt){ throw { res: r, body: txt }; });
      return r.json();
    })
    .then(function(){ show('連線成功：資料表正常 ✓', false); toast('連線成功，資料表正常'); refreshCloudTime(); })
    .catch(function(err){
      var msg = '連線失敗：' + syncErrMsg(err.res, err);
      if(err && err.res && err.body){
        msg += '（HTTP ' + err.res.status + '，' + String(err.body).replace(/\s+/g, ' ').slice(0, 140) + '）';
      }
      show(msg, true);
      toast('連線失敗：' + syncErrMsg(err.res, err));
    });
}
function pushToCloud(silent){
  if(!sbReady()){ if(!silent) toast('請先完成雲端同步設定'); return; }
  var nowIso = new Date().toISOString();
  sbFetch(sbBase() + '/rest/v1/dashboards', {
    method: 'POST',
    headers: Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ id: syncCfg.docId, payload: state, updated_at: nowIso }])
  })
    .then(function(r){ if(!r.ok) throw { res: r }; })
    .then(function(){
      syncCfg.lastSyncAt = nowIso;
      syncCfg.lastPushAt = nowIso;
      syncCfg.cloudUpdatedAt = nowIso;
      saveSyncCfg(); updateSyncUI();
      if(!silent) toast('已備份到雲端');
    })
    .catch(function(err){ toast('雲端上傳失敗：' + syncErrMsg(err.res, err)); });
}
function applyCloudPayload(remote, silent){
  applyingCloud = true;
  state = normalize(remote.payload);
  saveState(); render();
  applyingCloud = false;
  syncCfg.lastSyncAt = new Date().toISOString();
  syncCfg.cloudUpdatedAt = remote.updated_at || null;
  if(remote.updated_at) syncCfg.lastPullAt = remote.updated_at;
  saveSyncCfg(); updateSyncUI();
  if(!silent) toast('已從雲端載入資料' + (state.aiTasks.length ? '（AI 待辦 ' + state.aiTasks.length + ' 筆，請到任務 → AI 工作區）' : ''));
}
function pullFromCloud(confirmFirst){
  syncCfgFromInputs();
  if(!sbReady()){ toast('請先完成雲端同步設定'); return; }
  sbFetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=payload,updated_at&limit=1', { headers: sbHeaders() })
    .then(function(r){ if(!r.ok) throw { res: r }; return r.json(); })
    .then(function(arr){
      if(!arr || !arr.length){ toast('雲端還沒有資料，先按「備份到雲端」'); return; }
      if(confirmFirst) confirmBox('下載會覆蓋目前本機資料，確定嗎？', function(){ applyCloudPayload(arr[0]); });
      else applyCloudPayload(arr[0]);
    })
    .catch(function(err){ toast('雲端下載失敗：' + syncErrMsg(err.res, err)); });
}
/* 開啟時檢查雲端是否有較新版本 */
function checkCloudNewer(){
  if(!sbReady()) return;
  sbFetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=payload,updated_at&limit=1', { headers: sbHeaders() })
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(arr){
      syncCfg.cloudUpdatedAt = (arr && arr.length) ? (arr[0].updated_at || null) : null;
      saveSyncCfg(); updateSyncUI();
      if(!arr || !arr.length) return;
      var ts = Date.parse(arr[0].updated_at) || 0;
      var localTs = Math.max(state.modifiedAt || 0, Date.parse(syncCfg.lastPushAt || '') || 0);
      if(ts > localTs + 2000){
        confirmBox('雲端有較新的資料（' + fmtDT(arr[0].updated_at) + '），要載入嗎？', function(){ applyCloudPayload(arr[0]); });
      }
    })
    .catch(function(){});
}
function scheduleAutoPush(){
  if(applyingCloud) return;
  if(!syncCfg || !syncCfg.autoPush || !sbReady()) return;
  if(pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(function(){ pushToCloud(true); }, 2500);
}
function fmtDT(iso){
  var d = new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function relTime(iso){
  var t = new Date(iso).getTime();
  if(isNaN(t)) return '';
  var diff = Math.max(0, Date.now() - t);
  var m = Math.floor(diff / 60000);
  if(m < 1) return '剛剛';
  if(m < 60) return m + ' 分鐘前';
  var hrs = Math.floor(m / 60);
  if(hrs < 24) return hrs + ' 小時前';
  return Math.floor(hrs / 24) + ' 天前';
}
function fmtRel(iso){
  var rel = relTime(iso);
  return fmtDT(iso) + (rel ? '（' + rel + '）' : '');
}
function updateSyncUI(){
  var el = $('#sync-status');
  if(el && el.dataset.msg !== '1'){
    el.style.color = '';
    el.textContent = sbReady() ? '已設定：' + urlHost(syncCfg.url) : '尚未完成設定';
  }
  var meta = $('#sync-meta');
  if(!meta) return;
  if(!sbReady()){
    meta.innerHTML = '<div class="m"><span>連線狀態</span><b>尚未完成設定</b></div>';
    return;
  }
  var cloud;
  if(syncCfg.cloudUpdatedAt === null) cloud = '雲端尚無資料';
  else if(syncCfg.cloudUpdatedAt) cloud = fmtRel(syncCfg.cloudUpdatedAt);
  else cloud = '尚未取得';
  var local = (typeof state.modifiedAt === 'number') ? fmtRel(new Date(state.modifiedAt).toISOString()) : '—';
  meta.innerHTML =
    '<div class="m"><span>本機最後修改</span><b>' + local + '</b></div>' +
    '<div class="m"><span>上次上傳／還原</span><b>' + (syncCfg.lastSyncAt ? fmtRel(syncCfg.lastSyncAt) : '尚未同步') + '</b></div>' +
    '<div class="m"><span>雲端最後更新</span><b>' + cloud +
      ' <button type="button" class="ibtn" data-action="sync-meta" title="重新取得雲端時間">↻</button></b></div>';
}
var cloudTimeBusy = false;
function refreshCloudTime(){
  if(!sbReady() || cloudTimeBusy) return;
  cloudTimeBusy = true;
  sbFetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=updated_at&limit=1', { headers: sbHeaders() })
    .then(function(r){ if(!r.ok) throw { res: r }; return r.json(); })
    .then(function(arr){
      syncCfg.cloudUpdatedAt = (arr && arr.length) ? (arr[0].updated_at || null) : null;
      saveSyncCfg();
    })
    .catch(function(){})
    .then(function(){ cloudTimeBusy = false; updateSyncUI(); });
}
var autoPullBusy = false;
var autoPullTimer = null;
var AUTO_PULL_MS = 30000;
function startAutoPull(){
  if(autoPullTimer) clearInterval(autoPullTimer);
  autoPullTimer = setInterval(autoPullTick, AUTO_PULL_MS);
}
function autoPullTick(){
  if(!sbReady() || !syncCfg.autoPull || autoPullBusy) return;
  if(modalRoot.innerHTML) return; // 正在編輯，先不打斷
  var ae = document.activeElement;
  if(ae && ae.closest && ae.closest('#view-settings') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  autoPullBusy = true;
  sbFetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=updated_at&limit=1', { headers: sbHeaders() })
    .then(function(r){ if(!r.ok) throw { res: r }; return r.json(); })
    .then(function(arr){
      if(!arr || !arr.length) return;
      var remoteTs = Date.parse(arr[0].updated_at) || 0;
      var localTs = Math.max(
        state.modifiedAt || 0,
        Date.parse(syncCfg.lastPushAt || '') || 0,
        Date.parse(syncCfg.lastPullAt || '') || 0
      );
      if(remoteTs <= localTs + 2000) return;
      return sbFetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=payload,updated_at&limit=1', { headers: sbHeaders() })
        .then(function(r){ if(!r.ok) throw { res: r }; return r.json(); })
        .then(function(rows){
          if(rows && rows.length){
            applyCloudPayload(rows[0], true);
            toast('已同步雲端變更');
          }
        });
    })
    .catch(function(){})
    .then(function(){ autoPullBusy = false; });
}
function syncCardHTML(){
  var sql = '-- 登入與權限設定請執行 repo 根目錄的 auth-setup.sql\n' +
    '-- 1. 建立 dashboard_members 白名單\n' +
    '-- 2. dashboards 僅限 authenticated 會員存取\n' +
    '-- 3. 收回 anon 對寫入 RPC 的執行權';
  var user = (window.WDAuth && window.WDAuth.getUser) ? window.WDAuth.getUser() : null;
  var email = (user && user.email) ? user.email : '已登入';
  var h = '<div class="card" style="margin-bottom:14px"><div class="card-h">雲端同步（Supabase 免費版）</div><div class="card-b">';
  h += '<div class="sync-account"><div class="who"><span class="dim">登入身份</span><b>' + esc(email) + '</b></div>' +
    '<button type="button" class="btn btn-ghost" data-auth-logout>登出</button></div>';
  h += '<p class="kbd-note" style="margin-top:0">此版本需要登入才能開啟儀錶板與讀寫雲端。不同裝置使用相同 Supabase 專案與文件金鑰，就會共用同一份資料。</p>';
  h += '<p class="kbd-note">Supabase：<b>' + esc(syncCfg.url || '尚未設定') + '</b>（Project URL／anon key 在登入頁設定；變更後請重新登入）</p>';
  h += '<div class="field"><label>文件金鑰（dashboards.id）</label><input id="sync-doc" value="' + esc(syncCfg.docId) + '" placeholder="my-dashboard-8f3k"></div>';
  h += '<p class="kbd-note">不要在瀏覽器填入 service_role / secret key。</p>';
  h += '<div class="sync-opts">' +
    '<label><input type="checkbox" id="sync-auto"' + (syncCfg.autoPush ? ' checked' : '') + '> 每次變更後自動上傳</label>' +
    '<label><input type="checkbox" id="sync-autopull"' + (syncCfg.autoPull !== false ? ' checked' : '') + '> 自動接收雲端變更（每 30 秒，適合 Telegram 新增任務）</label>' +
  '</div>';
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button type="button" class="btn btn-ghost" data-action="sync-test">測試連線</button>' +
    '<button type="button" class="btn btn-primary" data-action="sync-push">備份到雲端</button>' +
    '<button type="button" class="btn btn-ghost" data-action="sync-pull">從雲端還原</button>' +
  '</div>';
  h += '<div class="sync-status" id="sync-status" style="margin-top:10px"></div>';
  h += '<div class="sync-meta" id="sync-meta"></div>';
  h += '<details><summary>登入與資料庫設定</summary><div class="body">';
  h += '<p class="kbd-note">1. Supabase Auth → Users 建立登入帳號（建議勾選 Auto Confirm User）。</p>';
  h += '<p class="kbd-note">2. SQL Editor 執行 <code>auth-setup.sql</code>，再把帳號加入 <code>dashboard_members</code> 白名單。</p>';
  h += '<p class="kbd-note">3. MCP／Telegram／AI Worker 的 <code>DASH_KEY</code> 改用 service_role（僅限伺服器端）。</p>';
  h += '<pre><code>' + esc(sql) + '</code></pre>';
  h += '<p class="kbd-note">anon / publishable key 可以公開；service_role / secret key 不可放在瀏覽器、截圖或 Git。免費專案閒置 7 天會暫停，回 Supabase 官網按 Restore 即可。</p>';
  h += '</div></details>';
  h += '</div></div>';
  return h;
}

/* ================= 全域搜尋 ================= */
function openSearch(){
  openModal(
    '<div class="modal search-modal">' +
      '<div class="search-bar">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input id="gsearch" data-autofocus placeholder="搜尋任務、AI、會議、行程、文件、連結、專案…">' +
      '</div>' +
      '<div id="gresults" style="overflow:auto;max-height:60vh"></div>' +
    '</div>');
  renderSearch('');
}
function renderSearch(q){
  var el = $('#gresults');
  if(!el) return;
  var lq = q.trim().toLowerCase();
  if(!lq){
    el.innerHTML = '<div class="srow" style="cursor:default"><span class="dim">輸入關鍵字開始搜尋；或按 Esc 關閉</span></div>';
    return;
  }
  var h = '', count = 0;
  function group(title, rows){
    if(!rows.length) return;
    count += rows.length;
    h += '<div class="sgroup">' + title + '</div>' + rows.join('');
  }
  group('任務', state.tasks.filter(function(x){
    return (x.title + ' ' + (x.note || '')).toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(x){
    return '<div class="srow" data-action="open-task" data-id="' + x.id + '"><span class="st">' + esc(x.title) + '</span><span class="dim">' + ST[x.status] + '</span></div>';
  }));
  group('AI 工作區', state.aiTasks.filter(function(x){
    var hay = x.title + ' ' + (x.instruction || '') + ' ' + (x.waitingFor || '') + ' ' + (x.result || '') + ' ' + (x.owner || '');
    return hay.toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(x){
    return '<div class="srow" data-action="open-ai-task" data-id="' + x.id + '"><span class="st">' + esc(x.title) + '</span><span class="dim">' + AI_ST[x.status] + '</span></div>';
  }));
  group('會議', state.meetings.filter(function(m){
    var hay = m.title + ' ' + (m.notes || '') + ' ' + (m.location || '') + ' ' + m.actionItems.map(function(a){ return a.text; }).join(' ');
    return hay.toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(m){
    return '<div class="srow" data-action="open-meeting" data-id="' + m.id + '"><span class="st">' + esc(m.title) + '</span><span class="dim">' + fmtMD(m.date) + '</span></div>';
  }));
  group('私人行程', state.events.filter(function(ev){
    var hay = ev.title + ' ' + (ev.note || '') + ' ' + (ev.location || '');
    return hay.toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(ev){
    return '<div class="srow" data-action="open-event" data-id="' + ev.id + '"><span class="st">' + esc(ev.title) + '</span><span class="dim">' + eventRangeLabel(ev) + '</span></div>';
  }));
  group('文件', state.docs.filter(function(d){
    return (d.title + ' ' + (d.note || '') + ' ' + (d.tags || []).join(' ')).toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(d){
    return '<div class="srow" data-action="open-doc" data-id="' + d.id + '"><span class="st">' + esc(d.title) + '</span><span class="dim">文件</span></div>';
  }));
  group('摸魚區', state.links.filter(function(l){
    return (l.title + ' ' + (l.note || '') + ' ' + (l.url || '')).toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(l){
    return '<div class="srow" data-action="open-link-url" data-url="' + esc(l.url) + '"><span class="st">' + esc(l.title) + '</span><span class="dim">連結</span></div>';
  }));
  group('專案', state.projects.filter(function(p){
    var hay = p.name + ' ' + (p.desc || '') + ' ' + (p.milestones || []).map(function(m){ return m.title; }).join(' ');
    return hay.toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(p){
    return '<div class="srow" data-action="open-project" data-id="' + p.id + '"><span class="st">' + esc(p.name) + '</span><span class="dim">專案</span></div>';
  }));
  if(!count) h = '<div class="empty">沒有符合的結果</div>';
  el.innerHTML = h;
}

/* ================= 事件：點擊 ================= */
/* 點遮罩關閉彈窗時，按下與放開都必須在遮罩上。
   否則在輸入框選字、把游標拖到框外放開時，click 會落在 overlay 而誤關彈窗。 */
var overlayDown = false, overlayUp = false;
function isOverlayEl(el){ return !!(el && el.classList && el.classList.contains('overlay')); }
document.addEventListener('pointerdown', function(e){
  overlayDown = e.button === 0 && isOverlayEl(e.target);
  overlayUp = false;
}, true);
document.addEventListener('pointerup', function(e){
  overlayUp = e.button === 0 && isOverlayEl(e.target);
}, true);
document.addEventListener('pointercancel', function(){
  overlayDown = false; overlayUp = false;
}, true);
document.addEventListener('click', function(e){
  if(isOverlayEl(e.target)){
    var backdrop = overlayDown && overlayUp;
    overlayDown = false; overlayUp = false;
    if(backdrop) closeModal();
    return;
  }
  overlayDown = false; overlayUp = false;
  var el = e.target.closest('[data-action]');
  if(!el) return;
  var a = el.dataset.action;
  switch(a){
    case 'nav': go(el.dataset.view); break;
    case 'open-search': openSearch(); break;
    case 'close-modal': closeModal(); break;
    case 'confirm-yes':
      var f = pendingYes; pendingYes = null; closeModal();
      if(f) f();
      break;
    case 'seg-pick': {
      var box = el.closest('[data-seg]');
      if(box){
        $$('button', box).forEach(function(b){ b.classList.toggle('on', b === el); });
        var hid = box.querySelector('input[type="hidden"]');
        if(hid) hid.value = el.dataset.val;
        if(box.dataset.seg === 'tasksview'){ taskViewMode = el.dataset.val; renderTasks(); }
        else if(box.dataset.seg === 'taskarea'){ setTaskArea(el.dataset.val); }
      }
      break;
    }
    case 'open-ai': openAIWorkspace(); break;
    case 'open-ai-task': openAITaskModal(el.dataset.id || null); break;
    case 'del-ai-task': delAITask(el.dataset.id); break;
    case 'aiws-status': setAIStatus(el.dataset.id, el.dataset.status); break;
    case 'aiws-copy-json': copyAIJSON(); break;
    case 'aiws-copy-prompt': copyAIPrompt(); break;
    case 'aiws-apply': openAIUpdateModal(); break;
    case 'aiws-cloud-merge': aiCloudMerge(); break;
    case 'open-task': openTaskModal(el.dataset.id || null); break;
    case 'toggle-task': toggleTask(el.dataset.id); break;
    case 'del-task': delTask(el.dataset.id); break;
    case 'set-taskfilter': taskFilter = el.dataset.val; renderTasks(); break;
    case 'open-project': openProjectModal(el.dataset.id || null); break;
    case 'del-project': delProject(el.dataset.id); break;
    case 'toggle-ms': toggleMilestone(el.dataset.pid, +el.dataset.idx); break;
    case 'open-meeting': openMeetingModal(el.dataset.id || null, el.dataset.date || null); break;
    case 'del-meeting': delMeeting(el.dataset.id); break;
    case 'open-event': openEventModal(el.dataset.id || null, el.dataset.date || null); break;
    case 'del-event': delEvent(el.dataset.id); break;
    case 'open-day': openDayModal(el.dataset.date || today()); break;
    case 'cal-prev': calM--; if(calM < 0){ calM = 11; calY--; } renderMeetings(); break;
    case 'cal-next': calM++; if(calM > 11){ calM = 0; calY++; } renderMeetings(); break;
    case 'cal-day': openDayModal(el.dataset.date); break;
    case 'ai-toggle': aiToggle(el.dataset.mid, el.dataset.ai); break;
    case 'ai-convert': aiConvert(el.dataset.mid, el.dataset.ai); break;
    case 'ai-del': aiDel(el.dataset.mid, el.dataset.ai); break;
    case 'ai-add': aiAdd(el.dataset.mid); break;
    case 'open-doc': openDocModal(el.dataset.id || null); break;
    case 'del-doc': delDoc(el.dataset.id); break;
    case 'doc-tag': docTag = (docTag === el.dataset.tag) ? '' : el.dataset.tag; renderDocs(); break;
    case 'doc-link': break;
    case 'open-link': openLinkModal(el.dataset.id || null); break;
    case 'del-link': delLink(el.dataset.id); break;
    case 'open-link-url': {
      var lu = el.dataset.url || '';
      closeModal();
      if(lu){
        var lw = window.open(lu, '_blank');
        if(lw) lw.opener = null;
      } else {
        toast('這個連結還沒有網址，按 ✎ 補上');
      }
      break;
    }
    case 'del-hour': {
      state.hours = state.hours.filter(function(x){ return x.id !== el.dataset.id; });
      commit(); toast('已刪除紀錄');
      break;
    }
    case 'stats-tab':
      statsTab = el.dataset.val === 'report' ? 'report' : 'hours';
      try{ localStorage.setItem('wd-stats-tab', statsTab); }catch(err){}
      renderStats();
      break;
    case 'report-range':
      reportRangeMode = el.dataset.val === 'day' || el.dataset.val === 'month' ? el.dataset.val : 'week';
      renderStats();
      break;
    case 'report-prev': shiftReport(-1); renderStats(); break;
    case 'report-next': shiftReport(1); renderStats(); break;
    case 'report-today': reportAnchor = today(); renderStats(); break;
    case 'report-copy': copyReportSummary(); break;
    case 'report-csv': exportReportCSV(); break;
    case 'export-json': exportJSON(); break;
    case 'import-json': { var fi = $('#import-file'); if(fi) fi.click(); break; }
    case 'sync-test': sbTest(); break;
    case 'sync-meta': refreshCloudTime(); break;
    case 'sync-push': syncCfgFromInputs(); pushToCloud(false); break;
    case 'sync-pull': pullFromCloud(true); break;
    case 'seed-demo':
      confirmBox('載入示範資料會覆蓋目前的資料，確定嗎？', function(){
        state = seed(); saveState(); render(); toast('已載入示範資料');
      });
      break;
    case 'clear-all':
      confirmBox('確定清除所有資料？此動作無法復原，建議先匯出備份。', function(){
        state = { version: 1, tasks: [], projects: [], meetings: [], events: [], docs: [], hours: [], links: [], aiTasks: [] };
        saveState(); render(); toast('已清除所有資料');
      });
      break;
  }
});

/* 主題 / 主色 控制（側邊欄） */
document.addEventListener('click', function(e){
  var md = e.target.closest('[data-mode]');
  if(md){
    themeMode = md.dataset.mode;
    try{ localStorage.setItem('wd-theme', themeMode); }catch(err){}
    applyTheme();
    return;
  }
  var sw = e.target.closest('.sw');
  if(sw){
    accent = sw.dataset.accent;
    try{ localStorage.setItem('wd-accent', accent); }catch(err){}
    applyAccent();
  }
});

/* ================= 事件：表單送出 ================= */
document.addEventListener('submit', function(e){
  e.preventDefault();
  var f = e.target.closest('form[data-form]');
  if(!f) return;
  var kind = f.dataset.form;
  if(kind === 'task') saveTaskForm(f);
  else if(kind === 'ai') saveAIForm(f);
  else if(kind === 'ai-update') applyAIUpdateForm(f);
  else if(kind === 'project') saveProjectForm(f);
  else if(kind === 'meeting') saveMeetingForm(f);
  else if(kind === 'event') saveEventForm(f);
  else if(kind === 'doc') saveDocForm(f);
  else if(kind === 'link') saveLinkForm(f);
  else if(kind === 'hours'){
    var d = f.elements['date'].value || today();
    var hrs = parseFloat(f.elements['hours'].value);
    if(!(hrs > 0 && hrs <= 24)){ toast('請輸入 0.5～24 之間的時數'); return; }
    state.hours.push({ id: uid(), date: d, projectId: f.elements['projectId'].value || null, hours: hrs, note: f.elements['note'].value.trim() });
    saveState(); render(); toast('已記錄工時');
  }
});

/* ================= 事件：輸入 ================= */
document.addEventListener('input', function(e){
  if(e.target.id === 'gsearch') renderSearch(e.target.value);
  else if(e.target.id === 'doc-search'){ docSearch = e.target.value; renderDocsList(); }
  else if(e.target.id === 'sync-doc'){
    syncCfgFromInputs();
    var st = $('#sync-status');
    if(st){ delete st.dataset.msg; st.style.color = ''; }
    updateSyncUI();
  }
});

/* ================= 事件：檔案 ================= */
document.addEventListener('change', function(e){
  if(e.target.id === 'import-file'){
    var file = e.target.files[0];
    e.target.value = '';
    importFile(file);
  }
  if(e.target.id === 'sync-auto'){
    syncCfg.autoPush = e.target.checked;
    saveSyncCfg();
    toast(syncCfg.autoPush ? '已開啟自動上傳' : '已關閉自動上傳');
  }
  if(e.target.id === 'sync-autopull'){
    syncCfg.autoPull = e.target.checked;
    saveSyncCfg();
    toast(syncCfg.autoPull ? '已開啟自動接收雲端變更' : '已關閉自動接收雲端變更');
  }
});
document.addEventListener('dragover', function(e){
  if(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0){
    e.preventDefault();
  }
});
document.addEventListener('drop', function(e){
  if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
    e.preventDefault();
    var file = e.dataTransfer.files[0];
    if(/\.json$/i.test(file.name)) importFile(file);
    else toast('目前支援匯入 JSON 檔');
  }
});

/* ================= 事件：鍵盤 ================= */
document.addEventListener('keydown', function(e){
  if((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k'){
    e.preventDefault();
    if($('#gsearch')) closeModal(); else openSearch();
    return;
  }
  if(e.key === 'Escape' && modalRoot.innerHTML){ closeModal(); }
});

/* ================= 任務看板拖放 ================= */
var dragId = null;
document.addEventListener('dragstart', function(e){
  var c = e.target.closest ? e.target.closest('.kcard[draggable="true"]') : null;
  if(!c) return;
  dragId = c.dataset.id;
  try{ e.dataTransfer.setData('text/plain', c.dataset.id); }catch(err){}
  e.dataTransfer.effectAllowed = 'move';
  c.classList.add('dragging');
});
document.addEventListener('dragend', function(){
  dragId = null;
  $$('.dragging').forEach(function(x){ x.classList.remove('dragging'); });
  $$('.drag-over').forEach(function(x){ x.classList.remove('drag-over'); });
});
document.addEventListener('dragover', function(e){
  var z = e.target.closest ? e.target.closest('[data-drop-status]') : null;
  if(!z) return;
  e.preventDefault();
  try{ e.dataTransfer.dropEffect = 'move'; }catch(err){}
  if(!z.classList.contains('drag-over')){
    $$('.drag-over').forEach(function(x){ x.classList.remove('drag-over'); });
    z.classList.add('drag-over');
  }
});
document.addEventListener('drop', function(e){
  var z = e.target.closest ? e.target.closest('[data-drop-status]') : null;
  if(!z) return;
  if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) return;
  e.preventDefault();
  var id = dragId;
  try{ id = e.dataTransfer.getData('text/plain') || id; }catch(err){}
  if(id) setTaskStatus(id, z.dataset.dropStatus);
});

/* ================= AI Agent API ================= */
window.wdAI = {
  schemaVersion: 1,
  statuses: AI_STATUSES.slice(),
  list: function(status){
    return state.aiTasks.filter(function(t){ return !status || t.status === status; }).map(aiCopy);
  },
  get: function(id){ var t = findAITask(id); return t ? aiCopy(t) : null; },
  add: function(data){
    if(!data || !String(data.title || '').trim()) throw new Error('AI 任務需要 title');
    var t = aiCreate(data);
    state.aiTasks.push(t);
    saveState(); render();
    return aiCopy(t);
  },
  update: function(id, patch){
    var t = findAITask(id);
    if(!t) throw new Error('找不到 AI 任務：' + id);
    aiPatch(t, patch || {}, (patch && patch.note) || 'Agent 更新');
    saveState(); render();
    return aiCopy(t);
  },
  complete: function(id, result){
    var t = findAITask(id);
    if(!t) throw new Error('找不到 AI 任務：' + id);
    aiPatch(t, { status:'done', progress:100, result:result || t.result || '' }, 'Agent 完成');
    saveState(); render();
    return aiCopy(t);
  },
  remove: function(id){
    state.aiTasks = state.aiTasks.filter(function(t){ return t.id !== id; });
    saveState(); render();
  },
  apply: function(payload){ return aiApplyPayload(payload); },
  exportJSON: aiJSON,
  prompt: aiPromptText,
  open: openAIWorkspace
};

/* ================= 啟動 ================= */
render();
go('overview');
applyTheme();
applyAccent();
setTimeout(checkCloudNewer, 1200);
startAutoPull();

})();
