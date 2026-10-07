// Serveur : lobbys avec code + simulation des descentes
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const GC = require('./shared/game-core.js');
const { Game } = require('./server/game.js');

const PORT = process.env.PORT || 3000;
const TICK = 1 / 30;
const MAX_PLAYERS = 4;
const COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/three/build')));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = ''; for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)]; } while (rooms.has(c));
  return c;
}

function cleanName(n) {
  return String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Pagayeur';
}

function roomInfo(room) {
  return {
    code: room.code, hostId: room.hostId, phase: room.phase, river: room.river,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, vote: p.vote, pos: p.pos })),
  };
}
function broadcastRoom(room) { io.to(room.code).emit('room', roomInfo(room)); }

function pickRiver(room) {
  const votes = {};
  for (const p of room.players.values()) if (p.vote) votes[p.vote] = (votes[p.vote] || 0) + 1;
  let best = null, bestN = 0;
  for (const id of Object.keys(GC.RIVERS)) {
    const n = votes[id] || 0;
    if (n > bestN) { best = id; bestN = n; }
  }
  const host = room.players.get(room.hostId);
  if (host && host.vote && votes[host.vote] === bestN) best = host.vote; // l'hôte départage
  return best || 'paisible';
}

function stopLoop(room) {
  if (room.loop) clearInterval(room.loop);
  room.loop = null;
}

function startRace(room) {
  room.river = pickRiver(room);
  room.seed = Math.floor(Math.random() * 2 ** 31);
  room.game = new Game(room.river, room.seed, [...room.players.values()]);
  room.phase = 'race';
  io.to(room.code).emit('raceStart', { river: room.river, seed: room.seed });
  broadcastRoom(room);
  let tick = 0;
  stopLoop(room);
  room.loop = setInterval(() => {
    const g = room.game;
    if (!g) return stopLoop(room);
    g.step(TICK);
    tick++;
    if (tick % 2 === 0 || g.over) io.to(room.code).emit('state', g.snapshot());
    if (g.over) {
      room.phase = 'over';
      io.to(room.code).emit('gameover', g.over);
      broadcastRoom(room);
      stopLoop(room);
    }
  }, TICK * 1000);
}

io.on('connection', (socket) => {
  let room = null;

  function joinRoom(r, name) {
    if (r.players.size >= MAX_PLAYERS) return 'Ce lobby est complet (4 pagayeurs max).';
    const used = new Set([...r.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[0];
    const p = { id: socket.id, name: cleanName(name), color, vote: null, pos: null };
    r.players.set(socket.id, p);
    socket.join(r.code);
    room = r;
    if (r.phase !== 'lobby' && r.game) {
      r.game.addPlayer(p, 'lost');
      socket.emit('raceStart', { river: r.river, seed: r.seed });
      if (r.phase === 'over') socket.emit('gameover', r.game.over);
    }
    broadcastRoom(r);
    return null;
  }

  socket.on('create', (data, ack) => {
    if (room || typeof ack !== 'function') return;
    const r = { code: makeCode(), hostId: socket.id, phase: 'lobby', river: 'paisible', players: new Map(), game: null, loop: null };
    rooms.set(r.code, r);
    joinRoom(r, data && data.name);
    ack({ ok: true, code: r.code, id: socket.id });
  });

  socket.on('join', (data, ack) => {
    if (room || typeof ack !== 'function') return;
    const code = String((data && data.code) || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return ack({ ok: false, error: 'Aucun lobby avec ce code.' });
    const err = joinRoom(r, data.name);
    if (err) return ack({ ok: false, error: err });
    ack({ ok: true, code, id: socket.id });
  });

  socket.on('lobbyPos', (pos) => {
    if (!room || !pos) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.pos = { m: pos.m === 'kayak' || pos.m === 'swim' ? pos.m : 'walk', x: +pos.x || 0, d: +pos.d || 0, h: +pos.h || 0 };
    socket.to(room.code).volatile.emit('lobbyPos', { id: socket.id, ...p.pos });
  });

  socket.on('vote', (riverId) => {
    if (!room || !GC.RIVERS[riverId]) return;
    const p = room.players.get(socket.id);
    if (p) { p.vote = riverId; room.river = pickRiver(room); broadcastRoom(room); }
  });

  socket.on('start', () => {
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    startRace(room);
  });

  socket.on('input', (inp) => { if (room && room.game && room.phase === 'race') room.game.setInput(socket.id, inp); });
  socket.on('action', (type) => { if (room && room.game && room.phase === 'race') room.game.action(socket.id, String(type)); });

  socket.on('backToLobby', () => {
    if (!room || room.hostId !== socket.id || room.phase === 'lobby') return;
    stopLoop(room);
    room.game = null;
    room.phase = 'lobby';
    io.to(room.code).emit('toLobby');
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    if (!room) return;
    room.players.delete(socket.id);
    if (room.game) room.game.removePlayer(socket.id);
    if (room.players.size === 0) {
      stopLoop(room);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    io.to(room.code).emit('playerLeft', socket.id);
    broadcastRoom(room);
  });
});

server.listen(PORT, () => console.log(`🛶 Kayak Rush prêt sur http://localhost:${PORT}`));
