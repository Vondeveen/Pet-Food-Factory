import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ORGANS, createOrgan, animateOrgan } from './organs.js';

export const LANE_W = 7.6;
export const Z_START = -15;
export const Z_END = 0;
export const BELT_Y = 1.05;
export const BIN_Z = 4.4;
export const BIN_OFFSETS = [-2.75, -0.92, 0.92, 2.75];
export const laneX = (slot) => (slot - 1.5) * LANE_W;
export const beltState = { distance: 0 };

function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

const toon = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---------------- Worker (Pummel-Party-style bean) ----------------
const apronTex = canvasTex(256, 256, (g) => {
  g.fillStyle = '#f1efe6';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = ['#8a0000', '#a30d0d', '#5e0000'][i % 3];
    g.globalAlpha = 0.6 + Math.random() * 0.4;
    const x = Math.random() * 256; const y = 60 + Math.random() * 196; const r = 4 + Math.random() * 18;
    g.beginPath(); g.ellipse(x, y, r, r * (0.6 + Math.random()), Math.random() * 3, 0, Math.PI * 2); g.fill();
    // drips
    g.fillRect(x - 2, y, 4, Math.random() * 40);
  }
});

export class Worker {
  constructor(color) {
    this.group = new THREE.Group();
    const bodyMat = toon(color, { roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.75, 8, 24), bodyMat);
    body.position.y = 1.25;
    body.castShadow = true;
    this.body = new THREE.Group();
    this.body.add(body);
    this.group.add(this.body);

    const apron = new THREE.Mesh(
      new THREE.CylinderGeometry(0.645, 0.66, 0.95, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
      new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.7, side: THREE.DoubleSide }),
    );
    apron.position.y = 1.05;
    this.body.add(apron);

    const white = toon('#ffffff', { roughness: 0.2 });
    const black = toon('#111111', { roughness: 0.2 });
    for (const sx of [-0.23, 0.23]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), white);
      eye.position.set(sx, 1.62, 0.5);
      eye.scale.z = 0.6;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), black);
      pupil.position.set(sx * 1.02, 1.64, 0.63);
      this.body.add(eye, pupil);
    }
    // Hard hat, pushed back so the face stays visible from the overhead camera.
    const hatMat = toon('#ffc300', { roughness: 0.3 });
    const hat = new THREE.Group();
    hat.position.set(0, 2.02, -0.1);
    hat.rotation.x = -0.3;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
    dome.castShadow = true;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 28), hatMat);
    brim.position.z = 0.06;
    brim.castShadow = true;
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.9), hatMat);
    ridge.position.y = 0.44;
    hat.add(dome, brim, ridge);
    this.body.add(hat);

    // Arms.
    const armGeo = new THREE.CapsuleGeometry(0.14, 0.45, 4, 12);
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.62, 1.45, 0);
      const arm = new THREE.Mesh(armGeo, bodyMat);
      arm.position.y = -0.3;
      arm.castShadow = true;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), toon('#ffe066', { roughness: 0.2 }));
      glove.position.y = -0.62;
      pivot.add(arm, glove);
      pivot.rotation.z = side * 0.25;
      this.body.add(pivot);
      this.arms.push(pivot);
    }
    // Boots.
    for (const sx of [-0.28, 0.28]) {
      const boot = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), toon('#2b2d42'));
      boot.scale.set(1, 0.55, 1.35);
      boot.position.set(sx, 0.13, 0.08);
      boot.castShadow = true;
      this.group.add(boot);
    }
    this.t = Math.random() * 10;
    this.throwT = 0;
    this.sadT = 0;
    this.cheer = false;
  }

  throw() { this.throwT = 0.35; }
  sad() { this.sadT = 0.6; }

  update(dt) {
    this.t += dt;
    const b = this.body;
    let squash = 1 + Math.sin(this.t * 4) * 0.03;
    let hop = 0;
    this.arms[0].rotation.x = Math.sin(this.t * 2) * 0.1;
    this.arms[1].rotation.x = -Math.sin(this.t * 2) * 0.1;
    this.arms[1].rotation.z = 0.25;
    if (this.throwT > 0) {
      this.throwT -= dt;
      const k = this.throwT / 0.35;
      this.arms[1].rotation.z = 0.25 + Math.sin(k * Math.PI) * 2.4;
      squash = 1 - Math.sin(k * Math.PI) * 0.12;
    }
    b.rotation.z = 0;
    if (this.sadT > 0) {
      this.sadT -= dt;
      b.rotation.z = Math.sin(this.sadT * 40) * 0.12;
    }
    if (this.cheer) {
      hop = Math.abs(Math.sin(this.t * 7)) * 1.2;
      this.arms[0].rotation.z = -2.6;
      this.arms[1].rotation.z = 2.6;
    }
    b.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    this.group.position.y = hop;
  }
}

function nameTag(name, color) {
  const tex = canvasTex(512, 128, (g) => {
    g.font = '900 64px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 14;
    g.strokeStyle = '#1a1026';
    g.strokeText(name, 256, 64);
    g.fillStyle = color;
    g.fillText(name, 256, 64);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(3.2, 0.8, 1);
  sp.renderOrder = 5;
  return sp;
}

// ---------------- Shared lane assets ----------------
function hazardTex(repeat) {
  return canvasTex(256, 32, (g) => {
    g.fillStyle = '#111'; g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#ffd60a';
    for (let x = -32; x < 288; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); }
  }, repeat);
}

let beltTex = null;
function binSignTex(i) {
  const o = ORGANS[i];
  return canvasTex(256, 160, (g) => {
    g.fillStyle = o.color;
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = -160; x < 256; x += 40) {
      g.beginPath(); g.moveTo(x, 160); g.lineTo(x + 20, 160); g.lineTo(x + 180, 0); g.lineTo(x + 160, 0); g.fill();
    }
    g.fillStyle = '#1a1026';
    g.beginPath(); g.arc(128, 58, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.font = '900 64px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(o.key, 128, 62);
    g.font = '900 34px "Lilita One", "Arial Black", sans-serif';
    g.lineWidth = 8;
    g.strokeStyle = '#1a1026';
    g.strokeText(o.plural, 128, 130);
    g.fillText(o.plural, 128, 130);
  });
}

export class Lane {
  constructor(scene, slot) {
    this.slot = slot;
    this.cx = laneX(slot);
    this.group = new THREE.Group();
    this.group.position.x = this.cx;
    scene.add(this.group);

    if (!beltTex) {
      beltTex = canvasTex(64, 256, (g, w, h) => {
        g.fillStyle = '#2e2e38';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#3d3d4a';
        for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 12);
        g.fillStyle = 'rgba(120,0,0,0.5)';
        for (let i = 0; i < 6; i++) g.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 10, 4 + Math.random() * 30);
      }, [1, 4]);
    }

    const len = Z_END - Z_START;
    const metal = toon('#8d99ae', { metalness: 0.6, roughness: 0.35 });
    this.trimMat = toon('#888888', { roughness: 0.4 });

    // Belt.
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, len), new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.8 }));
    belt.position.set(0, BELT_Y - 0.1, Z_START + len / 2);
    belt.receiveShadow = true;
    this.group.add(belt);
    box(0.25, 0.35, len, this.trimMat, -1.17, BELT_Y, Z_START + len / 2, this.group);
    box(0.25, 0.35, len, this.trimMat, 1.17, BELT_Y, Z_START + len / 2, this.group);
    for (let z = Z_START + 1; z < Z_END; z += 3) {
      box(0.25, BELT_Y - 0.2, 0.25, metal, -1.1, (BELT_Y - 0.2) / 2, z, this.group);
      box(0.25, BELT_Y - 0.2, 0.25, metal, 1.1, (BELT_Y - 0.2) / 2, z, this.group);
    }

    // Drop chute at the start of the belt.
    const chuteMat = toon('#6c757d', { metalness: 0.4, roughness: 0.4 });
    const chute = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.8, 1.6, 16, 1, true), chuteMat);
    chute.material.side = THREE.DoubleSide;
    chute.position.set(0, 4.6, Z_START + 0.3);
    chute.castShadow = true;
    this.group.add(chute);
    box(0.2, 4, 0.2, metal, -1.2, 2, Z_START - 0.6, this.group);
    box(0.2, 4, 0.2, metal, 1.2, 2, Z_START - 0.6, this.group);

    // Meat grinder at the end of the belt.
    this.grinder = new THREE.Group();
    this.grinder.position.set(0, 0, Z_END + 1.25);
    box(2.6, 0.9, 2.2, toon('#495057', { metalness: 0.5, roughness: 0.4 }), 0, 0.45, 0, this.grinder);
    const hazard = hazardTex([2, 1]);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.3), new THREE.MeshStandardMaterial({ map: hazard }));
    stripe.position.set(0, 0.65, 1.11);
    this.grinder.add(stripe);
    const toothMat = toon('#d9d9d9', { metalness: 0.8, roughness: 0.25 });
    const bloodyTooth = toon('#7a0000', { roughness: 0.2 });
    this.rollers = [];
    for (const side of [-1, 1]) {
      const roller = new THREE.Group();
      roller.position.set(side * 0.45, 0.9, 0);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.2, 16), toon('#343a40', { metalness: 0.6 }));
      drum.rotation.x = Math.PI / 2;
      roller.add(drum);
      const clean = [];
      const bloody = [];
      for (let k = 0; k < 18; k++) {
        const a = (k % 6) / 6 * Math.PI * 2;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * 0.45, Math.sin(a) * 0.45, -0.9 + Math.floor(k / 6) * 0.9),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a - Math.PI / 2)),
          new THREE.Vector3(1, 1, 1),
        );
        (Math.random() < 0.4 ? bloody : clean).push(new THREE.ConeGeometry(0.1, 0.3, 6).applyMatrix4(m));
      }
      if (clean.length) roller.add(new THREE.Mesh(mergeGeometries(clean), toothMat));
      if (bloody.length) roller.add(new THREE.Mesh(mergeGeometries(bloody), bloodyTooth));
      roller.userData.dir = -side;
      this.grinder.add(roller);
      this.rollers.push(roller);
    }
    this.group.add(this.grinder);
    this.grinderShake = 0;

    // Bins.
    this.bins = [];
    for (let i = 0; i < 4; i++) {
      const bg = new THREE.Group();
      bg.position.set(BIN_OFFSETS[i], 0, BIN_Z);
      const c = ORGANS[i].color;
      const binMat = toon(c, { roughness: 0.35 });
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.68, 1.3, 24, 1, true), binMat);
      bin.material.side = THREE.DoubleSide;
      bin.position.y = 0.65;
      bin.castShadow = true;
      bin.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.08, 10, 32), binMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.3;
      const gunk = new THREE.Mesh(new THREE.CircleGeometry(0.78, 24), new THREE.MeshPhysicalMaterial({ color: '#4a0303', roughness: 0.1, clearcoat: 1 }));
      gunk.rotation.x = -Math.PI / 2;
      gunk.position.y = 1.0;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94), new THREE.MeshStandardMaterial({ map: binSignTex(i), roughness: 0.6 }));
      sign.position.set(0, 0.62, 0.84);
      sign.rotation.x = -0.1;
      const icon = createOrgan(i);
      icon.userData.scale = 0.6;
      icon.scale.setScalar(0.6);
      icon.position.y = 2.1;
      bg.add(bin, rim, gunk, sign, icon);
      bg.userData = { icon, shake: 0, hitMesh: bin };
      bin.userData.binIndex = i;
      bin.userData.lane = slot;
      this.group.add(bg);
      this.bins.push(bg);
    }

    // Player colour mat + out-of-order sign.
    this.mat = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), toon('#555', { roughness: 0.9 }));
    this.mat.rotation.x = -Math.PI / 2;
    this.mat.position.set(-2.35, 0.02, -0.8);
    this.mat.receiveShadow = true;
    this.group.add(this.mat);

    this.closedSign = new THREE.Group();
    const signTex = canvasTex(256, 128, (g) => {
      g.fillStyle = '#ffd60a'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#111'; g.fillRect(8, 8, 240, 112);
      g.fillStyle = '#ffd60a';
      g.font = '900 38px "Lilita One", "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.fillText('OUT OF', 128, 56);
      g.fillText('ORDER', 128, 100);
    });
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshStandardMaterial({ map: signTex }));
    plank.position.set(-2.35, 2.0, -0.8);
    plank.rotation.z = 0.12;
    box(0.12, 1.6, 0.12, metal, -2.35, 0.8, -0.85, this.closedSign);
    this.closedSign.add(plank);
    this.group.add(this.closedSign);

    this.worker = null;
    this.tag = null;
    this.playerId = null;
  }

  setPlayer(p) {
    if (p && this.playerId === p.id) return;
    if (this.worker) { this.group.remove(this.worker.group); this.worker = null; }
    if (this.tag) { this.group.remove(this.tag); this.tag = null; }
    this.playerId = p ? p.id : null;
    this.closedSign.visible = !p;
    this.mat.material.color.set(p ? p.color : '#555555');
    this.trimMat.color.set(p ? p.color : '#888888');
    if (!p) return;
    this.worker = new Worker(p.color);
    this.worker.group.position.set(-2.35, 0, -0.8);
    this.worker.group.rotation.y = 0.3;
    this.group.add(this.worker.group);
    this.tag = nameTag(p.name, p.color);
    this.tag.position.set(-2.35, 3.3, -0.8);
    this.group.add(this.tag);
  }

  // World-space point just above a bin's opening.
  binPoint(i) {
    return new THREE.Vector3(this.cx + BIN_OFFSETS[i], 1.25, BIN_Z);
  }

  shakeBin(i, amount = 1) { this.bins[i].userData.shake = amount; }

  update(dt, t) {
    // Belt texture repeats 4x over the belt length; scroll it with the shared belt distance.
    beltTex.offset.y = (beltState.distance / (Z_END - Z_START)) * 4;
    for (const r of this.rollers) r.rotation.z += r.userData.dir * dt * (4 + this.grinderShake * 20);
    if (this.grinderShake > 0) {
      this.grinderShake = Math.max(0, this.grinderShake - dt * 2);
      this.grinder.position.x = (Math.random() - 0.5) * this.grinderShake * 0.3;
    }
    for (const b of this.bins) {
      const u = b.userData;
      animateOrgan(u.icon, t);
      u.icon.rotation.y += dt * 1.2;
      u.icon.position.y = 2.1 + Math.sin(t * 2 + b.position.x) * 0.1;
      if (u.shake > 0) {
        u.shake = Math.max(0, u.shake - dt * 3);
        b.rotation.z = Math.sin(u.shake * 30) * 0.15 * u.shake;
        b.scale.setScalar(1 + u.shake * 0.12);
      }
    }
    if (this.worker) this.worker.update(dt);
  }
}

// ---------------- Factory environment ----------------
export function buildFactory(scene) {
  scene.background = new THREE.Color('#2a1f3d');
  scene.fog = new THREE.Fog('#2a1f3d', 40, 90);

  const hemi = new THREE.HemisphereLight('#cfe8ff', '#5a3d4a', 1.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.position.set(12, 26, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#c77dff', 0.8);
  rim.position.set(-15, 10, -20);
  scene.add(rim);

  // Tiled floor with grime.
  const floorTex = canvasTex(512, 512, (g) => {
    const n = 8; const s = 512 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? '#b8c4d6' : '#a9b6ca';
      g.fillRect(x * s, y * s, s, s);
    }
    g.strokeStyle = '#7c8799'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke();
    }
    // Faint grime and old stains.
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(${70 + Math.random() * 40},${40 + Math.random() * 20},40,${0.05 + Math.random() * 0.08})`;
      g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 512, 10 + Math.random() * 50, 6 + Math.random() * 25, Math.random() * 3, 0, 7); g.fill();
    }
  }, [8, 7]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -6;
  floor.receiveShadow = true;
  scene.add(floor);

  // Back wall with company sign.
  const wallTex = canvasTex(512, 256, (g) => {
    g.fillStyle = '#5b4b8a'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#4a3c73';
    for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 * 32; x < 512; x += 64) g.fillRect(x, y, 60, 28);
  }, [6, 2]);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(70, 18), new THREE.MeshStandardMaterial({ map: wallTex }));
  wall.position.set(0, 9, -21);
  wall.receiveShadow = true;
  scene.add(wall);
  const stripeTex = hazardTex([10, 1]);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(70, 1.2), new THREE.MeshStandardMaterial({ map: stripeTex }));
  stripe.position.set(0, 0.6, -20.95);
  scene.add(stripe);

  const signTex = canvasTex(1024, 256, (g) => {
    g.fillStyle = '#ff4d6d';
    g.beginPath(); g.roundRect(8, 8, 1008, 240, 60); g.fill();
    g.lineWidth = 14; g.strokeStyle = '#1a1026'; g.stroke();
    g.font = '900 108px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 18; g.strokeText('PAWSOME PET FOOD CO.', 512, 112);
    g.fillStyle = '#fff'; g.fillText('PAWSOME PET FOOD CO.', 512, 112);
    g.font = '700 36px "Lilita One", "Arial Black", sans-serif';
    g.fillStyle = '#ffe3ea';
    g.fillText('"Made with 100% real... stuff"', 512, 205);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(20, 5), new THREE.MeshStandardMaterial({ map: signTex, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.25 }));
  sign.position.set(0, 11, -20.8);
  scene.add(sign);

  // Pipes along the wall.
  const pipeMat = toon('#2ec4b6', { metalness: 0.4, roughness: 0.3 });
  for (const [y, r] of [[6.5, 0.35], [7.5, 0.22], [15, 0.5]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 70, 16), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, y, -20.4);
    scene.add(pipe);
  }
  // Hanging lamps.
  const lampMat = toon('#343a40');
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffe066', emissiveIntensity: 2 });
  for (let i = 0; i < 4; i++) {
    const x = laneX(i);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.9, 20, 1, true), lampMat);
    shade.material.side = THREE.DoubleSide;
    shade.position.set(x, 12, -7);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), bulbMat);
    bulb.position.set(x, 11.6, -7);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 8), lampMat);
    cord.position.set(x, 16.4, -7);
    scene.add(shade, bulb, cord);
  }
  // Barrels of "product" for decoration.
  const barrelMat = toon('#e76f51', { roughness: 0.4 });
  for (const [x, z] of [[-17, -17], [-15.6, -18], [17, -16.5], [16, -18.5], [18.2, -18]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.8, 20), barrelMat);
    b.position.set(x, 0.9, z);
    b.castShadow = true;
    scene.add(b);
  }
}

// ---------------- Camera fitting ----------------
// Wide screens see the whole factory; narrow/portrait screens zoom in on your own lane.
export function fitCamera(camera, aspect, focusSlot, mode = 'play') {
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const wide = aspect > 1.15;
  const width = wide ? LANE_W * 4 + 1 : LANE_W + 1.2;
  // Portrait screens have tap buttons along the bottom, so frame a bit more depth and aim closer to the bins.
  const depth = wide ? 18 : 21;
  const tx = wide || focusSlot == null ? 0 : laneX(focusSlot);
  const distH = (width / 2) / Math.tan(hfov / 2);
  const distV = (depth * 0.62) / Math.tan(vfov / 2);
  const dist = Math.max(distH, distV) * (mode === 'menu' ? 1.05 : 1);
  const dir = new THREE.Vector3(0, 1.05, 1).normalize();
  const target = new THREE.Vector3(tx, 0, wide ? -4.5 : -3.2);
  return { pos: target.clone().addScaledVector(dir, dist), target };
}
