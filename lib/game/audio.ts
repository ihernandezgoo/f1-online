/** Tiny WebAudio engine synth – no audio files needed. */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  muted = false;

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.22;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.3;
    this.filter.connect(this.engineGain).connect(this.master);

    this.oscA = ctx.createOscillator();
    this.oscA.type = "sawtooth";
    this.oscB = ctx.createOscillator();
    this.oscB.type = "square";
    const bGain = ctx.createGain();
    bGain.gain.value = 0.35;
    this.oscA.connect(this.filter);
    this.oscB.connect(bGain).connect(this.filter);
    this.oscA.start();
    this.oscB.start();

    // tyre / wind noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 900;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(nf).connect(this.noiseGain).connect(this.master);
    noise.start();
  }

  update(rpm: number, throttle: number, speed: number, offTrack: boolean) {
    if (!this.ctx || !this.oscA || !this.oscB || !this.filter || !this.engineGain || !this.noiseGain) return;
    const t = this.ctx.currentTime;
    const f = (rpm / 60) * 1.5; // V6-ish firing frequency, pitched down
    this.oscA.frequency.setTargetAtTime(f, t, 0.03);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + throttle * 2200 + rpm * 0.08, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.18 + throttle * 0.22, t, 0.05);
    const wind = Math.min(1, speed / 90) * 0.08 + (offTrack ? Math.min(1, speed / 30) * 0.25 : 0);
    this.noiseGain.gain.setTargetAtTime(wind, t, 0.1);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.22, this.ctx.currentTime, 0.05);
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    void this.ctx?.resume();
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
