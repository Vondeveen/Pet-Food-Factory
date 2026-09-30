const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 90;
const COUNTDOWN_MS = 4000;
const SEQ_LENGTH = 400;
const ORGAN_TYPES = 4; // 0 heart, 1 brain, 2 eyeball, 3 guts
const COLORS = ['#ff4d6d', '#4dabff', '#5ce65c', '#ffd23f'];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeSequence() {
  const seq = [];
  let last = -1;
  let run = 0;
  for (let i = 0; i < SEQ_LENGTH; i++) {
    let t = Math.floor(Math.random() * ORGAN_TYPES);
    // Avoid long boring streaks of the same organ.
    if (t === last && run >= 2) t = (t + 1 + Math.floor(Math.random() * (ORGAN_TYPES - 1))) % ORGAN_TYPES;
    run = t === last ? run + 1 : 0;
    last = t;
    seq.push({ t, g: i > 3 && Math.random() < 0.06 });
  }
  return seq;
}

function cleanName(name) {
  const n = String(name || '').replace(/[^\w \-!?.']/g, '').trim().slice(0, 14);
  return n || 'Worker';
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color, slot: p.slot,
    score: p.score, combo: p.combo, next: p.next,
    sorted: p.sorted, wrong: p.wrong, missed: p.missed, bestCombo: p.bestCombo,
  };
}

function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    players: [...room.players.values()].map(publicPlayer),
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomState', roomState(room));
}

function freeSlot(room) {
  const used = new Set([...room.players.values()].map((p) => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function addPlayer(room, socket, name) {
  const slot = freeSlot(room);
  const p = {
    id: socket.id, name: cleanName(name), slot, color: COLORS[slot],
    score: 0, combo: 0, bestCombo: 0, next: 0, sorted: 0, wrong: 0, missed: 0,
  };
  room.players.set(socket.id, p);
  socket.join(room.code);
  socket.data.room = room.code;
  return p;
}

function resetScores(room) {
  for (const p of room.players.values()) {
    Object.assign(p, { score: 0, combo: 0, bestCombo: 0, next: 0, sorted: 0, wrong: 0, missed: 0 });
  }
}

function startRound(room) {
  resetScores(room);
  room.state = 'playing';
  room.seq = makeSequence();
  room.startAt = Date.now() + COUNTDOWN_MS;
  room.endAt = room.startAt + ROUND_SECONDS * 1000;
  io.to(room.code).emit('gameStart', {
    seq: room.seq,
    startAt: room.startAt,
    duration: ROUND_SECONDS,
    serverNow: Date.now(),
  });
  broadcastRoom(room);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endRound(room), room.endAt - Date.now() + 300);
}

function endRound(room) {
  if (room.state !== 'playing') return;
  room.state = 'results';
  const results = [...room.players.values()]
    .map(publicPlayer)
    .sort((a, b) => b.score - a.score);
  io.to(room.code).emit('gameOver', { results });
  broadcastRoom(room);
}

function multiplier(combo) {
  return Math.min(5, 1 + Math.floor(combo / 5));
}

io.on('connection', (socket) => {
  const getRoom = () => rooms.get(socket.data.room);

  socket.on('createRoom', ({ name } = {}, ack) => {
    if (socket.data.room) return;
    const room = {
      code: makeCode(), hostId: socket.id, state: 'lobby',
      players: new Map(), seq: [], startAt: 0, endAt: 0, timer: null,
    };
    rooms.set(room.code, room);
    addPlayer(room, socket, name);
    ack?.({ ok: true, code: room.code, id: socket.id });
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, name } = {}, ack) => {
    if (socket.data.room) return;
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return ack?.({ ok: false, error: 'No factory with that code.' });
    if (room.players.size >= MAX_PLAYERS) return ack?.({ ok: false, error: 'That factory is full (4 workers max).' });
    if (room.state === 'playing') return ack?.({ ok: false, error: 'A shift is in progress. Try again in a minute!' });
    addPlayer(room, socket, name);
    ack?.({ ok: true, code: room.code, id: socket.id });
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id || room.state === 'playing') return;
    startRound(room);
  });

  socket.on('backToLobby', () => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id || room.state !== 'results') return;
    room.state = 'lobby';
    resetScores(room);
    broadcastRoom(room);
  });

  // A player flung their lead organ (index) into a bin.
  socket.on('sort', ({ index, bin } = {}) => {
    const room = getRoom();
    if (!room || room.state !== 'playing' || Date.now() > room.endAt) return;
    const p = room.players.get(socket.id);
    if (!p || index !== p.next || !Number.isInteger(bin) || bin < 0 || bin >= ORGAN_TYPES) return;
    const organ = room.seq[index];
    if (!organ) return;
    p.next++;
    let delta;
    const correct = organ.t === bin;
    if (correct) {
      p.combo++;
      p.bestCombo = Math.max(p.bestCombo, p.combo);
      p.sorted++;
      delta = 10 * multiplier(p.combo) * (organ.g ? 3 : 1);
    } else {
      p.combo = 0;
      p.wrong++;
      delta = -5;
    }
    p.score += delta;
    io.to(room.code).emit('sorted', { id: p.id, index, bin, correct, delta, score: p.score, combo: p.combo });
  });

  // An organ reached the end of the player's belt and fell into the grinder.
  socket.on('miss', ({ index } = {}) => {
    const room = getRoom();
    if (!room || room.state !== 'playing' || Date.now() > room.endAt) return;
    const p = room.players.get(socket.id);
    if (!p || index !== p.next) return;
    p.next++;
    p.combo = 0;
    p.missed++;
    p.score -= 3;
    io.to(room.code).emit('missed', { id: p.id, index, delta: -3, score: p.score, combo: 0 });
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    io.to(room.code).emit('playerLeft', { id: socket.id });
    broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Pet Food Factory running on http://localhost:${PORT}`);
});
