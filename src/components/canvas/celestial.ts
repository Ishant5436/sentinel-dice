import type { BodyId } from '../../lib/slingshot';

// World units: one unit is one CSS pixel at camera zoom 1.
// Comet is the nucleus (its coma and tails reach further); Saturn is the planet (rings reach 2.35 r).
export const BODY_RADIUS: Record<BodyId, number> = { 0: 30, 1: 56, 2: 18, 3: 28, 4: 16, 5: 36, 6: 40, 7: 62 };
// Closest approach: just outside each body's visible extent (the black hole's disk reaches 2.8 r).
export const PERIAPSIS: Record<BodyId, number> = { 0: 68, 1: 94, 2: 56, 3: 88, 4: 54, 5: 72, 6: 106, 7: 100 };
/** Light each body throws on the dust around it, as "r, g, b". */
export const BODY_LIGHT: Record<BodyId, string> = {
  0: '148, 163, 184',
  1: '251, 176, 64',
  2: '56, 189, 248',
  3: '255, 138, 31',
  4: '125, 220, 240',
  5: '96, 140, 255',
  6: '230, 205, 150',
  7: '255, 90, 40',
};

const TAU = Math.PI * 2;
const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** Deterministic noise in [0, 1): the same belts and dust on every load. */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------------------------
// Blender-rendered spin loops (scripts/blender/render_bodies.py): 36 frames in a 6x6 sheet,
// a frame spans `ortho` body radii. Procedural drawing covers the time before they load.
interface SpinSheet {
  img: HTMLImageElement;
  ready: boolean;
  periodS: number;
  ortho: number;
}
const SHEET_COLS = 6;
const SHEET_FRAMES = 36;

function loadSheet(name: string, periodS: number, ortho = 2.2): SpinSheet {
  const sheet: SpinSheet = { img: new Image(), ready: false, periodS, ortho };
  sheet.img.onload = () => {
    sheet.ready = true;
  };
  sheet.img.onerror = () => console.warn(`Sprite ${name} failed to load; using procedural body`);
  sheet.img.src = `./sprites/${name}.webp`;
  return sheet;
}

const JUPITER_SPIN_S = 14;
const SHEETS: Record<BodyId, SpinSheet> = {
  0: loadSheet('moon', 40),
  1: loadSheet('jupiter', JUPITER_SPIN_S),
  2: loadSheet('pulsar', 1.5),
  // The black hole sheet tumbles the whole disk; hold frame 0 (the face-on lensed view) and show
  // rotation with orbiting clumps instead (drawBeamedBlackHole).
  3: loadSheet('blackhole', Number.POSITIVE_INFINITY, 6.2),
  4: loadSheet('comet', 12, 3.0),
  5: loadSheet('neptune', 16),
  6: loadSheet('saturn', 18, 5.0),
  7: loadSheet('redgiant', 40),
};

// Spiral galaxy backdrop (scripts/blender/render_bodies.py, render_galaxy).
const GALAXY = new Image();
let galaxyReady = false;
GALAXY.onload = () => {
  galaxyReady = true;
};
GALAXY.onerror = () => console.warn('Galaxy backdrop failed to load');
GALAXY.src = './galaxy.webp';

/** Distant spiral galaxy in screen space: slowly turning, with a little camera parallax. */
export function drawGalaxy(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, parallaxX: number, parallaxY: number, alpha: number) {
  if (!galaxyReady || alpha <= 0) return;
  const size = Math.max(w, h) * 0.62;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(w * 0.2 - parallaxX, h * 0.26 - parallaxY);
  ctx.rotate(-0.35 + t * 0.004);
  ctx.drawImage(GALAXY, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** Draw the spin loop at time t, crossfading between neighbouring frames for smooth rotation. */
function drawSpin(ctx: CanvasRenderingContext2D, sheet: SpinSheet, x: number, y: number, r: number, t: number) {
  const cell = sheet.img.naturalWidth / SHEET_COLS;
  const size = r * sheet.ortho;
  const pos = ((t / sheet.periodS) * SHEET_FRAMES) % SHEET_FRAMES;
  const frame = Math.floor(pos);
  const blend = pos - frame;
  const baseAlpha = ctx.globalAlpha;
  for (const [index, alpha] of [
    [frame, 1],
    [(frame + 1) % SHEET_FRAMES, blend],
  ]) {
    ctx.globalAlpha = baseAlpha * alpha;
    const sx = (index % SHEET_COLS) * cell;
    const sy = Math.floor(index / SHEET_COLS) * cell;
    ctx.drawImage(sheet.img, sx, sy, cell, cell, x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = baseAlpha;
}

// ---------------------------------------------------------------------------------------------
// Procedural stand-ins while the sheets load.
function drawMoonFallback(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.2, x, y, r);
  g.addColorStop(0, '#f1f5f9');
  g.addColorStop(0.6, '#94a3b8');
  g.addColorStop(1, '#334155');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function drawJupiterFallback(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y - r, x, y + r);
  const bands = ['#fde68a', '#d97706', '#fef3c7', '#b45309', '#fcd34d', '#92400e', '#fde68a'];
  bands.forEach((c, i) => g.addColorStop(i / (bands.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function drawBlackHoleFallback(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const disk = ctx.createRadialGradient(x, y, r * 1.2, x, y, r * 2.8);
  disk.addColorStop(0, 'rgba(255, 237, 200, 0.95)');
  disk.addColorStop(0.4, 'rgba(249, 115, 22, 0.8)');
  disk.addColorStop(1, 'rgba(127, 29, 29, 0)');
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 2.8, r * 0.7, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------
// Black hole: relativistic Doppler beaming. Disk matter moving toward the camera at a good
// fraction of c is beamed brighter and bluer; the receding side dims and reddens. We apply it to
// the Blender sprite in three offscreen passes, each masked by the sprite's own alpha:
//   A = raw frame, B = A x cooling ramp (1.0 left -> ~0.4 right, reddening),
//   C = A x boost ramp (~0.75 left -> 0 center), then B + C, so the left limb peaks near 1.8x.
interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
const layers: Array<Layer | undefined> = [];

function layer(i: number, size: number): Layer | null {
  let l = layers[i];
  if (!l) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    l = { canvas, ctx };
    layers[i] = l;
  }
  if (l.canvas.width !== size) {
    l.canvas.width = size;
    l.canvas.height = size;
  }
  return l;
}

function drawBeamedBlackHole(ctx: CanvasRenderingContext2D, sheet: SpinSheet, x: number, y: number, r: number, t: number) {
  const size = r * sheet.ortho;
  const m = ctx.getTransform();
  const px = Math.max(64, Math.min(768, Math.ceil(size * Math.hypot(m.a, m.b))));
  const a = layer(0, px);
  const b = layer(1, px);
  const c = layer(2, px);
  if (!a || !b || !c) {
    drawSpin(ctx, sheet, x, y, r, t);
    return;
  }
  a.ctx.globalCompositeOperation = 'source-over';
  a.ctx.clearRect(0, 0, px, px);
  const rr = px / sheet.ortho;
  drawSpin(a.ctx, sheet, px / 2, px / 2, rr, t);
  // Hot clumps orbiting in the disk. The near side moves left to right, so matter on the left
  // limb is heading toward the camera, which is the side the beaming pass brightens.
  a.ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 5; k++) {
    const theta = k * 1.3 - t * (0.9 + (k % 2) * 0.35);
    const ring = 1.55 + (k % 3) * 0.38;
    const cx = px / 2 + Math.cos(theta) * rr * ring;
    const cy = px / 2 + Math.sin(theta) * rr * ring * 0.14;
    if (Math.sin(theta) < 0 && Math.abs(cx - px / 2) < rr * 1.05) continue; // behind the shadow
    const blob = a.ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 0.3);
    blob.addColorStop(0, 'rgba(255, 244, 220, 0.55)');
    blob.addColorStop(1, 'rgba(255, 160, 60, 0)');
    a.ctx.fillStyle = blob;
    a.ctx.beginPath();
    a.ctx.ellipse(cx, cy, rr * 0.3, rr * 0.09, 0, 0, TAU);
    a.ctx.fill();
  }
  a.ctx.globalCompositeOperation = 'source-over';

  b.ctx.globalCompositeOperation = 'copy';
  b.ctx.drawImage(a.canvas, 0, 0);
  b.ctx.globalCompositeOperation = 'multiply';
  const cool = b.ctx.createLinearGradient(px * 0.15, 0, px * 0.85, 0);
  cool.addColorStop(0, '#ffffff');
  cool.addColorStop(0.45, '#fff1e6');
  cool.addColorStop(0.72, '#d0704c');
  cool.addColorStop(1, '#b04a30');
  b.ctx.fillStyle = cool;
  b.ctx.fillRect(0, 0, px, px);
  b.ctx.globalCompositeOperation = 'destination-in';
  b.ctx.drawImage(a.canvas, 0, 0);

  // Hot spots orbiting in the disk make the beamed side shimmer.
  const flicker = 0.85 + 0.15 * Math.sin(t * 3.1) * Math.sin(t * 1.7);
  c.ctx.globalCompositeOperation = 'copy';
  c.ctx.drawImage(a.canvas, 0, 0);
  c.ctx.globalCompositeOperation = 'multiply';
  const hot = c.ctx.createLinearGradient(px * 0.15, 0, px * 0.6, 0);
  hot.addColorStop(0, `rgb(${Math.round(190 * flicker)}, ${Math.round(215 * flicker)}, ${Math.round(255 * flicker)})`);
  hot.addColorStop(0.55, 'rgb(70, 80, 110)');
  hot.addColorStop(1, '#000000');
  c.ctx.fillStyle = hot;
  c.ctx.fillRect(0, 0, px, px);
  c.ctx.globalCompositeOperation = 'destination-in';
  c.ctx.drawImage(a.canvas, 0, 0);

  b.ctx.globalCompositeOperation = 'lighter';
  b.ctx.drawImage(c.canvas, 0, 0);
  b.ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(b.canvas, x - size / 2, y - size / 2, size, size);
}

// ---------------------------------------------------------------------------------------------
// Jupiter weather over the sprite: neighbouring belts shear in opposite directions (+0.4 and
// -0.3 px per 60 Hz frame relative to the planet's spin) and the Great Red Spot turns as an
// anticyclone. Features ride a sphere: x = R cos(lat) sin(lon), foreshortened by cos(lon).
interface Wisp {
  lon: number;
  len: number;
  thick: number;
  light: boolean;
}
const BELTS = [0.62, 0.4, 0.2, -0.02, -0.22, -0.44, -0.72].map((lat, i) => ({
  lat,
  drift: i % 2 === 0 ? 0.4 : -0.3,
  wisps: Array.from(
    { length: 11 },
    (_, k): Wisp => ({
      lon: (k / 11) * TAU + hash(i * 31 + k) * 0.5,
      len: 0.18 + hash(i * 17 + k * 3) * 0.35,
      thick: 0.016 + hash(i * 7 + k * 13) * 0.026,
      light: hash(i * 5 + k * 11) > 0.45,
    }),
  ),
}));
// Great Red Spot track fitted from the sprite (frames 0 and 3): position in body radii vs sin(lon).
const GRS_LON0 = -0.16;

function drawJupiterWeather(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  const spin = (t / JUPITER_SPIN_S) * TAU;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.98, 0, TAU);
  ctx.clip();
  for (const belt of BELTS) {
    const ring = Math.cos(belt.lat) * r;
    const by = y - Math.sin(belt.lat) * r;
    const shear = (belt.drift * 60 * t) / (BODY_RADIUS[1] * Math.cos(belt.lat));
    for (const w of belt.wisps) {
      const lon = wrapPi(w.lon + spin + shear);
      const c = Math.cos(lon);
      if (c < 0.08) continue;
      const alpha = (w.light ? 0.22 : 0.18) * c;
      ctx.fillStyle = w.light ? `rgba(255, 246, 228, ${alpha})` : `rgba(122, 58, 26, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x + ring * Math.sin(lon), by, Math.max(0.6, ring * w.len * c * 0.5), r * w.thick, 0, 0, TAU);
      ctx.fill();
    }
  }

  const lon = wrapPi(GRS_LON0 + spin);
  const c = Math.cos(lon);
  if (c > 0.1) {
    const s = Math.sin(lon);
    ctx.translate(x + r * (0.004 + 0.832 * s), y + r * (0.512 - 0.142 * s));
    ctx.scale(Math.max(0.15, c), 1);
    ctx.globalAlpha = Math.min(1, c * 1.4);
    const rx = r * 0.2;
    const ry = r * 0.11;
    ctx.strokeStyle = 'rgba(255, 236, 214, 0.4)';
    ctx.lineWidth = r * 0.02;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 1.18, ry * 1.25, 0, 0, TAU);
    ctx.stroke();
    // Anticyclone in the southern hemisphere: the arms wind counter-clockwise on screen.
    const rot = -t * 0.9;
    ctx.lineWidth = r * 0.014;
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = k === 0 ? 'rgba(255, 214, 190, 0.55)' : 'rgba(150, 36, 26, 0.5)';
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const f = i / 24;
        const th = rot + (k * TAU) / 3 - f * Math.PI * 1.5;
        const rho = 0.15 + 0.85 * f;
        const px = Math.cos(th) * rx * rho;
        const py = Math.sin(th) * ry * rho;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Pulsar: two sweeping beams along the magnetic axis and synchrotron toroids wrapped around it.
const PULSAR_SPIN = 2.2; // rad/s
const BEAM_LENGTH = 340;
/** Screen angle of one beam (the other is opposite); the canvas uses it to detect beam crossings. */
export const pulsarBeamAngle = (t: number) => t * PULSAR_SPIN + Math.PI / 2;

function drawPulsar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * PULSAR_SPIN);
  for (let k = 0; k < 2; k++) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6 + k * 2);
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.16 + 0.22 * pulse})`;
    ctx.lineWidth = 1.5 - k * 0.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * (2.1 + k * 1.2), r * (0.55 + k * 0.32), 0, 0, TAU);
    ctx.stroke();
  }
  for (const dir of [-1, 1]) {
    const halo = ctx.createLinearGradient(0, 0, 0, dir * BEAM_LENGTH);
    halo.addColorStop(0, 'rgba(186, 230, 253, 0.32)');
    halo.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-34, dir * BEAM_LENGTH);
    ctx.lineTo(34, dir * BEAM_LENGTH);
    ctx.closePath();
    ctx.fill();
    const beam = ctx.createLinearGradient(0, 0, 0, dir * BEAM_LENGTH * 0.85);
    beam.addColorStop(0, 'rgba(240, 249, 255, 0.95)');
    beam.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-11, dir * BEAM_LENGTH * 0.85);
    ctx.lineTo(11, dir * BEAM_LENGTH * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const core = ctx.createRadialGradient(x, y, 1, x, y, r * 2.4);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.3, '#7dd3fc');
  core.addColorStop(1, 'rgba(14, 165, 233, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------
// Comet: a broad curved dust tail and a straight ion tail stream away from the light.
function drawCometTails(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  const dir = -0.6 + Math.sin(t * 0.4) * 0.05;
  const len = r * 12;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(x, y);
  ctx.rotate(dir);
  const dust = ctx.createLinearGradient(0, 0, len, 0);
  dust.addColorStop(0, 'rgba(255, 244, 214, 0.5)');
  dust.addColorStop(1, 'rgba(255, 244, 214, 0)');
  ctx.fillStyle = dust;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.7);
  ctx.quadraticCurveTo(len * 0.5, -r * 0.5, len, r * 2.8);
  ctx.lineTo(len, r * 4.6);
  ctx.quadraticCurveTo(len * 0.45, r * 1.6, 0, r * 0.7);
  ctx.closePath();
  ctx.fill();
  const ion = ctx.createLinearGradient(0, 0, len * 1.4, 0);
  ion.addColorStop(0, 'rgba(125, 211, 252, 0.75)');
  ion.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = ion;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.35);
  ctx.lineTo(len * 1.4, -r * 1.3);
  ctx.lineTo(len * 1.4, -r * 0.1);
  ctx.lineTo(0, r * 0.35);
  ctx.closePath();
  ctx.fill();
  // Ion streamers ripple in the solar wind.
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 4; k++) {
    ctx.strokeStyle = `rgba(186, 230, 253, ${0.35 - k * 0.06})`;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const f = i / 20;
      const px = f * len * 1.35;
      const py = -r * (0.2 + k * 0.28) * (0.4 + f) + Math.sin(f * 9 - t * 3 + k) * r * 0.25 * f;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Red giant: a breathing corona and looping prominences at the limb.
function drawRedGiantCorona(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  const breathe = 1 + 0.03 * Math.sin(t * 0.8);
  const corona = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 2.1 * breathe);
  corona.addColorStop(0, 'rgba(255, 120, 40, 0.45)');
  corona.addColorStop(0.4, 'rgba(255, 70, 20, 0.14)');
  corona.addColorStop(1, 'rgba(255, 40, 10, 0)');
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.1 * breathe, 0, TAU);
  ctx.fill();
}

function drawProminences(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + t * 0.03;
    const lift = 1.18 + 0.1 * Math.sin(t * 1.1 + k * 2);
    const a0 = a - 0.16;
    const a1 = a + 0.16;
    ctx.strokeStyle = `rgba(255, 150, 70, ${0.55 + 0.2 * Math.sin(t * 2 + k)})`;
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a0) * r * 0.98, y + Math.sin(a0) * r * 0.98);
    ctx.quadraticCurveTo(x + Math.cos(a) * r * lift * 1.12, y + Math.sin(a) * r * lift * 1.12, x + Math.cos(a1) * r * 0.98, y + Math.sin(a1) * r * 0.98);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHalo(ctx: CanvasRenderingContext2D, x: number, y: number, inner: number, outer: number, rgb: string, alpha: number) {
  const halo = ctx.createRadialGradient(x, y, inner, x, y, outer);
  halo.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  halo.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, outer, 0, TAU);
  ctx.fill();
}

const FALLBACK_COLOR: Record<BodyId, string> = {
  0: '#94a3b8',
  1: '#d97706',
  2: '#7dd3fc',
  3: '#000000',
  4: '#a5f3fc',
  5: '#3b82f6',
  6: '#e3d2a6',
  7: '#f0661c',
};

export function drawBody(ctx: CanvasRenderingContext2D, body: BodyId, x: number, y: number, t: number) {
  const r = BODY_RADIUS[body];
  const sheet = SHEETS[body];
  if (body === 2) {
    drawPulsar(ctx, x, y, r, t);
    if (sheet.ready) drawSpin(ctx, sheet, x, y, r, t);
    return;
  }
  if (body === 4) drawCometTails(ctx, x, y, r, t);
  if (body === 7) drawRedGiantCorona(ctx, x, y, r, t);
  if (body === 5) drawHalo(ctx, x, y, r * 0.95, r * 1.35, '120, 170, 255', 0.25);
  if (body === 6) drawHalo(ctx, x, y, r * 0.95, r * 1.5, '240, 215, 160', 0.14);
  if (!sheet.ready) {
    if (body === 0) drawMoonFallback(ctx, x, y, r);
    else if (body === 1) drawJupiterFallback(ctx, x, y, r);
    else if (body === 3) drawBlackHoleFallback(ctx, x, y, r);
    else {
      ctx.fillStyle = FALLBACK_COLOR[body];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    return;
  }
  if (body === 7) {
    // A slow pulsation, then prominences arching over the limb.
    drawSpin(ctx, sheet, x, y, r * (1 + 0.012 * Math.sin(t * 0.9)), t);
    drawProminences(ctx, x, y, r, t);
    return;
  }
  if (body === 1) {
    const halo = ctx.createRadialGradient(x, y, r * 0.95, x, y, r * 1.3);
    halo.addColorStop(0, 'rgba(251, 191, 36, 0.18)');
    halo.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.3, 0, TAU);
    ctx.fill();
    drawSpin(ctx, sheet, x, y, r, t);
    drawJupiterWeather(ctx, x, y, r, t);
    return;
  }
  if (body === 3) {
    drawBeamedBlackHole(ctx, sheet, x, y, r, t);
    return;
  }
  drawSpin(ctx, sheet, x, y, r, t);
}

// ---------------------------------------------------------------------------------------------
// Deep-field backdrop, painted once per resize at half resolution: nebula clouds in the
// interface palette, a tilted galactic band and faint fixed dust.
const CLOUDS: Array<[number, number, number, string, number]> = [
  [0.16, 0.22, 0.55, '124, 58, 237', 0.16],
  [0.84, 0.74, 0.6, '255, 138, 31', 0.08],
  [0.72, 0.16, 0.45, '34, 211, 238', 0.07],
  [0.28, 0.86, 0.5, '157, 92, 255', 0.1],
  [0.56, 0.48, 0.34, '255, 93, 115', 0.05],
];

export function paintNebula(w: number, h: number): HTMLCanvasElement {
  const scale = 0.5;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#04030a';
  ctx.fillRect(0, 0, w, h);
  const size = Math.max(w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (const [fx, fy, fr, rgb, a] of CLOUDS) {
    const g = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, fr * size);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(0.5, `rgba(${rgb}, ${a * 0.4})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.42);
  ctx.scale(1, 0.18);
  const band = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.7);
  band.addColorStop(0, 'rgba(200, 190, 255, 0.1)');
  band.addColorStop(1, 'rgba(200, 190, 255, 0)');
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 520; i++) {
    ctx.fillStyle = `rgba(226, 232, 240, ${0.08 + hash(i * 1.7) * 0.32})`;
    ctx.fillRect(hash(i * 2.3) * w, hash(i * 5.9 + 1) * h, 1.2, 1.2);
  }
  return canvas;
}
