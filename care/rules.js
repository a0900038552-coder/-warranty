// 復原者 保固規則（保固系統與每日登打共用，改規則只要改這裡）
/* ════════ 2. 保固規則（對應官網 /123 與 Repair CARE+）════════ */
export const BRANCHES = ['楠梓店', '德賢店'];
export const CARE_BIND_WINDOW_DAYS = 14;   // 維修日後幾天內可用 LINE 登錄 CARE+
export const CATS = {
  screen:  { label: '液晶／螢幕', base: 30, care: 60 },
  battery: { label: '電池',       base: 90, care: 90 },
  port:    { label: '尾插排／板', base: 30, care: 60 },
  camera:  { label: '前後鏡頭',   base: 30, care: 30 },
  board:   { label: '主機板 IC',  base: 30, care: 30 },
  flex:    { label: '排線類',     base: 30, care: 30 },
  used:    { label: '中古機',     base: 30, care: 30 },
  newphone:{ label: '新機',       base: 365, care: 0 },
  other:   { label: '其他（依店家告知）', base: null, care: 0 },
  none:    { label: '無保固項目', base: 0,  care: 0 },
};
export function autoCategory(type) {
  const t = String(type || '').replace(/\s+/g, '');
  // 先拿掉附加的配件／贈品（例：「液晶/雄0324 送霧面滿玻」裡的滿玻），再判斷維修零件
  const ADDON = /[前後]?鏡頭(保護)?貼|送[^+＋、]*|霧面滿玻|滿玻|玻保|保護貼|玻璃貼|鏡頭貼|犀牛盾|惡魔盾|[^+＋、]*殼|皮套|掛繩|傳輸線|充電線|充電頭|旅充|資料轉移|清潔/g;
  const core = t.replace(ADDON, '');
  // 手機銷售：中古機 1 個月＋CARE+ 1 個月；新機（含老人機）1 年
  if (/中古|二手/.test(core)) return 'used';
  if (/新機|老人機/.test(core)) return 'newphone';
  if (/電池/.test(core)) return 'battery';
  // 主機板類：不開機、充電IC、零件座等
  if (/不開機|不開基|IC|主機板|主板|機板|液晶座|排線座|主板座|機板座/i.test(core)) return 'board';
  // 飛線是在液晶上作業 → 依液晶保固
  if (/飛線|液晶|螢幕|面板|總成|觸控/.test(core)) return 'screen';
  if (/尾插|充電孔|充電口|充電座|充電板|小板/.test(core)) return 'port';
  // 排線類：開機排、音量排、聽筒、聽筒排、喇叭（保固 1 個月＋CARE+ 1 個月）
  if (/排線|開機排|音量排|聽筒|喇叭/.test(core)) return 'flex';
  if (/鏡頭|相機|視訊/.test(core)) return 'camera';
  // 無保固：配件、按鍵、外殼、軟體服務（依官網條款）
  if (core !== t || /軟體|刷機|升級|系統|外殼|中框|背蓋|後蓋|按鍵|開機鍵|音量鍵/.test(t)) return 'none';
  return 'other';
}

// 一筆品項可能含多個零件，例如「iPhone 13 電池0112+尾插排/鴻0113」→ 電池、尾插排 各自保固
export function parseItems(type) {
  const segs = String(type || '').split(/[+＋、，,;；&]/).map(s => s.trim()).filter(Boolean);
  const seen = new Set(), items = [];
  segs.forEach(s => {
    const k = autoCategory(s);
    if (k === 'other' || k === 'none' || seen.has(k)) return;
    seen.add(k); items.push(k);
  });
  if (!items.length) items.push(autoCategory(type));
  return items;
}
// 由零件類別組出要存的保固欄位
export function warrantyFields(cats, otherDays) {
  const items = cats.map(k => ({ category: k, baseDays: CATS[k].base === null ? Number(otherDays || 0) : CATS[k].base, careDays: CATS[k].care }));
  const main = items.reduce((a, b) => (b.baseDays + b.careDays > a.baseDays + a.careDays ? b : a), items[0]);
  return {
    category: main.category, baseDays: main.baseDays, careDays: main.careDays,
    items, itemsCode: items.map(i => `${i.category}:${i.baseDays}:${i.careDays}`).join('|'),
  };
}
export function recItems(r) {
  if (Array.isArray(r.items) && r.items.length) return r.items;
  return [{ category: r.category || 'other', baseDays: Number(r.baseDays) || 0, careDays: Number(r.careDays) || 0 }];
}

// LINE Pay 延遲入帳：品項開頭寫實際交機日，例「11/1 13 電池/雄1028」→ 保固從 11/1 起算
export function dateFromType(type, bookedDate) {
  const m = String(type || '').trim().match(/^(\d{1,2})[\/.](\d{1,2})(?=\s|$)/);
  if (!m || !bookedDate) return '';
  const mo = Number(m[1]), da = Number(m[2]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  const bk = parseD(bookedDate);
  let d = new Date(bk.getFullYear(), mo - 1, da);
  if (d.getMonth() !== mo - 1) return '';
  if (d > bk) d = new Date(bk.getFullYear() - 1, mo - 1, da); // 例：1/5 入帳、品項寫 12/28 → 去年
  return ymd(d);
}

export function parseD(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function normPhone(p) { let s = String(p || '').replace(/\D/g, ''); if (s.length === 9 && s[0] === '9') s = '0' + s; return s; }

// 退修：品項以「退修／退貨／退款」開頭，例「退修 10/27 13電池/雄0908」
// → 在保固系統多一筆「退修」紀錄（原本的保固不取消），並對到原本那次維修
export const REFUND_RE = /^\s*(退修|退貨|退款)[\s:：\-]*/;
export function refundInfo(type, bookedDate) {
  const s = String(type || '');
  if (!REFUND_RE.test(s)) return null;
  const rest = s.replace(REFUND_RE, '').trim();
  const origDate = dateFromType(rest, bookedDate);
  const origItem = rest.replace(/^\d{1,2}[\/.]\d{1,2}\s*/, '').trim();
  return { origDate, origItem };
}
export function refundRecord(base, bookedDate) {
  const info = refundInfo(base.type, bookedDate) || { origDate: '', origItem: '' };
  return { ...base, kind: 'refund', repairDate: bookedDate, bookedDate, origDate: info.origDate, origItem: info.origItem,
    category: 'none', baseDays: 0, careDays: 0, items: [{ category: 'none', baseDays: 0, careDays: 0 }], itemsCode: 'none:0:0' };
}
