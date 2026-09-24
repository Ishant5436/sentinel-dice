import React, { useEffect, useRef } from "react";

export type CelestialType = "jupiter" | "pulsar" | "gargantua";

export interface OrbitalCanvasProps {
  celestial: CelestialType;
  riskRatingBps: number;
  phase: "idle" | "launching" | "escaped" | "captured";
  multiplier: number;
}

export const OrbitalCanvas: React.FC<OrbitalCanvasProps> = ({
  celestial,
  riskRatingBps,
  phase,
  multiplier
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let t = 0;

    // Probe state variables
    let probeX = -100;
    let probeY = -100;
    let probeProgress = 0; // 0 to 1
    const particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string }> = [];

    const resize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      t += 0.02;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      // 1. Draw Starfield Background
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, width, height);

      // Star grid
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      for (let i = 0; i < 35; i++) {
        const sx = ((i * 1234.56 + t * 2) % width);
        const sy = ((i * 789.12) % height);
        const size = (i % 3 === 0) ? 1.5 : 0.8;
        ctx.fillRect(sx, sy, size, size);
      }

      // 2. Gravitational Well Radius based on riskRatingBps
      // Closer approach = higher risk / lower BPS
      const minRadius = 45;
      const maxRadius = 140;
      const approachRadius = minRadius + (riskRatingBps / 9800) * (maxRadius - minRadius);

      // Draw Orbit Trajectory Guide
      ctx.beginPath();
      ctx.ellipse(cx, cy, approachRadius * 1.4, approachRadius, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 3. Render Celestial Singularity
      if (celestial === "jupiter") {
        // Jovian Gas Giant
        const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 55);
        grad.addColorStop(0, "#fbbf24");
        grad.addColorStop(0.5, "#d97706");
        grad.addColorStop(0.8, "#92400e");
        grad.addColorStop(1, "rgba(146, 64, 14, 0)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, 60, 0, Math.PI * 2);
        ctx.fill();

        // Gaseous bands
        ctx.strokeStyle = "rgba(254, 243, 199, 0.25)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 10, 48, 8, 0.1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy + 12, 45, 7, -0.1, 0, Math.PI * 2);
        ctx.stroke();
      } else if (celestial === "pulsar") {
        // Pulsar Neutron Star
        const jetAngle = t * 1.5;
        // Relativistic Beam Jets
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(jetAngle);
        const jetGrad = ctx.createLinearGradient(0, -180, 0, 180);
        jetGrad.addColorStop(0, "rgba(56, 189, 248, 0)");
        jetGrad.addColorStop(0.4, "rgba(56, 189, 248, 0.7)");
        jetGrad.addColorStop(0.5, "#ffffff");
        jetGrad.addColorStop(0.6, "rgba(56, 189, 248, 0.7)");
        jetGrad.addColorStop(1, "rgba(56, 189, 248, 0)");

        ctx.fillStyle = jetGrad;
        ctx.fillRect(-6, -180, 12, 360);
        ctx.restore();

        // Pulsar Core
        const coreGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 40);
        coreGrad.addColorStop(0, "#ffffff");
        coreGrad.addColorStop(0.4, "#38bdf8");
        coreGrad.addColorStop(0.8, "#0284c7");
        coreGrad.addColorStop(1, "rgba(2, 132, 199, 0)");
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, 45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Gargantua Kerr Black Hole
        // Accretion disk
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.3);
        const diskGrad = ctx.createRadialGradient(0, 0, 32, 0, 0, 95);
        diskGrad.addColorStop(0, "rgba(251, 191, 36, 0.9)");
        diskGrad.addColorStop(0.4, "rgba(245, 158, 11, 0.6)");
        diskGrad.addColorStop(0.8, "rgba(217, 119, 6, 0.2)");
        diskGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = diskGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, 95, 28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Event Horizon (Absolute Void)
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(cx, cy, 32, 0, Math.PI * 2);
        ctx.fill();

        // Gravitational Photon Ring
        ctx.strokeStyle = "rgba(251, 191, 36, 0.85)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 33.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 4. Calculate Probe Position along Hyperbolic Arc
      if (phase === "idle") {
        probeProgress = (probeProgress + 0.005) % 1;
        const angle = probeProgress * Math.PI * 2;
        probeX = cx + Math.cos(angle) * (approachRadius * 1.4);
        probeY = cy + Math.sin(angle) * approachRadius;
      } else if (phase === "launching") {
        probeProgress = Math.min(1, probeProgress + 0.02);
        // Slingshot approach from left to periapsis
        const startX = 40;
        const startY = height - 50;
        const periX = cx;
        const periY = cy - approachRadius;
        
        // Quadratic bezier to periapsis
        const invP = 1 - probeProgress;
        probeX = invP * invP * startX + 2 * invP * probeProgress * (cx - 80) + probeProgress * probeProgress * periX;
        probeY = invP * invP * startY + 2 * invP * probeProgress * (cy + 20) + probeProgress * probeProgress * periY;

        // Emit engine particles
        particles.push({
          x: probeX,
          y: probeY,
          vx: (Math.random() - 0.5) * 2 - 2,
          vy: (Math.random() - 0.5) * 2 + 2,
          life: 1.0,
          color: "#38bdf8"
        });
      } else if (phase === "escaped") {
        probeProgress = Math.min(2, probeProgress + 0.03);
        const periX = cx;
        const periY = cy - approachRadius;
        const exitX = width + 50;
        const exitY = 40;

        const subP = probeProgress - 1;
        probeX = periX + subP * (exitX - periX);
        probeY = periY + subP * (exitY - periY);

        particles.push({
          x: probeX,
          y: probeY,
          vx: (Math.random() - 0.5) * 4 - 3,
          vy: (Math.random() - 0.5) * 4 + 1,
          life: 1.0,
          color: "#4ade80"
        });
      } else if (phase === "captured") {
        // Inward spiral into center
        probeProgress = Math.min(2, probeProgress + 0.04);
        const subP = probeProgress - 1;
        const spiralAngle = subP * Math.PI * 4;
        const r = approachRadius * (1 - subP);
        probeX = cx + Math.cos(spiralAngle) * r;
        probeY = cy + Math.sin(spiralAngle) * r;

        particles.push({
          x: probeX,
          y: probeY,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          life: 1.0,
          color: "#ef4444"
        });
      }

      // 5. Update and Draw Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.04;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fillRect(p.x, p.y, 2.5, 2.5);
        ctx.globalAlpha = 1.0;
      }

      // 6. Draw Probe Ship
      if (probeProgress < 1.95 || phase === "idle") {
        ctx.save();
        ctx.translate(probeX, probeY);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, -5);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.fill();

        // Ship glow
        ctx.shadowColor = (phase === "escaped") ? "#4ade80" : (phase === "captured" ? "#ef4444" : "#38bdf8");
        ctx.shadowBlur = 10;
        ctx.strokeStyle = ctx.shadowColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // 7. Dynamic Telemetry HUD overlay
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.font = "11px monospace";
      ctx.fillText(`PERIAPSIS: ${(approachRadius * 120).toFixed(0)} KM`, 16, 24);
      ctx.fillText(`TARGET MULTIPLIER: ${multiplier.toFixed(2)}x`, 16, 40);
      ctx.fillText(`WIN CHANCE: ${(riskRatingBps / 100).toFixed(2)}%`, 16, 56);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animId);
    };
  }, [celestial, riskRatingBps, phase, multiplier]);

  return (
    <div className="relative w-full h-[360px] md:h-[420px] rounded-xl overflow-hidden border border-cyan-500/20 bg-gray-950 shadow-2xl">
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div className="absolute top-3 right-3 flex items-center gap-2 px-2.5 py-1 bg-gray-900/80 backdrop-blur rounded border border-gray-800 text-xs font-mono text-cyan-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        KEPLER ENGINE 60 FPS
      </div>
    </div>
  );
};
