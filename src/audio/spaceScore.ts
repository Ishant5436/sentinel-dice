/**
 * "Grand Tour" adaptive score, synthesised live with Web Audio (no audio files, nothing to license).
 *
 * A 16-bar cinematic synthwave piece in A minor at 100 BPM: a wide detuned-saw pad, a saw bass
 * with a sine sub, a 16th-note arpeggio through a ping-pong delay, a singing lead hook and
 * synthesised drums, all into a generated-impulse reverb and a glue compressor. The arrangement
 * follows the game: layers enter as the tour gets deeper, a riser and snare roll build while a
 * leg resolves, and cues land an impact, a shimmer, a fanfare or a fall.
 */

export type Intensity = 0 | 1 | 2 | 3; // idle, cruising, deep tour, leg in flight
export type Cue = 'survive' | 'capture' | 'bank' | 'complete';

const BPM = 100;
const SIXTEENTH = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
const BAR = SIXTEENTH * STEPS_PER_BAR;
const LOOKAHEAD_S = 0.12;
const SCHEDULE_MS = 25;
const MASTER_LEVEL = 0.6;
const STORAGE_KEY = 'grand-tour-music';

interface Chord {
  pad: number[]; // MIDI voicing, smooth voice leading from bar to bar
  bass: number;
}
const AM: Chord = { pad: [57, 60, 64, 69], bass: 45 };
const F: Chord = { pad: [57, 60, 65, 69], bass: 41 };
const C: Chord = { pad: [55, 60, 64, 67], bass: 48 };
const G: Chord = { pad: [55, 59, 62, 67], bass: 43 };
const E: Chord = { pad: [56, 59, 64, 68], bass: 40 };
const EM: Chord = { pad: [55, 59, 64, 67], bass: 40 };
// A: Am F C G | A': Am F C E (the E major lifts into the chorus) | B: F G Em Am | B': F G Am Am
const FORM: Chord[] = [AM, F, C, G, AM, F, C, E, F, G, EM, AM, F, G, AM, AM];

// Lead hook: [bar, sixteenth, midi note, length in sixteenths].
const HOOK: Array<[number, number, number, number]> = [
  [0, 0, 76, 6], [0, 6, 74, 2], [0, 8, 72, 4], [0, 12, 74, 4],
  [1, 0, 72, 6], [1, 6, 69, 2], [1, 8, 72, 4], [1, 12, 77, 4],
  [2, 0, 76, 8], [2, 8, 79, 4], [2, 12, 76, 4],
  [3, 0, 74, 12], [3, 12, 71, 4],
  [4, 0, 76, 6], [4, 6, 74, 2], [4, 8, 72, 4], [4, 12, 74, 4],
  [5, 0, 72, 6], [5, 6, 69, 2], [5, 8, 72, 4], [5, 12, 81, 4],
  [6, 0, 79, 6], [6, 6, 76, 2], [6, 8, 79, 4], [6, 12, 84, 4],
  [7, 0, 83, 12], [7, 12, 80, 4],
  [8, 0, 81, 8], [8, 8, 77, 4], [8, 12, 79, 4],
  [9, 0, 79, 8], [9, 8, 74, 4], [9, 12, 76, 4],
  [10, 0, 76, 6], [10, 6, 79, 2], [10, 8, 83, 8],
  [11, 0, 81, 16],
  [12, 0, 77, 4], [12, 4, 76, 4], [12, 8, 77, 4], [12, 12, 81, 4],
  [13, 0, 79, 4], [13, 4, 77, 4], [13, 8, 79, 4], [13, 12, 83, 4],
  [14, 0, 84, 8], [14, 8, 83, 4], [14, 12, 79, 4],
  [15, 0, 81, 12],
];
const ARP = [0, 1, 2, 3, 1, 2, 3, 4];
const PAD_CUTOFF: Record<Intensity, number> = { 0: 1500, 1: 2100, 2: 2900, 3: 4200 };

const mtof = (note: number) => 440 * 2 ** ((note - 69) / 12);
const jitter = (amount: number) => (Math.random() - 0.5) * amount; // cosmetic humanising only

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
  private master!: GainNode; // volume and fades
  private bus!: GainNode; // every instrument, before the glue compressor
  private pump!: GainNode; // kick-driven duck on the pad and bass
  private padFilter!: BiquadFilterNode;
  private reverbSend!: GainNode;
  private delaySend!: GainNode;
  private analyser!: AnalyserNode;
  private noise!: AudioBuffer;
  private enabled = typeof window !== 'undefined' ? readPreference() : true;
  private playing = false;
  private intensity: Intensity = 0;
  private volume = 1;
  private step = 0;
  private nextTime = 0;
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
    this.nextTime = ctx.currentTime + 0.1;
    this.setIntensity(this.intensity);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(MASTER_LEVEL * this.volume, ctx.currentTime + 3);
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
    const previous = this.intensity;
    this.intensity = level;
    const ctx = this.ctx;
    if (!ctx) return;
    this.padFilter.frequency.setTargetAtTime(PAD_CUTOFF[level], ctx.currentTime, 0.6);
    // A leg just launched: build tension until it resolves.
    if (this.playing && level === 3 && previous !== 3) this.buildUp(ctx.currentTime + 0.02, 2.2);
  }

  cue(kind: Cue) {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const t = ctx.currentTime + 0.02;
    const chord = FORM[Math.floor(this.step / STEPS_PER_BAR) % FORM.length];
    if (kind === 'capture') {
      // The fall: duck the mix, slam the pad filter shut, a pitch dive and a low boom.
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(MASTER_LEVEL * this.volume * 0.35, t + 0.2);
      this.master.gain.linearRampToValueAtTime(MASTER_LEVEL * this.volume, t + 4);
      this.padFilter.frequency.setValueAtTime(260, t);
      this.padFilter.frequency.setTargetAtTime(PAD_CUTOFF[this.intensity], t + 0.8, 1.2);
      this.dive(t);
      this.boom(t + 0.05, 0.6);
      return;
    }
    this.crash(t, kind === 'survive' ? 0.18 : 0.26);
    this.boom(t, kind === 'complete' ? 0.9 : 0.55);
    if (kind === 'survive') {
      const tones = [...chord.pad, ...chord.pad.map(n => n + 12)];
      tones.forEach((note, k) => this.pluck(mtof(note + 12), t + k * 0.045, 0.05, k % 2 ? 0.5 : -0.5));
    } else if (kind === 'bank') {
      // Picardy lift: an A major shimmer over the minor key.
      [69, 73, 76, 81, 85, 88].forEach((note, k) => this.bell(mtof(note + 12), t + k * 0.07, 0.05, 1.8));
    } else {
      // Grand Tour fanfare: A major stab and a rising call.
      this.stab([57, 61, 64, 69], t, 1.4);
      [81, 85, 88, 93].forEach((note, k) => this.leadNote(note, t + 0.15 + k * 0.18, k === 3 ? 1.2 : 0.2, false, 1.2));
      [81, 85, 88, 93].forEach((note, k) => this.bell(mtof(note + 12), t + 0.9 + k * 0.08, 0.04, 2.2));
    }
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

  // ---------------------------------------------------------------------------------------------
  // Graph

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
    const ctx = new window.AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.25;
    this.bus = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.bus.connect(glue).connect(this.master).connect(this.analyser).connect(ctx.destination);

    this.pump = ctx.createGain();
    this.pump.connect(this.bus);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = PAD_CUTOFF[0];
    this.padFilter.Q.value = 0.7;
    this.padFilter.connect(this.pump);
    // Slow breathing on the pad filter.
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoDepth.gain.value = 450;
    lfo.connect(lfoDepth).connect(this.padFilter.frequency);
    lfo.start();

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 3.2, 3);
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(reverb).connect(this.bus);
    const padVerb = ctx.createGain();
    padVerb.gain.value = 0.35;
    this.padFilter.connect(padVerb).connect(this.reverbSend);

    // Ping-pong delay at a dotted eighth, darkened in the feedback path.
    const left = ctx.createDelay(2);
    const right = ctx.createDelay(2);
    left.delayTime.value = SIXTEENTH * 3;
    right.delayTime.value = SIXTEENTH * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.7;
    panR.pan.value = 0.7;
    this.delaySend = ctx.createGain();
    this.delaySend.connect(left);
    left.connect(panL).connect(this.bus);
    left.connect(tone).connect(right);
    right.connect(panR).connect(this.bus);
    right.connect(feedback).connect(left);
    const delayVerb = ctx.createGain();
    delayVerb.gain.value = 0.3;
    panR.connect(delayVerb).connect(this.reverbSend);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Background tabs throttle timers; suspend there so the groove never stutters.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else if (this.playing) void ctx.resume();
    });
    return ctx;
  }

  /** Stereo reverb impulse: decaying noise with a short fade-in, different per channel. */
  private impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const fadeIn = ctx.sampleRate * 0.012;
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay * Math.min(1, i / fadeIn);
    }
    return buffer;
  }

  private noiseSource(t: number, duration: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 1.5, duration + 0.05);
    return src;
  }

  // ---------------------------------------------------------------------------------------------
  // Sequencer

  private schedule = () => {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(this.step, this.nextTime);
      this.step += 1;
      this.nextTime += SIXTEENTH;
    }
  };

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / STEPS_PER_BAR) % FORM.length;
    const s = step % STEPS_PER_BAR;
    const chord = FORM[bar];
    const i = this.intensity;

    if (s === 0) {
      this.padChord(chord, t);
      if (i === 0) this.bassNote(chord.bass, t, BAR, 0.16, false);
    }
    if (i >= 1 && s % 2 === 0) this.bassNote(chord.bass + (s === 6 || s === 14 ? 12 : 0), t, SIXTEENTH * 2, 0.2, true);
    if (i >= 1 || s % 2 === 0) {
      const tones = [...chord.pad, chord.pad[0] + 12];
      this.pluck(mtof(tones[ARP[s % ARP.length]] + 12), t + jitter(0.004), i === 0 ? 0.03 : 0.045, s % 2 ? 0.45 : -0.45);
    }
    // Lead: a soft flute on the chorus while idle, the full singing lead once the tour runs deep.
    if (i >= 2 || bar >= 8) {
      for (const [b, st, note, len] of HOOK) if (b === bar && st === s) this.leadNote(note, t, len * SIXTEENTH, i < 2, 1);
    }
    if (i === 1) {
      if (s === 0 || s === 10) this.kick(t, 0.55);
      if (s % 4 === 2) this.hat(t, 0.12, false);
    } else if (i === 2) {
      if (s === 0 || s === 8 || s === 10) this.kick(t, 0.75);
      if (s === 4 || s === 12) this.clap(t, 0.35);
      if (s % 2 === 1) this.hat(t, 0.1, false);
      if (s % 4 === 2) this.hat(t, 0.16, true);
    } else if (i === 3) {
      if (s % 4 === 0) this.kick(t, 0.9);
      if (s === 4 || s === 12) this.clap(t, 0.5);
      this.hat(t, s % 4 === 2 ? 0.22 : 0.1, s % 4 === 2);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Instruments

  private padChord(chord: Chord, t: number) {
    const ctx = this.ctx!;
    const hold = BAR;
    chord.pad.forEach((note, k) => {
      for (const side of [-1, 1]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = mtof(note);
        osc.detune.value = side * 9 + jitter(3);
        const pan = ctx.createStereoPanner();
        pan.pan.value = side * (0.25 + k * 0.08);
        const gain = ctx.createGain();
        const level = 0.032;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.35);
        gain.gain.setValueAtTime(level, t + hold - 0.05);
        gain.gain.linearRampToValueAtTime(0, t + hold + 1.1);
        osc.connect(gain).connect(pan).connect(this.padFilter);
        osc.start(t);
        osc.stop(t + hold + 1.2);
      }
    });
    // An octave-down triangle gives the pad body.
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = mtof(chord.pad[0] - 12);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0, t);
    bodyGain.gain.linearRampToValueAtTime(0.05, t + 0.4);
    bodyGain.gain.linearRampToValueAtTime(0, t + hold + 1);
    body.connect(bodyGain).connect(this.padFilter);
    body.start(t);
    body.stop(t + hold + 1.1);
  }

  private bassNote(note: number, t: number, length: number, level: number, driving: boolean) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(level, t + (driving ? 0.005 : 0.3));
    out.gain.setTargetAtTime(0, t + length * (driving ? 0.55 : 0.85), driving ? 0.05 : 0.4);
    out.connect(this.pump);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = mtof(note - 12);
    sub.connect(out);
    sub.start(t);
    sub.stop(t + length + 1.5);
    if (!driving) return;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = mtof(note);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(1100, t);
    filter.frequency.exponentialRampToValueAtTime(220, t + 0.16);
    const sawGain = ctx.createGain();
    sawGain.gain.value = 0.55;
    saw.connect(filter).connect(sawGain).connect(out);
    saw.start(t);
    saw.stop(t + length + 0.3);
  }

  private pluck(freq: number, t: number, level: number, panValue: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4200, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level * (0.9 + jitter(0.2)), t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    const pan = ctx.createStereoPanner();
    pan.pan.value = panValue;
    osc.connect(filter).connect(gain).connect(pan);
    pan.connect(this.bus);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    pan.connect(send).connect(this.delaySend);
    const verb = ctx.createGain();
    verb.gain.value = 0.2;
    pan.connect(verb).connect(this.reverbSend);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private leadNote(note: number, t: number, length: number, soft: boolean, boost: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    const level = (soft ? 0.045 : 0.07) * boost;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(level, t + 0.03);
    out.gain.setTargetAtTime(level * 0.8, t + 0.08, 0.2);
    out.gain.setTargetAtTime(0, t + length, 0.12);
    out.connect(this.bus);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    out.connect(send).connect(this.delaySend);
    const verb = ctx.createGain();
    verb.gain.value = 0.45;
    out.connect(verb).connect(this.reverbSend);
    // Vibrato that eases in after the attack, like a held voice.
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.3;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(soft ? 5 : 9, t + Math.min(0.35, length));
    vibrato.connect(depth);
    vibrato.start(t);
    vibrato.stop(t + length + 0.8);
    const voices: Array<[OscillatorType, number, number]> = soft
      ? [['sine', 0, 1], ['triangle', 1200, 0.25]]
      : [['sawtooth', -6, 0.5], ['sawtooth', 6, 0.5]];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = soft ? 5000 : 2700;
    filter.connect(out);
    for (const [type, detune, gainValue] of voices) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(note);
      osc.detune.value = detune;
      depth.connect(osc.detune);
      const g = ctx.createGain();
      g.gain.value = gainValue;
      osc.connect(g).connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.8);
    }
  }

  private bell(freq: number, t: number, level: number, decay: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(level, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    out.connect(this.bus);
    const verb = ctx.createGain();
    verb.gain.value = 0.6;
    out.connect(verb).connect(this.reverbSend);
    const send = ctx.createGain();
    send.gain.value = 0.4;
    out.connect(send).connect(this.delaySend);
    for (const [ratio, amp] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.12],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + decay + 0.1);
    }
  }

  /** Brassy saw chord for the fanfare. */
  private stab(notes: number[], t: number, length: number) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(3800, t + 0.25);
    filter.frequency.setTargetAtTime(1400, t + 0.3, 0.4);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.12, t + 0.03);
    out.gain.setTargetAtTime(0, t + length, 0.3);
    filter.connect(out).connect(this.bus);
    const verb = ctx.createGain();
    verb.gain.value = 0.4;
    out.connect(verb).connect(this.reverbSend);
    for (const note of notes) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = mtof(note);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + length + 1.5);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Drums and effects

  private kick(t: number, level: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.42);
    // Sidechain feel: the pad and bass breathe around every kick.
    this.pump.gain.cancelScheduledValues(t);
    this.pump.gain.setValueAtTime(1, t);
    this.pump.gain.linearRampToValueAtTime(0.5, t + 0.012);
    this.pump.gain.setTargetAtTime(1, t + 0.03, 0.09);
  }

  private clap(t: number, level: number) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    for (const offset of [0, 0.011, 0.022]) {
      gain.gain.setValueAtTime(level, t + offset);
      gain.gain.exponentialRampToValueAtTime(level * 0.2, t + offset + 0.009);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    this.noiseSource(t, 0.25).connect(filter).connect(gain).connect(this.bus);
    const verb = ctx.createGain();
    verb.gain.value = 0.45;
    gain.connect(verb).connect(this.reverbSend);
  }

  private hat(t: number, level: number, open: boolean) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.2 : 0.045));
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0.25;
    this.noiseSource(t, open ? 0.22 : 0.06).connect(filter).connect(gain).connect(pan).connect(this.bus);
  }

  private crash(t: number, level: number) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    this.noiseSource(t, 2).connect(filter).connect(gain).connect(this.bus);
    const verb = ctx.createGain();
    verb.gain.value = 0.5;
    gain.connect(verb).connect(this.reverbSend);
  }

  /** Sub-drop impact. */
  private boom(t: number, level: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(gain).connect(this.bus);
    osc.start(t);
    osc.stop(t + 1.5);
  }

  /** Noise riser, a rising tone and an accelerating snare roll while a leg resolves. */
  private buildUp(t: number, length: number) {
    const ctx = this.ctx!;
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'bandpass';
    sweep.Q.value = 3;
    sweep.frequency.setValueAtTime(350, t);
    sweep.frequency.exponentialRampToValueAtTime(6000, t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + length);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.25);
    this.noiseSource(t, length + 0.3).connect(sweep).connect(gain).connect(this.bus);
    const verb = ctx.createGain();
    verb.gain.value = 0.35;
    gain.connect(verb).connect(this.reverbSend);
    const tone = ctx.createOscillator();
    tone.type = 'sawtooth';
    tone.frequency.setValueAtTime(110, t);
    tone.frequency.exponentialRampToValueAtTime(880, t + length);
    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 1800;
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.0001, t);
    toneGain.gain.exponentialRampToValueAtTime(0.035, t + length);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.2);
    tone.connect(toneFilter).connect(toneGain).connect(this.bus);
    tone.start(t);
    tone.stop(t + length + 0.3);
    // Snare roll: eighths, then sixteenths, then thirty-seconds, getting louder.
    let at = t;
    while (at < t + length) {
      const progress = (at - t) / length;
      this.clap(at, 0.12 + 0.3 * progress);
      at += progress < 0.4 ? SIXTEENTH * 2 : progress < 0.75 ? SIXTEENTH : SIXTEENTH / 2;
    }
  }

  /** The capture fall: a detuned voice diving out of range. */
  private dive(t: number) {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    gain.connect(this.bus);
    const verb = ctx.createGain();
    verb.gain.value = 0.6;
    gain.connect(verb).connect(this.reverbSend);
    for (const detune of [-12, 12]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(mtof(69), t);
      osc.frequency.exponentialRampToValueAtTime(mtof(33), t + 1.5);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 1.7);
    }
  }
}

export const spaceScore = new SpaceScore();
