<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>復原者 內部系統</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
<style>
  :root{
    --ink:#1c1f26; --ink-soft:#3a3f4b; --paper:#f6f4f0; --card:#ffffff;
    --line:#e2ddd3; --copper:#c1723d; --copper-dark:#9c5a2e;
    --good:#3f7a5c; --bad:#b3432b; --warn:#c1953d;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Noto Sans TC',sans-serif;-webkit-font-smoothing:antialiased;}
  .mono{font-family:'IBM Plex Mono',monospace;}
  .trace{height:8px;background-image:radial-gradient(circle, var(--copper) 1.5px, transparent 1.6px);background-size:14px 8px;background-position:center;opacity:.55;}
  header.top{background:var(--ink);color:#fff;padding:18px 20px 14px;}
  header.top h1{margin:0;font-size:19px;font-weight:900;letter-spacing:.02em;}
  header.top p{margin:4px 0 0;font-size:12px;color:#b9bdc7;font-family:'IBM Plex Mono',monospace;}

  #login-screen{max-width:380px;margin:8vh auto;padding:0 20px;}
  .auth-tabs{display:flex;gap:8px;margin-bottom:16px;}
  .auth-tabs button{flex:1;background:#fff;border:1px solid var(--line);color:var(--ink-soft);padding:9px;border-radius:8px;font-weight:700;font-size:13px;}
  .auth-tabs button.active{background:var(--ink);color:#fff;border-color:var(--ink);}
  .auth-pane{display:none;} .auth-pane.active{display:block;}
  .field{margin-bottom:12px;}
  .field label{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:5px;font-family:'IBM Plex Mono',monospace;}
  input,select,textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);font-size:15px;font-family:inherit;color:var(--ink);}
  input:focus,select:focus,textarea:focus{outline:2px solid var(--copper);outline-offset:1px;}
  button{cursor:pointer;border:none;border-radius:8px;padding:11px 16px;font-size:14px;font-weight:700;font-family:'Noto Sans TC',sans-serif;}
  .btn-primary{background:var(--copper);color:#fff;} .btn-primary:hover{background:var(--copper-dark);}
  .btn-ghost{background:transparent;color:var(--ink-soft);border:1px solid var(--line);}
  .btn-good{background:var(--good);color:#fff;} .btn-bad{background:var(--bad);color:#fff;}
  .btn-block{width:100%;} .btn-sm{padding:6px 10px;font-size:12px;}

  #app{display:none;}
  main{padding:16px 16px 60px;max-width:760px;margin:0 auto;}
  .panel{display:none;} .panel.active{display:block;}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px;}
  .card h3{margin:0 0 12px;font-size:15px;}
  .rowline{display:flex;gap:10px;} .rowline>*{flex:1;}

  .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-family:'IBM Plex Mono',monospace;font-weight:600;}
  .badge.pending{background:#f3e6d2;color:var(--warn);}
  .badge.approved,.badge.confirmed,.badge.active_pip{background:#dcece3;color:var(--good);}
  .badge.rejected,.badge.closed_pip{background:#f3dbd3;color:var(--bad);}
  .badge.unread{background:#f3dbd3;color:var(--bad);}
  .badge.read{background:#e9e6df;color:var(--ink-soft);}

  .item{border-top:1px solid var(--line);padding:12px 0;}
  .item:first-child{border-top:none;padding-top:0;}
  .item-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}
  .item-meta{font-size:12px;color:var(--ink-soft);margin-top:3px;font-family:'IBM Plex Mono',monospace;}
  .item-body{font-size:13px;color:var(--ink-soft);margin-top:6px;line-height:1.5;white-space:pre-line;}

  .layout{display:flex;max-width:1000px;margin:0 auto;}
  aside.sidebar{
    width:190px;flex-shrink:0;background:#fff;border-right:1px solid var(--line);
    min-height:calc(100vh - 76px);position:sticky;top:0;
  }
  aside.sidebar button{
    display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;
    border-radius:0;padding:14px 18px;color:var(--ink-soft);font-weight:700;font-size:14px;
    border-left:3px solid transparent;position:relative;
  }
  aside.sidebar button.active{color:var(--copper-dark);border-left:3px solid var(--copper);background:#fdf6ef;}
  .menu-toggle{display:none;background:none;color:#fff;font-size:20px;padding:2px 6px;}
  @media (max-width:760px){
    .layout{position:relative;}
    aside.sidebar{
      position:fixed;top:0;left:0;height:100vh;z-index:15;
      transform:translateX(-100%);transition:transform .2s;box-shadow:2px 0 12px rgba(0,0,0,.15);
    }
    aside.sidebar.open{transform:translateX(0);}
    .menu-toggle{display:inline-block;}
    .sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:14;}
    .sidebar-overlay.open{display:block;}
  }

  .modal-bg{display:none;position:fixed;inset:0;background:rgba(28,31,38,.5);z-index:20;align-items:flex-end;justify-content:center;}
  .modal-bg.active{display:flex;}
  .modal{background:#fff;border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:540px;max-height:88vh;overflow-y:auto;}
  .modal-close{float:right;background:none;color:var(--ink-soft);font-size:20px;padding:0;}
  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 18px;border-radius:20px;font-size:13px;z-index:30;opacity:0;transition:opacity .25s;pointer-events:none;}
  .toast.show{opacity:1;}
  .who-bar{font-size:12px;color:var(--ink-soft);display:flex;justify-content:space-between;align-items:center;padding:10px 16px;font-family:'IBM Plex Mono',monospace;}
  .who-bar button{background:none;color:var(--copper-dark);font-size:12px;padding:2px;font-weight:700;}
  .late-tag{color:var(--bad);font-weight:bold;font-size:12px;}
  .empty{color:var(--ink-soft);font-size:13px;padding:12px 0;text-align:center;}
</style>
</head>
<body>

<header class="top">
  <h1>復原者 · 內部系統</h1>
  <p>STAFF OPS / 楠梓店 · 德賢店</p>
</header>
<div class="trace"></div>

<div id="login-screen">
  <div class="auth-tabs">
    <button id="at-login" class="active" onclick="switchAuthTab('login')">登入</button>
    <button id="at-register" onclick="switchAuthTab('register')">第一次使用（註冊帳號）</button>
  </div>

  <div id="auth-login" class="auth-pane active">
    <div class="field"><label>Email</label><input id="login-email" type="email"></div>
    <div class="field"><label>密碼</label><input id="login-pass" type="password"></div>
    <button class="btn-primary btn-block" onclick="doLogin()">登入</button>
    <p id="login-error" style="color:var(--bad);font-size:12px;margin-top:10px;"></p>
  </div>

  <div id="auth-register" class="auth-pane">
    <div class="field"><label>姓名</label><input id="reg-name"></div>
    <div class="field"><label>分店</label>
      <select id="reg-store"><option value="楠梓店">楠梓店</option><option value="德賢店">德賢店</option></select>
    </div>
    <div class="field"><label>身分</label>
      <select id="reg-role">
        <option value="staff">一般員工</option>
        <option value="store_manager">店長</option>
        <option value="regional_manager">區經理</option>
      </select>
    </div>
    <div class="field"><label>Email</label><input id="reg-email" type="email"></div>
    <div class="field"><label>密碼（至少6碼）</label><input id="reg-pass" type="password"></div>
    <button class="btn-primary btn-block" onclick="doRegister()">建立帳號</button>
    <p id="reg-error" style="color:var(--bad);font-size:12px;margin-top:10px;"></p>
  </div>
</div>

<div id="app">
  <div class="who-bar">
    <span><button class="menu-toggle" onclick="toggleSidebar()">☰</button> <span id="who-label"></span></span>
    <button onclick="doLogout()">登出</button>
  </div>

  <div class="sidebar-overlay" id="sidebar-overlay" onclick="toggleSidebar()"></div>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <button id="tab-ann" class="active" onclick="switchTab('ann')">📢 公告</button>
      <button id="tab-payroll-user" onclick="switchTab('payroll-user')">🧾 我的薪資單</button>
      <button id="tab-mail" onclick="switchTab('mail')">✉️ 內部訊息/PIP</button>
      <button id="tab-payroll-admin" onclick="switchTab('payroll-admin')" style="display:none;">💰 薪資與考核結算</button>
    </aside>

    <main>
    <!-- 公告 Panel -->
    <section id="panel-ann" class="panel active">
      <div class="card" id="ann-create-card" style="display:none;">
        <h3>發布新公告</h3>
        <div class="field"><label>公告標題</label><input id="ann-title" placeholder="請輸入標題"></div>
        <div class="field"><label>內容</label><textarea id="ann-content" rows="3" placeholder="請輸入公告內文..."></textarea></div>
        <button class="btn-primary btn-block" onclick="publishAnnouncement()">發布公告</button>
      </div>
      <div class="card">
        <h3>最新公告</h3>
        <div id="ann-list"><div class="empty">載入中…</div></div>
      </div>
    </section>

    <!-- 員工：我的薪資單電子簽收 -->
    <section id="panel-payroll-user" class="panel">
      <div class="card">
        <h3>我的薪資單與考績簽核</h3>
        <div id="my-payslip-list"><div class="empty">載入中…</div></div>
      </div>
    </section>

    <!-- 內部訊息與 PIP 流程 -->
    <section id="panel-mail" class="panel">
      <div class="card" id="pip-create-card" style="display:none;">
        <h3>發起 PIP 績效改善計畫 / 官方通知信</h3>
        <div class="field"><label>對象員工</label><select id="msg-target-user"></select></div>
        <div class="field"><label>信件類別</label>
          <select id="msg-category">
            <option value="PIP績效改善">PIP 績效改善通知</option>
            <option value="薪資問題異議">薪資問題異議</option>
            <option value="正式面談紀錄">正式面談紀錄</option>
            <option value="一般內部公務">一般內部公務</option>
          </select>
        </div>
        <div class="field"><label>主旨</label><input id="msg-title" placeholder="例：[PIP通知] 9月份服務品質與出勤改善計畫"></div>
        <div class="field"><label>內容說明 / 改善目標與期限</label><textarea id="msg-content" rows="4" placeholder="請詳細列出客觀事實、要求改善項目與評估期限…"></textarea></div>
        <button class="btn-primary btn-block" onclick="sendInternalMail()">發送正式信件</button>
      </div>

      <div class="card">
        <h3>內部信件匣 (含 PIP 溝通歷程)</h3>
        <div id="internal-mail-list"><div class="empty">尚無信件</div></div>
      </div>
    </section>

    <!-- 管理者：薪資、考績評分與遲到自動結算 -->
    <section id="panel-payroll-admin" class="panel">
      <div class="card">
        <h3>1. 選擇員工與結算月份</h3>
        <div class="rowline">
          <div class="field"><label>選擇員工</label><select id="adm-emp-select"></select></div>
          <div class="field"><label>結算月份</label><input type="month" id="adm-month-select"></div>
        </div>
        <button class="btn-primary btn-block" onclick="startPayrollCalculation()">開始帶入資料並計算</button>
      </div>

      <div class="card" id="payroll-calc-card" style="display:none;">
        <h3>2. 考績評分與自動數據試算</h3>
        
        <div class="field">
          <label>當月考核評定分數 (0~100)</label>
          <input type="number" id="calc-score" value="85" min="0" max="100" oninput="reCalculatePayroll()">
          <small style="color:var(--ink-soft);">* ≥80分：100%獎金 | 60~79分：80%獎金 | &lt;60分：不發放獎金</small>
        </div>

        <div class="item">
          <div class="item-head"><strong>自動偵測遲到天數與明細</strong><span id="calc-late-count" class="mono late-tag">0 天</span></div>
          <div class="item-meta" id="calc-late-details">已排除排休與公休日…</div>
        </div>

        <h3 style="margin-top:16px;">3. 最末頁：完整數據編輯與最終微調</h3>
        <div class="rowline">
          <div class="field"><label>約定底薪</label><input type="number" id="edit-base" oninput="reCalculatePayroll()"></div>
          <div class="field"><label>全勤與績效獎金基準</label><input type="number" id="edit-bonus-base" value="3000" oninput="reCalculatePayroll()"></div>
        </div>
        <div class="rowline">
          <div class="field"><label>計算後實發獎金</label><input type="number" id="edit-bonus-final" readonly style="background:#f2f0eb;"></div>
          <div class="field"><label>遲到/請假扣款</label><input type="number" id="edit-deduct" oninput="reCalculatePayroll()"></div>
        </div>
        <div class="rowline">
          <div class="field"><label>加班費</label><input type="number" id="edit-overtime" value="0" oninput="reCalculatePayroll()"></div>
          <div class="field"><label>勞健保自付額總計</label><input type="number" id="edit-insurance" value="1107" oninput="reCalculatePayroll()"></div>
        </div>
        <div class="field"><label>其他加減項 / 備註說明</label><input id="edit-remark" placeholder="例：颱風假扣款、特別津貼…"></div>

        <div class="item" style="background:#fdf6ef;margin:12px -16px;padding:12px 16px;">
          <div class="item-head"><strong>最終實領總金額</strong><span class="mono" id="edit-total-amount" style="font-size:20px;color:var(--copper-dark);">0 元</span></div>
        </div>

        <button class="btn-good btn-block" onclick="sendPayslipToStaff()">寄出薪資單與電子簽核通知</button>
      </div>
    </section>
    </main>
  </div>
</div>

<!-- 電子簽名 Modal -->
<div class="modal-bg" id="modal-signature">
  <div class="modal">
    <button class="modal-close" onclick="closeModal('modal-signature')">&times;</button>
    <h3 id="sig-title">薪資單電子簽收認證</h3>
    <p style="font-size:12px;color:var(--ink-soft);">本人已核對並確認當月薪資明細、考核分數與出勤紀錄無誤。</p>
    <canvas id="sig-canvas" style="width:100%;height:180px;border:1px solid var(--line);border-radius:8px;background:#fff;touch-action:none;"></canvas>
    <div class="rowline" style="margin-top:10px;">
      <button class="btn-ghost" onclick="clearSignature()">清除</button>
      <button class="btn-primary" onclick="confirmPayslipSignature()">確認並電子簽署</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const firebaseConfig = {
  apiKey: "AIzaSyDyg9BqlmlgHQRlxtgk0Bm0_kpmfmNRcWs",
  authDomain: "warranty-system-4d18d.firebaseapp.com",
  projectId: "warranty-system-4d18d",
  storageBucket: "warranty-system-4d18d.firebasestorage.app",
  messagingSenderId: "357168697896",
  appId: "1:357168697896:web:79b3f2faa217d7ad449b1d"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let CURRENT_USER = null;
let employeesCache = [];
let activePayslipId = null;

function escapeHtml(str){ return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showToast(msg){ const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
function closeModal(id){ document.getElementById(id).classList.remove('active'); }
function isManager(role){ return role === 'store_manager' || role === 'regional_manager'; }

function switchAuthTab(name){
  document.getElementById('at-login').classList.toggle('active', name==='login');
  document.getElementById('at-register').classList.toggle('active', name==='register');
  document.getElementById('auth-login').classList.toggle('active', name==='login');
  document.getElementById('auth-register').classList.toggle('active', name==='register');
}

function doRegister(){
  const name = document.getElementById('reg-name').value.trim();
  const store = document.getElementById('reg-store').value;
  const role = document.getElementById('reg-role').value;
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  if(!name || !email || pass.length < 6){ showToast("請完整填寫，密碼至少6碼"); return; }

  auth.createUserWithEmailAndPassword(email, pass).then(cred=>{
    return db.collection('employees').doc(cred.user.uid).set({
      name, store, role, email, status: '在職', baseSalary: 29500, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }).then(()=>{ showToast("帳號建立成功"); enterApp(); }).catch(e=> showToast("註冊失敗：" + e.message));
}

function doLogin(){
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  auth.signInWithEmailAndPassword(email, pass).catch(e=> showToast("登入失敗：" + e.message));
}
function doLogout(){ auth.signOut(); }

auth.onAuthStateChanged(user=>{
  if(user){
    db.collection('employees').doc(user.uid).get().then(doc=>{
      if(!doc.exists){ auth.signOut(); return; }
      CURRENT_USER = { uid: user.uid, ...doc.data() };
      enterApp();
    });
  } else {
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'block';
  }
});

function enterApp(){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('who-label').textContent = `${CURRENT_USER.name} · ${CURRENT_USER.store}`;
  
  const mgr = isManager(CURRENT_USER.role);
  document.getElementById('tab-payroll-admin').style.display = mgr ? 'block' : 'none';
  document.getElementById('pip-create-card').style.display = mgr ? 'block' : 'none';
  document.getElementById('ann-create-card').style.display = mgr ? 'block' : 'none';

  loadAnnouncements();
  loadMyPayslips();
  loadInternalMails();

  if(mgr){
    loadEmployeeSelects();
  }
}

function switchTab(name){
  ['ann','payroll-user','mail','payroll-admin'].forEach(t=>{
    const tabEl = document.getElementById('tab-'+t);
    const panEl = document.getElementById('panel-'+t);
    if(tabEl) tabEl.classList.toggle('active', t===name);
    if(panEl) panEl.classList.toggle('active', t===name);
  });
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}
function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

/* 公告模組 */
function publishAnnouncement(){
  const title = document.getElementById('ann-title').value.trim();
  const content = document.getElementById('ann-content').value.trim();
  if(!title || !content){ showToast("請填寫公告標題與內容"); return; }

  db.collection('announcements').add({
    title, content,
    authorName: CURRENT_USER.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{
    showToast("公告已發布");
    document.getElementById('ann-title').value = '';
    document.getElementById('ann-content').value = '';
  });
}

function loadAnnouncements(){
  db.collection('announcements').orderBy('createdAt','desc').onSnapshot(snap=>{
    const list = document.getElementById('ann-list');
    if(snap.empty){ list.innerHTML = '<div class="empty">尚無公告</div>'; return; }
    list.innerHTML = snap.docs.map(d=>{
      const a = d.data();
      const timeStr = a.createdAt ? new Date(a.createdAt.toDate()).toLocaleDateString('zh-TW') : '';
      return `
        <div class="item">
          <div class="item-head"><strong>${escapeHtml(a.title)}</strong><span class="badge read">${a.authorName || '系統'}</span></div>
          <div class="item-meta">${timeStr}</div>
          <div class="item-body">${escapeHtml(a.content)}</div>
        </div>
      `;
    }).join('');
  });
}

/* 薪資與遲到自動偵測模組 */
function loadEmployeeSelects(){
  db.collection('employees').get().then(snap=>{
    employeesCache = snap.docs.map(d=>({uid: d.id, ...d.data()}));
    const admSel = document.getElementById('adm-emp-select');
    const msgSel = document.getElementById('msg-target-user');
    admSel.innerHTML = employeesCache.map(e=>`<option value="${e.uid}">${e.name} (${e.store})</option>`).join('');
    msgSel.innerHTML = employeesCache.map(e=>`<option value="${e.uid}">${e.name} (${e.store})</option>`).join('');
  });
}

async function startPayrollCalculation(){
  const empUid = document.getElementById('adm-emp-select').value;
  const month = document.getElementById('adm-month-select').value;
  if(!month){ showToast("請選擇月份"); return; }

  const emp = employeesCache.find(e=>e.uid === empUid);
  document.getElementById('edit-base').value = emp.baseSalary || 29500;

  // 1. 取得該月公休日與排休
  const typhoonSnap = await db.collection('typhoon_days').get();
  const offDays = typhoonSnap.docs.map(d=>d.data().date);

  const leaveSnap = await db.collection('leave_requests')
    .where('uid','==',empUid)
    .where('status','==','approved').get();
  
  leaveSnap.forEach(d=>{
    const l = d.data();
    offDays.push(l.start);
  });

  // 2. 抓取打卡紀錄比對遲到 (假設 10:00 上班)
  const attSnap = await db.collection('attendance')
    .where('uid','==',empUid)
    .where('type','==','in').get();

  let lateCount = 0;
  let lateDetails = [];

  attSnap.forEach(doc=>{
    const d = doc.data();
    if(!d.timestamp) return;
    const dateObj = d.timestamp.toDate();
    const dateStr = dateObj.toISOString().split('T')[0];

    // 若為排休日或公休日則自動排除
    if(offDays.includes(dateStr)) return;

    const hours = dateObj.getHours();
    const mins = dateObj.getMinutes();
    if(hours > 10 || (hours === 10 && mins > 5)){ // 超過 10:05 視為遲到
      lateCount++;
      lateDetails.push(`${dateStr} (${hours}:${mins<10?'0':''}${mins})`);
    }
  });

  document.getElementById('calc-late-count').textContent = lateCount + " 天";
  document.getElementById('calc-late-details').textContent = lateDetails.length ? "遲到日期: " + lateDetails.join(', ') : "當月無遲到紀錄（已排除排休）";
  document.getElementById('edit-deduct').value = lateCount * 200; // 預設遲到一次扣 200

  reCalculatePayroll();
  document.getElementById('payroll-calc-card').style.display = 'block';
}

function reCalculatePayroll(){
  const score = parseFloat(document.getElementById('calc-score').value) || 0;
  const bonusBase = parseFloat(document.getElementById('edit-bonus-base').value) || 0;
  
  let bonusFinal = 0;
  if(score >= 80){
    bonusFinal = bonusBase; // 100%
  } else if(score >= 60){
    bonusFinal = bonusBase * 0.8; // 80%
  } else {
    bonusFinal = 0; // 不發放
  }
  document.getElementById('edit-bonus-final').value = Math.round(bonusFinal);

  const base = parseFloat(document.getElementById('edit-base').value) || 0;
  const deduct = parseFloat(document.getElementById('edit-deduct').value) || 0;
  const ot = parseFloat(document.getElementById('edit-overtime').value) || 0;
  const ins = parseFloat(document.getElementById('edit-insurance').value) || 0;

  const total = base + bonusFinal + ot - deduct - ins;
  document.getElementById('edit-total-amount').textContent = Math.round(total).toLocaleString() + " 元";
}

function sendPayslipToStaff(){
  const empUid = document.getElementById('adm-emp-select').value;
  const month = document.getElementById('adm-month-select').value;
  const emp = employeesCache.find(e=>e.uid === empUid);

  db.collection('payslips').add({
    uid: empUid,
    empName: emp.name,
    month,
    score: parseFloat(document.getElementById('calc-score').value),
    lateCount: document.getElementById('calc-late-count').textContent,
    lateDetails: document.getElementById('calc-late-details').textContent,
    base: parseFloat(document.getElementById('edit-base').value),
    bonus: parseFloat(document.getElementById('edit-bonus-final').value),
    deduct: parseFloat(document.getElementById('edit-deduct').value),
    overtime: parseFloat(document.getElementById('edit-overtime').value),
    insurance: parseFloat(document.getElementById('edit-insurance').value),
    total: document.getElementById('edit-total-amount').textContent,
    remark: document.getElementById('edit-remark').value,
    status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{ showToast("薪資單與評分表已寄出"); });
}

/* 員工端薪資檢視與電子簽署 */
function loadMyPayslips(){
  db.collection('payslips').where('uid','==',CURRENT_USER.uid).onSnapshot(snap=>{
    const list = document.getElementById('my-payslip-list');
    if(snap.empty){ list.innerHTML = '<div class="empty">尚無薪資單資料</div>'; return; }
    list.innerHTML = '';
    snap.forEach(doc=>{
      const d = doc.data();
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div class="item-head"><strong>${d.month} 薪資明細與考績</strong><span class="badge ${d.status}">${d.status==='confirmed'?'已簽收':'待簽名確認'}</span></div>
        <div class="item-body">
          考核分數：<b>${d.score} 分</b> | 出勤遲到：${d.lateCount}<br>
          實領總金額：<b>${d.total}</b><br>
          <small>${d.lateDetails}</small>
        </div>
        ${d.status==='pending'?`<button class="btn-primary btn-sm" style="margin-top:8px;" onclick="openPayslipSigModal('${doc.id}')">檢視並電子簽名簽收</button>`:''}
      `;
      list.appendChild(div);
    });
  });
}

function openPayslipSigModal(id){
  activePayslipId = id;
  document.getElementById('modal-signature').classList.add('active');
  setTimeout(initSignatureCanvas, 50);
}

/* 內部訊息與 PIP 模組 */
function sendInternalMail(){
  const targetUid = document.getElementById('msg-target-user').value;
  const targetEmp = employeesCache.find(e=>e.uid===targetUid);
  const category = document.getElementById('msg-category').value;
  const title = document.getElementById('msg-title').value.trim();
  const content = document.getElementById('msg-content').value.trim();

  if(!title || !content){ showToast("請填寫主旨與內容"); return; }

  db.collection('internal_mails').add({
    senderUid: CURRENT_USER.uid,
    senderName: CURRENT_USER.name,
    receiverUid: targetUid,
    receiverName: targetEmp.name,
    category, title, content,
    status: 'sent',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{
    showToast("內部信件已送出");
    document.getElementById('msg-title').value = '';
    document.getElementById('msg-content').value = '';
  });
}

function loadInternalMails(){
  db.collection('internal_mails').orderBy('createdAt','desc').onSnapshot(snap=>{
    const list = document.getElementById('internal-mail-list');
    const mails = [];
    snap.forEach(d=>{
      const data = d.data();
      if(data.senderUid === CURRENT_USER.uid || data.receiverUid === CURRENT_USER.uid || isManager(CURRENT_USER.role)){
        mails.push({id: d.id, ...data});
      }
    });

    if(!mails.length){ list.innerHTML = '<div class="empty">尚無內部信件</div>'; return; }
    list.innerHTML = mails.map(m=>`
      <div class="item">
        <div class="item-head"><strong>[${m.category}] ${escapeHtml(m.title)}</strong><span class="badge read">${m.senderName} ➔ ${m.receiverName}</span></div>
        <div class="item-body">${escapeHtml(m.content)}</div>
      </div>
    `).join('');
  });
}

/* 簽名板功能 (支援觸控與滑鼠) */
let sigCanvas, sigCtx, sigDrawing = false;
function initSignatureCanvas(){
  sigCanvas = document.getElementById('sig-canvas');
  const rect = sigCanvas.getBoundingClientRect();
  sigCanvas.width = rect.width * 2; 
  sigCanvas.height = rect.height * 2;
  sigCtx = sigCanvas.getContext('2d');
  sigCtx.scale(2,2); 
  sigCtx.lineWidth = 2; 
  sigCtx.lineCap = 'round'; 
  sigCtx.strokeStyle = '#1c1f26';
  
  const getPos = e => {
    const r = sigCanvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };

  const startDraw = e => { sigDrawing = true; const p = getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); };
  const moveDraw = e => { if(!sigDrawing) return; const p = getPos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); };
  const stopDraw = () => { sigDrawing = false; };

  sigCanvas.onpointerdown = startDraw;
  sigCanvas.onpointermove = moveDraw;
  sigCanvas.onpointerup = stopDraw;
  sigCanvas.onpointerleave = stopDraw;
}
function clearSignature(){ if(sigCtx) sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height); }
function confirmPayslipSignature(){
  const url = sigCanvas.toDataURL('image/png');
  db.collection('payslips').doc(activePayslipId).update({
    status: 'confirmed',
    signatureUrl: url,
    signedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{
    showToast("薪資單簽收成功！");
    closeModal('modal-signature');
  });
}
</script>
</body>
</html>
