// Community-Seite: Forum + Feedback, nur für eingeloggte Nutzer.
// Rendering strikt über textContent (kein HTML aus Nutzereingaben -> kein XSS).
import { Auth } from './lib.js';

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const token = localStorage.getItem('tgl_token');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch { /* egal */ }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function fmtTime(ts) {
  const d = new Date(Number(ts));
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function showErr(id, msg) { const el = $(id); el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }

/* ---------------------------------------------------------------- Forum ---- */

let currentThread = null;

async function loadThreads() {
  const wrap = $('fr-threads');
  try {
    const { threads } = await api('/api/forum/threads');
    wrap.innerHTML = '';
    if (!threads.length) { wrap.innerHTML = '<p class="muted small">Noch keine Themen – mach das erste auf!</p>'; return; }
    for (const t of threads) {
      const row = document.createElement('button');
      row.className = 'forum-thread';
      const title = document.createElement('span'); title.className = 'ft-title'; title.textContent = t.title;
      const meta = document.createElement('span'); meta.className = 'ft-meta';
      meta.textContent = `${t.author} · ${t.posts} Beitr${t.posts === 1 ? 'ag' : 'äge'} · ${fmtTime(t.last_post)}`;
      row.appendChild(title); row.appendChild(meta);
      row.addEventListener('click', () => openThread(t.id));
      wrap.appendChild(row);
    }
  } catch (e) { wrap.innerHTML = ''; showErr('fr-err', e.message); }
}

async function openThread(id) {
  try {
    const { thread } = await api('/api/forum/threads/' + id);
    currentThread = id;
    $('fr-list-view').classList.add('hidden');
    $('fr-thread-view').classList.remove('hidden');
    $('fr-thread-title').textContent = thread.title;
    const wrap = $('fr-posts');
    wrap.innerHTML = '';
    for (const p of thread.posts) {
      const div = document.createElement('div');
      div.className = 'forum-post';
      const head = document.createElement('div'); head.className = 'fp-head';
      const who = document.createElement('b'); who.textContent = p.author;
      if (p.author === Auth.current()) who.classList.add('me');
      head.appendChild(who);
      const when = document.createElement('span'); when.textContent = fmtTime(p.created);
      head.appendChild(when);
      const body = document.createElement('div'); body.className = 'fp-text'; body.textContent = p.text;
      div.appendChild(head); div.appendChild(body);
      wrap.appendChild(div);
    }
    wrap.scrollTop = wrap.scrollHeight;
  } catch (e) { showErr('fr-err', e.message); }
}

function closeThread() {
  currentThread = null;
  $('fr-thread-view').classList.add('hidden');
  $('fr-list-view').classList.remove('hidden');
  loadThreads();
}

async function createThread() {
  showErr('fr-err', '');
  const title = $('fr-title').value.trim(), text = $('fr-text').value.trim();
  try {
    const { thread } = await api('/api/forum/threads', { method: 'POST', body: JSON.stringify({ title, text }) });
    $('fr-title').value = ''; $('fr-text').value = '';
    openThread(thread.id);
  } catch (e) { showErr('fr-err', e.message); }
}

async function sendReply() {
  showErr('fr-reply-err', '');
  const text = $('fr-reply').value.trim();
  if (!currentThread) return;
  try {
    await api(`/api/forum/threads/${currentThread}/posts`, { method: 'POST', body: JSON.stringify({ text }) });
    $('fr-reply').value = '';
    openThread(currentThread);
  } catch (e) { showErr('fr-reply-err', e.message); }
}

/* ------------------------------------------------------------- Feedback ---- */

const GAME_LABELS = { sail: '⛵', auto: '🏎', mtb: '🚵', wurm: '🐛', lem: '🐭', gorilla: '🦍', mampf: '🟡', maze: '🧩', snake: '🐍' };

async function sendFeedback() {
  showErr('fb-err', '');
  try {
    await api('/api/feedback', { method: 'POST', body: JSON.stringify({ text: $('fb-text').value, game: $('fb-game').value }) });
    $('fb-text').value = '';
    const ok = $('fb-ok');
    ok.textContent = 'Danke! Dein Feedback ist angekommen. 🙏';
    ok.classList.remove('hidden');
    setTimeout(() => ok.classList.add('hidden'), 4000);
    loadFeedback();
  } catch (e) { showErr('fb-err', e.message); }
}

async function loadFeedback() {
  const wrap = $('fb-list');
  try {
    const { feedback, admin } = await api('/api/feedback');
    if (admin) $('fb-list-title').textContent = 'Alle Einsendungen (Admin-Ansicht)';
    wrap.innerHTML = '';
    if (!feedback.length) { wrap.innerHTML = '<p class="muted small">Noch nichts eingesendet.</p>'; return; }
    for (const f of feedback) {
      const div = document.createElement('div');
      div.className = 'forum-post';
      const head = document.createElement('div'); head.className = 'fp-head';
      const who = document.createElement('b');
      who.textContent = (GAME_LABELS[f.game] ? GAME_LABELS[f.game] + ' ' : '💬 ') + (admin ? f.user_name : 'Du');
      head.appendChild(who);
      const when = document.createElement('span'); when.textContent = fmtTime(f.created);
      head.appendChild(when);
      const body = document.createElement('div'); body.className = 'fp-text'; body.textContent = f.text;
      div.appendChild(head); div.appendChild(body);
      wrap.appendChild(div);
    }
  } catch (e) { wrap.innerHTML = ''; showErr('fb-err', e.message); }
}

/* ----------------------------------------------------------------- init ---- */

async function init() {
  $('fr-create').addEventListener('click', createThread);
  $('fr-back').addEventListener('click', closeThread);
  $('fr-send').addEventListener('click', sendReply);
  $('fb-send').addEventListener('click', sendFeedback);

  await Auth.probe();
  if (!Auth.serverUp) { $('offline').classList.remove('hidden'); return; }
  if (!Auth.isLoggedIn()) { $('gate').classList.remove('hidden'); return; }

  $('auth-user').classList.remove('hidden');
  $('auth-name').textContent = Auth.current();
  $('community').classList.remove('hidden');
  loadThreads();
  loadFeedback();
}

document.addEventListener('DOMContentLoaded', init);
