import * as THREE from 'three';

const MAX_PARTICLES = 1200;
const MAX_DECALS = 300;
const GRAVITY = -18;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // Blood droplets / confetti share one instanced mesh.
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, size: 0, stain: false, color: new THREE.Color() });
      this.mesh.setColorAt(i, this.particles[i].color);
    }
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    scene.add(this.mesh);

    // Floor splatters.
    this.decalMat = new THREE.MeshPhysicalMaterial({
      color: '#5c0000', roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.92, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.decalGeo = new THREE.CircleGeometry(1, 14);
    // Make the splat blobby rather than a perfect circle.
    const dp = this.decalGeo.attributes.position;
    for (let i = 1; i < dp.count; i++) {
      const k = 0.75 + Math.random() * 0.5;
      dp.setXY(i, dp.getX(i) * k, dp.getY(i) * k);
    }
    this.decals = new THREE.InstancedMesh(this.decalGeo, this.decalMat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    this.decalCursor = 0;
    scene.add(this.decals);

    this.texts = [];
  }

  spawn(pos, vel, { color = '#8a0000', size = 0.08, life = 1.6, stain = true } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    const pt = this.particles[i];
    pt.alive = true;
    pt.p.copy(pos);
    pt.v.copy(vel);
    pt.life = life;
    pt.size = size;
    pt.stain = stain;
    pt.color.set(color);
  }

  blood(pos, count = 30, power = 5, up = 5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * power;
      const shade = ['#8a0000', '#b00012', '#5e0000', '#c21e1e'][i % 4];
      this.spawn(pos, new THREE.Vector3(Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s),
        { color: shade, size: 0.04 + Math.random() * 0.09, life: 1.5 + Math.random() });
    }
  }

  goo(pos, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(pos, new THREE.Vector3(Math.cos(a) * 2, 3 + Math.random() * 3, Math.sin(a) * 2),
        { color, size: 0.05 + Math.random() * 0.06, life: 1, stain: false });
    }
  }

  confetti(pos, count = 80) {
    const cols = ['#ff4d6d', '#4dabff', '#5ce65c', '#ffd23f', '#ffffff', '#c77dff'];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 5;
      this.spawn(pos, new THREE.Vector3(Math.cos(a) * s, 8 + Math.random() * 6, Math.sin(a) * s),
        { color: cols[i % cols.length], size: 0.08 + Math.random() * 0.06, life: 3, stain: false });
    }
  }

  splat(x, z, size = 1) {
    const d = this.dummy;
    d.position.set(x, 0.012 + Math.random() * 0.004, z);
    d.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    d.scale.set(size * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), 1);
    d.updateMatrix();
    d.rotation.set(0, 0, 0);
    this.decals.setMatrixAt(this.decalCursor, d.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    this.decals.count = Math.max(this.decals.count, this.decalCursor === 0 ? MAX_DECALS : this.decalCursor);
  }

  clearSplats() {
    this.decals.count = 0;
    this.decalCursor = 0;
  }

  text(str, pos, color = '#ffffff', scale = 1) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.font = '900 72px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 12;
    g.strokeStyle = '#1a1026';
    g.strokeText(str, 128, 64);
    g.fillStyle = color;
    g.fillText(str, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.position.copy(pos);
    sp.scale.set(2.4 * scale, 1.2 * scale, 1);
    sp.renderOrder = 10;
    this.scene.add(sp);
    this.texts.push({ sp, life: 1.2, base: scale });
  }

  update(dt) {
    // Only live particles are packed into the instanced mesh and drawn.
    const d = this.dummy;
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.alive) continue;
      pt.life -= dt;
      pt.v.y += GRAVITY * dt;
      pt.p.addScaledVector(pt.v, dt);
      if (pt.p.y < pt.size) {
        if (pt.stain && Math.random() < 0.25) this.splat(pt.p.x, pt.p.z, 0.15 + pt.size * 3);
        if (pt.stain) pt.alive = false;
        else { pt.p.y = pt.size; pt.v.set(pt.v.x * 0.5, -pt.v.y * 0.3, pt.v.z * 0.5); }
      }
      if (pt.life <= 0) pt.alive = false;
      if (!pt.alive) continue;
      d.position.copy(pt.p);
      d.scale.setScalar(pt.size * Math.min(1, pt.life * 3));
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.mesh.setColorAt(n, pt.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.sp.position.y += dt * 1.8;
      const pop = t.life > 1.0 ? 1 + (t.life - 1.0) * 3 : 1;
      t.sp.scale.set(2.4 * t.base * pop, 1.2 * t.base * pop, 1);
      t.sp.material.opacity = Math.min(1, t.life * 2);
      if (t.life <= 0) {
        this.scene.remove(t.sp);
        t.sp.material.map.dispose();
        t.sp.material.dispose();
        this.texts.splice(i, 1);
      }
    }
  }
}
