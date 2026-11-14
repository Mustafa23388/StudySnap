/* StudySnap SPA — vanilla JS, hash router, talks to /api */
const $app = document.getElementById('app');
const state = { me: null, set: null, flashIdx: 0, flashBack: false, quizAnswers: {}, quizResult: null, activeDeck: null };

/* ───────── api helper ───────── */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status; err.code = data.code;
    throw err;
  }
  return data;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  document.getElementById('toast-region').appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

/* ───────── router ───────── */
const routes = [];
function route(pattern, handler, { public: isPublic = false } = {}) { routes.push({ pattern, handler, isPublic }); }

function navigate(hash) { location.hash = hash; }

async function render() {
  const hash = location.hash || '#/';
  const [path, query] = hash.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      if (!r.isPublic && !state.me) return renderAuth('login');
      try { await r.handler({ params, match: m, query: params }); }
      catch (e) { console.error(e); $app.innerHTML = shell(`<div class="empty"><div class="e-ico">⚠️</div><h3>Something went wrong</h3><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="history.back()">Go back</button></div>`); }
      return;
    }
  }
  if (state.me) navigate('#/dashboard'); else navigate('#/');
}

window.addEventListener('hashchange', render);

/* ───────── shared shell ───────── */
const NAV = [
  ['#/dashboard', '🏠', 'Dashboard'],
  ['#/library', '📚', 'My Study Sets'],
  ['#/review', '🔁', 'Review'],
  ['#/progress', '📊', 'Progress'],
];
function shell(content, { crumb = null, active = null, actions = '' } = {}) {
  const me = state.me;
  const navHtml = NAV.map(([href, ico, label]) =>
    `<a class="nav-item ${active === href ? 'active' : ''}" href="${href}"><span class="ico">${ico}</span>${label}</a>`).join('');
  const srcHtml = (me && me._sources) ? me._sources : '';
  return `
  <div class="app">
    <aside class="sidebar" aria-label="Main navigation">
      <a class="logo" href="#/dashboard">📖 StudySnap</a>
      ${navHtml}
      <div class="nav-section">Study Sources</div>
      <div id="src-list">${srcHtml}</div>
      <a class="src-item" href="#/create" style="color:var(--accent-dark);font-weight:600">⊕ Add Source</a>
      <div style="margin-top:auto;padding-top:18px;border-top:1px solid var(--border-soft)">
        <a class="nav-item" href="#/settings"><span class="ico">⚙️</span>Settings</a>
        <button class="nav-item" id="logout-btn"><span class="ico">🚪</span>Log out</button>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="crumb">${crumb || `<a class="page-title" href="#/dashboard" style="color:inherit;text-decoration:none">StudySnap</a>`}</div>
        <div class="topbar-actions">${actions}
          <button class="btn btn-outline btn-sm" data-search-toggle aria-label="Search">🔍</button>
          <a class="btn btn-outline btn-sm" href="#/settings" aria-label="Settings">⚙️</a>
        </div>
      </div>
      <div id="search-bar" style="display:none;margin-bottom:16px"><input class="input" id="global-search" placeholder="Search your study sets by title, subject or content…" aria-label="Search study sets"></div>
      ${content}
    </main>
    <nav class="bottom-nav" aria-label="Mobile navigation">
      <a href="#/dashboard" class="${active === '#/dashboard' ? 'active' : ''}"><span class="i">🏠</span>Home</a>
      <a href="#/library" class="${active === '#/library' ? 'active' : ''}"><span class="i">📚</span>Sets</a>
      <a href="#/review" class="${active === '#/review' ? 'active' : ''}"><span class="i">🔁</span>Review</a>
      <a href="#/progress" class="${active === '#/progress' ? 'active' : ''}"><span class="i">📊</span>Progress</a>
      <a href="#/settings" class="${active === '#/settings' ? 'active' : ''}"><span class="i">⚙️</span>Profile</a>
    </nav>
  </div>`;
}

async function refreshSources() {
  try {
    const { sets } = await api('/sets?per=8&sort=recent');
    state.me._sources = sets.map(s =>
      `<a class="src-item" href="#/set/${s.id}" title="${esc(s.title)}"><span class="dot ${s.status}"></span>${esc(s.title)}</a>`).join('') || `<div class="src-item" style="color:var(--muted)">No sources yet</div>`;
    const el = document.getElementById('src-list');
    if (el) el.innerHTML = state.me._sources;
  } catch {}
}

function bindShell() {
  const lb = document.getElementById('logout-btn');
  if (lb) lb.onclick = async () => { await api('/auth/logout', { method: 'POST' }); state.me = null; navigate('#/'); render(); };
  const st = document.querySelector('[data-search-toggle]');
  if (st) st.onclick = () => { const b = document.getElementById('search-bar'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; const i = document.getElementById('global-search'); if (i) { i.focus(); i.oninput = debounce(() => navigate('#/library?q=' + encodeURIComponent(i.value)), 350); } };
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function subjectBadge(subject) {
  const map = { Biology: 'badge-bio', History: 'badge-his', Chemistry: 'badge-chem', Physics: 'badge-gen', Mathematics: 'badge-math', Math: 'badge-math', General: 'badge-gen' };
  return `<span class="badge ${map[subject] || 'badge-gen'}">${esc(subject)}</span>`;
}
function timeAgo(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso + (iso.length === 19 ? 'Z' : ''));
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  const days = Math.floor(s / 86400);
  return days === 1 ? 'yesterday' : days + ' days ago';
}

/* ═════════ PUBLIC: landing ═════════ */
route(/^\/$/, () => {
  if (state.me) return navigate('#/dashboard');
  $app.innerHTML = `
  <header class="nav-public">
    <a class="logo" style="margin:0" href="#/">📖 StudySnap</a>
    <nav class="public-links">
      <a href="#how">How it works</a>
      <a href="#features">Features</a>
      <a href="#/login" style="color:var(--ink)">Log in</a>
      <a class="btn btn-primary btn-sm" href="#/register">Try it free</a>
    </nav>
  </header>
  <section class="hero">
    <h1>Study smarter,<br><span class="accent-word">not longer.</span></h1>
    <p class="lead">Paste your notes, upload a chapter, or drop in a lecture transcript. StudySnap turns it into clear summaries, key concepts, flashcards, and practice quizzes in seconds.</p>
    <p class="support">Rereading the same pages isn’t studying, and highlighting everything isn’t learning. StudySnap does the heavy lifting so you can spend your time actually understanding the material.</p>
    <div class="cta">
      <a class="btn btn-primary btn-lg" href="#/register">Try it free</a>
      <a class="btn btn-outline btn-lg" href="#how">See how it works</a>
    </div>
    <p class="hint" style="margin-top:12px">Free plan · No credit card required · <a href="#/login">Log into the demo account</a></p>
  </section>
  <section id="features" style="max-width:1020px;margin:0 auto;padding:10px 20px">
    <div class="grid-3">
      ${[
        ['⚡','Instant summaries','Choose a quick overview or a detailed breakdown, whichever fits your deadline.'],
        ['🔍','Key concepts at a glance','Definitions, formulas, and main ideas are pulled out and organized for you.'],
        ['🃏','Auto-generated flashcards','Turn any text into a ready-to-review deck.'],
        ['📝','Practice quizzes','Test yourself before the exam does.'],
        ['📄','Works with your material','Textbooks, articles, slides, transcripts, or your own messy notes.'],
        ['🤖','AI study tutor','Ask questions about your own material and get patient, focused answers.']
      ].map(([i,t,d]) => `<div class="card feature"><div class="f-ico">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </div>
  </section>
  <section id="how" class="card pad" style="max-width:900px;margin:30px auto">
    <h2 style="text-align:center;font-size:24px;margin-bottom:22px">From material to mastery in four steps</h2>
    <div class="how">
      ${[['1','Add your material','Paste text or upload a PDF, TXT or DOCX.'],['2','AI understands it','StudySnap reads, structures and analyses the content.'],['3','Study actively','Flip flashcards, mark what you know, take quizzes.'],['4','Review what matters','Weak cards and topics resurface until they stick.']].map(([n,t,d]) => `<div class="how-step"><div class="n">${n}</div><h3 class="serif" style="font-size:17px">${t}</h3><p style="font-size:13px;color:var(--muted)">${d}</p></div>`).join('')}
    </div>
  </section>
  <footer class="site-footer">© ${new Date().getFullYear()} StudySnap · Study smarter, not longer.</footer>`;
});

/* ═════════ AUTH ═════════ */
function renderAuth(mode = 'login') {
  const isLogin = mode === 'login';
  $app.innerHTML = `
  <header class="nav-public"><a class="logo" style="margin:0" href="#/">📖 StudySnap</a>
    <nav class="public-links">${isLogin ? '<a href="#/register">Create account</a>' : '<a href="#/login">Log in</a>'}</nav></header>
  <div class="auth-wrap"><div class="auth-card">
    <h1>${isLogin ? 'Welcome back' : 'Create your account'}</h1>
    <p class="hint" style="margin-bottom:18px">${isLogin ? 'Log in to keep studying.' : 'Start studying smarter in under a minute.'}</p>
    <div id="auth-error"></div>
    <form id="auth-form">
      ${isLogin ? '' : `<div class="field"><label for="f-name">Name</label><input class="input" id="f-name" required maxlength="80" autocomplete="name"></div>`}
      <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="f-pass">Password</label><input class="input" id="f-pass" type="password" required minlength="8" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
        ${isLogin ? '' : '<div class="hint">At least 8 characters.</div>'}</div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
    </form>
    <p class="hint" style="margin-top:14px;text-align:center">
      ${isLogin ? '<a href="#" id="forgot">Forgot password?</a> · ' : ''}${isLogin ? 'New here? ' : 'Already have an account? '}<a href="#/${isLogin ? 'register' : 'login'}">${isLogin ? 'Create an account' : 'Log in'}</a>
    </p>
    ${isLogin ? '<p class="hint" style="text-align:center;background:#F6F1E9;border-radius:8px;padding:8px">Demo account: <b>demo@studysnap.app</b> / <b>studysnap123</b></p>' : ''}
  </div></div>`;
  document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('auth-error'); errEl.innerHTML = '';
    try {
      

const emailInput = document.getElementById('f-email');
const passInput = document.getElementById('f-pass');
const nameInput = document.getElementById('f-name');

const body = {
  email: emailInput.value.trim(),
  password: passInput.value
};

if (!isLogin) {
  body.name = nameInput.value.trim();
}


      const { user } = await api('/auth/' + (isLogin ? 'login' : 'register'), { method: 'POST', body });
      state.me = user;
      toast(isLogin ? 'Welcome back, ' + user.name : 'Account created — welcome!', 'ok');
      navigate('#/dashboard');
    } catch (err) { errEl.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
  };
  const fg = document.getElementById('forgot');
  if (fg) fg.onclick = async (e) => {
    e.preventDefault();
    const email = prompt('Enter your account email:');
    if (!email) return;
    const r = await api('/auth/forgot-password', { method: 'POST', body: { email } });
    if (r.devResetToken) {
      const np = prompt('Dev mode reset token: ' + r.devResetToken + '\n\nEnter a new password (min 8 chars):');
      if (np) { await api('/auth/reset-password', { method: 'POST', body: { token: r.devResetToken, newPassword: np } }); toast('Password updated — log in now.', 'ok'); }
    } else toast(r.message || 'Check your email.');
  };
}

route(/^\/login$/, () => renderAuth('login'), { public: true });
route(/^\/register$/, () => renderAuth('register'), { public: true });

/* ═════════ DASHBOARD ═════════ */
route(/^\/dashboard$/, async () => {
  const [{ sets }, prog] = await Promise.all([api('/sets?per=4&sort=recent'), api('/progress').catch(() => ({ stats: {} }))]);
  const s = prog.stats || {};
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const recent = sets.map(set => `
    <tr role="row">
      <td><a href="#/set/${set.id}" class="src-cell" style="color:var(--ink)"><span class="file-ico ${set.source_type === 'pdf' ? '' : set.source_type}">${esc(set.source_type.slice(0, 4).toUpperCase())}</span>${esc(set.title)}</a></td>
      <td>${subjectBadge(set.subject)}</td>
      <td>${timeAgo(set.last_studied_at || set.created_at)}</td>
      <td style="min-width:130px"><div class="bar"><span style="width:${Math.min(100, set.stats.progress)}%"></span></div><span class="hint">${set.stats.progress}%</span></td>
      <td>${set.stats.cards} cards</td>
      <td>${set.stats.bestQuizPct !== null ? Math.round(set.stats.bestQuizPct) + '%' : '—'}</td>
    </tr>`).join('');
  $app.innerHTML = shell(`
    <h1 class="page-title">${greet} 👋</h1>
    <p class="subtitle" style="margin-bottom:22px">Ready to study smarter, ${esc(state.me.name.split(' ')[0])}?</p>
    <div class="card pad" style="text-align:center;padding:38px 22px;margin-bottom:24px">
      <h2 class="serif" style="font-size:26px;margin-bottom:8px">+ Create Study Set</h2>
      <p class="hint" style="margin-bottom:18px">Paste text, upload a file, or start from your notes — StudySnap does the rest.</p>
      <div class="dz-actions" style="justify-content:center">
        <a class="btn btn-primary" href="#/create?mode=text">📋 Paste Text</a>
        <a class="btn btn-outline" href="#/create?mode=upload">📄 Upload PDF</a>
        <a class="btn btn-outline" href="#/create?mode=upload">📑 Upload Document</a>
        <a class="btn btn-outline" href="#/create?mode=text">✏️ Start with Notes</a>
      </div>
    </div>
    <h2 class="serif" style="font-size:21px;margin-bottom:12px">Recent study material</h2>
    ${sets.length ? `
    <div class="table-wrap"><table class="snap">
      <thead><tr><th scope="col">Source</th><th scope="col">Subject</th><th scope="col">Last studied</th><th scope="col">Progress</th><th scope="col">Cards</th><th scope="col">Best quiz</th></tr></thead>
      <tbody>${recent}</tbody>
    </table></div>
    <p style="margin-top:12px"><a href="#/library">View all study sets →</a></p>`
    : `<div class="card empty"><div class="e-ico">📚</div><h3>Your study space is empty.</h3><p>Upload your first chapter or paste your notes and we'll turn them into a complete study set.</p><a class="btn btn-primary" href="#/create">Create Study Set</a></div>`}
    <h2 class="serif" style="font-size:21px;margin:28px 0 12px">Study statistics</h2>
    <div class="grid-4" style="margin-bottom:8px">
      <div class="stat accent"><div class="num">${s.studySets ?? 0}</div><div class="lbl">Study sets created</div></div>
      <div class="stat"><div class="num">${s.flashcardsReviewed ?? 0}</div><div class="lbl">Flashcards reviewed</div></div>
      <div class="stat"><div class="num">${s.quizAttempts ?? 0}</div><div class="lbl">Quiz attempts</div></div>
      <div class="stat"><div class="num">${s.avgQuizScore !== null && s.avgQuizScore !== undefined ? s.avgQuizScore + '%' : '—'}</div><div class="lbl">Average quiz score</div></div>
    </div>
    <div class="grid-2">
      <div class="stat"><div class="num" style="color:var(--teal);font-size:20px">${(s.topicsMastered || []).length}</div><div class="lbl">Topics mastered</div><div style="margin-top:8px">${(s.topicsMastered || []).map(t => `<span class="topic-chip">${esc(t)}</span>`).join('') || '<span class="hint">None yet — take a quiz to find out.</span>'}</div></div>
      <div class="stat"><div class="num" style="color:var(--amber);font-size:20px">${(s.topicsNeedingReview || []).length}</div><div class="lbl">Topics needing review</div><div style="margin-top:8px">${(s.topicsNeedingReview || []).map(t => `<span class="topic-chip">${esc(t)}</span>`).join('') || '<span class="hint">Nothing flagged — nice work.</span>'}</div></div>
    </div>`, { active: '#/dashboard' });
  bindShell(); refreshSources();
});

/* ═════════ LIBRARY ═════════ */
route(/^\/library$/, async ({ query }) => {
  const q = query.get('q') || '', filter = query.get('filter') || '', sort = query.get('sort') || 'recent';
  const { sets, total } = await api(`/sets?q=${encodeURIComponent(q)}&filter=${filter}&sort=${sort}`);
  const rows = sets.map(set => `
    <tr>
      <td><a href="#/set/${set.id}" class="src-cell" style="color:var(--ink)"><span class="file-ico ${set.source_type === 'pdf' ? '' : set.source_type}">${esc(set.source_type.slice(0, 4).toUpperCase())}</span>${esc(set.title)}</a></td>
      <td>${subjectBadge(set.subject)}</td>
      <td>${esc(set.source_type.toUpperCase())}</td>
      <td>${set.stats.cards} cards</td>
      <td>${set.last_studied_at ? 'Studied ' + timeAgo(set.last_studied_at) : 'Not studied yet'}</td>
      <td><div style="display:flex;gap:6px">
        <a class="btn btn-outline btn-sm" href="#/set/${set.id}" aria-label="Open ${esc(set.title)}">Open</a>
        <button class="btn btn-danger btn-sm" data-del="${set.id}" aria-label="Delete ${esc(set.title)}">Delete</button>
      </div></td>
    </tr>`).join('');
  $app.innerHTML = shell(`
    <h1 class="page-title"><span class="u">Study Library</span></h1>
    <p class="subtitle" style="margin-bottom:20px">All your study sources in one place.</p>
    <div class="dropzone" id="dz" style="margin-bottom:20px">
      <div class="dz-icon">☁️⬆️</div>
      <h3>Drop a PDF, TXT, or DOCX here</h3>
      <div class="dz-actions">
        <button class="btn btn-primary" id="upload-btn">⬆️ Upload file</button>
        <a class="btn btn-outline" href="#/create?mode=text">📋 Paste text</a>
      </div>
      <input type="file" id="file-input" accept=".pdf,.txt,.docx,.md" style="display:none" aria-label="Upload study file">
    </div>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
      <input class="input" id="lib-search" placeholder="Search your study sources..." value="${esc(q)}" style="max-width:320px" aria-label="Search study sources">
      <label class="hint" for="lib-filter" style="margin:0">Filter:</label>
      <select class="input" id="lib-filter" style="max-width:200px">
        <option value="">All sets</option>
        <option value="needs_review" ${filter === 'needs_review' ? 'selected' : ''}>Needs review</option>
        <option value="recently_studied" ${filter === 'recently_studied' ? 'selected' : ''}>Recently studied</option>
        <option value="has_quiz_score" ${filter === 'has_quiz_score' ? 'selected' : ''}>Has quiz score</option>
      </select>
      <label class="hint" for="lib-sort" style="margin:0;margin-left:auto">Sort by:</label>
      <select class="input" id="lib-sort" style="max-width:190px">
        <option value="recent" ${sort === 'recent' ? 'selected' : ''}>Last studied</option>
        <option value="created" ${sort === 'created' ? 'selected' : ''}>Recently created</option>
        <option value="score" ${sort === 'score' ? 'selected' : ''}>Highest quiz score</option>
        <option value="title" ${sort === 'title' ? 'selected' : ''}>Title A–Z</option>
      </select>
    </div>
    ${total ? `<div class="table-wrap"><table class="snap">
      <thead><tr><th scope="col">Source</th><th scope="col">Subject</th><th scope="col">Type</th><th scope="col">Cards</th><th scope="col">Last studied</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div><p class="hint" style="margin-top:8px">${total} study set${total === 1 ? '' : 's'}</p>`
    : `<div class="card empty"><div class="e-ico">🗂️</div><h3>No study sets found</h3><p>${q ? 'Nothing matches your search.' : 'Your study space is empty. Upload your first chapter or paste your notes.'}</p><a class="btn btn-primary" href="#/create">Create Study Set</a></div>`}`,
    { active: '#/library' });
  bindShell(); refreshSources();
  
const libSearch = document.getElementById('lib-search');
const libFilter = document.getElementById('lib-filter');
const libSort = document.getElementById('lib-sort');

const reNav = () => {
  const p = new URLSearchParams();

  if (libSearch && libSearch.value) {
    p.set('q', libSearch.value);
  }

  if (libFilter && libFilter.value) {
    p.set('filter', libFilter.value);
  }

  if (libSort) {
    p.set('sort', libSort.value);
  }

  navigate('#/library?' + p.toString());
};

if (libSearch) libSearch.oninput = debounce(reNav, 400);
if (libFilter) libFilter.onchange = reNav;
if (libSort) libSort.onchange = reNav;
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this study set and all its cards, quizzes and notes?')) return;
    await api('/sets/' + b.dataset.del, { method: 'DELETE' }); toast('Study set deleted.', 'ok'); render();
  });
  bindDropzone();
});

function bindDropzone() {
  const dz = document.getElementById('dz'); if (!dz) return;
  const input = document.getElementById('file-input');
  document.getElementById('upload-btn').onclick = () => input.click();
  dz.onclick = e => { if (e.target === dz || e.target.classList.contains('dz-icon') || e.target.tagName === 'H3') input.click(); };
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) uploadFile(f); });
  input.onchange = () => { if (input.files[0]) uploadFile(input.files[0]); };
}
async function uploadFile(file) {
  navigate('#/processing?name=' + encodeURIComponent(file.name));
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/sets', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    state.me = (await api('/auth/me')).user;
    toast('Study set ready!', 'ok');
    navigate('#/set/' + data.set.id);
  } catch (err) {
    toast(err.message, 'err');
    navigate('#/library');
  }
}

/* ═════════ CREATE ═════════ */
route(/^\/create$/, async ({ query }) => {
  const mode = query.get('mode') || 'text';
  $app.innerHTML = shell(`
    <h1 class="page-title"><span class="u">Create Study Set</span></h1>
    <p class="subtitle" style="margin-bottom:20px">Add your material — StudySnap will build the summary, concepts, flashcards and quiz.</p>
    <div class="grid-2" style="align-items:start">
      <div class="card pad">
        <div class="pills" role="tablist" style="margin-bottom:16px">
          <button role="tab" id="pm-text" class="${mode === 'text' ? 'active' : ''}">📋 Paste text</button>
          <button role="tab" id="pm-upload" class="${mode === 'upload' ? 'active' : ''}">📄 Upload file</button>
        </div>
        <div class="field"><label for="c-title">Title</label><input class="input" id="c-title" placeholder="e.g. Biology — Cell Structure" maxlength="150"></div>
        <div class="field"><label for="c-subject">Subject</label><input class="input" id="c-subject" placeholder="e.g. Biology (optional)" maxlength="60"></div>
        <div id="pane-text" style="display:${mode === 'text' ? 'block' : 'none'}">
          <div class="field"><label for="c-text">Your study material</label>
            <textarea class="textarea" id="c-text" style="min-height:260px" placeholder="Paste your notes, textbook section, lecture transcript, or article here..."></textarea>
            <div class="hint"><span id="wc">0</span> words — at least ~50 words needed.</div></div>
        </div>
        <div id="pane-upload" style="display:${mode === 'upload' ? 'block' : 'none'}">
          <div class="dropzone" id="dz2"><div class="dz-icon">☁️</div>
            <h3 class="serif" style="font-size:18px">Drop a PDF, TXT, or DOCX here</h3>
            <div class="dz-actions"><button class="btn btn-primary" id="c-upload-btn" type="button">⬆️ Choose file</button></div>
            <input type="file" id="c-file" accept=".pdf,.txt,.docx,.md" style="display:none" aria-label="Choose file">
            <p class="hint" id="c-file-name" style="margin-top:10px">Max 10 MB · PDF, TXT, DOCX, MD</p>
          </div>
        </div>
        <div class="field"><label for="c-style">Summary style</label>
          <select class="input" id="c-style">
            <option value="quick">Quick Overview</option>
            <option value="standard" selected>Standard Summary</option>
            <option value="detailed">Detailed Breakdown</option>
            <option value="exam">Exam-focused Summary</option>
          </select></div>
        <div id="c-error"></div>
        <button class="btn btn-primary btn-lg btn-block" id="c-go">✨ Create Study Set</button>
      </div>
      <div class="card pad">
        <h3 class="serif" style="margin-bottom:10px">What you'll get</h3>
        <ul style="padding-left:20px;color:#4B5563;font-size:14.5px;display:flex;flex-direction:column;gap:8px">
          <li>AI summary in your chosen style</li>
          <li>Key concepts with simple explanations</li>
          <li>A ready-to-review flashcard deck</li>
          <li>A practice quiz with scoring</li>
          <li>An AI tutor that knows your material</li>
        </ul>
        <div class="formula-callout" style="margin-top:16px"><span class="ico">🧠</span><div><b>Active learning loop</b><span class="eq">Read → Understand → Recall → Test → Review</span></div></div>
      </div>
    </div>`, { active: '#/library' });
  bindShell(); refreshSources();
  const selected = { file: null };
  pm_text.onclick = () => { pane_text.style.display = 'block'; pane_upload.style.display = 'none'; pm_text.classList.add('active'); pm_upload.classList.remove('active'); };
  pm_upload.onclick = () => { pane_upload.style.display = 'block'; pane_text.style.display = 'none'; pm_upload.classList.add('active'); pm_text.classList.remove('active'); };
  c_text.oninput = () => wc.textContent = c_text.value.trim().split(/\s+/).filter(Boolean).length;
  c_upload_btn.onclick = () => c_file.click();
  c_file.onchange = () => { if (c_file.files[0]) { selected.file = c_file.files[0]; c_file_name.textContent = '📄 ' + selected.file.name + ' (' + Math.round(selected.file.size / 1024) + ' KB)'; } };
  const dz2 = document.getElementById('dz2');
  ['dragover', 'dragenter'].forEach(ev => dz2.addEventListener(ev, e => { e.preventDefault(); dz2.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz2.addEventListener(ev, e => { e.preventDefault(); dz2.classList.remove('drag'); }));
  dz2.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) { selected.file = f; c_file_name.textContent = '📄 ' + f.name; } });
  c_go.onclick = async () => {
    c_error.innerHTML = '';
    const style = c_style.value;
    try {
      if (selected.file) {
        navigate('#/processing?name=' + encodeURIComponent(selected.file.name) + '&style=' + style);
        const fd = new FormData(); fd.append('file', selected.file); fd.append('style', style);
        if (c_title.value) fd.append('title', c_title.value);
        if (c_subject.value) fd.append('subject', c_subject.value);
        const res = await fetch('/api/sets', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed.');
        state.me = (await api('/auth/me')).user;
        if (data.notice) toast(data.notice);
        navigate('#/set/' + data.set.id);
      } else {
        if (c_text.value.trim().length < 50) throw new Error('Your material is too short. Paste at least a paragraph (≈50 words) so StudySnap has something to work with.');
        navigate('#/processing?style=' + style + '&title=' + encodeURIComponent(c_title.value || 'Untitled study set'));
        const { set, notice } = await api('/sets', { method: 'POST', body: { text: c_text.value, title: c_title.value, subject: c_subject.value, style } });
        state.me = (await api('/auth/me')).user;
        if (notice) toast(notice);
        navigate('#/set/' + set.id);
      }
    } catch (err) {
      c_error.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      if (location.hash.startsWith('#/processing')) navigate('#/create?mode=' + (selected.file ? 'upload' : 'text'));
    }
  };
});

/* ═════════ PROCESSING ═════════ */
route(/^\/processing$/, ({ query }) => {
  const name = query.get('name') || 'your material';
  const steps = [
    ['📖', 'Reading your material...'],
    ['🧩', 'Finding key concepts...'],
    ['🃏', 'Building flashcards...'],
    ['❓', 'Creating practice questions...'],
    ['✅', 'Your study set is ready!']
  ];
  $app.innerHTML = shell(`<div class="pipeline">
    <h2 class="serif" style="font-size:24px">Analyzing “${esc(name)}”</h2>
    <p class="hint">AI generation can take 10–40 seconds. This page updates automatically.</p>
    <div class="steps">${steps.map((s, i) => `<div class="step" id="ps-${i}"><span style="width:22px;text-align:center">${s[0]}</span><span>${s[1]}</span></div>`).join('')}</div>
  </div>`);
  bindShell();
  let i = 0;
  window._pipeTimer = setInterval(() => {
    if (i > 0) { const p = document.getElementById('ps-' + (i - 1)); if (p) { p.classList.remove('active'); p.classList.add('done'); } }
    const cur = document.getElementById('ps-' + i); if (cur) cur.classList.add('active');
    i++; if (i > 4) clearInterval(window._pipeTimer);
  }, 2200);
});

/* ═════════ WORKSPACE ═════════ */
route(/^\/set\/(\d+)$/, async ({ match, query }) => {
  const id = match[1];
  const tab = query.get('tab') || 'overview';
  clearInterval(window._pipeTimer);
  const data = await api('/sets/' + id);
  state.set = data;
  const s = data.set, st = s.stats;
  const decks = data.decks, deck = state.activeDeck && decks.find(d => d.id === state.activeDeck) ? decks.find(d => d.id === state.activeDeck) : decks[0];
  state.activeDeck = deck ? deck.id : null;
  const tabs = [
    ['overview', 'Overview'], ['summary', 'Summary'], ['concepts', 'Concepts'],
    ['flashcards', 'Flashcards', deck ? deck.cards.length : 0], ['quiz', 'Quiz', data.quizzes.length],
    ['tutor', 'Tutor'], ['notes', 'Notes']
  ].map(([k, label, cnt]) =>
    `<button class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${label}${cnt !== undefined ? `<span class="cnt">${cnt}</span>` : ''}</button>`).join('');

  const actions = `<a class="btn btn-outline btn-sm" href="#/library">← All sets</a>`;

  $app.innerHTML = shell(`
    <div class="topbar" style="border-bottom:none;padding-bottom:8px;margin-bottom:0">
      <div class="crumb"><button class="btn btn-ghost btn-sm" onclick="history.back()" aria-label="Back">←</button>
        <h1 class="page-title">${esc(s.title)}</h1></div>
      <div class="topbar-actions">
        ${data.generatedBy === 'heuristic' ? '<span class="badge badge-offline" title="No AI key configured on the server — generated with offline extraction">⚡ Offline extraction</span>' : '<span class="badge badge-known">🤖 AI generated</span>'}
        <button class="btn btn-outline btn-sm" id="rename-set">✏️ Rename</button>
        <button class="btn btn-danger btn-sm" id="del-set">Delete</button>
      </div>
    </div>
    <div style="display:flex;gap:18px;align-items:center;margin:4px 0 14px;flex-wrap:wrap">
      ${subjectBadge(s.subject)}
      <span class="hint">Progress <b>${st.progress}%</b></span>
      <div class="bar" style="width:180px"><span style="width:${Math.min(100, st.progress)}%"></span></div>
      <span class="hint">${st.known}/${st.cards} cards known · best quiz ${st.bestQuizPct !== null ? Math.round(st.bestQuizPct) + '%' : '—'}</span>
    </div>
    <div class="tabs" role="tablist">${tabs}</div>
    <div id="tab-content">${tabContent(tab, data)}</div>`,
    { active: '#/library', actions });
  bindShell(); refreshSources();
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => navigate(`#/set/${id}?tab=${t.dataset.tab}`));
  document.getElementById('rename-set').onclick = async () => {
    const t = prompt('Rename study set:', s.title); if (!t) return;
    await api('/sets/' + id, { method: 'PATCH', body: { title: t } }); toast('Renamed.', 'ok'); render();
  };
  document.getElementById('del-set').onclick = async () => {
    if (!confirm('Delete this study set and everything in it?')) return;
    await api('/sets/' + id, { method: 'DELETE' }); toast('Deleted.', 'ok'); navigate('#/library'); render();
  };
  if (tab === 'flashcards') bindFlashcards(id, deck);
  if (tab === 'quiz') bindQuiz(id, data);
  if (tab === 'tutor') bindTutor(id, s);
  if (tab === 'notes') bindNotes(id, data.note);
  if (tab === 'summary') bindSummary(id);
  if (tab === 'overview') bindOverview(id, data);
});

function tabContent(tab, data) {
  const s = data.set, st = s.stats;
  if (tab === 'overview') {
    const summ = data.summaries[0];
    return `<div class="grid-4">
        <div class="stat"><div class="num">${s.word_count.toLocaleString()}</div><div class="lbl">Words analyzed</div></div>
        <div class="stat"><div class="num">${st.concepts}</div><div class="lbl">Key concepts</div></div>
        <div class="stat"><div class="num">${st.cards}</div><div class="lbl">Flashcards</div></div>
        <div class="stat"><div class="num">${st.quizQuestions}</div><div class="lbl">Quiz questions</div></div>
      </div>
      <div class="card pad" style="margin-top:18px">
        <h3 class="serif" style="margin-bottom:8px">Quick start</h3>
        <p class="hint" style="margin-bottom:14px">${summ ? 'Summary ready: ' + esc(summ.headline) : 'No summary generated yet.'}</p>
        <div class="dz-actions" style="justify-content:flex-start">
          <a class="btn btn-primary" href="#/set/${s.id}?tab=flashcards">🃏 Make Flashcards</a>
          <a class="btn btn-outline" href="#/set/${s.id}?tab=quiz">📝 Take a Quiz</a>
          <a class="btn btn-outline" href="#/set/${s.id}?tab=tutor">🤖 Ask the Tutor</a>
        </div>
      </div>
      ${st.cards ? `<div class="card pad" style="margin-top:18px"><h3 class="serif" style="margin-bottom:10px">Card status</h3>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:14px">
          <span class="badge badge-known">Known: ${st.known}</span><span class="badge badge-review">Need review: ${st.review}</span><span class="badge badge-offline">Unseen: ${st.cards - st.known - st.review}</span>
        </div></div>` : ''}`;
  }
  if (tab === 'summary') {
    const summ = data.summaries.find(x => x.summary_type === 'standard') || data.summaries[0];
    if (!summ) return `<div class="card empty"><div class="e-ico">📝</div><h3>No summary yet</h3><p>Generate one from your material.</p><button class="btn btn-primary" id="regen-btn">Generate summary</button></div>`;
    const keyPoints = JSON.parse(summ.key_points || '[]');
    const formulas = JSON.parse(summ.formulas || '[]');
    return `<div class="split">
      <div class="card pad">
        <div class="pills" style="margin-bottom:16px">${['quick', 'standard', 'detailed', 'exam'].map(x => `<button data-style="${x}" class="${summ.summary_type === x ? 'active' : ''}">${{ quick: 'Quick', standard: 'Standard', detailed: 'Detailed', exam: 'Exam-focused' }[x]}</button>`).join('')}</div>
        <div id="summary-body" contenteditable="false" aria-label="Summary text">
          <h2 style="font-size:24px;margin-bottom:10px">${esc(summ.headline)}</h2>
          <div id="sum-content">${esc(summ.content)}</div>
          <h3 style="margin:16px 0 8px;font-size:17px">Key Points</h3>
          <ul style="padding-left:20px">${keyPoints.map(k => `<li style="margin-bottom:6px">${esc(k)}</li>`).join('')}</ul>
          ${formulas.length ? `<div class="formula-callout"><span class="ico">🧮</span><div><b>Key Formula:</b>${formulas.map(f => `<span class="eq">${esc(f)}</span>`).join('<br>')}</div></div>` : ''}
        </div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
          <button class="btn btn-outline" id="copy-sum">📋 Copy</button>
          <button class="btn btn-primary" id="dl-sum">⬇️ Download</button>
          <button class="btn btn-outline" id="edit-sum">✏️ Edit</button>
          <button class="btn btn-outline" id="regen-btn" style="margin-left:auto">↻ Regenerate</button>
        </div>
      </div>
      <div class="card pad">
        <h3 class="serif" style="margin-bottom:10px">Key Terms</h3>
        <div class="table-wrap" style="box-shadow:none"><table class="snap" style="min-width:0"><thead><tr><th>Term</th><th>Definition</th></tr></thead>
        <tbody>${data.concepts.slice(0, 8).map(c => `<tr><td><b>${esc(c.title)}</b></td><td>${esc(c.explanation.slice(0, 90))}</td></tr>`).join('')}</tbody></table></div>
        <a class="btn btn-outline btn-sm" style="margin-top:12px" href="#/set/${s.id}?tab=concepts">All concepts →</a>
      </div>
    </div>`;
  }
  if (tab === 'concepts') {
    if (!data.concepts.length) return `<div class="card empty"><div class="e-ico">🔍</div><h3>No concepts extracted</h3><p>Try regenerating with the AI service configured.</p></div>`;
    return `<div class="grid-2">${data.concepts.map(c => `
      <div class="card concept"><h3>${esc(c.title)}</h3>
        <p style="margin-top:6px">${esc(c.explanation)}</p>
        ${c.details ? `<p class="detail">${esc(c.details)}</p>` : ''}
        ${c.example ? `<div class="ex"><b>Example:</b> ${esc(c.example)}</div>` : ''}
      </div>`).join('')}</div>`;
  }
  if (tab === 'flashcards') {
    const deck = data.decks.find(d => d.id === state.activeDeck) || data.decks[0];
    if (!deck || !deck.cards.length) return `<div class="card empty"><div class="e-ico">🃏</div><h3>No flashcards yet</h3><p>Generate a deck or add your own cards.</p></div>`;
    return `<div class="card pad">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <select class="input" id="deck-select" style="max-width:260px" aria-label="Choose deck">${data.decks.map(d => `<option value="${d.id}" ${d.id === deck.id ? 'selected' : ''}>${esc(d.title)} (${d.cards.length})</option>`).join('')}</select>
        <button class="btn btn-outline btn-sm" id="new-deck">+ New deck</button>
        <button class="btn btn-outline btn-sm" id="rename-deck">✏️ Rename</button>
        <button class="btn btn-danger btn-sm" id="del-deck">Delete deck</button>
        <button class="btn btn-outline btn-sm" id="manage-cards" style="margin-left:auto">Manage cards</button>
      </div>
      <div class="flash-stage">
        <div class="flash-counter" id="fc-counter"></div>
        <div class="bar" style="margin-bottom:18px"><span id="fc-bar"></span></div>
        <div class="flash-card" id="fc-card" role="button" tabindex="0" aria-label="Flashcard — press Enter to flip"></div>
        <div class="flash-toolbar">
          <button class="btn btn-amber" id="fc-review">⚠️ Need Review</button>
          <button class="btn btn-outline" id="fc-prev">← Previous</button>
          <button class="btn btn-teal" id="fc-known">✓ Known</button>
          <button class="btn btn-outline" id="fc-next">Next →</button>
        </div>
        <div class="flash-toolbar" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" id="fc-shuffle">🔀 Shuffle</button>
          <button class="btn btn-ghost btn-sm" id="fc-restart">↻ Restart</button>
          <button class="btn btn-ghost btn-sm" id="fc-add">+ Add card</button>
        </div>
      </div></div>`;
  }
  if (tab === 'quiz') {
    return `<div class="card pad" style="margin-bottom:18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <h3 class="serif" style="margin:0">Practice quizzes</h3>
      <span class="hint">Generate a new quiz:</span>
      <select class="input" id="q-diff" style="max-width:150px"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select>
      <select class="input" id="q-count" style="max-width:130px"><option>5</option><option selected>8</option><option>10</option><option>15</option></select>
      <button class="btn btn-primary" id="q-gen">Generate quiz</button>
    </div>
    ${state.quizResult ? quizResultHtml(state.quizResult) : ''}
    ${data.quizzes.length ? data.quizzes.map((qz, idx) => `
      <div class="card pad" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div><h3 class="serif" style="font-size:18px">${esc(qz.title)}</h3>
          <span class="hint">${qz.questions.length} questions · ${esc(qz.difficulty)} · created ${timeAgo(qz.created_at)} · attempts: ${qz.attempts.length}</span></div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" data-start-quiz="${idx}">Start quiz</button>
            <button class="btn btn-danger btn-sm" data-del-quiz="${qz.id}" aria-label="Delete quiz">🗑</button>
          </div>
        </div>
        ${qz.attempts.length ? `<p class="hint" style="margin-top:8px">Last score: <b>${Math.round(qz.attempts[0].percentage)}%</b> (${qz.attempts[0].score}/${qz.attempts[0].total})</p>` : ''}
        <div id="quiz-area-${qz.id}"></div>
      </div>`).join('')
    : `<div class="card empty"><div class="e-ico">📝</div><h3>No quizzes yet</h3><p>Generate your first practice quiz above — test yourself before the exam does.</p></div>`}`;
  }
  if (tab === 'tutor') {
    return `<div class="card tutor-wrap">
      <div class="mode-row">
        <span class="hint" style="margin:0">Tutor mode:</span>
        <div class="pills" id="tutor-modes">${[['explain', 'Explain Simply'], ['detail', 'Explain in Detail'], ['example', 'Give an Example'], ['quiz', 'Quiz Me'], ['understand', 'Help Me Understand']].map(([k, l], i) => `<button data-mode="${k}" class="${i === 0 ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="pills" id="tutor-scope" style="margin-left:auto">
          <button data-scope="set" class="active" title="Answers prioritize your material">Current Study Set</button>
          <button data-scope="general" title="General questions">General Question</button>
        </div>
      </div>
      <div class="tutor-log" id="tutor-log" aria-live="polite">
        <div class="msg assistant"><span class="tag">StudySnap Tutor</span>Hi! I've read “${esc(s.title)}”. Ask me anything about it — I can explain, give examples, or quiz you. ${data.generatedBy === 'heuristic' ? 'Note: the AI tutor needs an AI key on the server; until then I can only point you to passages from your material.' : ''}</div>
      </div>
      <div class="tutor-input">
        <input class="input" id="tutor-in" placeholder="Ask about your material… e.g. “Explain mitochondria simply”" aria-label="Ask the tutor">
        <button class="btn btn-primary" id="tutor-send">Send</button>
      </div>
    </div>`;
  }
  if (tab === 'notes') {
    return `<div class="card pad">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 class="serif">My notes</h3><span class="hint" id="notes-saved"></span>
      </div>
      <textarea class="textarea" id="notes-area" style="min-height:380px;font-size:15.5px;line-height:1.7" placeholder="Write your own notes for this study set. They save automatically.">${esc(data.note || '')}</textarea>
      <p class="hint" style="margin-top:8px">Auto-saves 1s after you stop typing · stored with your account</p>
    </div>`;
  }
  return '';
}

function bindOverview(id, data) {
  const rb = document.getElementById('regen-btn'); if (rb) rb.onclick = () => regenerate(id);
}
function bindSummary(id) {
  const data = state.set;
  document.querySelectorAll('[data-style]').forEach(b => b.onclick = async () => {
    await api('/sets/' + id + '/regenerate', { method: 'POST', body: { style: b.dataset.style } });
    toast('Summary regenerated in “' + b.dataset.style + '” style.', 'ok'); render();
  });
  const rb = document.getElementById('regen-btn'); if (rb) rb.onclick = () => regenerate(id);
  document.getElementById('copy-sum').onclick = () => {
    navigator.clipboard.writeText(summPlainText()).then(() => toast('Summary copied.', 'ok'));
  };
  document.getElementById('dl-sum').onclick = () => {
    const blob = new Blob([summPlainText()], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = state.set.set.title.replace(/[^\w\- ]/g, '') + ' — Summary.txt'; a.click();
  };
  const body = document.getElementById('summary-body');
  document.getElementById('edit-sum').onclick = () => {
    const editable = body.getAttribute('contenteditable') === 'false';
    body.setAttribute('contenteditable', editable);
    document.getElementById('edit-sum').textContent = editable ? '💾 Save' : '✏️ Edit';
    if (editable) body.focus();
    else toast('Summary edits are local (regenerating will overwrite).', 'ok');
  };
}
function summPlainText() {
  const el = document.getElementById('summary-body'); if (!el) return '';
  return el.innerText;
}
async function regenerate(id) {
  const style = prompt('Summary style? (quick / standard / detailed / exam)', 'standard'); if (!style) return;
  toast('Regenerating…');
  try { const r = await api('/sets/' + id + '/regenerate', { method: 'POST', body: { style } }); toast('Done (' + r.generatedBy + ').', 'ok'); render(); }
  catch (e) { toast(e.message, 'err'); }
}

/* flashcards */
function bindFlashcards(setId, deck) {
  if (!deck) return;
  const ds = document.getElementById('deck-select');
  ds.onchange = () => { state.activeDeck = +ds.value; state.flashIdx = 0; state.flashBack = false; state.order = null; render(); };
  document.getElementById('new-deck').onclick = async () => {
    const t = prompt('New deck title:', 'My deck'); if (!t) return;
    await api('/sets/' + setId + '/decks', { method: 'POST', body: { title: t } });
    state.activeDeck = null; toast('Deck created.', 'ok'); render();
  };
  document.getElementById('rename-deck').onclick = async () => {
    const t = prompt('Rename deck:', deck.title); if (!t) return;
    await api('/decks/' + deck.id, { method: 'PATCH', body: { title: t } }); toast('Renamed.', 'ok'); render();
  };
  document.getElementById('del-deck').onclick = async () => {
    if (!confirm('Delete this deck and all its cards?')) return;
    await api('/decks/' + deck.id, { method: 'DELETE' }); state.activeDeck = null; toast('Deck deleted.', 'ok'); render();
  };
  document.getElementById('manage-cards').onclick = () => manageCards(deck);

  if (!state.order || state.orderDeck !== deck.id) {
    state.order = deck.cards.map((_, i) => i);
    state.orderDeck = deck.id;
    state.flashIdx = 0;
  }
  const cards = state.order.map(i => deck.cards[i]).filter(Boolean);
  drawCard(deck, cards);
  const flip = () => { state.flashBack = !state.flashBack; drawCard(deck, cards); };
  const fcCard = document.getElementById('fc-card');
  fcCard.onclick = flip;
  fcCard.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  const setStatus = async (status) => {
    const c = cards[state.flashIdx]; if (!c) return;
    const { card } = await api('/cards/' + c.id, { method: 'PATCH', body: { status } });
    Object.assign(deck.cards.find(x => x.id === c.id), card);
    toast(status === 'known' ? 'Marked as known ✓' : 'Marked for review ⚠', status === 'known' ? 'ok' : '');
    drawCard(deck, cards);
  };
  document.getElementById('fc-known').onclick = () => setStatus('known');
  document.getElementById('fc-review').onclick = () => setStatus('need_review');
  document.getElementById('fc-prev').onclick = () => { state.flashBack = false; state.flashIdx = (state.flashIdx - 1 + cards.length) % cards.length; drawCard(deck, cards); };
  document.getElementById('fc-next').onclick = () => { state.flashBack = false; state.flashIdx = (state.flashIdx + 1) % cards.length; drawCard(deck, cards); };
  document.getElementById('fc-shuffle').onclick = () => {
    state.order = state.order.sort(() => Math.random() - 0.5); state.flashIdx = 0; state.flashBack = false;
    drawCard(deck, cards); toast('Deck shuffled 🔀');
  };
  document.getElementById('fc-restart').onclick = () => { state.order = deck.cards.map((_, i) => i); state.orderDeck = deck.id; state.flashIdx = 0; state.flashBack = false; drawCard(deck, cards); toast('Deck restarted.'); };
  document.getElementById('fc-add').onclick = async () => {
    const q = prompt('Front of card (question):'); if (!q) return;
    const a = prompt('Back of card (answer):'); if (!a) return;
    await api('/decks/' + deck.id + '/cards', { method: 'POST', body: { question: q, answer: a } });
    toast('Card added.', 'ok'); render();
  };
}
function drawCard(deck, cards) {
  const el = document.getElementById('fc-card'); if (!el) return;
  const c = cards[state.flashIdx];
  if (!c) { el.innerHTML = '<p class="q">No cards in this deck.</p>'; return; }
  const statusBadge = c.status === 'known' ? '<span class="badge badge-known badge-status">Known</span>'
    : c.status === 'need_review' ? '<span class="badge badge-review badge-status">Need Review</span>' : '';
  el.innerHTML = state.flashBack
    ? `${statusBadge}<div class="a">${esc(c.answer)}</div><div class="flip-hint">Click to see question</div>`
    : `${statusBadge}<div class="q">${esc(c.question)}</div><div class="flip-hint">Click or press Enter to reveal answer</div>`;
  document.getElementById('fc-counter').textContent = `${state.flashIdx + 1} / ${cards.length} cards`;
  document.getElementById('fc-bar').style.width = ((state.flashIdx + 1) / cards.length * 100) + '%';
}
function manageCards(deck) {
  const rows = deck.cards.map(c => `
    <div class="card-list-item">
      <div style="flex:1"><b>${esc(c.question)}</b><p class="hint" style="margin-top:3px">${esc(c.answer.slice(0, 110))}</p></div>
      <span class="badge ${c.status === 'known' ? 'badge-known' : c.status === 'need_review' ? 'badge-review' : 'badge-offline'}">${c.status.replace('_', ' ')}</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-outline btn-sm" data-edit-card="${c.id}">✏️</button>
        <button class="btn btn-danger btn-sm" data-del-card="${c.id}">🗑</button>
      </div>
    </div>`).join('');
  openModal(`<h3>Manage cards — ${esc(deck.title)}</h3><div style="max-height:380px;overflow-y:auto">${rows || '<p class="hint">No cards.</p>'}</div>`);
  document.querySelectorAll('[data-del-card]').forEach(b => b.onclick = async () => {
    await api('/decks/' + deck.id + '/cards/' + b.dataset.delCard, { method: 'DELETE' }); closeModal(); toast('Card deleted.', 'ok'); render();
  });
  document.querySelectorAll('[data-edit-card]').forEach(b => b.onclick = () => {
    const c = deck.cards.find(x => x.id === +b.dataset.editCard);
    const q = prompt('Question:', c.question); if (q === null) return;
    const a = prompt('Answer:', c.answer); if (a === null) return;
    api('/decks/' + deck.id + '/cards/' + c.id, { method: 'PATCH', body: { question: q, answer: a } }).then(() => { closeModal(); toast('Card updated.', 'ok'); render(); });
  });
}
function openModal(html) {
  const div = document.createElement('div');
  div.className = 'modal-back'; div.id = 'modal-back';
  div.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}<div class="modal-actions"><button class="btn btn-outline" onclick="document.getElementById('modal-back').remove()">Close</button></div></div>`;
  div.onclick = e => { if (e.target === div) div.remove(); };
  document.body.appendChild(div);
}
function closeModal() { const m = document.getElementById('modal-back'); if (m) m.remove(); }

/* quiz */
let quizState = null;
function bindQuiz(setId, data) {
  document.getElementById('q-gen').onclick = async () => {
    const difficulty = q_diff.value, count = +q_count.value;
    toast('Generating quiz…');
    try {
      await api('/sets/' + setId + '/quizzes', { method: 'POST', body: { difficulty, count } });
      toast('Quiz ready!', 'ok'); state.quizResult = null; render();
    } catch (e) { toast(e.message, 'err'); }
  };
  document.querySelectorAll('[data-del-quiz]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this quiz?')) return;
    await api('/quizzes/' + b.dataset.delQuiz, { method: 'DELETE' }); toast('Quiz deleted.', 'ok'); render();
  });
  document.querySelectorAll('[data-start-quiz]').forEach(b => b.onclick = () => {
    const qz = data.quizzes[+b.dataset.startQuiz];
    quizState = { quiz: qz, answers: {} };
    state.quizResult = null;
    renderQuizForm(qz);
  });
  if (quizState && data.quizzes.find(q => q.id === quizState.quiz.id) && !state.quizResult) {
    renderQuizForm(quizState.quiz, quizState.answers);
  }
}
function renderQuizForm(qz, answers = quizState?.answers || {}) {
  const area = document.getElementById('quiz-area-' + qz.id);
  if (!area) return;
  area.innerHTML = `<div style="border-top:1px solid var(--border-soft);margin-top:14px;padding-top:16px">
    <h4 class="serif" style="margin-bottom:14px">Answer all questions, then submit.</h4>
    ${qz.questions.map((q, i) => `
      <div class="quiz-q">
        <div class="qtext">${i + 1}. ${esc(q.question)} <span class="badge badge-offline">${esc(q.type.replace('_', ' '))}</span></div>
        ${q.type === 'multiple_choice'
          ? q.options.map((o, oi) => `<label class="opt ${answers[q.id] === o ? 'selected' : ''}"><input type="radio" name="q-${q.id}" value="${esc(o)}" ${answers[q.id] === o ? 'checked' : ''}> ${esc(o)}</label>`).join('')
          : q.type === 'true_false'
            ? `<label class="opt ${answers[q.id] === 'True' ? 'selected' : ''}"><input type="radio" name="q-${q.id}" value="True" ${answers[q.id] === 'True' ? 'checked' : ''}> True</label>
               <label class="opt ${answers[q.id] === 'False' ? 'selected' : ''}"><input type="radio" name="q-${q.id}" value="False" ${answers[q.id] === 'False' ? 'checked' : ''}> False</label>`
            : `<input class="input" data-sa="${q.id}" placeholder="Type your answer…" value="${esc(answers[q.id] || '')}" aria-label="Short answer">`}
      </div>`).join('')}
    <button class="btn btn-primary btn-lg" id="quiz-submit">Submit answers</button>
  </div>`;
  area.querySelectorAll('input[type=radio]').forEach(r => r.onchange = () => { answers[r.name.slice(2)] = r.value; area.querySelectorAll(`[name="q-${r.name.slice(2)}"]`).forEach(x => x.closest('.opt').classList.toggle('selected', x.checked)); });
  area.querySelectorAll('[data-sa]').forEach(inp => inp.oninput = () => { answers[inp.dataset.sa] = inp.value; });
  document.getElementById('quiz-submit').onclick = async () => {
    const payload = Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }));
    if (!payload.length) return toast('Answer at least one question first.', 'err');
    document.getElementById('quiz-submit').disabled = true;
    document.getElementById('quiz-submit').textContent = 'Grading…';
    try {
      state.quizResult = await api('/quizzes/' + qz.id + '/submit', { method: 'POST', body: { answers: payload } });
      quizState = null;
      toast(`Score: ${state.quizResult.attempt.score}/${state.quizResult.attempt.total}`, 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); document.getElementById('quiz-submit').disabled = false; }
  };
}
function quizResultHtml(r) {
  const a = r.attempt;
  return `<div class="card pad" style="margin-bottom:18px">
    <div class="score-hero">
      <div class="big">${a.score}/${a.total}</div>
      <div style="font-size:19px;font-weight:700">${a.percentage}%</div>
      <p class="hint">${a.percentage >= 80 ? 'Excellent work — you know this material.' : a.percentage >= 50 ? 'Good — review the missed topics below.' : 'Keep going — review your flashcards, then retry.'}</p>
    </div>
    <h4 class="serif" style="margin:10px 0 8px">Topics that need improvement</h4>
    <div>${r.topics.map(t => `<span class="topic-chip" style="${t.pct < 60 ? 'background:var(--amber-soft);color:var(--amber)' : 'background:var(--teal-soft);color:#126A4C'}">${esc(t.topic)}: ${t.correct}/${t.total}</span>`).join('')}</div>
    <h4 class="serif" style="margin:16px 0 10px">Answer review</h4>
    ${r.results.map((res, i) => `
      <div class="result-row ${res.correct ? 'ok' : 'bad'}">
        <b>${i + 1}. ${esc(res.question)}</b>
        <p class="hint" style="margin:6px 0">Your answer: <b>${res.yourAnswer ? esc(res.yourAnswer) : '— not answered —'}</b> · Correct answer: <b>${esc(res.correctAnswer)}</b></p>
        <p style="font-size:14px;color:${res.correct ? '#0E5E43' : 'var(--danger)'}">${res.correct ? '✓ Correct' : '✗ Incorrect'}</p>
        ${res.explanation ? `<p style="font-size:14px;margin-top:5px;color:#4B5563">💡 ${esc(res.explanation)}</p>` : ''}
      </div>`).join('')}
    <button class="btn btn-outline" onclick="state.quizResult=null;render()" style="margin-top:10px">Close results</button>
  </div>`;
}

/* tutor */
let tutorState = { mode: 'explain', scope: 'set' };
function bindTutor(setId, s) {
  document.querySelectorAll('#tutor-modes button').forEach(b => b.onclick = () => {
    tutorState.mode = b.dataset.mode;
    document.querySelectorAll('#tutor-modes button').forEach(x => x.classList.toggle('active', x === b));
  });
  document.querySelectorAll('#tutor-scope button').forEach(b => b.onclick = () => {
    tutorState.scope = b.dataset.scope;
    document.querySelectorAll('#tutor-scope button').forEach(x => x.classList.toggle('active', x === b));
  });
  const log = document.getElementById('tutor-log');
  const tutorInput = document.getElementById('tutor-in');
  const send = async () => {
    const text = tutorInput.value.trim(); if (!text) return;
    tutorInput.value = '';
    log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div>`);
    log.insertAdjacentHTML('beforeend', `<div class="msg assistant" id="tutor-pending"><span class="tag">StudySnap Tutor</span>Thinking…</div>`);
    log.scrollTop = log.scrollHeight;
    const history = [...log.querySelectorAll('.msg')].slice(0, -1).map(m => ({
      role: m.classList.contains('user') ? 'user' : 'assistant',
      content: m.textContent.replace(/^STUDYSNAP TUTOR/i, '').trim()
    }));
    try {
      const { reply } = await api('/sets/' + setId + '/tutor', { method: 'POST', body: { messages: history, mode: tutorState.mode, scope: tutorState.scope } });
      const p = document.getElementById('tutor-pending'); if (p) p.remove();
      log.insertAdjacentHTML('beforeend', `<div class="msg assistant"><span class="tag">StudySnap Tutor</span>${esc(reply)}</div>`);
    } catch (e) {
      const p = document.getElementById('tutor-pending'); if (p) p.remove();
      log.insertAdjacentHTML('beforeend', `<div class="msg assistant">⚠️ ${esc(e.message)}</div>`);
    }
    log.scrollTop = log.scrollHeight;
  };
  document.getElementById('tutor-send').onclick = send;
  tutorInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

/* notes */
function bindNotes(setId, initial) {
  const area = document.getElementById('notes-area');
  const saved = document.getElementById('notes-saved');
  let t;
  area.addEventListener('input', () => {
    saved.textContent = 'Saving…';
    clearTimeout(t);
    t = setTimeout(async () => {
      try { const r = await api('/sets/' + setId + '/notes', { method: 'PUT', body: { content: area.value } }); saved.textContent = 'Saved ✓ ' + r.updated_at.slice(11, 16); }
      catch (e) { saved.textContent = 'Save failed: ' + e.message; }
    }, 1000);
  });
}

/* ═════════ REVIEW ═════════ */
route(/^\/review$/, async () => {
  const { cards } = await api('/review');
  $app.innerHTML = shell(`
    <h1 class="page-title"><span class="u">Review</span></h1>
    <p class="subtitle" style="margin-bottom:20px">Cards that need your attention — active recall beats rereading.</p>
    ${cards.length ? `<div class="card pad">
      ${cards.map(c => `
        <div class="card-list-item">
          <div style="flex:1">
            <a href="#/set/${c.set_id}?tab=flashcards" style="color:var(--ink);font-weight:600">${esc(c.question)}</a>
            <p class="hint" style="margin-top:3px">${esc(c.set_title)} · ${esc(c.deck_title)} · reviewed ${c.review_count}× ${c.last_reviewed ? '· last ' + timeAgo(c.last_reviewed) : ''}</p>
          </div>
          <span class="badge ${c.status === 'need_review' ? 'badge-review' : c.status === 'known' ? 'badge-known' : 'badge-offline'}">${c.status.replace('_', ' ')}</span>
          <button class="btn btn-teal btn-sm" data-know="${c.id}" data-set="${c.set_id}">✓ I know this</button>
        </div>`).join('')}
    </div>
    <p class="hint" style="margin-top:10px">Priority: cards marked “Need Review” first, then frequently missed, then cards you haven't seen in a while.</p>`
    : `<div class="card empty"><div class="e-ico">🎉</div><h3>Nothing to review right now</h3><p>Study some flashcards and mark the tricky ones “Need Review” — they'll show up here.</p><a class="btn btn-primary" href="#/library">Go to study sets</a></div>`}`,
    { active: '#/review' });
  bindShell(); refreshSources();
  document.querySelectorAll('[data-know]').forEach(b => b.onclick = async () => {
    await api('/cards/' + b.dataset.know, { method: 'PATCH', body: { status: 'known' } });
    toast('Marked as known ✓', 'ok'); render();
  });
});

/* ═════════ PROGRESS ═════════ */
route(/^\/progress$/, async () => {
  const p = await api('/progress');
  const s = p.stats;
  const days = {};
  for (const a of p.activity) { days[a.day] = days[a.day] || {}; days[a.day][a.kind] = (days[a.day][a.kind] || 0) + a.n; }
  const maxN = Math.max(1, ...Object.values(days).map(d => Object.values(d).reduce((x, y) => x + y, 0)));
  const heat = Object.entries(days).sort().map(([day, kinds]) => {
    const n = Object.values(kinds).reduce((x, y) => x + y, 0);
    const op = 0.25 + (n / maxN) * 0.75;
    return `<div title="${day}: ${n} activities" style="width:26px;height:26px;border-radius:6px;background:rgba(14,138,110,${op.toFixed(2)})"></div>`;
  }).join('');
  $app.innerHTML = shell(`
    <h1 class="page-title"><span class="u">Progress</span></h1>
    <p class="subtitle" style="margin-bottom:20px">Real activity only — every number here comes from what you've actually studied.</p>
    <div class="grid-4">
      <div class="stat accent"><div class="num">${s.studySets}</div><div class="lbl">Study sets</div></div>
      <div class="stat"><div class="num">${s.flashcardsReviewed}</div><div class="lbl">Flashcard reviews</div></div>
      <div class="stat"><div class="num">${s.quizAttempts}</div><div class="lbl">Quiz attempts</div></div>
      <div class="stat"><div class="num">${s.avgQuizScore !== null ? s.avgQuizScore + '%' : '—'}</div><div class="lbl">Avg quiz score</div></div>
    </div>
    <div class="grid-3" style="margin-top:18px">
      <div class="stat"><div class="num" style="color:var(--teal)">${s.cardsKnown}/${s.cardsTotal}</div><div class="lbl">Cards known</div></div>
      <div class="stat"><div class="num" style="color:var(--amber)">${s.cardsNeedReview}</div><div class="lbl">Cards needing review</div></div>
      <div class="stat"><div class="num">${s.studyDays}</div><div class="lbl">Active study days (14d)</div></div>
    </div>
    <div class="card pad" style="margin-top:18px">
      <h3 class="serif" style="margin-bottom:12px">Study activity (last 14 days)</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${heat || '<p class="hint">No activity yet — create a study set to get started.</p>'}</div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card pad">
        <h3 class="serif" style="margin-bottom:10px">Topics mastered</h3>
        ${(s.topicsMastered || []).map(t => `<span class="topic-chip" style="background:var(--teal-soft);color:#126A4C">${esc(t)}</span>`).join('') || '<p class="hint">Score 80%+ on quiz topics to master them.</p>'}
        <h3 class="serif" style="margin:16px 0 10px">Topics needing review</h3>
        ${(s.topicsNeedingReview || []).map(t => `<span class="topic-chip" style="background:var(--amber-soft);color:var(--amber)">${esc(t)}</span>`).join('') || '<p class="hint">Nothing below 60% yet.</p>'}
      </div>
      <div class="card pad">
        <h3 class="serif" style="margin-bottom:10px">Recent quiz attempts</h3>
        ${p.recentAttempts.map(a => `<div class="card-list-item"><span>Quiz #${a.quiz_id}</span><b>${a.score}/${a.total} (${Math.round(a.percentage)}%)</b><span class="hint">${timeAgo(a.completed_at)}</span></div>`).join('') || '<p class="hint">No attempts yet.</p>'}
      </div>
    </div>`,
    { active: '#/progress' });
  bindShell(); refreshSources();
});

/* ═════════ SETTINGS ═════════ */
route(/^\/settings$/, async () => {
  const me = (await api('/auth/me')).user;
  const prefs = me.prefs || {};
  $app.innerHTML = shell(`
    <h1 class="page-title"><span class="u">Settings</span></h1>
    <p class="subtitle" style="margin-bottom:20px">Account, study preferences, appearance and data.</p>
    <div class="grid-2" style="align-items:start">
      <div>
        <div class="card pad" style="margin-bottom:18px">
          <h3 class="serif" style="margin-bottom:12px">Account</h3>
          <div class="field"><label for="s-name">Name</label><input class="input" id="s-name" value="${esc(me.name)}"></div>
          <div class="field"><label>Email</label><input class="input" value="${esc(me.email)}" disabled></div>
          <button class="btn btn-primary" id="save-name">Save profile</button>
        </div>
        <div class="card pad" style="margin-bottom:18px">
          <h3 class="serif" style="margin-bottom:12px">Change password</h3>
          <div class="field"><label for="s-cur">Current password</label><input class="input" type="password" id="s-cur"></div>
          <div class="field"><label for="s-new">New password (min 8 chars)</label><input class="input" type="password" id="s-new"></div>
          <button class="btn btn-outline" id="save-pass">Update password</button>
        </div>
        <div class="card pad">
          <h3 class="serif" style="margin-bottom:12px">Data</h3>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a class="btn btn-outline" href="/api/auth/me/export" download>⬇️ Export study data</a>
            <button class="btn btn-danger" id="del-account">Delete account</button>
          </div>
          <p class="hint" style="margin-top:10px">Export downloads all your study sets, cards, quiz attempts and notes as JSON.</p>
        </div>
      </div>
      <div>
        <div class="card pad" style="margin-bottom:18px">
          <h3 class="serif" style="margin-bottom:12px">Study preferences</h3>
          <div class="field"><label for="s-sum">Preferred summary length</label>
            <select class="input" id="s-sum">${['quick', 'standard', 'detailed', 'exam'].map(v => `<option value="${v}" ${prefs.summaryStyle === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label for="s-diff">Default quiz difficulty</label>
            <select class="input" id="s-diff">${['easy', 'medium', 'hard'].map(v => `<option value="${v}" ${prefs.quizDifficulty === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label for="s-lang">Preferred language</label>
            <select class="input" id="s-lang">${['English', 'Spanish', 'French', 'German', 'Portuguese', 'Chinese', 'Japanese'].map(v => `<option value="${v}" ${prefs.language === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <button class="btn btn-primary" id="save-prefs">Save preferences</button>
        </div>
        <div class="card pad" style="margin-bottom:18px">
          <h3 class="serif" style="margin-bottom:12px">Appearance</h3>
          <div class="pills" id="s-theme">
            ${[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([v, l]) => `<button data-theme="${v}" class="${(prefs.theme || 'light') === v ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <p class="hint" style="margin-top:10px">Dark mode is in early access — the study workspace stays light for readability.</p>
        </div>
        <div class="card pad">
          <h3 class="serif" style="margin-bottom:12px">Free plan</h3>
          <ul style="padding-left:20px;font-size:14px;color:#4B5563;display:flex;flex-direction:column;gap:6px">
            <li>25 AI generations per day</li>
            <li>Up to 5 active study sets</li>
            <li>Unlimited personal notes</li>
            <li>Flashcards &amp; quizzes</li>
          </ul>
          <div class="notice-box" style="margin-top:12px">💎 Paid plans are <b>coming soon</b> — billing isn't configured yet, so no upgrade purchases are possible.</div>
        </div>
      </div>
    </div>`,
    { active: '#/settings' });
  bindShell(); refreshSources();
  document.getElementById('save-name').onclick = async () => {
    await api('/auth/me', { method: 'PATCH', body: { name: s_name.value } });
    state.me = (await api('/auth/me')).user; toast('Profile saved.', 'ok');
  };
  document.getElementById('save-pass').onclick = async () => {
    try { await api('/auth/me', { method: 'PATCH', body: { currentPassword: s_cur.value, newPassword: s_new.value } }); toast('Password updated.', 'ok'); s_cur.value = s_new.value = ''; }
    catch (e) { toast(e.message, 'err'); }
  };
  document.getElementById('save-prefs').onclick = async () => {
    await api('/auth/me', { method: 'PATCH', body: { prefs: { summaryStyle: s_sum.value, quizDifficulty: s_diff.value, language: s_lang.value } } });
    toast('Preferences saved.', 'ok');
  };
  document.querySelectorAll('#s-theme button').forEach(b => b.onclick = async () => {
    document.querySelectorAll('#s-theme button').forEach(x => x.classList.toggle('active', x === b));
    await api('/auth/me', { method: 'PATCH', body: { prefs: { theme: b.dataset.theme } } });
    toast('Appearance preference saved.', 'ok');
  });
  document.getElementById('del-account').onclick = async () => {
    const pw = prompt('Confirm your password to permanently delete your account and all data:');
    if (pw === null) return;
    try {
      await api('/auth/me', { method: 'DELETE', body: { confirmPassword: pw } });
      state.me = null; toast('Account deleted.', 'ok'); navigate('#/'); render();
    } catch (e) { toast(e.message, 'err'); }
  };
});

/* ═════════ boot ═════════ */
(async function boot() {
  try { state.me = (await api('/auth/me')).user; } catch {}
  render();
})();
