import React from 'react';
import {
  Activity,
  Hand,
  Radio,
  Cpu,
  EyeOff,
  Eye,
  Layers,
  Cast,
} from 'lucide-react';
import type {
  PerformanceTelemetry,
  SnapTelemetry,
  VisionFrameTelemetry,
} from '../types/phantomcast';

interface PerformanceHUDProps {
  perf: PerformanceTelemetry;
  vision: VisionFrameTelemetry;
  snap: SnapTelemetry;
  vanishMode: boolean;
}

export const PerformanceHUD: React.FC<PerformanceHUDProps> = ({
  perf,
  vision,
  snap,
  vanishMode,
}) => {
  const holdPercent = Math.round(vision.vSignHoldProgress * 100);
  const snapPercent = Math.min(100, Math.round(snap.snapEnergy * 100));
  const opacityPercent = Math.round(perf.vanishOpacity * 100);

  return (
    <div
      role="status"
      aria-label="Telemetri Performa Real-Time"
      className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full"
    >
      {/* 1. FPS & Frame Time */}
      <div className="bg-studio-panel/90 border border-studio-border rounded-lg px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-md bg-studio-surface text-studio-cyan shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-studio-muted font-medium truncate">
              Frame Rate
            </p>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-sm font-semibold text-studio-text">
                {perf.fps} FPS
              </span>
              <span className="font-mono text-[11px] text-studio-muted">
                ({perf.frameTimeMs.toFixed(1)} ms)
              </span>
            </div>
          </div>
        </div>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
            perf.fps >= perf.targetFps - 5
              ? 'bg-studio-emerald/10 text-studio-emerald border-studio-emerald/30'
              : 'bg-studio-amber/10 text-studio-amber border-studio-amber/30'
          }`}
        >
          {perf.targetFps}Hz
        </span>
      </div>

      {/* 2. V-Sign Gesture Status & 500ms Hold Bar */}
      <div className="bg-studio-panel/90 border border-studio-border rounded-lg px-3 py-2.5 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Hand
              className={`w-4 h-4 shrink-0 ${
                vision.isVSignDetected ? 'text-studio-cyan' : 'text-studio-muted'
              }`}
            />
            <span className="text-[11px] uppercase tracking-wider text-studio-muted font-medium truncate">
              Pose V-Sign
            </span>
          </div>
          <span className="font-mono text-xs text-studio-text">
            {vision.vSignCooldownMs > 0
              ? `CD ${(vision.vSignCooldownMs / 1000).toFixed(1)}s`
              : vision.isVSignDetected
              ? `${vision.vSignAngleDeg.toFixed(0)}° (${holdPercent}%)`
              : 'Siaga'}
          </span>
        </div>
        <div className="w-full h-1.5 bg-studio-surface rounded-full overflow-hidden mt-1.5">
          <div
            className="h-full bg-studio-cyan transition-all duration-75"
            style={{ width: `${holdPercent}%` }}
          />
        </div>
      </div>

      {/* 3. FFT 512 Double-Snap Level Meter */}
      <div className="bg-studio-panel/90 border border-studio-border rounded-lg px-3 py-2.5 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Radio
              className={`w-4 h-4 shrink-0 ${
                snap.snapCount > 0 ? 'text-studio-amber' : 'text-studio-muted'
              }`}
            />
            <span className="text-[11px] uppercase tracking-wider text-studio-muted font-medium truncate">
              FFT 512 Snap (2.5-7kHz)
            </span>
          </div>
          <span className="font-mono text-xs text-studio-text">
            {snap.snapCount}/2 ({snap.lastImpulseMs}ms)
          </span>
        </div>
        <div className="w-full h-1.5 bg-studio-surface rounded-full overflow-hidden mt-1.5">
          <div
            className="h-full bg-studio-amber transition-all duration-75"
            style={{ width: `${snapPercent}%` }}
          />
        </div>
      </div>

      {/* 4. Vanish Opacity & Virtual Cam Status */}
      <div className="bg-studio-panel/90 border border-studio-border rounded-lg px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`p-1.5 rounded-md shrink-0 ${
              vanishMode
                ? 'bg-studio-amber/15 text-studio-amber'
                : 'bg-studio-emerald/15 text-studio-emerald'
            }`}
          >
            {vanishMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-studio-muted font-medium truncate">
              Status Subjek
            </p>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-studio-text">
                {vanishMode ? 'VANISHED' : 'VISIBLE'} ({opacityPercent}%)
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" title="Status Jembatan Virtual Camera">
          <Cast
            className={`w-3.5 h-3.5 ${
              perf.virtualCamConnected ? 'text-studio-emerald' : 'text-studio-muted'
            }`}
          />
          <Cpu
            className={`w-3.5 h-3.5 ${
              vision.modelsLoaded.segmenter ? 'text-studio-cyan' : 'text-studio-muted'
            }`}
          />
          <Layers
            className={`w-3.5 h-3.5 ${
              perf.hasCleanPlate ? 'text-studio-emerald' : 'text-studio-muted'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
