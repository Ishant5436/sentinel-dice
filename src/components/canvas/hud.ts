// Cockpit instruments drawn in screen space over the scene: the orbital navball (attitude
// director) and the corner brackets that frame the viewport.

const TAU = Math.PI * 2;
const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);

export interface Attitude {
  /** Ball roll: 0 when flying prograde along a circular orbit. */
  roll: number;
  /** Flight path angle above the local horizon, radians. */
  pitch: number;
  /** Screen heading of the velocity vector, radians. */
  heading: number;
  /** Prograde marker offset from the nose, in ball radii (turbulence). */
  slip: number;
}

/** Apollo/Kerbal-style attitude sphere: sky above the local horizon, ground below, prograde marker. */
export function drawNavball(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, att: Attitude) {
  ctx.save();
  const bezel = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
  bezel.addColorStop(0, '#4a4380');
  bezel.addColorStop(0.5, '#16122a');
  bezel.addColorStop(1, '#2b2450');
  ctx.fillStyle = bezel;
  ctx.beginPath();
  ctx.arc(x, y, R + 10, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Heading tape around the bezel.
  const deg = ((att.heading * 180) / Math.PI + 450) % 360;
  for (let d = 0; d < 360; d += 10) {
    const a = ((d - deg) * Math.PI) / 180 - Math.PI / 2;
    const major = d % 30 === 0;
    const r1 = R + 2.5;
    const r2 = R + (major ? 8 : 5);
    ctx.strokeStyle = major ? 'rgba(226, 232, 240, 0.85)' : 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = major ? 1.2 : 0.8;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
    ctx.stroke();
  }
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.moveTo(x, y - R - 3);
  ctx.lineTo(x - 4, y - R - 11);
  ctx.lineTo(x + 4, y - R - 11);
  ctx.closePath();
  ctx.fill();

  // The ball.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(att.roll);
  const horizon = Math.max(-R * 1.2, Math.min(R * 1.2, (att.pitch / (Math.PI / 2)) * R));
  const sky = ctx.createLinearGradient(0, -R, 0, horizon);
  sky.addColorStop(0, '#0b2a55');
  sky.addColorStop(1, '#2f8fd8');
  ctx.fillStyle = sky;
  ctx.fillRect(-R * 1.6, -R * 2.6, R * 3.2, R * 2.6 + horizon);
  const ground = ctx.createLinearGradient(0, horizon, 0, R);
  ground.addColorStop(0, '#c2621b');
  ground.addColorStop(1, '#4a1d08');
  ctx.fillStyle = ground;
  ctx.fillRect(-R * 1.6, horizon, R * 3.2, R * 2.6);

  // Meridians slide with heading: x = sin(lon) cos(lat) R.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 12; k++) {
    const lon = wrapPi((k * TAU) / 12 - att.heading);
    if (Math.abs(lon) > Math.PI / 2) continue;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const lat = -Math.PI / 2 + (i / 16) * Math.PI;
      const px = Math.sin(lon) * Math.cos(lat) * R;
      const py = horizon - Math.sin(lat) * R;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Pitch ladder.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = '600 7px "Chakra Petch", sans-serif';
  ctx.textBaseline = 'middle';
  for (let p = -60; p <= 60; p += 15) {
    if (p === 0) continue;
    const py = horizon - (p / 90) * R;
    const hw = p % 30 === 0 ? R * 0.34 : R * 0.18;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-hw, py);
    ctx.lineTo(hw, py);
    ctx.stroke();
    if (p % 30 === 0) ctx.fillText(String(Math.abs(p)), hw + 2, py);
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-R * 1.5, horizon);
  ctx.lineTo(R * 1.5, horizon);
  ctx.stroke();
  // Radial-out marker sits at the zenith of the local sky.
  const zen = horizon - R * 0.78;
  if (zen > -R * 0.95) {
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, zen, 4.5, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, zen, 1.2, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  // Sphere shading and specular highlight.
  const shade = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.08, x, y, R);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  shade.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.fill();

  // Prograde marker (drifts with turbulence) and the fixed nose chevron.
  const gx = x + att.slip * R;
  const gy = y - att.slip * R * 0.6;
  ctx.strokeStyle = '#a3e635';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(gx, gy, R * 0.12, 0, TAU);
  ctx.moveTo(gx, gy - R * 0.12);
  ctx.lineTo(gx, gy - R * 0.22);
  ctx.moveTo(gx - R * 0.12, gy);
  ctx.lineTo(gx - R * 0.22, gy);
  ctx.moveTo(gx + R * 0.12, gy);
  ctx.lineTo(gx + R * 0.22, gy);
  ctx.stroke();
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - R * 0.45, y);
  ctx.lineTo(x - R * 0.17, y);
  ctx.lineTo(x - R * 0.08, y + R * 0.11);
  ctx.lineTo(x, y);
  ctx.lineTo(x + R * 0.08, y + R * 0.11);
  ctx.lineTo(x + R * 0.17, y);
  ctx.lineTo(x + R * 0.45, y);
  ctx.stroke();

  ctx.font = '600 9px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  const pitchDeg = (att.pitch * 180) / Math.PI;
  ctx.fillText(`HDG ${String(Math.round(deg) % 360).padStart(3, '0')}  PITCH ${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(0)}`, x, y + R + 24);
  ctx.restore();
}

/** Corner brackets and edge ticks that frame the viewport like a cockpit display. */
export function drawHudFrame(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const m = 8;
  const L = 20;
  ctx.save();
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [
    [m, m, 1, 1],
    [w - m, m, -1, 1],
    [m, h - m, 1, -1],
    [w - m, h - m, -1, -1],
  ]) {
    ctx.moveTo(cx, cy + sy * L);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * L, cy);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 12; i++) {
    const ty = (h * i) / 12;
    ctx.moveTo(w - m, ty);
    ctx.lineTo(w - m - (i % 3 === 0 ? 7 : 4), ty);
  }
  ctx.stroke();
  ctx.restore();
}
