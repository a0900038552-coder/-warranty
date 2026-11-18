// 購物金入帳：決定「支出:廠商購物金入帳 ＄X」要歸檔哪些紀錄。
// X 應該等於「已使用的購物金」（用購物金進貨時帳上已經扣了，現金卻沒付出去；入帳 X 就把這個差補回來）。
// 歸檔：全部「使用」紀錄＋加起來剛好等於 X 的那幾筆退貨（盡量挑最早的）；剩下的退貨＝還沒用的購物金，留著。
const n = v => Math.round(Number(String(v ?? '').replace(/[,$\s元]/g, '')) || 0);

export function pickPost(open, amt) {
  const uses = open.filter(c => c.kind === 'use');
  const rets = open.filter(c => c.kind === 'return').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const usedSum = uses.reduce((a, c) => a + n(c.amount), 0), retSum = rets.reduce((a, c) => a + n(c.amount), 0);
  let pick = null;
  if (rets.length <= 16) {
    // 找加起來剛好等於 X 的組合；同時有好幾組時，選「最晚那筆最早」、再來筆數最少的
    let best = null;
    for (let mask = 1; mask < (1 << rets.length); mask++) {
      let sum = 0, last = -1, cnt = 0;
      for (let i = 0; i < rets.length; i++) if (mask & (1 << i)) { sum += n(rets[i].amount); last = i; cnt++; }
      if (sum !== amt) continue;
      if (!best || last < best.last || (last === best.last && cnt < best.cnt)) best = { mask, last, cnt };
    }
    if (best) pick = rets.filter((_, i) => best.mask & (1 << i));
  }
  const exact = !!pick;
  if (!pick) {   // 湊不到剛好的金額：從最早的退貨開始，湊到 ≥ X 為止
    pick = []; let s = 0;
    for (const r of rets) { if (s >= amt) break; pick.push(r); s += n(r.amount); }
  }
  const pickSum = pick.reduce((a, c) => a + n(c.amount), 0);
  return { uses, rets: pick, exact, usedSum, retSum, pickSum, left: rets.filter(r => !pick.includes(r)) };
}
