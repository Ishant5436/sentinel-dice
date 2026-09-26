import React, { useEffect, useRef } from 'react';
import type { BodyId } from '../lib/slingshot';
import type { ChassisId } from '../lib/career';
import { BODY_LIGHT, BODY_RADIUS, PERIAPSIS, drawBody, paintNebula, pulsarBeamAngle } from './canvas/celestial';
import { drawFilament, drawProbe, drawSpentStage } from './canvas/craft';
import { drawHudFrame, drawNavball, type Attitude } from './canvas/hud';

export type CanvasPhase = 'idle' | 'burning' | 'survived' | 'captured' | 'ejected' | 'complete';

export interface CanvasScene {
  key: number; // bump to start a new transition
  phase: CanvasPhase;
  body: BodyId;
  /** Planned next target: drawn as a dotted trajectory with its prospective multiplier. */
  preview?: { body: BodyId; label: string } | null;
  /** Probe hull, unlocked by pilot rank. */
  chassis: ChassisId;
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
  twinkle: number;
}

const APPROACH_MS = 1100;
const EXIT_MS = 1200;
const CAPTURE_MS = 1250;
// Camera: push in to periapsis, snap wide to show the escape arc, and lean in on a capture.
const PERIAPSIS_ZOOM = 1.65;
const WIDE_ZOOM = 0.85;
const CAPTURE_ZOOM = 1.9;
const WAVE_LIFE_S = 2.2;
const MAX_WAVES = 6;
const FILAMENT_NODES = 8;
/** How far tidal shear stretches the probe before it is lost, per body. */
const TIDAL: Record<BodyId, number> = { 0: 0.25, 1: 0.45, 2: 0.8, 3: 1 };
const TRAIL_COLOR: Record<CanvasPhase, string> = {
  idle: '#38bdf8',
  burning: '#38bdf8',
  survived: '#4ade80',
  captured: '#f87171',
  ejected: '#fbbf24',
  complete: '#fbbf24',
};
const FIREWORK_COLORS = ['#fbbf24', '#4ade80', '#38bdf8', '#f472b6'];

const TAU = Math.PI * 2;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** Frame-rate independent exponential approach toward a target. */
const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
/** Pulsar shockwave front: steady expansion with a sinusoidal breathing term. */
const waveRadius = (age: number) => 18 + 240 * age + 7 * Math.sin(age * 16);

/** Grand Tour finale: stars stretch into warp streaks (length ~ v^2), then a golden bloom washes in. */
function warpAt(ms: number) {
  const warp = ms < 400 ? 0 : ms < 1600 ? ((ms - 400) / 1200) ** 2 : ms < 3200 ? 1 : Math.max(0, 1 - (ms - 3200) / 900);
  const bloom = ms < 1400 ? 0 : ms < 1800 ? ((ms - 1400) / 400) * 0.7 : Math.max(0, 0.7 * (1 - (ms - 1800) / 1600));
  return { warp, bloom };
}

// Cosmetic particle spray; Math.random is fine here, it never touches game outcomes.
function burst(particles: Particle[], x: number, y: number, color: string, count: number, speed: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
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
    let from = { x: 0, y: 0, angle: -Math.PI / 2, heading: 0 };
    const probe = { x: -40, y: 0, angle: -Math.PI / 2, heading: 0, visible: true };
    let shake = 0;
    let phaseSim = 0; // phase clock that can run slow (periapsis slow-motion)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let nebula: HTMLCanvasElement | null = null;
    const trail: Array<{ x: number; y: number }> = [];
    const particles: Particle[] = [];
    const stars: Star[] = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), depth: 0.2 + Math.random() * 0.8, twinkle: 1 + Math.random() * 3 }));
    const cam = { zoom: 1, fx: 0, fy: 0, ready: false };
    const att: Attitude = { roll: 0, pitch: 0, heading: 0, slip: 0 };
    const waves: Array<{ born: number; strength: number }> = [];
    let prevBeamRel: number | null = null;
    let pings: Array<{ born: number; x: number; y: number }> = [];
    let stage: { x: number; y: number; vx: number; vy: number; rot: number; vr: number } | null = null;
    let captureDone = false;
    let implodeAt = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      nebula = width > 0 && height > 0 ? paintNebula(width, height) : null;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const { key, phase, body, preview, chassis } = sceneRef.current;
      const cx = width * 0.5;
      const cy = height * 0.53;
      const rp = PERIAPSIS[body];
      // Base world scale so the bodies fill larger viewports instead of floating in empty space.
      const ws = Math.max(0.75, Math.min(1.5, Math.min(width / 760, height / 560)));
      if (!cam.ready) {
        cam.fx = cx;
        cam.fy = cy;
        cam.ready = true;
      }

      if (key !== activeKey) {
        activeKey = key;
        prevPhase = currentPhase;
        currentPhase = phase;
        phaseStart = now;
        phaseSim = 0;
        from = { x: probe.x, y: probe.y, angle: probe.angle, heading: probe.heading };
        shake = 0;
        captureDone = false;
        implodeAt = 0;
        pings = [];
        // Eject: explosive bolts fire and the spent ascent stage falls away retrograde.
        stage = phase === 'ejected' ? { x: probe.x, y: probe.y, vx: -34, vy: 48, rot: probe.heading, vr: -2.4 } : null;
      }
      const phaseMs = now - phaseStart;
      // Periapsis slow-motion: time runs at 80% for 300 ms as the probe reaches closest approach,
      // and again for the first 300 ms of the outcome, then snaps back to full speed.
      const slowMo =
        (phase === 'burning' && phaseSim >= APPROACH_MS - 150 && phaseSim < APPROACH_MS + 150) ||
        ((phase === 'survived' || phase === 'captured' || phase === 'complete') && phaseSim < 300);
      phaseSim += dt * 1000 * (slowMo ? 0.8 : 1);
      const elapsed = phaseSim;
      // Turbulence builds while holding periapsis around the Pulsar or the Black hole.
      const heavy = body === 2 || body === 3;
      const turbulence =
        heavy && phase === 'burning' && !reduceMotion
          ? (body === 3 ? 2.6 : 1.4) * (elapsed > APPROACH_MS ? 1 + Math.min(1.5, (elapsed - APPROACH_MS) / 1500) : elapsed / APPROACH_MS)
          : 0;

      // Probe kinematics per phase (world units)
      probe.visible = true;
      let thrust = 0.35;
      let filament: Array<{ x: number; y: number }> | null = null;
      if (phase === 'idle') {
        probe.angle = t * 0.7;
        probe.x = cx + Math.cos(probe.angle) * rp * 1.9;
        probe.y = cy + Math.sin(probe.angle) * rp * 1.25;
        thrust = 0.3;
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
          thrust = 1;
        } else {
          // Holding periapsis while the VRF resolves: the orbit tightens and speeds up.
          const hold = (elapsed - APPROACH_MS) / 1000;
          probe.angle = -Math.PI / 2 + hold * (2.4 + hold * 0.6);
          probe.x = cx + Math.cos(probe.angle) * rp;
          probe.y = cy + Math.sin(probe.angle) * rp;
          thrust = 0.6;
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
          thrust = 1;
          if (elapsed < 30) burst(particles, from.x, from.y, phase === 'complete' ? '#fbbf24' : '#4ade80', 40, 160);
        } else {
          const p = clamp01((elapsed - EXIT_MS) / 700);
          probe.x = -30 + p * (width * 0.2 + 30);
          probe.y = height * 0.5 + Math.sin(t * 1.8) * 6;
          probe.angle = 0;
          thrust = 0.45;
        }
        if (phase === 'complete' && phaseMs > 2600 && Math.random() < 0.08) {
          const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
          burst(particles, cam.fx + (Math.random() - 0.5) * width, cam.fy - Math.random() * height * 0.5, color, 30, 120);
        }
      } else if (phase === 'captured') {
        // Tidal disruption: the probe spirals in and is pulled into a filament of 8 tethered
        // nodes, each stretched further out along the radial vector as the shear grows.
        const p = clamp01(elapsed / CAPTURE_MS);
        const sink = easeInOut(p);
        const angle = from.angle + p * Math.PI * (4 + 3 * p);
        const bodyR = BODY_RADIUS[body];
        const rHead = rp * (1 - sink) + bodyR * 0.15 * sink;
        probe.x = cx + Math.cos(angle) * rHead;
        probe.y = cy + Math.sin(angle) * rHead;
        probe.angle = angle;
        probe.visible = p < 0.12;
        const tidal = TIDAL[body];
        const stretch = tidal * 9 * Math.min(1, p * 2.2) * (1 - sink * 0.85);
        const lag = tidal * (0.08 + 0.3 * p);
        if (p < 1) {
          filament = Array.from({ length: FILAMENT_NODES }, (_, i) => {
            const a = angle - i * lag;
            const reach = rHead + i * stretch;
            return { x: cx + Math.cos(a) * reach, y: cy + Math.sin(a) * reach };
          });
        }
        if (p >= 1 && !captureDone) {
          captureDone = true;
          if (body === 3) {
            // Nothing escapes a horizon: a redshifted implosion instead of an explosion.
            implodeAt = now;
            shake = 8;
            burst(particles, cx, cy, '#7f1d1d', 24, 60);
          } else {
            shake = 14;
            burst(particles, cx, cy, '#f87171', 70, 220);
            burst(particles, cx, cy, '#fb923c', 40, 120);
          }
        }
        if (p >= 0.12) thrust = 0;
      } else if (phase === 'ejected') {
        // The orbital module burns up and across the view toward deep space; the stage drops away.
        const s = elapsed / 1000;
        probe.x = from.x + 150 * s + 380 * s * s;
        probe.y = from.y - 170 * s - 260 * s * s;
        thrust = 1;
        if (elapsed < 30) burst(particles, from.x, from.y, '#fbbf24', 50, 140);
      }
      const prev = trail[trail.length - 1];
      if (prev) {
        const hx = probe.x - prev.x;
        const hy = probe.y - prev.y;
        if (hx * hx + hy * hy > 0.01) probe.heading = Math.atan2(hy, hx);
      }

      // Pulsar: every time a beam sweeps across the probe, an electromagnetic ripple leaves the star.
      if (body === 2 && (phase === 'idle' || phase === 'burning')) {
        const rel = (((Math.atan2(probe.y - cy, probe.x - cx) - pulsarBeamAngle(t)) % Math.PI) + Math.PI) % Math.PI;
        if (prevBeamRel !== null && Math.abs(rel - prevBeamRel) > Math.PI / 2) {
          waves.push({ born: t, strength: phase === 'burning' ? 1 : 0.55 });
          if (waves.length > MAX_WAVES) waves.shift();
          if (!reduceMotion) shake = Math.max(shake, phase === 'burning' ? 4 : 1.5);
        }
        prevBeamRel = rel;
      } else prevBeamRel = null;
      while (waves.length && t - waves[0].born > WAVE_LIFE_S) waves.shift();

      // Camera choreography
      let zoomTarget = 1;
      let focusX = cx;
      let focusY = cy;
      let rate = 2.5;
      if (!reduceMotion) {
        if (phase === 'burning') {
          const p = easeInOut(clamp01(elapsed / APPROACH_MS));
          zoomTarget = 1 + (PERIAPSIS_ZOOM - 1) * p;
          focusX = cx + (probe.x - cx) * 0.25 * p;
          focusY = cy + (probe.y - cy) * 0.25 * p;
          rate = 4;
        } else if (phase === 'captured') {
          zoomTarget = CAPTURE_ZOOM;
          rate = 2.2;
        } else if (phase === 'survived' || phase === 'complete') {
          const wide = phase === 'complete' || elapsed < EXIT_MS + 500;
          zoomTarget = wide ? WIDE_ZOOM : 1;
          rate = wide ? 9 : 1.6;
        } else if (phase === 'ejected') {
          // Lean toward the separation point so the bolts, stage and pings play out in frame.
          zoomTarget = WIDE_ZOOM;
          focusX = cx + (from.x - cx) * 0.45;
          focusY = cy + (from.y - cy) * 0.45;
          rate = 3;
        }
      }
      cam.zoom = approach(cam.zoom, zoomTarget, rate, dt);
      cam.fx = approach(cam.fx, focusX, rate, dt);
      cam.fy = approach(cam.fy, focusY, rate, dt);
      const Z = ws * cam.zoom;
      const bx = (cx - cam.fx) * Z + width / 2;
      const by = (cy - cam.fy) * Z + height / 2;

      const exiting = (phase === 'survived' || phase === 'complete') && elapsed < EXIT_MS;
      const coasting = (phase === 'survived' && elapsed > EXIT_MS) || phase === 'ejected';
      const speed = phase === 'burning' ? 60 : exiting ? 420 : phase === 'survived' || phase === 'complete' ? 40 : 12;
      const jolt = turbulence + (shake > 0.1 && !reduceMotion ? shake : 0);
      const jx = jolt > 0 ? (Math.random() - 0.5) * jolt : 0;
      const jy = jolt > 0 ? (Math.random() - 0.5) * jolt : 0;
      if (shake > 0.1) shake *= 0.9;
      else shake = 0;
      const finale = phase === 'complete' ? warpAt(phaseMs) : { warp: 0, bloom: 0 };
      const warp = reduceMotion ? 0 : finale.warp;
      const bloom = reduceMotion ? finale.bloom * 0.4 : finale.bloom;

      // ---- Deep field (screen space)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, width, height);
      if (nebula) {
        const nz = 1 + (cam.zoom - 1) * 0.08;
        const ox = (cam.fx - cx) * 0.04;
        const oy = (cam.fy - cy) * 0.04;
        ctx.drawImage(nebula, width / 2 - (width / 2) * nz - ox - 12, height / 2 - (height / 2) * nz - oy - 12, width * nz + 24, height * nz + 24);
      }
      const glowR = (BODY_RADIUS[body] * 5 + 80) * Z;
      const glow = ctx.createRadialGradient(bx, by, 0, bx, by, glowR);
      glow.addColorStop(0, `rgba(${BODY_LIGHT[body]}, ${coasting ? 0.05 : 0.14})`);
      glow.addColorStop(1, `rgba(${BODY_LIGHT[body]}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const lensing = body === 3 && phase !== 'ejected' && !coasting;
      const rs = BODY_RADIUS[3] * Z;
      const diag = Math.hypot(width, height);
      const parallax = (cam.zoom - 1) * 0.25;
      for (const star of stars) {
        if (warp > 0.01) {
          // Hyperspace: stars rush outward from the vanishing point.
          const k = 1 + warp * warp * star.depth * dt * 5;
          star.x = 0.5 + (star.x - 0.5) * k;
          star.y = 0.5 + (star.y - 0.5) * k;
          if (star.x < 0 || star.x > 1 || star.y < 0 || star.y > 1) {
            star.x = 0.5 + (Math.random() - 0.5) * 0.3;
            star.y = 0.5 + (Math.random() - 0.5) * 0.3;
          }
        } else {
          star.x -= (speed * star.depth * dt) / Math.max(width, 1);
          if (star.x < 0) {
            star.x += 1;
            star.y = Math.random();
          }
        }
        let px = width / 2 + (star.x * width - width / 2) * (1 + parallax * star.depth) + jx * star.depth;
        let py = height / 2 + (star.y * height - height / 2) * (1 + parallax * star.depth) + jy * star.depth;
        if (lensing) {
          // Gravitational lensing: starlight near the horizon is pushed outward around it.
          const dx = px - bx;
          const dy = py - by;
          const d = Math.hypot(dx, dy) || 1;
          if (d < rs * 7) {
            const push = (rs * rs * 1.8) / Math.max(d, rs * 0.6);
            px = bx + (dx / d) * (d + push);
            py = by + (dy / d) * (d + push);
          }
        }
        for (const wave of waves) {
          // Each shockwave front bends the starlight it passes through.
          const age = t - wave.born;
          const dx = px - bx;
          const dy = py - by;
          const d = Math.hypot(dx, dy) || 1;
          const band = (d - waveRadius(age) * Z) / 16;
          if (Math.abs(band) < 3) {
            const push = 9 * wave.strength * (1 - age / WAVE_LIFE_S) * Math.exp(-band * band);
            px += (dx / d) * push;
            py += (dy / d) * push;
          }
        }
        const alpha = (0.25 + star.depth * 0.6) * (0.78 + 0.22 * Math.sin(t * star.twinkle + star.y * 40));
        ctx.beginPath();
        if (warp > 0.01) {
          const dx = px - width / 2;
          const dy = py - height / 2;
          const d = Math.hypot(dx, dy) || 1;
          const len = (3 + 520 * warp * warp * star.depth) * (d / diag);
          ctx.strokeStyle = `rgba(255, 240, 210, ${Math.min(1, alpha + warp * 0.4)})`;
          ctx.lineWidth = star.depth * 1.6;
          ctx.moveTo(px, py);
          ctx.lineTo(px + (dx / d) * len, py + (dy / d) * len);
        } else {
          ctx.strokeStyle = `rgba(226, 232, 240, ${alpha})`;
          ctx.lineWidth = star.depth * 1.4;
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.max(1, (speed * star.depth) / 30), py);
        }
        ctx.stroke();
      }

      // ---- World (camera space)
      ctx.save();
      ctx.translate(width / 2 + jx, height / 2 + jy);
      ctx.scale(Z, Z);
      ctx.translate(-cam.fx, -cam.fy);

      ctx.globalAlpha = coasting ? 0.35 : 1;
      drawBody(ctx, body, cx, cy, t);
      ctx.globalAlpha = 1;
      if (lensing) {
        ctx.strokeStyle = 'rgba(253, 186, 116, 0.12)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, BODY_RADIUS[3] * 1.9, 0, TAU);
        ctx.stroke();
      }
      if (implodeAt && phase === 'captured' && now - implodeAt < 600) {
        const q = (now - implodeAt) / 600;
        ctx.strokeStyle = `rgba(255, 120, 60, ${0.85 * (1 - q)})`;
        ctx.lineWidth = 3 * (1 - q) + 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, BODY_RADIUS[3] * (3.2 - 2.2 * q), 0, TAU);
        ctx.stroke();
      }

      for (const wave of waves) {
        const age = t - wave.born;
        const life = (1 - age / WAVE_LIFE_S) ** 1.5;
        const radius = waveRadius(age);
        ctx.save();
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        for (const [offset, lineWidth, alpha] of [
          [0, 2, 0.55],
          [12, 1.2, 0.32],
          [26, 0.8, 0.18],
        ]) {
          if (radius - offset <= 0) continue;
          ctx.strokeStyle = `rgba(125, 211, 252, ${alpha * wave.strength * life})`;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          ctx.arc(cx, cy, radius - offset, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Periapsis ring: the corridor the probe must hold, with lock-on brackets while burning
      if (phase === 'burning' || phase === 'idle') {
        ctx.strokeStyle = phase === 'burning' ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.15)';
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, rp, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        if (phase === 'burning') {
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.65)';
          ctx.lineWidth = 1.5;
          for (let k = 0; k < 4; k++) {
            const a = t * 0.8 + (k * TAU) / 4;
            ctx.beginPath();
            ctx.arc(cx, cy, rp + 14, a - 0.18, a + 0.18);
            ctx.stroke();
          }
        }
      }

      // Escape trajectory, revealed while the camera is pulled wide after a successful slingshot.
      if ((phase === 'survived' || phase === 'complete') && elapsed < EXIT_MS + 900) {
        const fade = elapsed < EXIT_MS ? 1 : 1 - (elapsed - EXIT_MS) / 900;
        ctx.save();
        ctx.strokeStyle = `rgba(74, 222, 128, ${0.55 * fade})`;
        ctx.shadowColor = '#4ade80';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 6]);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const s = (i / 40) * 1.6;
          const dist = 80 * s + 900 * s * s;
          const x = from.x - Math.sin(from.angle) * dist;
          const y = from.y + Math.cos(from.angle) * dist * 0.55 - dist * 0.25;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Planned trajectory preview: dotted spline to the target body with its prospective multiplier.
      if (preview && (phase === 'idle' || coasting)) {
        const ghost = phase === 'idle' ? null : { x: width * 0.72, y: height * 0.46 };
        const tx = ghost ? ghost.x : cx;
        const ty = ghost ? ghost.y - PERIAPSIS[preview.body] * 0.55 : cy - rp;
        if (ghost) {
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.translate(ghost.x, ghost.y);
          ctx.scale(0.55, 0.55);
          drawBody(ctx, preview.body, 0, 0, t);
          ctx.restore();
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 7]);
        ctx.lineDashOffset = -t * 30;
        ctx.beginPath();
        ctx.moveTo(probe.x, probe.y);
        ctx.quadraticCurveTo((probe.x + tx) / 2, Math.min(probe.y, ty) - 60, tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e0f2fe';
        ctx.font = '600 13px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        // Idle: sit the label above the parking orbit so the circling probe never covers it.
        ctx.fillText(preview.label, tx, ghost ? ty - 12 : cy - rp * 1.25 - 18);
        ctx.restore();
      }

      // Trail
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

      // Eject and bank: bolts, the spent stage tumbling away on retro thrusters, gold data pings.
      if (phase === 'ejected') {
        const s = phaseMs / 1000;
        if (stage) {
          stage.x += stage.vx * dt;
          stage.y += stage.vy * dt;
          stage.rot += stage.vr * dt;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - s / 3);
          ctx.translate(stage.x, stage.y);
          ctx.rotate(stage.rot);
          drawSpentStage(ctx);
          ctx.restore();
          if (s < 0.5 && Math.random() < 0.7) {
            particles.push({
              x: stage.x,
              y: stage.y,
              vx: -stage.vx * 1.5 + (Math.random() - 0.5) * 40,
              vy: -stage.vy * 1.5 + (Math.random() - 0.5) * 40,
              life: 1,
              decay: 2.5,
              color: Math.random() < 0.5 ? '#fdba74' : '#ffffff',
              size: 2,
            });
          }
        }
        const nx = Math.cos(from.heading + Math.PI / 2);
        const ny = Math.sin(from.heading + Math.PI / 2);
        for (let k = 0; k < 4; k++) {
          const age = phaseMs - k * 50;
          if (age < 0 || age > 140) continue;
          const q = age / 140;
          const side = k % 2 ? 6 : -6;
          const fx = from.x + nx * side;
          const fy = from.y + ny * side;
          const r = 10 * (1 - q) + 2;
          const flash = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
          flash.addColorStop(0, `rgba(255, 255, 255, ${1 - q})`);
          flash.addColorStop(0.4, `rgba(253, 224, 71, ${0.8 * (1 - q)})`);
          flash.addColorStop(1, 'rgba(253, 224, 71, 0)');
          ctx.fillStyle = flash;
          ctx.beginPath();
          ctx.arc(fx, fy, r, 0, TAU);
          ctx.fill();
        }
        if (pings.length < 5 && phaseMs > 200 + pings.length * 350) pings.push({ born: now, x: probe.x, y: probe.y });
        for (const ping of pings) {
          const age = (now - ping.born) / 1000;
          if (age > 1.6) continue;
          ctx.strokeStyle = `rgba(251, 191, 36, ${0.8 * (1 - age / 1.6)})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(ping.x, ping.y, 6 + 110 * age, 0, TAU);
          ctx.stroke();
        }
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt + (turbulence ? (Math.random() - 0.5) * turbulence * 0.6 : 0);
        p.y += p.vy * dt + (turbulence ? (Math.random() - 0.5) * turbulence * 0.6 : 0);
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

      // Tidal filament, hidden where it passes inside the body (or behind the horizon).
      if (filament) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - 5000, cy - 5000, 10000, 10000);
        ctx.arc(cx, cy, BODY_RADIUS[body] * (body === 3 ? 1 : 0.95), 0, TAU);
        ctx.clip('evenodd');
        drawFilament(ctx, filament, 1);
        ctx.restore();
      }

      // Probe, nose along its direction of travel, with a soft glow in the phase color
      if (probe.visible) {
        const color = TRAIL_COLOR[phase];
        const halo = ctx.createRadialGradient(probe.x, probe.y, 0, probe.x, probe.y, 22);
        halo.addColorStop(0, `${color}55`);
        halo.addColorStop(1, `${color}00`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(probe.x, probe.y, 22, 0, TAU);
        ctx.fill();
        ctx.save();
        ctx.translate(probe.x, probe.y);
        ctx.rotate(probe.heading);
        drawProbe(ctx, chassis, t, thrust);
        ctx.restore();
      }
      ctx.restore();

      // ---- Cockpit HUD (screen space, no shake)
      // Attitude is measured against the focal body; between bodies (coasting, ejected, lost) the
      // ball settles to level cruise with a gentle drift instead of pointing at the body behind us.
      const radial = Math.atan2(probe.y - cy, probe.x - cx);
      const cruise = coasting || phase === 'captured';
      const rollTarget = cruise ? Math.sin(t * 0.5) * 0.12 : wrapPi(radial - probe.heading + Math.PI / 2);
      const pitchTarget = cruise ? Math.sin(t * 0.7) * 0.08 : Math.asin(Math.max(-1, Math.min(1, Math.cos(probe.heading - radial))));
      att.roll += wrapPi(rollTarget - att.roll) * (1 - Math.exp(-6 * dt));
      att.pitch = approach(att.pitch, pitchTarget, 5, dt);
      att.heading = probe.heading;
      att.slip = approach(att.slip, turbulence ? (Math.random() - 0.5) * 0.06 * turbulence : 0, turbulence ? 12 : 4, dt);
      drawHudFrame(ctx, width, height);
      if (width >= 560 && height >= 300) drawNavball(ctx, width - 78, 84, 46, att);
      if (bloom > 0) {
        const wash = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, diag / 2);
        wash.addColorStop(0, `rgba(255, 250, 230, ${bloom})`);
        wash.addColorStop(0.4, `rgba(251, 191, 36, ${bloom * 0.6})`);
        wash.addColorStop(1, `rgba(180, 83, 9, ${bloom * 0.25})`);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }
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
