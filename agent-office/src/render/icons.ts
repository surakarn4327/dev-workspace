// Tiny pixel icons and the speech/thought bubble that shows what an agent is doing.
// Real text lives in the DOM panels; the canvas only shows icons so it stays crisp.

export type IconName =
  | 'excl'
  | 'ques'
  | 'check'
  | 'cross'
  | 'doc'
  | 'gear'
  | 'mag'
  | 'star'
  | 'zzz'
  | 'lines'
  | 'coffee';

const COLORS: Record<string, string> = {
  K: '#1d1b2e',
  R: '#e5484d',
  G: '#2fb36a',
  B: '#4a8fd9',
  Y: '#f2c14e',
  W: '#ffffff',
  Z: '#6a7bd0',
  N: '#6b3f1d',
  O: '#f09a3e',
  L: '#a9dcff',
  T: '#9aa3b5',
};

const ICONS: Record<IconName, string[]> = {
  excl: ['...R...', '...R...', '...R...', '...R...', '...R...', '.......', '...R...'],
  ques: ['..BBB..', '.B...B.', '.....B.', '....B..', '...B...', '.......', '...B...'],
  check: ['.......', '......G', '.....G.', 'G...G..', '.G.G...', '..G....', '.......'],
  cross: ['.......', '.R...R.', '..R.R..', '...R...', '..R.R..', '.R...R.', '.......'],
  doc: ['.KKKK..', '.KWWKK.', '.KBBBK.', '.KWWWK.', '.KBBBK.', '.KWWWK.', '.KKKKK.'],
  gear: ['...K...', '.K.K.K.', '..KKK..', 'KKK.KKK', '..KKK..', '.K.K.K.', '...K...'],
  mag: ['..KKK..', '.K...K.', '.K...K.', '.K...K.', '..KKK..', '....KK.', '.....KK'],
  star: ['...Y...', '...Y...', 'YYYYYYY', '.YYYYY.', '..YYY..', '.YY.YY.', '.Y...Y.'],
  zzz: ['.ZZZ...', '...Z...', '..Z..ZZ', '.ZZZ..Z', '.....Z.', '....ZZZ', '.......'],
  lines: ['.......', 'KKKKKK.', '.......', 'KKKKKKK', '.......', 'KKKK...', '.......'],
  coffee: ['..T.T..', '...T.T.', '.WWWWW.', '.WNNNWK', '.WNNNWK', '..WWW.K', '.WWWWW.'],
};

export function drawIcon(g: CanvasRenderingContext2D, name: IconName, x: number, y: number): void {
  const rows = ICONS[name];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const col = COLORS[rows[r][c]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x + c, y + r, 1, 1);
    }
  }
}

export interface BubbleSpec {
  icon?: IconName;
  /** Animated "..." thought dots (frame 0-2). */
  dots?: number;
  tone?: 'normal' | 'alert';
}

const BW = 13;
const BH = 11;

/** Draw a bubble whose tail tip points at (cx, y + BH + 2). */
export function drawBubble(g: CanvasRenderingContext2D, cx: number, y: number, spec: BubbleSpec): void {
  const x = Math.round(cx) - 6;
  y = Math.round(y);
  const edge = '#1d1b2e';
  const fill = spec.tone === 'alert' ? '#ffe3df' : '#ffffff';
  g.fillStyle = fill;
  g.fillRect(x + 2, y + 1, BW - 4, BH - 2);
  g.fillRect(x + 1, y + 2, BW - 2, BH - 4);
  g.fillStyle = edge;
  g.fillRect(x + 2, y, BW - 4, 1);
  g.fillRect(x + 2, y + BH - 1, BW - 4, 1);
  g.fillRect(x, y + 2, 1, BH - 4);
  g.fillRect(x + BW - 1, y + 2, 1, BH - 4);
  for (const [dx, dy] of [
    [1, 1],
    [BW - 2, 1],
    [1, BH - 2],
    [BW - 2, BH - 2],
  ]) {
    g.fillRect(x + dx, y + dy, 1, 1);
  }
  // tail
  g.fillStyle = fill;
  g.fillRect(x + 5, y + BH - 1, 2, 1);
  g.fillStyle = edge;
  g.fillRect(x + 4, y + BH, 1, 1);
  g.fillRect(x + 7, y + BH, 1, 1);
  g.fillRect(x + 5, y + BH + 1, 2, 1);
  g.fillStyle = fill;
  g.fillRect(x + 5, y + BH, 2, 1);

  if (spec.dots !== undefined) {
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i === spec.dots ? '#1d1b2e' : '#8a90a8';
      const size = i === spec.dots ? 2 : 1;
      g.fillRect(x + 3 + i * 3, y + 5 - (size - 1), size, size);
    }
  } else if (spec.icon) {
    drawIcon(g, spec.icon, x + 3, y + 2);
  }
}
