import React, { useEffect, useRef } from 'react';
import type { BodyId } from '../lib/slingshot';

export type CanvasPhase = 'idle' | 'burning' | 'survived' | 'captured' | 'ejected' | 'complete';

export interface CanvasScene {
  key: number; // bump to start a new transition
  phase: CanvasPhase;
  body: BodyId;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
  size: number;
}

interface Star {
  x: number;
  y: number;
  depth: number;
}

const APPROACH_MS = 1100;
const EXIT_MS = 1200;
const CAPTURE_MS = 950;
const BODY_RADIUS: Record<BodyId, number> = { 0: 30, 1: 56, 2: 18 };
const TRAIL_COLOR: Record<CanvasPhase, string> = {
  idle: '#38bdf8',
  burning: '#38bdf8',
  survived: '#4ade80',
  captured: '#f87171',
  ejected: '#fbbf24',
  complete: '#fbbf24',
};
const FIREWORK_COLORS = ['#fbbf24', '#4ade80', '#38bdf8', '#f472b6'];

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.2, x, y, r);
  g.addColorStop(0, '#f1f5f9');
  g.addColorStop(0.6, '#94a3b8');
  g.addColorStop(1, '#334155');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(51, 65, 85, 0.55)';
  for (const [dx, dy, cr] of [
    [-0.35, 0.1, 0.22],
    [0.3, -0.3, 0.15],
    [0.2, 0.4, 0.12],
    [-0.1, -0.45, 0.09],
  ]) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawJupiter(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y - r, x, y + r);
  const bands = ['#fde68a', '#d97706', '#fef3c7', '#b45309', '#fcd34d', '#92400e', '#fde68a'];
  bands.forEach((c, i) => g.addColorStop(i / (bands.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.fillStyle = 'rgba(185, 28, 28, 0.75)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3 + Math.sin(t * 0.3) * 4, y + r * 0.28, r * 0.2, r * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  const shade = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.3, x, y, r);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function drawPulsar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 2.2);
  for (const dir of [-1, 1]) {
    const beam = ctx.createLinearGradient(0, 0, 0, dir * 220);
    beam.addColorStop(0, 'rgba(224, 242, 254, 0.9)');
    beam.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-18, dir * 220);
    ctx.lineTo(18, dir * 220);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const pulse = (t * 1.25) % 1;
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.6 * (1 - pulse)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r + pulse * 90, 0, Math.PI * 2);
  ctx.stroke();
  const core = ctx.createRadialGradient(x, y, 1, x, y, r * 2.4);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.3, '#7dd3fc');
  core.addColorStop(1, 'rgba(14, 165, 233, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
}

// Blender-rendered spin loops (scripts/blender/render_bodies.py): 36 frames in a 6x6 sheet,
// sphere diameter = 2 / 2.2 of a frame. Procedural drawing covers the time before they load.
interface SpinSheet {
  img: HTMLImageElement;
  ready: boolean;
  periodS: number;
}
const SHEET_COLS = 6;
const SHEET_FRAMES = 36;
const FRAME_PER_RADIUS = 2.2;

function loadSheet(name: string, periodS: number): SpinSheet {
  const sheet: SpinSheet = { img: new Image(), ready: false, periodS };
  sheet.img.onload = () => {
    sheet.ready = true;
  };
  sheet.img.onerror = () => console.warn(`Sprite ${name} failed to load; using procedural body`);
  sheet.img.src = `./sprites/${name}.webp`;
  return sheet;
}

const SHEETS: Record<BodyId, SpinSheet> = {
  0: loadSheet('moon', 40),
  1: loadSheet('jupiter', 14),
  2: loadSheet('pulsar', 1.5),
};

/** Draw the spin loop at time t, crossfading between neighbouring frames for smooth rotation. */
function drawSpin(ctx: CanvasRenderingContext2D, sheet: SpinSheet, x: number, y: number, r: number, t: number) {
  const cell = sheet.img.naturalWidth / SHEET_COLS;
  const size = r * FRAME_PER_RADIUS;
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

function drawBody(ctx: CanvasRenderingContext2D, body: BodyId, x: number, y: number, t: number) {
  const r = BODY_RADIUS[body];
  const sheet = SHEETS[body];
  if (body === 2) {
    drawPulsar(ctx, x, y, r, t);
    if (sheet.ready) drawSpin(ctx, sheet, x, y, r, t);
    return;
  }
  if (!sheet.ready) {
    if (body === 0) drawMoon(ctx, x, y, r);
    else drawJupiter(ctx, x, y, r, t);
    return;
  }
  if (body === 1) {
    const halo = ctx.createRadialGradient(x, y, r * 0.95, x, y, r * 1.3);
    halo.addColorStop(0, 'rgba(251, 191, 36, 0.18)');
    halo.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  drawSpin(ctx, sheet, x, y, r, t);
}

// Cosmetic particle spray; Math.random is fine here, it never touches game outcomes.
function burst(particles: Particle[], x: number, y: number, color: string, count: number, speed: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random());
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.6 + Math.random(), color, size: 1.5 + Math.random() * 2 });
  }
}

export const TourCanvas: React.FC<{ scene: CanvasScene; className?: string }> = ({ scene, className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let raf = 0;
    let last = performance.now();
    let activeKey = -1;
    let phaseStart = last;
    let currentPhase: CanvasPhase = sceneRef.current.phase;
    let prevPhase: CanvasPhase = currentPhase;
    let from = { x: 0, y: 0, angle: -Math.PI / 2 };
    const probe = { x: -40, y: 0, angle: -Math.PI / 2, visible: true };
    let shake = 0;
    let width = 0;
    let height = 0;
    const trail: Array<{ x: number; y: number }> = [];
    const particles: Particle[] = [];
    const stars: Star[] = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), depth: 0.2 + Math.random() * 0.8 }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const { key, phase, body } = sceneRef.current;
      const cx = width * 0.56;
      const cy = height * 0.5;
      const rp = BODY_RADIUS[body] + 38;

      if (key !== activeKey) {
        activeKey = key;
        prevPhase = currentPhase;
        currentPhase = phase;
        phaseStart = now;
        from = { x: probe.x, y: probe.y, angle: probe.angle };
        shake = 0;
      }
      const elapsed = now - phaseStart;

      // Probe kinematics per phase
      probe.visible = true;
      if (phase === 'idle') {
        probe.angle = t * 0.7;
        probe.x = cx + Math.cos(probe.angle) * rp * 1.9;
        probe.y = cy + Math.sin(probe.angle) * rp * 1.25;
      } else if (phase === 'burning') {
        const fromCoast = prevPhase === 'survived';
        const startX = fromCoast ? from.x : -30;
        const startY = fromCoast ? from.y : height * 0.82;
        if (elapsed < APPROACH_MS) {
          const p = easeInOut(elapsed / APPROACH_MS);
          const ctrlX = cx - rp * 1.6;
          const ctrlY = cy - rp;
          const inv = 1 - p;
          probe.x = inv * inv * startX + 2 * inv * p * ctrlX + p * p * cx;
          probe.y = inv * inv * startY + 2 * inv * p * ctrlY + p * p * (cy - rp);
          probe.angle = -Math.PI / 2;
        } else {
          // Holding periapsis while the VRF resolves: the orbit tightens and speeds up.
          const hold = (elapsed - APPROACH_MS) / 1000;
          probe.angle = -Math.PI / 2 + hold * (2.4 + hold * 0.6);
          probe.x = cx + Math.cos(probe.angle) * rp;
          probe.y = cy + Math.sin(probe.angle) * rp;
        }
        if (Math.random() < 0.8) {
          particles.push({ x: probe.x, y: probe.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 1, decay: 2.2, color: '#7dd3fc', size: 2 });
        }
      } else if (phase === 'survived' || phase === 'complete') {
        const s = elapsed / 1000;
        if (elapsed < EXIT_MS) {
          const dist = 80 * s + 900 * s * s;
          probe.x = from.x - Math.sin(from.angle) * dist;
          probe.y = from.y + Math.cos(from.angle) * dist * 0.55 - dist * 0.25;
          if (elapsed < 30) burst(particles, from.x, from.y, phase === 'complete' ? '#fbbf24' : '#4ade80', 40, 160);
        } else {
          const p = clamp01((elapsed - EXIT_MS) / 700);
          probe.x = -30 + p * (width * 0.2 + 30);
          probe.y = height * 0.5 + Math.sin(t * 1.8) * 6;
          probe.angle = 0;
        }
        if (phase === 'complete' && Math.random() < 0.08) {
          const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
          burst(particles, Math.random() * width, Math.random() * height * 0.6, color, 30, 120);
        }
      } else if (phase === 'captured') {
        const p = clamp01(elapsed / CAPTURE_MS);
        const angle = from.angle + p * Math.PI * 5;
        const r = rp * (1 - easeInOut(p)) + BODY_RADIUS[body] * 0.2 * easeInOut(p);
        probe.x = cx + Math.cos(angle) * r;
        probe.y = cy + Math.sin(angle) * r;
        probe.angle = angle;
        if (p >= 1) {
          if (shake === 0) {
            shake = 14;
            burst(particles, cx, cy, '#f87171', 70, 220);
            burst(particles, cx, cy, '#fb923c', 40, 120);
          }
          probe.visible = false;
        }
      } else if (phase === 'ejected') {
        const s = elapsed / 1000;
        probe.x = from.x - 120 * s - 500 * s * s;
        probe.y = from.y - 200 * s - 400 * s * s;
        if (elapsed < 30) burst(particles, from.x, from.y, '#fbbf24', 50, 140);
      }

      // Background: parallax starfield, streaking while the probe is boosted
      const exiting = (phase === 'survived' || phase === 'complete') && elapsed < EXIT_MS;
      const speed = phase === 'burning' ? 60 : exiting ? 420 : phase === 'survived' || phase === 'complete' ? 40 : 12;
      ctx.save();
      if (shake > 0.1) {
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        shake *= 0.9;
      }
      ctx.fillStyle = '#030712';
      ctx.fillRect(-20, -20, width + 40, height + 40);
      for (const star of stars) {
        star.x -= (speed * star.depth * dt) / Math.max(width, 1);
        if (star.x < 0) {
          star.x += 1;
          star.y = Math.random();
        }
        const sx = star.x * width;
        const sy = star.y * height;
        const streak = Math.max(1, (speed * star.depth) / 30);
        ctx.strokeStyle = `rgba(226, 232, 240, ${0.25 + star.depth * 0.6})`;
        ctx.lineWidth = star.depth * 1.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + streak, sy);
        ctx.stroke();
      }

      // Focal body, dimmed while coasting between legs
      const coasting = (phase === 'survived' && elapsed > EXIT_MS) || phase === 'ejected';
      ctx.globalAlpha = coasting ? 0.35 : 1;
      drawBody(ctx, body, cx, cy, t);
      ctx.globalAlpha = 1;

      // Periapsis ring: the corridor the probe must hold
      if (phase === 'burning' || phase === 'idle') {
        ctx.strokeStyle = phase === 'burning' ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.15)';
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, rp, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Trail
      const prev = trail[trail.length - 1];
      trail.push({ x: probe.x, y: probe.y });
      if (trail.length > 36) trail.shift();
      if (probe.visible) {
        ctx.strokeStyle = TRAIL_COLOR[phase];
        ctx.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          ctx.globalAlpha = (i / trail.length) * 0.8;
          ctx.lineWidth = (i / trail.length) * 3;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= p.decay * dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // Probe, nose along its direction of travel
      if (probe.visible) {
        const heading = prev ? Math.atan2(probe.y - prev.y, probe.x - prev.x) : 0;
        ctx.save();
        ctx.translate(probe.x, probe.y);
        ctx.rotate(heading);
        ctx.shadowColor = TRAIL_COLOR[phase];
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(-6, -5);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className ?? 'w-full h-full block'} />;
};
