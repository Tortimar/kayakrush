/* Cœur partagé serveur/client : génération procédurale du fleuve + physique.
   Coordonnées : x = latéral (droite +), d = distance parcourue vers l'aval.
   Cap h : 0 = vers l'aval, positif = tourne vers la droite (+x). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hash(a, b) {
    let h = (a ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ ((b + 0x7f4a7c15) >>> 0), 0x85ebca6b) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const RIVERS = {
    paisible: {
      name: 'La Paisible', desc: 'Large rivière forestière, idéale pour débuter.', stars: 1,
      width: 34, rockF: 0.8, sharkF: 0.6, currentF: 0.8, windF: 0.7, flowF: 0.9,
      water: 0x3a8fb7, water2: 0x6cc3e0, sand: 0xcdbb8a, grass: 0x5c9e4a, grass2: 0x3f7a35, tree: 0x2f6b2a, trees: 1,
    },
    gorges: {
      name: 'Gorges Rouges', desc: 'Canyon étroit, rochers et courants violents.', stars: 3,
      width: 22, rockF: 1.5, sharkF: 0.5, currentF: 1.4, windF: 1.0, flowF: 1.2,
      water: 0x2f7c86, water2: 0x5fb0b0, sand: 0xc98a5a, grass: 0xb5653a, grass2: 0x8c4527, tree: 0x6b7a2a, trees: 0.35,
    },
    delta: {
      name: 'Delta aux Requins', desc: 'Delta tropical venteux, infesté de requins.', stars: 2,
      width: 40, rockF: 0.7, sharkF: 1.8, currentF: 1.0, windF: 1.5, flowF: 1.0,
      water: 0x1f9e96, water2: 0x63d6c9, sand: 0xe6d29a, grass: 0x8fbf4a, grass2: 0x5e9a35, tree: 0x2e8a3a, trees: 0.8,
    },
  };

  const CHUNK = 80;
  const CHECKPOINT = 500;
  const KAYAK_HALF_LEN = 3.4;
  const SEAT_OFFSETS = [2.3, 0.8, -0.8, -2.3]; // le long de l'avant, siège 0 = proue
  const STROKE_COOLDOWN = 0.45;

  function difficulty(d) { return clamp(d / 2500, 0, 1); }
  function gaugeMax(d) { return 15 - 5 * difficulty(d); }

  class River {
    constructor(riverId, seed) {
      this.id = riverId;
      this.cfg = RIVERS[riverId] || RIVERS.paisible;
      this.seed = seed >>> 0;
      const r = mulberry32(hash(this.seed, 99991));
      this.waves = [];
      for (let i = 0; i < 4; i++) {
        this.waves.push({ a: (i === 0 ? 20 : 10 / i) * (0.6 + 0.8 * r()), f: (0.004 + 0.006 * i) * (0.7 + 0.6 * r()), p: r() * Math.PI * 2 });
      }
      this.wwaves = [{ a: 0.18, f: 0.011 * (0.8 + 0.4 * r()), p: r() * 6.28 }, { a: 0.1, f: 0.031, p: r() * 6.28 }];
      this.cache = new Map();
    }
    center(d) {
      let x = 0;
      for (const w of this.waves) x += w.a * (Math.sin(d * w.f + w.p) - Math.sin(w.p));
      return x * clamp(d / 200, 0, 1);
    }
    halfWidth(d) {
      let m = 1;
      for (const w of this.wwaves) m += w.a * Math.sin(d * w.f + w.p);
      let hw = (this.cfg.width / 2) * (1 - 0.3 * difficulty(d)) * m;
      if (d < 60) hw += (60 - d) / 15;
      return Math.max(7, hw);
    }
    tangent(d) {
      const dx = (this.center(d + 1) - this.center(d - 1)) / 2;
      const n = Math.sqrt(1 + dx * dx);
      return { x: dx / n, d: 1 / n };
    }
    chunk(k) {
      if (this.cache.has(k)) return this.cache.get(k);
      const out = { k, rocks: [], sharks: [], currents: [], winds: [], fish: [] };
      if (k < 0) { this.cache.set(k, out); return out; }
      const r = mulberry32(hash(this.seed, k + 1));
      const c = this.cfg;
      const d0 = k * CHUNK;
      const diff = difficulty(d0 + CHUNK / 2);
      const place = (margin) => {
        const d = d0 + r() * CHUNK;
        const hw = this.halfWidth(d);
        return { x: this.center(d) + (r() * 2 - 1) * Math.max(0, hw - margin), d };
      };
      // Rochers
      let nRocks = Math.floor((1 + r() * 3 + diff * 7) * c.rockF);
      if (k === 0) nRocks = 0; else if (k === 1) nRocks = Math.min(nRocks, 1);
      for (let i = 0; i < nRocks; i++) {
        const p = place(1.5);
        out.rocks.push({ id: `r${k}_${i}`, x: p.x, d: p.d, r: 0.8 + r() * 1.4 + diff * 0.6 });
      }
      // Requins
      if (k >= 2) {
        const pS = (0.12 + 0.5 * diff) * c.sharkF;
        const n = r() < pS ? (r() < 0.3 * diff * c.sharkF ? 2 : 1) : 0;
        for (let i = 0; i < n; i++) {
          out.sharks.push({ id: `s${k}_${i}`, d: d0 + r() * CHUNK, amp: 0.4 + 0.5 * r(), w: (0.25 + 0.35 * r() + 0.4 * diff), ph: r() * 6.28, dir: r() < 0.5 ? 1 : -1 });
        }
      }
      // Courants
      if (k >= 1 && r() < (0.25 + 0.35 * diff) * c.currentF) {
        const p = place(4);
        const t = this.tangent(p.d);
        const rad = 6 + r() * 5;
        let vx, vd, kind;
        if (r() < 0.6) {
          const s = (r() < 0.5 ? -1 : 1) * (1.5 + 2.5 * diff + r()) * c.currentF;
          vx = t.d * s; vd = -t.x * s; kind = 'lat';
        } else {
          const s = (2 + 2 * diff) * c.currentF;
          vx = t.x * s; vd = t.d * s; kind = 'rapide';
        }
        out.currents.push({ id: `c${k}`, x: p.x, d: p.d, r: rad, vx, vd, kind });
      }
      // Vent
      if (k >= 2 && r() < (0.1 + 0.35 * diff) * c.windF) {
        const p = place(0);
        const s = (r() < 0.5 ? -1 : 1) * (2 + 4 * diff) * c.windF;
        out.winds.push({ id: `w${k}`, x: p.x, d: p.d, r: 14 + r() * 10, vx: s, vd: (r() - 0.5) * 2 });
      }
      // Zones de pêche
      if (k === 0) out.fish.push({ id: 'f0', x: this.center(50), d: 50, r: 4.5 });
      else if (r() < 0.5) { const p = place(4); out.fish.push({ id: `f${k}`, x: p.x, d: p.d, r: 4.5 }); }
      this.cache.set(k, out);
      if (this.cache.size > 60) { // purge les vieux morceaux
        for (const key of this.cache.keys()) { if (key < k - 20 || key > k + 20) this.cache.delete(key); }
      }
      return out;
    }
    chunksAround(d, before = 1, after = 1) {
      const k = Math.floor(d / CHUNK);
      const arr = [];
      for (let i = k - before; i <= k + after; i++) arr.push(this.chunk(i));
      return arr;
    }
    flowAt(x, d) {
      const t = this.tangent(d);
      const hw = this.halfWidth(d);
      const off = clamp((x - this.center(d)) / hw, -1, 1);
      const base = (1.3 + 2.0 * difficulty(d)) * this.cfg.flowF * Math.max(0.3, 1 - 0.6 * off * off);
      let fx = t.x * base, fd = t.d * base;
      for (const ch of this.chunksAround(d)) {
        for (const c of ch.currents) {
          const dist = Math.hypot(x - c.x, d - c.d);
          if (dist < c.r) { const f = Math.min(1, (1 - dist / c.r) * 2); fx += c.vx * f; fd += c.vd * f; }
        }
      }
      return { x: fx, d: fd };
    }
    windAt(x, d, t) {
      const diff = difficulty(d);
      let wx = Math.sin(t * 0.07 + (this.seed % 100)) * 0.8 * this.cfg.windF * (0.3 + diff);
      let wd = 0;
      const gust = 0.7 + 0.3 * Math.sin(t * 1.3);
      for (const ch of this.chunksAround(d)) {
        for (const w of ch.winds) {
          const dist = Math.hypot(x - w.x, d - w.d);
          if (dist < w.r) { const f = Math.min(1, (1 - dist / w.r) * 2) * gust; wx += w.vx * f; wd += w.vd * f; }
        }
      }
      return { x: wx, d: wd };
    }
    sharkPos(s, t) {
      const hw = this.halfWidth(s.d);
      const A = hw * 0.85 * s.amp;
      const ph = t * s.w * s.dir + s.ph;
      const x = this.center(s.d) + A * Math.sin(ph);
      const d = s.d + 3 * Math.sin(ph * 0.5);
      const dx = A * s.w * s.dir * Math.cos(ph);
      const dd = 1.5 * s.w * s.dir * Math.cos(ph * 0.5);
      return { x, d, h: Math.atan2(dx, dd) };
    }
  }

  // ---------- Physique ----------
  function forward(h) { return { x: Math.sin(h), d: Math.cos(h) }; }
  function right(h) { return { x: Math.cos(h), d: -Math.sin(h) }; }

  function applyStroke(k, side, strength) {
    const f = forward(k.h);
    k.vx += f.x * 1.1 * strength;
    k.vd += f.d * 1.1 * strength;
    // ramer à gauche pousse le flanc gauche : le kayak tourne à droite
    k.av += (side === 'L' ? 1 : -1) * 0.42 * strength;
  }

  function integrateKayak(k, dt, flow, wind, opts) {
    const f = forward(k.h), r = right(k.h);
    const rx = k.vx - flow.x, rd = k.vd - flow.d;
    const rf = rx * f.x + rd * f.d;
    const rl = rx * r.x + rd * r.d;
    let af = -(0.12 * rf * Math.abs(rf) + 0.25 * rf);
    let al = -(1.0 * rl * Math.abs(rl) + 2.5 * rl);
    if (Math.abs(af * dt) > Math.abs(rf)) af = -rf / dt;
    if (Math.abs(al * dt) > Math.abs(rl)) al = -rl / dt;
    k.vx += (f.x * af + r.x * al + wind.x * 0.3) * dt;
    k.vd += (f.d * af + r.d * al + wind.d * 0.3) * dt;
    const ad = opts && opts.rudder === false ? 0.9 : 2.4;
    k.av -= k.av * Math.min(1, ad * dt);
    if (opts && opts.rudder === false) k.av += (Math.random() - 0.5) * 1.4 * dt;
    k.h += k.av * dt;
    k.x += k.vx * dt;
    k.d += k.vd * dt;
  }

  function integrateSwimmer(p, dt, flow, swim) {
    let sx = swim ? swim.x : 0, sd = swim ? swim.d : 0;
    const n = Math.hypot(sx, sd);
    if (n > 1) { sx /= n; sd /= n; }
    const tx = flow.x + sx * 2.6, td = flow.d + sd * 2.6;
    const a = Math.min(1, 3 * dt);
    p.vx += (tx - p.vx) * a; p.vd += (td - p.vd) * a;
    p.x += p.vx * dt; p.d += p.vd * dt;
  }

  // Distance d'un point au segment du kayak (proue-poupe)
  function kayakSegDist(k, px, pd) {
    const f = forward(k.h);
    const ax = k.x - f.x * KAYAK_HALF_LEN, ad = k.d - f.d * KAYAK_HALF_LEN;
    const bx = 2 * f.x * KAYAK_HALF_LEN, bd = 2 * f.d * KAYAK_HALF_LEN;
    let t = ((px - ax) * bx + (pd - ad) * bd) / (bx * bx + bd * bd);
    t = clamp(t, 0, 1);
    const cx = ax + bx * t, cd = ad + bd * t;
    return { dist: Math.hypot(px - cx, pd - cd), cx, cd };
  }

  function seatPos(k, seat) {
    const f = forward(k.h);
    const o = SEAT_OFFSETS[seat] || 0;
    return { x: k.x + f.x * o, d: k.d + f.d * o };
  }

  const ITEMS = {
    turbo: { label: 'Turbo !', good: true, icon: '⚡' },
    repair: { label: 'Kit de réparation', good: true, icon: '🔧' },
    shield: { label: 'Bouclier', good: true, icon: '🛡️' },
    part: { label: 'Pièce de rechange', good: true, icon: '⚙️' },
    buoy: { label: 'Bouée magique', good: true, icon: '🛟' },
    anvil: { label: 'Enclume (ralenti)', good: false, icon: '⚓' },
    invert: { label: 'Commandes inversées', good: false, icon: '🔄' },
    leak: { label: 'Poisson-scie : trou dans la coque', good: false, icon: '🐟' },
    storm: { label: 'Tempête !', good: false, icon: '🌪️' },
  };

  return {
    hash, mulberry32, clamp, RIVERS, CHUNK, CHECKPOINT, KAYAK_HALF_LEN, SEAT_OFFSETS, STROKE_COOLDOWN, ITEMS,
    difficulty, gaugeMax, River, forward, right, applyStroke, integrateKayak, integrateSwimmer, kayakSegDist, seatPos,
  };
});
