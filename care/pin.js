// 分店密碼：編輯／刪除某間店的資料前要輸入那間店的密碼，避免誤改到別間店。
// 注意：這是「防手滑」用的，不是資安防護（真正擋外人的是登入帳號＋資料庫規則）。
const PINS = { '楠梓店': '3223', '德賢店': '6883' };

// 每個帳號的「自己的分店」：開頁面預設就是這間；員工切到別間店可以看，但要登打必須輸入那間店的密碼（10 分鐘內有效）
const HOME = {
  'a0900038552@gmail.com': '楠梓店',   // 老闆（兩間店都能直接登打，不受這個限制）
  'i0935349954@gmail.com': '楠梓店',
  'soso770724@gmail.com': '德賢店',
  'i0935349455@gmail.com': '德賢店',
};
const OWNER = 'a0900038552@gmail.com';
export const homeBranch = email => HOME[String(email || '').toLowerCase()] || '';
// 這個帳號現在看的是不是「別人的分店」（老闆不算）
export const isAway = (email, branch) => { const h = homeBranch(email); return !!h && String(email).toLowerCase() !== OWNER && branch !== h; };

const ssGet = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// 這台裝置是否已永久解鎖這間店（每日登打用：第一次輸入後這台就記住）
export const isUnlocked = branch => !PINS[branch] || lsGet('pin.dev.' + branch) === '1';

/**
 * 要求輸入分店密碼。
 * branch：分店名；what：要做的事（顯示在視窗上）
 * opt.minutes：幾分鐘內同一間店不用再輸入（0＝每次都要）
 * opt.device：輸入正確後這台裝置永久記住（每日登打用）
 * 回傳 true＝通過
 */
export function requirePin(branch, what = '修改', opt = {}) {
  const pin = PINS[branch];
  if (!pin) return Promise.resolve(true);                       // 沒設定密碼的分店不擋
  if (opt.device && isUnlocked(branch)) return Promise.resolve(true);
  const k = 'pin.ok.' + branch, last = Number(ssGet(k) || 0);
  if (opt.minutes && Date.now() - last < opt.minutes * 60e3) return Promise.resolve(true);
  return new Promise(resolve => {
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px';
    w.innerHTML = `<form style="background:#fff;border-radius:14px;max-width:340px;width:100%;padding:20px;font:15px/1.6 system-ui,'Noto Sans TC',sans-serif">
      <div style="font-weight:800;font-size:17px;margin-bottom:4px">🔒 ${branch}密碼</div>
      <div style="color:#6b7280;font-size:13px;margin-bottom:10px">要${what}<b style="color:#16181d">${branch}</b>的資料，請輸入${branch}的密碼</div>
      <input type="password" inputmode="numeric" autocomplete="off" maxlength="12" style="width:100%;font-size:22px;letter-spacing:6px;text-align:center;border:1px solid #d1d5db;border-radius:10px;padding:8px">
      <div data-err style="color:#d71920;font-size:13px;min-height:20px;margin-top:4px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button type="button" data-c style="border:1px solid #d1d5db;background:#fff;border-radius:10px;padding:8px 16px;cursor:pointer">取消</button>
        <button style="border:0;background:#16181d;color:#fff;border-radius:10px;padding:8px 18px;font-weight:700;cursor:pointer">確定</button></div></form>`;
    const f = w.querySelector('form'), inp = w.querySelector('input'), err = w.querySelector('[data-err]');
    const done = ok => { w.remove(); resolve(ok); };
    w.querySelector('[data-c]').onclick = () => done(false);
    w.addEventListener('click', e => { if (e.target === w) done(false); });
    w.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
    f.onsubmit = e => {
      e.preventDefault();
      if (inp.value.trim() !== pin) { err.textContent = '密碼不對，請再試一次'; inp.value = ''; inp.focus(); return; }
      ssSet(k, String(Date.now()));
      if (opt.device) lsSet('pin.dev.' + branch, '1');
      done(true);
    };
    document.body.append(w); setTimeout(() => inp.focus(), 30);
  });
}
