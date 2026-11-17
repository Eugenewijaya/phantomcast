import type { SnapTelemetry } from '../types/phantomcast';

export const SNAP_FFT_SIZE = 512;
export const SNAP_FREQ_MIN_HZ = 2500;
export const SNAP_FREQ_MAX_HZ = 7000;
export const SNAP_MAX_IMPULSE_MS = 35;
export const DOUBLE_SNAP_MIN_INTERVAL_MS = 200;
export const DOUBLE_SNAP_MAX_INTERVAL_MS = 800;
export const DOUBLE_SNAP_COOLDOWN_MS = 1200;

export interface SnapPulseState {
  inImpulse: boolean;
  impulseStartMs: number;
  peakBandEnergy: number;
  lastValidSnapMs: number;
  lastTriggerMs: number;
  lastImpulseDurationMs: number;
  snapCount: number;
}

/**
 * Pure deterministic evaluator for a single FFT frame so it can be unit-tested and run at 60Hz+
 */
export function evaluateSnapSpectrumFrame(
  freqBins: Uint8Array,
  sampleRate: number,
  fftSize: number,
  nowMs: number,
  sensitivity: number, // 0.1 to 1.0 (default 0.65)
  state: SnapPulseState
): { triggered: boolean; bandEnergy: number; lowEnergy: number } {
  const binCount = freqBins.length; // fftSize / 2 = 256
  const binWidthHz = sampleRate / fftSize;

  const startBin = Math.max(1, Math.floor(SNAP_FREQ_MIN_HZ / binWidthHz));
  const endBin = Math.min(binCount - 1, Math.ceil(SNAP_FREQ_MAX_HZ / binWidthHz));
  const lowEndBin = Math.max(1, Math.floor(800 / binWidthHz));

  let highSum = 0;
  let highCount = 0;
  for (let i = startBin; i <= endBin; i++) {
    highSum += freqBins[i];
    highCount++;
  }

  let lowSum = 0;
  for (let i = 1; i <= lowEndBin; i++) {
    lowSum += freqBins[i];
  }

  const bandEnergy = highCount > 0 ? highSum / (highCount * 255) : 0;
  const lowEnergy = lowEndBin > 0 ? lowSum / (lowEndBin * 255) : 0;

  // Higher sensitivity lowers the required energy threshold (range ~0.22 to 0.58)
  const clampedSens = Math.max(0.1, Math.min(1.0, sensitivity));
  const energyThreshold = 0.58 - clampedSens * 0.36;

  // Reject keyboard thuds or speech vowels where low-frequency <800Hz dominates high band
  const isSharpHighTransient =
    bandEnergy >= energyThreshold && bandEnergy > lowEnergy * 0.72;

  let triggered = false;

  if (state.lastValidSnapMs > 0 && nowMs - state.lastValidSnapMs > DOUBLE_SNAP_MAX_INTERVAL_MS) {
    state.snapCount = 0;
    state.lastValidSnapMs = 0;
  }

  if (isSharpHighTransient) {
    if (!state.inImpulse) {
      state.inImpulse = true;
      state.impulseStartMs = nowMs;
      state.peakBandEnergy = bandEnergy;
    } else if (bandEnergy > state.peakBandEnergy) {
      state.peakBandEnergy = bandEnergy;
    }
  } else if (state.inImpulse) {
    // Impulse just ended; verify duration is strictly under 35ms
    const impulseDurationMs = Math.max(1, nowMs - state.impulseStartMs);
    state.inImpulse = false;
    state.lastImpulseDurationMs = Math.round(impulseDurationMs);

    if (
      impulseDurationMs < SNAP_MAX_IMPULSE_MS &&
      nowMs - state.lastTriggerMs >= DOUBLE_SNAP_COOLDOWN_MS
    ) {
      if (state.lastValidSnapMs === 0) {
        state.lastValidSnapMs = nowMs;
        state.snapCount = 1;
      } else {
        const intervalMs = nowMs - state.lastValidSnapMs;
        if (
          intervalMs >= DOUBLE_SNAP_MIN_INTERVAL_MS &&
          intervalMs <= DOUBLE_SNAP_MAX_INTERVAL_MS
        ) {
          triggered = true;
          state.snapCount = 2;
          state.lastTriggerMs = nowMs;
          state.lastValidSnapMs = 0;
        } else if (intervalMs > DOUBLE_SNAP_MAX_INTERVAL_MS) {
          state.lastValidSnapMs = nowMs;
          state.snapCount = 1;
        }
      }
    }
  }

  return { triggered, bandEnergy, lowEnergy };
}

export class SnapDetector {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(SNAP_FFT_SIZE / 2));
  private timeData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(SNAP_FFT_SIZE));
  private pollTimer: number | null = null;

  private sensitivity = 0.65;
  private isListening = false;
  private currentBandEnergy = 0;
  private currentVoiceRms = 0;

  private pulseState: SnapPulseState = {
    inImpulse: false,
    impulseStartMs: 0,
    peakBandEnergy: 0,
    lastValidSnapMs: 0,
    lastTriggerMs: -Infinity,
    lastImpulseDurationMs: 0,
    snapCount: 0,
  };

  private onDoubleSnap?: () => void;

  constructor(onDoubleSnap?: () => void) {
    this.onDoubleSnap = onDoubleSnap;
  }

  public setOnDoubleSnap(cb: () => void): void {
    this.onDoubleSnap = cb;
  }

  public setSensitivity(value: number): void {
    this.sensitivity = Math.max(0.1, Math.min(1.0, value));
  }

  public getSensitivity(): number {
    return this.sensitivity;
  }

  public async attachStream(stream: MediaStream): Promise<void> {
    this.stop();

    if (stream.getAudioTracks().length === 0) {
      return;
    }

    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextCtor({ latencyHint: 'interactive' });
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = SNAP_FFT_SIZE; // Strictly 512 per PRD
    this.analyser.smoothingTimeConstant = 0.15; // Fast transient response for <35ms snap detection

    this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

    this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
    this.sourceNode.connect(this.analyser);
    this.isListening = true;

    // Poll every 6ms (~166Hz) so impulses <35ms are resolved with high temporal precision
    this.pollTimer = window.setInterval(() => {
      this.sampleAudioFrame();
    }, 6);
  }

  private sampleAudioFrame(): void {
    if (!this.analyser || !this.audioCtx || !this.isListening) return;

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    // Compute broadband RMS for lip-sync amplitude
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const centered = (this.timeData[i] - 128) / 128;
      sumSq += centered * centered;
    }
    const rms = Math.sqrt(sumSq / this.timeData.length);
    this.currentVoiceRms = Math.min(1, rms * 3.8);

    const nowMs = performance.now();
    const { triggered, bandEnergy } = evaluateSnapSpectrumFrame(
      this.freqData,
      this.audioCtx.sampleRate,
      SNAP_FFT_SIZE,
      nowMs,
      this.sensitivity,
      this.pulseState
    );

    this.currentBandEnergy = bandEnergy;

    if (triggered) {
      this.onDoubleSnap?.();
    }
  }

  /**
   * Simulates a double-snap trigger for testing / accessibility fallback.
   */
  public triggerSyntheticDoubleSnap(): void {
    const nowMs = performance.now();
    this.pulseState.lastImpulseDurationMs = 18;
    this.pulseState.snapCount = 2;
    this.pulseState.lastTriggerMs = nowMs;
    this.currentBandEnergy = 0.92;
    this.onDoubleSnap?.();
  }

  public getTelemetry(): SnapTelemetry {
    return {
      snapEnergy: Math.round(this.currentBandEnergy * 100) / 100,
      voiceRms: Math.round(this.currentVoiceRms * 100) / 100,
      snapCount: this.pulseState.snapCount,
      lastImpulseMs: this.pulseState.lastImpulseDurationMs,
      isListening: this.isListening,
    };
  }

  public stop(): void {
    this.isListening = false;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    try {
      this.sourceNode?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close().catch(() => {});
    }
    this.sourceNode = null;
    this.analyser = null;
    this.audioCtx = null;
  }
}
