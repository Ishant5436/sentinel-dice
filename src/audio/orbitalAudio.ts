/**
 * Procedural Web Audio Engine for Gravity Slingshot.
 * Zero external audio assets; synthesizes all celestial and orbital effects at runtime.
 */

class OrbitalAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  private getContext(): AudioContext | null {
    if (this.isMuted) return null;
    if (typeof window === "undefined") return null;

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch((err: unknown) => {
        console.warn("AudioContext resume deferred:", err);
      });
    }
    return this.ctx;
  }

  private master: GainNode | null = null;
  private volume = 1;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;

  private out(ctx: AudioContext): AudioNode {
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  public setVolume(volume: number) {
    this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
  }

  /** Sonar pings that speed up and rise in pitch as the probe closes on periapsis. */
  public startApproachPings(approachMs: number) {
    this.stopPings();
    const start = performance.now();
    const next = () => {
      const t = performance.now() - start;
      if (t > approachMs + 12000) return; // never ping forever if the VRF stalls
      const k = Math.min(1, t / approachMs);
      this.ping(900 + 700 * k);
      this.pingTimer = setTimeout(next, t > approachMs ? 90 : 380 - 300 * k);
    };
    next();
  }

  public stopPings() {
    clearTimeout(this.pingTimer);
    this.pingTimer = undefined;
  }

  private ping(freq: number) {
    const ctx = this.getContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(this.out(ctx));
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  private noiseBurst(ctx: AudioContext, seconds: number): AudioBufferSourceNode {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  /** Slingshot survived: resonant high-pass sweep on noise plus a rising chirp. */
  public playSonicBoom() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      const noise = this.noiseBurst(ctx, 0.45);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.Q.value = 9;
      hp.frequency.setValueAtTime(500, t);
      hp.frequency.exponentialRampToValueAtTime(9000, t + 0.35);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      noise.connect(hp);
      hp.connect(gain);
      gain.connect(this.out(ctx));
      noise.start(t);
      const chirp = ctx.createOscillator();
      const chirpGain = ctx.createGain();
      chirp.type = "sine";
      chirp.frequency.setValueAtTime(280, t);
      chirp.frequency.exponentialRampToValueAtTime(1600, t + 0.25);
      chirpGain.gain.setValueAtTime(0.06, t);
      chirpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      chirp.connect(chirpGain);
      chirpGain.connect(this.out(ctx));
      chirp.start(t);
      chirp.stop(t + 0.32);
    } catch (err: unknown) {
      console.warn("Sonic boom audio bypassed:", err);
    }
  }

  /** Captured: sub-bass drop from 80 Hz to 28 Hz with a low noise burst. */
  public playCaptureCollapse() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(80, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 1.2);
      subGain.gain.setValueAtTime(0.28, t);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      sub.connect(subGain);
      subGain.connect(this.out(ctx));
      sub.start(t);
      sub.stop(t + 1.35);
      const noise = this.noiseBurst(ctx, 0.5);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      noise.connect(lp);
      lp.connect(gain);
      gain.connect(this.out(ctx));
      noise.start(t);
    } catch (err: unknown) {
      console.warn("Capture collapse audio bypassed:", err);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Short telemetry blip when adjusting sliders or clicking chips.
   */
  public playBlip(freq: number = 880) {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(this.out(ctx));

      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch (err: unknown) {
      console.warn("Audio synthesis bypassed:", err);
    }
  }

  /**
   * Low-frequency gravity well resonance hum on probe launch.
   */
  public playGravityWellHum() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(55, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 1.2);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

      osc.connect(gain);
      gain.connect(this.out(ctx));

      osc.start();
      osc.stop(ctx.currentTime + 1.5);
    } catch (err: unknown) {
      console.warn("Gravity well audio bypassed:", err);
    }
  }

  /**
   * Periapsis burn / Relativistic Doppler pitch sweep.
   */
  public playPeriapsisSweep() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(720, ctx.currentTime + 0.9);

      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.95);

      osc.connect(gain);
      gain.connect(this.out(ctx));

      osc.start();
      osc.stop(ctx.currentTime + 0.95);
    } catch (err: unknown) {
      console.warn("Periapsis sweep audio bypassed:", err);
    }
  }

  /**
   * Escape velocity achieved: resonant harmonic chord + sonic boom.
   */
  public playEscapeSuccess() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const freqs = [440, 554.37, 659.25, 880]; // A Major Chord
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(f, ctx.currentTime + idx * 0.04);

        gain.gain.setValueAtTime(0.08, ctx.currentTime + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8 + idx * 0.05);

        osc.connect(gain);
        gain.connect(this.out(ctx));

        osc.start(ctx.currentTime + idx * 0.04);
        osc.stop(ctx.currentTime + 0.8 + idx * 0.05);
      });
    } catch (err: unknown) {
      console.warn("Escape audio bypassed:", err);
    }
  }

  /**
   * Event horizon capture: sub-bass pitch drop & disintegration crunch.
   */
  public playCaptureFailure() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(32, ctx.currentTime + 0.7);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);

      osc.connect(gain);
      gain.connect(this.out(ctx));

      osc.start();
      osc.stop(ctx.currentTime + 0.75);
    } catch (err: unknown) {
      console.warn("Capture audio bypassed:", err);
    }
  }
}

export const orbitalAudio = new OrbitalAudioEngine();
