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
    if (p.store === 'quote') { handleQuoteWebhook_(p, JSON.parse(e.postData.contents || '{}')); return ok_(); }
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
    if (/^(配件|配件好康|看配件|配件型錄|配件優惠|配件專區)$/.test(raw.trim())) { reply_(ev.replyToken, token, accessoryCarousel_(storeKey_(store))); return; }
    var text = raw.replace(/[\s\-－]/g, '');
    // 只有「單獨一支手機號碼」或「CARE+ 手機號碼」才登錄；
    // 預約、詢問等夾帶電話的訊息（例：王先生0912345678明天換電池）不觸發
    var m = text.match(/^(?:CARE\+?|保固登錄|登錄)?(09\d{8})$/i);
    var isCare = /CARE/i.test(text) || /^(保固|延保|保固條款|延長保固)$/.test(text);
    if (!m && !isCare && isBookingIntent_(text)) { bookingIntent_(ev, store, token, raw); return; }
    if (!m) {
      if (isCare) reply_(ev.replyToken, token, [{ type: 'text', text: CARE_INTRO }, termsImage_(store)]);
      return; // 其他訊息交給原本的關鍵字自動回覆
    }
    bindCare_(ev, store, token, userId, m[1]);
  }
}

/* ───────── 客人用文字說要預約 → 判讀日期／項目，回覆預填好的預約表單連結（Reply，不扣額度） ───────── */
// 這些字句已由 LINE 後台關鍵字自動回覆處理，避免重複回覆
var BOOKING_OA_KEYWORDS = ['立即預約', '預約', '我要預約', '想預約', '預約時間', '要預約'];
function isBookingIntent_(text) {
  if (BOOKING_OA_KEYWORDS.indexOf(text) >= 0) return false;
  if (!/預約|約時間|約個時間|預定時間/.test(text)) return false;
  if (/取消|改期|改時間|延後|提前|已預約|有預約/.test(text)) return false;   // 已有預約的異動交給真人
  return true;
}

var ISSUE_RULES = [
  ['battery', '換電池', /電池|耗電|掉電|膨脹|充不飽|蓄電/],
  ['screen', '螢幕維修', /螢幕|液晶|面板|玻璃|屏|綠線|黑屏|觸控|摔破|破裂/],
  ['port', '尾插／充電', /尾插|充電孔|充不了電|不能充電|無法充電|充電(?!頭|器|線)/],
  ['water', '泡水', /泡水|進水|掉水|濕掉|淋到/],
  ['board', '不開機／主機板', /不開機|開不了機|無法開機|主機板|主板|當機|一直重開|重開機/],
  ['camera', '鏡頭', /鏡頭|相機|拍照/]
];
var WD_ZH = '日一二三四五六';

function bookingIntent_(ev, store, token, raw) {
  var t = raw.replace(/\s+/g, '');
  var issues = ISSUE_RULES.filter(function (r) { return r[2].test(t); });
  var model = (raw.match(/(?:iphone|i(?=\d))\s?(\d{1,2})\s*(pro\s*max|promax|pro|plus|mini|max|e)?/i) || null);
  var modelStr = model ? 'iPhone ' + model[1] + (model[2] ? ' ' + model[2].replace(/\s+/g, ' ').replace(/promax/i, 'Pro Max').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : '') : '';
  var d = parseWantDate_(t);

  var lines = [], note = '', q = ['store=' + storeKey_(store)];
  if (d && d.past) {
    note = '⚠️ ' + d.label + ' 已經過了，請在表單中重新選擇日期 🙏';
  } else if (d && d.sunday) {
    note = '⚠️ ' + d.label + '（週日）公休，請在表單中改選其他日期 🙏';
  } else if (d) {
    lines.push('📅 日期：' + d.label + '（' + WD_ZH[d.wd] + '）');
    q.push('date=' + d.ymd);
    if (d.far) note = '（線上可預約 14 天內，較遠的日期我們會再跟您確認）';
  }
  if (issues.length) {
    lines.push('🔧 項目：' + issues.map(function (r) { return r[1]; }).join('、'));
    q.push('issue=' + issues.map(function (r) { return r[0]; }).join(','));
  }
  if (modelStr) { lines.push('📱 機型：' + modelStr); q.push('model=' + encodeURIComponent(modelStr)); }

  var url = 'https://liff.line.me/' + BOOKING_LIFF_ID + '?' + q.join('&');
  var msg = (lines.length ? '收到！已幫您預先填好 👇\n' + lines.join('\n') + '\n\n' : '收到！請點下方連結填寫預約 👇\n\n') +
    (note ? note + '\n\n' : '') +
    '點這裡選時段、填姓名電話就完成了：\n' + url + '\n\n' +
    '送出後 ' + store.branch + ' 會在此回覆確認 ✅\n（週一～週六 11:00–21:00，週日公休）';
  reply_(ev.replyToken, token, msg);
}

// 解析「10/13、10月13日、13號、明天、後天、下週三、星期五」等；以台灣時間為準
function parseWantDate_(t) {
  var p = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-M-d').split('-').map(Number);
  var today = Date.UTC(p[0], p[1] - 1, p[2]);
  var DAY = 86400000, target = null, explicitMD = false;
  var m;
  if ((m = t.match(/(\d{1,2})\s*[\/月\.\-]\s*(\d{1,2})\s*[日號号]?/))) {
    var mo = +m[1], da = +m[2];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) { target = Date.UTC(p[0], mo - 1, da); explicitMD = true; }
  } else if ((m = t.match(/(?:^|[^\d])(\d{1,2})\s*[日號号]/))) {
    var dd = +m[1];
    if (dd >= 1 && dd <= 31) { target = Date.UTC(p[0], p[1] - 1, dd); if (target < today) target = Date.UTC(p[0], p[1], dd); }
  } else if (/大後天/.test(t)) target = today + 3 * DAY;
  else if (/後天/.test(t)) target = today + 2 * DAY;
  else if (/明天|明日/.test(t)) target = today + DAY;
  else if (/今天|今日/.test(t)) target = today;
  else if ((m = t.match(/(下下|下個?|這個?|本)?(?:週|周|星期|禮拜)([一二三四五六日天])/))) {
    var want = '日一二三四五六'.indexOf(m[2] === '天' ? '日' : m[2]);
    var cur = new Date(today).getUTCDay();
    var monday = today - ((cur + 6) % 7) * DAY;            // 以週一為一週開始
    var off = ((want + 6) % 7) * DAY;
    if (m[1] && /^下下/.test(m[1])) target = monday + 14 * DAY + off;
    else if (m[1] && /^下/.test(m[1])) target = monday + 7 * DAY + off;
    else if (m[1]) target = monday + off;                   // 這週／本週
    else target = today + ((want - cur + 7) % 7) * DAY;     // 只說「週三」→ 最近的那天
  }
  if (target === null) return null;
  var dt = new Date(target);
  var r = { ymd: Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd'), label: (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate(), wd: dt.getUTCDay() };
  if (target < today) { r.past = true; return r; }
  if (r.wd === 0) r.sunday = true;
  if (target - today > 14 * DAY) r.far = true;
  return r;
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
/* ───────── 圖文選單（兩頁分頁：維修服務／配件好康） ─────────
 * 在編輯器選 setupRichMenu 按「執行」即可兩店一起更新。
 * 換配件 DM 時：更新 GitHub 上的 care/richmenu_tab2.jpg 與 dm/ 圖片後重跑本函式。
 */
var RICHMENU_TAB1 = 'https://a0900038552-coder.github.io/-warranty/care/richmenu_tab1.jpg';
var RICHMENU_TAB2 = 'https://a0900038552-coder.github.io/-warranty/care/richmenu_tab2.jpg';
var DM_URL = 'https://a0900038552-coder.github.io/-warranty/dm/';
var STORE_PHONE = { nanzi: '0900038552', dexian: '0971626883' };   // 兩店電話（例：07-1234567），填好才能上架

function setupRichMenu() {
  var v = '?v=' + Date.now();
  var img1 = UrlFetchApp.fetch(RICHMENU_TAB1 + v).getBlob().getBytes();
  var img2 = UrlFetchApp.fetch(RICHMENU_TAB2 + v).getBlob().getBytes();
  Object.keys(STORES).forEach(function (k) {
    var s = STORES[k], token = prop_(s.tokenProp);
    var phone = String(STORE_PHONE[k] || '').replace(/[^\d+]/g, '');
    if (!phone) throw new Error(s.branch + ' 尚未填電話（STORE_PHONE）');
    var A1 = 'care-tab1', A2 = 'care-tab2';
    var TABH = 195, TOP = 200, TW = 1250;
    var tabs = function (cur) {
      return [
        { bounds: { x: 0, y: 0, width: TW, height: TABH }, action: { type: 'richmenuswitch', richMenuAliasId: A1, data: 'tab=1' } },
        { bounds: { x: TW, y: 0, width: 2500 - TW, height: TABH }, action: { type: 'richmenuswitch', richMenuAliasId: A2, data: 'tab=2' } }
      ];
    };
    // 第 1 頁：維修服務（上排 預約大格＋報價，下排 4 格）
    var rowH = 743, cw = 625;
    var m1 = tabs(1).concat([
      { bounds: { x: 0, y: TOP, width: 1875, height: rowH }, action: { type: 'uri', label: '立即預約', uri: 'https://liff.line.me/' + BOOKING_LIFF_ID + '?store=' + k } },
      { bounds: { x: 1875, y: TOP, width: 625, height: rowH }, action: { type: 'message', label: '維修報價', text: s.quoteText } },
      { bounds: { x: 0, y: TOP + rowH, width: cw, height: 1686 - TOP - rowH }, action: { type: 'message', label: 'CARE+延保', text: 'CARE+' } },
      { bounds: { x: cw, y: TOP + rowH, width: cw, height: 1686 - TOP - rowH }, action: { type: 'uri', label: '撥打電話', uri: 'tel:' + phone } },
      { bounds: { x: cw * 2, y: TOP + rowH, width: cw, height: 1686 - TOP - rowH }, action: { type: 'message', label: '門市導航', text: '地址' } },
      { bounds: { x: cw * 3, y: TOP + rowH, width: 2500 - cw * 3, height: 1686 - TOP - rowH }, action: { type: 'message', label: '二手收購', text: s.usedText } }
    ]);
    // 第 2 頁：配件好康
    var m2 = tabs(2).concat([
      { bounds: { x: 0, y: TOP, width: 1565, height: 1686 - TOP }, action: { type: 'message', label: '配件好康', text: '配件好康' } },
      { bounds: { x: 1565, y: TOP, width: 935, height: rowH }, action: { type: 'uri', label: '維修加價購', uri: DM_URL + '?p=addon&store=' + k } },
      { bounds: { x: 1565, y: TOP + rowH, width: 935, height: 1686 - TOP - rowH }, action: { type: 'message', label: '預訂配件', text: '我想預訂配件' } }
    ]);
    var id1 = createMenu_(token, s.branch, '復原者 分頁選單 維修服務', m1, img1);
    var id2 = createMenu_(token, s.branch, '復原者 分頁選單 配件好康', m2, img2);
    setAlias_(token, A1, id1); setAlias_(token, A2, id2);
    var def = UrlFetchApp.fetch('https://api.line.me/v2/bot/user/all/richmenu/' + id1, {
      method: 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } });
    if (def.getResponseCode() !== 200) throw new Error(s.branch + ' 設為預設失敗：' + def.getContentText());
    console.log(s.branch + ' 分頁選單已上架：' + id1 + ' / ' + id2);
    // 清掉舊版（由本程式建立、已不再使用的）選單
    var list = JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/list', {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }).getContentText()).richmenus || [];
    list.forEach(function (m) {
      if (m.richMenuId !== id1 && m.richMenuId !== id2 && /^復原者 (6格選單|分頁選單)/.test(m.name)) {
        UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/' + m.richMenuId, {
          method: 'delete', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
        console.log(s.branch + ' 已移除舊選單：' + m.richMenuId);
      }
    });
  });
}

function createMenu_(token, branch, name, areas, img) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ size: { width: 2500, height: 1686 }, selected: true, name: name, chatBarText: '選單', areas: areas }) });
  if (res.getResponseCode() !== 200) throw new Error(branch + ' 建立「' + name + '」失敗：' + res.getContentText());
  var id = JSON.parse(res.getContentText()).richMenuId;
  var up = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', {
    method: 'post', contentType: 'image/jpeg', payload: img, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token } });
  if (up.getResponseCode() !== 200) throw new Error(branch + ' 圖片上傳失敗：' + up.getContentText());
  return id;
}

function setAlias_(token, alias, id) {
  var h = { Authorization: 'Bearer ' + token };
  var upd = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/alias/' + alias, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: h,
    payload: JSON.stringify({ richMenuId: id }) });
  if (upd.getResponseCode() === 200) return;
  var cr = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/alias', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: h,
    payload: JSON.stringify({ richMenuAliasId: alias, richMenuId: id }) });
  if (cr.getResponseCode() !== 200) throw new Error('建立選單切換失敗：' + cr.getContentText());
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
var ADDON_TEXT_ = { type: 'text', text: '🎁 維修客人專屬加價購\n修好當天順便貼，滿版保護貼加購只要 $250！\n想加購的話到店時跟我們說，或直接在這裡留言 👇' };
var ADDON_IMG_ = { type: 'image',
  originalContentUrl: 'https://a0900038552-coder.github.io/-warranty/dm/addon.jpg',
  previewImageUrl: 'https://a0900038552-coder.github.io/-warranty/dm/addon_preview.jpg' };
/* 配件輪播卡片（客人打「配件」或點選單「配件好康」時回覆，不扣額度）
 * 換檔期：更新 GitHub 的 care/cards/acc1~6.jpg，並把 ACC_VER 改新日期 */
var ACC_VER = '20261115';
var ACC_CARDS = [
  { img: 'acc1', page: 2, alt: '保護貼 預訂 $531 起' },
  { img: 'acc2', page: 3, alt: '保護殼 惡魔盾 2S 預訂 $1,152 起' },
  { img: 'acc3', page: 4, alt: '鏡頭貼 預訂 $261 起' },
  { img: 'acc4', page: 5, alt: '充電・掛繩 預訂 $162 起' },
  { img: 'acc5', page: 6, alt: '行動電源 預訂 $891 起' },
  { img: 'acc6', page: 8, alt: '組合方案 第 2 片最低 8 折' }
];
function accessoryCarousel_(k) {
  var base = 'https://a0900038552-coder.github.io/-warranty/';
  var bubbles = ACC_CARDS.map(function (c) {
    var url = base + 'dm/?p=catalog&store=' + k + '#p' + c.page;
    return { type: 'bubble', size: 'mega',
      hero: { type: 'image', url: base + 'care/cards/' + c.img + '.jpg?v=' + ACC_VER, size: 'full', aspectRatio: '4:5', aspectMode: 'cover',
        action: { type: 'uri', label: '看型錄', uri: url } },
      footer: { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '10px', contents: [
        { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '看型錄', uri: url } },
        { type: 'button', style: 'primary', color: '#d71920', height: 'sm', action: { type: 'message', label: 'LINE 預訂', text: '我想預訂配件' } }
      ] } };
  });
  return [
    { type: 'text', text: '🎁 2026 秋冬配件好康\n左右滑動看更多 👉　全系列預訂 9 折、現場施工' },
    { type: 'flex', altText: '配件好康：' + ACC_CARDS.map(function (c) { return c.alt; }).join('、'), contents: { type: 'carousel', contents: bubbles } }
  ];
}

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
    var msgs = [msg];
    if (req.type === 'confirm') msgs = [msg, ADDON_TEXT_, ADDON_IMG_];   // 同一次推播多附圖不另計額度
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: b.lineUserId, messages: msgs }) });
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
  if (!reply_(ev.replyToken, token, [{ type: 'text', text: msg }, ADDON_TEXT_, ADDON_IMG_])) return;
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


/* ═════════ 報價小幫手（另一個 LINE 官方帳號，放在同行群組，安靜記錄報價，不在群組發言）═════════
 * 指令碼屬性：
 *   QUOTE_TOKEN  小幫手的 Channel access token（自己貼）
 *   QUOTE_KEY    webhook 網址暗號（執行 setupQuoteHelper 自動產生，防止別人偽造報價）
 *   QUOTE_OWNER  老闆的 LINE 使用者 ID（老闆私訊小幫手「我是老闆」自動設定）
 */
var WEBHOOK_EXEC = 'https://script.google.com/macros/s/AKfycbxBK7c2Oledgo-jT-kRnueuU8grZxVinuocyp2iLI8u-c5Q94fZSeiemH0UkeAqdjfTlw/exec';
function setupQuoteHelper() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('QUOTE_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '').slice(0, 20); props.setProperty('QUOTE_KEY', key); }
  console.log('報價小幫手 Webhook 網址：' + WEBHOOK_EXEC + '?store=quote&k=' + key);
}
function handleQuoteWebhook_(p, body) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('QUOTE_KEY');
  if (!key || p.k !== key) return;
  var token = props.getProperty('QUOTE_TOKEN');
  if (!token) return;
  (body.events || []).forEach(function (ev) { try { quoteEvent_(ev, token, props); } catch (err) { console.error(err); } });
}
function quoteEvent_(ev, token, props) {
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
  var src = ev.source || {}, uid = src.userId || '', text = String(ev.message.text || '').trim();
  var owner = props.getProperty('QUOTE_OWNER') || '';
  if (src.type === 'user') {
    if (text === '我是老闆') {
      if (!owner) { props.setProperty('QUOTE_OWNER', uid); reply_(ev.replyToken, token, '✅ 已設定您為老闆。\n之後您在群組報的價會記成「我的報價」，對象預設是群組名稱；同行報的價記成「同行報價」。\n\n要指定對象可以寫：13 pro 感應排線 3000（大昌）或 @大昌 13 pro 感應排線 3000\n\n也可以直接私訊我報價，我會回覆記錄結果。\n\n店員要加入：請店員私訊我「我是店員' + (props.getProperty('QUOTE_KEY') || '').slice(-4) + '」'); }
      else if (owner === uid) reply_(ev.replyToken, token, '您已經是老闆囉 👍');
      return;
    }
    var code = (props.getProperty('QUOTE_KEY') || '').slice(-4);
    if (code && text.replace(/\s+/g, '') === '我是店員' + code) {
      var team = teamIds_(props); if (team.indexOf(uid) < 0) { team.push(uid); props.setProperty('QUOTE_TEAM', team.join(',')); }
      reply_(ev.replyToken, token, '✅ 已加入店員。之後您在群組回的價格也會記成「我們的報價」。'); return;
    }
    if (uid !== owner) return;            // 私訊只處理老闆
  }
  var mine = !!uid && (uid === owner || teamIds_(props).indexOf(uid) >= 0);
  var gid0 = src.groupId || src.roomId || '';
  // 群組裡客人／同行的問題：記下最近問的機型、維修項目，等我們只回「800」時拿來配對
  if (gid0 && !mine) rememberAsk_(gid0, text, memberName_(src, token), ev.message.id);
  var items = parseQuoteLines_(text);
  if (!mine) items = items.filter(function (q) { return !q.review; });   // 同行訊息：機型＋零件＋價格都有才記
  // 我們在群組只回價格（例：店員問「A71 電池 $?」→ 回「800 要訂」）→ 用前面的問題補上機型／項目
  if (mine && gid0 && (!items.length || items.every(function (q) { return q.review; }))) {
    var ctxItems = contextQuotes_(gid0, text, ev.message.quotedMessageId);
    if (ctxItems.length) items = ctxItems;
  }
  if (!items.length) {
    // 私訊沒有價格 → 當成查價：「13 pro 電池」「查 A54 螢幕」
    if (src.type === 'user') reply_(ev.replyToken, token, lookupQuotes_(text) ||
      '找不到這項的報價紀錄 🤔\n\n查價：直接打機型＋項目，例「13 pro 電池」\n記價：機型＋項目＋價格，例「13 pro 電池 1200」');
    return;
  }
  var gid = src.groupId || src.roomId || '';
  var group = src.groupId ? groupName_(src.groupId, token) : (src.roomId ? '多人聊天' : '私訊');
  var speaker = mine ? '我' : memberName_(src, token);
  var now = new Date(ev.timestamp || Date.now());
  items.forEach(function (q, i) {
    createDoc_('quotes', { ts: now.toISOString(), date: Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd'),
      who: mine ? 'me' : 'peer', speaker: speaker, groupId: gid, group: group,
      model: q.model, part: q.part, price: q.price, raw: q.raw, review: q.review, msgId: ev.message.id + '_' + i,
      kind: q.kind, target: q.target || (mine && src.groupId ? shortTarget_(group) : ''), asker: q.asker || '' });
  });
  if (src.type === 'user') reply_(ev.replyToken, token, '✅ 已記錄 ' + items.length + ' 筆：\n' + items.map(function (q) {
    return '・' + (q.model || '（機型？）') + ' ' + (q.part || '（零件？）') + ' $' + q.price + (q.target ? '（給 ' + q.target + '）' : '') + (q.kind === 'commission' ? '［門號佣金］' : '');
  }).join('\n') + (items.some(function (q) { return q.review; }) ? '\n\n有標「？」的請到報價頁補上。' : ''));
  if (mine && gid0) clearAsk_(gid0);
}

/* ═══ 同行官網價目表（每天自動更新，查價時一起顯示）═══
 * 在編輯器選 setupWebPrices 按「執行」一次：立刻抓一次＋設定每天早上 6 點自動更新
 */
var WEB_SOURCES = [
  { key: 'gs', name: '保衛站', url: 'https://www.guardstation.com.tw/pages/iphone-repair-price', dateRe: /價格更新日期[：:]\s*([\d\/]+)/ },
  { key: 'gsirp', name: '保衛站', url: 'https://www.guardstation.com.tw/pages/irp-repair-price', dateRe: /價格更新日期[：:]\s*([\d\/]+)/, layout: 'rows', prefix: '原廠' },
  // 傻傻修的價目是圖片：價格由 Claude 看圖登打在 SASA_DATA；每天只檢查圖片有沒有換，換了就在查價時提醒
  { key: 'sasa', name: '傻傻修', url: 'https://www.sasamobile.com.tw/price.html', layout: 'static', updated: '115/08/19',
    imgs: ['202608191408256517', '202608191408364993'] },
  { key: 'qg', name: 'Q哥', url: 'https://docs.google.com/spreadsheets/d/1-7xeM1y80unFb8XBMJRci1K22XyK-sXYgPYT5H3DX9Q/htmlembed/sheet?headers=false&gid=0', dateRe: /更新日期\s*(?:<[^>]*>\s*)*([\d\/]+)/ }
];
// 機型｜螢幕｜電池（傻傻修 115/08/19 價目圖）
var SASA_DATA = {
  '螢幕': '17 Pro Max:12000|17:7900|17 Pro:9900|Air:9900|17e:6900|16 Pro Max:9900|16 Pro:8900|16:6500|16 Plus:6500|16e:5900|' +
        '15 Pro Max:8500|15 Pro:7900|15 Plus:5900|15:5500|14 Pro Max:7500|14 Pro:6500|14 Plus:4900|14:4500|' +
        '13 Pro Max:5900|13 Pro:5500|13:3900|13 mini:4800|12 Pro Max:4900|12 Pro:3900|12:3500|12 mini:3500|' +
        '11 Pro Max:3500|11 Pro:3500|11:2900|SE2:2000|SE3:2000|XS Max:2900|XS:2900|XR:2500|X:2500',
  '電池': '17 Pro Max:1990|17:1990|17 Pro:1990|Air:1990|17e:1890|16 Pro Max:1990|16 Pro:1990|16:1890|16 Plus:1890|16e:1790|' +
        '15 Pro Max:1690|15 Pro:1690|15 Plus:1690|15:1690|14 Pro Max:1490|14 Pro:1490|14 Plus:1490|14:1490|' +
        '13 Pro Max:1390|13 Pro:1390|13:1390|13 mini:1390|12 Pro Max:1290|12 Pro:1290|12:1290|12 mini:1290|' +
        '11 Pro Max:990|11 Pro:990|11:990|SE2:790|SE3:890|XS Max:890|XS:890|XR:890|X:890',
  '原廠螢幕': '17 Pro Max:16300|17 Pro:14600|Air:14600|17:14200|17e:12000|16 Pro Max:15900|16 Pro:14300|16 Plus:14300|16:12500|16e:12500|' +
        '15 Pro Max:15900|15 Pro:13900|15 Plus:13900|15:12300|14 Pro Max:15900|14 Pro:13900|14 Plus:13900|14:12300|' +
        '13 Pro Max:13790|13 Pro:12190|13:12190|13 mini:10000|12 Pro Max:13790|12 Pro:12190|12:12190|12 mini:10000|' +
        '11 Pro Max:12900|11 Pro:11190|11:7900',
  '原廠電池': '17 Pro Max:4150|17 Pro:4150|Air:4150|17:3350|17e:3350|16 Pro Max:4150|16 Pro:4150|16 Plus:3350|16:3350|16e:3350|' +
        '15 Pro Max:3350|15 Pro:3350|15 Plus:3350|15:3350|14 Pro Max:3350|14 Pro:3350|14 Plus:3350|14:3350|' +
        '13 Pro Max:2990|13 Pro:2990|13:2990|13 mini:2990|12 Pro Max:2990|12 Pro:2990|12:2990|12 mini:2990|11 Pro Max:2990|11 Pro:2990|11:2990'
};
function sasaRows_() {
  var out = [];
  Object.keys(SASA_DATA).forEach(function (item) {
    SASA_DATA[item].split('|').forEach(function (kv) { var p = kv.split(':'); out.push({ model: 'iPhone ' + p[0], item: item, price: Number(p[1]) }); });
  });
  return out;
}
function setupWebPrices() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshWebPrices') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshWebPrices').timeBased().atHour(6).everyDays(1).inTimezone('Asia/Taipei').create();
  refreshWebPrices();
}
function refreshWebPrices() {
  var props = PropertiesService.getScriptProperties();
  WEB_SOURCES.forEach(function (src) {
    try {
      var res = UrlFetchApp.fetch(src.url, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) { console.error(src.name + ' HTTP ' + res.getResponseCode()); return; }
      var html = res.getContentText('UTF-8');
      if (src.layout === 'static') {
        var same = src.imgs.every(function (id) { return html.indexOf(id) >= 0; });
        props.setProperty('WEB_STALE_' + src.key, same ? '' : '1');
        if (!same) console.error(src.name + '：價目圖已更換，請找 Claude 重新看圖登打');
      }
      var rows = src.layout === 'static' ? sasaRows_() : src.layout === 'rows' ? parseRowTable_(html, src.prefix || '') : parseWebPrices_(html);
      if (rows.length < 30) { console.error(src.name + ' 只讀到 ' + rows.length + ' 筆，網頁可能改版，這次不更新'); return; }
      var dm = src.dateRe && html.match(src.dateRe), updated = src.updated || (dm ? dm[1] : '');
      var hash = 'v2' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows) + updated, Utilities.Charset.UTF_8));
      var run = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
      if (props.getProperty('WEB_HASH_' + src.key) === hash) { props.setProperty('WEB_CHECK_' + src.key, run); console.log(src.name + '：價格沒變（' + rows.length + ' 筆）'); return; }
      var writes = rows.map(function (r) {
        var id = src.key + '_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, r.model + '|' + r.item, Utilities.Charset.UTF_8)).slice(0, 16);
        return { update: { name: 'projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/web_prices/' + id,
          fields: toFields_({ src: src.key, site: src.name, model: r.model, modelKey: wkey_(r.model), item: r.item, part: webPart_(r.item), price: r.price, run: run, updated: updated }) } };
      });
      // 官網已經拿掉的項目，從資料庫刪掉
      var keep = {}; writes.forEach(function (w) { keep[w.update.name] = 1; });
      var old = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'web_prices' }], select: { fields: [{ fieldPath: 'src' }] },
        where: { fieldFilter: { field: { fieldPath: 'src' }, op: 'EQUAL', value: { stringValue: src.key } } }, limit: 5000 } }) });
      if (old.getResponseCode() === 200) JSON.parse(old.getContentText()).forEach(function (x) {
        if (x.document && !keep[x.document.name]) writes.push({ delete: x.document.name });
      });
      for (var i = 0; i < writes.length; i += 400) {
        var c = fsFetch_(fsBase_().replace(/\/documents$/, '/documents:commit'), { method: 'post', payload: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
        if (c.getResponseCode() !== 200) throw new Error(c.getContentText().slice(0, 300));
      }
      props.setProperty('WEB_HASH_' + src.key, hash); props.setProperty('WEB_RUN_' + src.key, run); props.setProperty('WEB_CHECK_' + src.key, run);
      console.log(src.name + '：已更新 ' + rows.length + ' 筆（官網標示更新日 ' + updated + '）');
    } catch (e) { console.error(src.name + ' 更新失敗：' + e); }
  });
}
function wkey_(m) { return String(m || '').toLowerCase().replace(/iphone/g, '').replace(/\s+/g, ''); }
function webPart_(it) {
  var t = String(it), R = [[/電池/, '電池'], [/螢幕|白屏|綠屏/, '螢幕'], [/鏡頭|攝像頭/, '鏡頭'], [/聽筒|揚聲器|喇叭/, '喇叭/聽筒'], [/face ?id|臉部/i, 'Face ID'],
    [/主機板|主板|搬板/, '主板'], [/尾插|尾部充電|充電孔/, '充電孔'], [/泡水/, '泡水'], [/開機|音量|home|靜音|相機控制/i, '按鍵'],
    [/wifi|藍芽|藍牙/i, 'WiFi/藍牙'], [/背蓋|背板|中框/, '背蓋'], [/震動|振動/, '震動器'], [/無線充電/, '無線充電'], [/sim/i, 'SIM']];
  for (var i = 0; i < R.length; i++) if (R[i][0].test(t)) return R[i][1];
  return t;
}
// 讀網頁裡所有表格：遇到「機型／維修項目」那一列當表頭（各欄是機型），之後每列＝維修項目＋各機型價格
function parseWebPrices_(html) {
  var out = [], ent = function (x) { return x.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); };
  (html.match(/<table[\s\S]*?<\/table>/gi) || []).forEach(function (tb) {
    var head = null;
    (tb.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach(function (tr) {
      var cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(function (c) {
        return ent(c.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();
      });
      if (cells.length && /^\d+$/.test(cells[0])) cells.shift();      // Google 試算表的列號
      if (!cells.length) return;
      // 表頭：第一格是「機型／維修項目」，或後面幾格大多是 iPhone 型號（對方表格偶爾把表頭打在別列）
      var mods = cells.slice(1).filter(function (c) { return /^iphone/i.test(c); }).length;
      if (/^(機型|維修項目)$/.test(cells[0]) || mods >= 2) { head = cells.slice(1).map(function (h) { return h.replace(/\s+/g, ' ').trim(); }); return; }
      if (!head || !cells[0]) return;
      for (var i = 1; i < cells.length && i <= head.length; i++) {
        var m = String(cells[i]).split('\n')[0].replace(/,/g, '').match(/^\s*\$?\s*(\d{2,6})/);
        if (m && head[i - 1]) out.push({ model: head[i - 1], item: cells[0].replace(/\s+/g, ' '), price: Number(m[1]) });
      }
    });
  });
  return out;
}
// 另一種表格：每列一個機型、每欄一個維修項目（保衛站原廠零件頁）
function parseRowTable_(html, prefix) {
  var out = [];
  (html.match(/<table[\s\S]*?<\/table>/gi) || []).forEach(function (tb) {
    var head = null;
    (tb.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach(function (tr) {
      var cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(function (c) {
        return c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      });
      if (!cells.length) return;
      if (/機型/.test(cells[0])) { head = cells; return; }
      if (!head || !/^iphone/i.test(cells[0])) return;
      for (var i = 1; i < cells.length && i < head.length; i++) {
        var m = cells[i].replace(/,/g, '').match(/^\s*\$?\s*(\d{2,6})/);
        if (m) out.push({ model: cells[0], item: (/原廠/.test(head[i]) ? '' : prefix) + head[i], price: Number(m[1]) });
      }
    });
  });
  return out;
}
function webQuotes_(model, part) {
  if (!model) return [];
  var props = PropertiesService.getScriptProperties();
  var res = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'web_prices' }], where: { fieldFilter: { field: { fieldPath: 'modelKey' }, op: 'EQUAL', value: { stringValue: wkey_(model) } } }, limit: 300 } }) });
  if (res.getResponseCode() !== 200) return [];
  return JSON.parse(res.getContentText()).filter(function (x) { return x.document; }).map(function (x) { return fromFields_(x.document.fields); })
    .filter(function (r) { return r.run === props.getProperty('WEB_RUN_' + r.src) && (part ? r.part === part : (r.part === '螢幕' || r.part === '電池')); });
}

/* ═══ 私訊查價 ═══ */
function runQuery_(where) {
  var res = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'quotes' }], where: where, limit: 2000 } }) });
  if (res.getResponseCode() !== 200) { console.error(res.getContentText()); return []; }
  return JSON.parse(res.getContentText()).filter(function (x) { return x.document; }).map(function (x) { return fromFields_(x.document.fields); });
}
function lookupQuotes_(text) {
  var q = String(text).replace(/^\s*(幫我)?(查價|查詢|查一下|查)\s*/, '');
  var model = ctxModel_(q), part = partOf_(q);
  if (!model && !part) return '';
  var norm = function (x) { return String(x || '').toLowerCase().replace(/\s+/g, ''); };
  var rows;
  if (part) rows = runQuery_({ fieldFilter: { field: { fieldPath: 'part' }, op: 'EQUAL', value: { stringValue: part } } });
  else {
    var vars = [model, model.toUpperCase(), model.replace(/^VIVO/, 'vivo').replace(/^REDMI/, 'Redmi').replace(/^PIXEL/, 'Pixel').replace(/^REALME/, 'realme').replace(/^SONY/, 'Sony')]
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    rows = runQuery_({ fieldFilter: { field: { fieldPath: 'model' }, op: 'IN', value: { arrayValue: { values: vars.map(function (v) { return { stringValue: v }; }) } } } });
  }
  if (part && !rows.length) rows = [];
  // 自由輸入的零件名（例：感應排線）也一起找
  rows = rows.filter(function (r) { return (!model || norm(r.model) === norm(model)) && (!part || r.part === part || partOf_(r.part) === part); });
  var web = [];
  try { web = webQuotes_(model, part); } catch (e) { console.error(e); }
  if (!rows.length && !web.length) return '';
  rows.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
  var now = Date.now(), day = 86400000;
  var age = function (r) {
    var d = Math.floor((now - Date.parse(r.ts)) / day), lim = r.kind === 'commission' ? [3, 14] : [7, 30];
    return (d <= lim[0] ? '🟢' : d <= lim[1] ? '🟡' : '🔴') + (d === 0 ? '今天' : d + '天前');
  };
  var md = function (r) { return String(r.date || '').slice(5).replace('-', '/'); };
  var money = function (n) { return '$' + Number(n).toLocaleString('en-US'); };
  var groups = {};
  rows.forEach(function (r) { var k = r.model + '｜' + r.part; (groups[k] = groups[k] || []).push(r); });
  var keys = Object.keys(groups).slice(0, 4);
  var out = keys.map(function (k) {
    var g = groups[k], mine = g.filter(function (r) { return r.who === 'me'; }), peer = g.filter(function (r) { return r.who !== 'me'; });
    var lines = ['🔎 ' + k.replace('｜', ' ') + '（共 ' + g.length + ' 筆）'];
    mine.slice(0, 3).forEach(function (r, i) {
      lines.push((i ? '　　' : '我報 ') + money(r.price) + '　' + md(r) + (r.target ? ' 給' + r.target : '') + '　' + age(r) +
        (/\[(.*?)\]/.test(r.raw || '') ? '　' + r.raw.match(/\[(.*?)\]/)[1] : ''));
    });
    peer.slice(0, 2).forEach(function (r, i) { lines.push((i ? '　　' : '同行 ') + money(r.price) + '　' + md(r) + ' ' + (r.speaker || '') + '　' + age(r)); });
    return lines.join('\n');
  });
  if (Object.keys(groups).length > keys.length) out.push('…還有 ' + (Object.keys(groups).length - keys.length) + ' 項，打得更精確一點可縮小範圍');
  if (web.length) {
    var bySite = {};
    web.sort(function (a, b) { return a.price - b.price; }).forEach(function (r) { (bySite[r.site] = bySite[r.site] || []).push(r); });
    var wl = ['🌐 官網價（' + (web[0].model || model) + (part ? ' ' + part : '') + '）'];
    Object.keys(bySite).forEach(function (site) {
      bySite[site].slice(0, part ? 4 : 3).forEach(function (r, i) {
        var stale = !i && PropertiesService.getScriptProperties().getProperty('WEB_STALE_' + r.src) ? '⚠️官網已換新價目，這是舊價' : '';
        wl.push((i ? '　　' : site + ' ') + money(r.price) + '　' + r.item + (i ? '' : '（官網 ' + (r.updated || '?') + ' 更新）' + stale));
      });
    });
    out.push(wl.join('\n'));
  }
  return out.join('\n\n');
}

/* ═══ 一問一答配對（客人問、我們只回價格）═══ */
function teamIds_(props) { return (props.getProperty('QUOTE_TEAM') || '').split(',').filter(String); }
function shortTarget_(g) { return String(g || '').replace(/[\s\-－_]*(手機)?維修.*$/, '').trim() || g; }
var Q_PARTS_ = [['電池', /電池|便池|膨脹|耗電|蓄電|掉電/], ['螢幕', /螢幕|銀幕|屏幕|綠線|亮線|閃屏|線條|面板|液晶|總成|觸控|綠屏|黑屏|破屏|內屏|外屏/],
  ['充電孔', /充電孔|尾插|尾差|充電口|無法充電|不能充電|充不進|充不了/], ['背蓋', /背蓋|背面|後蓋|背板|背玻|後玻|玻璃/], ['鏡頭', /鏡頭|相機|拍照/],
  ['主板', /主板|主機板|不開機|無服務|基頻|sim/i], ['泡水', /泡水|進水|落水|受潮/], ['重刷', /重刷|刷機/], ['排線', /排線/],
  ['喇叭/聽筒', /喇叭|聽筒|麥克風|沒聲音|收音|話筒/], ['Face ID', /face ?id|面容/i], ['按鍵', /home ?鍵|開關鍵|按鍵|音量鍵|電源鍵|側鍵/],
  ['中框', /中框|外框/], ['WiFi/藍牙', /wifi|藍芽|藍牙/i]];
function partOf_(t) { for (var i = 0; i < Q_PARTS_.length; i++) if (Q_PARTS_[i][1].test(t)) return Q_PARTS_[i][0]; return ''; }
function ctxModel_(t) {
  var s = ' ' + String(t).replace(/@\S+/g, ' ').replace(/([\u4e00-\u9fff])([a-z0-9])/gi, '$1 $2').replace(/([a-z0-9])([\u4e00-\u9fff])/gi, '$1 $2')
    .replace(/[，,。？?！!：:$＄()（）]/g, ' ') + ' ';
  var m = s.match(/(?:^|\s)((oppo|vivo|redmi|紅米|小米|poco|pixel|sony|xperia|zenfone|asus|realme|nokia|htc|reno|moto|huawei|honor|nothing)\s*(?:reno\s*|note\s*)?[a-z]*\s*\d+[a-z]*(?:\s*(?:pro\+?|plus|ultra|lite|neo|z))?)(?=\s|$)/i);
  if (m) { var n = m[1].replace(/\s+/g, ' ').trim(); if (/^reno/i.test(n)) n = 'OPPO ' + n; return n.toUpperCase(); }
  var mm = modelOf_(s);
  return mm && !/^iPhone 10\b/.test(mm.name) ? mm.name : '';
}
function rememberAsk_(gid, text, who, msgId) {
  var c = CacheService.getScriptCache(), k = 'qa_' + gid, o = JSON.parse(c.get(k) || '{}'), now = Date.now();
  var md = ctxModel_(text), pt = partOf_(text);
  if (md || pt) {
    if (md) { o.model = md; o.mt = now; if (!pt) { o.part = ''; } }
    if (pt) { o.part = pt; o.pt = now; }
    o.asker = who; c.put(k, JSON.stringify(o), 7200);
  }
  // 每則問題另外記一份（6 小時），我們用「回覆」引用這則時，直接用它配對（同時問兩題也不會配錯）
  if (msgId) {
    var fresh = function (t) { return t && now - t < 7200000; };
    c.put('qm_' + msgId, JSON.stringify({ model: md || (fresh(o.mt) ? o.model : ''), part: pt || (md ? '' : (fresh(o.pt) ? o.part : '')), asker: who }), 21600);
  }
}
function clearAsk_(gid) { CacheService.getScriptCache().remove('qa_' + gid); }
function ctxPrices_(t) {
  t = String(t);
  if (/[a-z]\d+\s*20[12]\d|20[12]\d\s*(版|年)/i.test(t)) t = t.replace(/20[12]\d/g, ' ');
  var c = t.replace(/\d+\.\d+/g, ' ').replace(/\d{1,2}[.:]\d\d/g, ' ').replace(/\d+\s*(%|分|點|天|工作天|號|日|月|年|g|小時|h|台|支|個|折)/gi, ' ').replace(/09\d{8}/g, ' ');
  var re = /(\d{3,5})(?:\s*[-~～到]\s*(\d{3,5}))?/g, m, out = [];
  while ((m = re.exec(c))) { var a = +m[1], b = m[2] ? +m[2] : 0; if (a >= 200 && a <= 80000 && (!b || b > a)) out.push({ lo: a, txt: b ? a + '-' + b : String(a) }); }
  return out;
}
function contextQuotes_(gid, text, quotedId) {
  if (/已收|收到|轉帳|匯款|發票|收款|付款|帳號|總共|合計|找你/.test(text)) return [];
  var cache = CacheService.getScriptCache(), o = JSON.parse(cache.get('qa_' + gid) || '{}'), now = Date.now(), out = [];
  var cm = o.mt && now - o.mt < 7200000 ? o.model : '', cp = o.pt && now - o.pt < 7200000 ? o.part : '';
  var q = quotedId ? JSON.parse(cache.get('qm_' + quotedId) || 'null') : null;
  if (q) { var sameModel = !q.model || q.model === cm; cm = q.model || cm; cp = q.part || (sameModel ? cp : ''); o = { asker: q.asker }; }   // 有引用 → 以被回覆的那則為準
  String(text).split(/\n+/).forEach(function (line) {
    // 「電池1300 螢幕 原裝9400副廠5500」→ 一段一項
    var segs = line.split(/(?=原裝|原廠|副廠|拆機|原\s*\d|副\s*\d)|(?=電池|螢幕|尾插|充電孔|背蓋|背板|鏡頭|主板|聽筒|喇叭|排線)/).filter(function (x) { return ctxPrices_(x).length; });
    if (!segs.length) return;
    var lastPart = '';
    segs.forEach(function (seg) {
      var ps = ctxPrices_(seg); if (!ps.length) return;
      var part = partOf_(seg) || lastPart || partOf_(line) || cp, model = ctxModel_(seg) || ctxModel_(line) || cm;
      lastPart = part;
      if (!model && !part) return;
      var tags = [];
      if (/現貨|有貨|有料/.test(line)) tags.push('現貨');
      if (/要訂|訂貨|客訂|需要訂|調貨|到貨|沒貨/.test(line)) tags.push('需訂貨');
      if (/副廠|副\s*\d/.test(seg)) tags.push('副廠');
      if (/原廠|原裝|原\s*\d/.test(seg)) tags.push('原廠');
      out.push({ raw: (tags.length ? '[' + tags.join('、') + '] ' : '') + line.trim().slice(0, 70) + (ps[0].txt !== String(ps[0].lo) ? ' (' + ps[0].txt + ')' : ''),
        model: model, part: part, price: ps[0].lo, target: '', kind: /佣金|攜碼|門號|續約|新辦|專案|月租/.test(line) ? 'commission' : 'repair',
        review: !model || !part, asker: o.asker || '' });
    });
  });
  return out;
}
function lineGet_(url, token) {
  var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
}
function groupName_(gid, token) {
  var c = CacheService.getScriptCache(), k = 'g_' + gid, v = c.get(k);
  if (v) return v;
  var j = lineGet_('https://api.line.me/v2/bot/group/' + gid + '/summary', token);
  v = (j && j.groupName) || '群組'; c.put(k, v, 21600); return v;
}
function memberName_(src, token) {
  if (!src.userId) return '同行';
  var c = CacheService.getScriptCache(), k = 'm_' + (src.groupId || src.roomId) + '_' + src.userId, v = c.get(k);
  if (v) return v;
  var url = src.groupId ? 'https://api.line.me/v2/bot/group/' + src.groupId + '/member/' + src.userId
          : src.roomId ? 'https://api.line.me/v2/bot/room/' + src.roomId + '/member/' + src.userId : '';
  var j = url ? lineGet_(url, token) : null;
  v = (j && j.displayName) || '同行'; c.put(k, v, 21600); return v;
}

/* ═══ 報價解析（GAS 與報價頁共用；改這段請兩邊一起更新）═══
 * 一則訊息可多行，每行一項：「13 pro 感應排線 3000 元」「i14PM 電池 1200」「S23U 液晶 $5,800」
 */
function parseQuoteLines_(text) {
  var out = [];
  String(text || '').split(/\n+/).forEach(function (line) {
    var raw = line.trim();
    if (!raw || raw.length > 60) return;
    if (/[?？]|多少|幾錢|嗎|有沒有|請問|報價一下|收不收/.test(raw)) return;          // 問句不是報價
    // 報價對象：「@大昌」、結尾「（大昌）」、開頭「大昌：」；沒寫就用群組名稱
    var target = '', body = raw, tm;
    if ((tm = body.match(/[@＠]\s*([^\s\d@＠][^\s@＠]{0,11})/))) { target = tm[1]; body = body.replace(tm[0], ' '); }
    if (!target && (tm = body.match(/[（(]\s*([^（）()\d][^（）()]{0,11})\s*[）)]\s*$/))) { target = tm[1].trim(); body = body.slice(0, tm.index); }
    if (!target && (tm = body.match(/^\s*([^\d\s:：@＠]{1,8})\s*[:：]\s*/))) { target = tm[1]; body = body.slice(tm[0].length); }
    body = body.trim();
    var m = body.match(/(?:NT\$?|\$)?\s*(\d{1,3}(?:,\d{3})+|\d{2,6})\s*(?:元|塊|圓|\$|nt)?\s*(?:\/?\s*(?:個|顆|片|支|組))?\s*$/i);
    if (!m) return;
    var price = Number(m[1].replace(/,/g, ''));
    if (!(price >= 50 && price <= 200000)) return;
    var rest = body.slice(0, m.index).replace(/[:：=＝\-－~～]+\s*$/, '').trim();
    if (!rest) return;
    var mm = modelOf_(rest);
    var part = (mm ? rest.replace(mm.raw, ' ') : rest).replace(/^[\s,，、\/]+|[\s,，、\/]+$/g, '').replace(/\s+/g, ' ');
    if (!part && !mm) return;
    var kind = /佣金|攜碼|門號|續約|新辦|專案|月租|吃到飽/.test(raw) ? 'commission' : 'repair';
    out.push({ raw: raw, model: mm ? mm.name : '', part: part, price: price, target: target, kind: kind, review: !mm || !part });
  });
  return out;
}

function modelOf_(s) {
  var t = String(s), m;
  // iPhone：13 pro、i14pm、iPhone 15 Pro Max、SE3、XR、XS Max、8P
  if ((m = t.match(/(?:^|\s)((?:iphone\s*|ip\s*|i)?(1[0-9]|[6-9])\s*(pro\s*max|promax|pm|pro|plus|mini|max|p|e)?(?=\s|$|[^\da-z]))/i))) {
    var suf = (m[3] || '').toLowerCase().replace(/\s+/g, '');
    var map = { promax: 'Pro Max', pm: 'Pro Max', pro: 'Pro', plus: 'Plus', p: 'Plus', mini: 'mini', max: 'Max', e: 'e' };
    if (!(Number(m[2]) <= 9 && suf === 'pro'))
      return { raw: m[1], name: 'iPhone ' + m[2] + (suf ? ' ' + map[suf] : '') };
  }
  if ((m = t.match(/(?:^|\s)((?:iphone\s*)?(xs\s*max|xsmax|xr|xs|x|se\s*[23]|se))(?=\s|$|[^\da-z])/i)))
    return { raw: m[1], name: 'iPhone ' + m[2].toUpperCase().replace(/\s+/g, ' ').replace('XSMAX', 'XS Max').replace('XS MAX', 'XS Max') };
  // 其他品牌：OPPO A77、Redmi Note 12、ZF12U、Pixel 7
  if ((m = t.match(/(?:^|\s)((oppo|vivo|redmi|紅米|小米|mi|pixel|sony|xperia|zf|zenfone|asus|realme|nokia|htc)\s*[a-z]*\s*\d+[a-z]*(?:\s*(?:pro|plus|ultra|lite|5g))?)(?=\s|$)/i)))
    return { raw: m[1], name: m[1].replace(/\s+/g, ' ').toUpperCase() };
  // Samsung：S23U、S24 Ultra、A52s、Note20、Z Flip5
  if ((m = t.match(/(?:^|\s)((?:samsung\s*|三星\s*)?(s|a|m|note\s*)(\d{1,2})\s*(ultra|u|plus|\+|fe|s|5g)?)(?=\s|$|[^\da-z])/i))) {
    var sx = (m[4] || '').toLowerCase(), smap = { ultra: ' Ultra', u: ' Ultra', plus: '+', '+': '+', fe: ' FE', s: 's', '5g': ' 5G' };
    return { raw: m[1], name: 'Samsung ' + m[2].replace(/\s+/g, '').replace(/^note$/i, 'Note').toUpperCase().replace('NOTE', 'Note') + m[3] + (smap[sx] || '') };
  }
  if ((m = t.match(/(?:^|\s)((?:z\s*)?(flip|fold)\s*(\d))(?=\s|$)/i)))
    return { raw: m[1], name: 'Samsung Z ' + m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() + m[3] };
  return null;
}
