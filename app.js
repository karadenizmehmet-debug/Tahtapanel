// Tahta Kilit yönetim paneli — Firebase (Auth + Realtime Database)
// © Mehmet Karadeniz, 2026-2027
//
// Kota notu: Realtime Database işlem saymaz; bant genişliği ve bağlantı sayısı
// sınırlıdır. Bu yüzden okul verileri sayfa açılınca bir kez get() ile okunur,
// yalnızca tahta durumları (state) ve bekleyen komutlar (cmd) canlı dinlenir.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, push, remove, onValue, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAVGUgXTTs6fSxN5l_-wgqjAnouqG0WJXA',
  authDomain: 'tkilit-70cfd.firebaseapp.com',
  databaseURL: 'https://tkilit-70cfd-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'tkilit-70cfd',
  storageBucket: 'tkilit-70cfd.firebasestorage.app',
  messagingSenderId: '30490917058',
  appId: '1:30490917058:web:5c27ee3d038b4090f0a35b'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = id => document.getElementById(id);
const SCHOOL_CODE = /^[A-Z0-9]{3,12}$/;

let me = null, isAdmin = false, applying = false, loginMode = 'login';
let activeSchoolCode = null;
let schools = [], boards = [], notices = [], keys = [], states = {}, cmds = {};
let liveUnsubs = [];

// ---------- yardımcılar ----------
function toast(m) {
  $('toast').textContent = m; $('toast').classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
}
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-posta veya şifre hatalı.',
  'auth/wrong-password': 'E-posta veya şifre hatalı.',
  'auth/user-not-found': 'E-posta veya şifre hatalı.',
  'auth/invalid-email': 'E-posta adresi geçersiz.',
  'auth/missing-email': 'Önce e-posta adresinizi yazın.',
  'auth/email-already-in-use': 'Bu e-posta ile zaten bir hesap var.',
  'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
  'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.',
  'auth/network-request-failed': 'Bağlantı hatası. İnternet bağlantınızı kontrol edin.',
  'auth/unauthorized-domain': 'Bu adres Firebase Authentication\'da yetkili alan olarak eklenmemiş.'
};
function errText(e) {
  if (e?.msg) return e.msg;
  if (AUTH_ERRORS[e?.code]) return AUTH_ERRORS[e.code];
  if (String(e?.message || e).includes('PERMISSION_DENIED')) return 'Bu işlem için yetkiniz yok.';
  return 'İşlem başarısız: ' + (e?.message || e);
}
const toList = (obj) => Object.entries(obj || {}).map(([id, x]) => ({ id, ...x }));
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'tr');
function needSchool() {
  if (activeSchoolCode) return true;
  toast('Önce yönetilecek okulu seçin'); return false;
}

// ---------- giriş ekranı ----------
function showLoginMsg(text, ok) {
  const el = $('loginError');
  el.textContent = text || ''; el.style.display = text ? 'block' : 'none';
  el.style.background = ok ? '#e8f6ef' : ''; el.style.color = ok ? '#16845d' : '';
}
function setBusy(b) { $('loginSubmit').disabled = b; $('loginSubmit').style.opacity = b ? .6 : 1; }
function setMode(m) {
  loginMode = m;
  $('loginTab').classList.toggle('active', m === 'login');
  $('applyTab').classList.toggle('active', m === 'apply');
  $('applyFields').style.display = m === 'apply' ? 'block' : 'none';
  document.querySelectorAll('#applyFields input').forEach(i => { i.required = m === 'apply'; });
  $('loginHeading').textContent = m === 'apply' ? 'Okul başvurusu' : 'Giriş yap';
  $('loginIntro').textContent = m === 'apply'
    ? 'Okulunuzu kaydedin. Yönetici onayından sonra panele erişebilirsiniz.'
    : 'E-posta adresiniz ve şifrenizle giriş yapın.';
  $('loginSubmit').textContent = m === 'apply' ? 'Başvuruyu gönder →' : 'Giriş yap →';
  $('loginPass').autocomplete = m === 'apply' ? 'new-password' : 'current-password';
  showLoginMsg('');
}
$('loginTab').onclick = () => setMode('login');
$('applyTab').onclick = () => setMode('apply');

function showLogin() {
  detachLive();
  $('dashboardApp').style.display = 'none';
  $('loginScreen').style.display = 'flex';
  setBusy(false);
}
async function deny(msg, ok) {
  await signOut(auth).catch(() => {});
  showLogin(); showLoginMsg(msg, ok);
}

$('loginForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('loginUser').value.trim(), pass = $('loginPass').value;
  setBusy(true); showLoginMsg('');
  try {
    if (loginMode === 'login') { await signInWithEmailAndPassword(auth, email, pass); return; }
    const code = $('applyCode').value.trim().toUpperCase();
    const name = $('applyName').value.trim(), contact = $('applyContact').value.trim();
    if (!SCHOOL_CODE.test(code)) throw { msg: 'Kurum kodu 3–12 harf veya rakam olmalı (Türkçe karakter ve boşluk olmadan).' };
    applying = true;
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    try {
      // Okul ve üyelik tek seferde yazılır; kod alınmışsa kural ikisini de reddeder.
      await update(ref(db), {
        ['schools/' + code]: { name, contact, email, status: 'pending', owner: cred.user.uid, created: serverTimestamp() },
        ['members/' + cred.user.uid]: { school: code }
      });
    } catch (err) {
      await cred.user.delete().catch(() => {});
      throw { msg: 'Bu kurum kodu kullanılıyor. Başka bir kod deneyin.' };
    }
    applying = false;
    await deny('Başvurunuz alındı. Yönetici onayından sonra giriş yapabilirsiniz.', true);
    setMode('login'); showLoginMsg('Başvurunuz alındı. Yönetici onayından sonra giriş yapabilirsiniz.', true);
  } catch (err) {
    applying = false; setBusy(false); showLoginMsg(errText(err));
  }
};

$('forgotBtn').onclick = async () => {
  const email = $('loginUser').value.trim();
  if (!email) { showLoginMsg('Önce e-posta adresinizi yazın.'); return; }
  try { await sendPasswordResetEmail(auth, email); showLoginMsg('Şifre sıfırlama bağlantısı e-postanıza gönderildi.', true); }
  catch (err) { showLoginMsg(errText(err)); }
};

// ---------- oturum ----------
onAuthStateChanged(auth, user => {
  if (applying) return;
  if (!user) { showLogin(); return; }
  enter(user).catch(err => deny(errText(err)));
});

async function enter(user) {
  me = user; setBusy(true);
  const adm = await get(ref(db, 'admins/' + user.uid)).catch(() => null);
  isAdmin = adm?.val() === true;
  if (isAdmin) {
    showDashboard();
    setSchoolLabels(null);
    await loadSchools();
    go('schools');
    return;
  }
  const m = (await get(ref(db, 'members/' + user.uid))).val();
  if (!m?.school) return deny('Bu hesap bir okula bağlı değil.');
  const s = (await get(ref(db, 'schools/' + m.school))).val();
  if (!s) return deny('Okul kaydı bulunamadı.');
  if (s.status === 'pending') return deny('Başvurunuz yönetici onayı bekliyor.', true);
  if (s.status !== 'active') return deny('Kurum erişimi kapalı. Yöneticiyle iletişime geçin.');
  schools = [{ id: m.school, code: m.school, ...s }];
  showDashboard();
  await loadSchoolData(m.school);
  go('boards');
}

function showDashboard() {
  $('loginScreen').style.display = 'none';
  $('dashboardApp').style.display = 'flex';
  $('schoolsNav').style.display = isAdmin ? 'flex' : 'none';
  $('adminSchoolPicker').style.display = isAdmin ? 'flex' : 'none';
  $('userEmail').textContent = me?.email || 'Yönetici';
  document.querySelector('.profile .avatar').textContent = (me?.email || 'Y')[0].toUpperCase();
}
function setSchoolLabels(code) {
  const name = schools.find(x => x.code === code)?.name || code;
  if (!code) {
    $('schoolNameSide').textContent = 'Okul seçilmedi';
    $('schoolNameTop').textContent = 'Admin';
    $('schoolCodeSide').textContent = 'Önce okul seçin';
    return;
  }
  $('schoolNameSide').textContent = name;
  $('schoolNameTop').textContent = (isAdmin ? 'Admin · ' : '') + name;
  $('schoolCodeSide').textContent = 'Kurum: ' + code;
}

$('logoutBtn').onclick = async () => {
  await signOut(auth); $('loginForm').reset(); setMode('login');
};

// ---------- veri yükleme ----------
function detachLive() { liveUnsubs.forEach(u => u()); liveUnsubs = []; }

async function loadSchools() {
  const snap = await get(ref(db, 'schools'));
  schools = toList(snap.val()).map(x => ({ ...x, code: x.id })).sort(byName);
  renderSchools(); refreshAdminSchoolPicker();
}

async function loadSchoolData(code) {
  detachLive();
  activeSchoolCode = code;
  document.querySelectorAll('#activeSchoolSelect,.section-school-select').forEach(el => { el.value = code; });
  setSchoolLabels(code);
  const [b, n, k, sc] = await Promise.all(
    ['boards', 'notices', 'keys', 'schedule'].map(p => get(ref(db, p + '/' + code)))
  );
  boards = toList(b.val()).sort(byName);
  notices = toList(n.val()).sort((a, c) => (c.ts || 0) - (a.ts || 0));
  keys = toList(k.val()).sort(byName);
  fillSchedule(sc.val());
  states = {}; cmds = {};
  const onErr = err => toast(errText(err));
  liveUnsubs.push(
    onValue(ref(db, 'state/' + code), s => { states = s.val() || {}; renderBoards(); }, onErr),
    onValue(ref(db, 'cmd/' + code), s => { cmds = s.val() || {}; renderBoards(); }, onErr)
  );
  renderBoards(); renderNotices(); renderKeys();
}

function clearSchool() {
  detachLive(); activeSchoolCode = null;
  boards = []; notices = []; keys = []; states = {}; cmds = {};
  document.querySelectorAll('#activeSchoolSelect,.section-school-select').forEach(el => { el.value = ''; });
  setSchoolLabels(null);
  renderBoards(); renderNotices(); renderKeys();
}

function refreshAdminSchoolPicker() {
  const opts = '<option value="">Okul seçin</option>' + schools.filter(x => x.status === 'active')
    .map(x => '<option value="' + esc(x.code) + '">' + esc(x.name) + ' (' + esc(x.code) + ')</option>').join('');
  $('activeSchoolSelect').innerHTML = opts;
  document.querySelectorAll('.section-school-select').forEach(el => { el.innerHTML = opts; });
  document.querySelectorAll('#activeSchoolSelect,.section-school-select').forEach(el => { el.value = activeSchoolCode || ''; });
}
async function changeAdminSchool(code) {
  if (!code) { clearSchool(); return; }
  try { await loadSchoolData(code); toast('Yönetim alanı: ' + code); }
  catch (err) { toast(errText(err)); }
}
$('activeSchoolSelect').addEventListener('change', e => changeAdminSchool(e.target.value));
document.querySelectorAll('.section-school-select').forEach(el => el.addEventListener('change', e => changeAdminSchool(e.target.value)));

// ---------- gezinme ----------
function go(p) {
  document.querySelectorAll('.section').forEach(x => {
    x.classList.toggle('active', x.id === 'page-' + p);
    x.classList.toggle('admin-context-visible', isAdmin && ['boards', 'notices', 'keys', 'schedule'].includes(p));
  });
  document.querySelectorAll('.nav button[data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === p));
  const b = document.querySelector('.nav button[data-page="' + p + '"]');
  if (b) $('crumb').textContent = b.textContent.trim();
  $('sidebar').classList.remove('open');
}
document.querySelectorAll('.nav button[data-page]').forEach(b => b.onclick = () => {
  if (b.dataset.page === 'schools' && !isAdmin) return;
  go(b.dataset.page);
});
$('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
$('bellBtn').onclick = () => toast('Yeni bildirim yok');

// ---------- tahtalar ----------
const ACTION_LABEL = { lock: 'Kilitle', unlock: 'Aç', shutdown: 'Kapat' };

function boardView(b) {
  const st = states[b.id] || {};
  const online = st.online === true;
  const status = st.locked === true ? 'locked' : st.locked === false ? 'open' : 'unknown';
  const c = cmds[b.id];
  const pending = c && (!st.ts || (c.ts || 0) > st.ts) ? c : null;
  return { ...b, online, status, last: st.last || '—', method: st.method || '—', pending };
}

function renderBoards() {
  if (!activeSchoolCode) {
    $('boardRows').innerHTML = '<tr><td colspan="5">' + (isAdmin ? 'Tahtaları görmek için yukarıdan okul seçin.' : 'Yükleniyor…') + '</td></tr>';
    ['totalCount', 'onlineCount', 'lockedCount', 'offlineCount'].forEach(id => { $(id).textContent = '—'; });
    $('rowCount').textContent = 'Okul seçilmedi';
    return;
  }
  const all = boards.map(boardView);
  const q = $('searchInput').value.toLocaleLowerCase('tr'), f = $('statusFilter').value;
  const arr = all.filter(b => (b.name + ' ' + (b.sub || '')).toLocaleLowerCase('tr').includes(q)
    && (f === 'all' || (f === 'offline' ? !b.online : b.status === f)));
  $('boardRows').innerHTML = arr.length ? arr.map(b => {
    const pill = b.status === 'locked' ? '<span class="pill locked">Kilitli</span>'
      : b.status === 'open' ? '<span class="pill open">Açık</span>'
      : '<span class="pill offline">Bilinmiyor</span>';
    const pend = b.pending ? '<small style="color:#a96b12">Bekleyen komut: ' + esc(ACTION_LABEL[b.pending.action] || b.pending.action) + '</small>' : '';
    const dis = b.online ? '' : ' disabled title="Tahta çevrimdışı"';
    return '<tr><td><div class="board"><div class="board-icon">▣</div><div><b>' + esc(b.name) + '</b><small>' + esc(b.sub || '') + '</small></div></div></td>'
      + '<td>' + pill + pend + '</td>'
      + '<td><span class="pill ' + (b.online ? 'online' : 'offline') + '">' + (b.online ? 'Çevrimiçi' : 'Çevrimdışı') + '</span></td>'
      + '<td class="last">' + esc(b.last) + '<small>' + esc(b.method) + '</small></td>'
      + '<td><div class="row-actions">'
      + '<button class="mini" data-board="toggle" data-id="' + esc(b.id) + '"' + dis + '>' + (b.status === 'locked' ? 'Aç' : 'Kilitle') + '</button>'
      + '<button class="mini" data-board="power" data-id="' + esc(b.id) + '"' + dis + '>Kapat</button>'
      + '<button class="mini" data-board="delete" data-id="' + esc(b.id) + '">Sil</button>'
      + '</div></td></tr>';
  }).join('') : '<tr><td colspan="5">' + (boards.length ? 'Aramaya uyan tahta yok.' : 'Henüz tahta eklenmedi. "＋ Tahta ekle" ile başlayın.') + '</td></tr>';
  $('totalCount').textContent = all.length;
  $('onlineCount').textContent = all.filter(x => x.online).length;
  $('lockedCount').textContent = all.filter(x => x.status === 'locked').length;
  $('offlineCount').textContent = all.filter(x => !x.online).length;
  $('rowCount').textContent = arr.length + ' tahta gösteriliyor';
  $('syncTime').textContent = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function sendCommand(id, action) {
  return set(ref(db, 'cmd/' + activeSchoolCode + '/' + id), { action, ts: serverTimestamp(), by: me.email || me.uid });
}

$('boardRows').onclick = async e => {
  const btn = e.target.closest('[data-board]'); if (!btn) return;
  const b = boards.map(boardView).find(y => y.id === btn.dataset.id); if (!b) return;
  try {
    if (btn.dataset.board === 'toggle') {
      await sendCommand(b.id, b.status === 'locked' ? 'unlock' : 'lock');
      toast(b.name + ': komut gönderildi');
    } else if (btn.dataset.board === 'power') {
      if (!confirm(b.name + ' kapatılsın mı?')) return;
      await sendCommand(b.id, 'shutdown'); toast('Kapatma komutu gönderildi');
    } else if (btn.dataset.board === 'delete') {
      if (!confirm(b.name + ' silinsin mi? Bu işlem geri alınamaz.')) return;
      const c = activeSchoolCode;
      await update(ref(db), { ['boards/' + c + '/' + b.id]: null, ['state/' + c + '/' + b.id]: null, ['cmd/' + c + '/' + b.id]: null });
      boards = boards.filter(x => x.id !== b.id); renderBoards(); toast('Tahta silindi');
    }
  } catch (err) { toast(errText(err)); }
};

$('addBoard').onclick = async () => {
  if (!needSchool()) return;
  const name = prompt('Sınıf / tahta adı (örn. 6-A Sınıfı):'); if (!name || !name.trim()) return;
  const data = { name: name.trim().slice(0, 80), sub: 'Tahta ' + String(boards.length + 1).padStart(2, '0'), created: serverTimestamp() };
  try {
    const r = push(ref(db, 'boards/' + activeSchoolCode));
    await set(r, data);
    boards.push({ id: r.key, ...data }); boards.sort(byName); renderBoards(); toast('Tahta eklendi');
  } catch (err) { toast(errText(err)); }
};

$('searchInput').oninput = renderBoards;
$('statusFilter').onchange = renderBoards;
$('refreshBtn').onclick = async () => {
  if (!needSchool()) return;
  try { await loadSchoolData(activeSchoolCode); toast('Liste yenilendi'); } catch (err) { toast(errText(err)); }
};
$('lockAll').onclick = async () => {
  if (!needSchool()) return;
  const online = boards.map(boardView).filter(x => x.online);
  if (!online.length) { toast('Çevrimiçi tahta yok'); return; }
  if (!confirm('Çevrimiçi ' + online.length + ' tahta kilitlensin mi?')) return;
  const u = {};
  online.forEach(b => { u['cmd/' + activeSchoolCode + '/' + b.id] = { action: 'lock', ts: serverTimestamp(), by: me.email || me.uid }; });
  try { await update(ref(db), u); toast('Kilitleme komutu gönderildi'); } catch (err) { toast(errText(err)); }
};

// ---------- duyurular ----------
function renderNotices() {
  if (!activeSchoolCode) { $('noticeCards').innerHTML = '<p>Duyuruları görmek için önce okul seçin.</p>'; return; }
  $('noticeCards').innerHTML = notices.length ? notices.map((n, i) => '<article class="notice-card"><div class="notice-thumb">DUYURU ' + (i + 1) + '</div><h3>' + esc(n.title) + '</h3><p>' + esc(n.desc) + '</p><div class="notice-meta"><span>' + esc(n.target || 'Tüm tahtalar') + '</span><span>' + (n.ts ? new Date(n.ts).toLocaleDateString('tr-TR') : '') + '</span></div><div style="margin-top:10px;text-align:right"><button class="mini" data-notice-delete="' + esc(n.id) + '">Sil</button></div></article>').join('')
    : '<p>Henüz duyuru yok.</p>';
}
function openModal() { $('modalBackdrop').classList.add('show'); }
function closeModal() { $('modalBackdrop').classList.remove('show'); }
$('noticeQuick').onclick = () => { if (!needSchool()) return; go('notices'); openModal(); };
$('newNotice').onclick = () => { if (needSchool()) openModal(); };
$('cancelModal').onclick = closeModal;
$('modalBackdrop').onclick = e => { if (e.target === $('modalBackdrop')) closeModal(); };
$('modalForm').onsubmit = async e => {
  e.preventDefault(); if (!needSchool()) return;
  const n = { title: $('noticeTitle').value.trim().slice(0, 120), desc: ($('noticeText').value.trim() || 'Açıklama eklenmedi').slice(0, 2000), target: $('noticeTarget').value, ts: serverTimestamp() };
  try {
    const r = push(ref(db, 'notices/' + activeSchoolCode)); await set(r, n);
    notices.unshift({ id: r.key, ...n, ts: Date.now() }); renderNotices();
    $('modalForm').reset(); closeModal(); toast('Duyuru kaydedildi');
  } catch (err) { toast(errText(err)); }
};
$('noticeCards').onclick = async e => {
  const b = e.target.closest('[data-notice-delete]'); if (!b) return;
  try {
    await remove(ref(db, 'notices/' + activeSchoolCode + '/' + b.dataset.noticeDelete));
    notices = notices.filter(x => x.id !== b.dataset.noticeDelete); renderNotices(); toast('Duyuru silindi');
  } catch (err) { toast(errText(err)); }
};

// ---------- öğretmen anahtarları ----------
function renderKeys() {
  if (!activeSchoolCode) { $('keyRows').innerHTML = '<p>Öğretmen anahtarlarını görmek için önce okul seçin.</p>'; return; }
  $('keyRows').innerHTML = keys.length ? keys.map(k => '<div class="key-row"><div><b>' + esc(k.name) + '</b><small>Öğretmen kodu: ' + esc(k.code) + '</small></div><span class="pill ' + (k.active ? 'online' : 'offline') + '">' + (k.active ? 'Aktif' : 'Pasif') + '</span><button class="mini" data-key="' + esc(k.id) + '">' + (k.active ? 'Pasife al' : 'Aktifleştir') + '</button></div>').join('')
    : '<p style="margin:0;color:#7c879b">Henüz öğretmen anahtarı yok.</p>';
}
$('keyRows').onclick = async e => {
  const b = e.target.closest('[data-key]'); if (!b) return;
  const k = keys.find(x => x.id === b.dataset.key); if (!k) return;
  try {
    await update(ref(db, 'keys/' + activeSchoolCode + '/' + k.id), { active: !k.active });
    k.active = !k.active; renderKeys(); toast('Yetki durumu değiştirildi');
  } catch (err) { toast(errText(err)); }
};
$('newKey').onclick = async () => {
  if (!needSchool()) return;
  const n = prompt('Öğretmenin adı soyadı:'); if (!n || !n.trim()) return;
  let code;
  do { code = 'TK-' + String(Math.floor(1000 + Math.random() * 9000)); } while (keys.some(x => x.code === code));
  const k = { name: n.trim().slice(0, 80), code, active: true, created: serverTimestamp() };
  try {
    const r = push(ref(db, 'keys/' + activeSchoolCode)); await set(r, k);
    keys.push({ id: r.key, ...k }); keys.sort(byName); renderKeys(); toast('Öğretmen anahtarı oluşturuldu: ' + code);
  } catch (err) { toast(errText(err)); }
};

// ---------- ders saatleri ----------
function fillSchedule(v) {
  $('schOpen').value = v?.open || '08:40';
  $('schClose').value = v?.close || '16:00';
  $('schDays').value = v?.days || 'Pazartesi – Cuma';
}
$('saveSchedule').onclick = async () => {
  if (!needSchool()) return;
  try {
    await set(ref(db, 'schedule/' + activeSchoolCode), { open: $('schOpen').value, close: $('schClose').value, days: $('schDays').value });
    toast('Ders saatleri kaydedildi');
  } catch (err) { toast(errText(err)); }
};

// ---------- kurumlar (admin) ----------
function renderSchools() {
  const f = $('schoolFilter').value, arr = schools.filter(x => f === 'all' || x.status === f);
  $('schoolRows').innerHTML = arr.length ? arr.map(x => '<tr><td><b>' + esc(x.name) + '</b>' + (x.email ? '<small style="display:block;color:#9aa4b4">' + esc(x.email) + '</small>' : '') + '</td><td>' + esc(x.code) + '</td><td>' + esc(x.contact || '—') + '</td><td><span class="status-tag ' + esc(x.status) + '">' + (x.status === 'pending' ? 'Onay bekliyor' : x.status === 'active' ? 'Aktif' : 'Pasif') + '</span></td><td><div class="admin-actions">'
    + (x.status === 'pending' ? '<button class="approve" data-school="approve" data-id="' + esc(x.code) + '">Onayla</button>' : '')
    + '<button data-school="edit" data-id="' + esc(x.code) + '">Düzenle</button>'
    + (x.status === 'active' ? '<button data-school="off" data-id="' + esc(x.code) + '">Pasife al</button>'
      : x.status === 'inactive' ? '<button class="approve" data-school="on" data-id="' + esc(x.code) + '">Aktifleştir</button>' : '')
    + '</div></td></tr>').join('')
    : '<tr><td colspan="5">Kayıtlı kurum yok.</td></tr>';
  $('schoolTotal').textContent = schools.length;
  $('schoolPending').textContent = schools.filter(x => x.status === 'pending').length;
  $('schoolActive').textContent = schools.filter(x => x.status === 'active').length;
  $('schoolInactive').textContent = schools.filter(x => x.status === 'inactive').length;
  $('schoolRowCount').textContent = arr.length + ' kurum gösteriliyor';
}
$('schoolFilter').onchange = renderSchools;
$('refreshSchools').onclick = async () => {
  try { await loadSchools(); toast('Kurum listesi yenilendi'); } catch (err) { toast(errText(err)); }
};
$('schoolRows').onclick = async e => {
  const b = e.target.closest('[data-school]'); if (!b) return;
  const x = schools.find(y => y.code === b.dataset.id); if (!x) return;
  const a = b.dataset.school, patch = {};
  if (a === 'approve' || a === 'on') patch.status = 'active';
  if (a === 'off') patch.status = 'inactive';
  if (a === 'edit') {
    const n = prompt('Kurum adı:', x.name); if (n === null || !n.trim()) return;
    patch.name = n.trim().slice(0, 120);
  }
  try {
    await update(ref(db, 'schools/' + x.code), patch);
    Object.assign(x, patch);
    if (patch.status === 'inactive' && activeSchoolCode === x.code) clearSchool();
    refreshAdminSchoolPicker(); renderSchools(); toast('Kurum güncellendi');
  } catch (err) { toast(errText(err)); }
};

renderBoards(); renderNotices(); renderKeys();
