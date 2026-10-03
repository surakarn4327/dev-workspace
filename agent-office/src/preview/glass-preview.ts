// Developer page: http://localhost:5171/glass-preview.html
// Shows the candidate glass-wall looks side by side with the same scene.

import { ROSTER } from '../core/roster.ts';
import { getSprite } from '../render/characters.ts';
import { rect } from '../render/furniture.ts';
import { tiles } from '../render/floors.ts';
import { LOOKS, drawDoorPair, drawGlassRun, type GlassLook } from '../render/glass-looks.ts';

const PW = 132;
const PH = 84;
const SCALE = 4;

function scene(look: GlassLook): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PW;
  c.height = PH;
  c.style.width = `${PW * SCALE}px`;
  c.style.height = `${PH * SCALE}px`;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  g.imageSmoothingEnabled = false;

  // the room behind the wall (north) and the corridor in front (south)
  const base = 54;
  tiles(g, { x: 0, y: 0, w: PW, h: PH }, 16, '#8996ab', '#8391a7');
  rect(g, 0, 0, PW, base - 6, '#4a3d6b');
  rect(g, 2, 2, PW - 4, base - 10, '#5b4a82');
  // a desk behind the glass with someone at it
  rect(g, 24, 28, 34, 9, '#cf9a5f');
  rect(g, 24, 37, 34, 9, '#a06c3c');
  rect(g, 28, 40, 10, 4, '#8c5d33');
  rect(g, 44, 40, 10, 4, '#8c5d33');
  g.drawImage(getSprite('research-head', ROSTER['research-head'].look, 'down', 'sit', 0), 33, 12);
  // someone standing behind the glass, right next to the door
  g.drawImage(getSprite('owner', ROSTER.owner.look, 'down', 'stand', 0), 76, base - 33);

  // the wall: 4 cells, a 3-cell double door, 4 cells
  drawGlassRun(g, look, 8, base, 4);
  drawDoorPair(g, look, 56, base);
  drawGlassRun(g, look, 68, base, 7);

  // someone walking along the corridor in front of the glass
  g.drawImage(getSprite('qa', ROSTER.qa.look, 'right', 'walk', 1), 36, base + 6);
  g.drawImage(getSprite('courier', ROSTER.courier.look, 'down', 'stand', 0), 92, base + 10);
  return c;
}

const grid = document.getElementById('grid');
if (!grid) throw new Error('missing #grid');
for (const look of LOOKS) {
  const card = document.createElement('section');
  card.className = 'card';
  const h = document.createElement('h2');
  h.textContent = look.title;
  const p = document.createElement('p');
  p.textContent = look.note;
  card.append(h, scene(look), p);
  grid.append(card);
}
