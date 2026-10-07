// Simulation d'une descente (autoritaire, côté serveur)
const GC = require('../shared/game-core.js');

const r2 = (v) => Math.round(v * 100) / 100;

class Game {
  constructor(riverId, seed, roomPlayers) {
    this.riverId = riverId;
    this.seed = seed;
    this.river = new GC.River(riverId, seed);
    this.t = 0;
    const x0 = this.river.center(8);
    this.k = { x: x0, d: 8, vx: 0, vd: 0, h: 0, av: 0, hull: 100, rudder: true, plates: 2, inv: 0 };
    this.fx = { turbo: 0, anvil: 0, invert: 0, shield: 0, storm: 0, stormV: 0 };
    this.players = new Map();
    this.pieces = [];
    this.pieceId = 0;
    this.fishUses = {};
    this.sharkCd = {};
    this.events = [];
    this.checkpoints = 0;
    this.over = null;
    this.stats = { hits: 0, catches: 0, ejections: 0 };
    for (const rp of roomPlayers) this.addPlayer(rp, 'seat');
  }

  addPlayer(rp, st) {
    const used = new Set([...this.players.values()].map((p) => p.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    const p = {
      id: rp.id, name: rp.name, color: rp.color, seat, st,
      x: this.k.x, d: this.k.d, vx: 0, vd: 0, gauge: 0,
      hasPaddle: true, fish: false, paddle: null, swim: { x: 0, d: 0 },
      next: 0, lastStroke: -9, lastSide: 'L', fishProg: 0, carry: null,
    };
    this.players.set(rp.id, p);
    if (st === 'lost') this.ev({ type: 'info', text: `${rp.name} rejoint : il montera au prochain poste de secours.` });
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.carry) this.spawnPiece(p.carry.type, p.carry.owner, p.x, p.d, 0, 0);
    this.players.delete(id);
  }

  ev(e) { this.events.push(e); }

  setInput(id, inp) {
    const p = this.players.get(id);
    if (!p || !inp) return;
    p.paddle = inp.paddle === 'L' || inp.paddle === 'R' ? inp.paddle : null;
    if (inp.swim && Number.isFinite(inp.swim.x) && Number.isFinite(inp.swim.d)) {
      p.swim = { x: GC.clamp(inp.swim.x, -1, 1), d: GC.clamp(inp.swim.d, -1, 1) };
    }
  }

  action(id, type) {
    const p = this.players.get(id);
    if (!p || this.over) return;
    const k = this.k;
    if (type === 'jump' && p.st === 'seat') {
      this.toWater(p, 1.5, false);
      this.ev({ type: 'jump', id: p.id, name: p.name });
    } else if (type === 'climb' && p.st === 'water') {
      if (GC.kayakSegDist(k, p.x, p.d).dist < 2.8) {
        p.st = 'seat'; p.fishProg = 0;
        this.ev({ type: 'climb', id: p.id, name: p.name });
        if (p.carry) { this.install(p.carry, p.name); p.carry = null; }
      }
    } else if (type === 'fish' && p.st === 'seat') {
      p.fish = !p.fish; p.fishProg = 0;
    }
  }

  toWater(p, push, forced) {
    const k = this.k;
    const sp = GC.seatPos(k, p.seat);
    const r = GC.right(k.h);
    const side = p.seat % 2 === 0 ? 1 : -1;
    p.st = 'water';
    p.x = sp.x + r.x * 1.9 * side; p.d = sp.d + r.d * 1.9 * side;
    p.vx = k.vx + r.x * push * side; p.vd = k.vd + r.d * push * side;
    p.gauge = GC.gaugeMax(k.d);
    p.fish = false; p.fishProg = 0;
    if (forced) { this.stats.ejections++; this.ev({ type: 'eject', id: p.id, name: p.name }); }
  }

  seated() { return [...this.players.values()].filter((p) => p.st === 'seat'); }

  spawnPiece(type, owner, x, d, vx, vd) {
    const pc = { id: ++this.pieceId, type, owner, x, d, vx, vd };
    this.pieces.push(pc);
    return pc;
  }

  breakPart() {
    const k = this.k;
    const opts = [];
    if (k.rudder) opts.push({ type: 'gouvernail' });
    if (k.plates > 0) opts.push({ type: 'plaque' });
    for (const p of this.seated()) if (p.hasPaddle) opts.push({ type: 'pagaie', owner: p.id });
    if (!opts.length) return;
    const o = opts[Math.floor(Math.random() * opts.length)];
    if (o.type === 'gouvernail') k.rudder = false;
    else if (o.type === 'plaque') k.plates--;
    else { const p = this.players.get(o.owner); if (p) p.hasPaddle = false; }
    const r = GC.right(k.h);
    const s = Math.random() < 0.5 ? -1 : 1;
    this.spawnPiece(o.type, o.owner || null, k.x + r.x * 2.5 * s, k.d + r.d * 2.5 * s, k.vx * 0.5 + r.x * 2 * s, k.vd * 0.5 + r.d * 2 * s);
    const names = { gouvernail: 'Le gouvernail', plaque: 'Une plaque de coque', pagaie: 'Une pagaie' };
    this.ev({ type: 'part_lost', part: o.type, text: `${names[o.type]} est tombé(e) à l'eau !` });
  }

  install(piece, by) {
    const k = this.k;
    if (piece.type === 'gouvernail') k.rudder = true;
    else if (piece.type === 'plaque') k.plates = Math.min(2, k.plates + 1);
    else if (piece.type === 'pagaie') {
      let target = piece.owner && this.players.get(piece.owner);
      if (!target || target.hasPaddle) target = [...this.players.values()].find((p) => !p.hasPaddle);
      if (target) target.hasPaddle = true;
    }
    const names = { gouvernail: 'gouvernail', plaque: 'plaque de coque', pagaie: 'pagaie' };
    this.ev({ type: 'part_back', text: `${by} a remis en place : ${names[piece.type]}` });
  }

  hit(impact, src) {
    const k = this.k, t = this.t;
    if (k.inv > t) return;
    k.inv = t + 0.8;
    if (this.fx.shield > t) { this.ev({ type: 'shield' }); return; }
    this.stats.hits++;
    k.hull -= Math.min(25, impact * 3.5);
    this.ev({ type: 'hit', src, power: r2(impact) });
    const chance = Math.min(0.8, (impact - 1.2) * 0.2);
    for (const p of this.seated()) if (Math.random() < chance) this.toWater(p, 2.5, true);
    if (Math.random() < Math.min(0.55, (impact - 1) * 0.12)) this.breakPart();
  }

  catchFor(p, diff) {
    const t = this.t, k = this.k, fx = this.fx;
    const malus = Math.random() < 0.25 + 0.25 * diff;
    const pool = malus ? ['anvil', 'invert', 'leak', 'storm'] : ['turbo', 'repair', 'shield', 'part', 'buoy'];
    const item = pool[Math.floor(Math.random() * pool.length)];
    switch (item) {
      case 'turbo': fx.turbo = t + 6; break;
      case 'repair': k.hull = Math.min(100, k.hull + 30); break;
      case 'shield': fx.shield = t + 8; break;
      case 'part': {
        if (!k.rudder) k.rudder = true;
        else if (k.plates < 2) k.plates++;
        else { const np = [...this.players.values()].find((q) => !q.hasPaddle); if (np) np.hasPaddle = true; else k.hull = Math.min(100, k.hull + 15); }
        break;
      }
      case 'buoy':
        for (const q of this.players.values()) if (q.st === 'water') { q.st = 'seat'; if (q.carry) { this.install(q.carry, q.name); q.carry = null; } }
        break;
      case 'anvil': fx.anvil = t + 8; break;
      case 'invert': fx.invert = t + 6; break;
      case 'leak': k.hull -= 15; break;
      case 'storm': fx.storm = t + 6; fx.stormV = (Math.random() < 0.5 ? -1 : 1) * 5; break;
    }
    this.stats.catches++;
    this.ev({ type: 'catch', id: p.id, name: p.name, item, good: !malus });
  }

  step(dt) {
    if (this.over) return;
    this.t += dt;
    const t = this.t, k = this.k, R = this.river, fx = this.fx;
    const diff = GC.difficulty(k.d);

    // Coups de pagaie
    for (const p of this.players.values()) {
      if (p.st !== 'seat' || !p.paddle || p.fish || t < p.next) continue;
      let side = p.paddle;
      if (fx.invert > t) side = side === 'L' ? 'R' : 'L';
      const strength = (p.hasPaddle ? 1 : 0.35) * (fx.turbo > t ? 1.6 : 1) * (fx.anvil > t ? 0.55 : 1) * (1 - 0.15 * (2 - k.plates));
      GC.applyStroke(k, side, strength);
      p.next = t + GC.STROKE_COOLDOWN; p.lastStroke = t; p.lastSide = side;
    }

    // Physique du kayak
    const flow = R.flowAt(k.x, k.d);
    const wind = R.windAt(k.x, k.d, t);
    if (fx.storm > t) wind.x += fx.stormV;
    GC.integrateKayak(k, dt, flow, wind, { rudder: k.rudder });
    if (k.d < 2) { k.d = 2; if (k.vd < 0) k.vd = 0; }
    this.collideBanks();
    this.collideRocks();
    this.collideSharks();

    // Fuite d'eau si plaques manquantes
    k.hull -= 0.6 * (2 - k.plates) * dt;

    // Nageurs
    for (const p of this.players.values()) {
      if (p.st !== 'water') continue;
      GC.integrateSwimmer(p, dt, R.flowAt(p.x, p.d), p.swim);
      const c = R.center(p.d), hw = R.halfWidth(p.d);
      if (p.x > c + hw - 0.5) { p.x = c + hw - 0.5; p.vx = Math.min(0, p.vx); }
      if (p.x < c - hw + 0.5) { p.x = c - hw + 0.5; p.vx = Math.max(0, p.vx); }
      p.gauge -= dt;
      if (!p.carry) {
        const i = this.pieces.findIndex((pc) => Math.hypot(pc.x - p.x, pc.d - p.d) < 1.7);
        if (i >= 0) {
          const pc = this.pieces.splice(i, 1)[0];
          p.carry = { type: pc.type, owner: pc.owner };
          this.ev({ type: 'grab', name: p.name, part: pc.type });
        }
      }
      if (p.gauge <= 0) {
        p.st = 'lost';
        if (p.carry) { this.spawnPiece(p.carry.type, p.carry.owner, p.x, p.d, p.vx, p.vd); p.carry = null; }
        this.ev({ type: 'lost', id: p.id, name: p.name });
      }
    }

    // Pièces à la dérive
    const fishers = this.seated().filter((p) => p.fish);
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const pc = this.pieces[i];
      const fl = R.flowAt(pc.x, pc.d);
      pc.vx += (fl.x - pc.vx) * Math.min(1, 1.5 * dt);
      pc.vd += (fl.d - pc.vd) * Math.min(1, 1.5 * dt);
      pc.x += pc.vx * dt; pc.d += pc.vd * dt;
      const c = R.center(pc.d), hw = R.halfWidth(pc.d);
      pc.x = GC.clamp(pc.x, c - hw + 0.8, c + hw - 0.8);
      if (fishers.length && GC.kayakSegDist(k, pc.x, pc.d).dist < 3) {
        this.pieces.splice(i, 1);
        this.install(pc, fishers[0].name);
      } else if (pc.d < k.d - 70) {
        this.pieces.splice(i, 1);
        this.ev({ type: 'piece_gone', text: 'Une pièce a été emportée par le courant…' });
      }
    }

    // Pêche
    let inZone = null;
    for (const ch of R.chunksAround(k.d)) {
      for (const fz of ch.fish) {
        if ((this.fishUses[fz.id] || 0) >= 2) continue;
        if (Math.hypot(k.x - fz.x, k.d - fz.d) < fz.r + 1) inZone = fz;
      }
    }
    for (const p of this.seated()) {
      if (!p.fish || !inZone) { p.fishProg = 0; continue; }
      p.fishProg += dt;
      if (p.fishProg >= 1.6 && (this.fishUses[inZone.id] || 0) < 2) {
        p.fishProg = 0;
        this.fishUses[inZone.id] = (this.fishUses[inZone.id] || 0) + 1;
        this.catchFor(p, diff);
      }
    }

    // Postes de secours
    const cp = Math.floor(k.d / GC.CHECKPOINT);
    if (cp > this.checkpoints) {
      this.checkpoints = cp;
      let saved = 0;
      for (const p of this.players.values()) if (p.st === 'lost') { p.st = 'seat'; p.hasPaddle = true; saved++; }
      k.hull = Math.min(100, k.hull + 10);
      this.ev({ type: 'checkpoint', dist: cp * GC.CHECKPOINT, saved });
    }

    // Fin de partie
    const alive = [...this.players.values()].some((p) => p.st !== 'lost');
    if (k.hull <= 0) this.end('Naufrage : la coque a cédé !');
    else if (this.players.size > 0 && !alive) this.end("Tout l'équipage a été emporté par le fleuve !");
  }

  end(reason) {
    this.k.hull = Math.max(0, this.k.hull);
    this.over = { reason, distance: Math.floor(this.k.d), time: Math.round(this.t), stats: this.stats };
  }

  collideBanks() {
    const k = this.k, R = this.river;
    const f = GC.forward(k.h);
    for (const s of [1, -1]) {
      const px = k.x + f.x * GC.KAYAK_HALF_LEN * s, pd = k.d + f.d * GC.KAYAK_HALF_LEN * s;
      const c = R.center(pd), hw = R.halfWidth(pd);
      const off = px - c, lim = hw - 0.6;
      if (Math.abs(off) > lim) {
        const sg = Math.sign(off);
        k.x -= sg * (Math.abs(off) - lim);
        const vn = k.vx * sg;
        if (vn > 0) {
          k.vx -= sg * vn * 1.4;
          k.av += -sg * s * vn * 0.25;
          if (vn > 2.2) this.hit(vn * 0.6, 'rive');
        }
      }
    }
  }

  collideRocks() {
    const k = this.k;
    for (const ch of this.river.chunksAround(k.d)) {
      for (const rk of ch.rocks) {
        const s = GC.kayakSegDist(k, rk.x, rk.d);
        const minD = rk.r + 0.75;
        if (s.dist >= minD) continue;
        let nx = (s.cx - rk.x), nd = (s.cd - rk.d);
        const n = Math.hypot(nx, nd) || 1; nx /= n; nd /= n;
        const pen = minD - s.dist;
        k.x += nx * pen; k.d += nd * pen;
        const vn = k.vx * nx + k.vd * nd;
        if (vn < 0) {
          k.vx -= nx * vn * 1.5; k.vd -= nd * vn * 1.5;
          // couple selon le point d'impact
          const f = GC.forward(k.h);
          const along = (s.cx - k.x) * f.x + (s.cd - k.d) * f.d;
          const r = GC.right(k.h);
          k.av += along * (nx * r.x + nd * r.d) * -vn * 0.08;
          if (-vn > 1.2) this.hit(-vn, 'rocher');
        }
      }
    }
  }

  collideSharks() {
    const k = this.k, t = this.t;
    for (const ch of this.river.chunksAround(k.d)) {
      for (const s of ch.sharks) {
        if ((this.sharkCd[s.id] || 0) > t) continue;
        const sp = this.river.sharkPos(s, t);
        if (GC.kayakSegDist(k, sp.x, sp.d).dist < 1.9) {
          this.sharkCd[s.id] = t + 7;
          if (this.fx.shield > t) { this.ev({ type: 'shield' }); continue; }
          this.stats.hits++;
          k.hull -= 8;
          const seated = this.seated();
          if (seated.length) {
            const a = seated[Math.floor(Math.random() * seated.length)];
            this.toWater(a, 3, true);
            const rest = this.seated();
            if (rest.length && Math.random() < 0.3) this.toWater(rest[Math.floor(Math.random() * rest.length)], 3, true);
          }
          k.vx += Math.sin(sp.h) * 2; k.vd += Math.cos(sp.h) * 2; k.av += (Math.random() - 0.5) * 1.5;
          this.ev({ type: 'shark' });
          continue;
        }
        for (const p of this.players.values()) {
          if (p.st !== 'water') continue;
          if (Math.hypot(p.x - sp.x, p.d - sp.d) < 1.5) {
            this.sharkCd[s.id] = t + 4;
            p.gauge -= GC.gaugeMax(k.d) * 0.35;
            this.ev({ type: 'bite', name: p.name });
            break;
          }
        }
      }
    }
  }

  snapshot() {
    const k = this.k, t = this.t, fx = this.fx;
    const fu = {};
    const kNow = Math.floor(k.d / GC.CHUNK);
    for (const id in this.fishUses) {
      const kk = parseInt(id.slice(1), 10);
      if (kk >= kNow - 2 && kk <= kNow + 4) fu[id] = this.fishUses[id];
    }
    const sc = [];
    for (const id in this.sharkCd) if (this.sharkCd[id] > t) sc.push(id);
    const wind = this.river.windAt(k.x, k.d, t);
    if (fx.storm > t) wind.x += fx.stormV;
    const rem = (v) => Math.max(0, r2(v - t));
    return {
      t: r2(t),
      k: { x: r2(k.x), d: r2(k.d), vx: r2(k.vx), vd: r2(k.vd), h: r2(k.h), av: r2(k.av), hull: r2(Math.max(0, k.hull)), rudder: k.rudder, plates: k.plates, inv: k.inv > t },
      fx: { turbo: rem(fx.turbo), anvil: rem(fx.anvil), invert: rem(fx.invert), shield: rem(fx.shield), storm: rem(fx.storm) },
      p: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color, seat: p.seat, st: p.st,
        x: r2(p.x), d: r2(p.d), g: r2(p.gauge), gm: r2(GC.gaugeMax(k.d)),
        fish: p.fish, fp: r2(p.fishProg), pad: p.hasPaddle, ls: r2(p.lastStroke), side: p.lastSide,
        carry: p.carry ? p.carry.type : null, rowing: !!p.paddle,
      })),
      pc: this.pieces.map((pc) => ({ id: pc.id, type: pc.type, x: r2(pc.x), d: r2(pc.d) })),
      fu, sc, w: { x: r2(wind.x), d: r2(wind.d) }, cp: this.checkpoints,
      ev: this.events.splice(0),
    };
  }
}

module.exports = { Game };
