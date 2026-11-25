// 手機機型清單＋配件相容判斷（唯一來源）
// 用在：care/acc.html（配件管理勾適用機型）、官網中古機／配件頁（used-phones repo 直接 import 這個檔）
// 新機上市：在 MODELS 加一行就好（新的放前面）。connector：充電接頭，用來自動配對充電線。

export const MODELS = [
  // ── iPhone ──
  ['iPhone', 'iPhone 18 Pro Max', 'USB-C'], ['iPhone', 'iPhone 18 Pro', 'USB-C'], ['iPhone', 'iPhone Duo', 'USB-C'],
  ['iPhone', 'iPhone 17 Pro Max', 'USB-C'], ['iPhone', 'iPhone 17 Pro', 'USB-C'], ['iPhone', 'iPhone Air', 'USB-C'], ['iPhone', 'iPhone 17', 'USB-C'],
  ['iPhone', 'iPhone 16e', 'USB-C'],
  ['iPhone', 'iPhone 16 Pro Max', 'USB-C'], ['iPhone', 'iPhone 16 Pro', 'USB-C'], ['iPhone', 'iPhone 16 Plus', 'USB-C'], ['iPhone', 'iPhone 16', 'USB-C'],
  ['iPhone', 'iPhone 15 Pro Max', 'USB-C'], ['iPhone', 'iPhone 15 Pro', 'USB-C'], ['iPhone', 'iPhone 15 Plus', 'USB-C'], ['iPhone', 'iPhone 15', 'USB-C'],
  ['iPhone', 'iPhone 14 Pro Max', 'Lightning'], ['iPhone', 'iPhone 14 Pro', 'Lightning'], ['iPhone', 'iPhone 14 Plus', 'Lightning'], ['iPhone', 'iPhone 14', 'Lightning'],
  ['iPhone', 'iPhone 13 Pro Max', 'Lightning'], ['iPhone', 'iPhone 13 Pro', 'Lightning'], ['iPhone', 'iPhone 13', 'Lightning'], ['iPhone', 'iPhone 13 mini', 'Lightning'],
  ['iPhone', 'iPhone 12 Pro Max', 'Lightning'], ['iPhone', 'iPhone 12 Pro', 'Lightning'], ['iPhone', 'iPhone 12', 'Lightning'], ['iPhone', 'iPhone 12 mini', 'Lightning'],
  ['iPhone', 'iPhone 11 Pro Max', 'Lightning'], ['iPhone', 'iPhone 11 Pro', 'Lightning'], ['iPhone', 'iPhone 11', 'Lightning'],
  ['iPhone', 'iPhone SE (第3代)', 'Lightning'], ['iPhone', 'iPhone SE (第2代)', 'Lightning'],
  // ── Samsung ──
  ['Samsung', 'Galaxy S25 Ultra', 'USB-C'], ['Samsung', 'Galaxy S25+', 'USB-C'], ['Samsung', 'Galaxy S25', 'USB-C'], ['Samsung', 'Galaxy S25 FE', 'USB-C'],
  ['Samsung', 'Galaxy S24 Ultra', 'USB-C'], ['Samsung', 'Galaxy S24+', 'USB-C'], ['Samsung', 'Galaxy S24', 'USB-C'], ['Samsung', 'Galaxy S24 FE', 'USB-C'],
  ['Samsung', 'Galaxy S23 Ultra', 'USB-C'], ['Samsung', 'Galaxy S23+', 'USB-C'], ['Samsung', 'Galaxy S23', 'USB-C'], ['Samsung', 'Galaxy S23 FE', 'USB-C'],
  ['Samsung', 'Galaxy Z Fold7', 'USB-C'], ['Samsung', 'Galaxy Z Flip7', 'USB-C'], ['Samsung', 'Galaxy Z Fold6', 'USB-C'], ['Samsung', 'Galaxy Z Flip6', 'USB-C'],
  ['Samsung', 'Galaxy Z Fold5', 'USB-C'], ['Samsung', 'Galaxy Z Flip5', 'USB-C'],
  ['Samsung', 'Galaxy A56', 'USB-C'], ['Samsung', 'Galaxy A36', 'USB-C'], ['Samsung', 'Galaxy A26', 'USB-C'], ['Samsung', 'Galaxy A16', 'USB-C'],
  ['Samsung', 'Galaxy A55', 'USB-C'], ['Samsung', 'Galaxy A35', 'USB-C'], ['Samsung', 'Galaxy A25', 'USB-C'], ['Samsung', 'Galaxy A15', 'USB-C'],
  // ── Google ──
  ['Google', 'Pixel 10 Pro XL', 'USB-C'], ['Google', 'Pixel 10 Pro', 'USB-C'], ['Google', 'Pixel 10', 'USB-C'], ['Google', 'Pixel 10 Pro Fold', 'USB-C'],
  ['Google', 'Pixel 9 Pro XL', 'USB-C'], ['Google', 'Pixel 9 Pro', 'USB-C'], ['Google', 'Pixel 9', 'USB-C'], ['Google', 'Pixel 9a', 'USB-C'],
  ['Google', 'Pixel 8 Pro', 'USB-C'], ['Google', 'Pixel 8', 'USB-C'], ['Google', 'Pixel 8a', 'USB-C'], ['Google', 'Pixel 7 Pro', 'USB-C'], ['Google', 'Pixel 7', 'USB-C'], ['Google', 'Pixel 7a', 'USB-C'],
  // ── iPad（常見）──
  ['iPad', 'iPad (A16)', 'USB-C'], ['iPad', 'iPad 第10代', 'USB-C'], ['iPad', 'iPad 第9代', 'Lightning'],
  ['iPad', 'iPad Air 11吋 (M2/M3)', 'USB-C'], ['iPad', 'iPad Air 13吋 (M2/M3)', 'USB-C'], ['iPad', 'iPad mini (A17 Pro)', 'USB-C'], ['iPad', 'iPad mini 6', 'USB-C'],
  ['iPad', 'iPad Pro 11吋 (M4/M5)', 'USB-C'], ['iPad', 'iPad Pro 13吋 (M4/M5)', 'USB-C'],
].map(([brand, name, conn]) => ({ brand, name, conn }));

export const BRANDS = [...new Set(MODELS.map(m => m.brand))];
export const CATS = ['手機殼', '保護貼', '鏡頭貼', '充電線', '充電器', '行動電源', '耳機', '掛繩・其他'];

// 比對用的 key：大寫、去空白／符號、拿掉品牌字樣（GALAXY、GOOGLE），SE 的代別統一
const key = s => String(s || '').toUpperCase()
  .replace(/第\s*3\s*代|\(?\s*3RD\s*(GEN)?\s*\)?|2022/g, '3').replace(/第\s*2\s*代|\(?\s*2ND\s*(GEN)?\s*\)?|2020/g, '2')
  .replace(/SAMSUNG|GALAXY|GOOGLE|APPLE/g, '').replace(/PLUS/g, '+').replace(/[\s\-_/／()（）.]+/g, '');
const KEYS = MODELS.map(m => ({ m, k: key(m.name) })).sort((a, b) => b.k.length - a.k.length);

// 店裡寫的機型（例「iPhone 17 256G 官換機」「S24 ULTRA 256」「14 PRO MAX」）→ 對到清單裡的標準機型；對不到回傳 null
export function findModel(text) {
  let t = key(text);
  if (!t) return null;
  if (/^(1[1-9]|SE|AIR)/.test(t)) t = 'IPHONE' + t;          // 只寫數字的是 iPhone
  if (/^(S2\d|Z(FOLD|FLIP)|A\d\d)/.test(t)) t = t;            // 三星已經去掉 GALAXY，直接比
  for (const { m, k } of KEYS) {
    if (!t.startsWith(k)) continue;
    const rest = t.slice(k.length);
    if (/^(PRO|MAX|PLUS|\+|MINI|ULTRA|FE|XL|E|A|FOLD)/.test(rest)) continue;   // 例：「IPHONE16」不能吃掉「IPHONE16PRO」
    return m;
  }
  return null;
}

// 這個配件適不適合這支手機：通用 → 是；有勾這個機型 → 是；充電線接頭一樣 → 是
export function fits(acc, model) {
  if (!model) return !!acc.all;
  if (acc.all) return true;
  if ((acc.models || []).includes(model.name)) return true;
  if (acc.conn && acc.conn === model.conn) return true;
  return false;
}
