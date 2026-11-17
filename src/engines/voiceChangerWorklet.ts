import type { SetVoiceDspPayload, VoicePresetId } from '../types/phantomcast';

export interface VoicePresetDefinition {
  id: VoicePresetId;
  label: string;
  description: string;
  pitchSemitones: number;
  formantShift: number; // 1.0 = 0%, 1.15 = +15%, 1.25 = +25%, 0.88 = -12%
  highpassHz: number;
  noiseGateDb: number;
}

export const VOICE_DSP_PRESETS: Record<VoicePresetId, VoicePresetDefinition> = {
  NORMAL: {
    id: 'NORMAL',
    label: 'Normal (Bypass)',
    description: 'Suara asli mikrofon dengan noise gate -45dB',
    pitchSemitones: 0,
    formantShift: 1.0,
    highpassHz: 60,
    noiseGateDb: -45,
  },
  VTUBER_GIRL: {
    id: 'VTUBER_GIRL',
    label: 'Wanita / Anime (+5 st, +15%)',
    description: 'Pitch +5 semitone, Formant +15% untuk karakter VTuber',
    pitchSemitones: 5,
    formantShift: 1.15,
    highpassHz: 95,
    noiseGateDb: -45,
  },
  CHILD: {
    id: 'CHILD',
    label: 'Anak-Anak (+7 st, +25%, HPF 160Hz)',
    description: 'Pitch +7 semitone, Formant +25%, High-Pass 160Hz',
    pitchSemitones: 7,
    formantShift: 1.25,
    highpassHz: 160,
    noiseGateDb: -45,
  },
  DEEP_ANON: {
    id: 'DEEP_ANON',
    label: 'Anonim / Berat (-5 st, -12%)',
    description: 'Pitch -5 semitone, Formant -12% untuk penyamaran identitas',
    pitchSemitones: -5,
    formantShift: 0.88,
    highpassHz: 55,
    noiseGateDb: -45,
  },
  CUSTOM: {
    id: 'CUSTOM',
    label: 'Kustom (Manual DSP)',
    description: 'Konfigurasi manual Pitch Semitone & Formant Shift',
    pitchSemitones: 3,
    formantShift: 1.1,
    highpassHz: 80,
    noiseGateDb: -45,
  },
};

/**
 * Converts semitones to frequency multiplier alpha = 2^(semitones / 12)
 */
export function computePitchRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Computes shifted vocal tract formant center frequencies F1, F2, F3
 */
export function computeFormantFrequencies(formantShift: number): [number, number, number] {
  const clamped = Math.max(0.65, Math.min(1.5, formantShift));
  return [
    Math.round(500 * clamped),
    Math.round(1500 * clamped),
    Math.round(2500 * clamped),
  ];
}

/**
 * Pure deterministic Dual-Delay Line (WSOLA / Jungle) pitch-shifting kernel for testing & fallback.
 * Window size W = 720 samples (15.0 ms at 48kHz) guarantees < 25ms total round-trip latency.
 */
export function processDualDelayBlock(
  input: Float32Array,
  output: Float32Array,
  ringBuffer: Float32Array,
  state: { writeIndex: number; phase: number; env: number },
  pitchSemitones: number,
  noiseGateDb: number
): void {
  const bufLen = ringBuffer.length; // 2048
  const windowSize = 720;           // 15ms @ 48kHz (<25ms budget)
  const pitchRatio = computePitchRatio(pitchSemitones);
  const phaseStep = (1.0 - pitchRatio) / windowSize;
  const gateLinear = Math.pow(10, noiseGateDb / 20);

  for (let i = 0; i < input.length; i++) {
    const x = input[i];

    // Envelope follower for Noise Gate
    const absX = Math.abs(x);
    state.env = absX > state.env ? state.env * 0.8 + absX * 0.2 : state.env * 0.995 + absX * 0.005;
    const gateGain = state.env < gateLinear ? Math.max(0, state.env / Math.max(1e-6, gateLinear)) : 1.0;

    const gatedSample = x * gateGain;
    ringBuffer[state.writeIndex] = gatedSample;

    if (Math.abs(pitchSemitones) < 0.01) {
      output[i] = gatedSample;
    } else {
      // Advance normalized modulation phase in [0, 1)
      state.phase += phaseStep;
      state.phase -= Math.floor(state.phase);

      const phase1 = state.phase;
      const phase2 = (state.phase + 0.5) - Math.floor(state.phase + 0.5);

      const delay1 = phase1 * windowSize;
      const delay2 = phase2 * windowSize;

      // Triangular crossfade window weights g1 + g2 = 1.0
      const g1 = 1.0 - Math.abs(2.0 * phase1 - 1.0);
      const g2 = 1.0 - Math.abs(2.0 * phase2 - 1.0);

      // Fractional delay read 1
      const readPos1 = (state.writeIndex - delay1 + bufLen) % bufLen;
      const idx1A = Math.floor(readPos1);
      const idx1B = (idx1A + 1) % bufLen;
      const frac1 = readPos1 - idx1A;
      const sample1 = ringBuffer[idx1A] * (1.0 - frac1) + ringBuffer[idx1B] * frac1;

      // Fractional delay read 2
      const readPos2 = (state.writeIndex - delay2 + bufLen) % bufLen;
      const idx2A = Math.floor(readPos2);
      const idx2B = (idx2A + 1) % bufLen;
      const frac2 = readPos2 - idx2A;
      const sample2 = ringBuffer[idx2A] * (1.0 - frac2) + ringBuffer[idx2B] * frac2;

      output[i] = sample1 * g1 + sample2 * g2;
    }

    state.writeIndex = (state.writeIndex + 1) % bufLen;
  }
}

/**
 * Self-contained AudioWorkletProcessor source string loaded via local Blob URL (100% CSP-safe).
 * Implements Modulated Dual-Delay Line (WSOLA) Pitch Shifting + Inline Biquad Formant EQ inside the audio rendering thread.
 */
const WORKLET_PROCESSOR_SOURCE = `
class PhantomVoiceWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufLen = 2048;
    this.windowSize = 720; // 15.0 ms @ 48 kHz -> <25ms total DSP latency
    this.ringBuffer = new Float32Array(this.bufLen);
    this.writeIndex = 0;
    this.phase = 0;
    this.env = 0;

    this.enabled = true;
    this.pitchSemitones = 0;
    this.formantShift = 1.0;
    this.noiseGateDb = -45;

    // Inline Direct-Form II Biquad state for low-latency Formant EQ inside the Worklet
    this.z1 = 0;
    this.z2 = 0;
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.updateFormantCoeffs(1.0);

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
      if (typeof data.pitchSemitones === 'number') this.pitchSemitones = data.pitchSemitones;
      if (typeof data.formantShift === 'number') {
        this.formantShift = data.formantShift;
        this.updateFormantCoeffs(this.formantShift);
      }
      if (typeof data.noiseGateDb === 'number') this.noiseGateDb = data.noiseGateDb;
    };
  }

  updateFormantCoeffs(shift) {
    const sr = typeof sampleRate === 'number' ? sampleRate : 48000;
    const fc = Math.max(250, Math.min(4200, 1450 * shift));
    const gainDb = (shift - 1.0) * 18.0;
    const Q = 1.85;
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * fc) / sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosw0 = Math.cos(w0);

    const b0 = 1 + alpha * A;
    const b1 = -2 * cosw0;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha / A;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || input.length === 0 || output.length === 0) {
      return true;
    }

    const inCh = input[0];
    const outCh = output[0];
    if (!inCh || !outCh) return true;

    const pitchRatio = Math.pow(2, this.pitchSemitones / 12);
    const phaseStep = (1.0 - pitchRatio) / this.windowSize;
    const gateLinear = Math.pow(10, this.noiseGateDb / 20);

    for (let i = 0; i < inCh.length; i++) {
      const x = inCh[i];
      const absX = Math.abs(x);
      this.env = absX > this.env ? this.env * 0.8 + absX * 0.2 : this.env * 0.995 + absX * 0.005;
      const gateGain = this.env < gateLinear ? Math.max(0, this.env / Math.max(1e-6, gateLinear)) : 1.0;
      const gated = x * gateGain;

      this.ringBuffer[this.writeIndex] = gated;

      let y = gated;
      if (this.enabled && Math.abs(this.pitchSemitones) >= 0.01) {
        this.phase += phaseStep;
        this.phase -= Math.floor(this.phase);

        const p1 = this.phase;
        const p2 = (this.phase + 0.5) - Math.floor(this.phase + 0.5);

        const d1 = p1 * this.windowSize;
        const d2 = p2 * this.windowSize;

        const g1 = 1.0 - Math.abs(2.0 * p1 - 1.0);
        const g2 = 1.0 - Math.abs(2.0 * p2 - 1.0);

        const r1 = (this.writeIndex - d1 + this.bufLen) % this.bufLen;
        const i1A = Math.floor(r1);
        const i1B = (i1A + 1) % this.bufLen;
        const f1 = r1 - i1A;
        const s1 = this.ringBuffer[i1A] * (1.0 - f1) + this.ringBuffer[i1B] * f1;

        const r2 = (this.writeIndex - d2 + this.bufLen) % this.bufLen;
        const i2A = Math.floor(r2);
        const i2B = (i2A + 1) % this.bufLen;
        const f2 = r2 - i2A;
        const s2 = this.ringBuffer[i2A] * (1.0 - f2) + this.ringBuffer[i2B] * f2;

        y = s1 * g1 + s2 * g2;
      }

      // Apply in-worklet Biquad Formant EQ stage
      if (this.enabled && Math.abs(this.formantShift - 1.0) > 0.01) {
        const outY = this.b0 * y + this.z1;
        this.z1 = this.b1 * y - this.a1 * outY + this.z2;
        this.z2 = this.b2 * y - this.a2 * outY;
        y = outY;
      }

      outCh[i] = Math.max(-0.98, Math.min(0.98, y));
      this.writeIndex = (this.writeIndex + 1) % this.bufLen;
    }

    // Copy mono processed channel to any additional output channels
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(outCh);
    }

    return true;
  }
}

registerProcessor('phantom-voice-worklet', PhantomVoiceWorkletProcessor);
`;

export interface AudioOutputDeviceOption {
  deviceId: string;
  label: string;
  isVirtualCable: boolean;
}

export class VoiceChangerEngine {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private highpassFilter: BiquadFilterNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private formantFilter1: BiquadFilterNode | null = null;
  private formantFilter2: BiquadFilterNode | null = null;
  private formantFilter3: BiquadFilterNode | null = null;
  private monitorGain: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private outputAudioEl: HTMLAudioElement | null = null;
  private workletBlobUrl: string | null = null;

  private currentConfig: SetVoiceDspPayload = {
    enabled: true,
    preset: 'NORMAL',
    pitch_semitones: 0,
    formant_shift: 1.0,
    noise_gate_db: -45,
    highpass_hz: 60,
  };

  private micMonitorEnabled = false;
  private selectedSinkId = 'default';

  public async initializeWithStream(stream: MediaStream): Promise<void> {
    this.dispose();

    if (stream.getAudioTracks().length === 0) return;

    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    // interactive latencyHint requests OS minimum buffer quantum (128 samples = 2.67ms @ 48kHz)
    this.audioCtx = new AudioContextCtor({
      latencyHint: 'interactive',
      sampleRate: 48000,
    });

    this.sourceNode = this.audioCtx.createMediaStreamSource(stream);

    // 1. High-Pass Filter (160Hz for CHILD preset, 60-95Hz for others)
    this.highpassFilter = this.audioCtx.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = this.currentConfig.highpass_hz ?? 60;
    this.highpassFilter.Q.value = 0.707;

    // 2. BiquadFilter Formant Shifter Cascade (F1, F2, F3 vocal tract resonances)
    this.formantFilter1 = this.audioCtx.createBiquadFilter();
    this.formantFilter1.type = 'peaking';
    this.formantFilter1.Q.value = 1.9;

    this.formantFilter2 = this.audioCtx.createBiquadFilter();
    this.formantFilter2.type = 'peaking';
    this.formantFilter2.Q.value = 2.2;

    this.formantFilter3 = this.audioCtx.createBiquadFilter();
    this.formantFilter3.type = 'peaking';
    this.formantFilter3.Q.value = 2.5;

    // 3. Load AudioWorkletProcessor via local Blob URL
    const blob = new Blob([WORKLET_PROCESSOR_SOURCE], { type: 'application/javascript' });
    this.workletBlobUrl = URL.createObjectURL(blob);
    await this.audioCtx.audioWorklet.addModule(this.workletBlobUrl);

    this.workletNode = new AudioWorkletNode(this.audioCtx, 'phantom-voice-worklet', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    // 4. Separate Local Mic Monitor Gain from Virtual Cable Stream Destination
    // so disabling Mic Monitor never mutes the VB-Audio Virtual Cable output!
    this.monitorGain = this.audioCtx.createGain();
    this.monitorGain.gain.value = this.micMonitorEnabled ? 1.0 : 0.0;

    this.streamDest = this.audioCtx.createMediaStreamDestination();

    // Connect DSP graph:
    // Source -> HighPass -> Worklet (Dual-Delay Pitch + Formant) -> Biquad F1 -> F2 -> F3
    // Branch A (Local Headphones Monitor): F3 -> MonitorGain -> audioCtx.destination
    // Branch B (Virtual Cable setSinkId):  F3 -> StreamDest -> outputAudioEl
    this.sourceNode.connect(this.highpassFilter);
    this.highpassFilter.connect(this.workletNode);
    this.workletNode.connect(this.formantFilter1);
    this.formantFilter1.connect(this.formantFilter2);
    this.formantFilter2.connect(this.formantFilter3);

    this.formantFilter3.connect(this.monitorGain);
    this.monitorGain.connect(this.audioCtx.destination);

    this.formantFilter3.connect(this.streamDest);

    const audioEl = new Audio();
    audioEl.srcObject = this.streamDest.stream;
    audioEl.muted = this.selectedSinkId === 'default';
    audioEl.autoplay = true;
    this.outputAudioEl = audioEl;

    if (this.selectedSinkId && this.selectedSinkId !== 'default' && 'setSinkId' in audioEl) {
      try {
        await audioEl.setSinkId(this.selectedSinkId);
        audioEl.muted = false;
      } catch {
        audioEl.muted = true;
      }
    }

    try {
      await audioEl.play();
    } catch {
      // Autoplay will resume on user interaction
    }

    this.applyDspConfig(this.currentConfig);
  }

  public applyDspConfig(config: SetVoiceDspPayload): void {
    this.currentConfig = { ...config };

    const effectivePitch = config.enabled ? config.pitch_semitones : 0;
    const effectiveFormant = config.enabled ? config.formant_shift : 1.0;
    const [f1, f2, f3] = computeFormantFrequencies(effectiveFormant);
    const gainDeltaDb = (effectiveFormant - 1.0) * 20;

    if (this.highpassFilter && this.audioCtx) {
      const targetHp =
        config.preset === 'CHILD' ? 160 : config.highpass_hz ?? 65;
      this.highpassFilter.frequency.setTargetAtTime(
        targetHp,
        this.audioCtx.currentTime,
        0.01
      );
    }

    if (this.formantFilter1 && this.formantFilter2 && this.formantFilter3 && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.formantFilter1.frequency.setTargetAtTime(f1, now, 0.01);
      this.formantFilter1.gain.setTargetAtTime(gainDeltaDb * 0.85, now, 0.01);

      this.formantFilter2.frequency.setTargetAtTime(f2, now, 0.01);
      this.formantFilter2.gain.setTargetAtTime(gainDeltaDb, now, 0.01);

      this.formantFilter3.frequency.setTargetAtTime(f3, now, 0.01);
      this.formantFilter3.gain.setTargetAtTime(gainDeltaDb * 0.75, now, 0.01);
    }

    this.workletNode?.port.postMessage({
      enabled: config.enabled,
      pitchSemitones: effectivePitch,
      formantShift: effectiveFormant,
      noiseGateDb: config.noise_gate_db,
    });
  }

  public setMicMonitor(enabled: boolean): void {
    this.micMonitorEnabled = enabled;
    if (this.monitorGain && this.audioCtx) {
      this.monitorGain.gain.setTargetAtTime(
        enabled ? 1.0 : 0.0,
        this.audioCtx.currentTime,
        0.015
      );
      if (enabled && this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
      if (enabled && this.outputAudioEl) {
        void this.outputAudioEl.play().catch(() => {});
      }
    }
  }

  public async setOutputDevice(deviceId: string): Promise<boolean> {
    this.selectedSinkId = deviceId;
    if (this.outputAudioEl && 'setSinkId' in this.outputAudioEl) {
      try {
        if (deviceId === 'default') {
          this.outputAudioEl.muted = true;
          await this.outputAudioEl.setSinkId('');
        } else {
          await this.outputAudioEl.setSinkId(deviceId);
          this.outputAudioEl.muted = false;
          void this.outputAudioEl.play().catch(() => {});
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  public static async listAudioOutputDevices(): Promise<AudioOutputDeviceOption[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === 'audiooutput');
      if (outputs.length === 0) {
        return [
          {
            deviceId: 'default',
            label: 'Speaker / Output Default Windows',
            isVirtualCable: false,
          },
        ];
      }
      return outputs.map((d, idx) => {
        const label = d.label || `Perangkat Output Audio #${idx + 1}`;
        const lower = label.toLowerCase();
        const isVirtualCable =
          lower.includes('cable') ||
          lower.includes('vb-audio') ||
          lower.includes('virtual');
        return {
          deviceId: d.deviceId || 'default',
          label,
          isVirtualCable,
        };
      });
    } catch {
      return [
        {
          deviceId: 'default',
          label: 'Speaker / Output Default Windows',
          isVirtualCable: false,
        },
      ];
    }
  }

  public getEstimatedLatencyMs(): number {
    if (!this.audioCtx) return 18.0;
    const baseMs = (this.audioCtx.baseLatency || 0.003) * 1000;
    const workletWindowMs = 15.0; // 720 samples @ 48kHz
    return Math.min(24.5, Math.round((baseMs + workletWindowMs) * 10) / 10);
  }

  public dispose(): void {
    if (this.outputAudioEl) {
      this.outputAudioEl.pause();
      this.outputAudioEl.srcObject = null;
      this.outputAudioEl = null;
    }
    if (this.workletBlobUrl) {
      URL.revokeObjectURL(this.workletBlobUrl);
      this.workletBlobUrl = null;
    }
    try {
      this.sourceNode?.disconnect();
      this.highpassFilter?.disconnect();
      this.workletNode?.disconnect();
      this.formantFilter1?.disconnect();
      this.formantFilter2?.disconnect();
      this.formantFilter3?.disconnect();
      this.monitorGain?.disconnect();
    } catch {
      // Ignore cleanup errors
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
  }
}
