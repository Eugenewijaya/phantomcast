export type TriggerSource = 'GESTURE_V_SIGN' | 'AUDIO_SNAP' | 'MANUAL';

export type ActiveMode = 'RAW_CAM' | 'AR_FILTER' | 'VTUBER_3D';

export type ArFilterId =
  | 'none'
  | 'neon_visor_01'
  | 'privacy_pixelate'
  | 'lut_warm'
  | 'lut_monochrome'
  | 'lut_anime';

export type VoicePresetId = 'NORMAL' | 'VTUBER_GIRL' | 'CHILD' | 'DEEP_ANON' | 'CUSTOM';

export type AvatarBackgroundMode = 'room' | 'solid' | 'custom_image';

export interface SetPipelineStatePayload {
  vanish_mode: boolean;
  trigger_source: TriggerSource;
  active_mode: ActiveMode;
  selected_filter_id: ArFilterId;
  vtuber_model_path: string;
}

export interface SetVoiceDspPayload {
  enabled: boolean;
  preset: VoicePresetId;
  pitch_semitones: number;
  formant_shift: number;
  noise_gate_db: number;
  highpass_hz?: number;
}

export interface NormalizedLandmarkPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface VisionFrameTelemetry {
  isVSignDetected: boolean;
  vSignHoldProgress: number; // 0.0 to 1.0 (500ms hold)
  vSignCooldownMs: number;   // 0 to 2000ms
  vSignAngleDeg: number;
  handLandmarks: NormalizedLandmarkPoint[][];
  faceLandmarks: NormalizedLandmarkPoint[][];
  categoryMask: Uint8Array | null;
  maskWidth: number;
  maskHeight: number;
  headPose: {
    roll: number;
    pitch: number;
    yaw: number;
  };
  modelsLoaded: {
    hand: boolean;
    face: boolean;
    segmenter: boolean;
  };
}

export interface SnapTelemetry {
  snapEnergy: number;        // 0.0 to 1.0 in 2.5kHz-7kHz band
  voiceRms: number;          // 0.0 to 1.0 broadband voice amplitude for lip-sync
  snapCount: number;         // 0, 1, or 2
  lastImpulseMs: number;     // Duration of last impulse (<35ms valid)
  isListening: boolean;
}

export interface PerformanceTelemetry {
  fps: number;
  targetFps: 30 | 60;
  frameTimeMs: number;
  vanishOpacity: number;     // 1.0 visible -> 0.0 vanished (400ms fade)
  hasCleanPlate: boolean;
  autoBackgroundInfill: boolean;
  virtualCamConnected: boolean;
  virtualCamFramesSent: number;
}

export interface ElectronBridgeAPI {
  sendPipelineState: (payload: SetPipelineStatePayload) => void;
  sendVoiceDsp: (payload: SetVoiceDspPayload) => void;
  getSidecarStatus: () => Promise<{ running: boolean; pid: number | null; wsUrl: string }>;
  restartSidecar: () => Promise<{ running: boolean; pid: number | null }>;
}

declare global {
  interface Window {
    phantomBridge?: ElectronBridgeAPI;
  }
}
