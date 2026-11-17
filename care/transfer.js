// 兩店調貨（欠條）：每日登打打「楠梓店調貨：iPhone 13 電池」就記一筆欠條，之後打「楠梓店還貨：iPhone 13 電池」自動銷帳。
// 欠的人＝品項開頭寫的那間店；沒寫店名就是「打這一列的那間店」。被欠的＝另一間店。
// 數量可以寫在最後：「×2」「x2」「2個／顆／片／支／組」，沒寫就是 1。
const STORES = ['楠梓店', '德賢店'];
const full = s => !s ? '' : s.startsWith('楠梓') ? '楠梓店' : s.startsWith('德賢') ? '德賢店' : '';
const RE = /^\s*(楠梓店?|德賢店?)?\s*(調貨|借貨|還貨|歸還)\s*[:：]?\s*(.+?)\s*$/;

export function parseTransfer(item, branch) {
  const m = String(item || '').match(RE); if (!m) return null;
  let part = m[3], qty = 1;
  const q = part.match(/\s*(?:[x×*＊]\s*(\d+)|(\d+)\s*(?:個|顆|片|支|組|pcs?))\s*$/i);
  if (q) { qty = Number(q[1] || q[2]) || 1; part = part.slice(0, q.index).trim(); }
  if (!part) return null;
  const debtor = full(m[1]) || branch;
  if (!STORES.includes(debtor)) return null;
  return { kind: /調貨|借貨/.test(m[2]) ? 'borrow' : 'return', debtor, creditor: STORES.find(s => s !== debtor), part, qty };
}

// 比對用：不分大小寫、空白、iPhone 字樣
const key = s => String(s || '').toLowerCase().replace(/iphone/g, '').replace(/[\s\-_/／、,，()（）]+/g, '');

/**
 * 把調貨與還貨配對。回傳：
 *   open：還沒還清的調貨（含 left 剩幾個）
 *   settled：已還清的調貨（含 returnedOn 還貨日期）
 *   orphan：找不到對應調貨的還貨（多半是品名打得不一樣）
 */
export function settle(list) {
  const borrows = list.filter(t => t.kind === 'borrow').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''))
    .map(t => ({ ...t, left: t.settled ? 0 : (t.qty || 1), returns: [] }));
  const returns = list.filter(t => t.kind === 'return').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const orphan = [];
  returns.forEach(r => {
    let need = r.qty || 1;
    const k = key(r.part);
    const pick = exact => borrows.filter(b => b.debtor === r.debtor && b.left > 0 && (exact ? key(b.part) === k : (key(b.part).includes(k) || k.includes(key(b.part)))));
    for (const b of [...pick(true), ...pick(false)]) {
      if (need <= 0) break;
      if (b.left <= 0) continue;
      const use = Math.min(need, b.left); b.left -= use; need -= use; b.returns.push({ date: r.date, qty: use, id: r.id });
    }
    if (need > 0) orphan.push({ ...r, left: need });
  });
  borrows.forEach(b => { if (b.left === 0) b.returnedOn = b.settled ? (b.settledAt || '').slice(0, 10) : (b.returns.at(-1)?.date || ''); });
  return { open: borrows.filter(b => b.left > 0), settled: borrows.filter(b => b.left === 0), orphan };
}
