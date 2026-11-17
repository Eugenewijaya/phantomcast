import React, { useRef } from 'react';
import {
  Sliders,
  Hand,
  Radio,
  EyeOff,
  Gauge,
  Camera,
  Box,
  Upload,
  ScanFace,
  RotateCcw,
  Image as ImageIcon,
  Mic,
  Volume2,
  Headphones,
} from 'lucide-react';
import type {
  ActiveMode,
  ArFilterId,
  AvatarBackgroundMode,
  SetVoiceDspPayload,
  TriggerSource,
  VoicePresetId,
} from '../types/phantomcast';
import type { VtuberModelInfo } from '../engines/vtuberEngine';
import {
  VOICE_DSP_PRESETS,
  type AudioOutputDeviceOption,
} from '../engines/voiceChangerWorklet';

interface ControlPanelProps {
  vanishMode: boolean;
  lastTriggerSource: TriggerSource;
  activeMode: ActiveMode;
  selectedFilter: ArFilterId;
  targetFps: 30 | 60;
  autoBackgroundInfill: boolean;
  snapSensitivity: number;
  avatarInfo: VtuberModelInfo;
  avatarBgMode: AvatarBackgroundMode;
  avatarBgColor: string;
  voiceDsp: SetVoiceDspPayload;
  micMonitor: boolean;
  outputDevices: AudioOutputDeviceOption[];
  selectedSinkId: string;
  dspLatencyMs: number;
  onToggleVanish: (source: TriggerSource) => void;
  onCaptureCleanPlate: () => void;
  onChangeActiveMode: (mode: ActiveMode) => void;
  onChangeFilter: (filter: ArFilterId) => void;
  onChangeTargetFps: (fps: 30 | 60) => void;
  onChangeAutoInfill: (enabled: boolean) => void;
  onChangeSnapSensitivity: (val: number) => void;
  onSimulateDoubleSnap: () => void;
  onSelectAvatarFile: (file: File) => void;
  onResetAvatar: () => void;
  onChangeAvatarBgMode: (mode: AvatarBackgroundMode) => void;
  onChangeAvatarBgColor: (color: string) => void;
  onSelectCustomBgImage: (file: File) => void;
  onSelectVoicePreset: (preset: VoicePresetId) => void;
  onChangeVoicePitch: (semitones: number) => void;
  onChangeVoiceFormant: (formant: number) => void;
  onToggleMicMonitor: () => void;
  onSelectOutputDevice: (deviceId: string) => void;
}

const AR_FILTER_OPTIONS: { id: ArFilterId; label: string; desc: string }[] = [
  { id: 'none', label: 'Tanpa Filter', desc: 'Umpan kamera standar' },
  { id: 'neon_visor_01', label: 'Cyber Visor 3D', desc: 'Kacamata hologram 3D mengikuti rotasi kepala' },
  { id: 'privacy_pixelate', label: 'Privacy Pixelate', desc: 'Sensor mozaik otomatis pada area wajah' },
  { id: 'lut_warm', label: 'Cinematic Warm LUT', desc: 'Shader gradasi sinematik keemasan' },
  { id: 'lut_monochrome', label: 'Noir Monochrome LUT', desc: 'Shader monokrom kontras tinggi' },
  { id: 'lut_anime', label: 'Anime Cel-Shader LUT', desc: 'Kuantisasi warna cel-shading & garis tepi' },
];

export const ControlPanel: React.FC<ControlPanelProps> = ({
  vanishMode,
  lastTriggerSource,
  activeMode,
  selectedFilter,
  targetFps,
  autoBackgroundInfill,
  snapSensitivity,
  avatarInfo,
  avatarBgMode,
  avatarBgColor,
  voiceDsp,
  micMonitor,
  outputDevices,
  selectedSinkId,
  dspLatencyMs,
  onToggleVanish,
  onCaptureCleanPlate,
  onChangeActiveMode,
  onChangeFilter,
  onChangeTargetFps,
  onChangeAutoInfill,
  onChangeSnapSensitivity,
  onSimulateDoubleSnap,
  onSelectAvatarFile,
  onResetAvatar,
  onChangeAvatarBgMode,
  onChangeAvatarBgColor,
  onSelectCustomBgImage,
  onSelectVoicePreset,
  onChangeVoicePitch,
  onChangeVoiceFormant,
  onToggleMicMonitor,
  onSelectOutputDevice,
}) => {
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);

  const formantPercent = Math.round((voiceDsp.formant_shift - 1.0) * 100);

  return (
    <aside
      aria-label="Panel Kontrol Utama PhantomCast"
      className="bg-studio-panel border border-studio-border rounded-xl p-4 flex flex-col gap-3.5 h-full"
    >
      <div className="flex items-center justify-between border-b border-studio-border pb-2.5">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-studio-cyan" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-studio-text">
            Kontrol Studio
          </h2>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-studio-surface text-studio-cyan border border-studio-border">
          Trigger: {lastTriggerSource}
        </span>
      </div>

      {/* Mode Pipeline Selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-studio-muted uppercase tracking-wider">
          Mode Pipeline Visual
        </label>
        <div className="grid grid-cols-3 gap-1.5 bg-studio-bg p-1 rounded-lg border border-studio-border">
          {(
            [
              { id: 'RAW_CAM', label: 'Kamera' },
              { id: 'AR_FILTER', label: 'AR Filter' },
              { id: 'VTUBER_3D', label: 'VTuber' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeActiveMode(tab.id)}
              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                activeMode === tab.id
                  ? 'bg-studio-surface text-studio-cyan border border-studio-cyan/40'
                  : 'text-studio-muted hover:text-studio-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Real-Time Voice Changer DSP (Phase 3) */}
      <div className="bg-studio-surface/60 border border-studio-border rounded-lg p-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-studio-cyan" />
            <span className="text-xs font-semibold text-studio-text">
              Real-Time Voice Changer DSP
            </span>
          </div>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-studio-emerald/15 text-studio-emerald border border-studio-emerald/30">
            {dspLatencyMs.toFixed(1)} ms (&lt;25ms)
          </span>
        </div>

        {/* 4 Core Presets */}
        <div className="grid grid-cols-2 gap-1.5">
          {(['NORMAL', 'VTUBER_GIRL', 'CHILD', 'DEEP_ANON'] as const).map((presetKey) => {
            const preset = VOICE_DSP_PRESETS[presetKey];
            const isSelected = voiceDsp.preset === presetKey;
            return (
              <button
                key={presetKey}
                type="button"
                onClick={() => onSelectVoicePreset(presetKey)}
                title={preset.description}
                className={`px-2.5 py-1.5 rounded-md text-left text-xs border transition-colors ${
                  isSelected
                    ? 'bg-studio-cyan/15 text-studio-cyan border-studio-cyan/40 font-semibold'
                    : 'bg-studio-panel text-studio-muted hover:text-studio-text border-studio-border'
                }`}
              >
                <span className="block truncate">{preset.label}</span>
              </button>
            );
          })}
        </div>

        {/* Pitch & Formant Sliders */}
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] font-mono text-studio-muted">
              <span>Pitch (WSOLA)</span>
              <span className="text-studio-text">
                {voiceDsp.pitch_semitones > 0
                  ? `+${voiceDsp.pitch_semitones}`
                  : voiceDsp.pitch_semitones}{' '}
                st
              </span>
            </div>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={voiceDsp.pitch_semitones}
              onChange={(e) => onChangeVoicePitch(parseFloat(e.target.value))}
              aria-label="Geser Nada Pitch Semitone"
              className="w-full accent-studio-cyan"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] font-mono text-studio-muted">
              <span>Formant EQ</span>
              <span className="text-studio-text">
                {formantPercent > 0 ? `+${formantPercent}%` : `${formantPercent}%`}
              </span>
            </div>
            <input
              type="range"
              min={0.75}
              max={1.35}
              step={0.01}
              value={voiceDsp.formant_shift}
              onChange={(e) => onChangeVoiceFormant(parseFloat(e.target.value))}
              aria-label="Geser Resonansi Formant"
              className="w-full accent-studio-emerald"
            />
          </div>
        </div>

        {/* Audio Output Sink (setSinkId for VB-Cable) & Mic Monitor */}
        <div className="flex flex-col gap-2 pt-1.5 border-t border-studio-border/60">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="audio-sink-select"
              className="text-[11px] text-studio-muted flex items-center gap-1.5 shrink-0"
            >
              <Volume2 className="w-3.5 h-3.5 text-studio-cyan" />
              <span>Output (VB-Cable):</span>
            </label>
            <select
              id="audio-sink-select"
              value={selectedSinkId}
              onChange={(e) => onSelectOutputDevice(e.target.value)}
              className="bg-studio-panel border border-studio-border rounded px-2 py-1 text-xs text-studio-text font-mono max-w-[190px] truncate"
            >
              {outputDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.isVirtualCable ? `[VB-CABLE] ${dev.label}` : dev.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onToggleMicMonitor}
            className={`w-full py-1.5 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-2 border transition-colors ${
              micMonitor
                ? 'bg-studio-emerald/20 text-studio-emerald border-studio-emerald/40'
                : 'bg-studio-panel text-studio-muted hover:text-studio-text border-studio-border'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>{micMonitor ? 'Mic Monitor: AKTIF (Mendengar Suara)' : 'Aktifkan Mic Monitor'}</span>
          </button>
        </div>
      </div>

      {/* Local VTuber Studio Loader (.vrm / .png) */}
      <div className="bg-studio-surface/60 border border-studio-border rounded-lg p-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-studio-cyan" />
            <span className="text-xs font-semibold text-studio-text">
              Local VTuber Studio (.vrm / .png)
            </span>
          </div>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-studio-panel text-studio-cyan border border-studio-border">
            {avatarInfo.type.toUpperCase()}
          </span>
        </div>

        <input
          ref={avatarFileInputRef}
          type="file"
          accept=".vrm,.glb,.png,.webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onSelectAvatarFile(file);
              onChangeActiveMode('VTUBER_3D');
            }
          }}
        />

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => avatarFileInputRef.current?.click()}
            className="col-span-2 px-3 py-1.5 rounded-md bg-studio-panel hover:bg-studio-border border border-studio-border text-xs font-medium text-studio-text flex items-center justify-center gap-1.5 transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-studio-cyan" />
            <span>Impor .VRM / .PNG</span>
          </button>

          <button
            type="button"
            onClick={onResetAvatar}
            className="px-2.5 py-1.5 rounded-md bg-studio-panel hover:bg-studio-border border border-studio-border text-xs font-medium text-studio-muted hover:text-studio-text flex items-center justify-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-studio-border/60">
          <span className="text-[11px] text-studio-muted">Latar Avatar:</span>
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'room', label: 'Ruangan' },
                { id: 'solid', label: 'Solid' },
                { id: 'custom_image', label: 'Gambar' },
              ] as const
            ).map((bg) => (
              <button
                key={bg.id}
                type="button"
                onClick={() => {
                  onChangeAvatarBgMode(bg.id);
                  if (bg.id === 'custom_image') {
                    bgFileInputRef.current?.click();
                  }
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                  avatarBgMode === bg.id
                    ? 'bg-studio-cyan/15 text-studio-cyan border-studio-cyan/40'
                    : 'bg-studio-panel text-studio-muted border-studio-border'
                }`}
              >
                {bg.label}
              </button>
            ))}

            {avatarBgMode === 'solid' && (
              <input
                type="color"
                value={avatarBgColor}
                onChange={(e) => onChangeAvatarBgColor(e.target.value)}
                aria-label="Pilih Warna Latar Solid"
                className="w-5 h-5 rounded border border-studio-border bg-transparent"
              />
            )}

            <input
              ref={bgFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onSelectCustomBgImage(file);
              }}
            />
          </div>
        </div>
      </div>

      {/* AR Face Filter & Cinematic LUT Shader Selector */}
      <div className="bg-studio-surface/60 border border-studio-border rounded-lg p-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanFace className="w-4 h-4 text-studio-emerald" />
            <span className="text-xs font-semibold text-studio-text">
              Filter Wajah AR &amp; LUT Shader
            </span>
          </div>
          <ImageIcon className="w-3.5 h-3.5 text-studio-muted" />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {AR_FILTER_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChangeFilter(item.id);
                if (item.id !== 'none' && activeMode === 'RAW_CAM') {
                  onChangeActiveMode('AR_FILTER');
                }
              }}
              title={item.desc}
              className={`px-2.5 py-1.5 rounded-md text-left text-xs border transition-colors ${
                selectedFilter === item.id
                  ? 'bg-studio-emerald/15 text-studio-emerald border-studio-emerald/40 font-semibold'
                  : 'bg-studio-panel text-studio-muted hover:text-studio-text border-studio-border'
              }`}
            >
              <span className="block truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Vanish Mode & Double-Snap Quick Controls */}
      <div className="bg-studio-surface/60 border border-studio-border rounded-lg p-3 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hand className="w-4 h-4 text-studio-cyan" />
            <span className="text-xs font-semibold text-studio-text">
              Vanish &amp; Double-Snap
            </span>
          </div>
          <div className="flex items-center gap-1">
            {([30, 60] as const).map((fps) => (
              <button
                key={fps}
                type="button"
                onClick={() => onChangeTargetFps(fps)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  targetFps === fps
                    ? 'bg-studio-emerald/20 text-studio-emerald border-studio-emerald/40'
                    : 'text-studio-muted border-studio-border'
                }`}
              >
                {fps}FPS
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCaptureCleanPlate}
            className="px-2.5 py-1.5 rounded-md bg-studio-panel hover:bg-studio-border border border-studio-border text-xs font-medium text-studio-text flex items-center justify-center gap-1.5 transition-colors"
          >
            <Camera className="w-3.5 h-3.5 text-studio-cyan" />
            <span>Clean Plate</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleVanish('MANUAL')}
            className="px-2.5 py-1.5 rounded-md bg-studio-cyan/15 hover:bg-studio-cyan/25 border border-studio-cyan/40 text-xs font-semibold text-studio-cyan flex items-center justify-center gap-1.5 transition-colors"
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span>Toggle Vanish</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-studio-muted flex items-center gap-1">
            <Radio className="w-3.5 h-3.5 text-studio-amber" />
            <span>Sensitivitas Snap:</span>
          </span>
          <input
            type="range"
            min={0.15}
            max={0.95}
            step={0.05}
            value={snapSensitivity}
            onChange={(e) => onChangeSnapSensitivity(parseFloat(e.target.value))}
            aria-label="Sensitivitas Deteksi Jentikan Jari"
            className="w-28 accent-studio-amber"
          />
          <button
            type="button"
            onClick={onSimulateDoubleSnap}
            className="px-2 py-0.5 rounded bg-studio-panel hover:bg-studio-border border border-studio-border text-[11px] font-mono text-studio-amber"
          >
            Uji Snap
          </button>
        </div>

        <label
          htmlFor="auto-infill-toggle"
          className="flex items-center justify-between text-[11px] text-studio-muted"
        >
          <span className="flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 text-studio-emerald" />
            <span>Auto Background Infill (Segmenter)</span>
          </span>
          <input
            id="auto-infill-toggle"
            type="checkbox"
            checked={autoBackgroundInfill}
            onChange={(e) => onChangeAutoInfill(e.target.checked)}
            className="w-4 h-4 accent-studio-cyan rounded cursor-pointer"
          />
        </label>
      </div>
    </aside>
  );
};
