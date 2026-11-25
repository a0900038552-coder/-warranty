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
    if (p.action === 'login') return json_(loginAlert_(JSON.parse(e.postData.contents || '{}')));
    if (p.action === 'refundNotice') return json_(refundNotice_(JSON.parse(e.postData.contents || '{}')));
    if (p.action === 'usedPhoto') return json_(usedPhoto_(JSON.parse(e.postData.contents || '{}')));
    if (p.action === 'resv') return json_(resvAction_(JSON.parse(e.postData.contents || '{}')));
    if (p.action === 'orderSubmit') return json_(orderSubmit_(JSON.parse(e.postData.contents || '{}')));
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
  if (p.action === 'autoReplySetup') return json_({ url: setupAutoReply() });
  if (p.action === 'depositSetup') return json_({ url: setupDeposit() });
  if (p.action === 'resvReminderSetup') return json_(setupResvReminder());
  if (p.action === 'orderGet') return json_(orderGet_(String(p.t || '')));
  if (p.action === 'basicIds') return json_({ nanzi: basicId_('nanzi'), dexian: basicId_('dexian') });
  if (p.action === 'autoReplyTransfer') return json_(addTransferReply_());
  if (p.action === 'orderView') return json_(orderView_(String(p.k || '')));
  if (p.action === 'ics') return visitIcs_(String(p.k || ''));
  if (p.action === 'visitReminderSetup') return json_(setupVisitReminder());
  if (p.action === 'autoReplyTest') {   // 測試：這句話在某間店會不會觸發自動回覆（不會真的傳訊息）
    var st = STORES[p.store] || STORES.nanzi, rows = autoReplyRows_(), q = String(p.q || '').replace(/\s+/g, '').toLowerCase(), hit = -1;
    for (var i = 0; i < rows.length; i++) { var r = rows[i]; if ((r.branch === '全部' || r.branch === st.branch) && r.keys.some(function (k) { return q.indexOf(k) >= 0; })) { hit = i; break; } }
    return json_({ store: st.branch, rows: rows.length, keys: rows.map(function (r) { return r.keys.join('、') + '｜' + r.branch; }), hit: hit, reply: hit >= 0 ? rows[hit].text.slice(0, 60) : '' });
  }   // 建立／找到「自動回覆」分頁，回傳試算表網址（試算表本身仍只有老闆能開）
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

  if (ev.type === 'postback') { depositPostback_(ev, store, token, userId); return; }

  if (ev.type === 'message' && ev.message.type === 'text') {
    var raw = String(ev.message.text || '');
    if (/^\s*\d{5}\s*$/.test(raw) && depositLast5_(ev, store, token, userId, raw.trim())) return;   // 匯款末五碼
    var onum = raw.match(/訂單\s*[#＃]?\s*(U\d{7})/i);
    if (onum) { orderPayInfo_(ev, store, token, userId, onum[1].toUpperCase()); return; }
    if (/^📅\s*預約申請/.test(raw)) { handleBooking_(ev, store, token, userId, raw); return; }
    var acc = raw.match(/^接受改約\s*#?([A-Za-z0-9]+)$/);
    if (acc) { acceptProposal_(ev, store, token, userId, acc[1]); return; }
    if (/^(配件|配件好康|看配件|配件型錄|配件優惠|配件專區)$/.test(raw.trim())) { reply_(ev.replyToken, token, accessoryCarousel_(storeKey_(store))); return; }
    if (/^我有興趣[:：]/.test(raw.trim())) { usedInterest_(ev, store, token, raw.trim()); return; }
    if (isUsedShopIntent_(raw)) { reply_(ev.replyToken, token, usedShowcase_(store)); autoLog_(store.branch, raw.replace(/\s+/g, ''), '中古機現貨', ''); return; }
    var text = raw.replace(/[\s\-－]/g, '');
    // 只有「單獨一支手機號碼」或「CARE+ 手機號碼」才登錄；
    // 預約、詢問等夾帶電話的訊息（例：王先生0912345678明天換電池）不觸發
    var m = text.match(/^(?:CARE\+?|保固登錄|登錄)?(09\d{8})$/i);
    var isCare = /CARE/i.test(text) || /^(保固|延保|保固條款|延長保固)$/.test(text);
    if (!m && !isCare && isBookingIntent_(text)) { autoLog_(store.branch, text, '預約判讀', ''); bookingIntent_(ev, store, token, raw); return; }
    if (!m) {
      if (isCare) reply_(ev.replyToken, token, [{ type: 'text', text: CARE_INTRO }, termsImage_(store)]);
      else autoReply_(ev, store, token, raw);   // Google 試算表「自動回覆」分頁有對到關鍵字就回；沒對到就不回（留給店員／後台關鍵字）
      return;
    }
    bindCare_(ev, store, token, userId, m[1]);
  }
}

/* ───────── 自動回覆（Google 試算表「復原者 LINE 預約紀錄」的「自動回覆」分頁）─────────
 * 欄位：啟用(Ｖ) ｜ 關鍵字（用「、」或「,」隔開，客人訊息有出現任一個就回）｜ 分店（全部／楠梓店／德賢店）｜ 回覆內容
 * 老闆直接在試算表改，5 分鐘內生效。第一次：在編輯器選 setupAutoReply → 執行（會建立分頁＋範例）。
 * Reply 回覆不扣訊息額度。
 */
var AUTO_SHEET = '自動回覆';
function autoReplyRows_() {
  var c = CacheService.getScriptCache(), hit = c.get('auto_reply_rows');
  if (hit) return JSON.parse(hit);
  var id = PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID'), rows = [];
  try {
    var sh = id && SpreadsheetApp.openById(id).getSheetByName(AUTO_SHEET);
    if (sh && sh.getLastRow() > 1) rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
      .filter(function (r) { return String(r[0]).trim() && String(r[1]).trim() && String(r[3]).trim(); })
      .map(function (r) {
        return { keys: String(r[1]).split(/[、,，\n]/).map(function (k) { return k.replace(/\s+/g, '').toLowerCase(); }).filter(String),
                 branch: String(r[2] || '全部').trim() || '全部', text: String(r[3]).trim().slice(0, 4900), issue: String(r[4] || '').trim() };
      });
  } catch (err) { console.error('自動回覆讀取失敗：' + err); }
  c.put('auto_reply_rows', JSON.stringify(rows), 300);
  return rows;
}
function autoReply_(ev, store, token, raw) {
  var t = String(raw || '').replace(/\s+/g, '').toLowerCase();
  if (!t || t.length > 300) return false;
  var rows = autoReplyRows_();
  console.log('自動回覆檢查 ' + store.branch + '：' + rows.length + ' 則規則，訊息「' + t.slice(0, 40) + '」');
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.branch !== '全部' && r.branch !== store.branch) continue;
    if (r.keys.some(function (k) { return t.indexOf(k) >= 0; })) {
      var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text', text: r.text + '\n\n👇 想預約或直接問門市，點下方按鈕', quickReply: bookingQuick_(store, raw, r.issue) }] })
      });
      var code = res.getResponseCode(), body = res.getContentText().slice(0, 200);
      if (code !== 200) { var ok2 = reply_(ev.replyToken, token, r.text); body += ' → 改傳純文字' + (ok2 ? '成功' : '失敗'); }   // 按鈕被 LINE 拒收時至少回文字
      autoLog_(store.branch, t, '第' + (i + 2) + '列', code + ' ' + body);
      return true;
    }
  }
  autoLog_(store.branch, t, '沒對到', '');
  return false;
}
// 自動回覆下方的快速按鈕：📅 立即預約（預先填好分店／項目／機型）、📞 打電話
// 項目：試算表 E 欄「預約項目」（螢幕維修／換電池／尾插／充電／泡水／不開機／主機板／鏡頭），沒填就從客人訊息判斷
function bookingQuick_(store, raw, issueLabel) {
  var t = String(raw || '').replace(/\s+/g, ''), codes = [];
  var LABEL = { '螢幕維修': 'screen', '螢幕': 'screen', '換電池': 'battery', '電池': 'battery', '尾插／充電': 'port', '尾插': 'port', '充電': 'port',
                '泡水': 'water', '進水': 'water', '不開機／主機板': 'board', '主機板': 'board', '不開機': 'board', '鏡頭': 'camera' };
  String(issueLabel || '').split(/[、,，\/]/).forEach(function (x) { var c = LABEL[x.trim()]; if (c && codes.indexOf(c) < 0) codes.push(c); });
  if (!codes.length) ISSUE_RULES.forEach(function (r) { if (r[2].test(t)) codes.push(r[0]); });
  var q = ['store=' + storeKey_(store)];
  if (codes.length) q.push('issue=' + codes.join(','));
  var model = raw.match(/(?:iphone|i(?=\d))\s?(\d{1,2})\s*(pro\s*max|promax|pro|plus|mini|max|e)?/i);
  if (model) q.push('model=' + encodeURIComponent('iPhone ' + model[1] + (model[2] ? ' ' + model[2].replace(/\s+/g, ' ').replace(/promax/i, 'Pro Max').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : '')));
  var items = [{ type: 'action', action: { type: 'uri', label: '📅 立即預約', uri: 'https://liff.line.me/' + BOOKING_LIFF_ID + '?' + q.join('&') } }];
  var phone = String(STORE_PHONE[storeKey_(store)] || '').replace(/[^\d+]/g, '');
  if (phone) items.push({ type: 'action', action: { type: 'uri', label: '📞 打電話給' + store.branch, uri: 'tel:' + phone } });
  return { items: items };
}
// 除錯用：記在試算表「自動回覆紀錄」分頁（只有老闆看得到），只留最近 30 筆
function autoLog_(branch, text, hit, result) {
  try {
    var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID'));
    var sh = ss.getSheetByName('自動回覆紀錄') || ss.insertSheet('自動回覆紀錄');
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, 5).setValues([[Utilities.formatDate(new Date(), 'Asia/Taipei', 'MM/dd HH:mm:ss'), branch, text.slice(0, 40), hit, result]]);
    if (sh.getLastRow() > 30) sh.deleteRows(31, sh.getLastRow() - 30);
  } catch (e) { console.error(e); }
}
function setupAutoReply() {
  var id = PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID');
  if (!id) throw new Error('找不到預約試算表，請先執行 setupBookingSheet');
  var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(AUTO_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AUTO_SHEET);   // 加在最後面，不影響第一個分頁（預約紀錄）
    sh.getRange(1, 1, 1, 5).setValues([['啟用（Ｖ＝開）', '關鍵字（用「、」隔開，客人訊息有出現任一個就回）', '分店（全部／楠梓店／德賢店）', '回覆內容（可換行）', '預約項目（選填：螢幕維修／換電池／尾插／充電／泡水／不開機／主機板／鏡頭）']])
      .setFontWeight('bold').setBackground('#1e2027').setFontColor('#ffffff');
    sh.getRange(2, 1, AUTO_SAMPLES_.length, 4).setValues(AUTO_SAMPLES_);
    sh.setFrozenRows(1); sh.setColumnWidth(1, 90); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 120); sh.setColumnWidth(4, 520);
    sh.getRange(1, 1, 60, 4).setWrap(true).setVerticalAlignment('top');
  }
  CacheService.getScriptCache().remove('auto_reply_rows');
  return ss.getUrl() + '#gid=' + sh.getSheetId();
}
// 新增「資料轉移（換新機）」自動回覆：插在「資料救援」那列前面，並把轉移類關鍵字從資料救援拿掉（重複執行不會多加）
var TRANSFER_KEYS_ = '資料轉移、轉移資料、轉資料、資料對傳、對傳、資料移轉、移轉資料、資料搬、搬資料、轉到新手機、傳到新手機、換新機、新機資料、舊機資料、新手機資料、舊手機資料、line轉移、line移轉、聊天紀錄轉';
var TRANSFER_TEXT_ = '您好～換新手機想把舊手機的資料搬過去，我們可以幫您處理 👍\n\n' +
  '🔸 可以轉移：照片、影片、聯絡人、LINE 聊天紀錄、App 和設定等。\n' +
  '🔸 iPhone → iPhone、Android → Android 都可以；Android ↔ iPhone 跨系統，部分資料（例如 LINE 聊天紀錄）會有限制，到店我們先幫您確認。\n' +
  '🔸 請兩支手機都帶來，並記得兩支手機的解鎖密碼，以及 Apple ID／Google 帳號密碼。\n' +
  '🔸 轉移時間依資料量而定，資料多的話會需要比較久。\n\n' +
  '如果舊手機已經壞了、不開機，處理方式不一樣，請改問「資料救援」喔。\n\n' +
  '歡迎告訴我們兩支手機的型號，我們幫您安排時間 😊';
function addTransferReply_() {
  var sh = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID')).getSheetByName(AUTO_SHEET);
  var vals = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 5).getValues();
  if (vals.some(function (r) { return /資料對傳/.test(String(r[1])); })) return { ok: true, note: '已經有了' };
  var rescue = -1;
  vals.forEach(function (r, i) { if (rescue < 0 && /救資料/.test(String(r[1]))) rescue = i; });
  if (rescue >= 0) {   // 資料救援那列：拿掉轉移類關鍵字
    var keep = String(vals[rescue][1]).split('、').filter(function (k) { return ['轉移資料', '資料轉移', '轉資料'].indexOf(k.trim()) < 0; }).join('、');
    sh.getRange(rescue + 2, 2).setValue(keep);
  }
  var at = rescue >= 0 ? rescue + 2 : sh.getLastRow() + 1;
  sh.insertRowBefore(at);
  sh.getRange(at, 1, 1, 5).setValues([['Ｖ', TRANSFER_KEYS_, '全部', TRANSFER_TEXT_, '']]).setWrap(true).setVerticalAlignment('top');
  CacheService.getScriptCache().remove('auto_reply_rows');
  return { ok: true, row: at };
}
var AUTO_SAMPLES_ = [
  ['Ｖ', '單換玻璃、只換玻璃、換玻璃、單換螢幕玻璃、外玻璃、玻璃破', '全部',
   '您好～關於「單換玻璃」（只換螢幕最外層的玻璃）跟您說明一下：\n\n' +
   '🔸 單換玻璃要先把破掉的玻璃從螢幕上分離、再重新貼合，工序多、耗時長，過程中螢幕很容易受損漏液。\n' +
   '🔸 就算當下看起來修好了，用一段時間後也常出現線條、黑點、觸控失靈或不顯示等狀況。\n' +
   '🔸 因為風險高，單換玻璃無法提供保固。\n\n' +
   '✅ 建議直接更換整片螢幕：品質穩定、維修時間短，而且有提供保固，之後用起來比較安心。\n\n' +
   '歡迎告訴我們手機型號，我們幫您報價 😊'],
  ['Ｖ', '黑點、黑斑、墨點、黑影、黑塊、漏液', '全部',
   '您好～螢幕上出現黑點、而且越來越大，通常是「螢幕漏液」：\n\n' +
   '🔸 多半是手機曾經受到外力擠壓或撞擊，例如摔到、放在後口袋被坐到、包包裡被壓到，讓螢幕內部的顯示層受損。\n' +
   '🔸 漏液會慢慢擴散：黑點變大、出現線條，最後可能整片不顯示或無法觸控。\n' +
   '🔸 漏液沒辦法只修局部，需要更換整片螢幕。\n\n' +
   '建議盡早處理，並先把重要資料備份。歡迎告訴我們手機型號，我們幫您報價 😊'],
  ['Ｖ', '線條、彩色線、直線、橫線、單換排線、只換排線、螢幕排線', '全部',
   '您好～螢幕出現線條，大多是螢幕本身（顯示層或螢幕內部排線）受損造成的：\n\n' +
   '🔸 「單換螢幕排線」需要把螢幕拆開重新接合，跟單換玻璃一樣工序精細、風險高，修完一段時間後容易再出現線條、閃爍或不顯示。\n' +
   '🔸 因此單換排線無法提供保固。\n\n' +
   '✅ 建議更換整片螢幕：品質穩定，而且有提供保固，比較安心。\n\n' +
   '歡迎告訴我們手機型號，我們幫您報價 😊']
];

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

// 退修比對（跟保固系統一樣）：同電話同分店，對到原維修日；沒寫日期就對品項
function coreItem_(t) { return String(t || '').replace(/^\d{1,2}[\/.]\d{1,2}\s*/, '').replace(/\s+/g, ''); }
function refundedBy_(r, all) {
  return all.filter(function (x) {
    return x.kind === 'refund' && x.phone === r.phone && x.branch === r.branch &&
      (x.origDate ? x.origDate === r.repairDate : (coreItem_(x.origItem) && coreItem_(r.type).indexOf(coreItem_(x.origItem)) >= 0));
  });
}
function bindCare_(ev, store, token, userId, phone) {
  var now = new Date();
  var all = queryByPhone_(phone);
  var recs = all.filter(function (r) {
    if (r.kind === 'refund' || refundedBy_(r, all).length) return false;   // 已退修的維修沒有保固
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

function fromVal_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) return fromFields_(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromVal_);
  return null;
}
function fromFields_(fields) {
  var o = {};
  Object.keys(fields || {}).forEach(function (k) { o[k] = fromVal_(fields[k]); });
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

// 一次寫入多筆（一個請求就好，比一筆一筆快）
function createDocs_(col, objs) {
  if (!objs.length) return;
  var base = 'projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + col + '/';
  var writes = objs.map(function (o) {
    return { update: { name: base + Utilities.getUuid().replace(/-/g, '').slice(0, 20), fields: toFields_(o) }, currentDocument: { exists: false } };
  });
  var res = fsFetch_(fsBase_() + ':commit', { method: 'post', payload: JSON.stringify({ writes: writes }) });
  if (res.getResponseCode() !== 200) throw new Error('新增失敗：' + res.getContentText().slice(0, 300));
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
var SHOP_URL = 'https://a0900038552-coder.github.io/used-phones/';  // 官網線上逛逛（中古機詳細頁＋配件選購）
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

/* ───────── 中古機現貨（客人在 LINE 問「有什麼二手機」→ 左右滑動的卡片） ─────────
 * 清單由「中古機庫存」頁（care/stock.html）自動整理寫到 settings/used_showcase（在庫＋有建議售價＋沒勾不上架）。
 * 只放客人看得到的欄位，不含成本、IMEI、最低價。每次查詢只讀 1 筆資料。
 */
function isUsedShopIntent_(raw) {
  var t = String(raw || '').replace(/\s+/g, '');
  if (/^(中古機|二手機)$/.test(t)) return false;   // 圖文選單「二手收購」按鈕送出的字，交給原本的收購回覆
  if (/收購|回收|估價|折抵|舊機換|我要賣|想賣|賣給|賣掉|收嗎|收不收|收二手|收中古/.test(t)) return false;   // 客人要賣給我們，不是要買
  if (/^(看)?(中古機|二手機)(現貨|庫存|有哪些)$/.test(t)) return true;
  return /中古|二手|福利機|整新機/.test(t) && /買|賣|有|看|挑|推薦|庫存|現貨|哪些|什麼|價|款|機型|預算/.test(t);
}
function usedShowcase_(store) {
  var doc = getDoc_('settings/used_showcase'), items = [];
  try { items = JSON.parse((doc && doc.json) || '[]'); } catch (e) {}
  var held = {}; activeResv_().forEach(function (r) { held[r.usedId] = 1; });
  items = items.filter(function (it) { return !held[it.id]; });   // 已經有人預約看機／保留的不顯示
  var k = storeKey_(store), phone = String(STORE_PHONE[k] || '').replace(/[^\d+]/g, '');
  var quick = { items: [{ type: 'action', action: { type: 'uri', label: '📞 打電話給' + store.branch, uri: 'tel:' + phone } }] };
  if (!items.length) return [{ type: 'text', quickReply: quick,
    text: '您好～目前中古機現貨剛好都賣完了 🙏\n\n可以告訴我們想找的機型、容量和預算，有適合的貨會優先通知您 😊' }];
  items.sort(function (a, b) { return (a.branch === store.branch ? 0 : 1) - (b.branch === store.branch ? 0 : 1); });   // 這間店的排前面
  var more = items.length > 12 ? items.length - 12 : 0;
  var bubbles = items.slice(0, 12).map(function (it) {
    var extra = [it.waterproof ? '氣密正常' : '', it.box ? '盒裝' : '', it.cable ? '原廠線' : '', it.acc].filter(String).join('・');
    var lines = [];
    if (it.cond) lines.push('機況：' + it.cond);
    if (it.battery) lines.push('電池健康度：' + String(it.battery).replace(/%$/, '') + '%');
    if (extra) lines.push('附：' + extra);
    var body = [
      { type: 'text', text: it.branch || '門市', size: 'xs', color: '#d71920', weight: 'bold' },
      { type: 'text', text: it.model || '中古機', size: 'lg', weight: 'bold', wrap: true },
    ];
    if (it.color) body.push({ type: 'text', text: it.color, size: 'sm', color: '#6b7280', wrap: true });
    body.push({ type: 'text', text: '$' + Number(it.price).toLocaleString('en-US'), size: 'xxl', weight: 'bold', color: '#d71920', margin: 'md' });
    lines.forEach(function (l) { body.push({ type: 'text', text: l, size: 'sm', color: '#374151', wrap: true }); });
    var label = (it.model + (it.color ? ' ' + it.color : '')).slice(0, 40);
    var photos = (it.photos || []).filter(String), gallery = 'https://a0900038552-coder.github.io/-warranty/care/photos.html?t=' +
      encodeURIComponent(label + '（' + it.branch + '）$' + it.price) + '&p=' + photos.join(',');
    var foot = [{ type: 'button', style: 'primary', color: '#d71920', height: 'sm',
      action: { type: 'postback', label: '📅 預約看機', data: 'act=dep&id=' + it.id, displayText: '我要預約看機：' + label } },
      { type: 'button', style: 'link', height: 'sm',
      action: { type: 'message', label: '💬 先問問題', text: '我有興趣：' + label + '（' + it.branch + '）$' + it.price } }];
    // 官網詳細頁：照片＋檢測報告＋推薦配件（含滿額折），按「LINE 詢問」會帶著配件清單回到聊天室
    var shop = SHOP_URL + '?src=line#item=' + encodeURIComponent(it.id);
    foot.unshift({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '📷 照片・檢測・加購配件', uri: shop } });
    var bubble = { type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: foot } };
    if (photos.length) bubble.hero = { type: 'image', url: photoUrl_(photos[0]), size: 'full', aspectRatio: '1:1', aspectMode: 'cover',
      action: { type: 'uri', label: '看照片', uri: shop } };
    return bubble;
  });
  return [
    { type: 'text', text: '📱 目前中古機現貨 ' + items.length + ' 台（' + store.branch + '的排前面）\n左右滑動看更多 👉\n\n有興趣就按「📅 預約看機」選到店時間（不用付訂金）；想先問問題按「💬 先問問題」，店員會盡快回覆您。也歡迎直接到店看機 😊' +
      (more ? '\n\n（還有 ' + more + ' 台沒列出，告訴我們想找的機型幫您查）' : '') },
    { type: 'flex', altText: '中古機現貨 ' + items.length + ' 台', quickReply: quick, contents: { type: 'carousel', contents: bubbles } }
  ];
}
/* 中古機照片：庫存頁上傳 → 存到老闆 Google 雲端硬碟「復原者中古機照片」資料夾（知道連結的人可看），回傳檔案 ID
 * LINE 卡片用 https://lh3.googleusercontent.com/d/<ID>=w1000 顯示。只有員工帳號能上傳／刪除。
 */
var PHOTO_FOLDER = '復原者中古機照片';
function usedPhoto_(req) {
  var who = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: req.idToken || '' }) });
  if (who.getResponseCode() !== 200) return { ok: false, error: '登入已失效，請重新整理頁面' };
  var staff = String((JSON.parse(who.getContentText()).users || [{}])[0].email || '').toLowerCase();
  if (ALLOWED_EMAILS.indexOf(staff) < 0 || staff === BOT_EMAIL) return { ok: false, error: '沒有權限' };
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER), folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
  if (req.del) {   // 刪除：只刪這個資料夾裡的檔案
    try { var f = DriveApp.getFileById(String(req.del)); if (f.getParents().hasNext() && f.getParents().next().getId() === folder.getId()) f.setTrashed(true); } catch (e) {}
    return { ok: true };
  }
  var data = String(req.data || '').replace(/^data:image\/\w+;base64,/, '');
  if (!data || data.length > 4000000) return { ok: false, error: '照片太大或是空的' };
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', String(req.name || 'photo').slice(0, 80) + '.jpg'));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  file.setDescription('上傳：' + staff);
  return { ok: true, id: file.getId() };
}
function photoUrl_(id, w) { return 'https://lh3.googleusercontent.com/d/' + id + '=w' + (w || 1000); }

/* ───────── 中古機訂金：付訂金保留 → 選匯款／LINE Pay → 回報 → 禮包 → 店員確認 ─────────
 * 試算表「付款設定」：分店｜銀行｜帳號｜戶名｜LINE Pay 收款碼圖片網址（老闆自己填，不寫在程式裡）
 * 試算表「訂金禮包」：啟用｜名稱｜內容｜加價（0＝免費）
 * 資料表 reservations：status pending（客人回報已付，待店員對帳）→ paid（店員確認，開始保留 3 天）→ done／cancelled
 */
var HOLD_DAYS = 3;
var DEP_RULES = '・到店驗機，機況與說明不符或不滿意：訂金全額退還\n・付款後、店員確認入帳之前取消：訂金全額退還（尚未為您備貨）\n・店員確認入帳後（已開始為您備貨），因個人因素取消或超過保留期限未取機：扣除所選禮包原價後，退還其餘訂金';
function depositOf_(price) { return Math.max(1, Math.ceil(Number(price || 0) / 5000)) * 1000; }   // 5000 以下 1000，每 5000 加 1000
function setupDeposit() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID'));
  if (!ss.getSheetByName('付款設定')) {
    var a = ss.insertSheet('付款設定');
    a.getRange(1, 1, 3, 5).setValues([['分店', '銀行（含代碼）', '帳號', '戶名', 'LINE Pay 收款碼圖片網址（選填）'],
      ['楠梓店', '（例：012 台北富邦）', '', '', ''], ['德賢店', '', '', '', '']]);
    a.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1e2027').setFontColor('#ffffff'); a.setFrozenRows(1); a.setColumnWidths(1, 5, 180);
  }
  if (!ss.getSheetByName('訂金禮包')) {
    var b = ss.insertSheet('訂金禮包');
    b.getRange(1, 1, 3, 5).setValues([['啟用（Ｖ＝開）', '名稱（按鈕上的字，20 字內）', '內容（給客人看的說明）', '加價（0＝免費）', '禮包原價（取消時從訂金扣除）'],
      ['Ｖ', '0元加購 基本禮包', '（暫定）基本款玻璃保護貼＋透明保護殼', 0, 0], ['Ｖ', '升級套餐', '（暫定）進階保護貼＋防摔保護殼', 500, 0]]);
    b.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1e2027').setFontColor('#ffffff'); b.setFrozenRows(1); b.setColumnWidths(1, 4, 220);
  }
  var bs = ss.getSheetByName('訂金禮包');
  bs.getRange(1, 1, 1, 6).setValues([['啟用（Ｖ＝開）', '名稱（按鈕上的字，20 字內）', '內容（給客人看的說明）', '加購價（留空＝原價打 9 折；0＝免費）',
    '品項明細（例：硬博士保護貼 990、防摔殼 790；加起來就是原價，取消時扣這個）', '圖片網址（雲端硬碟分享連結也可以）']])
    .setFontWeight('bold').setBackground('#1e2027').setFontColor('#ffffff').setWrap(true);
  bs.setColumnWidth(4, 200); bs.setColumnWidth(5, 320); bs.setColumnWidth(6, 240);
  var ps = ss.getSheetByName('付款設定');   // LINE Pay 收款碼：兩間店同一張（care/pay/linepay-qr.jpg）
  if (ps && ps.getLastRow() > 1) ps.getRange(2, 5, ps.getLastRow() - 1, 1).getValues().forEach(function (v, i) {
    if (!String(v[0]).trim()) ps.getRange(i + 2, 5).setValue('https://a0900038552-coder.github.io/-warranty/care/pay/linepay-qr.jpg');
  });
  CacheService.getScriptCache().removeAll(['pay_settings', 'dep_bundles']);
  return ss.getUrl();
}
function sheetRows_(name, key) {
  var c = CacheService.getScriptCache(), hit = c.get(key);
  if (hit) return JSON.parse(hit);
  var rows = [];
  try {
    var sh = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('BOOKING_SHEET_ID')).getSheetByName(name);
    if (sh && sh.getLastRow() > 1) rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  } catch (e) { console.error(e); }
  c.put(key, JSON.stringify(rows), 300);
  return rows;
}
function paySetting_(branch) {
  var r = sheetRows_('付款設定', 'pay_settings').filter(function (x) { return String(x[0]).trim() === branch; })[0] || [];
  var img = String(r[4] || '').trim(), m = img.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]{10,})/);
  if (m) img = photoUrl_(m[1], 1000);   // 貼雲端硬碟分享連結也可以（要設成知道連結的人可看）
  return { bank: String(r[1] || '').trim(), acct: String(r[2] || '').trim(), holder: String(r[3] || '').trim(), lpImg: /^https:\/\//.test(img) ? img : '' };
}
// 訂金禮包分頁：A 啟用｜B 名稱｜C 內容說明｜D 加購價（留空＝品項原價合計打 9 折，0＝免費）｜E 品項明細（「保護貼 990、防摔殼 790」）｜F 圖片網址
function bundleItems_(txt) {
  return String(txt || '').split(/[、,，;；\n]+/).map(function (x) {
    var m = x.trim().match(/^(.*?)[\s:：$＄]*([\d,]+)\s*元?$/); return m && m[1].trim() ? { name: m[1].trim(), price: Number(m[2].replace(/,/g, '')) } : null;
  }).filter(Boolean);
}
function imgUrl_(u) {
  u = String(u || '').trim(); var m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]{10,})/);
  if (m) return photoUrl_(m[1], 800);
  return /^https:\/\//.test(u) ? u : '';
}
var BUNDLES_ON = false;  // 訂金禮包：關閉（2026/11 起改用官網加購配件＋LINE@ 優惠券）。要恢復改 true，試算表「訂金禮包」內容都還在
function bundles_() {
  if (!BUNDLES_ON) return [];
  return sheetRows_('訂金禮包', 'dep_bundles').filter(function (x) { return String(x[0]).trim() && String(x[1]).trim(); })
    .map(function (x) {
      var items = bundleItems_(x[4]), total = items.reduce(function (a, b) { return a + b.price; }, 0);
      if (!items.length) total = Number(String(x[4] || '0').replace(/[^\d]/g, '')) || 0;   // 舊格式：直接填原價
      var d = String(x[3] == null ? '' : x[3]).trim(), add = d === '' ? Math.floor(total * 0.9 / 10) * 10 : (Number(d.replace(/[^\d]/g, '')) || 0);
      return { name: String(x[1]).trim().slice(0, 20), desc: String(x[2] || '').trim(), add: add, value: total, items: items, img: imgUrl_(x[5]) };
    });
}
function fsQuery_(col, where, max) {
  var res = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: where, limit: max || 100 } }) });
  if (res.getResponseCode() !== 200) { console.error(res.getContentText()); return []; }
  return JSON.parse(res.getContentText()).filter(function (x) { return x.document; })
    .map(function (x) { var o = fromFields_(x.document.fields); o._id = x.document.name.split('/').pop(); return o; });
}
// 待對帳的期限：下一個營業日下午 3 點（星期日公休 → 順延到星期一）。過了還沒按「收到訂金」就自動取消、機子重新上架
function confirmBy_(from) {
  var d = new Date((from || new Date()).getTime() + 864e5);
  if (Utilities.formatDate(d, 'Asia/Taipei', 'u') === '7') d = new Date(d.getTime() + 864e5);
  return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd') + 'T15:00:00+08:00';
}
function activeResv_() {
  var now = Date.now();
  return fsQuery_('reservations', { fieldFilter: { field: { fieldPath: 'status' }, op: 'IN',
    value: { arrayValue: { values: [{ stringValue: 'pending' }, { stringValue: 'paid' }] } } } })
    .filter(function (r) {
      if (r.method === 'visit' && r.status === 'paid' && r.holdUntil && r.holdUntil < Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd')) {   // 預約看機過了日期沒來 → 自動釋出
        patchDoc_('reservations/' + r._id, { status: 'expired', updatedAt: new Date().toISOString() });
        return false;
      }
      if (r.status === 'pending' && r.confirmBy && Date.parse(r.confirmBy) < now) {   // 逾期沒對帳 → 自動取消
        patchDoc_('reservations/' + r._id, { status: 'expired', updatedAt: new Date().toISOString() });
        return false;
      }
      return true;
    });
}
function deadlineLabel_(iso) { var d = new Date(iso); return Utilities.formatDate(d, 'Asia/Taipei', 'M/d') + '（' + WD_ZH[Number(Utilities.formatDate(d, 'Asia/Taipei', 'u')) % 7] + '）下午 3 點'; }
function showcaseItem_(id) {
  var doc = getDoc_('settings/used_showcase'), items = [];
  try { items = JSON.parse((doc && doc.json) || '[]'); } catch (e) {}
  return items.filter(function (it) { return it.id === id; })[0] || null;
}
function lineName_(userId, token) {
  var j = lineGet_('https://api.line.me/v2/bot/profile/' + userId, token);
  return (j && j.displayName) || '';
}
function money_(n) { return '$' + Number(n || 0).toLocaleString('en-US'); }
function itemTitle_(it) { return it.model + (it.color ? ' ' + it.color : ''); }

function depositPostback_(ev, store, token, userId) {
  var q = {}; String((ev.postback && ev.postback.data) || '').split('&').forEach(function (kv) { var p = kv.split('='); q[p[0]] = decodeURIComponent(p[1] || ''); });
  var c = CacheService.getScriptCache();
  if (q.act === 'dep' || q.act === 'pay') {
    var it = showcaseItem_(q.id);
    if (!it) return reply_(ev.replyToken, token, '不好意思，這台剛剛已經賣出或下架了 🙏\n可以再傳「有什麼二手機」看看目前的現貨。');
    var mine = null, taken = activeResv_().filter(function (r) { if (r.usedId === q.id && r.userId === userId) mine = r; return r.usedId === q.id; });
    if (mine) return reply_(ev.replyToken, token, '這台已經幫您預約看機了 👍\n' + (mine.method === 'visit' ? '預約 ' + visitLabel_(mine.holdUntil, mine.visitTime) + '，到「' + mine.branch + '」找店員就可以。' : mine.status === 'paid' ? '保留到 ' + mine.holdUntil + '。' : '店員確認收到訂金後會通知您。'));
    if (taken.length) return reply_(ev.replyToken, token, '不好意思，這台剛剛已經有其他客人預約看機了 🙏\n可以再傳「有什麼二手機」看看其他現貨。');
    if (q.act === 'dep') return orderStart_(ev, store, token, userId, it, 0);
    var myPending = activeResv_().filter(function (r) { return r.userId === userId && r.status === 'pending'; });
    if (myPending.length) return reply_(ev.replyToken, token, '您目前有一筆訂金（' + myPending[0].model + '）還在等店員對帳，確認後才能再保留其他機子 🙏\n有問題可以直接回覆訊息。');
    var dep = depositOf_(it.price), ps = paySetting_(it.branch);
    if (q.act === 'dep' && (ps.acct || ps.lpImg)) return orderStart_(ev, store, token, userId, it, dep);
    if (q.act === 'dep') {
      var btns = [];
      if (ps.acct) btns.push({ type: 'button', style: 'primary', color: '#d71920', height: 'sm', action: { type: 'postback', label: '🏦 銀行匯款', data: 'act=pay&m=bank&id=' + it.id, displayText: '我用匯款付訂金' } });
      if (ps.lpImg) btns.push({ type: 'button', style: 'primary', color: '#06c755', height: 'sm', action: { type: 'postback', label: '💚 LINE Pay', data: 'act=pay&m=lp&id=' + it.id, displayText: '我用 LINE Pay 付訂金' } });
      if (!btns.length) return reply_(ev.replyToken, token, '收到！這台在「' + it.branch + '」，訂金 ' + money_(dep) + '。\n線上付訂金還在準備中，店員看到訊息會盡快跟您聯繫 🙏');
      return reply_(ev.replyToken, token, [{ type: 'flex', altText: '付訂金保留：' + itemTitle_(it), contents: { type: 'bubble', size: 'kilo',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: '💰 付訂金保留', weight: 'bold', size: 'lg' },
          { type: 'text', text: itemTitle_(it), wrap: true, weight: 'bold' },
          { type: 'text', text: it.branch + '・售價 ' + money_(it.price), size: 'sm', color: '#6b7280' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '訂金 ' + money_(dep), size: 'xl', weight: 'bold', color: '#d71920', margin: 'md' },
          { type: 'text', text: '店員確認收到訂金後，幫您保留 ' + HOLD_DAYS + ' 天；訂金會折抵售價。' + (BUNDLES_ON ? '\n付完還有 🎁 禮包可以選！' : ''), size: 'sm', wrap: true, color: '#374151' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📋 訂金規則', size: 'sm', weight: 'bold', margin: 'md' },
          { type: 'text', text: DEP_RULES, size: 'xs', wrap: true, color: '#6b7280' }
        ] }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: btns } } }]);
    }
    // q.act === 'pay'：先記在暫存，客人回報付款後才建立保留
    c.put('dep_' + userId, JSON.stringify({ id: it.id, m: q.m, store: storeKey_(store) }), 21600);
    if (q.m === 'bank') return reply_(ev.replyToken, token, '請匯訂金 ' + money_(dep) + ' 到：\n\n🏦 ' + ps.bank + '\n帳號：' + ps.acct + (ps.holder ? '\n戶名：' + ps.holder : '') +
      '\n\n匯好後，請直接在這裡回覆您的「帳號末五碼」（5 個數字，例：12345），我們就幫您登記 👍');
    return reply_(ev.replyToken, token, [
      { type: 'text', text: '請用 LINE Pay 掃下面的收款碼，付訂金 ' + money_(dep) + '。\n付好後按下方「✅ 我已付款」。' },
      { type: 'image', originalContentUrl: ps.lpImg, previewImageUrl: ps.lpImg,
        quickReply: { items: [{ type: 'action', action: { type: 'postback', label: '✅ 我已付款', data: 'act=paid', displayText: '我已用 LINE Pay 付訂金' } }] } }]);
  }
  if (q.act === 'paid') return depositFinish_(ev, store, token, userId, '');
  if (q.act === 'opaid') return orderReport_(ev, store, token, userId, String(q.r || '').replace(/[^\w-]/g, ''), '');
  if (q.act === 'bdl') {
    var r = getDoc_('reservations/' + String(q.r || '').replace(/[^\w-]/g, ''));
    if (!r || r.userId !== userId) return;
    if (r.bundle) return reply_(ev.replyToken, token, '您已經選好禮包囉：' + r.bundle + ' 👍');
    var b = bundles_()[Number(q.b)]; if (!b) return;
    patchDoc_('reservations/' + q.r, { bundle: b.name, bundleDesc: b.desc, bundleAdd: b.add, bundleValue: b.value, updatedAt: new Date().toISOString() });
    return reply_(ev.replyToken, token, '🎁 已幫您登記：' + b.name + (b.add ? '（取機時加 ' + money_(b.add) + '）' : '（免費）') +
      '\n\n店員對完帳會再通知您，保留 ' + HOLD_DAYS + ' 天，取機時禮包一起幫您準備好 😊');
  }
}
// 這位 LINE 客人在「注意客人」有紀錄嗎？（讀 1 筆）
function watchNote_(userId) {
  var w = userId ? getDoc_('watchlist/L_' + userId) : null;
  return w ? '\n⚠️ 注意客人：之前有紀錄（例如保留逾期未取），請到「注意客人」頁查看' : '';
}
function depositLast5_(ev, store, token, userId, five) {
  var d = CacheService.getScriptCache().get('dep_' + userId);
  if (d && JSON.parse(d).rid) { orderReport_(ev, store, token, userId, JSON.parse(d).rid, five); return true; }
  if (!d || JSON.parse(d).m !== 'bank') return false;
  depositFinish_(ev, store, token, userId, five);
  return true;
}
function depositFinish_(ev, store, token, userId, last5) {
  var c = CacheService.getScriptCache(), d = c.get('dep_' + userId);
  if (!d) return reply_(ev.replyToken, token, '找不到剛剛的訂金資料，請從現貨卡片再按一次「付訂金保留」🙏');
  d = JSON.parse(d);
  var it = showcaseItem_(d.id);
  if (!it) return reply_(ev.replyToken, token, '不好意思，這台剛剛已經賣出或下架了 🙏 已付的訂金店員會跟您聯繫處理。');
  var taken = activeResv_().filter(function (r) { return r.usedId === d.id; });
  if (taken.length && taken[0].userId !== userId) {
    notifyOwner_('⚠️ 訂金撞單：' + itemTitle_(it) + '（' + it.branch + '）已被保留，但另一位客人也回報付款了（' + (d.m === 'bank' ? '末五碼 ' + last5 : 'LINE Pay') + '），請聯繫退款。');
    return reply_(ev.replyToken, token, '不好意思，這台剛剛已經被其他客人保留了 🙏 您的訂金店員會盡快跟您聯繫退還。');
  }
  if (taken.length) { c.remove('dep_' + userId); return reply_(ev.replyToken, token, '這台已經幫您登記保留了 👍 店員確認收到訂金後會通知您。'); }
  var now = new Date().toISOString(), name = lineName_(userId, token), dep = depositOf_(it.price);
  var rid = createDoc_('reservations', { usedId: it.id, model: itemTitle_(it), branch: it.branch, price: Number(it.price), deposit: dep,
    method: d.m === 'bank' ? 'bank' : 'linepay', last5: last5 || '', userId: userId, store: d.store || storeKey_(store), name: name,
    bundle: '', bundleDesc: '', bundleAdd: 0, bundleValue: 0, status: 'pending', holdUntil: '', confirmBy: confirmBy_(), createdAt: now, updatedAt: now });
  c.remove('dep_' + userId);
  notifyOwner_('💰 新的中古機訂金（待對帳）\n請在 ' + deadlineLabel_(confirmBy_()) + '前對帳，逾時自動取消\n⚠️ 對帳請看網銀實際入帳，並確認匯款人姓名跟客人一致\n' + itemTitle_(it) + '（' + it.branch + '）售價 ' + money_(it.price) + '\n訂金 ' + money_(dep) + '・' +
    (d.m === 'bank' ? '匯款 末五碼 ' + last5 : 'LINE Pay') + '\n客人：' + (name || '（LINE 名稱讀不到）') + watchNote_(userId) + '\n對完帳請到「中古機庫存」按「✅ 收到訂金」。');
  var bs = bundles_();
  var msgs = [{ type: 'text', text: '收到！已幫您登記「' + itemTitle_(it) + '」。\n店員會在 ' + deadlineLabel_(confirmBy_()) + '前完成對帳並通知您 🙏\n（若到時查不到款項，這次保留會自動取消）' }];
  if (bs.length) msgs.push({ type: 'flex', altText: '🎁 選擇您的禮包', contents: { type: 'bubble', size: 'mega',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [{ type: 'text', text: '🎁 感謝訂購！選一個禮包', weight: 'bold', size: 'lg' }]
      .concat(bs.map(function (b) { return { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
        { type: 'text', text: b.name + '　' + (b.add ? '+' + money_(b.add) : '免費'), weight: 'bold', color: b.add ? '#d71920' : '#16181d', wrap: true },
        { type: 'text', text: b.desc || ' ', size: 'sm', color: '#6b7280', wrap: true }].concat(b.value ? [{ type: 'text', text: '禮包原價 ' + money_(b.value) + '（取消時從訂金扣除）', size: 'xs', color: '#9ca3af', wrap: true }] : []) }; }))
      .concat([{ type: 'text', text: '選好後我們會為您備貨。若對帳後因個人因素取消或逾期未取，會扣除禮包原價後退還其餘訂金。', size: 'xs', color: '#9ca3af', wrap: true }]) },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bs.map(function (b, i) {
      return { type: 'button', style: i ? 'primary' : 'secondary', color: i ? '#d71920' : undefined, height: 'sm',
        action: { type: 'postback', label: (b.name + (b.add ? ' +' + b.add : '')).slice(0, 20), data: 'act=bdl&r=' + rid + '&b=' + i, displayText: '我選：' + b.name } }; }) } } });
  return reply_(ev.replyToken, token, msgs);
}
/* ───────── 線上訂單（booking/order.html）─────────
 * 現貨卡片「💰 我要保留」→ 回一個訂單連結（ord_<token> 暫存 6 小時，綁 LINE 帳號）
 * → 訂單頁讀 orderGet（商品、檢測報告、IMEI 遮一半、禮包、付款方式）→ 客人填姓名電話、選禮包付款、勾同意 → orderSubmit 建立 reservations（pending、reported=false）
 * → 完成頁顯示付款資訊＋「回 LINE 回報」（傳「訂單 Uxxxxxxx」）→ 機器人回付款資訊 → 客人回末五碼／按「我已付款」→ reported=true、通知老闆 → 店員對帳按「收到訂金」
 */
var ORDER_URL = 'https://a0900038552-coder.github.io/-warranty/booking/order.html';
var SHOP_INFO = { '楠梓店': { addr: '高雄市楠梓區楠梓路10號', tel: '0900-038-552' }, '德賢店': { addr: '高雄市楠梓區德賢路258號', tel: '0971-626-883' } };
function maskImei_(s) { return String(s || '').replace(/\D/g, '').split('').map(function (c, i) { return i % 2 === 0 ? c : '*'; }).join(''); }
function basicId_(k) {
  var props = PropertiesService.getScriptProperties(), v = props.getProperty('BASIC_ID_' + k);
  if (v) return v;
  var st = STORES[k]; if (!st) return '';
  var j = lineGet_('https://api.line.me/v2/bot/info', prop_(st.tokenProp));
  v = (j && j.basicId) || '';
  if (v) props.setProperty('BASIC_ID_' + k, v);
  return v;
}
/* 官網加購配件：客人在官網勾配件 → 「我有興趣：…加購配件：・名稱 $價」→ 機器人記下（addon_<userId>，6 小時）
 * → 按「📅 預約看機」時帶進預約。價格一律用 settings/acc_showcase 重新對價（客人改訊息也改不了價格），滿額折跟官網一樣每滿 $1,000 折 $100 */
var ACC_PROMO = { min: 1000, off: 100 };
function accTotals_(items) {
  var sum = items.reduce(function (s, a) { return s + Number(a.price || 0); }, 0), off = Math.floor(sum / ACC_PROMO.min) * ACC_PROMO.off;
  return { items: items, sum: sum, off: off, pay: sum - off };
}
function parseAddons_(raw) {
  var i = raw.indexOf('加購配件'); if (i < 0) return null;
  var list = []; try { list = JSON.parse((getDoc_('settings/acc_showcase') || {}).json || '[]'); } catch (e) {}
  var byName = {}; list.forEach(function (a) { if (a && a.name) byName[String(a.name).trim()] = a; });
  var items = [];
  raw.slice(i).split('\n').forEach(function (l) {
    var mm = l.match(/^\s*[・•·]\s*(.+?)\s+\$[\d,]+\s*$/); if (!mm) return;
    var a = byName[mm[1].trim()]; if (a && Number(a.price) > 0) items.push({ id: a.id || '', name: String(a.name), price: Number(a.price) });
  });
  return items.length ? accTotals_(items.slice(0, 30)) : null;
}
function showcaseByLabel_(label, branch, price) {
  var doc = getDoc_('settings/used_showcase'), items = [];
  try { items = JSON.parse((doc && doc.json) || '[]'); } catch (e) {}
  return items.filter(function (it) { return (it.model + (it.color ? ' ' + it.color : '')).slice(0, 40) === label && (!branch || it.branch === branch) && (!price || Number(it.price) === price); })[0] || null;
}
function orderStart_(ev, store, token, userId, it, dep) {
  var t = Utilities.getUuid().replace(/-/g, ''), cc = CacheService.getScriptCache(), ad = null;
  try { var a0 = JSON.parse(cc.get('addon_' + userId) || 'null'); if (a0 && a0.id === it.id) ad = a0.acc; } catch (e) {}
  cc.put('ord_' + t, JSON.stringify({ id: it.id, userId: userId, store: storeKey_(store), acc: ad }), 21600);
  return reply_(ev.replyToken, token, [{ type: 'flex', altText: '預約看機：' + itemTitle_(it), contents: { type: 'bubble', size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: '📅 預約到店看機', weight: 'bold', size: 'lg' },
      { type: 'text', text: itemTitle_(it), wrap: true, weight: 'bold' },
      { type: 'text', text: it.branch + '・售價 ' + money_(it.price) + '・不用付訂金', size: 'sm', color: '#6b7280', wrap: true }].concat(ad ? [
      { type: 'text', text: '＋ 加購配件 ' + ad.items.length + ' 件 ' + money_(ad.pay) + (ad.off ? '（已折 ' + money_(ad.off) + '）' : ''), size: 'sm', color: '#d71920', weight: 'bold', wrap: true }] : []).concat([
      { type: 'text', text: '選好到店日期和時間，店員會把機子留到那天，到店驗機滿意再購買 👍\n（連結 6 小時內有效）', size: 'xs', color: '#6b7280', wrap: true, margin: 'md' }]) },
    footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#d71920', height: 'sm',
      action: { type: 'uri', label: '📅 選看機時間', uri: ORDER_URL + '?t=' + t } }] } } }]);
}
/* 預約看機（2026/11 起取代線上訂金）：不收訂金、不放匯款資訊；客人選到店日期＋時間，機子保留到那天營業結束，過了沒來自動釋出。
 * 買賣在門市驗機、簽商品確認書後才成立（實體交易）。加購配件交機時確認：有現貨當場給，要調貨的到貨後寄送或到店取件（地址交機後再填）。 */
var VISIT_DAYS = 7, VISIT_HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], MAX_VISITS = 2;
function twWd_(d) { return new Date(d.getTime() + 8 * 3600000).getUTCDay(); }   // 台灣時間星期幾（0＝日），不靠 formatDate 的 'u'
function visitSlots_() {
  var out = [], now = new Date(), hourNow = Number(Utilities.formatDate(now, 'Asia/Taipei', 'H'));
  for (var i = 0; i < VISIT_DAYS; i++) {
    var d = new Date(now.getTime() + i * 864e5), wd = twWd_(d);
    if (wd === 0) continue;   // 週日公休
    var hours = VISIT_HOURS.filter(function (h) { return i > 0 || h > hourNow; });
    if (!hours.length) continue;
    out.push({ date: Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd'), label: (i === 0 ? '今天 ' : i === 1 ? '明天 ' : '') + Utilities.formatDate(d, 'Asia/Taipei', 'M/d') + '（' + WD_ZH[wd] + '）', hours: hours });
  }
  return out;
}
function visitLabel_(date, time) {
  if (!date) return '';
  var d = new Date(date + 'T12:00:00+08:00');
  return Utilities.formatDate(d, 'Asia/Taipei', 'M/d') + '（' + WD_ZH[twWd_(d)] + '）' + (time ? ' ' + time : '');
}
// 行事曆：iPhone 用 .ics（內建行事曆，到店前 2 小時提醒）、Android 用 Google 日曆連結
function visitWhen_(r) {   // 回傳 UTC 開始／結束（yyyyMMddTHHmmssZ），看機 30 分鐘
  var st = new Date(r.holdUntil + 'T' + (r.visitTime || '11:00') + ':00+08:00'), en = new Date(st.getTime() + 30 * 60000);
  var f = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
  return { start: f(st), end: f(en) };
}
function visitCalText_(r) {
  var shop = SHOP_INFO[r.branch] || {};
  return { title: '復原者看機：' + r.model, loc: '復原者手機維修 ' + r.branch + ' ' + (shop.addr || ''),
    desc: '預約編號 ' + r.orderNo + '\n' + r.branch + ' ' + (shop.tel || '') + '\n到店跟店員說預約編號或姓名就可以，不用付訂金。\n要改時間請直接回覆 LINE。' };
}
function visitGcal_(r) {
  var w = visitWhen_(r), t = visitCalText_(r);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(t.title) + '&dates=' + w.start + '/' + w.end +
    '&details=' + encodeURIComponent(t.desc) + '&location=' + encodeURIComponent(t.loc) + '&ctz=Asia/Taipei';
}
function visitIcs_(k) {
  k = k.replace(/\W/g, '');
  var r = k.length >= 16 ? fsQuery_('reservations', { fieldFilter: { field: { fieldPath: 'viewKey' }, op: 'EQUAL', value: { stringValue: k } } }, 1)[0] : null;
  if (!r || r.method !== 'visit') return ContentService.createTextOutput('找不到預約').setMimeType(ContentService.MimeType.TEXT);
  var w = visitWhen_(r), t = visitCalText_(r), esc = function (x) { return String(x).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n'); };
  var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//grandmasterfix//visit//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + r.orderNo + '-' + k.slice(0, 8) + '@grandmasterfix.com.tw', 'DTSTAMP:' + Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
    'DTSTART:' + w.start, 'DTEND:' + w.end, 'SUMMARY:' + esc(t.title), 'LOCATION:' + esc(t.loc), 'DESCRIPTION:' + esc(t.desc),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(t.title), 'TRIGGER:-PT2H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return ContentService.createTextOutput(ics).setMimeType(ContentService.MimeType.ICAL);
}
// 預約成功 → 在客人的 LINE 聊天室推一張確認卡（時間、門市、導航、電話、加入行事曆、查看預約）
function visitConfirmPush_(r, store) {
  if (!r.userId) return false;
  var st = STORES[store] || storeByBranch_(r.branch), shop = SHOP_INFO[r.branch] || {}, tel = String(shop.tel || '').replace(/[^\d]/g, '');
  var map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('復原者手機維修 ' + (shop.addr || ''));
  var cal = ORDER_URL + '?k=' + r.viewKey + '&cal=1&openExternalBrowser=1';
  var bubble = { type: 'bubble', size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: '✅ 預約看機成功', weight: 'bold', size: 'lg', color: '#15803d' },
      { type: 'text', text: r.model, weight: 'bold', wrap: true },
      { type: 'text', text: '📅 ' + visitLabel_(r.holdUntil, r.visitTime), size: 'md', weight: 'bold', color: '#d71920', margin: 'md' },
      { type: 'text', text: '📍 ' + r.branch + '：' + (shop.addr || ''), size: 'sm', wrap: true },
      { type: 'text', text: '預約編號 ' + r.orderNo + '・免訂金\n到店跟店員說編號或姓名就可以，驗機滿意再購買 😊', size: 'xs', color: '#6b7280', wrap: true, margin: 'md' }] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'button', style: 'primary', color: '#d71920', height: 'sm', action: { type: 'uri', label: '📅 加入手機行事曆', uri: cal } },
      { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
        { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '🗺️ 導航', uri: map } },
        { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '📞 電話', uri: 'tel:' + tel } }] },
      { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '查看預約內容', uri: ORDER_URL + '?k=' + r.viewKey } }] } };
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + prop_(st.tokenProp) }, payload: JSON.stringify({ to: r.userId, messages: [{ type: 'flex', altText: '預約看機成功：' + visitLabel_(r.holdUntil, r.visitTime), contents: bubble }] }) });
  return res.getResponseCode() === 200;
}
// 當天到店前 2 小時提醒（每小時跑一次）。執行一次 setupVisitReminder 建立觸發器
function setupVisitReminder() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'visitReminder') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('visitReminder').timeBased().everyHours(1).create();
  return { ok: true, at: '每小時檢查一次，到店前 2 小時提醒' };
}
function visitReminder() {
  var now = new Date(), today = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd'), sent = 0;
  activeResv_().forEach(function (r) {
    if (r.method !== 'visit' || r.status !== 'paid' || r.holdUntil !== today || r.remindedToday || !r.userId) return;
    var at = new Date(today + 'T' + (r.visitTime || '11:00') + ':00+08:00').getTime(), left = (at - now.getTime()) / 60000;
    if (left > 150 || left < 0) return;   // 到店前 2.5 小時內才提醒（每小時跑一次，避免漏掉）
    if (r.createdAt && at - Date.parse(r.createdAt) < 3 * 3600000) { patchDoc_('reservations/' + r._id, { remindedToday: true }); return; }   // 剛約不久的不用再提醒
    var st = STORES[r.store] || storeByBranch_(r.branch), shop = SHOP_INFO[r.branch] || {};
    var map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('復原者手機維修 ' + (shop.addr || ''));
    var text = '⏰ 提醒您：今天 ' + r.visitTime + ' 預約到「' + r.branch + '」看「' + r.model + '」\n📍 ' + (shop.addr || '') + '\n🗺️ 導航：' + map +
      '\n\n會晚到或不來了，直接回覆訊息跟我們說就好 🙏';
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + prop_(st.tokenProp) }, payload: JSON.stringify({ to: r.userId, messages: [{ type: 'text', text: text }] }) });
    if (res.getResponseCode() === 200) { patchDoc_('reservations/' + r._id, { remindedToday: true }); sent++; }
  });
  return sent;
}
function orderItem_(id) {
  var it = showcaseItem_(id); if (!it) return null;
  var u = getDoc_('used_stock/' + id) || {}, c = u.check || {};
  var chk = {}; Object.keys(c).forEach(function (k) { if (k !== 'by' && k !== 'seal') chk[k] = c[k]; });
  return { it: it, check: chk, imei: maskImei_(u.imei), inspector: String(c.by || '').split('@')[0] ? '已驗機' : '' };
}
function orderGet_(t) {
  var d = CacheService.getScriptCache().get('ord_' + t.replace(/\W/g, ''));
  if (!d) return { ok: false, error: '這個訂單連結已過期，請回 LINE 再按一次「📅 預約看機」' };
  d = JSON.parse(d);
  var o = orderItem_(d.id);
  if (!o) return { ok: false, error: '不好意思，這台剛剛已經賣出或下架了' };
  if (activeResv_().some(function (r) { return r.usedId === d.id; })) return { ok: false, error: '不好意思，這台剛剛已經被其他客人保留了' };
  return { ok: true, item: o.it, check: o.check, imei: o.imei, deposit: 0, holdDays: HOLD_DAYS,
    visit: true, slots: visitSlots_(), acc: d.acc || null, shop: SHOP_INFO[o.it.branch] || {} };
}
function orderSubmit_(req) {
  var c = CacheService.getScriptCache(), t = String(req.t || '').replace(/\W/g, ''), d = c.get('ord_' + t);
  if (!d) return { ok: false, error: '這個訂單連結已過期，請回 LINE 再按一次「📅 預約看機」' };
  d = JSON.parse(d);
  var name = String(req.name || '').trim().slice(0, 30), phone = String(req.phone || '').replace(/\D/g, '');
  if (!req.agree) return { ok: false, error: '請勾選「我已閱讀並同意」' };
  if (!name) return { ok: false, error: '請填寫姓名' };
  if (!/^09\d{8}$/.test(phone)) return { ok: false, error: '請填寫正確的手機號碼（09 開頭 10 碼）' };
  var o = orderItem_(d.id); if (!o) return { ok: false, error: '不好意思，這台剛剛已經賣出或下架了' };
  var act = activeResv_();
  if (act.some(function (r) { return r.usedId === d.id; })) return { ok: false, error: '不好意思，這台剛剛已經被其他客人保留了' };
  if (act.filter(function (r) { return r.userId === d.userId; }).length >= MAX_VISITS) return { ok: false, error: '您已經預約了 ' + MAX_VISITS + ' 台，看完機再預約其他的喔 🙏' };
  var slot = visitSlots_().filter(function (x) { return x.date === String(req.visitDate || ''); })[0];
  var hour = Number(String(req.visitTime || '').split(':')[0]);
  if (!slot) return { ok: false, error: '請選擇到店日期' };
  if (slot.hours.indexOf(hour) < 0) return { ok: false, error: '請選擇到店時間' };
  var visitTime = ('0' + hour).slice(-2) + ':00', method = 'visit', b = null;
  var ac = null;
  if (d.acc && d.acc.items) {
    var keep = Array.isArray(req.acc) ? req.acc.map(Number) : d.acc.items.map(function (x, i) { return i; });
    var picked = d.acc.items.filter(function (x, i) { return keep.indexOf(i) >= 0; });
    if (picked.length) ac = accTotals_(picked);
  }
  var now = new Date(), dep = 0, orderNo = 'U' + Utilities.formatDate(now, 'Asia/Taipei', 'MMdd') + ('00' + Math.floor(Math.random() * 1000)).slice(-3);
  var viewKey = Utilities.getUuid().replace(/-/g, '').slice(0, 24), st = STORES[d.store] || storeByBranch_(o.it.branch);
  var rid = createDoc_('reservations', { usedId: o.it.id, model: itemTitle_(o.it), branch: o.it.branch, price: Number(o.it.price), deposit: dep,
    method: method, last5: '', reported: false, userId: d.userId, store: d.store, name: name, phone: phone, lineName: lineName_(d.userId, prop_(st.tokenProp)),
    bundle: b ? b.name : '', bundleDesc: b ? b.desc : '', bundleAdd: b ? b.add : 0, bundleValue: b ? b.value : 0,
    accItems: ac ? ac.items.map(function (x) { return x.name + ' $' + x.price; }).join('\n') : '', accSum: ac ? ac.sum : 0, accOff: ac ? ac.off : 0, accPay: ac ? ac.pay : 0,
    orderNo: orderNo, viewKey: viewKey, imeiMasked: o.imei, agreedAt: now.toISOString(), status: 'paid', holdUntil: slot.date, visitTime: visitTime, confirmBy: '',
    createdAt: now.toISOString(), updatedAt: now.toISOString() });
  c.remove('ord_' + t); if (d.userId) c.remove('addon_' + d.userId);
  try { visitConfirmPush_({ userId: d.userId, model: itemTitle_(o.it), branch: o.it.branch, holdUntil: slot.date, visitTime: visitTime, orderNo: orderNo, viewKey: viewKey }, d.store); } catch (e) { console.error(e); }
  var w = getDoc_('watchlist/' + phone) || (d.userId ? getDoc_('watchlist/L_' + d.userId) : null);
  notifyOwner_('📅 新預約看機 ' + orderNo + '\n' + itemTitle_(o.it) + '（' + o.it.branch + '）售價 ' + money_(o.it.price) +
    '\n到店：' + visitLabel_(slot.date, visitTime) + '\n客人：' + name + ' ' + phone +
    (ac ? '\n🎧 想加購配件 ' + ac.items.length + ' 件（' + money_(ac.pay) + (ac.off ? '，已折 ' + money_(ac.off) : '') + '，交機時確認）：\n' + ac.items.map(function (x) { return '・' + x.name + ' ' + money_(x.price); }).join('\n') : '') +
    (w ? '\n⚠️ 這位客人在「注意客人」有紀錄' : '') + '\n機子已自動保留到 ' + visitLabel_(slot.date) + ' 營業結束，沒來會自動釋出。');
  var calR = { model: itemTitle_(o.it), branch: o.it.branch, holdUntil: slot.date, visitTime: visitTime, orderNo: orderNo };
  return { ok: true, orderNo: orderNo, viewKey: viewKey, id: rid, visit: visitLabel_(slot.date, visitTime), gcal: visitGcal_(calR), ics: WEBHOOK_EXEC + '?action=ics&k=' + viewKey, shop: SHOP_INFO[o.it.branch] || {}, branch: o.it.branch, basicId: basicId_(d.store) };
}
function orderView_(k) {
  k = k.replace(/\W/g, ''); if (k.length < 16) return { ok: false, error: '找不到訂單' };
  var r = fsQuery_('reservations', { fieldFilter: { field: { fieldPath: 'viewKey' }, op: 'EQUAL', value: { stringValue: k } } }, 1)[0];
  if (!r) return { ok: false, error: '找不到訂單' };
  var u = getDoc_('used_stock/' + r.usedId) || {}, c = u.check || {}, chk = {};
  Object.keys(c).forEach(function (x) { if (x !== 'by' && x !== 'seal') chk[x] = c[x]; });
  var ST = r.method === 'visit' ? { paid: '已預約，保留到看機日', done: '已成交', cancelled: '已取消', expired: '預約已過期' }
    : { pending: r.reported ? '已回報付款，等待對帳' : '等待付款', paid: '已確認訂金，保留中', done: '已取機', cancelled: '已取消', expired: '逾期未對帳，已取消' };
  return { ok: true, order: { orderNo: r.orderNo, model: r.model, branch: r.branch, price: r.price, deposit: r.deposit, method: r.method, last5: r.last5 ? '*' + String(r.last5).slice(-3) : '',
    name: r.name, phone: String(r.phone || '').replace(/^(\d{4})\d{3}/, '$1***'), bundle: r.bundle, bundleDesc: r.bundleDesc, bundleAdd: r.bundleAdd, bundleValue: r.bundleValue,
    visit: r.method === 'visit' ? visitLabel_(r.holdUntil, r.visitTime) : '', gcal: r.method === 'visit' ? visitGcal_(r) : '', ics: r.method === 'visit' ? WEBHOOK_EXEC + '?action=ics&k=' + k : '',
    accItems: r.accItems || '', accSum: r.accSum || 0, accOff: r.accOff || 0, accPay: r.accPay || 0,
    imei: r.imeiMasked || '', status: ST[r.status] || r.status, holdUntil: r.holdUntil || '', confirmBy: r.confirmBy ? deadlineLabel_(r.confirmBy) : '', agreedAt: r.agreedAt || r.createdAt },
    check: chk, holdDays: HOLD_DAYS, shop: SHOP_INFO[r.branch] || {} };
}
function orderPayInfo_(ev, store, token, userId, orderNo) {
  var r = fsQuery_('reservations', { fieldFilter: { field: { fieldPath: 'orderNo' }, op: 'EQUAL', value: { stringValue: orderNo } } }, 3)
    .filter(function (x) { return x.userId === userId; })[0];
  if (!r) return reply_(ev.replyToken, token, '找不到這張訂單，請確認訂單編號，或直接回覆訊息讓店員協助 🙏');
  var view = ORDER_URL + '?k=' + r.viewKey;
  if (r.status !== 'pending') return reply_(ev.replyToken, token, '訂單 ' + orderNo + '：' + ({ paid: '已確認訂金，保留到 ' + r.holdUntil, done: '已取機', cancelled: '已取消', expired: '逾期未對帳，已取消' }[r.status] || r.status) + '\n訂單內容：' + view);
  if (r.reported) return reply_(ev.replyToken, token, '訂單 ' + orderNo + ' 已收到您的付款回報，店員會在 ' + deadlineLabel_(r.confirmBy) + '前完成對帳 🙏\n訂單內容：' + view);
  CacheService.getScriptCache().put('dep_' + userId, JSON.stringify({ rid: r._id }), 21600);
  var ps = paySetting_(r.branch), head = '訂單 ' + orderNo + '｜' + r.model + '\n訂金 ' + money_(r.deposit) + '，請在 ' + deadlineLabel_(r.confirmBy) + '前付款。\n';
  if (r.method === 'bank') return reply_(ev.replyToken, token, head + '\n🏦 ' + ps.bank + '\n帳號：' + ps.acct + (ps.holder ? '\n戶名：' + ps.holder : '') +
    '\n\n⚠️ 請用「訂購人本人」的帳戶匯款。\n匯好後，直接在這裡回覆您的「帳號末五碼」（5 個數字），會有專人確認 👍\n\n訂單內容／下載 PDF：' + view);
  return reply_(ev.replyToken, token, [{ type: 'text', text: head + '\n請用 LINE Pay 掃下面的收款碼，付好後按「✅ 我已付款」，會有專人確認 👍\n\n訂單內容／下載 PDF：' + view },
    { type: 'image', originalContentUrl: ps.lpImg, previewImageUrl: ps.lpImg,
      quickReply: { items: [{ type: 'action', action: { type: 'postback', label: '✅ 我已付款', data: 'act=opaid&r=' + r._id, displayText: '我已用 LINE Pay 付訂金' } }] } }]);
}
function orderReport_(ev, store, token, userId, rid, last5) {
  var r = getDoc_('reservations/' + rid);
  if (!r || r.userId !== userId) return reply_(ev.replyToken, token, '找不到您的訂單，請直接回覆訊息讓店員協助 🙏');
  if (r.status !== 'pending') return reply_(ev.replyToken, token, '這張訂單目前狀態：' + r.status + '，有問題請直接回覆訊息 🙏');
  patchDoc_('reservations/' + rid, { reported: true, last5: last5 || r.last5 || '', reportedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  CacheService.getScriptCache().remove('dep_' + userId);
  notifyOwner_('💰 客人回報已付款（待對帳）\n訂單 ' + r.orderNo + '｜' + r.model + '（' + r.branch + '）\n訂金 ' + money_(r.deposit) + '・' + (r.method === 'bank' ? '匯款 末五碼 ' + last5 : 'LINE Pay') +
    '\n訂購人：' + r.name + ' ' + r.phone + '\n⚠️ 請看網銀／LINE Pay 實際入帳，匯款人姓名要是「' + r.name + '」\n期限：' + deadlineLabel_(r.confirmBy));
  return reply_(ev.replyToken, token, '收到！訂單 ' + r.orderNo + ' 已登記您的付款' + (last5 ? '（末五碼 ' + last5 + '）' : '') + '。\n店員會在 ' + deadlineLabel_(r.confirmBy) + '前完成對帳並通知您 🙏\n（查不到款項的話，保留會自動取消）');
}

// 員工在庫存頁按：paid（收到訂金，開始保留）／cancel（取消保留，可選擇通知客人）／done（已取機）
function resvAction_(req) {
  var who = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: req.idToken || '' }) });
  if (who.getResponseCode() !== 200) return { ok: false, error: '登入已失效，請重新整理頁面' };
  var staff = String((JSON.parse(who.getContentText()).users || [{}])[0].email || '').toLowerCase();
  if (ALLOWED_EMAILS.indexOf(staff) < 0 || staff === BOT_EMAIL) return { ok: false, error: '沒有權限' };
  var id = String(req.id || '').replace(/[^\w-]/g, ''), r = getDoc_('reservations/' + id);
  if (!r) return { ok: false, error: '找不到這筆訂金' };
  var now = new Date(), upd = { updatedAt: now.toISOString(), updatedBy: staff }, text = '';
  if (req.op === 'paid') {
    var until = new Date(now.getTime() + HOLD_DAYS * 864e5), lbl = Utilities.formatDate(until, 'Asia/Taipei', 'M/d') + '（' + WD_ZH[Number(Utilities.formatDate(until, 'Asia/Taipei', 'u')) % 7] + '）';
    upd.status = 'paid'; upd.paidAt = now.toISOString(); upd.paidBy = staff; upd.holdUntil = Utilities.formatDate(until, 'Asia/Taipei', 'yyyy-MM-dd');
    text = '✅ 已收到您的訂金 ' + money_(r.deposit) + '\n\n「' + r.model + '」幫您保留到 ' + lbl + ' 營業結束，請到「' + r.branch + '」取機（' + (STORE_ADDR[r.branch] || '') + '）。\n' +
      '尾款 ' + money_(Number(r.price) - Number(r.deposit) + Number(r.bundleAdd || 0) + Number(r.accPay || 0)) + (r.bundle ? '（含禮包「' + r.bundle + '」' + (Number(r.bundleAdd) ? ' +' + money_(r.bundleAdd) : '') + '）' : '') +
      (Number(r.accPay) ? '\n（含加購配件 ' + money_(r.accPay) + '，配件會一起幫您備好）' : '') +
      '\n營業時間：週一～週六 11:00–21:00（週日公休）' +
      (Number(r.bundleValue) ? '\n\n※ 禮包已為您備貨；若因個人因素取消或逾期未取，會扣除禮包原價 ' + money_(r.bundleValue) + ' 後退還其餘訂金。' : '');
  } else if (req.op === 'cancel') {
    upd.status = 'cancelled'; upd.cancelledAt = now.toISOString(); upd.cancelledBy = staff;
    var refund = req.refund != null && req.refund !== '' ? Number(req.refund) : Number(r.deposit || 0);
    upd.refund = refund; upd.cancelReason = String(req.reason || '').slice(0, 40);
    if (req.notify && r.method === 'visit') text = '您好，「' + r.model + '」的看機預約已取消。\n有任何問題歡迎直接回覆訊息 🙏';
    else if (req.notify) text = '您好，「' + r.model + '」的保留已取消。\n' + (refund > 0 ? '應退還訂金 ' + money_(refund) +
      (refund < Number(r.deposit || 0) ? '（訂金 ' + money_(r.deposit) + '，扣除禮包「' + (r.bundle || '') + '」原價 ' + money_(Number(r.deposit) - refund) + '）' : '') +
      '，店員會再跟您聯繫退款方式。' : '依訂金規則，這次訂金無法退還。') + '\n有任何問題歡迎直接回覆訊息 🙏';
  } else if (req.op === 'done') { upd.status = 'done'; upd.doneAt = now.toISOString(); }
  else return { ok: false, error: '不明的動作' };
  patchDoc_('reservations/' + id, upd);
  var sent = false;
  if (text && r.userId) {
    var st = STORES[r.store] || storeByBranch_(r.branch);
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + prop_(st.tokenProp) }, payload: JSON.stringify({ to: r.userId, messages: [{ type: 'text', text: text }] }) });
    sent = res.getResponseCode() === 200;
  }
  return { ok: true, sent: sent };
}

// 保留到期前一天提醒客人（每天中午 12 點跑一次；只提醒 LINE 客人，現場保留的沒有 LINE）
function setupResvReminder() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'resvReminder') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('resvReminder').timeBased().everyDays(1).atHour(12).inTimezone('Asia/Taipei').create();
  return { ok: true, at: '每天 12:00' };
}
function resvReminder() {
  var tmr = Utilities.formatDate(new Date(Date.now() + 864e5), 'Asia/Taipei', 'yyyy-MM-dd'), sent = 0;
  activeResv_().forEach(function (r) {
    if (r.status !== 'paid' || r.holdUntil !== tmr || r.reminded || !r.userId) return;
    var st = STORES[r.store] || storeByBranch_(r.branch);
    var text = r.method === 'visit' ? '⏰ 提醒您：明天（' + visitLabel_(r.holdUntil, r.visitTime) + '）預約到「' + r.branch + '」看「' + r.model + '」。\n地址：' + (STORE_ADDR[r.branch] || '') + '，營業時間 11:00–21:00。\n\n時間要改或不來了，直接回覆訊息跟我們說就好 🙏' :
      '⏰ 提醒您：「' + r.model + '」幫您保留到明天（' + tmr.slice(5).replace('-', '/') + '）營業結束。\n請到「' + r.branch + '」取機（' + (STORE_ADDR[r.branch] || '') + '），營業時間 11:00–21:00。\n\n' +
      '需要延後的話直接回覆訊息跟我們說 🙏' + (Number(r.bundleValue) ? '\n※ 逾期未取會扣除禮包原價 ' + money_(r.bundleValue) + ' 後退還其餘訂金。' : '');
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + prop_(st.tokenProp) }, payload: JSON.stringify({ to: r.userId, messages: [{ type: 'text', text: text }] }) });
    if (res.getResponseCode() === 200) { patchDoc_('reservations/' + r._id, { reminded: true }); sent++; }
  });
  return sent;
}
function usedInterest_(ev, store, token, raw) {
  var m = raw.match(/（(楠梓店|德賢店)）/), at = m ? m[1] : store.branch;
  var userId = ev.source && ev.source.userId, head = raw.split('\n')[0];
  var hm = head.match(/^我有興趣[:：]\s*(.+?)（(楠梓店|德賢店)）\s*\$([\d,]+)/);
  var it = hm ? showcaseByLabel_(hm[1].trim(), hm[2], Number(hm[3].replace(/,/g, ''))) : null;
  var ad = it ? parseAddons_(raw) : null;
  if (ad && userId) CacheService.getScriptCache().put('addon_' + userId, JSON.stringify({ id: it.id, acc: ad }), 21600);
  var k = at === '德賢店' ? 'dexian' : 'nanzi', phone = String(STORE_PHONE[k] || '').replace(/[^\d+]/g, '');
  var msg = '收到！這台在「' + at + '」（' + STORE_ADDR[at] + '）。\n店員看到訊息會盡快回覆您 🙏\n\n想預約看機或有問題，也可以直接打電話：' + phone +
    '\n營業時間：週一～週六 11:00–21:00（週日公休）\n\n※ 中古機數量有限，實際庫存以門市為準';
  if (ad) msg = '✅ 已幫您記下加購配件 ' + ad.items.length + ' 件，配件 ' + money_(ad.pay) + (ad.off ? '（已折 ' + money_(ad.off) + '）' : '') +
    '\n按下方「📅 預約看機」選到店時間（不用付訂金），配件會一起帶進預約、交機時確認 👍\n\n' + msg;
  var qr = [{ type: 'action', action: { type: 'uri', label: '📞 打電話給' + at, uri: 'tel:' + phone } }];
  if (it) qr.unshift({ type: 'action', action: { type: 'postback', label: ad ? '📅 預約看機＋' + ad.items.length + '件配件' : '📅 預約看機',
    data: 'act=dep&id=' + it.id, displayText: '我要預約看機：' + itemTitle_(it).slice(0, 40) } });
  reply_(ev.replyToken, token, [{ type: 'text', text: msg, quickReply: { items: qr } }]);
}

var STORE_ADDR = { '楠梓店': '高雄市楠梓區楠梓路10號', '德賢店': '高雄市楠梓區德賢路258號' };

/* ───────── 預約管理（員工在保固系統按按鈕） ───────── */
/* ═══ 登入通知：員工帳號在「沒用過的裝置」登入時，用報價機器人私訊老闆；名單外的帳號登入一律通知 ═══
 * 名單要跟 firestore.rules 一致（rules 才是真正擋資料的地方，這裡只負責通知）
 */
var ALLOWED_EMAILS = ['a0900038552@gmail.com', 'soso770724@gmail.com', 'i0935349954@gmail.com', 'i0935349455@gmail.com', 'linebot@grandmasterfix.com.tw'];
function loginAlert_(req) {
  var who = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: req.idToken || '' }) });
  if (who.getResponseCode() !== 200) return { ok: false };
  var u = (JSON.parse(who.getContentText()).users || [{}])[0], email = String(u.email || '').toLowerCase();
  var allowed = ALLOWED_EMAILS.indexOf(email) >= 0;
  var dev = String(req.device || '').slice(0, 64), props = PropertiesService.getScriptProperties();
  var key = 'LOGIN_DEV_' + email, known = JSON.parse(props.getProperty(key) || '[]');
  var isNew = known.indexOf(dev) < 0;
  if (allowed && !isNew) return { ok: true, allowed: true };
  if (allowed) { known.push(dev); props.setProperty(key, JSON.stringify(known.slice(-30))); }
  var when = Utilities.formatDate(new Date(), 'Asia/Taipei', 'M/d HH:mm');
  var msg = allowed
    ? '🔐 新裝置登入通知\n\n帳號：' + email + '\n時間：' + when + '\n裝置：' + uaShort_(req.ua) + '\n頁面：' + String(req.page || '').slice(0, 30) +
      '\n\n是你或員工本人就不用理會。\n不是的話：請立刻到 Firebase 改這個帳號的密碼，或請 Claude 協助把它停用。'
    : '⚠️ 名單外的帳號嘗試登入\n\n帳號：' + (email || '（不明）') + '\n時間：' + when + '\n裝置：' + uaShort_(req.ua) +
      '\n\n這個帳號看不到任何資料（已被資料庫規則擋下）。如果不是你建立的，可以到 Firebase 把它刪除。';
  notifyOwner_(msg);
  return { ok: true, allowed: allowed };
}
function uaShort_(ua) {
  ua = String(ua || '');
  var os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows 電腦' : /Mac OS/.test(ua) ? 'Mac 電腦' : '其他';
  var br = /Line\//.test(ua) ? 'LINE 內建瀏覽器' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : '瀏覽器';
  return os + '・' + br;
}
function notifyOwner_(text) {
  var props = PropertiesService.getScriptProperties(), token = props.getProperty('QUOTE_TOKEN'), owner = props.getProperty('QUOTE_OWNER');
  if (!token || !owner) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ to: owner, messages: [{ type: 'text', text: text }] }) });
}

/* 退修通知：保固系統按「LINE 通知客人」→ 傳給有綁定 LINE 的客人，說明這次維修的保固（含 CARE+）已終止 */
function refundNotice_(req) {
  var who = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: req.idToken || '' }) });
  if (who.getResponseCode() !== 200) return { ok: false, error: '登入已失效，請重新登入' };
  var staff = String((JSON.parse(who.getContentText()).users || [{}])[0].email || '').toLowerCase();
  if (ALLOWED_EMAILS.indexOf(staff) < 0) return { ok: false, error: '沒有權限' };
  var rf = getDoc_('records/' + String(req.id || '').replace(/[^\w\-]/g, ''));
  if (!rf || rf.kind !== 'refund') return { ok: false, error: '找不到這筆退修紀錄' };
  var store = storeByBranch_(rf.branch); if (!store) return { ok: false, error: '分店不正確' };
  // 找客人綁定的 LINE（CARE+ 登錄時記下的）
  var res = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'care_bindings' }], where: { fieldFilter: { field: { fieldPath: 'phone' }, op: 'EQUAL', value: { stringValue: rf.phone } } }, limit: 20 } }) });
  var ids = [];
  if (res.getResponseCode() === 200) JSON.parse(res.getContentText()).forEach(function (x) {
    if (!x.document) return; var b = fromFields_(x.document.fields);
    if (b.branch === rf.branch && b.lineUserId && ids.indexOf(b.lineUserId) < 0) ids.push(b.lineUserId);
  });
  if (!ids.length) return { ok: false, error: '這位客人沒有綁定 ' + rf.branch + ' 的 LINE，沒辦法傳。請當面或電話告知。' };
  var d = function (s) { return s ? String(s).slice(5, 10).replace('-', '/') : ''; };
  var money = Math.abs(Number(String(rf.price || '').replace(/[^\d.\-]/g, '')) || 0);
  var text = '【復原者' + rf.branch + '｜保固異動通知】\n\n' + (rf.name ? rf.name + ' 您好，\n' : '您好，\n') +
    '您' + (rf.origDate ? '於 ' + d(rf.origDate) + ' ' : '') + '在本店維修的「' + (rf.origItem || '維修項目') + '」，已於 ' + d(rf.repairDate) + ' 辦理退修' + (money ? '（退款 NT$ ' + money.toLocaleString() + '）' : '') + '。\n\n' +
    '該項維修的保固（含 Repair CARE+ 延長保固）自 ' + d(rf.repairDate) + ' 起終止，先前收到的保固訊息或截圖不再適用。\n其他維修項目的保固不受影響。\n\n如有疑問請直接在此聊天室詢問，謝謝您！';
  var token = prop_(store.tokenProp), sent = 0;
  ids.forEach(function (to) {
    var r = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }) });
    if (r.getResponseCode() === 200) sent++;
  });
  if (!sent) return { ok: false, error: 'LINE 傳送失敗（客人可能已封鎖，或本月訊息額度用完）' };
  patchDoc_('records/' + req.id, { notifiedAt: new Date().toISOString(), notifiedBy: staff });
  return { ok: true, sent: sent };
}

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
  // 用客人「當初預約的那個 LINE 官方帳號」傳訊息（轉店後客人仍是原本那間的好友）
  var store = (b.store && STORES[b.store]) || storeByBranch_(b.branch);
  var token = prop_(store.tokenProp);
  var now = new Date().toISOString();
  var text, quick = null, upd = { updatedAt: now, updatedBy: staff };

  if (req.type === 'confirm') {
    var time = req.time || b.proposedTime || b.wish;
    var price = String(req.price || '').trim();
    var priceTxt = !price ? '' : /^\d+$/.test(price) ? 'NT$ ' + Number(price).toLocaleString() : price.replace(/(\d{4,})/g, function (n) { return Number(n).toLocaleString(); }) + ' 元';
    text = '✅ 您的預約已確認\n\n🕐 ' + time + '\n📍 復原者' + b.branch + '（' + STORE_ADDR[b.branch] + '）\n📱 ' + b.model + '｜' + b.issues +
           (priceTxt ? '\n💰 預估費用：' + priceTxt + '\n（實際費用以到店檢測結果為準）' : '') +
           '\n\n如需更改時間，請直接在此聊天室告訴我們，謝謝！';
    upd.status = 'confirmed'; upd.confirmedTime = time; if (price) upd.price = price;
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
  } else if (req.type === 'transfer') {
    // 客人改去另一間店修：改預約的分店；可選擇是否用 LINE 通知客人
    var to = req.to;
    if (!STORE_ADDR[to] || to === b.branch) return { ok: false, error: '要轉去的分店不正確' };
    upd.branch = to; upd.transferredFrom = b.branch; upd.transferredAt = now;
    if (req.notify) text = '📍 預約分店變更\n\n您的預約已改到：復原者' + to + '\n（' + STORE_ADDR[to] + '）\n🕐 ' + (b.confirmedTime || b.proposedTime || b.wish) +
      '\n📱 ' + b.model + '｜' + b.issues + '\n\n如有問題請直接在此聊天室告訴我們，謝謝！';
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
  return { ok: true, status: upd.status || b.status, branch: upd.branch || b.branch };
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
// 報價群組開關：QUOTE_GROUPS = { groupId: { name, on } }。老闆還沒設定過時，新群組預設記錄；設定過一次後，新群組預設不記錄
function quoteGroups_(props) { try { return JSON.parse(props.getProperty('QUOTE_GROUPS') || '{}'); } catch (e) { return {}; } }
function quoteGroupSeen_(props, gid, name) {
  var gs = quoteGroups_(props);
  if (!gs[gid]) { gs[gid] = { name: name || '群組', on: props.getProperty('QUOTE_GROUP_DEFAULT') !== 'off' }; props.setProperty('QUOTE_GROUPS', JSON.stringify(gs)); }
  else if (name && gs[gid].name !== name) { gs[gid].name = name; props.setProperty('QUOTE_GROUPS', JSON.stringify(gs)); }
  return gs;
}
function quoteGroupCmd_(props, cmd) {
  var gs = quoteGroups_(props), ids = Object.keys(gs);
  var m = cmd.match(/^記價(開|關)(\d+)$/);
  if (m) {
    var g = ids[Number(m[2]) - 1];
    if (!g) return '找不到第 ' + m[2] + ' 個群組，請先傳「記價群組」看編號。';
    gs[g].on = m[1] === '開'; props.setProperty('QUOTE_GROUPS', JSON.stringify(gs)); props.setProperty('QUOTE_GROUP_DEFAULT', 'off');
  }
  if (!ids.length) return '還沒有看到任何群組 🤔\n群組裡有人說話之後，我就會認得那個群組，再傳一次「記價群組」。';
  return (m ? '✅ 已' + (m[1] === '開' ? '開啟' : '關閉') + '「' + gs[ids[Number(m[2]) - 1]].name + '」\n\n' : '') + '📋 報價記錄群組：\n' +
    ids.map(function (g, i) { return (i + 1) + '. ' + (gs[g].on ? '✅ 記錄' : '⛔ 不記錄') + '　' + gs[g].name; }).join('\n') +
    '\n\n開啟：傳「記價開 1」\n關閉：傳「記價關 2」\n（設定過之後，新加入的群組預設不記錄）\n※ 群組裡要有人說過話，這裡才會列出來';
}
function quoteEvent_(ev, token, props) {
  // 被邀請進群組／被移出群組：私訊通知老闆（不在群組裡說話，同行不會發現）
  if (ev.type === 'join' || ev.type === 'leave') {
    var s0 = ev.source || {};
    var gname = s0.groupId ? groupName_(s0.groupId, token) : '多人聊天室', gidJ = s0.groupId || s0.roomId || '';
    if (ev.type === 'join' && gidJ) quoteGroupSeen_(props, gidJ, gname);
    var onNow = ev.type === 'join' && gidJ ? quoteGroups_(props)[gidJ].on : false;
    notifyOwner_(ev.type === 'join'
      ? '✅ 復原者Ai機器人已加入「' + gname + '」\n' + (onNow ? '這個群組的報價會自動記錄。' : '這個群組目前「不記錄」報價。') + '（機器人不會在群組裡發言）\n要開關請私訊我「記價群組」。'
      : '👋 復原者Ai機器人已被移出「' + gname + '」');
    return;
  }
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
  var src = ev.source || {}, uid = src.userId || '', text = String(ev.message.text || '').trim();
  var owner = props.getProperty('QUOTE_OWNER') || '';
  if (src.type === 'user') {
    if (text === '我是老闆') {
      if (!owner) { props.setProperty('QUOTE_OWNER', uid); reply_(ev.replyToken, token, '✅ 已設定您為老闆。\n之後您在群組報的價會記成「我的報價」，對象預設是群組名稱；同行報的價記成「同行報價」。\n\n要指定對象可以寫：13 pro 感應排線 3000（大昌）或 @大昌 13 pro 感應排線 3000\n\n也可以直接私訊我報價，我會回覆記錄結果。\n\n店員要加入：請店員私訊我「我是店員' + (props.getProperty('QUOTE_KEY') || '').slice(-4) + '」'); }
      else if (owner === uid) reply_(ev.replyToken, token, '您已經是老闆囉 👍');
      return;
    }
    if (uid === owner && /^記價群組$|^記價(開|關)\s*\d+$/.test(text.replace(/\s+/g, ''))) { reply_(ev.replyToken, token, quoteGroupCmd_(props, text.replace(/\s+/g, ''))); return; }
    var code = (props.getProperty('QUOTE_KEY') || '').slice(-4);
    if (code && text.replace(/\s+/g, '') === '我是店員' + code) {
      var team = teamIds_(props); if (team.indexOf(uid) < 0) { team.push(uid); props.setProperty('QUOTE_TEAM', team.join(',')); }
      reply_(ev.replyToken, token, '✅ 已加入店員。之後您在群組回的價格也會記成「我們的報價」。'); return;
    }
    if (uid !== owner && teamIds_(props).indexOf(uid) < 0) return;   // 私訊只處理老闆和已登記的店員
  }
  var mine = !!uid && (uid === owner || teamIds_(props).indexOf(uid) >= 0);
  var gid0 = src.groupId || src.roomId || '';
  if (gid0) {   // 只記錄老闆開啟的群組（私訊「記價群組」設定）
    var gs = quoteGroups_(props);
    if (!gs[gid0]) gs = quoteGroupSeen_(props, gid0, src.groupId ? groupName_(src.groupId, token) : '多人聊天室');
    if (!gs[gid0].on) return;
  }
  // 群組裡客人／同行的問題：記下最近問的機型、維修項目，等我們只回「800」時拿來配對
  if (gid0 && !mine) rememberAsk_(gid0, text, memberName_(src, token), ev.message.id);
  // 私訊「記價 傻傻修 poco x5 pro 電池 1000」→ 開頭是店名 → 記成同行報價
  var body = src.type === 'user' ? text.replace(/^\s*(記價|記錄|登記)\s*/, '') : text, peerName = '';
  if (src.type === 'user') { peerName = peerPrefix_(body); if (peerName) body = body.slice(body.indexOf(peerName) + peerName.length).trim(); }
  var items = parseQuoteLines_(body);
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
  var speaker = peerName || (mine ? '我' : memberName_(src, token));
  var now = new Date(ev.timestamp || Date.now());
  var docs = items.map(function (q, i) {
    return { ts: now.toISOString(), date: Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd'),
      who: mine && !peerName ? 'me' : 'peer', speaker: speaker, groupId: gid, group: group,
      model: q.model, modelKey: mkey_(q.model), part: partOf_(q.part) || q.part, price: q.price, raw: q.raw, review: q.review, msgId: ev.message.id + '_' + i,
      kind: q.kind, target: q.target || (mine && src.groupId ? shortTarget_(group) : ''), asker: q.asker || '' };
  });
  // 私訊記價：先回覆（感覺比較快），再一次存進資料庫；萬一存失敗再補傳一則通知
  if (src.type === 'user') reply_(ev.replyToken, token, '✅ 已記錄 ' + items.length + ' 筆：\n' + items.map(function (q) {
    return '・' + (peerName ? '［同行 ' + peerName + '］' : '') + (q.model || '（機型？）') + ' ' + (q.part || '（零件？）') + ' $' + q.price + (q.target ? '（給 ' + q.target + '）' : '') + (q.kind === 'commission' ? '［門號佣金］' : '');
  }).join('\n') + (items.some(function (q) { return q.review; }) ? '\n\n有標「？」的請到報價頁補上。' : ''));
  try { createDocs_('quotes', docs); }
  catch (err) {
    console.error(err);
    if (src.type === 'user' && uid) UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ to: uid, messages: [{ type: 'text', text: '⚠️ 剛剛的報價沒有存成功（' + (String(err.message).indexOf('429') >= 0 ? '資料庫今天額度用完' : '資料庫忙碌') + '），請稍後再傳一次。' }] }) });
  }
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
  // CER 手機急診室（台北）：各品牌一頁，每列一個機型、每欄一個維修項目
  { key: 'cer', name: 'CER(台北)', layout: 'grid', updated: '',
    urls: ['apple', 'samsung', 'google', 'sony', 'asus', 'oppo', 'mi', 'huawei_etc'].map(function (b) { return 'https://cerphone.com/index.php/quotation_' + b + '/'; }) },
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
      var html = (src.urls || [src.url]).map(function (u) {
        var res = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true });
        if (res.getResponseCode() !== 200) { console.error(src.name + ' HTTP ' + res.getResponseCode() + ' ' + u); return ''; }
        return res.getContentText('UTF-8');
      }).join('\n');
      if (!html) return;
      if (src.layout === 'static') {
        var same = src.imgs.every(function (id) { return html.indexOf(id) >= 0; });
        props.setProperty('WEB_STALE_' + src.key, same ? '' : '1');
        if (!same) console.error(src.name + '：價目圖已更換，請找 Claude 重新看圖登打');
      }
      var rows = src.layout === 'static' ? sasaRows_() : src.layout === 'rows' ? parseRowTable_(html, src.prefix || '') : src.layout === 'grid' ? parseGrid_(html) : parseWebPrices_(html);
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
  var t = String(it), R = [[/電池/, '電池'], [/螢幕|白屏|綠屏|玻璃破裂|液晶/, '螢幕'], [/鏡頭|攝像頭/, '鏡頭'], [/聽筒|揚聲器|喇叭/, '喇叭/聽筒'], [/face ?id|臉部/i, 'Face ID'],
    [/主機板|主板|搬板|機板/, '主板'], [/無線充電/, '無線充電'], [/尾插|尾部充電|充電孔|充電/, '充電孔'], [/泡水/, '泡水'], [/開機|音量|home|靜音|相機控制/i, '按鍵'],
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
// 通用格子表：第一列＝表頭（第一格是品牌，其餘是維修項目），之後每列＝機型＋各項價格
// 機型格可能寫「小米 9T／9T Pro」→ 拆成兩個機型；價格格可能寫「3500／2800」「京東方8000/三星11000」→ 取第一個數字
function parseGrid_(html) {
  var out = [], clean = function (c) { return c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&#8212;/g, '-').replace(/\s+/g, ' ').trim(); };
  (html.match(/<table[\s\S]*?<\/table>/gi) || []).forEach(function (tb) {
    var trs = tb.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    if (trs.length < 2) return;
    var head = (trs[0].match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(clean);
    if (head.length < 2) return;
    var first = head[0].split(/\s+/)[0];
    var brand = /^(機型|型號|品牌|項目)$/.test(first) ? '' : (/^[A-Za-z\u4e00-\u9fff]+$/.test(first) ? first : '');
    trs.slice(1).forEach(function (tr) {
      var cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(clean);
      if (cells.length < 2 || !cells[0]) return;
      var models = cells[0].replace(/[（(][^）)]*[）)]/g, ' ').split(/[／\/、,]/).map(function (x) { return x.trim(); }).filter(String);
      models.forEach(function (raw) {
        var withBrand = brand && raw.toLowerCase().indexOf(brand.toLowerCase()) < 0 && !/^iphone/i.test(raw) ? brand + ' ' + raw : raw;
        if (/^samsung$/i.test(brand) && /^(z\s*)?(flip|fold)/i.test(raw)) withBrand = raw;
        var name = ctxModel_(withBrand) || withBrand;
        // 別的品牌的表格，不能被猜成 iPhone（例：NOKIA X、Samsung J7）
        if (/^iPhone/.test(name) && brand && !/^(iphone|apple)$/i.test(brand)) name = withBrand.replace(/\s+/g, ' ').toUpperCase();
        for (var i = 1; i < cells.length && i < head.length; i++) {
          var m = cells[i].replace(/,/g, '').match(/(\d{3,6})/);
          if (m && Number(m[1]) >= 100) out.push({ model: name, item: head[i], price: Number(m[1]) });
        }
      });
    });
  });
  return out;
}
function webQuotes_(model, part) {
  if (!model) return [];
  var props = PropertiesService.getScriptProperties();
  var res = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'web_prices' }], where: { fieldFilter: { field: { fieldPath: 'modelKey' }, op: 'EQUAL', value: { stringValue: wkey_(model) } } }, limit: 300 } }) });
  if (res.getResponseCode() === 429) QUOTA_HIT = true;
  if (res.getResponseCode() !== 200) return [];
  return JSON.parse(res.getContentText()).filter(function (x) { return x.document; }).map(function (x) { return fromFields_(x.document.fields); })
    .filter(function (r) { return r.run === props.getProperty('WEB_RUN_' + r.src) && (part ? r.part === part : (r.part === '螢幕' || r.part === '電池')); });
}

// 開頭第一段不是機型、不是品牌、也不是維修項目，後面接著機型 → 當成同行店名
function peerPrefix_(t) {
  var m = String(t).match(/^\s*([^\s\d@＠(（][^\s]{0,19})\s+(.+)$/);
  if (!m) return '';
  var name = m[1], rest = m[2];
  if (/^(三星|samsung|紅米|redmi|小米|apple|iphone|ip|蘋果|oppo|vivo|華碩|asus|sony|google|pixel|realme|poco|htc|nokia|摩托|moto|華為|huawei|榮耀|honor|查|查價)$/i.test(name)) return '';
  if (ctxModel_(name) || partOf_(name)) return '';
  var restModel = ctxModel_(rest);
  if (!restModel || mkey_(ctxModel_(t)) !== mkey_(restModel)) return '';
  return name;
}

/* ═══ 私訊查價 ═══ */
var QUOTA_HIT = false;   // 這次查詢是否碰到 Firebase 每日讀取額度用完（429）
function runQuery_(where, max) {
  var res = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'quotes' }], where: where, limit: max || 500 } }) });
  if (res.getResponseCode() === 429) QUOTA_HIT = true;
  if (res.getResponseCode() !== 200) { console.error(res.getContentText()); return []; }
  return JSON.parse(res.getContentText()).filter(function (x) { return x.document; }).map(function (x) { return fromFields_(x.document.fields); });
}
// 機型比對用：不分大小寫、空白、紅米/Redmi、4G/5G
function mkey_(m) { return String(m || '').toLowerCase().replace(/紅米/g, 'redmi').replace(/iphone/g, '').replace(/(^|\s)[45]g(?=\s|$)/g, ' ').replace(/\s+/g, ''); }
function lookupQuotes_(text) {
  var q = String(text).replace(/^\s*(幫我)?(查價|查詢|查一下|查)\s*/, '');
  var model = ctxModel_(q), part = partOf_(q);
  if (!model && !part) return '';
  var norm = mkey_;
  var rows;
  // 有機型就先用機型找（筆數少、省讀取額度）；只問零件沒講機型時才用零件找
  if (!model) rows = runQuery_({ fieldFilter: { field: { fieldPath: 'part' }, op: 'EQUAL', value: { stringValue: part } } }, 300);
  else {
    var vars = [model, model.toUpperCase(), model.replace(/^VIVO/, 'vivo').replace(/^REDMI/, 'Redmi').replace(/^PIXEL/, 'Pixel').replace(/^REALME/, 'realme').replace(/^SONY/, 'Sony')]
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    rows = runQuery_({ fieldFilter: { field: { fieldPath: 'model' }, op: 'IN', value: { arrayValue: { values: vars.map(function (v) { return { stringValue: v }; }) } } } });
    var seen = {}; rows.forEach(function (r) { seen[r.ts + r.price + r.part] = 1; });
    runQuery_({ fieldFilter: { field: { fieldPath: 'modelKey' }, op: 'EQUAL', value: { stringValue: mkey_(model) } } })
      .forEach(function (r) { if (!seen[r.ts + r.price + r.part]) rows.push(r); });
  }
  if (part && !rows.length) rows = [];
  // 自由輸入的零件名（例：感應排線）也一起找
  rows = rows.filter(function (r) { return (!model || norm(r.model) === norm(model)) && (!part || r.part === part || partOf_(r.part) === part); });
  var web = [];
  try { web = webQuotes_(model, part); } catch (e) { console.error(e); }
  if (!rows.length && !web.length) return QUOTA_HIT ? '⚠️ 資料庫今天的免費查詢次數用完了，暫時查不到價格。\n台灣時間下午 4 點後會自動恢復，請稍後再查。' : '';
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
        wl.push((i ? '　　' : site + ' ') + money(r.price) + '　' + r.item + (i ? '' : (r.updated ? '（官網 ' + r.updated + ' 更新）' : '（' + String(r.run || '').slice(5).replace('-', '/') + ' 抓取）') + stale));
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
    if (/總金額|總價|總額|總計|總共|合計|小計|共計|一共|加總|全部共|全部加起來|total/i.test(raw)) return;   // 總金額不是單項報價，不記
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
  // iPad／Apple Watch／AirPods：iPad 5、iPad Air 4、iPad mini 6、iPad Pro 11、AW S7、Apple Watch Ultra 2、AirPods Pro 2
  if ((m = t.match(/(?:^|\s)(ipad\s*(pro|air|mini)?\s*(\d{1,2}(?:\.\d)?)?\s*(?:代|th|吋)?)(?=\s|$|[^\da-z])/i))) {
    var v = (m[2] || '').toLowerCase(), vm = { pro: ' Pro', air: ' Air', mini: ' mini' };
    return { raw: m[1], name: 'iPad' + (vm[v] || '') + (m[3] ? ' ' + m[3] : '') };
  }
  if ((m = t.match(/(?:^|\s)((?:apple\s*watch|aw)\s*(?:series\s*|s)?(\d{1,2}|se\s*\d?|ultra\s*\d?))(?=\s|$|[^\da-z])/i))) {
    var w = m[2].replace(/\s+/g, ''); return { raw: m[1], name: 'Apple Watch ' + (/^\d/.test(w) ? 'S' + w : w.toUpperCase().replace('ULTRA', 'Ultra ').trim()) };
  }
  if ((m = t.match(/(?:^|\s)(airpods?\s*(pro|max)?\s*(\d)?)(?=\s|$|[^\da-z])/i)))
    return { raw: m[1], name: 'AirPods' + (m[2] ? ' ' + m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : '') + (m[3] ? ' ' + m[3] : '') };
  // 其他品牌先判斷（避免「紅米 note 10」被當成 iPhone）
  if ((m = t.match(/(?:^|\s)((oppo|vivo|redmi|紅米|小米|poco|mi|pixel|sony|xperia|zf|zenfone|asus|realme|nokia|htc)\s*[a-z]*\s*\d+[a-z]*(?:\s*(?:pro|plus|ultra|lite|5g))?)(?=\s|$)/i)))
    return { raw: m[1], name: m[1].replace(/\s+/g, ' ').toUpperCase() };
  if ((m = t.match(/(?:^|\s)((?:iphone\s*|ip\s*|i)?(1[1-9]|[6-9])\s*(pro\s*max|promax|pm|pro|plus|mini|max|p|e)?(?=\s|$|[^\da-z]))/i))) {
    var suf = (m[3] || '').toLowerCase().replace(/\s+/g, '');
    var map = { promax: 'Pro Max', pm: 'Pro Max', pro: 'Pro', plus: 'Plus', p: 'Plus', mini: 'mini', max: 'Max', e: 'e' };
    if (!(Number(m[2]) <= 9 && suf === 'pro'))
      return { raw: m[1], name: 'iPhone ' + m[2] + (suf ? ' ' + map[suf] : '') };
  }
  if ((m = t.match(/(?:^|\s)((?:iphone\s*)?(xs\s*max|xsmax|xr|xs|x|se\s*[23]|se))(?=\s|$|[^\da-z])/i)))
    return { raw: m[1], name: 'iPhone ' + m[2].toUpperCase().replace(/\s+/g, ' ').replace('XSMAX', 'XS Max').replace('XS MAX', 'XS Max') };
  // 其他品牌：OPPO A77、Redmi Note 12、ZF12U、Pixel 7
  if ((m = t.match(/(?:^|\s)((oppo|vivo|redmi|紅米|小米|poco|mi|pixel|sony|xperia|zf|zenfone|asus|realme|nokia|htc)\s*[a-z]*\s*\d+[a-z]*(?:\s*(?:pro|plus|ultra|lite|5g))?)(?=\s|$)/i)))
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

/* ───────── 每月自動備份：把 Firestore 全部資料存到 Google 雲端硬碟 ─────────
 * 第一次：在編輯器上方選 setupBackup → 執行（會跳出 Google 授權，允許存取雲端硬碟）。
 * 之後每月 1 號凌晨 3 點自動備份到雲端硬碟「復原者系統備份」資料夾，保留 1 年。
 * 失敗會用小幫手 LINE 通知老闆。需要時也可以手動執行 backupFirestore 立刻備份一次。
 *   （免費方案每天只有 5 萬次讀取，全部備份一次要讀每一筆資料，所以一個月一次）
 * 檔案是 .json.gz（原始格式，可以完整還原）。還原請交給 Claude 處理（restoreBackup_）。
 */
var BACKUP_FOLDER = '復原者系統備份';
function setupBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupFirestore') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupFirestore').timeBased().onMonthDay(1).atHour(3).inTimezone('Asia/Taipei').create();
  var r = backupFirestore();
  notifyOwner_('🗄️ 每月自動備份已開啟（每月 1 號凌晨 3 點）\n第一份備份完成：' + r.docs + ' 筆資料、' + r.cols + ' 個資料表\n存在 Google 雲端硬碟「' + BACKUP_FOLDER + '」資料夾。');
  return r;
}
function backupFolder_() {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
}
// 系統用到的全部資料表（若 Google 不允許自動列出，就用這份清單）
var BACKUP_COLLECTIONS = ['records', 'bookings', 'care_bindings', 'line_users', 'slot_blocks', 'ledger', 'ledger_meta', 'ledger_cash', 'ledger_bak', 'ledger_bak_rows',
  'quotes', 'web_prices', 'used_stock', 'settings', 'credit', 'todos', 'transfers', 'reservations', 'watchlist', 'accessories'];
function listCollections_() {
  try { var got = listCollectionsApi_(); BACKUP_COLLECTIONS.forEach(function (c) { if (got.indexOf(c) < 0) got.push(c); }); return got; }
  catch (e) { return BACKUP_COLLECTIONS.slice(); }
}
function listCollectionsApi_() {
  var ids = [], token = '';
  do {
    var res = fsFetch_(fsBase_() + ':listCollectionIds', { method: 'post', payload: JSON.stringify({ pageSize: 100, pageToken: token }) });
    if (res.getResponseCode() !== 200) throw new Error('讀取資料表清單失敗：' + res.getContentText().slice(0, 200));
    var j = JSON.parse(res.getContentText());
    ids = ids.concat(j.collectionIds || []); token = j.nextPageToken || '';
  } while (token);
  return ids;
}
function backupFirestore() {
  try {
    var out = { project: FIREBASE_PROJECT_ID, at: new Date().toISOString(), collections: {} }, total = 0;
    var cols = listCollections_();
    cols.forEach(function (c) {
      var docs = [], token = '';
      do {
        var url = fsBase_() + '/' + encodeURIComponent(c) + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
        var res = fsFetch_(url);
        if (res.getResponseCode() !== 200) throw new Error(c + ' 讀取失敗：' + res.getContentText().slice(0, 200));
        var j = JSON.parse(res.getContentText());
        (j.documents || []).forEach(function (d) { docs.push({ name: d.name, fields: d.fields || {} }); });
        token = j.nextPageToken || '';
      } while (token);
      out.collections[c] = docs; total += docs.length;
    });
    var day = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
    var blob = Utilities.gzip(Utilities.newBlob(JSON.stringify(out), 'application/json', 'backup-' + day + '.json'), 'backup-' + day + '.json.gz');
    var folder = backupFolder_();
    var same = folder.getFilesByName(blob.getName()); while (same.hasNext()) same.next().setTrashed(true);
    folder.createFile(blob);
    pruneBackups_(folder);
    PropertiesService.getScriptProperties().setProperty('BACKUP_LAST', day + ' ' + total);
    return { docs: total, cols: cols.length, file: blob.getName() };
  } catch (err) {
    notifyOwner_('⚠️ 系統每月備份失敗\n' + String(err && err.message || err).slice(0, 300) + '\n請告訴 Claude 處理。');
    throw err;
  }
}
function pruneBackups_(folder) {
  var now = Date.now(), files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next(), m = f.getName().match(/^backup-(\d{4})-(\d{2})-(\d{2})\.json\.gz$/);
    if (!m) continue;
    var age = (now - new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+08:00').getTime()) / 864e5;
    var keep = age <= 370;   // 保留 1 年
    if (!keep) f.setTrashed(true);
  }
}
/* 還原（只在需要時由 Claude 執行）：fileName 例 'backup-2026-11-16.json.gz'；
 * onlyCollections 例 ['ledger']，不填＝全部。只會「寫回／覆蓋」備份裡有的文件，不會刪除備份後新增的資料。 */
function restoreBackup_(fileName, onlyCollections) {
  var it = backupFolder_().getFilesByName(fileName);
  if (!it.hasNext()) throw new Error('找不到備份檔：' + fileName);
  var data = JSON.parse(Utilities.ungzip(it.next().getBlob().setContentType('application/x-gzip')).getDataAsString());
  var n = 0;
  Object.keys(data.collections).forEach(function (c) {
    if (onlyCollections && onlyCollections.indexOf(c) < 0) return;
    data.collections[c].forEach(function (d) {
      var res = fsFetch_('https://firestore.googleapis.com/v1/' + d.name, { method: 'patch', payload: JSON.stringify({ fields: d.fields }) });
      if (res.getResponseCode() !== 200) throw new Error('還原失敗：' + d.name + ' ' + res.getContentText().slice(0, 200));
      n++;
    });
  });
  return n;
}
