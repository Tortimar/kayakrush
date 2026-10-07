// Modèles low-poly et utilitaires de rendu
import * as THREE from 'three';

export const toV = (x, d, y = 0) => new THREE.Vector3(x, y, -d);
const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });

export function setupRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function makeScene(sky = 0x9fd8ef) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 90, 210);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
  sun.position.set(-30, 60, 20);
  scene.add(sun);
  return scene;
}

export function makeCamera() {
  const cam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 400);
  return cam;
}

// Caméra vue de dessus légèrement inclinée, regard vers l'aval
export function followCamera(cam, x, d, dt, height = 36, back = 12, ahead = 15, shake = 0) {
  const target = toV(x, d + ahead);
  const desired = toV(x, d - back, height);
  if (!cam.userData.init) { cam.position.copy(desired); cam.userData.init = true; }
  cam.position.lerp(desired, 1 - Math.exp(-6 * dt));
  if (shake > 0) { cam.position.x += (Math.random() - 0.5) * shake; cam.position.z += (Math.random() - 0.5) * shake; }
  cam.lookAt(target.x + (cam.position.x - desired.x), 0, target.z + (cam.position.z - desired.z));
}

// ---------- Eau ----------
export function makeWaterMaterial(c1, c2, speed = 1.5) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uSpeed: { value: speed },
      fogColor: { value: new THREE.Color(0x9fd8ef) }, fogNear: { value: 90 }, fogFar: { value: 210 } },
    vertexShader: `varying vec3 vW; varying float vFog;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uC1; uniform vec3 uC2; uniform float uSpeed; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
      varying vec3 vW; varying float vFog;
      void main(){
        float z = vW.z + uTime * uSpeed * 2.0;
        float a = sin(vW.x * 0.45 + sin(z * 0.11) * 2.0) * sin(z * 0.35 + vW.x * 0.08);
        float b = sin(vW.x * 0.9 - uTime * 0.7 + z * 0.5);
        float rip = smoothstep(0.55, 0.95, a * 0.7 + b * 0.3);
        vec3 col = mix(uC1, uC2, rip * 0.8);
        float f = smoothstep(fogNear, fogFar, vFog);
        gl_FragColor = vec4(mix(col, fogColor, f), 1.0);
      }`,
  });
}

// ---------- Étiquettes ----------
export function makeLabel(text, color = '#ffffff', scale = 1) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px "Baloo 2", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(10,30,48,0.7)';
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 24); g.fill();
  g.fillStyle = color; g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(4 * scale, 1 * scale, 1);
  s.renderOrder = 10;
  return s;
}

export function makeGaugeSprite() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 20;
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.6, 0.4, 1);
  s.renderOrder = 11;
  s.userData = { c, tex, last: -1 };
  return s;
}
export function setGauge(s, ratio) {
  const q = Math.round(ratio * 50);
  if (q === s.userData.last) return;
  s.userData.last = q;
  const g = s.userData.c.getContext('2d');
  g.clearRect(0, 0, 128, 20);
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 128, 20);
  g.fillStyle = ratio > 0.5 ? '#4fc3f7' : ratio > 0.25 ? '#ffd36b' : '#e2483d';
  g.fillRect(3, 3, 122 * Math.max(0, ratio), 14);
  s.userData.tex.needsUpdate = true;
}

// ---------- Personnages ----------
export function makePaddler(color) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.9, 7), mat(color));
  torso.position.y = 0.55;
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.45, 7), mat(0xffb300));
  vest.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat(0xf2c7a5));
  head.position.y = 1.2;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(color));
  helmet.position.y = 1.25;
  g.add(torso, vest, head, helmet);
  // Pagaie double
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 0.08), mat(0x8a5a2b));
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.35), mat(0xfafafa));
  const b2 = b1.clone();
  b1.position.x = 1.75; b2.position.x = -1.75;
  paddle.add(shaft, b1, b2);
  paddle.position.y = 0.85;
  g.add(paddle);
  // Canne à pêche
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 3, 5), mat(0x333333));
  rod.rotation.z = -1.0; rod.position.set(1.2, 1.3, 0);
  rod.visible = false;
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.2, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  line.position.set(2.45, 0.9, 0); line.visible = false;
  g.add(rod, line);
  g.userData = { paddle, rod, line };
  return g;
}

export function makeKayak(hullColor = 0xff7a3d) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), mat(hullColor));
  hull.scale.set(0.95, 0.42, 3.9);
  hull.position.y = 0.05;
  const deck = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfff1d6));
  deck.scale.set(0.8, 0.12, 3.6);
  deck.position.y = 0.2;
  g.add(hull, deck);
  const cockpits = [];
  const GCo = window.GameCore;
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 10), mat(0x222831));
    c.scale.z = 1.3;
    c.position.set(0, 0.28, -GCo.SEAT_OFFSETS[i]);
    g.add(c); cockpits.push(c);
  }
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.6), mat(0x333333));
  rudder.position.set(0, -0.1, 4.0);
  g.add(rudder);
  const holes = [];
  for (let i = 0; i < 2; i++) {
    const h = new THREE.Mesh(new THREE.CircleGeometry(0.28, 7), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    h.rotation.y = i ? -Math.PI / 2 : Math.PI / 2;
    h.position.set(i ? -0.9 : 0.9, 0.08, i ? 1.4 : -1.5);
    h.visible = false;
    g.add(h); holes.push(h);
  }
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.25, depthWrite: false }));
  shield.scale.set(2.2, 1.4, 5); shield.visible = false;
  g.add(shield);
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
  wake.rotation.x = -Math.PI / 2; wake.position.set(0, 0.02, 6.5);
  g.add(wake);
  g.userData = { rudder, holes, shield, wake, seats: [] };
  return g;
}

export function makeSwimmer(color) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), mat(0xf2c7a5));
  head.position.y = 0.3;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(color));
  helmet.position.y = 0.36;
  const vest = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 6, 12), mat(0xffb300));
  vest.rotation.x = Math.PI / 2; vest.position.y = 0.02;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  g.add(head, helmet, vest, ring);
  g.userData.ring = ring;
  return g;
}

export function makeAvatar(color) {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.8, 7), mat(0x2d3e50));
  legs.position.y = 0.4;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.9, 7), mat(color));
  torso.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8), mat(0xf2c7a5));
  head.position.y = 1.95;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 10), mat(color));
  cap.position.y = 2.2;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.3), mat(color));
  visor.position.set(0, 2.16, -0.4);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
  g.add(legs, torso, head, cap, visor, shadow);
  return g;
}

// ---------- Obstacles et décor ----------
export function makeRock(r, seed = 1) {
  const geo = new THREE.IcosahedronGeometry(r, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    const f = 0.8 + (n - Math.floor(n)) * 0.35;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.75, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(0x8d8f93));
  m.position.y = r * 0.15;
  const foam = new THREE.Mesh(new THREE.RingGeometry(r * 0.95, r * 1.35, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2; foam.position.y = 0.04 - r * 0.15;
  m.add(foam);
  return m;
}

export function makeShark() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color: 0x0b2a3a, transparent: true, opacity: 0.45, depthWrite: false }));
  body.scale.set(0.7, 0.2, 2.4); body.position.y = -0.3;
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.3, 3), mat(0x5b6b78));
  fin.scale.z = 0.25; fin.rotation.x = -0.25; fin.position.y = 0.55;
  const foam = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.75, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2; foam.position.y = 0.05;
  g.add(body, fin, foam);
  g.userData = { fin, foam };
  return g;
}

let arrowTex = null;
export function getArrowTexture() {
  if (arrowTex) return arrowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(34, 84); g.lineTo(64, 48); g.lineTo(94, 84); g.stroke();
  arrowTex = new THREE.CanvasTexture(c);
  arrowTex.wrapS = arrowTex.wrapT = THREE.RepeatWrapping;
  return arrowTex;
}

export function makeCurrent(c) {
  const g = new THREE.Group();
  const tex = getArrowTexture();
  const geo = new THREE.CircleGeometry(c.r, 28);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c.r / 3, uv.getY(i) * c.r / 3);
  const disc = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: c.kind === 'rapide' ? 0xbff6ff : 0x9fd4ff, transparent: true, opacity: 0.55, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  const under = new THREE.Mesh(new THREE.CircleGeometry(c.r, 28), new THREE.MeshBasicMaterial({ color: 0x0d4f7a, transparent: true, opacity: 0.2, depthWrite: false }));
  under.rotation.x = -Math.PI / 2; under.position.y = -0.01;
  g.add(under, disc);
  g.rotation.y = Math.atan2(-c.vx, c.vd);
  g.position.copy(toV(c.x, c.d, 0.06));
  return g;
}

export function makeWindZone(w) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(w.r - 0.4, w.r, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
  g.add(ring);
  const streaks = [];
  const sm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
  const ang = Math.atan2(-w.vx, w.vd);
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 3.2), sm);
    s.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(s);
    holder.rotation.y = ang;
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * w.r;
    holder.position.set(Math.cos(a) * rr, 2 + Math.random() * 2, Math.sin(a) * rr);
    g.add(holder); streaks.push(holder);
  }
  g.position.copy(toV(w.x, w.d));
  g.userData = { streaks, dir: new THREE.Vector3(w.vx, 0, -w.vd).normalize(), r: w.r, speed: Math.hypot(w.vx, w.vd) * 3 };
  return g;
}
export function updateWindZone(g, dt) {
  const { streaks, dir, r, speed } = g.userData;
  for (const s of streaks) {
    s.position.addScaledVector(dir, speed * dt);
    if (s.position.x * s.position.x + s.position.z * s.position.z > r * r) {
      s.position.addScaledVector(dir, -2 * r * 0.95);
      s.position.x += (Math.random() - 0.5) * 4; s.position.z += (Math.random() - 0.5) * 4;
    }
  }
}

export function makeFishZone(f) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(f.r - 0.35, f.r, 32), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(f.r, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.22, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.07;
  g.add(ring, disc);
  const fishes = [];
  for (let i = 0; i < 3; i++) {
    const fish = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 4), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8 }));
    fish.rotation.x = Math.PI / 2;
    const h = new THREE.Group(); h.add(fish); h.userData.ph = i * 2.1;
    g.add(h); fishes.push(h);
  }
  g.position.copy(toV(f.x, f.d));
  g.userData = { ring, disc, fishes, r: f.r };
  return g;
}
export function updateFishZone(g, t, depleted) {
  const { ring, disc, fishes, r } = g.userData;
  ring.material.opacity = depleted ? 0.15 : 0.6 + 0.3 * Math.sin(t * 3);
  disc.material.opacity = depleted ? 0.05 : 0.22;
  fishes.forEach((h) => {
    h.visible = !depleted;
    const a = t * 0.8 + h.userData.ph;
    h.position.set(Math.cos(a) * r * 0.55, -0.15, Math.sin(a) * r * 0.55);
    h.rotation.y = -a;
  });
}

export function makePiece(type) {
  const g = new THREE.Group();
  let m;
  if (type === 'pagaie') { m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.3), mat(0x8a5a2b)); }
  else if (type === 'gouvernail') { m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.9), mat(0x333333)); }
  else { m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.1), mat(0xff7a3d)); }
  m.position.y = 0.1;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.45, 20), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  g.add(m, ring);
  g.userData.ring = ring;
  return g;
}

export function makeBuoy(color = 0xff4136) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 10), mat(color));
  b.position.y = 0.4;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.3, 10), mat(0xffffff));
  top.position.y = 0.85;
  g.add(b, top);
  return g;
}

// Arbres instanciés
export function makeTrees(positions, color) {
  const n = positions.length;
  const g = new THREE.Group();
  if (!n) return g;
  const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.5, 6), mat(color), n);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.3, 1.4, 5), mat(0x6b4423), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  positions.forEach((p, i) => {
    s.set(p.s, p.s, p.s);
    m.compose(new THREE.Vector3(p.x, p.y + 0.7 * p.s, p.z), q, s); trunk.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, p.y + 3.4 * p.s, p.z), q, s); cone.setMatrixAt(i, m);
  });
  g.add(cone, trunk);
  return g;
}

export function disposeGroup(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => { if (m.map && m.map !== arrowTex) m.map.dispose(); m.dispose(); });
    }
  });
}
