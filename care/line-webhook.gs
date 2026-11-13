/**
 * 復原者 Repair CARE+ — LINE Webhook（Google Apps Script）
 *
 * 功能：
 *  1. 客人在 LINE 傳「CARE+ 0912345678」或直接傳電話 → 登錄 CARE+，回覆已啟用的保固到期日
 *  2. 客人封鎖官方帳號 → 標記為「已封鎖」（CARE+ 暫停）；重新加入好友 → 自動恢復
 *
 * 只使用 Reply（回覆）與接收事件，不使用 Push，不會扣 LINE 每月訊息額度。
 *
 * 需要在「專案設定 → 指令碼屬性」填入以下設定（不要寫在程式碼裡）：
 *   FIREBASE_API_KEY        新 Firebase 專案的 apiKey
 *   FIREBASE_PROJECT_ID     新 Firebase 專案的 projectId
 *   BOT_EMAIL               Firebase 裡建立的機器人帳號 email
 *   BOT_PASSWORD            機器人帳號密碼
 *   WEBHOOK_KEY             自訂一組亂碼（網址驗證用）
 *   NANZI_TOKEN             楠梓店 LINE Messaging API 的 Channel access token
 *   DEXIAN_TOKEN            德賢店 LINE Messaging API 的 Channel access token
 *
 * LINE 後台 Webhook 網址填：
 *   楠梓店：<部署網址>?store=nanzi&key=<WEBHOOK_KEY>
 *   德賢店：<部署網址>?store=dexian&key=<WEBHOOK_KEY>
 */

var STORES = {
  nanzi:  { branch: '楠梓店', tokenProp: 'NANZI_TOKEN'  },
  dexian: { branch: '德賢店', tokenProp: 'DEXIAN_TOKEN' }
};
var BIND_WINDOW_DAYS = 14;
var CAT_LABEL = { screen: '液晶／螢幕', battery: '電池', port: '尾插排／板', camera: '前後鏡頭', board: '主機板 IC' };

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('缺少指令碼屬性：' + k);
  return v;
}

/* ───────── 入口 ───────── */
function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.key !== prop_('WEBHOOK_KEY')) return ok_();
    var store = STORES[p.store];
    if (!store) return ok_();
    var token = prop_(store.tokenProp);
    var body = JSON.parse(e.postData.contents || '{}');
    (body.events || []).forEach(function (ev) {
      try { handleEvent_(ev, store, token); } catch (err) { console.error(err); }
    });
  } catch (err) {
    console.error(err);
  }
  return ok_();
}

function doGet() { return ContentService.createTextOutput('Repair CARE+ webhook OK'); }
function ok_() { return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON); }

/* ───────── 事件處理 ───────── */
function handleEvent_(ev, store, token) {
  var userId = ev.source && ev.source.userId;
  if (!userId || (ev.source.type && ev.source.type !== 'user')) return;

  if (ev.type === 'unfollow') {
    // 再次向 LINE 確認：已封鎖的使用者查不到個人資料（404）
    if (lineProfileExists_(userId, token)) return;
    patchDoc_('line_users/' + userId, { status: 'blocked', branch: store.branch, updatedAt: new Date().toISOString() });
    return;
  }

  if (ev.type === 'follow') {
    var existing = getDoc_('line_users/' + userId);
    if (existing) {
      patchDoc_('line_users/' + userId, { status: 'friend', updatedAt: new Date().toISOString() });
      reply_(ev.replyToken, token, '歡迎回來！您的 Repair CARE+ 延長保固已恢復 ✅');
    }
    // 第一次加入：歡迎訊息由 LINE 官方帳號後台的「加入好友的歡迎訊息」負責
    return;
  }

  if (ev.type === 'message' && ev.message.type === 'text') {
    var text = String(ev.message.text || '').replace(/[\s\-－]/g, '');
    var m = text.match(/(09\d{8})/);
    var isCare = /CARE/i.test(text);
    if (!m) {
      if (isCare) reply_(ev.replyToken, token, '請輸入「CARE+」加上您維修時留的手機號碼，例如：\nCARE+ 0912345678');
      return; // 其他訊息交給原本的關鍵字自動回覆
    }
    bindCare_(ev, store, token, userId, m[1]);
  }
}

function bindCare_(ev, store, token, userId, phone) {
  var now = new Date();
  var recs = queryByPhone_(phone).filter(function (r) {
    if (r.branch !== store.branch) return false;
    if (!(Number(r.careDays) > 0)) return false;
    var k = daysBetween_(parseYmd_(r.repairDate), now);
    return k >= -1 && k <= BIND_WINDOW_DAYS;
  });

  // 先回覆；回覆成功才寫入資料庫（確認是真的 LINE 事件）
  var msg;
  if (recs.length) {
    var lines = recs.map(function (r) {
      var base = Number(r.baseDays) || 0, care = Number(r.careDays) || 0;
      return '・' + (CAT_LABEL[r.category] || r.type) + '：保固至 ' + fmtYmd_(addDays_(parseYmd_(r.repairDate), base + care)) +
             '（原 ' + base + ' 天＋CARE+ ' + care + ' 天）';
    });
    msg = '✅ Repair CARE+ 已啟用！\n' + store.branch + ' 維修紀錄：\n' + lines.join('\n') +
          '\n\n提醒：申請保固時須為本帳號好友，封鎖期間延長保固不適用。';
  } else {
    msg = '已收到您的 CARE+ 登錄 ✅\n門市建檔後會自動生效（維修日起 ' + BIND_WINDOW_DAYS + ' 天內有效）。\n如有疑問請洽 ' + store.branch + ' 門市人員。';
  }
  if (!reply_(ev.replyToken, token, msg)) return;

  createDoc_('care_bindings', { phone: phone, branch: store.branch, lineUserId: userId, boundAt: now.toISOString(), source: 'line' });
  patchDoc_('line_users/' + userId, { status: 'friend', branch: store.branch, phone: phone, updatedAt: now.toISOString() });
}

/* ───────── LINE API ───────── */
function reply_(replyToken, token, text) {
  if (!replyToken) return false;
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] })
  });
  return res.getResponseCode() === 200;
}

function lineProfileExists_(userId, token) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  return res.getResponseCode() === 200;
}

/* ───────── Firebase（用機器人帳號登入後操作 Firestore）───────── */
function idToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('fb_id_token');
  if (t) return t;
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + prop_('FIREBASE_API_KEY'), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: prop_('BOT_EMAIL'), password: prop_('BOT_PASSWORD'), returnSecureToken: true })
  });
  if (res.getResponseCode() !== 200) throw new Error('Firebase 登入失敗：' + res.getContentText());
  t = JSON.parse(res.getContentText()).idToken;
  cache.put('fb_id_token', t, 3000); // 50 分鐘
  return t;
}

function fsBase_() { return 'https://firestore.googleapis.com/v1/projects/' + prop_('FIREBASE_PROJECT_ID') + '/databases/(default)/documents'; }

function fsFetch_(url, opt) {
  opt = opt || {};
  opt.muteHttpExceptions = true;
  opt.headers = { Authorization: 'Bearer ' + idToken_() };
  if (opt.payload) opt.contentType = 'application/json';
  return UrlFetchApp.fetch(url, opt);
}

function toFields_(obj) {
  var f = {};
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (typeof v === 'number') f[k] = { doubleValue: v };
    else if (typeof v === 'boolean') f[k] = { booleanValue: v };
    else f[k] = { stringValue: String(v) };
  });
  return f;
}

function fromFields_(fields) {
  var o = {};
  Object.keys(fields || {}).forEach(function (k) {
    var v = fields[k];
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('doubleValue' in v) o[k] = v.doubleValue;
    else if ('booleanValue' in v) o[k] = v.booleanValue;
    else o[k] = null;
  });
  return o;
}

function getDoc_(path) {
  var res = fsFetch_(fsBase_() + '/' + path);
  if (res.getResponseCode() !== 200) return null;
  return fromFields_(JSON.parse(res.getContentText()).fields);
}

function patchDoc_(path, obj) {
  var mask = Object.keys(obj).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  var res = fsFetch_(fsBase_() + '/' + path + '?' + mask, { method: 'patch', payload: JSON.stringify({ fields: toFields_(obj) }) });
  if (res.getResponseCode() !== 200) throw new Error('寫入失敗：' + res.getContentText());
}

function createDoc_(col, obj) {
  var res = fsFetch_(fsBase_() + '/' + col, { method: 'post', payload: JSON.stringify({ fields: toFields_(obj) }) });
  if (res.getResponseCode() !== 200) throw new Error('新增失敗：' + res.getContentText());
}

function queryByPhone_(phone) {
  var res = fsFetch_(fsBase_() + ':runQuery', {
    method: 'post',
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'records' }],
      where: { fieldFilter: { field: { fieldPath: 'phone' }, op: 'EQUAL', value: { stringValue: phone } } },
      limit: 50
    } })
  });
  if (res.getResponseCode() !== 200) throw new Error('查詢失敗：' + res.getContentText());
  return JSON.parse(res.getContentText())
    .filter(function (x) { return x.document; })
    .map(function (x) { return fromFields_(x.document.fields); });
}

/* ───────── 日期 ───────── */
function parseYmd_(s) { var a = String(s).slice(0, 10).split('-'); return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2])); }
function addDays_(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function daysBetween_(a, b) { return Math.floor((b - a) / 86400000); }
function fmtYmd_(d) { return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy/MM/dd'); }

/* ───────── 測試用：在編輯器按「執行」可檢查設定是否正確 ───────── */
function testSetup() {
  idToken_();
  console.log('Firebase 機器人登入成功');
  console.log('查詢測試筆數：' + queryByPhone_('0900000000').length);
}
