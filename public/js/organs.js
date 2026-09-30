import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ORGANS = [
  { name: 'HEART', plural: 'HEARTS', color: '#e63946', key: 'A' },
  { name: 'BRAIN', plural: 'BRAINS', color: '#ff8fab', key: 'S' },
  { name: 'EYEBALL', plural: 'EYEBALLS', color: '#48cae4', key: 'D' },
  { name: 'GUTS', plural: 'GUTS', color: '#f4a261', key: 'F' },
];

// Wet, slimy look: glossy clearcoat over a saturated base colour.
const wet = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08, ...extra,
});

// No environment map in the scene, so keep metalness low and lean on emissive to make gold pop.
const gold = new THREE.MeshPhysicalMaterial({
  color: '#ffd23f', metalness: 0.35, roughness: 0.25, clearcoat: 1, emissive: '#c48a00', emissiveIntensity: 0.7,
});

const M = {
  heart: wet('#8f0d1c'),
  heartFat: wet('#e8c77a', { roughness: 0.6 }),
  artery: wet('#b3122a'),
  vein: wet('#4b3a8c'),
  brain: wet('#e6939c'),
  brainStem: wet('#c9707c'),
  eyeWhite: null, // built lazily (needs canvas texture)
  iris: [wet('#2e86de'), wet('#27ae60'), wet('#8e5b2e'), wet('#d35400')],
  pupil: new THREE.MeshPhysicalMaterial({ color: '#050505', roughness: 0.1, clearcoat: 1 }),
  nerve: wet('#d4747c'),
  guts: wet('#d98572'),
  gutsDark: wet('#a8584a'),
  bile: wet('#7fb33a', { transmission: 0.3 }),
};

function veinyEyeTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f1e8';
  g.fillRect(0, 0, 512, 256);
  // Bloodshot veins creeping from the back of the eye (u=0.75 faces -z, u=0.25 faces +z where the iris is).
  g.strokeStyle = '#c1121f';
  for (let i = 0; i < 40; i++) {
    let x = 384 + (Math.random() - 0.5) * 200;
    let y = Math.random() * 256;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (Math.random() * 30 + 5) * (Math.random() < 0.5 ? -1 : 1);
      y += (Math.random() - 0.5) * 30;
      g.lineTo(x, y);
      g.lineWidth *= 0.8;
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Geometry (built once, shared) ----------
const G = {};
function buildGeometries() {
  G.sphere = new THREE.SphereGeometry(1, 20, 14);
  G.cone = new THREE.ConeGeometry(1, 1, 24);
  G.cyl = new THREE.CylinderGeometry(1, 1, 1, 16);

  // Brain: sphere with folded, wrinkly displacement and a central fissure.
  const brain = new THREE.SphereGeometry(0.5, 64, 40);
  const pos = brain.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let d = 0.035 * Math.sin(v.x * 28 + Math.sin(v.y * 22) * 2) * Math.sin(v.z * 26 + Math.cos(v.x * 18) * 2)
      + 0.02 * Math.sin(v.y * 40 + v.z * 13);
    if (Math.abs(n.x) < 0.07 && n.y > -0.2) d -= 0.09 * (1 - Math.abs(n.x) / 0.07);
    v.addScaledVector(n, d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  brain.computeVertexNormals();
  G.brain = brain;

  // Guts: a coiled pile of intestine with sausage-like bulges.
  const pts = [];
  const N = 60;
  for (let k = 0; k < N; k++) {
    const a = k * 0.55;
    const r = 0.08 + 0.32 * Math.sin((k / N) * Math.PI);
    pts.push(new THREE.Vector3(Math.cos(a) * r, (k / N) * 0.35 + 0.05 * Math.sin(k * 1.3), Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 160, 0.1, 10, false);
  const tp = tube.attributes.position;
  const tn = tube.attributes.normal;
  const radial = 11;
  for (let i = 0; i < tp.count; i++) {
    const seg = Math.floor(i / radial);
    const bulge = 0.035 * Math.sin(seg * 0.9);
    tp.setXYZ(i, tp.getX(i) + tn.getX(i) * bulge, tp.getY(i) + tn.getY(i) * bulge, tp.getZ(i) + tn.getZ(i) * bulge);
  }
  tube.computeVertexNormals();
  G.guts = tube;

  const nerveCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -0.38), new THREE.Vector3(0.05, -0.1, -0.6),
    new THREE.Vector3(-0.05, -0.25, -0.75), new THREE.Vector3(0.08, -0.35, -0.85),
  ]);
  G.nerve = new THREE.TubeGeometry(nerveCurve, 20, 0.06, 8, false);
  G.irisCap = new THREE.SphereGeometry(0.405, 24, 6, 0, Math.PI * 2, 0, 0.55);
  G.pupilCap = new THREE.SphereGeometry(0.41, 24, 4, 0, Math.PI * 2, 0, 0.25);
}

function mesh(geo, mat, golden, { p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0] } = {}) {
  const m = new THREE.Mesh(geo, golden ? gold : mat);
  m.position.set(...p);
  m.scale.set(...s);
  m.rotation.set(...r);
  m.castShadow = true;
  return m;
}

function buildHeart(g) {
  const o = new THREE.Group();
  o.add(mesh(G.sphere, M.heart, g, { p: [0, 0.05, 0], s: [0.42, 0.42, 0.36] }));
  o.add(mesh(G.sphere, M.heart, g, { p: [-0.17, 0.18, 0], s: [0.3, 0.3, 0.28] }));
  o.add(mesh(G.sphere, M.heart, g, { p: [0.17, 0.2, 0], s: [0.28, 0.28, 0.26] }));
  o.add(mesh(G.cone, M.heart, g, { p: [0.02, -0.33, 0], s: [0.34, 0.5, 0.3], r: [Math.PI, 0, 0.15] }));
  o.add(mesh(G.cyl, M.artery, g, { p: [0.06, 0.52, 0], s: [0.1, 0.4, 0.1], r: [0, 0, -0.25] }));
  o.add(mesh(G.cyl, M.vein, g, { p: [-0.14, 0.5, 0.05], s: [0.08, 0.32, 0.08], r: [0.2, 0, 0.3] }));
  o.add(mesh(G.cyl, M.vein, g, { p: [0.25, 0.45, -0.05], s: [0.065, 0.28, 0.065], r: [0, 0, -0.7] }));
  o.add(mesh(G.sphere, M.heartFat, g, { p: [0.08, 0.28, 0.2], s: [0.15, 0.08, 0.1] }));
  o.userData.baseY = 0.42;
  o.userData.pulse = true;
  return o;
}

function buildBrain(g) {
  const o = new THREE.Group();
  o.add(mesh(G.brain, M.brain, g, { s: [0.95, 0.8, 1.15] }));
  o.add(mesh(G.cyl, M.brainStem, g, { p: [0, -0.35, -0.2], s: [0.1, 0.3, 0.1], r: [0.5, 0, 0] }));
  o.userData.baseY = 0.4;
  return o;
}

function buildEye(g) {
  if (!M.eyeWhite) M.eyeWhite = wet('#ffffff', { map: veinyEyeTexture() });
  const o = new THREE.Group();
  o.add(mesh(G.sphere, M.eyeWhite, g, { s: [0.4, 0.4, 0.4] }));
  const irisMat = M.iris[Math.floor(Math.random() * M.iris.length)];
  o.add(mesh(G.irisCap, irisMat, g, { r: [Math.PI / 2, 0, 0] }));
  o.add(mesh(G.pupilCap, M.pupil, g, { r: [Math.PI / 2, 0, 0] }));
  o.add(mesh(G.nerve, M.nerve, g));
  o.userData.baseY = 0.4;
  o.userData.eye = true;
  return o;
}

function buildGuts(g) {
  const o = new THREE.Group();
  o.add(mesh(G.guts, M.guts, g, { p: [0, -0.2, 0], s: [1.15, 1.15, 1.15] }));
  o.add(mesh(G.sphere, M.bile, g, { p: [0.22, 0.12, 0.18], s: [0.11, 0.08, 0.11] }));
  o.add(mesh(G.sphere, M.gutsDark, g, { p: [-0.2, 0.1, -0.15], s: [0.13, 0.1, 0.13] }));
  o.userData.baseY = 0.25;
  o.userData.jiggle = true;
  return o;
}

const builders = [buildHeart, buildBrain, buildEye, buildGuts];

// Each organ type is built once from primitives, then merged into one mesh per material
// so a belt full of organs stays cheap to draw.
const templates = new Map();
function template(type, golden) {
  const key = `${type}:${golden}`;
  if (!templates.has(key)) {
    const src = builders[type](golden);
    src.updateMatrixWorld(true);
    const byMat = new Map();
    for (const m of src.children) {
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      byMat.get(m.material).push(m.geometry.clone().applyMatrix4(m.matrix));
    }
    templates.set(key, {
      parts: [...byMat].map(([mat, geos]) => ({ mat, geo: mergeGeometries(geos), iris: M.iris.includes(mat) })),
      userData: src.userData,
    });
  }
  return templates.get(key);
}

export function createOrgan(type, golden = false) {
  if (!G.sphere) buildGeometries();
  const tpl = template(type, golden);
  const o = new THREE.Group();
  for (const part of tpl.parts) {
    const mat = part.iris ? M.iris[Math.floor(Math.random() * M.iris.length)] : part.mat;
    const m = new THREE.Mesh(part.geo, mat);
    m.castShadow = true;
    o.add(m);
  }
  Object.assign(o.userData, tpl.userData, { type, golden, phase: Math.random() * Math.PI * 2 });
  return o;
}

// Wobbly idle animation shared by belt organs and bin icons.
export function animateOrgan(o, t) {
  const ph = o.userData.phase + t;
  if (o.userData.pulse) {
    const beat = 1 + 0.08 * Math.max(0, Math.sin(ph * 7)) ** 8 + 0.04 * Math.sin(ph * 7);
    o.scale.setScalar(beat * (o.userData.scale || 1));
  } else if (o.userData.jiggle) {
    const s = o.userData.scale || 1;
    o.scale.set(s * (1 + 0.05 * Math.sin(ph * 9)), s * (1 - 0.05 * Math.sin(ph * 9)), s * (1 + 0.05 * Math.sin(ph * 9)));
  }
}
