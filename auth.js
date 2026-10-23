/* ============================================================
   工作儀錶板 — Supabase Auth 登入閘門
   ------------------------------------------------------------
   * 使用 Supabase Auth email / password 登入。
   * 登入成功且通過 dashboard_members 白名單後，才載入 app.js。
   * access token 過期前自動 refresh；REST 401 時會重試一次。
   * 只使用 anon / publishable key；service_role 不可放在瀏覽器。
   ============================================================ */
(function(){
'use strict';

var LS_SYNC = 'wd-sync';
var LS_AUTH = 'wd-auth';
var REFRESH_MARGIN = 60 * 1000;

var gate, form, emailEl, passEl, errEl, submitEl;
var cfgBox, cfgUrl, cfgKey, cfgDoc;
var userEmailEl;
var appLoaded = false;
var appLoading = false;
var refreshPromise = null;
var expiring = false;
var busy = false;

function $(id){ return document.getElementById(id); }

function readJson(key){
  try{
    var raw = localStorage.getItem(key);
    if(!raw) return null;
    var value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  }catch(e){ return null; }
}
function writeJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(e){ return false; }
}
function readConfig(){
  var c = readJson(LS_SYNC);
  return c || {};
}
function saveConfig(url, key, docId){
  var c = readConfig();
  c.url = url;
  c.anonKey = key;
  if(docId) c.docId = docId;
  writeJson(LS_SYNC, c);
}
function normalizeUrl(value){
  return String(value == null ? '' : value).trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/auth\/v1$/i, '')
    .replace(/\/+$/, '');
}
function authBase(){ return normalizeUrl(readConfig().url); }
function authKey(){ return String(readConfig().anonKey || '').trim(); }
function oneLine(value, max){
  var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function fail(message, code){
  var e = new Error(message);
  if(code) e.code = code;
  return e;
}
function setError(message){
  if(!errEl) return;
  errEl.textContent = message || '';
  errEl.hidden = !message;
}
function setBusy(on, label){
  busy = !!on;
  if(!submitEl) return;
  submitEl.disabled = busy;
  submitEl.textContent = label || (busy ? '登入中…' : '登入');
}

/* ---------- session ---------- */
function loadSession(){
  var s = readJson(LS_AUTH);
  if(!s || !s.access_token || !s.refresh_token) return null;
  return s;
}
function saveSession(data){
  if(!data || !data.access_token || !data.refresh_token){
    throw new Error('登入回應缺少 access_token / refresh_token');
  }
  var prev = loadSession();
  var expiresAt = Number(data.expires_at);
  if(!expiresAt){
    expiresAt = Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600);
  }
  var user = data.user || (prev && prev.user) || null;
  var session = {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    token_type: data.token_type || 'bearer',
    expires_at: expiresAt,
    user: user ? { id: user.id || null, email: user.email || '' } : null
  };
  if(!writeJson(LS_AUTH, session)) throw new Error('無法儲存登入狀態（瀏覽器儲存空間不足）');
  return session;
}
function clearSession(){
  try{ localStorage.removeItem(LS_AUTH); }catch(e){}
}
function fresh(session){
  return !!session && Number(session.expires_at) * 1000 > Date.now() + REFRESH_MARGIN;
}

function refreshSession(){
  if(refreshPromise) return refreshPromise;
  var s = loadSession();
  if(!s || !s.refresh_token) return Promise.resolve(null);
  var url = authBase();
  var key = authKey();
  if(!url || !key){ clearSession(); return Promise.resolve(null); }

  var request = fetch(url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token })
  }).then(function(res){
    return res.json().catch(function(){ return null; }).then(function(data){
      if(!res.ok){
        var e = fail(authError(data, res.status), 'REFRESH');
        e.status = res.status;
        throw e;
      }
      saveSession(data);
      return loadSession();
    });
  }).catch(function(err){
    if(err && (err.status === 400 || err.status === 401)){
      // 其他分頁可能已經先換過 refresh token；不要把它們的新 session 清掉。
      var latest = loadSession();
      if(latest && latest.refresh_token !== s.refresh_token) return latest;
      clearSession();
      return null;
    }
    throw err;
  });

  refreshPromise = request.then(
    function(value){ refreshPromise = null; return value; },
    function(err){ refreshPromise = null; throw err; }
  );
  return refreshPromise;
}
function ensureFresh(force){
  var s = loadSession();
  if(!s) return Promise.resolve(null);
  if(!force && fresh(s)) return Promise.resolve(s);
  return refreshSession();
}

/* ---------- errors ---------- */
function authError(data, status){
  var msg = data && (data.msg || data.message || data.error_description || data.error) || '';
  if(msg && typeof msg === 'object') msg = JSON.stringify(msg);
  var code = data && (data.error_code || data.code) || '';
  var hay = String(msg) + ' ' + String(code);
  if(/invalid login credentials|invalid_grant|invalid_credentials/i.test(hay)) return 'Email 或密碼錯誤';
  if(/email not confirmed|email_not_confirmed/i.test(hay)) return '請先到信箱完成 Email 驗證';
  if(/user not found/i.test(hay)) return '找不到這個帳號';
  if(/email logins? (are )?disabled|email provider.*disabled/i.test(hay)) return 'Supabase 專案尚未啟用 Email 登入';
  if(/invalid api key|no api key/i.test(hay)) return 'anon / publishable key 不正確，請回 Supabase API Keys 複製';
  if(/signup.*disabled|signups not allowed/i.test(hay)) return '這個專案已關閉註冊，請由管理者建立帳號';
  if(/failed to fetch|networkerror|load failed/i.test(hay)) return '無法連線 Supabase，請檢查網路與 Project URL';
  if(status === 429) return '嘗試次數過多，請稍後再試';
  return msg ? oneLine(msg, 220) : ('登入失敗（HTTP ' + status + '）');
}
function friendlyError(err){
  var msg = String((err && err.message) || err || '未知錯誤');
  if(/failed to fetch|networkerror|load failed/i.test(msg)) return '無法連線 Supabase，請檢查網路與 Project URL';
  return oneLine(msg, 240);
}
function looksLikeServiceKey(key){
  var s = String(key || '').trim();
  if(/^sb_secret_/i.test(s)) return true;
  if(s.indexOf('eyJ') !== 0) return false;
  try{
    var part = s.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    var pad = part.length % 4;
    if(pad) part += new Array(5 - pad).join('=');
    var payload = JSON.parse(atob(part));
    return payload && payload.role === 'service_role';
  }catch(e){ return false; }
}

/* ---------- REST with auth ---------- */
function withAuth(options, token){
  var out = {};
  var key;
  if(options){
    for(key in options){
      if(Object.prototype.hasOwnProperty.call(options, key)) out[key] = options[key];
    }
  }
  var headers = {};
  if(options && options.headers){
    for(key in options.headers){
      if(Object.prototype.hasOwnProperty.call(options.headers, key)) headers[key] = options.headers[key];
    }
  }
  headers.Authorization = 'Bearer ' + token;
  out.headers = headers;
  return out;
}
function expire(){
  if(expiring) return;
  expiring = true;
  clearSession();
  if(appLoaded){
    location.reload();
    return;
  }
  expiring = false;
  showGate('登入已過期，請重新登入');
}
function authFetch(url, options){
  return ensureFresh(false).then(function(session){
    if(!session) throw fail('登入已過期，請重新登入', 'AUTH_REQUIRED');
    return fetch(url, withAuth(options, session.access_token)).then(function(res){
      if(res.status !== 401) return res;
      return ensureFresh(true).then(function(next){
        if(!next) throw fail('登入已過期，請重新登入', 'AUTH_REQUIRED');
        return fetch(url, withAuth(options, next.access_token));
      });
    });
  }).catch(function(err){
    if(err && err.code === 'AUTH_REQUIRED') expire();
    throw err;
  });
}

/* ---------- membership ---------- */
function checkMembership(){
  var url = authBase();
  var key = authKey();
  if(!url || !key) return Promise.reject(fail('尚未設定 Supabase 連線', 'SETUP'));
  return authFetch(url + '/rest/v1/rpc/is_dashboard_member', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: '{}'
  }).then(function(res){
    if(res.ok) return res.json();
    return res.text().then(function(text){
      if(res.status === 404) throw fail('資料庫尚未完成登入設定，請先執行 auth-setup.sql', 'SETUP');
      if(res.status === 401 || res.status === 403) throw fail('此帳號沒有儀錶板權限，請聯絡管理者加入 dashboard_members', 'NOT_MEMBER');
      throw fail('權限檢查失敗（HTTP ' + res.status + '）：' + oneLine(text, 120), 'CHECK');
    });
  }).then(function(data){
    var ok = data === true
      || (Array.isArray(data) && (data[0] === true || (data[0] && data[0].is_dashboard_member === true)))
      || (data && data.is_dashboard_member === true);
    if(!ok) throw fail('此帳號沒有儀錶板權限，請聯絡管理者加入 dashboard_members', 'NOT_MEMBER');
    return true;
  });
}

/* ---------- UI ---------- */
function fillConfig(){
  var c = readConfig();
  if(cfgUrl) cfgUrl.value = c.url || '';
  // 若舊設定誤存 service_role，不要把金鑰渲染在輸入框裡。
  if(cfgKey) cfgKey.value = looksLikeServiceKey(c.anonKey) ? '' : (c.anonKey || '');
  if(cfgDoc) cfgDoc.value = c.docId || '';
  if(cfgBox) cfgBox.open = !(c.url && c.anonKey);
}
function fillUser(session){
  if(!userEmailEl) return;
  var email = session && session.user && session.user.email;
  userEmailEl.textContent = email || '';
  userEmailEl.title = email || '';
}
function showGate(message){
  document.body.classList.add('auth-locked');
  if(gate) gate.hidden = false;
  setError(message || '');
  setBusy(false);
  var c = readConfig();
  if(cfgBox && !(c.url && c.anonKey)) cfgBox.open = true;
  setTimeout(function(){
    if(emailEl && !emailEl.value) emailEl.focus();
  }, 40);
}
function loadApp(){
  if(appLoaded || appLoading) return;
  appLoading = true;
  var script = document.createElement('script');
  script.src = 'app.js?v=1.7';
  script.async = false;
  script.onload = function(){
    appLoading = false;
    appLoaded = true;
    document.body.classList.remove('auth-locked');
    if(gate) gate.hidden = true;
    setBusy(false, '登入');
    fillUser(loadSession());
  };
  script.onerror = function(){
    appLoading = false;
    showGate('載入儀錶板失敗，請重新整理頁面');
  };
  document.body.appendChild(script);
}

function handleLogin(e){
  if(e) e.preventDefault();
  if(busy) return;
  setError('');

  var email = emailEl ? emailEl.value.trim() : '';
  var password = passEl ? passEl.value : '';
  var url = normalizeUrl(cfgUrl ? cfgUrl.value : '');
  var key = (cfgKey ? cfgKey.value : '').trim();
  var docId = (cfgDoc ? cfgDoc.value : '').trim();

  if(!email || !password){ setError('請輸入 Email 與密碼'); return; }
  if(!url || !key){
    if(cfgBox) cfgBox.open = true;
    setError('請填寫 Supabase URL 與 anon / publishable key');
    return;
  }
  if(!/^https:\/\//i.test(url)){
    if(cfgBox) cfgBox.open = true;
    setError('Supabase URL 必須以 https:// 開頭');
    return;
  }
  if(/supabase\.com\/dashboard/i.test(url)){
    if(cfgBox) cfgBox.open = true;
    setError('這是 Supabase Dashboard 網址；請填 Data API 的 Project URL（https://xxxx.supabase.co）');
    return;
  }
  if(looksLikeServiceKey(key)){
    if(cfgBox) cfgBox.open = true;
    setError('這是 service_role / secret key，不可貼在瀏覽器；請改用 anon / publishable key');
    return;
  }

  setBusy(true, '登入中…');
  fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  }).then(function(res){
    return res.json().catch(function(){ return null; }).then(function(data){
      if(!res.ok) throw fail(authError(data, res.status));
      saveSession(data);
      saveConfig(url, key, docId);
      return checkMembership();
    });
  }).then(function(){
    setError('');
    fillUser(loadSession());
    loadApp();
  }).catch(function(err){
    setBusy(false);
    if(err && (err.code === 'NOT_MEMBER' || err.code === 'SETUP')) clearSession();
    setError(friendlyError(err));
  });
}

function logout(){
  if(!confirm('確定要登出嗎？\n\n本機快取不會自動刪除；若使用共用電腦，請在瀏覽器設定中清除此網站資料。')) return;
  var session = loadSession();
  var url = authBase();
  var key = authKey();
  clearSession();
  if(session && url && key){
    fetch(url + '/auth/v1/logout', {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + session.access_token }
    }).catch(function(){});
  }
  location.reload();
}

function bind(){
  if(form) form.addEventListener('submit', handleLogin);
  [cfgUrl, cfgKey, cfgDoc].forEach(function(input){
    if(input) input.addEventListener('input', function(){ setError(''); });
  });
  document.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('[data-auth-logout]') : null;
    if(el){
      e.preventDefault();
      logout();
    }
  });
}

function boot(){
  gate = $('auth-gate');
  form = $('auth-form');
  emailEl = $('auth-email');
  passEl = $('auth-password');
  errEl = $('auth-error');
  submitEl = $('auth-submit');
  cfgBox = $('auth-config');
  cfgUrl = $('auth-url');
  cfgKey = $('auth-key');
  cfgDoc = $('auth-doc');
  userEmailEl = $('auth-user-email');

  if(!gate) return;
  fillConfig();
  bind();

  // 舊設定若曾把 service_role 放進瀏覽器，先擋下來，避免繼續使用。
  if(looksLikeServiceKey(readConfig().anonKey)){
    if(cfgBox) cfgBox.open = true;
    showGate('偵測到 service_role / secret key；請改用 anon / publishable key');
    return;
  }

  var session = loadSession();
  if(!session){
    showGate('');
    return;
  }

  setBusy(true, '驗證登入…');
  ensureFresh(false).then(function(current){
    if(!current) throw fail('登入已過期，請重新登入', 'AUTH_REQUIRED');
    return checkMembership().then(function(){ return current; });
  }).then(function(current){
    fillUser(current);
    loadApp();
  }).catch(function(err){
    setBusy(false);
    if(err && (err.code === 'AUTH_REQUIRED' || err.code === 'NOT_MEMBER' || err.code === 'SETUP')) clearSession();
    showGate(friendlyError(err));
  });
}

window.WDAuth = {
  fetch: authFetch,
  getAccessToken: function(){
    var s = loadSession();
    return s ? s.access_token : '';
  },
  getUser: function(){
    var s = loadSession();
    return s && s.user ? s.user : null;
  },
  refresh: function(){ return ensureFresh(true); },
  signOut: logout,
  isAuthenticated: function(){ return !!loadSession(); }
};

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot, { once: true });
}else{
  boot();
}

})();
