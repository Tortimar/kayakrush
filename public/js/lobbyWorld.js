// Monde du lobby : rive, lac de tutoriel, tableau des fleuves
import * as THREE from 'three';
import * as M from './models.js';

const GC = window.GameCore;
const LAKE_R = 55;
const PIER = { x0: -1.5, x1: 1.5, d0: -60, d1: -46 };
const BOARD = { x: 9, d: -66 };
const PIER_END = { x: 0, d: -47 };

const TUTO = [
  'Rame à gauche (Q / A / ←) : le kayak tourne à droite',
  'Rame à droite (D / →) : le kayak tourne à gauche',
  'Alterne gauche/droite pour filer tout droit jusqu’à la bouée jaune',
  'Traverse la zone de courant (flèches bleues) : elle te pousse',
  'Mode pêche (F) dans la zone dorée et attends une prise',
  'Saute à l’eau (Espace), nage (ZQSD/WASD) puis remonte (E) près du kayak',
  'Bravo ! Reviens au ponton et appuie sur E pour sortir',
];

export class LobbyWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = M.makeScene(0xa8dcf0);
    this.camera = M.makeCamera();
    this.time = 0;
    this.me = { x: 0, d: -68, h: 0, mode: 'walk' };
    this.remotes = new Map();
    this.sendT = 0;
    this.buildWorld();
    this.myAvatar = M.makeAvatar(ctx.myColor);
    if (ctx.myName) { const lb = M.makeLabel(ctx.myName, '#ffd36b', 0.8); lb.position.y = 3; this.myAvatar.add(lb); }
    this.scene.add(this.myAvatar);
    this.tuto = null;
  }

  buildWorld() {
    const s = this.scene;
    this.waterMat = M.makeWaterMaterial(0x3a9cc4, 0x7fd0ea, 0.2);
    const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE_R + 4, 64), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    s.add(water);
    const sand = new THREE.Mesh(new THREE.RingGeometry(LAKE_R - 1, LAKE_R + 5, 64), new THREE.MeshLambertMaterial({ color: 0xe0cf98 }));
    sand.rotation.x = -Math.PI / 2; sand.position.y = 0.15;
    const grass = new THREE.Mesh(new THREE.RingGeometry(LAKE_R + 4.5, 260, 64), new THREE.MeshLambertMaterial({ color: 0x6aa84f }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = 0.2;
    s.add(sand, grass);
    // Ponton
    const wood = new THREE.MeshLambertMaterial({ color: 0x9b6b3d, flatShading: true });
    const pier = new THREE.Mesh(new THREE.BoxGeometry(PIER.x1 - PIER.x0, 0.3, PIER.d1 - PIER.d0), wood);
    pier.position.copy(M.toV(0, (PIER.d0 + PIER.d1) / 2, 0.55));
    s.add(pier);
    for (let d = PIER.d0 + 1; d < PIER.d1; d += 3) for (const x of [-1.3, 1.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 6), wood);
      post.position.copy(M.toV(x, d, 0.2)); s.add(post);
    }
    const pierLabel = M.makeLabel('Tutoriel', '#ffffff', 1.1);
    pierLabel.position.copy(M.toV(0, PIER.d1 + 0.5, 3)); s.add(pierLabel);
    // Kayak amarré
    this.dockKayak = M.makeKayak(0x2bb3a8);
    this.dockKayak.scale.setScalar(0.7);
    this.dockKayak.position.copy(M.toV(0, -43.5, 0.25));
    s.add(this.dockKayak);
    // Tableau des fleuves
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), wood);
    const post2 = post.clone();
    post.position.copy(M.toV(BOARD.x - 2.2, BOARD.d, 1.5)); post2.position.copy(M.toV(BOARD.x + 2.2, BOARD.d, 1.5));
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 512; this.boardCanvas.height = 320;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.4, 0.2), [wood, wood, wood, wood, new THREE.MeshBasicMaterial({ map: this.boardTex }), wood]);
    panel.position.copy(M.toV(BOARD.x, BOARD.d, 3.4));
    panel.rotation.x = -0.5;
    s.add(post, post2, panel);
    this.drawBoard(null);
    // Arbres
    const trees = [];
    const rnd = GC.mulberry32(7);
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2, r = LAKE_R + 10 + rnd() * 90;
      const x = Math.cos(a) * r, d = Math.sin(a) * r;
      if (Math.abs(x) < 16 && d < -50 && d > -90) continue;
      trees.push({ x, y: 0.2, z: -d, s: 0.8 + rnd() * 0.7 });
    }
    s.add(M.makeTrees(trees, 0x2f6b2a));
    // Tutoriel : bouées, rocher, courant, zone de pêche
    this.tutoObjs = {
      buoy: { x: 0, d: -15 },
      rock: { x: 15, d: -6, r: 2 },
      current: { id: 'tc', x: -16, d: 6, r: 8, vx: 3, vd: 0, kind: 'lat' },
      fish: { id: 'tf', x: 4, d: 24, r: 4.5 },
    };
    const b = M.makeBuoy(0xffd000); b.position.copy(M.toV(0, -15)); s.add(b);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const bb = M.makeBuoy(i % 2 ? 0xffffff : 0xff4136);
      bb.scale.setScalar(0.6);
      bb.position.copy(M.toV(Math.cos(a) * 40, Math.sin(a) * 40)); s.add(bb);
    }
    const rock = M.makeRock(2, 3); rock.position.add(M.toV(15, -6)); s.add(rock);
    this.currentMesh = M.makeCurrent(this.tutoObjs.current); s.add(this.currentMesh);
    this.fishMesh = M.makeFishZone(this.tutoObjs.fish); s.add(this.fishMesh);
  }

  drawBoard(room) {
    const g = this.boardCanvas.getContext('2d');
    g.fillStyle = '#fff8ec'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#12304a'; g.font = 'bold 40px "Baloo 2", sans-serif'; g.textAlign = 'center';
    g.fillText('Fleuves', 256, 50);
    const votes = {};
    if (room) for (const p of room.players) if (p.vote) (votes[p.vote] = votes[p.vote] || []).push(p.color);
    Object.entries(GC.RIVERS).forEach(([id, r], i) => {
      const y = 80 + i * 76;
      g.fillStyle = '#' + r.water.toString(16).padStart(6, '0');
      g.fillRect(20, y, 472, 64);
      g.fillStyle = room && room.river === id ? '#ffd36b' : '#ffffff';
      g.textAlign = 'left'; g.font = 'bold 32px "Baloo 2", sans-serif';
      g.fillText(r.name, 36, y + 42);
      g.textAlign = 'right'; g.fillStyle = '#ffd36b'; g.fillText('★'.repeat(r.stars), 380, y + 42);
      (votes[id] || []).forEach((c, j) => { g.fillStyle = c; g.beginPath(); g.arc(410 + j * 22, y + 32, 9, 0, 7); g.fill(); });
    });
    this.boardTex.needsUpdate = true;
  }

  setRoom(room) {
    this.drawBoard(room);
    const ids = new Set(room.players.map((p) => p.id));
    for (const [id, r] of this.remotes) if (!ids.has(id)) { this.scene.remove(r.root); this.remotes.delete(id); }
    for (const p of room.players) {
      if (p.id === this.ctx.myId) continue;
      if (!this.remotes.has(p.id)) this.addRemote(p);
      if (p.pos && !this.remotes.get(p.id).seen) this.onRemotePos({ id: p.id, ...p.pos });
    }
  }

  addRemote(p) {
    const root = new THREE.Group();
    const avatar = M.makeAvatar(p.color);
    const kayak = M.makeKayak(0x2bb3a8); kayak.scale.setScalar(0.7);
    const paddler = M.makePaddler(p.color); paddler.position.y = 0.2; kayak.add(paddler);
    const swimmer = M.makeSwimmer(p.color);
    const label = M.makeLabel(p.name, '#ffffff', 0.8); label.position.y = 3;
    root.add(avatar, kayak, swimmer, label);
    kayak.visible = swimmer.visible = false;
    root.position.copy(M.toV(0, -68));
    this.scene.add(root);
    this.remotes.set(p.id, { root, avatar, kayak, swimmer, target: { x: 0, d: -68, h: 0, m: 'walk' }, seen: false });
  }

  onRemotePos(pos) {
    const r = this.remotes.get(pos.id);
    if (!r) return;
    r.target = pos;
    if (!r.seen) { r.root.position.copy(M.toV(pos.x, pos.d, 0)); r.seen = true; }
  }

  startTuto() {
    this.tuto = {
      step: 0, k: { x: 0, d: -42, vx: 0, vd: 0, h: 0, av: 0 }, next: 0,
      inWater: false, swimmer: { x: 0, d: 0, vx: 0, vd: 0 }, fish: false, fishProg: 0, jumped: false, lastSide: 'L', lastStroke: -9,
    };
    this.me.mode = 'kayak';
    this.myAvatar.visible = false;
    this.tutoKayak = M.makeKayak(0x2bb3a8);
    this.tutoKayak.scale.setScalar(0.7);
    this.tutoPaddler = M.makePaddler(this.ctx.myColor);
    this.tutoPaddler.position.y = 0.2;
    this.tutoKayak.add(this.tutoPaddler);
    this.tutoSwimmer = M.makeSwimmer(this.ctx.myColor);
    this.tutoSwimmer.visible = false;
    this.scene.add(this.tutoKayak, this.tutoSwimmer);
    this.dockKayak.visible = false;
    this.ctx.tutoUI(TUTO, 0);
  }

  stopTuto() {
    if (!this.tuto) return;
    this.scene.remove(this.tutoKayak, this.tutoSwimmer);
    M.disposeGroup(this.tutoKayak); M.disposeGroup(this.tutoSwimmer);
    this.tuto = null;
    this.dockKayak.visible = true;
    this.me = { x: 0, d: -50, h: 0, mode: 'walk' };
    this.myAvatar.visible = true;
    this.ctx.tutoUI(null);
  }

  advance(n) {
    const T = this.tuto;
    if (T.step === n) { T.step++; this.ctx.tutoUI(TUTO, T.step); this.ctx.toast('Étape réussie !', 'good'); }
  }

  updateTuto(dt, input) {
    const T = this.tuto, k = T.k, O = this.tutoObjs;
    if (input.hit('escape')) return this.stopTuto();
    const cur = O.current;
    const inCurrent = (x, d) => Math.hypot(x - cur.x, d - cur.d) < cur.r;
    const flowAt = (x, d) => inCurrent(x, d) ? { x: cur.vx, d: cur.vd } : { x: 0, d: 0 };

    if (!T.inWater) {
      if (input.hit('f')) { T.fish = !T.fish; T.fishProg = 0; }
      const side = input.paddleSide();
      if (side && !T.fish && this.time >= T.next) {
        GC.applyStroke(k, side, 1);
        T.next = this.time + GC.STROKE_COOLDOWN; T.lastSide = side; T.lastStroke = this.time;
        if (side === 'L') this.advance(0); else if (T.step === 1) this.advance(1);
      }
      if (input.hit(' ')) {
        T.inWater = true; T.jumped = true; T.fish = false;
        const r = GC.right(k.h);
        Object.assign(T.swimmer, { x: k.x + r.x * 1.8, d: k.d + r.d * 1.8, vx: k.vx, vd: k.vd });
        this.me.mode = 'swim';
      }
    } else {
      GC.integrateSwimmer(T.swimmer, dt, flowAt(T.swimmer.x, T.swimmer.d), input.move());
      const dist = GC.kayakSegDist(k, T.swimmer.x, T.swimmer.d).dist;
      this.ctx.prompt(dist < 2.8 ? 'E : remonter dans le kayak' : 'Nage vers le kayak');
      if (dist < 2.8 && input.hit('e')) { T.inWater = false; this.me.mode = 'kayak'; this.ctx.prompt(null); if (T.jumped) this.advance(5); }
    }
    GC.integrateKayak(k, dt, flowAt(k.x, k.d), { x: 0, d: 0 }, { rudder: true });
    // Bords du lac et rocher
    const dc = Math.hypot(k.x, k.d);
    if (dc > LAKE_R - 4) { const nx = k.x / dc, nd = k.d / dc; k.x -= nx * (dc - LAKE_R + 4); k.d -= nd * (dc - LAKE_R + 4); const vn = k.vx * nx + k.vd * nd; if (vn > 0) { k.vx -= nx * vn * 1.4; k.vd -= nd * vn * 1.4; } }
    const s = GC.kayakSegDist(k, O.rock.x, O.rock.d);
    if (s.dist < O.rock.r + 0.6) {
      let nx = s.cx - O.rock.x, nd = s.cd - O.rock.d; const n = Math.hypot(nx, nd) || 1; nx /= n; nd /= n;
      k.x += nx * (O.rock.r + 0.6 - s.dist); k.d += nd * (O.rock.r + 0.6 - s.dist);
      const vn = k.vx * nx + k.vd * nd;
      if (vn < 0) { k.vx -= nx * vn * 1.5; k.vd -= nd * vn * 1.5; if (vn < -1.2) { this.ctx.toast('Bonk ! En course, ça abîme la coque.', 'bad'); this.ctx.shake(0.6); } }
    }
    // Objectifs
    if (Math.hypot(k.x - O.buoy.x, k.d - O.buoy.d) < 5) this.advance(2);
    if (inCurrent(k.x, k.d)) this.advance(3);
    if (T.fish && Math.hypot(k.x - O.fish.x, k.d - O.fish.d) < O.fish.r + 1) {
      T.fishProg += dt;
      if (T.fishProg > 1.6) { T.fishProg = 0; this.ctx.toast('🎣 Prise : Turbo ! (en course, bonus ou malus)', 'good'); this.advance(4); }
    } else T.fishProg = 0;
    if (T.step >= 6 && !T.inWater && Math.hypot(k.x - PIER_END.x, k.d - PIER_END.d) < 7) {
      this.ctx.prompt('E : sortir du kayak');
      if (input.hit('e')) { this.ctx.prompt(null); this.stopTuto(); return; }
    } else if (!T.inWater) this.ctx.prompt(T.fish ? '🎣 Mode pêche (F pour ranger la canne)' : null);

    // Rendu
    this.tutoKayak.position.copy(M.toV(k.x, k.d, 0.25 + Math.sin(this.time * 2) * 0.05));
    this.tutoKayak.rotation.y = -k.h;
    this.tutoPaddler.visible = !T.inWater;
    animatePaddler(this.tutoPaddler, this.time - T.lastStroke, T.lastSide, T.fish, true);
    this.tutoSwimmer.visible = T.inWater;
    if (T.inWater) this.tutoSwimmer.position.copy(M.toV(T.swimmer.x, T.swimmer.d, Math.sin(this.time * 4) * 0.08));
    const fp = T.inWater ? T.swimmer : k;
    this.me.x = fp.x; this.me.d = fp.d; this.me.h = k.h;
  }

  update(dt, input) {
    this.time += dt;
    this.waterMat.uniforms.uTime.value = this.time;
    if (this.tuto) {
      this.updateTuto(dt, input);
    } else {
      const mv = input.move();
      const sp = input.any('shift') ? 12 : 7;
      let nx = this.me.x + mv.x * sp * dt, nd = this.me.d + mv.d * sp * dt;
      const onPier = nx > PIER.x0 + 0.3 && nx < PIER.x1 - 0.3 && nd > PIER.d0 && nd < PIER.d1 - 0.5;
      const r = Math.hypot(nx, nd);
      if (r < LAKE_R + 1.5 && !onPier) { nx = this.me.x; nd = this.me.d; if (Math.hypot(nx, nd) < LAKE_R + 1.5 && !(nx > PIER.x0 && nx < PIER.x1)) { const a = Math.atan2(nd, nx); nx = Math.cos(a) * (LAKE_R + 1.6); nd = Math.sin(a) * (LAKE_R + 1.6); } }
      if (Math.hypot(nx, nd) > 150) { nx = this.me.x; nd = this.me.d; }
      if (mv.x || mv.d) this.me.h = Math.atan2(mv.x, mv.d);
      this.me.x = nx; this.me.d = nd;
      this.myAvatar.position.copy(M.toV(nx, nd, (onPier ? 0.7 : 0.2) + (mv.x || mv.d ? Math.abs(Math.sin(this.time * 12)) * 0.15 : 0)));
      this.myAvatar.rotation.y = -this.me.h;
      const nearBoard = Math.hypot(nx - BOARD.x, nd - (BOARD.d - 2)) < 4.5;
      const nearPier = Math.hypot(nx - PIER_END.x, nd - PIER_END.d) < 3;
      this.ctx.prompt(nearBoard ? 'E : choisir le fleuve' : nearPier ? 'E : monter dans le kayak (tutoriel)' : null);
      if (input.hit('e')) { if (nearBoard) this.ctx.openBoard(); else if (nearPier) this.startTuto(); }
    }
    // Joueurs distants
    for (const r of this.remotes.values()) {
      const t = r.target;
      const want = M.toV(t.x, t.d, 0);
      r.root.position.lerp(want, 1 - Math.exp(-10 * dt));
      r.avatar.visible = t.m === 'walk';
      r.kayak.visible = t.m === 'kayak';
      r.swimmer.visible = t.m === 'swim';
      r.avatar.position.y = (Math.abs(t.x) < 1.5 && t.d > PIER.d0 && t.d < PIER.d1) ? 0.5 : 0;
      r.avatar.rotation.y = -t.h;
      r.kayak.rotation.y = -t.h; r.kayak.position.y = 0.25;
    }
    // Envoi de ma position (10 Hz)
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 0.1; this.ctx.sendPos({ m: this.me.mode, x: this.me.x, d: this.me.d, h: this.me.h }); }
    M.getArrowTexture().offset.y -= dt * 0.8;
    M.updateFishZone(this.fishMesh, this.time, false);
    M.followCamera(this.camera, this.me.x, this.me.d, dt, 30, 10, 10, this.ctx.shakeAmt());
  }

  dispose() {
    this.ctx.prompt(null);
    this.ctx.tutoUI(null);
    M.disposeGroup(this.scene);
  }
}

// Animation partagée d'un pagayeur (pagaie ou canne à pêche)
export function animatePaddler(fig, since, side, fishing, hasPaddle) {
  const { paddle, rod, line } = fig.userData;
  paddle.visible = !fishing && hasPaddle;
  rod.visible = line.visible = fishing;
  if (since < GC.STROKE_COOLDOWN && !fishing) {
    const ph = since / GC.STROKE_COOLDOWN;
    const s = side === 'L' ? 1 : -1;
    paddle.rotation.z = s * 0.55 * Math.sin(ph * Math.PI);
    paddle.rotation.y = s * (0.7 * Math.cos(ph * Math.PI));
  } else {
    paddle.rotation.z *= 0.85; paddle.rotation.y *= 0.85;
  }
}
