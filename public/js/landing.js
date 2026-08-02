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
  await renderTdHistory();
}

async function doLogin() {
  authError('');
  try { await Auth.login($('in-name').value, $('in-pass').value); $('in-pass').value = ''; await afterAuthChange(); }
  catch (e) { authError(e.message); }
}
async function doRegister() {
  authError('');
  const btn = $('btn-register');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Bot-Check…';
  try {
    await Auth.register($('in-name').value, $('in-pass').value, $('hp-field')?.value || '');
    $('in-pass').value = '';
    await afterAuthChange();
  } catch (e) { authError(e.message); }
  finally { btn.disabled = false; btn.textContent = old; }
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
  wrap.innerHTML = '<h3 class="lb-title">🌍 Bestenliste (alle Spieler) – antippen für die Top 10</h3>';
  if (!board.length) { wrap.innerHTML += '<p class="muted small">Noch keine Einträge – lade deine Bestzeiten mit dem Login hoch.</p>'; return; }
  const me = (Auth.current() || '').toLowerCase();
  // je Spiel und Variante ALLE Spieler einsammeln
  const byGame = {};
  for (const r of board) ((byGame[r.game] ||= {})[r.variant] ||= []).push(r);
  for (const [game, variants] of Object.entries(byGame)) {
    const box = document.createElement('div');
    box.className = 'score-game';
    box.innerHTML = `<h3>${Scores.gameTitle(game)}</h3>`;
    const groups = Object.values(variants);
    groups.sort((a, b) => (a[0].sub || '').localeCompare(b[0].sub || ''));
    for (const rows of groups.slice(0, 8)) {
      const better = rows[0].better;
      rows.sort((a, b) => (better === 'high' ? b.value - a.value : a.value - b.value));
      const top = rows[0];
      const row = document.createElement('div');
      row.className = 'score-row lb-click';
      row.innerHTML = `<span class="s-label">${top.label || top.variant}` +
        `<small>${top.sub || ''} · 👑 ${top.user_name} · ${rows.length} Spieler</small></span>` +
        `<span class="s-val">${fmtValue(top.value, top.better)} <span class="lb-chev">▸</span></span>`;
      const list = document.createElement('div');
      list.className = 'lb-list hidden';
      rows.slice(0, 10).forEach((r, i) => {
        const li = document.createElement('div');
        li.className = 'lb-entry' + (r.user_name.toLowerCase() === me ? ' me' : '');
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        li.innerHTML = `<span>${medal} ${r.user_name}</span><span>${fmtValue(r.value, r.better)}</span>`;
        list.appendChild(li);
      });
      if (rows.length > 10) {
        const more = document.createElement('div');
        more.className = 'lb-entry muted';
        more.textContent = `… und ${rows.length - 10} weitere`;
        list.appendChild(more);
      }
      row.addEventListener('click', () => {
        list.classList.toggle('hidden');
        row.querySelector('.lb-chev').textContent = list.classList.contains('hidden') ? '▸' : '▾';
      });
      box.appendChild(row);
      box.appendChild(list);
    }
    wrap.appendChild(box);
  }
}

/* -------------------------------- Letzte TD-Partien auf der Titelseite ---- */
// Zeigt die Spiel-Historie aus Tower Defense (Slot td_history): eingeloggt
// vom Server (geräteübergreifend), sonst die lokale Historie dieses Browsers.
// Partien mit gespeicherter Voll-Statistik lassen sich aufklappen.
const TD_T = {
  mg: ['🔫', 'MG'], cannon: ['🎯', 'Kanone'], grenade: ['💣', 'Granatkanone'],
  laser: ['📡', 'Laser'], flame: ['🔥', 'Flammenwerfer'], rocket: ['🚀', 'Raketenturm'],
  ice: ['❄️', 'Vereiser'], tesla: ['⚡', 'Blitzturm'], ray: ['☣️', 'Bestrahlungsturm'],
  gift: ['🧪', 'Säureschleuder'], wind: ['🌪️', 'Windmaschine'], gold: ['💰', 'Goldmine'],
  loader: ['⚙️', 'Auto-Lader'], volt: ['🔋', 'Starkstromaggregat'], chem: ['⚗️', 'Chemiefabrik'],
  explo: ['🏭', 'Sprengstofffabrik'], improb: ['🎲', 'Unwahrscheinlichkeitskanone'],
  railgun: ['🧲', 'Railgun'], hypno: ['🌀', 'Hypnoseturm'], tv: ['📺', 'Fernsehturm'],
  command: ['🛰️', 'Kommandozentrale'],
};
const TD_E = {
  blob: ['🟢', 'Blob'], runner: ['🟡', 'Renner'], tank: ['🟣', 'Panzer'],
  regen: ['♻️', 'Regenerierer'], ember: ['🔥', 'Glutläufer'], prisma: ['💎', 'Prisma'],
  blitzer: ['⚡', 'Geerdeter'], boss: ['👹', 'Boss'],
};
function fmtK(v) {
  if (v >= 1e6) return (Math.round(v / 1e5) / 10).toLocaleString('de-DE') + 'M';
  if (v >= 1000) return (Math.round(v / 100) / 10).toLocaleString('de-DE') + 'k';
  return String(Math.round(v || 0));
}
async function renderTdHistory() {
  const wrap = $('score-history');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.classList.add('hidden');
  let runs = null;
  const token = localStorage.getItem('tgl_token');
  if (Auth.serverUp && token) {
    try {
      const r = await fetch('/api/save/td_history', { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) runs = ((await r.json()).save || {}).runs || null;
    } catch { /* egal */ }
  }
  if (!Array.isArray(runs) || !runs.length) {
    try { runs = JSON.parse(localStorage.getItem('td_history') || 'null'); } catch { runs = null; }
  }
  if (!Array.isArray(runs) || !runs.length) return;
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<h3 class="lb-title">🏰 Deine letzten Tower-Defense-Partien – antippen für die Statistik</h3>';
  const DIFF = { leicht: 'Leicht', normal: 'Normal', schwer: 'Schwer' };
  const box = document.createElement('div');
  box.className = 'score-game';
  for (const run of runs.slice(0, 10)) {
    if (!run || typeof run.ts !== 'number') continue;
    const d = new Date(run.ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const top = run.top && TD_T[run.top] ? ' · Top ' + TD_T[run.top][0] : '';
    const hasSt = run.st && Object.keys(run.st.types || {}).length;
    const row = document.createElement('div');
    row.className = 'score-row' + (hasSt ? ' lb-click' : '');
    row.innerHTML = `<span class="s-label">${run.end === 'over' ? '💀' : '🚪'} ${d}` +
      `<small>${DIFF[run.diff] || run.diff} · Welle ${run.wave}${top}</small></span>` +
      `<span class="s-val">💀${run.kills} · 💥${fmtK(run.dmg)}${hasSt ? ' <span class="lb-chev">▸</span>' : ''}</span>`;
    box.appendChild(row);
    if (!hasSt) continue;
    // Aufklappbare Voll-Statistik: Turmarten-Tabelle + Monster-Matrix
    const det = document.createElement('div');
    det.className = 'lb-list hidden';
    const types = Object.keys(run.st.types).sort((a, b) => run.st.types[b].dmg - run.st.types[a].dmg);
    const tn = (k) => { const t = TD_T[k] || ['❓', k]; return `${t[0]} ${t[1]}`; };
    let html = '<div class="stats-wrap"><table class="stats-table"><tr><th>Turmart</th><th>💀 Kills</th><th>💥 Schaden</th></tr>';
    for (const k of types) {
      html += `<tr><td>${tn(k)}</td><td>${run.st.types[k].kills}</td><td>${fmtK(run.st.types[k].dmg)}</td></tr>`;
    }
    html += '</table></div>';
    const vs = run.st.vs || {};
    const killers = types.filter((k) => vs[k] && Object.keys(vs[k]).length);
    const monsters = Object.keys(TD_E).filter((m) => killers.some((k) => vs[k][m]));
    if (killers.length && monsters.length) {
      html += '<div class="stats-wrap"><table class="stats-table"><tr><th></th>'
        + monsters.map((m) => `<th title="${TD_E[m][1]}">${TD_E[m][0]}</th>`).join('') + '</tr>';
      for (const k of killers) {
        html += `<tr><td>${tn(k)}</td>` + monsters.map((m) => `<td>${vs[k][m] || '–'}</td>`).join('') + '</tr>';
      }
      html += '</table></div>';
    }
    det.innerHTML = html;
    row.addEventListener('click', () => {
      det.classList.toggle('hidden');
      row.querySelector('.lb-chev').textContent = det.classList.contains('hidden') ? '▸' : '▾';
    });
    box.appendChild(det);
  }
  box.insertAdjacentHTML('beforeend', '<p class="muted small">💀 Game Over · 🚪 aufgegeben · '
    + 'die Voll-Statistik reist für die letzten 12 Partien mit. Mehr in der 📊-Statistik im Spiel.</p>');
  wrap.appendChild(box);
}

/* ------------------------------------------------------- Caterpillars ---- */

// Warnbanner, wenn der Server ohne echte Datenbank läuft (In-Memory):
// dann überleben Konten, Spielstände & Highscores keinen Neustart/Deploy.
function renderDbWarning() {
  let el = $('db-warn');
  if (!Auth.ephemeral()) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'db-warn';
    el.className = 'db-warn';
    document.querySelector('.lp')?.prepend(el);
  }
  el.innerHTML = '⚠️ <b>Keine Datenbank verbunden</b> – der Server läuft im Übergangs-Modus. '
    + 'Konten, Server-Spielstände und die Bestenliste gehen bei jedem Neustart/Deploy verloren '
    + '(lokale Speicherung im Browser funktioniert weiter). '
    + 'Auf Railway: PostgreSQL-Service hinzufügen und im Spiel-Service die Variable '
    + '<code>DATABASE_URL</code> auf die Postgres-URL setzen.';
}

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
  renderDbWarning();
  if (Auth.serverUp && Auth.isLoggedIn()) await Scores.syncUp();
  await renderLeaderboard();
  await renderTdHistory();
}

document.addEventListener('DOMContentLoaded', init);
