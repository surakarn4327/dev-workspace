// Small pixel particles: typing sparks, error smoke, confetti and review sparkles.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  max: number;
  size: number;
  color: string;
  fade: boolean;
  /** A drawn shape instead of a plain square. */
  glyph?: 'z';
}

const CONFETTI = ['#e5484d', '#f2c14e', '#4a8fd9', '#2fb36a', '#d96c8c', '#ffffff'];
const Z_PIXELS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]];
const CODE = ['#7cd6ff', '#9be08f', '#f2c14e'];

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class Particles {
  private list: Particle[] = [];

  get count(): number {
    return this.list.length;
  }

  clear(): void {
    this.list = [];
  }

  private add(p: Partial<Particle> & { x: number; y: number; life: number; color: string }): void {
    if (this.list.length > 400) return;
    this.list.push({
      vx: 0,
      vy: 0,
      gravity: 0,
      size: 1,
      fade: true,
      max: p.life,
      ...p,
    });
  }

  code(x: number, y: number): void {
    this.add({
      x: x + rand(-3, 3),
      y,
      vx: rand(-4, 4),
      vy: rand(-22, -14),
      life: rand(0.6, 0.9),
      color: CODE[Math.floor(Math.random() * CODE.length)],
    });
  }

  smoke(x: number, y: number): void {
    this.add({
      x: x + rand(-2, 2),
      y,
      vx: rand(-4, 4),
      vy: rand(-14, -8),
      life: rand(0.9, 1.4),
      size: 2,
      color: Math.random() < 0.5 ? '#6b6f80' : '#9aa0b0',
    });
  }

  /** A tired yawn: a small "z" drifting up. */
  yawn(x: number, y: number): void {
    this.add({ x: x + rand(-2, 2), y, vx: rand(2, 5), vy: rand(-7, -4), life: rand(1.6, 2.1), size: 1, color: '#bcd0ff', glyph: 'z' });
  }

  /** Coffee steam curling up from a cup or the machine. */
  steam(x: number, y: number): void {
    this.add({
      x: x + rand(-1, 1),
      y,
      vx: rand(-3, 3),
      vy: rand(-12, -7),
      life: rand(0.8, 1.3),
      color: Math.random() < 0.5 ? '#ffffff' : '#cfd6e6',
    });
  }

  confetti(x: number, y: number, n = 1): void {
    for (let i = 0; i < n; i++) {
      this.add({
        x: x + rand(-4, 4),
        y: y + rand(-2, 2),
        vx: rand(-30, 30),
        vy: rand(-60, -20),
        gravity: 90,
        life: rand(1.4, 2.2),
        size: Math.random() < 0.4 ? 2 : 1,
        color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
      });
    }
  }

  burst(x: number, y: number, color: string, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add({
        x,
        y,
        vx: Math.cos(a) * rand(14, 26),
        vy: Math.sin(a) * rand(14, 26),
        life: rand(0.4, 0.7),
        color,
      });
    }
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(g: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      g.globalAlpha = p.fade ? Math.min(1, (p.life / p.max) * 1.6) : 1;
      g.fillStyle = p.color;
      if (p.glyph === 'z') {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        for (const [dx, dy] of Z_PIXELS) g.fillRect(x + dx, y + dy, 1, 1);
      } else g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    g.globalAlpha = 1;
  }
}
