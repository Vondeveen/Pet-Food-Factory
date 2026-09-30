import * as THREE from 'three';
import { ORGANS, createOrgan, animateOrgan } from './organs.js';
import { Lane, buildFactory, fitCamera, BELT_Y, Z_START, Z_END, beltState } from './world.js';
import { Effects } from './fx.js';
import { sfx, unlockAudio, toggleMute } from './audio.js';

// ---------- Tuning (client-only: the server just deals out the organ sequence) ----------
const V0 = 2.3;          // starting belt speed (units/s)
const ACCEL = 0.03;      // belt speeds up over the round
const beltDist = (t) => V0 * t + 0.5 * ACCEL * t * t;
const spawnGap = (t) => Math.max(0.5, 1.45 - t * 0.011);
const FLY_TIME = 0.42;
const DROP_TIME = 0.35;

// ---------- Renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
buildFactory(scene);
const fx = new Effects(scene);
const lanes = [0, 1, 2, 3].map((i) => new Lane(scene, i));

const camGoal = { pos: new THREE.Vector3(0, 30, 20), target: new THREE.Vector3(0, 0, -4) };
const camTarget = new THREE.Vector3(0, 0, -4);
camera.position.copy(camGoal.pos);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateCameraGoal();
}
window.addEventListener('resize', resize);

// ---------- State ----------
const socket = io();
let myId = null;
let room = null;           // latest roomState from server
let game = null;           // current round simulation (real or attract mode)
let clockOffset = 0;

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), lobby: $('lobby'), hud: $('hud'), results: $('results'),
  name: $('nameInput'), code: $('codeInput'), err: $('menuError'),
  roomCode: $('roomCode'), slots: $('slots'), startBtn: $('startBtn'), waitMsg: $('waitMsg'),
  timer: $('timer'), board: $('scoreboard'), countdown: $('countdown'), combo: $('combo'),
  resultList: $('resultList'), resultTitle: $('resultTitle'), againBtn: $('againBtn'), lobbyBtn: $('lobbyBtn'), resultWait: $('resultWait'),
};

function show(screen) {
  for (const s of ['menu', 'lobby', 'hud', 'results']) ui[s].classList.toggle('hidden', s !== screen);
}

function mySlot() {
  const me = room?.players.find((p) => p.id === myId);
  return me ? me.slot : null;
}

function updateCameraGoal() {
  const inGame = game && !game.attract;
  const g = fitCamera(camera, camera.aspect, mySlot(), inGame ? 'play' : 'menu');
  camGoal.pos.copy(g.pos);
  camGoal.target.copy(g.target);
}

// ---------- Round simulation ----------
function makeGame(seq, startAt, duration, attract = false) {
  const spawnTimes = [];
  let t = 0;
  for (let i = 0; i < seq.length; i++) {
    spawnTimes.push(t);
    t += spawnGap(t);
  }
  return {
    seq, startAt, duration, attract, spawnTimes,
    lanes: [0, 1, 2, 3].map(() => ({ organs: new Map(), nextSpawn: 0, resolved: new Set() })),
    myNext: 0,
    countdownShown: 4,
    over: false,
  };
}

function startAttract() {
  const seq = Array.from({ length: 400 }, () => ({ t: Math.floor(Math.random() * 4), g: Math.random() < 0.05 }));
  game = makeGame(seq, Date.now(), Infinity, true);
  // Pre-warm so the belts are already full.
  game.startAt -= 12000;
  updateCameraGoal();
}

function clearOrgans() {
  if (!game) return;
  for (const L of game.lanes) for (const o of L.organs.values()) scene.remove(o.obj);
}

const gameTime = () => (Date.now() + clockOffset - game.startAt) / 1000;
const slotForId = (id) => room?.players.find((p) => p.id === id)?.slot;

function spawnOrgan(slot, i, now) {
  const { t, g } = game.seq[i];
  const obj = createOrgan(t, g);
  obj.rotation.y = Math.random() * Math.PI * 2;
  scene.add(obj);
  const rec = { i, type: t, golden: g, obj, state: 'belt', spawnAt: game.spawnTimes[i], vel: new THREE.Vector3() };
  game.lanes[slot].organs.set(i, rec);
  return rec;
}

function organZ(rec, now) {
  return Z_START + (beltDist(now) - beltDist(rec.spawnAt));
}

function flingOrgan(slot, rec, bin, correct) {
  rec.state = 'fly';
  rec.t0 = 0;
  rec.from = rec.obj.position.clone();
  rec.to = lanes[slot].binPoint(bin);
  rec.bin = bin;
  rec.correct = correct;
  lanes[slot].worker?.throw();
}

function grindOrgan(slot, rec) {
  rec.state = 'grind';
  rec.t0 = 0;
  rec.from = rec.obj.position.clone();
  rec.from.z = Math.min(rec.from.z, Z_END + 0.1);
}

function removeOrgan(slot, rec) {
  scene.remove(rec.obj);
  game.lanes[slot].organs.delete(rec.i);
}

function simulateLane(slot, now, dt) {
  const L = game.lanes[slot];
  const lane = lanes[slot];
  const active = game.attract || lane.playerId;
  const isMine = !game.attract && lane.playerId === myId;
  const reportMiss = (i) => {
    if (isMine && i === game.myNext && !game.over) {
      game.myNext++;
      socket.emit('miss', { index: i });
    }
  };
  // Spawn due organs.
  while (active && L.nextSpawn < game.seq.length && game.spawnTimes[L.nextSpawn] <= now) {
    const i = L.nextSpawn++;
    if (L.resolved.has(i)) continue;
    const rec = spawnOrgan(slot, i, now);
    // Skip organs that would already be past the grinder (attract pre-warm, or the tab was in the background).
    if (organZ(rec, now) > Z_END + 2) {
      removeOrgan(slot, rec);
      L.resolved.add(i);
      reportMiss(i);
    }
  }
  for (const rec of [...L.organs.values()]) {
    const o = rec.obj;
    animateOrgan(o, now);
    if (rec.state === 'belt') {
      const z = organZ(rec, now);
      const age = now - rec.spawnAt;
      const drop = age < DROP_TIME ? 3.4 * (1 - age / DROP_TIME) ** 2 : 0;
      o.position.set(lane.cx + Math.sin(rec.i * 7.3) * 0.25, BELT_Y + o.userData.baseY + drop, z);
      o.rotation.y += dt * 0.6;
      if (o.userData.eye) o.lookAt(camera.position);
      if (z >= Z_END + 0.1) {
        L.resolved.add(rec.i);
        reportMiss(rec.i);
        grindOrgan(slot, rec);
      }
    } else if (rec.state === 'fly') {
      rec.t0 += dt;
      const k = Math.min(1, rec.t0 / FLY_TIME);
      o.position.lerpVectors(rec.from, rec.to, k);
      o.position.y += Math.sin(k * Math.PI) * 3.2;
      o.rotation.x += dt * 14;
      o.rotation.z += dt * 9;
      if (k >= 1) {
        const bp = rec.to;
        lane.shakeBin(rec.bin, rec.correct ? 0.7 : 1);
        if (rec.correct) {
          fx.blood(bp, rec.golden ? 30 : 16, 2.5, 5);
          if (rec.golden) fx.confetti(bp, 30);
          removeOrgan(slot, rec);
        } else {
          fx.blood(bp, 45, 5, 6);
          fx.splat(bp.x, bp.z + 1, 1.2);
          lane.worker?.sad();
          rec.state = 'bounce';
          rec.vel.set((Math.random() - 0.5) * 5, 7, 3 + Math.random() * 2);
        }
      }
    } else if (rec.state === 'bounce') {
      rec.vel.y -= 20 * dt;
      o.position.addScaledVector(rec.vel, dt);
      o.rotation.x += dt * 10;
      if (o.position.y < 0.3) {
        fx.blood(o.position, 20, 3, 2);
        fx.splat(o.position.x, o.position.z, 1);
        removeOrgan(slot, rec);
      }
    } else if (rec.state === 'grind') {
      rec.t0 += dt;
      const k = Math.min(1, rec.t0 / 0.45);
      o.position.set(rec.from.x, rec.from.y + Math.sin(k * Math.PI) * 0.6 - k * 1.2, rec.from.z + k * 1.25);
      o.scale.setScalar(Math.max(0.05, 1 - k * 0.8));
      if (k >= 1) {
        const p = new THREE.Vector3(lane.cx, 1.1, Z_END + 1.25);
        fx.blood(p, rec.golden ? 60 : 40, 3.5, 9);
        lane.grinderShake = 1;
        if (isMine) sfx.grind();
        removeOrgan(slot, rec);
      }
    }
  }
}

// Fling the lead organ on my belt into a bin.
function sortInto(bin) {
  if (!game || game.attract || game.over) return;
  const slot = mySlot();
  if (slot == null) return;
  const now = gameTime();
  if (now < 0 || now > game.duration) return;
  const rec = game.lanes[slot].organs.get(game.myNext);
  if (!rec || rec.state !== 'belt') return;
  const correct = rec.type === bin;
  game.lanes[slot].resolved.add(rec.i);
  game.myNext++;
  socket.emit('sort', { index: rec.i, bin });
  flingOrgan(slot, rec, bin, correct);
  sfx.flick();
  pressFeedback(bin);
  setTimeout(() => {
    if (correct) { sfx.squelch(myCombo); if (rec.golden) sfx.golden(); }
    else sfx.wrong();
  }, FLY_TIME * 1000);
}

let myCombo = 0;

// ---------- Networking ----------
socket.on('connect', () => { myId = socket.id; });

socket.on('roomState', (state) => {
  const prevState = room?.state;
  room = state;
  for (let i = 0; i < 4; i++) lanes[i].setPlayer(room.players.find((p) => p.slot === i) || null);
  renderLobby();
  renderBoard();
  if (room.state === 'lobby') {
    if (prevState !== 'lobby') {
      clearOrgans();
      startAttract();
      for (const l of lanes) if (l.worker) l.worker.cheer = false;
    }
    show('lobby');
  } else if (room.state === 'results' && !ui.menu.classList.contains('hidden')) {
    // Joined while the others are looking at results: wait in the lobby for the next shift.
    show('lobby');
  }
  updateCameraGoal();
});

socket.on('gameStart', ({ seq, startAt, duration, serverNow }) => {
  clockOffset = serverNow - Date.now();
  clearOrgans();
  fx.clearSplats();
  game = makeGame(seq, startAt, duration);
  myCombo = 0;
  for (const l of lanes) if (l.worker) l.worker.cheer = false;
  show('hud');
  updateCameraGoal();
});

socket.on('sorted', ({ id, index, bin, correct, delta, combo, score }) => {
  if (!game || game.attract) return;
  const slot = slotForId(id);
  if (slot == null) return;
  if (id === myId) {
    myCombo = combo;
    const pos = lanes[slot].binPoint(bin).add(new THREE.Vector3(0, 2.2, 0));
    fx.text(delta > 0 ? `+${delta}` : `${delta}`, pos, correct ? '#7CFF6B' : '#ff4d6d', correct && delta >= 30 ? 1.3 : 1);
  } else {
    const L = game.lanes[slot];
    L.resolved.add(index);
    const rec = L.organs.get(index);
    if (rec && rec.state === 'belt') flingOrgan(slot, rec, bin, correct);
  }
  patchPlayer(id, { combo, score });
  renderBoard();
});

socket.on('missed', ({ id, index, combo, score }) => {
  if (!game || game.attract) return;
  const slot = slotForId(id);
  if (slot == null) return;
  if (id === myId) {
    myCombo = 0;
    fx.text('-3', lanes[slot].binPoint(1).setZ(Z_END + 1.2).add(new THREE.Vector3(0.9, 2.5, 0)), '#ff4d6d', 0.9);
  } else {
    const L = game.lanes[slot];
    L.resolved.add(index);
    const rec = L.organs.get(index);
    if (rec && rec.state === 'belt') grindOrgan(slot, rec);
  }
  patchPlayer(id, { combo, score });
  renderBoard();
});

// Keep scoreboard fresh between full roomState updates.
function patchPlayer(id, patch) {
  const p = room?.players.find((x) => x.id === id);
  if (p) Object.assign(p, patch);
}

socket.on('gameOver', ({ results }) => {
  if (game) game.over = true;
  const winner = results[0];
  const tied = results.filter((p) => p.score === winner.score);
  ui.resultTitle.textContent = results.length === 1 ? 'Shift complete!'
    : tied.length > 1 ? `It's a tie! ${tied.map((p) => p.name).join(' & ')} share Employee of the Month!`
      : `${winner.name} is Employee of the Month!`;
  ui.resultList.innerHTML = results.map((p, i) => `
    <li style="--c:${p.color}">
      <span class="place">${['🥇', '🥈', '🥉', '4th'][i]}</span>
      <span class="pname">${escapeHtml(p.name)}</span>
      <span class="pscore">${p.score}</span>
      <span class="pstats">✔ ${p.sorted} sorted · ✘ ${p.wrong} wrong · 🥩 ${p.missed} ground up · best combo ${p.bestCombo}</span>
    </li>`).join('');
  const slot = slotForId(winner.id);
  if (slot != null && lanes[slot].worker) {
    lanes[slot].worker.cheer = true;
    fx.confetti(new THREE.Vector3(lanes[slot].cx - 2.35, 3, -0.8), 150);
  }
  sfx.fanfare();
  setTimeout(() => show('results'), 1200);
});

socket.on('disconnect', () => {
  ui.err.textContent = 'Lost connection to the factory. Refresh to rejoin.';
  room = null;
  show('menu');
});

// ---------- UI ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderLobby() {
  if (!room) return;
  ui.roomCode.textContent = room.code;
  ui.slots.innerHTML = [0, 1, 2, 3].map((i) => {
    const p = room.players.find((x) => x.slot === i);
    if (!p) return '<li class="empty">Waiting for worker…</li>';
    const tags = [p.id === room.hostId ? '👑 Host' : '', p.id === myId ? '(you)' : ''].join(' ');
    return `<li style="--c:${p.color}"><span class="dot"></span>${escapeHtml(p.name)} <small>${tags}</small></li>`;
  }).join('');
  const isHost = room.hostId === myId;
  ui.startBtn.classList.toggle('hidden', !isHost);
  ui.waitMsg.classList.toggle('hidden', isHost);
  ui.againBtn.classList.toggle('hidden', !isHost);
  ui.lobbyBtn.classList.toggle('hidden', !isHost);
  ui.resultWait.classList.toggle('hidden', isHost);
}

function renderBoard() {
  if (!room) return;
  const players = [...room.players].sort((a, b) => a.slot - b.slot);
  ui.board.innerHTML = players.map((p) => {
    const mult = Math.min(5, 1 + Math.floor(p.combo / 5));
    return `<div class="card ${p.id === myId ? 'me' : ''}" style="--c:${p.color}">
      <div class="cname">${escapeHtml(p.name)}</div>
      <div class="cscore">${p.score}</div>
      <div class="ccombo">${p.combo > 1 ? `🔥${p.combo}${mult > 1 ? ` · x${mult}` : ''}` : '&nbsp;'}</div>
    </div>`;
  }).join('');
  const me = room.players.find((p) => p.id === myId);
  if (me) {
    const mult = Math.min(5, 1 + Math.floor(me.combo / 5));
    ui.combo.textContent = me.combo >= 3 ? `COMBO ${me.combo}${mult > 1 ? `  ×${mult}` : ''}` : '';
    ui.combo.classList.remove('bump');
    void ui.combo.offsetWidth;
    if (me.combo >= 3) ui.combo.classList.add('bump');
  }
}

function pressFeedback(bin) {
  const b = document.querySelector(`.binbtn[data-bin="${bin}"]`);
  if (!b) return;
  b.classList.remove('pressed');
  void b.offsetWidth;
  b.classList.add('pressed');
}

const savedName = (() => { try { return localStorage.getItem('pff-name') || ''; } catch { return ''; } })();
ui.name.value = savedName;
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) ui.code.value = urlRoom.toUpperCase();

function saveName() {
  try { localStorage.setItem('pff-name', ui.name.value.trim()); } catch { /* private mode */ }
}

function onJoined(res) {
  if (!res?.ok) { ui.err.textContent = res?.error || 'Something went wrong.'; return; }
  ui.err.textContent = '';
  myId = res.id;
  history.replaceState(null, '', `?room=${res.code}`);
}

$('createBtn').onclick = () => {
  unlockAudio();
  saveName();
  socket.emit('createRoom', { name: ui.name.value }, onJoined);
};
$('joinBtn').onclick = () => {
  unlockAudio();
  saveName();
  if (!ui.code.value.trim()) { ui.err.textContent = 'Enter a factory code first.'; return; }
  socket.emit('joinRoom', { code: ui.code.value, name: ui.name.value }, onJoined);
};
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
ui.startBtn.onclick = () => { unlockAudio(); socket.emit('startGame'); };
ui.againBtn.onclick = () => socket.emit('startGame');
ui.lobbyBtn.onclick = () => socket.emit('backToLobby');
$('copyBtn').onclick = async () => {
  const link = `${location.origin}/?room=${room.code}`;
  try { await navigator.clipboard.writeText(link); $('copyBtn').textContent = 'Copied!'; }
  catch { prompt('Copy this invite link:', link); }
  setTimeout(() => { $('copyBtn').textContent = 'Copy invite link'; }, 1500);
};
$('muteBtn').onclick = () => { $('muteBtn').textContent = toggleMute() ? '🔇' : '🔊'; };

// Bin buttons for touch / mouse.
document.querySelectorAll('.binbtn').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); sortInto(Number(b.dataset.bin)); });
});

const KEYMAP = { a: 0, s: 1, d: 2, f: 3, 1: 0, 2: 1, 3: 2, 4: 3, j: 0, k: 1, l: 2, ';': 3 };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.repeat) return;
  const bin = KEYMAP[e.key.toLowerCase()];
  if (bin !== undefined) sortInto(bin);
});

// Click a bin in the 3D scene.
const raycaster = new THREE.Raycaster();
canvas.addEventListener('pointerdown', (e) => {
  const slot = mySlot();
  if (slot == null || !game || game.attract) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(lanes[slot].bins, true)[0];
  if (!hit) return;
  let o = hit.object;
  while (o && !lanes[slot].bins.includes(o)) o = o.parent;
  if (o) sortInto(lanes[slot].bins.indexOf(o));
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
let ringMesh = null;

function updateHud(now) {
  if (game.attract) return;
  const left = Math.max(0, game.duration - Math.max(0, now));
  ui.timer.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  ui.timer.classList.toggle('urgent', left <= 10 && now > 0);
  if (now < 0) {
    const n = Math.ceil(-now);
    if (n !== game.countdownShown && n <= 3) {
      game.countdownShown = n;
      ui.countdown.textContent = n;
      ui.countdown.className = 'pop';
      sfx.beep(false);
    }
  } else if (game.countdownShown !== 0) {
    game.countdownShown = 0;
    ui.countdown.textContent = 'SORT!';
    ui.countdown.className = 'pop go';
    sfx.beep(true);
    setTimeout(() => { if (game?.countdownShown === 0) ui.countdown.className = 'hidden'; }, 900);
  }
}

function updateLeadRing(now) {
  if (!ringMesh) {
    ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    ringMesh.rotation.x = -Math.PI / 2;
    scene.add(ringMesh);
  }
  const slot = mySlot();
  const rec = game && !game.attract && slot != null ? game.lanes[slot].organs.get(game.myNext) : null;
  if (rec && rec.state === 'belt') {
    ringMesh.visible = true;
    ringMesh.position.set(rec.obj.position.x, BELT_Y + 0.03, rec.obj.position.z);
    ringMesh.scale.setScalar(1 + Math.sin(now * 10) * 0.08);
    ringMesh.material.color.set(room.players.find((p) => p.id === myId)?.color || '#fff');
  } else ringMesh.visible = false;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (game) {
    const now = gameTime();
    if (game.attract && game.lanes[0].nextSpawn >= game.seq.length) { clearOrgans(); startAttract(); }
    const simNow = game.attract ? now : Math.min(now, game.duration + 0.5);
    beltState.distance = beltDist(Math.max(0, simNow));
    for (let s = 0; s < 4; s++) if (simNow >= 0) simulateLane(s, simNow, dt);
    updateHud(now);
    updateLeadRing(t);
  }
  for (const l of lanes) l.update(dt, t);
  fx.update(dt);

  camera.position.lerp(camGoal.pos, 1 - Math.exp(-dt * 3));
  camTarget.lerp(camGoal.target, 1 - Math.exp(-dt * 3));
  if (!game || game.attract) {
    camera.position.x = camGoal.pos.x + Math.sin(t * 0.2) * 3;
  }
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
startAttract();
show('menu');
frame();
