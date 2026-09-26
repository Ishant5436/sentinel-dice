/**
 * Adaptive background score for Grand Tour, synthesised at runtime with Web Audio (no audio files).
 *
 * An organ pad over Am - F - C - G with a sub bass, a delayed arpeggio, and a lead motif on
 * alternate loops. The music follows the game: denser as the tour gets deeper, and a clock-tick
 * tension layer with a pulsing bass while a leg is in flight. Cues add stingers or a duck.
 */

export type Intensity = 0 | 1 | 2 | 3; // idle, cruising, deep tour, leg in flight
export type Cue = 'survive' | 'capture' | 'bank' | 'complete';

const BPM = 72;
const STEP = 60 / BPM / 2; // eighth note
const STEPS_PER_CHORD = 16; // two bars of 4/4
const LOOKAHEAD_S = 0.3;
const SCHEDULE_MS = 50;
const MASTER_LEVEL = 0.5;
const STORAGE_KEY = 'grand-tour-music';

// MIDI notes: pad voicing (smooth voice leading) and bass root per chord.
const CHORDS = [
  { pad: [57, 60, 64], bass: 45 }, // Am
  { pad: [57, 60, 65], bass: 41 }, // F
  { pad: [55, 60, 64], bass: 48 }, // C
  { pad: [55, 59, 62], bass: 43 }, // G
];
const LOOP_STEPS = STEPS_PER_CHORD * CHORDS.length;
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 4, 2];
// Lead motif over one loop: [step, midi note, length in steps].
const MOTIF: Array<[number, number, number]> = [
  [0, 76, 6], [8, 74, 4], [12, 72, 4],
  [16, 72, 6], [24, 69, 8],
  [32, 67, 6], [40, 76, 4], [44, 74, 4],
  [48, 71, 8], [56, 74, 8],
];
const FILTER_BY_INTENSITY = [1100, 1600, 2100, 3000];

const mtof = (note: number) => 440 * 2 ** ((note - 69) / 12);

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch (err: unknown) {
    console.warn('Music preference unavailable:', err);
    return true;
  }
}

function writePreference(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch (err: unknown) {
    console.warn('Music preference not saved:', err);
  }
}

class SpaceScore {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private reverbSend!: GainNode;
  private padFilter!: BiquadFilterNode;
  private arpBus!: GainNode;
  private organ!: PeriodicWave;
  private noise!: AudioBuffer;
  private analyser!: AnalyserNode;
  private enabled = typeof window !== 'undefined' ? readPreference() : true;
  private playing = false;
  private intensity: Intensity = 0;
  private volume = 1;
  private step = 0;
  private loop = 0;
  private nextStepTime = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  isEnabled() {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    writePreference(on);
    if (on) this.start();
    else this.stop();
  }

  /** Call from a user gesture (browsers block audio until one happens). Safe to call repeatedly. */
  start() {
    if (!this.enabled || this.playing) return;
    const ctx = this.context();
    if (!ctx) return;
    ctx.resume().catch((err: unknown) => console.warn('Music resume deferred:', err));
    this.playing = true;
    this.step = 0;
    this.loop = 0;
    this.nextStepTime = ctx.currentTime + 0.1;
    this.setIntensity(this.intensity);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(MASTER_LEVEL * this.volume, ctx.currentTime + 2.5);
    this.timer = setInterval(this.schedule, SCHEDULE_MS);
  }

  stop() {
    if (!this.playing || !this.ctx) return;
    const ctx = this.ctx;
    this.playing = false;
    clearInterval(this.timer);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.ctx && this.playing) this.master.gain.setTargetAtTime(MASTER_LEVEL * volume, this.ctx.currentTime, 0.1);
  }

  setIntensity(level: Intensity) {
    this.intensity = level;
    if (!this.ctx) return;
    this.padFilter.frequency.setTargetAtTime(FILTER_BY_INTENSITY[level], this.ctx.currentTime, 0.8);
  }

  cue(kind: Cue) {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const t = ctx.currentTime + 0.02;
    const chord = CHORDS[Math.floor(this.step / STEPS_PER_CHORD) % CHORDS.length];
    if (kind === 'capture') {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(MASTER_LEVEL * this.volume * 0.25, t + 0.15);
      this.master.gain.linearRampToValueAtTime(MASTER_LEVEL * this.volume, t + 4);
      this.padFilter.frequency.setValueAtTime(350, t);
      this.padFilter.frequency.setTargetAtTime(FILTER_BY_INTENSITY[this.intensity], t + 0.5, 1.2);
      return;
    }
    const lift = kind === 'survive' ? [0, 1, 2, 3] : kind === 'bank' ? [0, 2, 4] : [0, 1, 2, 3, 4, 5, 6];
    const tones = [...chord.pad.map(n => n + 12), ...chord.pad.map(n => n + 24), chord.pad[0] + 36];
    lift.forEach((i, k) => this.bell(mtof(tones[i]), t + k * 0.07, kind === 'complete' ? 0.07 : 0.05, 1.4));
  }

  /** Current output level, 0..1, for UI meters and tests. */
  level(): number {
    if (!this.ctx) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    return peak / 128;
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.buildGraph(ctx);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend().catch(() => undefined);
      else if (this.playing) ctx.resume().catch(() => undefined);
    });
    return ctx;
  }

  private buildGraph(ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    limiter.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(limiter);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 4.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet);
    wet.connect(limiter);
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(reverb);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = FILTER_BY_INTENSITY[0];
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.dry);
    this.padFilter.connect(this.reverbSend);

    // Arpeggio through a dotted-eighth feedback delay.
    this.arpBus = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = STEP * 1.5;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    this.arpBus.connect(this.dry);
    this.arpBus.connect(this.reverbSend);
    this.arpBus.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(this.dry);
    tone.connect(this.reverbSend);

    // Organ: fundamental plus octave and twelfth partials.
    const real = new Float32Array([0, 0, 0, 0, 0, 0, 0]);
    const imag = new Float32Array([0, 1, 0.55, 0.3, 0.18, 0.08, 0.04]);
    this.organ = ctx.createPeriodicWave(real, imag);

    // Noise for the clock tick; Math.random is fine for timbre, it never touches outcomes.
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }

  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    return buffer;
  }

  private schedule = () => {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(this.step, this.nextStepTime);
      this.nextStepTime += STEP;
      this.step += 1;
      if (this.step === LOOP_STEPS) {
        this.step = 0;
        this.loop += 1;
      }
    }
  };

  private playStep(step: number, t: number) {
    const chord = CHORDS[Math.floor(step / STEPS_PER_CHORD)];
    const inChord = step % STEPS_PER_CHORD;
    if (inChord === 0) this.padChord(chord, t, STEPS_PER_CHORD * STEP);

    const arpTones = [...chord.pad.map(n => n + 12), chord.pad[0] + 24, chord.pad[1] + 24];
    const note = arpTones[ARP_PATTERN[step % ARP_PATTERN.length]];
    const idleHit = step % 8 === 0 || step % 8 === 3 || step % 8 === 6;
    if (this.intensity > 0 || idleHit) {
      const velocity = [0.03, 0.034, 0.04, 0.045][this.intensity];
      this.pluck(mtof(note), t, velocity);
      if (this.intensity >= 2 && step % 4 === 2) this.pluck(mtof(note + 12), t, velocity * 0.5);
    }

    if (this.loop % 2 === 1 && this.intensity > 0) {
      const phrase = MOTIF.find(([at]) => at === step);
      if (phrase) this.lead(mtof(phrase[1]), t, phrase[2] * STEP);
    }

    if (this.intensity === 3) {
      if (step % 2 === 0) this.tick(t, step % 8 === 0 ? 0.09 : 0.05);
      this.pulse(mtof(chord.bass - 12), t);
    }
  }

  private padChord(chord: { pad: number[]; bass: number }, t: number, duration: number) {
    const ctx = this.ctx!;
    const end = t + duration;
    const voices: Array<[number, number, number]> = chord.pad.flatMap((n): Array<[number, number, number]> => [
      [mtof(n), -6, 0.035],
      [mtof(n), 6, 0.035],
    ]);
    voices.push([mtof(chord.bass), 0, 0.06]);
    for (const [freq, detune, level] of voices) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(this.organ);
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 1.4);
      gain.gain.setValueAtTime(level, end);
      gain.gain.linearRampToValueAtTime(0, end + 2);
      osc.connect(gain);
      gain.connect(this.padFilter);
      osc.start(t);
      osc.stop(end + 2.1);
    }
  }

  private pluck(freq: number, t: number, velocity: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain);
    gain.connect(this.arpBus);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  private lead(freq: number, t: number, duration: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5;
    const depth = ctx.createGain();
    depth.gain.value = freq * 0.004;
    vibrato.connect(depth);
    depth.connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.03, t + 0.25);
    gain.gain.setValueAtTime(0.03, t + duration * 0.8);
    gain.gain.linearRampToValueAtTime(0, t + duration + 0.4);
    osc.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.reverbSend);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + duration + 0.5);
    vibrato.stop(t + duration + 0.5);
  }

  private bell(freq: number, t: number, level: number, decay: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.reverbSend);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  private tick(t: number, level: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.dry);
    src.start(t);
    src.stop(t + 0.05);
  }

  private pulse(freq: number, t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 0.9);
    osc.connect(gain);
    gain.connect(this.dry);
    osc.start(t);
    osc.stop(t + STEP);
  }
}

export const spaceScore = new SpaceScore();
