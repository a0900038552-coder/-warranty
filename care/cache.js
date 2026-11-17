// 省讀取額度：很少變動的舊資料，一天只向資料庫拿一次，其餘時間用這台電腦裡的副本（不算讀取次數）。
// Firebase 免費方案每天只有 5 萬次讀取，每打開一次頁面就整批重讀會很快用完。
import { getDocs, getDocsFromCache } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// key：這批資料的名字；hours：多久向資料庫更新一次（預設 20 小時）
export async function cachedDocs(q, key, hours = 20) {
  const k = 'qc.' + key, last = Number(lsGet(k) || 0);
  if (Date.now() - last < hours * 3600e3) {
    try { const s = await getDocsFromCache(q); if (!s.empty) return s; } catch {}
  }
  const s = await getDocs(q);
  lsSet(k, String(Date.now()));
  return s;
}
// 強制下次重新向資料庫拿（例如按「重新整理」）
export function expireCache(prefix) {
  try { Object.keys(localStorage).filter(k => k.startsWith('qc.' + prefix)).forEach(k => localStorage.removeItem(k)); } catch {}
}
