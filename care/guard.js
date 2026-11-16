// 登入回報：每次登入（同一個分頁只回報一次）告訴 Apps Script，
// 若是這個帳號第一次在這台裝置登入，老闆會收到 LINE 通知；名單外的帳號會被登出並提示沒有權限。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxBK7c2Oledgo-jT-kRnueuU8grZxVinuocyp2iLI8u-c5Q94fZSeiemH0UkeAqdjfTlw/exec';

function deviceId() {
  try {
    let id = localStorage.getItem('care.device');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)); localStorage.setItem('care.device', id); }
    return id;
  } catch { return 'nostorage'; }
}

export async function reportLogin(auth, page) {
  const user = auth.currentUser; if (!user) return;
  const flag = 'care.loginReported.' + user.uid;
  try { if (sessionStorage.getItem(flag)) return; } catch {}
  try {
    const res = await fetch(GAS_URL + '?action=login', {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ idToken: await user.getIdToken(), device: deviceId(), ua: navigator.userAgent, page })
    });
    const j = await res.json();
    try { sessionStorage.setItem(flag, '1'); } catch {}
    if (j && j.ok && j.allowed === false) {
      alertBox(`這個帳號（${user.email}）沒有使用權限。\n\n請用店裡的員工帳號登入，或請老闆把你的帳號加入名單。`);
      await auth.signOut();
    }
  } catch { /* 通知失敗不影響使用 */ }
}

function alertBox(text) {
  const w = document.createElement('div');
  w.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px';
  const b = document.createElement('div');
  b.style.cssText = 'background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;font:15px/1.6 system-ui,"Noto Sans TC",sans-serif;white-space:pre-wrap';
  b.textContent = text;
  const ok = document.createElement('button');
  ok.textContent = '知道了';
  ok.style.cssText = 'display:block;margin:14px 0 0 auto;border:0;border-radius:10px;padding:8px 18px;background:#16181d;color:#fff;font-weight:700;cursor:pointer';
  ok.onclick = () => w.remove();
  b.append(ok); w.append(b); document.body.append(w);
}
