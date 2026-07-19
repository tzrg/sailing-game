// Landing-Page: Login, Highscore-Übersicht und Caterpillar-Sessions.
import { Auth, Scores, Net } from './lib.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ Auth-UI ---- */

function renderAuth() {
  const name = Auth.current();
  const guest = $('auth-guest');
  const user = $('auth-user');
  if (name) {
    guest.classList.add('hidden');
    user.classList.remove('hidden');
    $('auth-name').textContent = name;
  } else {
    guest.classList.remove('hidden');
    user.classList.add('hidden');
  }
  renderCaterpillar();
}

function authError(msg) {
  const el = $('auth-error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

async function doLogin() {
  authError('');
  try {
    await Auth.login($('in-name').value, $('in-pass').value);
    $('in-pass').value = '';
    renderAuth();
  } catch (e) { authError(e.message); }
}

async function doRegister() {
  authError('');
  try {
    await Auth.register($('in-name').value, $('in-pass').value);
    $('in-pass').value = '';
    renderAuth();
  } catch (e) { authError(e.message); }
}

function doLogout() {
  Auth.logout();
  renderAuth();
}

/* --------------------------------------------------------- Highscores ---- */

function renderScores() {
  const wrap = $('score-list');
  wrap.innerHTML = '';
  const summary = Scores.summary();

  if (Scores.isEmpty(summary)) {
    wrap.innerHTML = '<p class="muted">Noch keine Bestzeiten – spiel eine Runde, ' +
      'dann tauchen deine Highscores hier auf.</p>';
    return;
  }

  for (const g of Object.values(summary)) {
    if (!g.entries.length) continue;
    const box = document.createElement('div');
    box.className = 'score-game';
    const h = document.createElement('h3');
    h.textContent = g.title;
    box.appendChild(h);
    for (const e of g.entries.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `<span class="s-label">${e.label}<small>${e.sub}</small></span>` +
        `<span class="s-val">${e.value}</span>`;
      box.appendChild(row);
    }
    wrap.appendChild(box);
  }
}

/* ------------------------------------------------------- Caterpillars ---- */

function renderCaterpillar() {
  const status = $('cat-status');
  const online = Net.online;
  status.textContent = online
    ? '🟢 Server verbunden'
    : '🟡 Server noch nicht eingerichtet – ihr spielt lokal am selben Gerät (Hotseat). Online-Sessions folgen.';
  status.className = 'cat-status ' + (online ? 'on' : 'off');

  renderSessionList();
}

function renderSessionList() {
  const wrap = $('cat-sessions');
  wrap.innerHTML = '';
  const sessions = Net.listSessions();
  if (!sessions.length) {
    wrap.innerHTML = '<p class="muted">Keine offenen Sessions.</p>';
    return;
  }
  for (const s of sessions) {
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.innerHTML =
      `<span class="c-code">${s.code}</span>` +
      `<span class="c-meta">${s.teams} Teams · ${s.worms} Raupen<small>Host: ${s.host}</small></span>`;
    const play = document.createElement('a');
    play.className = 'c-play';
    play.href = 'wurm.html';
    play.textContent = '▶ Spielen';
    const del = document.createElement('button');
    del.className = 'c-del';
    del.textContent = '✕';
    del.onclick = () => { Net.removeSession(s.code); renderSessionList(); };
    row.appendChild(play);
    row.appendChild(del);
    wrap.appendChild(row);
  }
}

async function createSession() {
  const host = Auth.current() || 'Gast';
  const teams = parseInt($('cat-teams').value, 10) || 2;
  const worms = parseInt($('cat-worms').value, 10) || 3;
  const s = await Net.createSession({ host, teams, worms });
  renderSessionList();
  flash($('cat-created'), `Session ${s.code} erstellt – teile den Code mit deinen Mitspielern.`);
}

async function joinSession() {
  const player = Auth.current() || 'Gast';
  const code = $('cat-code').value;
  const err = $('cat-join-err');
  err.classList.add('hidden');
  try {
    const s = await Net.joinSession(code, player);
    $('cat-code').value = '';
    renderSessionList();
    flash($('cat-created'), `Session ${s.code} beigetreten.`);
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

function flash(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

/* --------------------------------------------------------------- init ---- */

function init() {
  $('btn-login').onclick = doLogin;
  $('btn-register').onclick = doRegister;
  $('btn-logout').onclick = doLogout;
  $('in-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  $('cat-create').onclick = createSession;
  $('cat-join').onclick = joinSession;

  // Falls später ein Server konfiguriert wird, hier verbinden.
  Net.ping().catch(() => {});

  renderAuth();
  renderScores();
}

document.addEventListener('DOMContentLoaded', init);
