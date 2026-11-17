import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, Radio } from 'lucide-react';
import { VideoStage } from './components/VideoStage';
import { ControlPanel } from './components/ControlPanel';
import { PerformanceHUD } from './components/PerformanceHUD';
import { SnapDetector } from './engines/snapDetector';
import type { VtuberModelInfo } from './engines/vtuberEngine';
import {
  VoiceChangerEngine,
  VOICE_DSP_PRESETS,
  type AudioOutputDeviceOption,
} from './engines/voiceChangerWorklet';
import type {
  ActiveMode,
  ArFilterId,
  AvatarBackgroundMode,
  PerformanceTelemetry,
  SetVoiceDspPayload,
  SnapTelemetry,
  TriggerSource,
  VisionFrameTelemetry,
  VoicePresetId,
} from './types/phantomcast';

export const App: React.FC = () => {
  const [vanishMode, setVanishMode] = useState<boolean>(false);
  const [lastTriggerSource, setLastTriggerSource] = useState<TriggerSource>('MANUAL');
  const [activeMode, setActiveMode] = useState<ActiveMode>('RAW_CAM');
  const [selectedFilter, setSelectedFilter] = useState<ArFilterId>('none');
  const [targetFps, setTargetFps] = useState<30 | 60>(60);
  const [autoBackgroundInfill, setAutoBackgroundInfill] = useState<boolean>(true);
  const [snapSensitivity, setSnapSensitivity] = useState<number>(0.65);
  const [cleanPlateCounter, setCleanPlateCounter] = useState<number>(0);

  // Phase 2: Local VTuber & AR state
  const [avatarInfo, setAvatarInfo] = useState<VtuberModelInfo>({
    type: 'procedural_3d',
    name: 'HoloUnit-01 (Built-in 3D)',
    url: 'builtin://holounit-01',
  });
  const [externalAvatarFile, setExternalAvatarFile] = useState<File | null>(null);
  const [resetAvatarCounter, setResetAvatarCounter] = useState<number>(0);
  const [avatarBgMode, setAvatarBgMode] = useState<AvatarBackgroundMode>('room');
  const [avatarBgColor, setAvatarBgColor] = useState<string>('#0D131D');
  const [customBgImageUrl, setCustomBgImageUrl] = useState<string | null>(null);

  // Phase 3: Real-Time Voice Changer DSP state
  const [voiceDsp, setVoiceDsp] = useState<SetVoiceDspPayload>({
    enabled: true,
    preset: 'NORMAL',
    pitch_semitones: 0,
    formant_shift: 1.0,
    noise_gate_db: -45,
    highpass_hz: 60,
  });
  const [micMonitor, setMicMonitor] = useState<boolean>(false);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDeviceOption[]>([
    { deviceId: 'default', label: 'Speaker / Output Default Windows', isVirtualCable: false },
  ]);
  const [selectedSinkId, setSelectedSinkId] = useState<string>('default');
  const [dspLatencyMs, setDspLatencyMs] = useState<number>(18.2);

  const [visionTelemetry, setVisionTelemetry] = useState<VisionFrameTelemetry>({
    isVSignDetected: false,
    vSignHoldProgress: 0,
    vSignCooldownMs: 0,
    vSignAngleDeg: 0,
    handLandmarks: [],
    faceLandmarks: [],
    categoryMask: null,
    maskWidth: 0,
    maskHeight: 0,
    headPose: { roll: 0, pitch: 0, yaw: 0 },
    modelsLoaded: { hand: false, face: false, segmenter: false },
  });

  const [perfTelemetry, setPerfTelemetry] = useState<PerformanceTelemetry>({
    fps: 60,
    targetFps: 60,
    frameTimeMs: 16.6,
    vanishOpacity: 1,
    hasCleanPlate: false,
    autoBackgroundInfill: true,
    virtualCamConnected: false,
    virtualCamFramesSent: 0,
  });

  const [snapTelemetry, setSnapTelemetry] = useState<SnapTelemetry>({
    snapEnergy: 0,
    voiceRms: 0,
    snapCount: 0,
    lastImpulseMs: 0,
    isListening: false,
  });

  const snapDetectorRef = useRef<SnapDetector | null>(null);
  const voiceEngineRef = useRef<VoiceChangerEngine | null>(null);

  const handleToggleVanish = useCallback((source: TriggerSource) => {
    setLastTriggerSource(source);
    setVanishMode((prev) => !prev);
  }, []);

  // Initialize Microphone Stream for both FFT 512 Double-Snap Detector & Voice Changer AudioWorklet
  useEffect(() => {
    let mounted = true;

    const detector = new SnapDetector(() => {
      if (mounted) {
        handleToggleVanish('AUDIO_SNAP');
      }
    });
    snapDetectorRef.current = detector;

    const voiceEngine = new VoiceChangerEngine();
    voiceEngineRef.current = voiceEngine;

    async function initAudioPipeline() {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
          },
          video: false,
        });
        if (!mounted) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        await detector.attachStream(micStream);
        await voiceEngine.initializeWithStream(micStream);
        setDspLatencyMs(voiceEngine.getEstimatedLatencyMs());
      } catch {
        // Synthetic trigger & UI controls remain operational when mic is absent
      }

      const devices = await VoiceChangerEngine.listAudioOutputDevices();
      if (mounted) {
        setOutputDevices(devices);
        const vbCable = devices.find((d) => d.isVirtualCable);
        if (vbCable) {
          setSelectedSinkId(vbCable.deviceId);
          void voiceEngine.setOutputDevice(vbCable.deviceId);
        }
      }
    }

    void initAudioPipeline();

    const uiInterval = window.setInterval(() => {
      if (mounted && snapDetectorRef.current) {
        setSnapTelemetry(snapDetectorRef.current.getTelemetry());
      }
    }, 60);

    return () => {
      mounted = false;
      clearInterval(uiInterval);
      detector.stop();
      voiceEngine.dispose();
    };
  }, [handleToggleVanish]);

  // Sync Pipeline State over Electron IPC
  useEffect(() => {
    window.phantomBridge?.sendPipelineState({
      vanish_mode: vanishMode,
      trigger_source: lastTriggerSource,
      active_mode: activeMode,
      selected_filter_id: selectedFilter,
      vtuber_model_path: avatarInfo.url,
    });
  }, [vanishMode, lastTriggerSource, activeMode, selectedFilter, avatarInfo.url]);

  // Sync Voice Changer DSP over AudioWorklet & Electron IPC
  useEffect(() => {
    voiceEngineRef.current?.applyDspConfig(voiceDsp);
    window.phantomBridge?.sendVoiceDsp(voiceDsp);
  }, [voiceDsp]);

  const handleSelectVoicePreset = (presetId: VoicePresetId) => {
    const def = VOICE_DSP_PRESETS[presetId];
    setVoiceDsp({
      enabled: presetId !== 'NORMAL',
      preset: presetId,
      pitch_semitones: def.pitchSemitones,
      formant_shift: def.formantShift,
      noise_gate_db: def.noiseGateDb,
      highpass_hz: def.highpassHz,
    });
  };

  const handleChangeVoicePitch = (semitones: number) => {
    setVoiceDsp((prev) => ({
      ...prev,
      enabled: true,
      preset: 'CUSTOM',
      pitch_semitones: semitones,
    }));
  };

  const handleChangeVoiceFormant = (formant: number) => {
    setVoiceDsp((prev) => ({
      ...prev,
      enabled: true,
      preset: 'CUSTOM',
      formant_shift: formant,
    }));
  };

  const handleToggleMicMonitor = () => {
    setMicMonitor((prev) => {
      const next = !prev;
      voiceEngineRef.current?.setMicMonitor(next);
      return next;
    });
  };

  const handleSelectOutputDevice = (deviceId: string) => {
    setSelectedSinkId(deviceId);
    void voiceEngineRef.current?.setOutputDevice(deviceId);
  };

  const handleSnapSensitivity = (val: number) => {
    setSnapSensitivity(val);
    snapDetectorRef.current?.setSensitivity(val);
  };

  const handleSelectCustomBg = (file: File) => {
    if (customBgImageUrl) {
      URL.revokeObjectURL(customBgImageUrl);
    }
    const url = URL.createObjectURL(file);
    setCustomBgImageUrl(url);
    setAvatarBgMode('custom_image');
  };

  return (
    <div className="min-h-screen bg-studio-bg text-studio-text flex flex-col">
      {/* Top Broadcast Header */}
      <header className="border-b border-studio-border bg-studio-panel/90 backdrop-blur-md px-4 lg:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-studio-cyan/15 border border-studio-cyan/40 flex items-center justify-center text-studio-cyan">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-studio-text">
              PhantomCast Studio
            </h1>
            <p className="text-[11px] text-studio-muted font-mono">
              Hybrid AI Virtual Camera, Vanish Engine, Local VTuber &amp; Real-Time DSP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md bg-studio-surface border border-studio-border text-[11px] font-mono text-studio-muted flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-studio-cyan" />
            <span>Offline MediaPipe WASM</span>
          </span>
        </div>
      </header>

      {/* Main Studio Grid */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
        <div className="lg:col-span-8 flex flex-col gap-4">
          <PerformanceHUD
            perf={perfTelemetry}
            vision={visionTelemetry}
            snap={snapTelemetry}
            vanishMode={vanishMode}
          />
          <VideoStage
            vanishMode={vanishMode}
            activeMode={activeMode}
            selectedFilter={selectedFilter}
            targetFps={targetFps}
            autoBackgroundInfill={autoBackgroundInfill}
            voiceRms={snapTelemetry.voiceRms}
            avatarBgMode={avatarBgMode}
            avatarBgColor={avatarBgColor}
            customBgImageUrl={customBgImageUrl}
            externalAvatarFile={externalAvatarFile}
            resetAvatarCounter={resetAvatarCounter}
            onAvatarLoaded={setAvatarInfo}
            onToggleVanish={handleToggleVanish}
            onVisionTelemetry={setVisionTelemetry}
            onPerfTelemetry={setPerfTelemetry}
            cleanPlateTriggerCounter={cleanPlateCounter}
          />
        </div>

        <div className="lg:col-span-4 w-full">
          <ControlPanel
            vanishMode={vanishMode}
            lastTriggerSource={lastTriggerSource}
            activeMode={activeMode}
            selectedFilter={selectedFilter}
            targetFps={targetFps}
            autoBackgroundInfill={autoBackgroundInfill}
            snapSensitivity={snapSensitivity}
            avatarInfo={avatarInfo}
            avatarBgMode={avatarBgMode}
            avatarBgColor={avatarBgColor}
            voiceDsp={voiceDsp}
            micMonitor={micMonitor}
            outputDevices={outputDevices}
            selectedSinkId={selectedSinkId}
            dspLatencyMs={dspLatencyMs}
            onToggleVanish={handleToggleVanish}
            onCaptureCleanPlate={() => setCleanPlateCounter((c) => c + 1)}
            onChangeActiveMode={setActiveMode}
            onChangeFilter={setSelectedFilter}
            onChangeTargetFps={setTargetFps}
            onChangeAutoInfill={setAutoBackgroundInfill}
            onChangeSnapSensitivity={handleSnapSensitivity}
            onSimulateDoubleSnap={() => snapDetectorRef.current?.triggerSyntheticDoubleSnap()}
            onSelectAvatarFile={setExternalAvatarFile}
            onResetAvatar={() => setResetAvatarCounter((c) => c + 1)}
            onChangeAvatarBgMode={setAvatarBgMode}
            onChangeAvatarBgColor={setAvatarBgColor}
            onSelectCustomBgImage={handleSelectCustomBg}
            onSelectVoicePreset={handleSelectVoicePreset}
            onChangeVoicePitch={handleChangeVoicePitch}
            onChangeVoiceFormant={handleChangeVoiceFormant}
            onToggleMicMonitor={handleToggleMicMonitor}
            onSelectOutputDevice={handleSelectOutputDevice}
          />
        </div>
      </main>
    </div>
  );
};

export default App;
