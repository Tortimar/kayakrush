// Clavier (AZERTY et QWERTY) basé sur event.key
export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.down.clear());
  }
  any(...keys) { return keys.some((k) => this.down.has(k)); }
  hit(...keys) { return keys.some((k) => this.pressed.has(k)); }
  endFrame() { this.pressed.clear(); }
  paddleSide() {
    const l = this.any('q', 'a', 'arrowleft');
    const r = this.any('d', 'arrowright');
    if (l && !r) return 'L';
    if (r && !l) return 'R';
    return null;
  }
  // vecteur de déplacement : x = droite, d = vers le haut de l'écran (aval)
  move() {
    let x = 0, d = 0;
    if (this.any('z', 'w', 'arrowup')) d += 1;
    if (this.any('s', 'arrowdown')) d -= 1;
    if (this.any('q', 'a', 'arrowleft')) x -= 1;
    if (this.any('d', 'arrowright')) x += 1;
    const n = Math.hypot(x, d);
    return n ? { x: x / n, d: d / n } : { x: 0, d: 0 };
  }
}
