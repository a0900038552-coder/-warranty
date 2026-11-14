/**
 * 復原者 Repair CARE+ — LINE Webhook（Google Apps Script）
 *
 * 功能：
 *  1. 客人在 LINE 傳「CARE+ 0912345678」或直接傳電話 → 登錄 CARE+，回覆已啟用的保固到期日
 *  2. 客人封鎖官方帳號 → 標記為「已封鎖」（CARE+ 暫停）；重新加入好友 → 自動恢復
 *
 * 自動回覆都用 Reply（不扣額度）；只有員工在保固系統按「確認／改時間／婉拒」才用 Push（扣額度）。
 *
 * 需要在「專案設定 → 指令碼屬性」填入以下 3 項（機密資料，不寫在程式碼裡）：
 *   BOT_PASSWORD            Firebase 機器人帳號（linebot@grandmasterfix.com.tw）的密碼
 *   NANZI_TOKEN             楠梓店 LINE Messaging API 的 Channel access token
 *   DEXIAN_TOKEN            德賢店 LINE Messaging API 的 Channel access token
 *
 * LINE 後台 Webhook 網址填：
 *   楠梓店：<部署網址>?store=nanzi
 *   德賢店：<部署網址>?store=dexian
 *
 * 安全性：所有寫入都會先向 LINE 驗證（回覆成功才登錄、查無個人資料才標記封鎖），
 * 偽造的請求無法寫入資料。
 */

var STORES = {
  nanzi:  { branch: '楠梓店', tokenProp: 'NANZI_TOKEN',  terms: 'nanzi',  quoteText: '請告訴我您的狀況', usedText: '中古機' },
  dexian: { branch: '德賢店', tokenProp: 'DEXIAN_TOKEN', terms: 'dexian', quoteText: '我想索取報價',     usedText: '二手機' }
};
// 保固條款圖片（放在 GitHub Pages，更新保固單時換圖並修改版本號）
var TERMS_BASE = 'https://a0900038552-coder.github.io/-warranty/care/terms/';
var TERMS_VER = '20261114';
function termsImage_(store) {
  return { type: 'image',
    originalContentUrl: TERMS_BASE + store.terms + '.jpg?v=' + TERMS_VER,
    previewImageUrl: TERMS_BASE + store.terms + '_preview.jpg?v=' + TERMS_VER };
}
var BIND_WINDOW_DAYS = 14;
var CARE_INTRO = '🛡 Repair CARE+ 延長保固\n\n' +
  '在本店維修後 14 天內，直接回傳您維修時留的手機號碼（例：0912345678），即可免費啟用延長保固：\n' +
  '・液晶／螢幕、尾插排：＋60 天\n' +
  '・電池：＋90 天\n' +
  '・前後鏡頭、主機板、排線類、中古機：＋30 天\n\n' +
  '申請保固時須為本帳號好友。完整條款請見下圖 👇';
// 公開設定（與保固系統網頁相同，非機密）
var FIREBASE_API_KEY = 'AIzaSyD04ZMXIt8Oo3hjm5qsMaKiLXYzp_9YKwA';
var FIREBASE_PROJECT_ID = 'care-warranty';
var BOT_EMAIL = 'linebot@grandmasterfix.com.tw';
var CAT_LABEL = { screen: '液晶／螢幕', battery: '電池', port: '尾插排／板', camera: '前後鏡頭', board: '主機板 IC', flex: '排線類', used: '中古機' };

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('缺少指令碼屬性：' + k);
  return v;
}

/* ───────── 入口 ───────── */
function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'staff') return json_(staffAction_(JSON.parse(e.postData.contents || '{}')));
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

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'blocks' && STORES[p.store]) return json_({ blocks: blocksFor_(STORES[p.store].branch) });
  return ContentService.createTextOutput('Repair CARE+ webhook OK');
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
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
    if (existing && lineProfileExists_(userId, token)) {
      patchDoc_('line_users/' + userId, { status: 'friend', updatedAt: new Date().toISOString() });
      reply_(ev.replyToken, token, '歡迎回來！您的 Repair CARE+ 延長保固已恢復 ✅');
    }
    // 第一次加入：歡迎訊息由 LINE 官方帳號後台的「加入好友的歡迎訊息」負責
    return;
  }

  if (ev.type === 'message' && ev.message.type === 'text') {
    var raw = String(ev.message.text || '');
    if (/^📅\s*預約申請/.test(raw)) { handleBooking_(ev, store, token, userId, raw); return; }
    var acc = raw.match(/^接受改約\s*#?([A-Za-z0-9]+)$/);
    if (acc) { acceptProposal_(ev, store, token, userId, acc[1]); return; }
    var text = raw.replace(/[\s\-－]/g, '');
    // 只有「單獨一支手機號碼」或「CARE+ 手機號碼」才登錄；
    // 預約、詢問等夾帶電話的訊息（例：王先生0912345678明天換電池）不觸發
    var m = text.match(/^(?:CARE\+?|保固登錄|登錄)?(09\d{8})$/i);
    var isCare = /CARE/i.test(text) || /^(保固|延保|保固條款|延長保固)$/.test(text);
    if (!m) {
      if (isCare) reply_(ev.replyToken, token, [{ type: 'text', text: CARE_INTRO }, termsImage_(store)]);
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
    var lines = [];
    recs.forEach(function (r) {
      // itemsCode 例："battery:90:90|port:30:60"（一筆維修含多個零件時各自計算）
      var parts = String(r.itemsCode || (r.category + ':' + r.baseDays + ':' + r.careDays)).split('|');
      parts.forEach(function (p) {
        var a = p.split(':'), base = Number(a[1]) || 0, care = Number(a[2]) || 0;
        if (!(care > 0)) return;
        lines.push('・' + (CAT_LABEL[a[0]] || r.type) + '：保固至 ' + fmtYmd_(addDays_(parseYmd_(r.repairDate), base + care)) +
                   '（原 ' + base + ' 天＋CARE+ ' + care + ' 天）');
      });
    });
    msg = '✅ Repair CARE+ 已啟用！\n' + store.branch + ' 維修紀錄：\n' + lines.join('\n') +
          '\n\n提醒：申請保固時須為本帳號好友，封鎖期間延長保固不適用。\n保固條款請見下圖 👇';
  } else {
    msg = '已收到您的 CARE+ 登錄 ✅\n門市建檔後會自動生效（維修日起 ' + BIND_WINDOW_DAYS + ' 天內有效）。\n保固條款請見下圖 👇 如有疑問請洽 ' + store.branch + ' 門市人員。';
  }
  if (!reply_(ev.replyToken, token, [{ type: 'text', text: msg }, termsImage_(store)])) return;

  createDoc_('care_bindings', { phone: phone, branch: store.branch, lineUserId: userId, boundAt: now.toISOString(), source: 'line' });
  patchDoc_('line_users/' + userId, { status: 'friend', branch: store.branch, phone: phone, updatedAt: now.toISOString() });
}

/* ───────── LINE API ───────── */
function reply_(replyToken, token, msgs) {
  if (!replyToken) return false;
  var messages = typeof msgs === 'string' ? [{ type: 'text', text: msgs }] : msgs;
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages })
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
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: BOT_EMAIL, password: prop_('BOT_PASSWORD'), returnSecureToken: true })
  });
  if (res.getResponseCode() !== 200) throw new Error('Firebase 登入失敗：' + res.getContentText());
  t = JSON.parse(res.getContentText()).idToken;
  cache.put('fb_id_token', t, 3000); // 50 分鐘
  return t;
}

function fsBase_() { return 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents'; }

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
  return JSON.parse(res.getContentText()).name.split('/').pop();
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


/* ───────── 圖文選單：在編輯器選 setupRichMenu 按「執行」即可為兩間店建立並設為預設 ───────── */
var BOOKING_LIFF_ID = '2012612889-aZuwwjgj';
var RICHMENU_IMG = 'https://a0900038552-coder.github.io/-warranty/care/richmenu.jpg?v=20261114';
function setupRichMenu() {
  var img = UrlFetchApp.fetch(RICHMENU_IMG).getBlob().getBytes();
  Object.keys(STORES).forEach(function (k) {
    var s = STORES[k], token = prop_(s.tokenProp);
    var W = [0, 833, 1666], w = [833, 833, 834], H = [0, 843], h = 843;
    var acts = [
      { type: 'message', label: '維修報價', text: s.quoteText },
      { type: 'uri', label: '立即預約', uri: 'https://liff.line.me/' + BOOKING_LIFF_ID + '?store=' + k },
      { type: 'message', label: 'CARE+延保', text: 'CARE+' },
      { type: 'message', label: '門市導航', text: '地址' },
      { type: 'message', label: '二手機收購', text: s.usedText },
      { type: 'uri', label: '官方網站', uri: 'https://www.grandmasterfix.com.tw/' }
    ];
    var areas = acts.map(function (a, i) {
      return { bounds: { x: W[i % 3], y: H[Math.floor(i / 3)], width: w[i % 3], height: h }, action: a };
    });
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ size: { width: 2500, height: 1686 }, selected: true,
        name: '復原者 6格選單 2026-11', chatBarText: '選單', areas: areas })
    });
    if (res.getResponseCode() !== 200) throw new Error(s.branch + ' 建立失敗：' + res.getContentText());
    var id = JSON.parse(res.getContentText()).richMenuId;
    var up = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', {
      method: 'post', contentType: 'image/jpeg', payload: img, muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token } });
    if (up.getResponseCode() !== 200) throw new Error(s.branch + ' 圖片上傳失敗：' + up.getContentText());
    var def = UrlFetchApp.fetch('https://api.line.me/v2/bot/user/all/richmenu/' + id, {
      method: 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } });
    if (def.getResponseCode() !== 200) throw new Error(s.branch + ' 設為預設失敗：' + def.getContentText());
    console.log(s.branch + ' 圖文選單已上架：' + id);
    // 清掉舊版（由本程式建立、已不再使用的）選單
    var list = JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/list', {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }).getContentText()).richmenus || [];
    list.forEach(function (m) {
      if (m.richMenuId !== id && /^復原者 6格選單/.test(m.name)) {
        UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/' + m.richMenuId, {
          method: 'delete', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
        console.log(s.branch + ' 已移除舊選單：' + m.richMenuId);
      }
    });
  });
}


/* ───────── LINE 預約表單（LIFF）送出的預約 ───────── */
function handleBooking_(ev, store, token, userId, raw) {
  var f = {};
  raw.split('\n').forEach(function (line) {
    var m = line.match(/^(姓名|電話|機型|問題|希望時間|備註)：(.*)$/);
    if (m) f[m[1]] = m[2].trim();
  });
  var msg = '✅ 已收到您的預約！\n\n' +
    '👤 ' + (f['姓名'] || '') + '\n📱 ' + (f['機型'] || '') + '｜' + (f['問題'] || '') + '\n🕐 ' + (f['希望時間'] || '') + '\n\n' +
    store.branch + ' 門市人員確認時段後，會在此聊天室回覆您。\n' +
    '（週一～週六 11:00–21:00，週日公休）';
  if (!reply_(ev.replyToken, token, msg)) return;
  var bid = '';
  try {
    bid = createDoc_('bookings', { branch: store.branch, store: storeKey_(store), lineUserId: userId,
      name: f['姓名'] || '', phone: f['電話'] || '', model: f['機型'] || '', issues: f['問題'] || '',
      wish: f['希望時間'] || '', note: f['備註'] || '', status: 'pending', createdAt: new Date().toISOString() });
  } catch (err) { console.error('預約寫入資料庫失敗：' + err); }
  var id = PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID');
  if (!id) return;
  try {
    var sh = SpreadsheetApp.openById(id).getSheets()[0];
    if (!sh.getRange(1, 10).getValue()) sh.getRange(1, 10).setValue('ID').setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
    sh.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm'), store.branch,
      f['姓名'] || '', "'" + (f['電話'] || ''), f['機型'] || '', f['問題'] || '', f['希望時間'] || '', f['備註'] || '', '待確認', bid
    ]);
  } catch (err) { console.error('預約寫入試算表失敗：' + err); }
}

function storeKey_(store) { for (var k in STORES) if (STORES[k] === store) return k; return ''; }
function storeByBranch_(branch) { for (var k in STORES) if (STORES[k].branch === branch) return STORES[k]; return null; }
var STORE_ADDR = { '楠梓店': '高雄市楠梓區楠梓路10號', '德賢店': '高雄市楠梓區德賢路258號' };

/* ───────── 預約管理（員工在保固系統按按鈕） ───────── */
function staffAction_(req) {
  // 1. 驗證員工：用 Firebase 登入憑證向 Google 確認身分
  var who = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ idToken: req.idToken || '' }) });
  if (who.getResponseCode() !== 200) return { ok: false, error: '登入已失效，請重新登入' };
  var staff = (JSON.parse(who.getContentText()).users || [{}])[0].email || '';
  if (!staff || staff === BOT_EMAIL) return { ok: false, error: '沒有權限' };

  var b = getDoc_('bookings/' + req.id);
  if (!b) return { ok: false, error: '找不到這筆預約' };
  var store = storeByBranch_(b.branch);
  var token = prop_(store.tokenProp);
  var now = new Date().toISOString();
  var text, quick = null, upd = { updatedAt: now, updatedBy: staff };

  if (req.type === 'confirm') {
    var time = req.time || b.proposedTime || b.wish;
    text = '✅ 您的預約已確認\n\n🕐 ' + time + '\n📍 復原者' + b.branch + '（' + STORE_ADDR[b.branch] + '）\n📱 ' + b.model + '｜' + b.issues +
           '\n\n如需更改時間，請直接在此聊天室告訴我們，謝謝！';
    upd.status = 'confirmed'; upd.confirmedTime = time;
  } else if (req.type === 'propose') {
    if (!req.time) return { ok: false, error: '請選擇新的時間' };
    text = '🔄 關於您的預約\n\n您希望的時間（' + b.wish + '）目前無法安排，' + (req.reason ? '原因：' + req.reason + '。' : '') +
           '\n\n建議改為：\n🕐 ' + req.time + '\n📍 復原者' + b.branch + '\n\n可以的話請按下方「接受新時間」；不方便也可以重新選時間 🙏';
    quick = { items: [
      { type: 'action', action: { type: 'message', label: '接受新時間', text: '接受改約 #' + req.id } },
      { type: 'action', action: { type: 'uri', label: '重新選時間', uri: 'https://liff.line.me/' + BOOKING_LIFF_ID + '?store=' + storeKey_(store) } }
    ] };
    upd.status = 'proposed'; upd.proposedTime = req.time;
  } else if (req.type === 'decline') {
    text = '🙏 很抱歉，您的預約（' + b.wish + '）目前無法安排。' + (req.reason ? '\n原因：' + req.reason : '') +
           '\n\n如有需要，歡迎直接在此聊天室與我們討論其他時間，謝謝您！';
    upd.status = 'declined'; upd.declineReason = req.reason || '';
  } else if (req.type === 'done' || req.type === 'noshow' || req.type === 'cancel') {
    upd.status = { done: 'done', noshow: 'noshow', cancel: 'cancelled' }[req.type];   // 不通知客人
  } else return { ok: false, error: '未知的操作' };

  if (text) {
    var msg = { type: 'text', text: text };
    if (quick) msg.quickReply = quick;
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: b.lineUserId, messages: [msg] }) });
    if (res.getResponseCode() !== 200) return { ok: false, error: 'LINE 傳送失敗（可能客人已封鎖或本月訊息額度用完）：' + res.getContentText() };
  }
  patchDoc_('bookings/' + req.id, upd);
  sheetStatus_(req.id, upd.status, upd.confirmedTime || upd.proposedTime || '');
  return { ok: true, status: upd.status };
}

/* 客人按「接受新時間」 */
function acceptProposal_(ev, store, token, userId, id) {
  var b = getDoc_('bookings/' + id);
  if (!b || b.lineUserId !== userId || b.status !== 'proposed') {
    reply_(ev.replyToken, token, '這筆改約已失效或已處理，如有問題請直接留言給我們 🙏'); return;
  }
  var msg = '✅ 預約已確認，謝謝您！\n\n🕐 ' + b.proposedTime + '\n📍 復原者' + b.branch + '（' + STORE_ADDR[b.branch] + '）';
  if (!reply_(ev.replyToken, token, msg)) return;
  patchDoc_('bookings/' + id, { status: 'confirmed', confirmedTime: b.proposedTime, updatedAt: new Date().toISOString(), updatedBy: 'customer' });
  sheetStatus_(id, 'confirmed', b.proposedTime);
}

var STATUS_ZH = { pending: '待確認', confirmed: '已確認', proposed: '已提議改時間', declined: '已婉拒', done: '已完成', noshow: '未到', cancelled: '已取消（未通知）' };
function sheetStatus_(id, status, time) {
  var sid = PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID');
  if (!sid) return;
  try {
    var sh = SpreadsheetApp.openById(sid).getSheets()[0];
    var ids = sh.getRange(1, 10, sh.getLastRow(), 1).getValues();
    for (var i = ids.length - 1; i >= 1; i--) {
      if (String(ids[i][0]) === id) {
        sh.getRange(i + 1, 9).setValue((STATUS_ZH[status] || status) + (time && status !== 'done' && status !== 'noshow' && status !== 'cancelled' ? '：' + time : ''));
        return;
      }
    }
  } catch (err) { console.error('更新試算表狀態失敗：' + err); }
}

/* 封鎖時段（表單讀取用，不含個資） */
function blocksFor_(branch) {
  var res = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'slot_blocks' }],
    where: { fieldFilter: { field: { fieldPath: 'branch' }, op: 'EQUAL', value: { stringValue: branch } } }, limit: 500 } }) });
  if (res.getResponseCode() !== 200) return [];
  return JSON.parse(res.getContentText()).filter(function (x) { return x.document; })
    .map(function (x) { var d = fromFields_(x.document.fields); return d.date + '|' + d.slot; });
}

/* 在編輯器選 setupBookingSheet 按「執行」一次：建立「復原者 LINE 預約紀錄」試算表 */
function setupBookingSheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BOOKING_SHEET_ID');
  if (id) { console.log('已存在：' + SpreadsheetApp.openById(id).getUrl()); return; }
  var ss = SpreadsheetApp.create('復原者 LINE 預約紀錄');
  var sh = ss.getSheets()[0];
  sh.setName('預約');
  sh.appendRow(['送出時間', '分店', '姓名', '電話', '機型', '問題', '希望時間', '備註', '狀態']);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  sh.setColumnWidths(1, 9, 130);
  props.setProperty('BOOKING_SHEET_ID', ss.getId());
  console.log('預約試算表已建立：' + ss.getUrl());
}
