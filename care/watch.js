// 注意客人名單（watchlist）：經常預約不來、保留棄單、付款或糾紛等「值得提醒同事」的紀錄
// 一個電話一筆（文件 ID＝09 開頭 10 碼電話；只有 LINE 沒電話的用 L_<LINE userId>）
// 查詢一次只讀 1 筆（getDoc），同一支電話 30 分鐘內不重讀 → 幾乎不吃免費額度
// 只放「事實」：日期、哪間店、發生什麼事。不要寫罵人或猜測的字眼（客人有權要求查看、更正、刪除自己的資料）
import { doc, getDoc, setDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const WATCH_TYPES = ['預約未到', '保留逾期未取', '付款問題', '退換貨糾紛', '其他'];
const TTL = 30 * 60e3, mem = new Map();

export const watchKey = p => {
  const s = String(p || '').trim();
  if (/^L_U[0-9a-f]{32}$/.test(s)) return s;
  const d = s.replace(/\D/g, '').replace(/^886/, '0');
  return /^9\d{8}$/.test(d) ? '0' + d : /^09\d{8}$/.test(d) ? d : '';
};
function load(k) {
  if (mem.has(k)) return mem.get(k);
  try { const x = JSON.parse(sessionStorage.getItem('watch.' + k) || 'null'); if (x && Date.now() - x.t < TTL) { mem.set(k, x); return x; } } catch {}
  return null;
}
function keep(k, v) { const x = { v, t: Date.now() }; mem.set(k, x); try { sessionStorage.setItem('watch.' + k, JSON.stringify(x)); } catch {} return v; }

// 查一支電話：有紀錄回傳資料，沒有回傳 null
export async function checkPhone(db, phone) {
  const k = watchKey(phone); if (!k) return null;
  const hit = load(k); if (hit) return hit.v;
  try { const s = await getDoc(doc(db, 'watchlist', k)); return keep(k, s.exists() && (s.data().entries || []).length ? { id: k, ...s.data() } : null); }
  catch { return null; }
}
// 只看已經查過的（不讀資料庫），給會一直重畫的畫面用
export const peekPhone = phone => { const k = watchKey(phone); const x = k && load(k); return x ? x.v : null; };

let css = false;
function addCss() {
  if (css) return; css = true;
  const s = document.createElement('style');
  s.textContent = `.watch-b{display:inline-flex;align-items:center;gap:3px;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:99px;padding:1px 8px;font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap;vertical-align:middle}
  @media print{.watch-b{display:none!important}}`;
  document.head.appendChild(s);
}
export function badgeHtml(w) {
  if (!w) return '';
  addCss();
  const es = w.entries || [], last = es[es.length - 1] || {};
  const tip = es.slice(-5).map(e => `${e.date} ${e.branch} ${e.type}${e.note ? '：' + e.note : ''}`).join('\n');
  return `<a class="watch-b" href="watch.html?p=${encodeURIComponent(w.id)}" target="_blank" title="${tip.replace(/"/g, '&quot;')}">⚠️ 注意 ${es.length}・${String(last.type || '').slice(0, 6)}</a>`;
}
// 畫面上放 <span data-watch="電話"></span>，呼叫這個就會補上警示（fetch=false 只用已查過的，不讀資料庫）
export async function fillWatch(db, root, { fetch = true } = {}) {
  const spans = [...(root || document).querySelectorAll('[data-watch]')];
  const keys = [...new Set(spans.map(s => watchKey(s.dataset.watch)).filter(Boolean))];
  const res = {};
  await Promise.all(keys.map(async k => { res[k] = fetch ? await checkPhone(db, k) : peekPhone(k); }));
  spans.forEach(s => { s.innerHTML = badgeHtml(res[watchKey(s.dataset.watch)]); });
}
// 新增一筆紀錄（同一支電話累加）
export async function addWatch(db, by, { phone, name = '', branch = '', type = '其他', note = '', ref = '' }) {
  const k = watchKey(phone); if (!k) throw new Error('電話格式不對（要 09 開頭 10 碼）');
  const now = new Date(), date = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const entry = { date, branch, type, note: String(note).slice(0, 200), by, at: now.toISOString(), ref };
  await setDoc(doc(db, 'watchlist', k), { phone: k.startsWith('L_') ? '' : k, ...(name ? { name } : {}), entries: arrayUnion(entry), count: increment(1),
    lastAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: by }, { merge: true });
  mem.delete(k); try { sessionStorage.removeItem('watch.' + k); } catch {}
  return k;
}
