// Landing-Page: Login (Server + lokaler Fallback), Highscores/Bestenliste und
// Einstieg in die Caterpillar-Online-Sessions (die im Spiel selbst laufen).
import { Auth, Scores, fmtValue } from './lib.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ Auth-UI ---- */

function renderAuth() {
  const name = Auth.current();
  const guest = $('auth-guest'), user = $('auth-user');
  if (name) {
    guest.classList.add('hidden'); guest.open = false;
    user.classList.remove('hidden');
    $('auth-name').textContent = name;
  } else {
    guest.classList.remove('hidden');
    user.classList.add('hidden');
  }
}
function authError(msg) { const el = $('auth-error'); el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }

async function afterAuthChange() {
  renderAuth();
  renderNetStatus();
  if (Auth.serverUp && Auth.isLoggedIn()) await Scores.syncUp();
  await renderLeaderboard();
}

async function doLogin() {
  authError('');
  try { await Auth.login($('in-name').value, $('in-pass').value); $('in-pass').value = ''; await afterAuthChange(); }
  catch (e) { authError(e.message); }
}
async function doRegister() {
  authError('');
  try { await Auth.register($('in-name').value, $('in-pass').value); $('in-pass').value = ''; await afterAuthChange(); }
  catch (e) { authError(e.message); }
}
async function doLogout() { await Auth.logout(); await afterAuthChange(); }

/* --------------------------------------------------------- Highscores ---- */

function renderScores() {
  const wrap = $('score-mine');
  wrap.innerHTML = '';
  const summary = Scores.summary();
  if (Scores.isEmpty(summary)) {
    wrap.innerHTML = '<p class="muted small">Noch keine eigenen Bestzeiten – spiel eine Runde.</p>';
    return;
  }
  for (const g of Object.values(summary)) {
    if (!g.entries.length) continue;
    const box = document.createElement('div');
    box.className = 'score-game';
    box.innerHTML = `<h3>${g.title}</h3>`;
    for (const e of g.entries.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `<span class="s-label">${e.label}<small>${e.sub}</small></span><span class="s-val">${e.value}</span>`;
      box.appendChild(row);
    }
    wrap.appendChild(box);
  }
}

async function renderLeaderboard() {
  const wrap = $('score-global');
  const board = await Scores.leaderboard();
  if (!board) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<h3 class="lb-title">🌍 Bestenliste (alle Spieler)</h3>';
  if (!board.length) { wrap.innerHTML += '<p class="muted small">Noch keine Einträge – lade deine Bestzeiten mit dem Login hoch.</p>'; return; }
  const byGame = {};
  for (const r of board) (byGame[r.game] ||= []).push(r);
  for (const [game, rows] of Object.entries(byGame)) {
    rows.sort((a, b) => (a.sub || '').localeCompare(b.sub || ''));
    const box = document.createElement('div');
    box.className = 'score-game';
    box.innerHTML = `<h3>${Scores.gameTitle(game)}</h3>`;
    for (const r of rows.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `<span class="s-label">${r.label || r.variant}<small>${r.sub || ''} · 👑 ${r.user_name}</small></span>` +
        `<span class="s-val">${fmtValue(r.value, r.better)}</span>`;
      box.appendChild(row);
    }
    wrap.appendChild(box);
  }
}

/* ------------------------------------------------------- Caterpillars ---- */

function renderNetStatus() {
  const el = $('cat-status');
  const btn = $('cat-lobby');
  if (Auth.serverUp) {
    if (Auth.isLoggedIn()) {
      el.innerHTML = '🟢 Server verbunden – öffne die Lobby und leg los.';
      btn?.removeAttribute('disabled');
    } else {
      el.innerHTML = '🟢 Server verbunden – <b>zum Online-Spielen bitte oben einloggen</b> (Open-Games-Lobby ist für angemeldete Spieler).';
    }
    el.className = 'cat-status on';
  } else {
    el.innerHTML = '🟡 Online-Dienst nicht erreichbar. Ihr könnt trotzdem lokal am selben Gerät im <b>Hotseat</b> spielen.';
    el.className = 'cat-status off';
  }
}

function openLobby() {
  if (Auth.serverUp && !Auth.isLoggedIn()) {
    $('cat-status').innerHTML = '🔑 Bitte zuerst oben einloggen, dann Lobby öffnen.';
    $('auth-guest')?.setAttribute('open', 'open');
    return;
  }
  location.href = 'wurm.html?net=lobby';
}
function joinSession() {
  const code = ($('cat-code').value || '').trim().toUpperCase();
  const err = $('cat-join-err');
  if (!code) { err.textContent = 'Bitte einen Code eingeben.'; err.classList.remove('hidden'); return; }
  location.href = `wurm.html?net=join&code=${encodeURIComponent(code)}`;
}

/* --------------------------------------------------------------- init ---- */

async function init() {
  $('btn-login').onclick = doLogin;
  $('btn-register').onclick = doRegister;
  $('btn-logout').onclick = doLogout;
  $('in-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('cat-lobby').onclick = openLobby;
  $('cat-join').onclick = joinSession;
  $('cat-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinSession(); });

  renderScores();          // sofort aus localStorage
  renderNetStatus();
  await Auth.probe();      // Server prüfen + Token verifizieren
  renderAuth();
  renderNetStatus();
  if (Auth.serverUp && Auth.isLoggedIn()) await Scores.syncUp();
  await renderLeaderboard();
}

document.addEventListener('DOMContentLoaded', init);
