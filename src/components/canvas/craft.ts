import type { ChassisId } from '../../lib/career';

// Probe hulls (one per pilot rank), the tidal-disruption filament and the spent ascent stage.
// Everything is drawn at the origin with the nose along +x, roughly 24 world units long.

const TAU = Math.PI * 2;

function plume(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, width: number, inner: string, outer: string) {
  const g = ctx.createLinearGradient(x, 0, x - len, 0);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - width / 2);
  ctx.quadraticCurveTo(x - len * 0.4, y - width * 0.7, x - len, y);
  ctx.quadraticCurveTo(x - len * 0.4, y + width * 0.7, x, y + width / 2);
  ctx.closePath();
  ctx.fill();
}

function poly(ctx: CanvasRenderingContext2D, points: Array<[number, number]>) {
  ctx.beginPath();
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
}

/** Ensign: Pioneer-style probe, gold-foil bus, forward dish, RTG booms. */
function pioneer(ctx: CanvasRenderingContext2D, flame: number) {
  ctx.globalCompositeOperation = 'lighter';
  plume(ctx, -6, 0, 8 + 12 * flame, 5, 'rgba(255, 240, 200, 0.95)', 'rgba(255, 138, 31, 0.7)');
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-1, 0);
  ctx.lineTo(-8, -8);
  ctx.moveTo(-1, 0);
  ctx.lineTo(-8, 8);
  ctx.moveTo(2, -3);
  ctx.lineTo(0, -11);
  ctx.stroke();
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(-10, -10, 3.2, 3.2);
  ctx.fillRect(-10, 6.8, 3.2, 3.2);
  const foil = ctx.createLinearGradient(-5, -5, 4, 5);
  foil.addColorStop(0, '#fef3c7');
  foil.addColorStop(0.4, '#fbbf24');
  foil.addColorStop(0.7, '#b45309');
  foil.addColorStop(1, '#fde68a');
  ctx.fillStyle = foil;
  poly(
    ctx,
    Array.from({ length: 6 }, (_, i): [number, number] => [-1 + Math.cos((i * TAU) / 6) * 5, Math.sin((i * TAU) / 6) * 5]),
  );
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 53, 15, 0.8)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 251, 235, 0.7)';
  ctx.beginPath();
  ctx.moveTo(-4, -1.5);
  ctx.lineTo(-1, 1);
  ctx.lineTo(1.5, -2);
  ctx.stroke();
  const dish = ctx.createLinearGradient(3, -8, 7, 8);
  dish.addColorStop(0, '#ffffff');
  dish.addColorStop(1, '#94a3b8');
  ctx.fillStyle = dish;
  ctx.beginPath();
  ctx.ellipse(5.5, 0, 2.4, 8, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(5.5, 0);
  ctx.lineTo(10, 0);
  ctx.stroke();
}

/** Orbital Navigator: survey craft with twin ion engines and blue exhaust. */
function surveyCraft(ctx: CanvasRenderingContext2D, flame: number) {
  ctx.globalCompositeOperation = 'lighter';
  for (const y of [-3.6, 3.6]) plume(ctx, -9, y, 14 + 16 * flame, 3, 'rgba(219, 234, 254, 0.95)', 'rgba(59, 130, 246, 0.75)');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(-3, -13, 6, 8);
  ctx.fillRect(-3, 5, 6, 8);
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.8)';
  ctx.lineWidth = 0.4;
  for (const y0 of [-13, 5]) {
    ctx.strokeRect(-3, y0, 6, 8);
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(0, y0 + 8);
    ctx.moveTo(-3, y0 + 4);
    ctx.lineTo(3, y0 + 4);
    ctx.stroke();
  }
  ctx.fillStyle = '#475569';
  ctx.fillRect(-9.5, -5, 5.5, 2.8);
  ctx.fillRect(-9.5, 2.2, 5.5, 2.8);
  const hull = ctx.createLinearGradient(0, -3, 0, 3);
  hull.addColorStop(0, '#f8fafc');
  hull.addColorStop(1, '#64748b');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.quadraticCurveTo(7, -3.2, 0, -3.2);
  ctx.lineTo(-8, -3.2);
  ctx.lineTo(-8, 3.2);
  ctx.lineTo(0, 3.2);
  ctx.quadraticCurveTo(7, 3.2, 10, 0);
  ctx.fill();
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.ellipse(5.5, 0, 2, 1.1, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#93c5fd';
  for (const y of [-3.6, 3.6]) {
    ctx.beginPath();
    ctx.arc(-9.6, y, 1.1, 0, TAU);
    ctx.fill();
  }
}

/** Deep Space Commander: heavy lancer, long hull, wide solar arrays, cyan drive. */
function lancer(ctx: CanvasRenderingContext2D, flame: number) {
  ctx.globalCompositeOperation = 'lighter';
  plume(ctx, -10, 0, 16 + 20 * flame, 6, 'rgba(240, 253, 255, 0.95)', 'rgba(34, 211, 238, 0.8)');
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-3, -3);
  ctx.lineTo(-3, -17);
  ctx.moveTo(-3, 3);
  ctx.lineTo(-3, 17);
  ctx.stroke();
  ctx.fillStyle = '#172554';
  ctx.fillRect(-7, -17, 8, 11);
  ctx.fillRect(-7, 6, 8, 11);
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.7)';
  ctx.lineWidth = 0.35;
  for (const y0 of [-17, 6]) {
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-7 + i * 2, y0);
      ctx.lineTo(-7 + i * 2, y0 + 11);
      ctx.stroke();
    }
  }
  const hull = ctx.createLinearGradient(0, -3.5, 0, 3.5);
  hull.addColorStop(0, '#ffffff');
  hull.addColorStop(1, '#94a3b8');
  ctx.fillStyle = hull;
  poly(ctx, [
    [13, 0],
    [4, -3.6],
    [-10, -3.6],
    [-11.5, 0],
    [-10, 3.6],
    [4, 3.6],
  ]);
  ctx.fill();
  ctx.fillStyle = '#ff8a1f';
  ctx.fillRect(-9, -0.8, 17, 1.6);
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(6, -1.6, 3, 1);
}

/** Singularity Pioneer: tachyon-shielded stealth orbiter with an antimatter plume. */
function tachyonOrbiter(ctx: CanvasRenderingContext2D, flame: number, t: number) {
  ctx.globalCompositeOperation = 'lighter';
  plume(ctx, -6, 0, 22 + 22 * flame, 9, 'rgba(124, 58, 237, 0.35)', 'rgba(124, 58, 237, 0.2)');
  plume(ctx, -6, 0, 14 + 16 * flame, 5, 'rgba(250, 232, 255, 0.95)', 'rgba(217, 70, 239, 0.8)');
  ctx.globalCompositeOperation = 'source-over';
  const shimmer = 0.3 + 0.15 * Math.sin(t * 5);
  const field = ctx.createRadialGradient(0, 0, 4, 0, 0, 16);
  field.addColorStop(0, 'rgba(157, 92, 255, 0)');
  field.addColorStop(1, `rgba(157, 92, 255, ${shimmer * 0.35})`);
  ctx.fillStyle = field;
  ctx.beginPath();
  ctx.ellipse(1, 0, 16, 11, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = `rgba(217, 184, 255, ${shimmer})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(1, 0, 16, 11, 0, t * 2, t * 2 + 1.6);
  ctx.stroke();
  ctx.fillStyle = '#1a1530';
  poly(ctx, [
    [12, 0],
    [-1, -4],
    [-9, -9.5],
    [-6, 0],
    [-9, 9.5],
    [-1, 4],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#bf8cff';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(217, 184, 255, 0.6)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-6, 0);
  ctx.stroke();
}

/** Draw the hull for a chassis. thrust in [0, 1] scales the plume; t animates flicker and shields. */
export function drawProbe(ctx: CanvasRenderingContext2D, chassis: ChassisId, t: number, thrust: number) {
  const flame = thrust * (0.78 + 0.22 * Math.sin(t * 43) * Math.sin(t * 17));
  ctx.save();
  if (chassis === 0) pioneer(ctx, flame);
  else if (chassis === 1) surveyCraft(ctx, flame);
  else if (chassis === 2) lancer(ctx, flame);
  else tachyonOrbiter(ctx, flame, t);
  ctx.restore();
}

/**
 * Tidal disruption: the probe drawn as a glowing filament through tethered nodes, white-hot at
 * the leading (deepest) end and cooling to red along the tail. nodes[0] leads.
 */
export function drawFilament(ctx: CanvasRenderingContext2D, nodes: Array<{ x: number; y: number }>, fade: number) {
  if (nodes.length < 3 || fade <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255, 140, 60, 0.9)';
  ctx.shadowBlur = 10;
  const last = nodes.length - 1;
  const mid = (i: number) => ({ x: (nodes[i].x + nodes[i + 1].x) / 2, y: (nodes[i].y + nodes[i + 1].y) / 2 });
  for (let i = 1; i < last; i++) {
    const f = i / last;
    const a = i === 1 ? nodes[0] : mid(i - 1);
    const b = i === last - 1 ? nodes[last] : mid(i);
    ctx.strokeStyle = `rgba(255, ${Math.round(240 - 150 * f)}, ${Math.round(215 - 195 * f)}, ${(1 - f * 0.55) * fade})`;
    ctx.lineWidth = 3.4 * (1 - f) + 0.7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(nodes[i].x, nodes[i].y, b.x, b.y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(255, 250, 235, ${fade})`;
  for (const node of nodes) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, 0.9, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Spent ascent stage left behind on eject: steel tank, nozzle, gold separation ring. */
export function drawSpentStage(ctx: CanvasRenderingContext2D) {
  const tank = ctx.createLinearGradient(0, -3.4, 0, 3.4);
  tank.addColorStop(0, '#e2e8f0');
  tank.addColorStop(1, '#475569');
  ctx.fillStyle = tank;
  ctx.fillRect(-7, -3.4, 12, 6.8);
  ctx.fillStyle = '#334155';
  poly(ctx, [
    [-7, -2.2],
    [-11, -3.6],
    [-11, 3.6],
    [-7, 2.2],
  ]);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(5, -3.6, 1.4, 7.2);
}
