// Point d'entrée : menu, réseau, bascule lobby <-> descente
import * as M from './models.js';
import { Input } from './input.js';
import { LobbyWorld } from './lobbyWorld.js';
import { RiverWorld } from './riverWorld.js';

const GC = window.GameCore;
const $ = (id) => document.getElementById(id);
const socket = io();
const input = new Input();
const renderer = M.setupRenderer($('view'));

const state = { myId: null, myName: '', room: null, world: null, shake: 0 };
window.__kayak = state; // debug

// ---------- UI utilitaires ----------
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), 3200);
}
function lobbyToast(text, cls) {
  // dans le lobby, les toasts vivent dans le même conteneur (affiché en course) : on réutilise le prompt
  if (state.world instanceof RiverWorld) return toast(text, cls);
  const p = $('prompt');
  p.textContent = text; p.classList.remove('hidden');
  clearTimeout(lobbyToast.t);
  lobbyToast.t = setTimeout(() => { lobbyToast.busy = false; }, 1500);
  lobbyToast.busy = true;
}
const hud = {
  dist: $('dist'), nextCp: $('next-cp'), hullBar: $('hull-bar'), parts: $('parts'), effects: $('effects'),
  windArrow: $('wind-arrow'), windTxt: $('wind-txt'), speed: $('speed'), crew: $('crew'), meBox: $('me-box'),
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ctx = {
  get myId() { return state.myId; },
  get myName() { return state.myName; },
  get myColor() { const p = state.room && state.room.players.find((q) => q.id === state.myId); return p ? p.color : '#ffffff'; },
  hud,
  toast: (t, c) => (state.world instanceof RiverWorld ? toast(t, c) : lobbyToast(t, c)),
  shake: (a) => { state.shake = Math.max(state.shake, a); },
  shakeAmt: () => state.shake,
  prompt: (text) => {
    if (lobbyToast.busy) return;
    const p = $('prompt');
    if (!text) p.classList.add('hidden'); else { p.textContent = text; p.classList.remove('hidden'); }
  },
  openBoard: () => openBoard(),
  sendPos: (pos) => socket.volatile.emit('lobbyPos', pos),
  sendInput: (inp) => socket.emit('input', inp),
  action: (type) => socket.emit('action', type),
  tutoUI: (steps, cur) => {
    show('tuto', !!steps);
    if (!steps) return;
    $('tuto-steps').innerHTML = steps.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'current' : ''}">${s}</li>`).join('');
  },
};

// ---------- Menu ----------
$('name').value = localStorage.getItem('kayak-name') || '';
function setName() {
  state.myName = $('name').value.trim().slice(0, 16) || 'Pagayeur';
  localStorage.setItem('kayak-name', state.myName);
}
function enter(res) {
  if (!res.ok) { $('menu-error').textContent = res.error; return; }
  history.replaceState(null, '', `#${res.code}`);
  show('menu', false);
}
$('btn-create').onclick = () => { setName(); socket.emit('create', { name: $('name').value }, enter); };
$('btn-join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 5) { $('menu-error').textContent = 'Le code fait 5 caractères.'; return; }
  setName();
  socket.emit('join', { code, name: $('name').value }, enter);
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
if (location.hash.length === 6) $('code').value = location.hash.slice(1).toUpperCase();
$('btn-copy').onclick = () => {
  const url = `${location.origin}${location.pathname}#${state.room.code}`;
  navigator.clipboard && navigator.clipboard.writeText(url);
  $('btn-copy').textContent = 'Lien copié !';
  setTimeout(() => ($('btn-copy').textContent = 'Copier'), 1500);
};

// ---------- Lobby ----------
function setWorld(w) {
  if (state.world) state.world.dispose();
  state.world = w;
}
function goLobby() {
  show('hud-race', false); show('over', false); show('hud-lobby', true);
  setWorld(new LobbyWorld(ctx));
  if (state.room) state.world.setRoom(state.room);
}
function renderLobbyHud(room) {
  $('lobby-code').textContent = room.code;
  $('lobby-players').innerHTML = room.players.map((p) =>
    `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === state.myId ? ' (toi)' : ''}<span class="tag">${p.id === room.hostId ? '👑 hôte' : ''}</span></li>`).join('');
  $('lobby-river').textContent = GC.RIVERS[room.river].name;
  const host = room.hostId === state.myId;
  show('btn-start', host);
  show('wait-host', !host);
  show('btn-back', host);
  show('over-wait', !host);
  renderBoard(room);
}
function renderBoard(room) {
  const me = room.players.find((p) => p.id === state.myId);
  $('river-list').innerHTML = Object.entries(GC.RIVERS).map(([id, r]) => {
    const votes = room.players.filter((p) => p.vote === id).map((p) => `<span class="dot" style="background:${p.color}"></span>`).join('');
    const bg = `linear-gradient(160deg, #${r.water.toString(16).padStart(6, '0')}, #${r.grass2.toString(16).padStart(6, '0')})`;
    return `<div class="river ${me && me.vote === id ? 'voted' : ''}" data-id="${id}" style="background:${bg}">
      <h3>${r.name}</h3><div class="stars">${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</div><p>${r.desc}</p><div class="votes">${votes}</div></div>`;
  }).join('');
  document.querySelectorAll('.river').forEach((el) => (el.onclick = () => socket.emit('vote', el.dataset.id)));
}
function openBoard() { show('board', true); }
$('btn-board').onclick = openBoard;
$('btn-board-close').onclick = () => show('board', false);
$('btn-start').onclick = () => socket.emit('start');
$('btn-back').onclick = () => socket.emit('backToLobby');
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') show('board', false); });

// ---------- Réseau ----------
socket.on('connect', () => { state.myId = socket.id; });
socket.on('room', (room) => {
  const first = !state.room;
  state.room = room;
  renderLobbyHud(room);
  if (first && room.phase === 'lobby') goLobby();
  else if (state.world instanceof LobbyWorld) state.world.setRoom(room);
});
socket.on('lobbyPos', (pos) => { if (state.world instanceof LobbyWorld) state.world.onRemotePos(pos); });
socket.on('raceStart', ({ river, seed }) => {
  show('hud-lobby', false); show('board', false); show('over', false); show('hud-race', true);
  $('toasts').innerHTML = '';
  setWorld(new RiverWorld(ctx, river, seed));
  toast(`Descente de ${GC.RIVERS[river].name} — ramez !`, 'good');
});
socket.on('state', (s) => { if (state.world instanceof RiverWorld) state.world.applyState(s); });
socket.on('gameover', (o) => {
  $('over-reason').textContent = o.reason;
  $('over-dist').textContent = `${o.distance} m`;
  const mn = Math.floor(o.time / 60), sec = String(o.time % 60).padStart(2, '0');
  $('over-stats').textContent = `Temps ${mn}:${sec} · ${o.stats.hits} chocs · ${o.stats.ejections} chutes · ${o.stats.catches} prises`;
  setTimeout(() => show('over', true), 900);
});
socket.on('toLobby', goLobby);
socket.on('disconnect', () => { toast('Connexion perdue…', 'bad'); setTimeout(() => location.reload(), 2500); });

// ---------- Boucle de rendu ----------
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (state.world) { state.world.camera.aspect = window.innerWidth / window.innerHeight; state.world.camera.updateProjectionMatrix(); }
});
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.shake = Math.max(0, state.shake - dt * 2.5);
  if (state.world) {
    const boardOpen = !$('board').classList.contains('hidden');
    if (!boardOpen) state.world.update(dt, input); else state.world.update(dt, { hit: () => false, any: () => false, move: () => ({ x: 0, d: 0 }), paddleSide: () => null });
    renderer.render(state.world.scene, state.world.camera);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}
// Décor d'accueil : la rive du lac derrière le menu
setWorld(new LobbyWorld(ctx));
requestAnimationFrame(frame);
