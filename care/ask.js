// 頁面內的確認視窗：取代瀏覽器的 confirm()（部分瀏覽器／內嵌瀏覽器會擋掉彈窗，導致按鈕「沒反應」）
// 用法：if (!(await ask('確定刪除？'))) return;
export function ask(message, { ok = '確定', cancel = '取消', danger = /刪除|取消|匯入|搬入|更新/.test(message) } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px 20px 16px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:15px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif;color:#16181d';
    const msg = document.createElement('div');
    msg.style.cssText = 'white-space:pre-wrap;margin-bottom:16px';
    msg.textContent = message;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const btn = (label, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'border-radius:10px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer;' +
        (primary ? `border:0;color:#fff;background:${danger ? '#d71920' : '#16181d'}` : 'border:1px solid #d1d5db;background:#fff;color:#374151');
      return b;
    };
    const no = btn(cancel, false), yes = btn(ok, true);
    const done = v => { document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    wrap.onclick = e => { if (e.target === wrap) done(false); };
    document.addEventListener('keydown', onKey, true);
    row.append(no, yes);
    box.append(msg, row);
    wrap.append(box);
    document.body.append(wrap);
    yes.focus();
  });
}

// 頁面內的輸入視窗：取代 prompt()；按取消回傳 null
export function askText(message, value = '', { ok = '確定', cancel = '取消' } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,21,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px 20px 16px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:15px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif;color:#16181d';
    const msg = document.createElement('div');
    msg.style.cssText = 'white-space:pre-wrap;margin-bottom:10px';
    msg.textContent = message;
    const input = document.createElement('input');
    input.value = value;
    input.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:10px;padding:9px 12px;font:inherit;margin-bottom:14px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const mk = (label, primary) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.style.cssText = 'border-radius:10px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer;' + (primary ? 'border:0;color:#fff;background:#16181d' : 'border:1px solid #d1d5db;background:#fff;color:#374151'); return b; };
    const no = mk(cancel, false), yes = mk(ok, true);
    const done = v => { wrap.remove(); resolve(v); };
    no.onclick = () => done(null);
    yes.onclick = () => done(input.value);
    input.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); done(input.value); } else if (e.key === 'Escape') done(null); };
    wrap.onclick = e => { if (e.target === wrap) done(null); };
    row.append(no, yes); box.append(msg, input, row); wrap.append(box); document.body.append(wrap);
    input.focus();
  });
}
