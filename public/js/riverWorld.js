// Monde de la descente : rendu du fleuve procédural et de l'état serveur
import * as THREE from 'three';
import * as M from './models.js';
import { animatePaddler } from './lobbyWorld.js';

const GC = window.GameCore;
const BANK_OFF = [-1.2, 0.6, 3, 12, 30, 70];
const BANK_Y = [-0.8, 0.35, 0.8, 1.2, 1.8, 2.6];
const PART_NAMES = { gouvernail: 'gouvernail', plaque: 'plaque de coque', pagaie: 'pagaie' };

export class RiverWorld {
  constructor(ctx, riverId, seed) {
    this.ctx = ctx;
    this.river = new GC.River(riverId, seed);
    this.cfg = this.river.cfg;
    this.seed = seed;
    this.scene = M.makeScene(0x9fd8ef);
    this.camera = M.makeCamera();
    this.time = 0;
    this.snap = null;
    this.recvAt = 0;
    this.disp = { x: this.river.center(8), d: 8, h: 0 };
    this.chunks = new Map();
    this.swimmers = new Map();
    this.pieces = new Map();
    this.particles = [];
    this.lastInput = null;
    this.inputT = 0;
    this.hudT = 0;

    this.waterMat = M.makeWaterMaterial(this.cfg.water, this.cfg.water2, 1.5);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.scene.add(this.water);

    this.kayak = M.makeKayak(0xff7a3d);
    this.scene.add(this.kayak);
    this.figs = [];
    for (let i = 0; i < 4; i++) this.figs.push({ fig: null, color: null, label: null });

    this.splashGeo = new THREE.SphereGeometry(0.18, 5, 4);
    this.splashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  // ---------- Morceaux de fleuve ----------
  buildChunk(k) {
    const R = this.river, cfg = this.cfg;
    const g = new THREE.Group();
    const d0 = k * GC.CHUNK, d1 = d0 + GC.CHUNK;
    const data = { group: g, winds: [], fish: [], sharks: [] };
    const canyon = R.id === 'gorges';
    const cSand = new THREE.Color(cfg.sand), cG = new THREE.Color(cfg.grass), cG2 = new THREE.Color(cfg.grass2);
    const cols = [cSand, cSand, cG, cG, cG2, cG2];
    for (const side of [-1, 1]) {
      const pos = [], col = [], idx = [];
      const rows = Math.round(GC.CHUNK / 2) + 1;
      for (let i = 0; i < rows; i++) {
        const d = d0 + i * 2;
        const c = R.center(d), hw = R.halfWidth(d);
        BANK_OFF.forEach((o, j) => {
          const y = BANK_Y[j] * (canyon && j >= 2 ? 3.5 + Math.sin(d * 0.07 + j) : 1);
          pos.push(c + side * (hw + o), y, -d);
          const cc = cols[j]; col.push(cc.r, cc.g, cc.b);
        });
      }
      const n = BANK_OFF.length;
      for (let i = 0; i < rows - 1; i++) for (let j = 0; j < n - 1; j++) {
        const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: canyon })));
    }
    // Arbres
    const rnd = GC.mulberry32(GC.hash(this.seed, k + 7000));
    const trees = [];
    const nT = Math.round(36 * cfg.trees);
    for (let i = 0; i < nT; i++) {
      const d = d0 + rnd() * GC.CHUNK, side = rnd() < 0.5 ? -1 : 1;
      const off = 4 + rnd() * 40;
      const y = off < 12 ? 0.8 + (off - 3) / 9 * 0.4 : 1.2 + (off - 12) / 18 * 0.6;
      trees.push({ x: R.center(d) + side * (R.halfWidth(d) + off), y: canyon ? y * 3.5 : y, z: -d, s: 0.7 + rnd() * 0.8 });
    }
    g.add(M.makeTrees(trees, cfg.tree));
    const ch = R.chunk(k);
    for (const r of ch.rocks) { const m = M.makeRock(r.r, r.x + r.d); m.position.add(M.toV(r.x, r.d)); g.add(m); }
    for (const c of ch.currents) g.add(M.makeCurrent(c));
    for (const w of ch.winds) { const m = M.makeWindZone(w); g.add(m); data.winds.push(m); }
    for (const f of ch.fish) { const m = M.makeFishZone(f); g.add(m); data.fish.push({ f, m }); }
    for (const s of ch.sharks) { const m = M.makeShark(); g.add(m); data.sharks.push({ s, m, sink: 0 }); }
    // Poste de secours / départ
    for (let d = Math.ceil(d0 / GC.CHECKPOINT) * GC.CHECKPOINT; d < d1; d += GC.CHECKPOINT) {
      if (d > 0) g.add(this.makeBanner(d, `${d} m`, 0xe2483d));
    }
    if (k === 0) g.add(this.makeBanner(14, 'DÉPART', 0x2bb3a8));
    this.scene.add(g);
    this.chunks.set(k, data);
  }

  makeBanner(d, text, color) {
    const R = this.river, g = new THREE.Group();
    const c = R.center(d), hw = R.halfWidth(d);
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7, 6), m);
      post.position.copy(M.toV(c + s * (hw + 1), d, 3.5)); g.add(post);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2, 1.2, 0.2), new THREE.MeshLambertMaterial({ color }));
    band.position.copy(M.toV(c, d, 6.5)); g.add(band);
    const label = M.makeLabel(text, '#ffffff', 2.2);
    label.position.copy(M.toV(c, d, 8.2)); g.add(label);
    return g;
  }

  ensureChunks() {
    const d = this.disp.d;
    const kMin = Math.floor((d - 70) / GC.CHUNK), kMax = Math.floor((d + 230) / GC.CHUNK);
    for (let k = Math.max(0, kMin); k <= kMax; k++) if (!this.chunks.has(k)) this.buildChunk(k);
    for (const [k, c] of this.chunks) if (k < kMin - 1 || k > kMax + 1) { this.scene.remove(c.group); M.disposeGroup(c.group); this.chunks.delete(k); }
  }

  // ---------- Réseau ----------
  applyState(s) {
    this.snap = s;
    this.recvAt = performance.now();
    for (const e of s.ev || []) this.onEvent(e);
  }

  gameTime() {
    if (!this.snap) return 0;
    return this.snap.t + Math.min(0.3, (performance.now() - this.recvAt) / 1000);
  }

  onEvent(e) {
    const me = this.ctx.myId, T = (t, c) => this.ctx.toast(t, c);
    const k = this.snap.k;
    switch (e.type) {
      case 'hit': T(e.src === 'rive' ? 'Choc contre la rive !' : 'Choc contre un rocher !', 'bad'); this.ctx.shake(Math.min(1.5, e.power * 0.3)); this.splash(k.x, k.d, 14); break;
      case 'eject': T(e.id === me ? 'Tu es tombé ! Nage vers le kayak et appuie sur E' : `${e.name} est tombé à l'eau !`, 'bad'); this.splash(k.x, k.d, 10); break;
      case 'jump': T(`${e.name} plonge !`); break;
      case 'climb': T(`${e.name} remonte à bord`, 'good'); break;
      case 'grab': T(`${e.name} a récupéré : ${PART_NAMES[e.part]}`, 'good'); break;
      case 'lost': T(e.id === me ? 'Emporté par le courant… tu reviendras au prochain poste de secours' : `${e.name} est emporté par le courant…`, 'bad'); break;
      case 'catch': { const it = GC.ITEMS[e.item]; T(`${e.name} pêche : ${it.icon} ${it.label}`, e.good ? 'good' : 'bad'); break; }
      case 'shield': T('🛡️ Le bouclier absorbe le choc !', 'good'); break;
      case 'shark': T('🦈 Attaque de requin !', 'bad'); this.ctx.shake(1.2); this.splash(k.x, k.d, 16); break;
      case 'bite': T(`🦈 ${e.name} se fait mordiller !`, 'bad'); break;
      case 'checkpoint': T(`🏁 Poste de secours ${e.dist} m${e.saved ? ` — ${e.saved} pagayeur(s) repêché(s)` : ''}`, 'good'); break;
      case 'part_lost': T(e.text + ' Repêchez-la !', 'bad'); break;
      case 'part_back': T(e.text, 'good'); break;
      default: if (e.text) T(e.text);
    }
  }

  splash(x, d, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.splashGeo, this.splashMat);
      m.position.copy(M.toV(x + (Math.random() - 0.5) * 3, d + (Math.random() - 0.5) * 5, 0.3));
      m.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 5, (Math.random() - 0.5) * 6), life: 0.9 };
      this.scene.add(m); this.particles.push(m);
    }
  }

  // ---------- Boucle ----------
  update(dt, input) {
    this.time += dt;
    this.waterMat.uniforms.uTime.value = this.time;
    const s = this.snap;
    if (!s) { M.followCamera(this.camera, this.disp.x, this.disp.d, dt); this.ensureChunks(); return; }
    const gt = this.gameTime();
    const e = Math.min(0.25, (performance.now() - this.recvAt) / 1000);
    const k = s.k;
    const px = k.x + k.vx * e, pd = k.d + k.vd * e, ph = k.h + k.av * e;
    const a = 1 - Math.exp(-12 * dt);
    this.disp.x += (px - this.disp.x) * a; this.disp.d += (pd - this.disp.d) * a; this.disp.h += (ph - this.disp.h) * a;
    this.ensureChunks();

    // Kayak
    const speed = Math.hypot(k.vx, k.vd);
    this.kayak.position.copy(M.toV(this.disp.x, this.disp.d, 0.25 + Math.sin(this.time * 2.2) * 0.06));
    this.kayak.rotation.y = -this.disp.h;
    this.kayak.rotation.z = Math.sin(this.time * 1.7) * 0.03 + k.av * 0.05;
    const ud = this.kayak.userData;
    ud.rudder.visible = k.rudder;
    ud.holes[0].visible = k.plates < 2; ud.holes[1].visible = k.plates < 1;
    ud.shield.visible = s.fx.shield > 0;
    ud.wake.material.opacity = Math.min(0.45, speed * 0.05);
    const bySeat = {};
    for (const p of s.p) if (p.st === 'seat') bySeat[p.seat] = p;
    this.figs.forEach((slot, i) => {
      const p = bySeat[i];
      if (p && slot.color !== p.color) {
        if (slot.fig) { this.kayak.remove(slot.fig); M.disposeGroup(slot.fig); }
        slot.fig = M.makePaddler(p.color); slot.color = p.color;
        slot.fig.position.set(0, 0.15, -GC.SEAT_OFFSETS[i]);
        this.kayak.add(slot.fig);
      }
      if (slot.fig) {
        slot.fig.visible = !!p;
        if (p) animatePaddler(slot.fig, gt - p.ls, p.side, p.fish, p.pad);
      }
    });

    // Nageurs
    const seen = new Set();
    for (const p of s.p) {
      if (p.st !== 'water') continue;
      seen.add(p.id);
      let sw = this.swimmers.get(p.id);
      if (!sw) {
        const g = M.makeSwimmer(p.color);
        const gauge = M.makeGaugeSprite(); gauge.position.y = 1.6;
        const label = M.makeLabel(p.name, '#ffffff', 0.7); label.position.y = 2.3;
        g.add(gauge, label);
        g.position.copy(M.toV(p.x, p.d));
        this.scene.add(g);
        sw = { g, gauge };
        this.swimmers.set(p.id, sw);
        this.splash(p.x, p.d, 8);
      }
      const want = M.toV(p.x, p.d, Math.sin(this.time * 4 + p.seat) * 0.08);
      sw.g.position.lerp(want, 1 - Math.exp(-10 * dt));
      sw.g.userData.ring.scale.setScalar(1 + (this.time * 1.5 % 1) * 0.6);
      sw.g.userData.ring.material.opacity = 0.5 * (1 - (this.time * 1.5 % 1));
      M.setGauge(sw.gauge, p.g / p.gm);
    }
    for (const [id, sw] of this.swimmers) if (!seen.has(id)) { this.scene.remove(sw.g); M.disposeGroup(sw.g); this.swimmers.delete(id); }

    // Pièces à la dérive
    const pcSeen = new Set();
    for (const pc of s.pc) {
      pcSeen.add(pc.id);
      let g = this.pieces.get(pc.id);
      if (!g) { g = M.makePiece(pc.type); g.position.copy(M.toV(pc.x, pc.d)); this.scene.add(g); this.pieces.set(pc.id, g); }
      g.position.lerp(M.toV(pc.x, pc.d, Math.sin(this.time * 3 + pc.id) * 0.1), 1 - Math.exp(-8 * dt));
      g.rotation.y += dt * 0.6;
      g.userData.ring.material.opacity = 0.5 + 0.4 * Math.sin(this.time * 6);
    }
    for (const [id, g] of this.pieces) if (!pcSeen.has(id)) { this.scene.remove(g); M.disposeGroup(g); this.pieces.delete(id); }

    // Obstacles animés
    const sc = new Set(s.sc);
    for (const c of this.chunks.values()) {
      for (const w of c.winds) M.updateWindZone(w, dt);
      for (const { f, m } of c.fish) M.updateFishZone(m, this.time, (s.fu[f.id] || 0) >= 2);
      for (const sh of c.sharks) {
        const p = this.river.sharkPos(sh.s, gt);
        sh.sink += ((sc.has(sh.s.id) ? 1 : 0) - sh.sink) * Math.min(1, 3 * dt);
        sh.m.position.copy(M.toV(p.x, p.d, -sh.sink * 1.6));
        sh.m.rotation.y = -p.h;
      }
    }
    M.getArrowTexture().offset.y -= dt * 1.2;

    // Particules
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const m = this.particles[i];
      m.userData.life -= dt;
      m.userData.v.y -= 18 * dt;
      m.position.addScaledVector(m.userData.v, dt);
      if (m.userData.life <= 0 || m.position.y < -0.5) { this.scene.remove(m); this.particles.splice(i, 1); }
    }

    this.handleInput(dt, input);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }

    this.water.position.set(Math.round(this.camera.position.x), 0, Math.round(this.camera.position.z) - 40);
    M.followCamera(this.camera, this.disp.x, this.disp.d, dt, 36, 9, 10, this.ctx.shakeAmt());
  }

  me() { return this.snap && this.snap.p.find((p) => p.id === this.ctx.myId); }

  handleInput(dt, input) {
    const me = this.me();
    if (!me) return;
    let inp;
    if (me.st === 'seat') {
      if (input.hit('f')) this.ctx.action('fish');
      if (input.hit(' ')) this.ctx.action('jump');
      inp = { paddle: input.paddleSide(), swim: { x: 0, d: 0 } };
    } else if (me.st === 'water') {
      if (input.hit('e')) this.ctx.action('climb');
      inp = { paddle: null, swim: input.move() };
    } else inp = { paddle: null, swim: { x: 0, d: 0 } };
    const key = JSON.stringify(inp);
    this.inputT -= dt;
    if (key !== this.lastInput || this.inputT <= 0) { this.ctx.sendInput(inp); this.lastInput = key; this.inputT = 0.25; }
  }

  updateHud() {
    const s = this.snap, k = s.k, H = this.ctx.hud;
    H.dist.textContent = `${Math.floor(k.d)} m`;
    H.nextCp.textContent = `Poste de secours dans ${Math.ceil(GC.CHECKPOINT - (k.d % GC.CHECKPOINT))} m`;
    H.hullBar.style.width = `${k.hull}%`;
    H.hullBar.style.background = k.hull > 60 ? '#3ab26b' : k.hull > 30 ? '#f0a43a' : '#e2483d';
    const paddles = s.p.filter((p) => p.pad).length;
    H.parts.innerHTML = [
      `<span class="${k.rudder ? '' : 'bad'}">Gouvernail ${k.rudder ? '✓' : '✗'}</span>`,
      `<span class="${k.plates === 2 ? '' : 'bad'}">Coque ${k.plates}/2${k.plates < 2 ? ' 💧fuite' : ''}</span>`,
      `<span class="${paddles === s.p.length ? '' : 'bad'}">Pagaies ${paddles}/${s.p.length}</span>`,
    ].join('');
    const fxs = [['turbo', '⚡ Turbo', 0], ['shield', '🛡️ Bouclier', 0], ['anvil', '⚓ Enclume', 1], ['invert', '🔄 Inversé', 1], ['storm', '🌪️ Tempête', 1]];
    H.effects.innerHTML = fxs.filter(([id]) => s.fx[id] > 0).map(([id, l, bad]) => `<span class="${bad ? 'bad' : ''}">${l} ${Math.ceil(s.fx[id])}s</span>`).join('');
    const ws = Math.hypot(s.w.x, s.w.d);
    H.windArrow.style.transform = `rotate(${(Math.atan2(s.w.x, s.w.d) * 180) / Math.PI - 90}deg)`;
    H.windArrow.style.opacity = ws < 0.3 ? 0.3 : 1;
    H.windTxt.textContent = `Vent ${ws.toFixed(1)} m/s`;
    H.speed.textContent = `${Math.round(Math.hypot(k.vx, k.vd) * 3.6)} km/h`;
    H.crew.innerHTML = s.p.map((p) => {
      const st = p.st === 'seat' ? (p.fish ? '🎣 pêche' : p.rowing ? '🚣 rame' : '🛶 à bord') : p.st === 'water' ? '' : '💀 emporté';
      const g = p.st === 'water' ? `<span class="gbar"><i style="width:${(p.g / p.gm) * 100}%"></i></span>` : `<span class="tag">${st}</span>`;
      return `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${p.id === this.ctx.myId ? ' (toi)' : ''}${p.pad ? '' : ' ✋'}${g}</li>`;
    }).join('');
    const me = this.me();
    let html = '';
    if (me) {
      if (me.st === 'water') {
        const near = GC.kayakSegDist(k, me.x, me.d).dist < 2.8;
        html = `${near ? 'E : remonter !' : 'Nage vers le kayak'}${me.carry ? ` — tu portes : ${PART_NAMES[me.carry]}` : ''}<div class="gauge"><i style="width:${(me.g / me.gm) * 100}%"></i></div>`;
      } else if (me.st === 'lost') {
        html = `Emporté… retour à bord au prochain poste de secours (${Math.ceil(GC.CHECKPOINT - (k.d % GC.CHECKPOINT))} m)`;
      } else if (me.fish) {
        html = `🎣 Mode pêche${me.fp > 0 ? ' — ça mord…' : ' — passe sur une zone dorée'} (F pour ranger)`;
      } else if (!me.pad) {
        html = '✋ Sans pagaie : tu rames à la main (repêche-la !)';
      }
    }
    if (H.meBox.innerHTML !== html) H.meBox.innerHTML = html;
  }

  dispose() {
    for (const c of this.chunks.values()) M.disposeGroup(c.group);
    M.disposeGroup(this.scene);
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
