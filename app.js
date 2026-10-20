/* ============================================================
   工作儀錶板 v1 — 核心邏輯
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
var PRI = { high:'高', mid:'中', low:'低' };
var PRI_RANK = { high:0, mid:1, low:2 };
var TITLES = { overview:'總覽', tasks:'任務', projects:'專案', meetings:'會議', docs:'文件', stats:'統計', fun:'摸魚區', settings:'設定' };
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
    tasks: obj.tasks || [],
    projects: obj.projects || [],
    meetings: obj.meetings || [],
    docs: obj.docs || [],
    hours: obj.hours || [],
    links: obj.links || []
  };
  o.tasks.forEach(function(t){
    if(!t.status) t.status = 'todo';
    if(!t.priority) t.priority = 'mid';
    if(t.due === undefined) t.due = null;
    if(t.projectId === undefined) t.projectId = null;
    if(t.note == null) t.note = '';
  });
  o.projects.forEach(function(p){ if(!Array.isArray(p.milestones)) p.milestones = []; });
  o.meetings.forEach(function(m){ if(!Array.isArray(m.actionItems)) m.actionItems = []; });
  o.docs.forEach(function(d){ if(!Array.isArray(d.tags)) d.tags = []; });
  o.links.forEach(function(l){
    if(l.title == null) l.title = '';
    if(l.url == null) l.url = '';
    if(l.note == null) l.note = '';
  });
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
  return {
    version: 1,
    modifiedAt: Date.now(),
    projects: [
      { id: p1, name: '青廣招生計畫', desc: '年度招生：簡章、表單、宣傳、面談', createdAt: t,
        milestones: [
          { title:'簡章定稿', done:true }, { title:'報名表單上線', done:true },
          { title:'宣傳開跑', done:false }, { title:'面談', done:false }, { title:'公告錄取', done:false }
        ] },
      { id: p2, name: '官網改版', desc: '品牌更新、首頁重設計', createdAt: t,
        milestones: [
          { title:'Wireframe', done:true }, { title:'視覺設計', done:false },
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
      { id: uid(), title:'卓青名單彙整', status:'done', priority:'mid', due: addDays(t, -3), projectId: p1, note:'', createdAt:t, completedAt: addDays(t, -3) },
      { id: uid(), title:'會議紀錄歸檔', status:'done', priority:'low', due: addDays(t, -4), projectId: null, note:'', createdAt:t, completedAt: addDays(t, -4) }
    ],
    meetings: [
      { id: uid(), title:'卓青籌備會議', date: addDays(t, 2), time:'14:00', location:'會議室', attendees:'5 人',
        notes:'確認場地與分工',
        actionItems:[
          { id: uid(), text:'確認場地佈置分工', done:false, convertedTaskId:null },
          { id: uid(), text:'更新報名表單文案', done:false, convertedTaskId:null },
          { id: uid(), text:'通知志工時間', done:true, convertedTaskId:null }
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
    ]
  };
}

/* 查找 */
function findTask(id){ for(var i=0;i<state.tasks.length;i++) if(state.tasks[i].id===id) return state.tasks[i]; return null; }
function findProject(id){ for(var i=0;i<state.projects.length;i++) if(state.projects[i].id===id) return state.projects[i]; return null; }
function findMeeting(id){ for(var i=0;i<state.meetings.length;i++) if(state.meetings[i].id===id) return state.meetings[i]; return null; }
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
  $('#page-title').textContent = TITLES[view] || '總覽';
  $$('.view').forEach(function(v){ v.classList.toggle('on', v.id === 'view-' + view); });
  $$('.nav a').forEach(function(a){ a.classList.toggle('active', a.dataset.view === view); });
  window.scrollTo(0, 0);
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

  var meets = state.meetings.filter(function(m){ return m.date >= t; })
    .sort(function(a, b){ return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); })
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
  h += '<div class="card"><div class="card-h">近期會議 <button type="button" class="ibtn" data-action="open-meeting" title="新增會議">＋</button></div>';
  if(meets.length){
    meets.forEach(function(m){
      var undone = m.actionItems.filter(function(a){ return !a.done; }).length;
      h += '<div class="meet" data-action="open-meeting" data-id="' + m.id + '">' +
        '<div class="datechip"><b>' + parseD(m.date).getDate() + '</b><span>週' + wdName(m.date) + '</span></div>' +
        '<div class="body"><div style="font-weight:600">' + esc(m.title) + '</div>' +
        '<div class="dim">' + esc(m.time || '') + (m.location ? '・' + esc(m.location) : '') + '</div>' +
        '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
          (m.actionItems.length ? '<span class="pill p-info">行動項 ' + m.actionItems.length + '</span>' : '') +
          (undone ? '<span class="pill p-mid">未結 ' + undone + '</span>' : '') +
        '</div></div></div>';
    });
  } else {
    h += '<div class="empty">沒有即將到來的會議</div>';
  }
  h += '</div>';

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
  return '<div class="' + cls + '" draggable="true" data-action="open-task" data-id="' + x.id + '">' +
    '<div class="kt' + (x.status === 'done' ? ' done' : '') + '">' + esc(x.title) + '</div>' +
    '<div class="kmeta"><span class="kl">' + left.join('・') + '</span>' + pillPRI(x.priority) + '</div>' +
  '</div>';
}
function renderTasks(){
  var el = $('#view-tasks');
  var chips = [['all','全部'],['high','高優先'],['week','本週到期'],['overdue','逾期']];
  var h = '<div class="toolbar">' +
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
        h += '<div class="trow" data-action="open-task" data-id="' + x.id + '">' +
          '<span class="check' + (x.status === 'done' ? ' done' : '') + '" data-action="toggle-task" data-id="' + x.id + '"></span>' +
          '<span class="t' + (x.status === 'done' ? ' done' : '') + '">' + esc(x.title) + '<small>' + sub.join('・') + '</small></span>' +
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
  p.milestones[idx].done = !p.milestones[idx].done;
  commit();
}

/* ================= 渲染：會議 ================= */
var calY, calM;
(function(){ var d = new Date(); calY = d.getFullYear(); calM = d.getMonth(); })();
function calHTML(){
  var first = new Date(calY, calM, 1).getDay();
  var dim = new Date(calY, calM + 1, 0).getDate();
  var prevDim = new Date(calY, calM, 0).getDate();
  var byDate = {};
  state.meetings.forEach(function(m){ (byDate[m.date] = byDate[m.date] || []).push(m); });
  var h = ['日','一','二','三','四','五','六'].map(function(w){ return '<div class="wd">' + w + '</div>'; }).join('');
  var i, ds;
  for(i = 0; i < first; i++) h += '<div class="day mut">' + (prevDim - first + 1 + i) + '</div>';
  for(i = 1; i <= dim; i++){
    ds = calY + '-' + pad(calM + 1) + '-' + pad(i);
    var cls = 'day' + (ds === today() ? ' today' : '');
    h += '<div class="' + cls + '" data-action="cal-day" data-date="' + ds + '">' + i + (byDate[ds] ? '<span class="dot"></span>' : '') + '</div>';
  }
  var tail = (7 - ((first + dim) % 7)) % 7;
  for(i = 1; i <= tail; i++) h += '<div class="day mut">' + i + '</div>';
  return h;
}
function renderMeetings(){
  var t = today();
  var upcoming = state.meetings.filter(function(m){ return m.date >= t; })
    .sort(function(a, b){ return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });
  var past = state.meetings.filter(function(m){ return m.date < t; })
    .sort(function(a, b){ return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')); });

  var h = '<div class="grid-2">';
  h += '<div class="card"><div class="cal-h">' +
    '<button type="button" class="ibtn" data-action="cal-prev">‹</button>' +
    '<b>' + calY + ' 年 ' + (calM + 1) + ' 月</b>' +
    '<button type="button" class="ibtn" data-action="cal-next">›</button>' +
    '<span class="cnt push">點日期可新增會議</span>' +
  '</div><div class="cal" id="cal-grid">' + calHTML() + '</div></div>';

  h += '<div class="stack">';
  h += '<div class="card"><div class="card-h"><span>即將到來</span><button type="button" class="btn btn-ghost" style="padding:4px 10px;font-size:12px" data-action="open-meeting">＋ 新增會議</button></div>';
  if(upcoming.length){
    upcoming.slice(0, 5).forEach(function(m){
      var undone = m.actionItems.filter(function(a){ return !a.done; }).length;
      h += '<div class="meet" data-action="open-meeting" data-id="' + m.id + '">' +
        '<div class="datechip"><b>' + parseD(m.date).getDate() + '</b><span>週' + wdName(m.date) + '</span></div>' +
        '<div class="body"><div style="font-weight:600">' + esc(m.title) + '</div>' +
        '<div class="dim">' + esc(m.time || '') + (m.attendees ? '・' + esc(m.attendees) : '') + (m.location ? '・' + esc(m.location) : '') + '</div>' +
        '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
          (m.actionItems.length ? '<span class="pill p-info">行動項 ' + m.actionItems.length + '</span>' : '') +
          (undone ? '<span class="pill p-mid">未結 ' + undone + '</span>' : (m.actionItems.length ? '<span class="pill p-done">已結案</span>' : '')) +
        '</div></div></div>';
    });
  } else {
    h += '<div class="empty">沒有即將到來的會議</div>';
  }
  h += '</div>';

  h += '<div class="card"><div class="card-h">最近紀錄</div>';
  if(past.length){
    past.slice(0, 5).forEach(function(m){
      h += '<div class="trow" data-action="open-meeting" data-id="' + m.id + '">' +
        '<span class="t">' + esc(m.title) + '<small>' + fmtMD(m.date) + '・行動項 ' + m.actionItems.length + '</small></span>' +
        '<span class="pill p-low">已結束</span></div>';
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
function renderStats(){
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

  $('#view-stats').innerHTML = h;
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
  h += '<div class="prow">GitHub 專案 <span class="dim">顯示 issue、PR 狀態</span><span class="pill p-low push">v1.5</span></div>';
  h += '<div class="prow">Google Calendar <span class="dim">同步行程</span><span class="pill p-low push">v2</span></div>';
  h += '<div class="prow">Outlook / 信件 <span class="dim">摘要與待辦萃取</span><span class="pill p-low push">v2</span></div>';
  h += '</div>';
  h += '<div class="card"><div class="card-h">關於</div><div class="card-b">';
  h += '<p class="kbd-note" style="margin:0 0 8px">工作儀錶板 v1.1・純前端、無依賴・支援 Supabase 雲端同步</p>';
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
    '<div class="modal-h">' + (isEdit ? '編輯任務' : '新增任務') +
      '<button type="button" class="ibtn" data-action="close-modal">✕</button></div>' +
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
    return { title: title, done: prev ? !!prev.done : false };
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
function aiToggle(mid, aid){
  var m = findMeeting(mid); if(!m) return;
  var a = null;
  m.actionItems.forEach(function(x){ if(x.id === aid) a = x; });
  if(!a) return;
  a.done = !a.done;
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
  m.actionItems.push({ id: uid(), text: text, done: false, convertedTaskId: null });
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

function loadSync(){
  var d = { url:'', anonKey:'', docId:'', autoPush:false, lastSyncAt:null, lastPushAt:null };
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
  var k = sbKey();
  var h = { 'apikey': k, 'Content-Type': 'application/json' };
  /* 舊版 anon key 是 JWT（eyJ 開頭）→ 放進 Authorization 標頭；
     新版 publishable key（sb_publishable_ 開頭）→ 只需要 apikey 標頭 */
  if(k.indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + k;
  return h;
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
    if(res.status === 401 || res.status === 403) return '金鑰錯誤或權限不足（檢查 anon key／RLS 設定）';
    if(res.status === 404) return '找不到資料表 dashboards（請先執行設定步驟的 SQL）';
    return 'HTTP ' + res.status;
  }
  return String((err && err.message) || err || '未知錯誤');
}
function sbTest(){
  syncCfgFromInputs();
  if(!sbReady()){ toast('請先填寫 URL、anon key 與文件金鑰'); return; }
  var statusEl = $('#sync-status');
  function show(msg, isErr){
    if(statusEl){
      statusEl.textContent = msg;
      statusEl.style.color = isErr ? 'var(--red)' : 'var(--green)';
    }
  }
  var base = sbBase();
  if(!/^https:\/\//i.test(base)){ show('連線失敗：Project URL 必須以 https:// 開頭', true); toast('Project URL 必須以 https:// 開頭'); return; }
  if(/supabase\.com\/dashboard/i.test(base)){ show('連線失敗：這是 Supabase Dashboard 網址，請改用 Data API 頁的 API URL（https://xxxx.supabase.co）', true); toast('URL 貼成 Dashboard 網址了'); return; }
  show('測試中…', false);
  fetch(base + '/rest/v1/dashboards?select=id&limit=1', { headers: sbHeaders() })
    .then(function(r){
      if(!r.ok) return r.text().then(function(txt){ throw { res: r, body: txt }; });
      return r.json();
    })
    .then(function(){ show('連線成功：資料表正常 ✓', false); toast('連線成功，資料表正常'); })
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
  fetch(sbBase() + '/rest/v1/dashboards', {
    method: 'POST',
    headers: Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ id: syncCfg.docId, payload: state, updated_at: nowIso }])
  })
    .then(function(r){ if(!r.ok) throw { res: r }; })
    .then(function(){
      syncCfg.lastSyncAt = nowIso;
      syncCfg.lastPushAt = nowIso;
      saveSyncCfg(); updateSyncUI();
      if(!silent) toast('已備份到雲端');
    })
    .catch(function(err){ toast('雲端上傳失敗：' + syncErrMsg(err.res, err)); });
}
function applyCloudPayload(remote){
  state = normalize(remote.payload);
  saveState(); render();
  syncCfg.lastSyncAt = new Date().toISOString();
  saveSyncCfg(); updateSyncUI();
  toast('已從雲端載入資料');
}
function pullFromCloud(confirmFirst){
  syncCfgFromInputs();
  if(!sbReady()){ toast('請先完成雲端同步設定'); return; }
  fetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=payload,updated_at&limit=1', { headers: sbHeaders() })
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
  fetch(sbBase() + '/rest/v1/dashboards?id=eq.' + encodeURIComponent(syncCfg.docId) + '&select=payload,updated_at&limit=1', { headers: sbHeaders() })
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(arr){
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
  if(!syncCfg || !syncCfg.autoPush || !sbReady()) return;
  if(pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(function(){ pushToCloud(true); }, 2500);
}
function fmtDT(iso){
  var d = new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function updateSyncUI(){
  var el = $('#sync-status');
  if(!el) return;
  var parts = [];
  if(sbReady()) parts.push('已設定：' + syncCfg.url);
  else parts.push('尚未完成設定');
  if(syncCfg.lastSyncAt) parts.push('上次同步：' + fmtDT(syncCfg.lastSyncAt));
  el.textContent = parts.join('・');
}
function syncCardHTML(){
  var sql = 'create table if not exists dashboards (\n' +
    '  id text primary key,\n' +
    '  payload jsonb not null,\n' +
    '  updated_at timestamptz not null default now()\n' +
    ');\n' +
    'alter table dashboards enable row level security;\n' +
    'create policy "anon all" on dashboards\n' +
    '  for all using (true) with check (true);';
  var h = '<div class="card" style="margin-bottom:14px"><div class="card-h">雲端同步（Supabase 免費版）</div><div class="card-b">';
  h += '<p class="kbd-note" style="margin-top:0">讓不同瀏覽器／裝置共用同一份資料：填一次設定 → 按「備份到雲端」；另一台按「從雲端還原」。開啟自動上傳後，每次變更會在約 2.5 秒後同步。</p>';
  h += '<div class="field"><label>Project URL（在 Data API 頁）</label><input id="sync-url" value="' + esc(syncCfg.url) + '" placeholder="https://xxxx.supabase.co"></div>';
  h += '<div class="row2">' +
    '<div class="field"><label>anon / publishable key（在 API Keys 頁）</label><input id="sync-key" value="' + esc(syncCfg.anonKey) + '" placeholder="eyJhbGciOi… 或 sb_publishable_…"></div>' +
    '<div class="field"><label>文件金鑰（自訂，等同密碼）</label><input id="sync-doc" value="' + esc(syncCfg.docId) + '" placeholder="my-dashboard-8f3k"></div>' +
  '</div>';
  h += '<label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px"><input type="checkbox" id="sync-auto"' + (syncCfg.autoPush ? ' checked' : '') + '> 每次變更後自動上傳</label>';
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button type="button" class="btn btn-ghost" data-action="sync-test">測試連線</button>' +
    '<button type="button" class="btn btn-primary" data-action="sync-push">備份到雲端</button>' +
    '<button type="button" class="btn btn-ghost" data-action="sync-pull">從雲端還原</button>' +
  '</div>';
  h += '<div class="sync-status" id="sync-status" style="margin-top:10px"></div>';
  h += '<details><summary>第一次設定：三個步驟</summary><div class="body">';
  h += '<p class="kbd-note">1. 到 supabase.com 註冊 → New project（免費方案）。</p>';
  h += '<p class="kbd-note">2. 左側選單 SQL Editor → 貼上以下 SQL → Run：</p>';
  h += '<pre><code>' + esc(sql) + '</code></pre>';
  h += '<p class="kbd-note">3. Project Settings → API → 複製 Project URL 與 anon public key 貼到上方欄位；多台裝置要填<b>相同</b>的文件金鑰。</p>';
  h += '<p class="kbd-note">提醒：文件金鑰就像密碼，請勿外流；免費專案閒置 7 天會暫停，回 Supabase 官網按 Restore 即可。</p>';
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
        '<input id="gsearch" data-autofocus placeholder="搜尋任務、會議、文件、連結、專案…">' +
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
  group('會議', state.meetings.filter(function(m){
    var hay = m.title + ' ' + (m.notes || '') + ' ' + (m.location || '') + ' ' + m.actionItems.map(function(a){ return a.text; }).join(' ');
    return hay.toLowerCase().indexOf(lq) >= 0;
  }).slice(0, 5).map(function(m){
    return '<div class="srow" data-action="open-meeting" data-id="' + m.id + '"><span class="st">' + esc(m.title) + '</span><span class="dim">' + fmtMD(m.date) + '</span></div>';
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
document.addEventListener('click', function(e){
  if(e.target.classList && e.target.classList.contains('overlay')){ closeModal(); return; }
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
      }
      break;
    }
    case 'open-task': openTaskModal(el.dataset.id || null); break;
    case 'toggle-task': toggleTask(el.dataset.id); break;
    case 'del-task': delTask(el.dataset.id); break;
    case 'set-taskfilter': taskFilter = el.dataset.val; renderTasks(); break;
    case 'open-project': openProjectModal(el.dataset.id || null); break;
    case 'del-project': delProject(el.dataset.id); break;
    case 'toggle-ms': toggleMilestone(el.dataset.pid, +el.dataset.idx); break;
    case 'open-meeting': openMeetingModal(el.dataset.id || null, el.dataset.date || null); break;
    case 'del-meeting': delMeeting(el.dataset.id); break;
    case 'cal-prev': calM--; if(calM < 0){ calM = 11; calY--; } renderMeetings(); break;
    case 'cal-next': calM++; if(calM > 11){ calM = 0; calY++; } renderMeetings(); break;
    case 'cal-day': openMeetingModal(null, el.dataset.date); break;
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
    case 'export-json': exportJSON(); break;
    case 'import-json': { var fi = $('#import-file'); if(fi) fi.click(); break; }
    case 'sync-test': sbTest(); break;
    case 'sync-push': syncCfgFromInputs(); pushToCloud(false); break;
    case 'sync-pull': pullFromCloud(true); break;
    case 'seed-demo':
      confirmBox('載入示範資料會覆蓋目前的資料，確定嗎？', function(){
        state = seed(); saveState(); render(); toast('已載入示範資料');
      });
      break;
    case 'clear-all':
      confirmBox('確定清除所有資料？此動作無法復原，建議先匯出備份。', function(){
        state = { version: 1, tasks: [], projects: [], meetings: [], docs: [], hours: [], links: [] };
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
  else if(kind === 'project') saveProjectForm(f);
  else if(kind === 'meeting') saveMeetingForm(f);
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
  else if(e.target.id === 'sync-url' || e.target.id === 'sync-key' || e.target.id === 'sync-doc'){ syncCfgFromInputs(); updateSyncUI(); }
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

/* ================= 啟動 ================= */
render();
go('overview');
applyTheme();
applyAccent();
setTimeout(checkCloudNewer, 1200);

})();
