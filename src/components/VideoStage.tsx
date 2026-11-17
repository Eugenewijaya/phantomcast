import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  EyeOff,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Box,
  Cast,
} from 'lucide-react';
import { VisionEngine } from '../engines/visionEngine';
import { VtuberEngine, type VtuberModelInfo } from '../engines/vtuberEngine';
import { ArFilterProcessor } from '../engines/arFilterShader';
import type {
  ActiveMode,
  ArFilterId,
  AvatarBackgroundMode,
  NormalizedLandmarkPoint,
  PerformanceTelemetry,
  TriggerSource,
  VisionFrameTelemetry,
} from '../types/phantomcast';

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;
const EXPECTED_RGBA_BYTES = STAGE_WIDTH * STAGE_HEIGHT * 4;
const VANISH_FADE_MS = 400;
const VIRTUAL_CAM_WS_URL = 'ws://127.0.0.1:8765';

interface VideoStageProps {
  vanishMode: boolean;
  activeMode: ActiveMode;
  selectedFilter: ArFilterId;
  targetFps: 30 | 60;
  autoBackgroundInfill: boolean;
  voiceRms: number;
  avatarBgMode: AvatarBackgroundMode;
  avatarBgColor: string;
  customBgImageUrl: string | null;
  externalAvatarFile: File | null;
  resetAvatarCounter: number;
  onAvatarLoaded: (info: VtuberModelInfo) => void;
  onToggleVanish: (source: TriggerSource) => void;
  onVisionTelemetry: (telemetry: VisionFrameTelemetry) => void;
  onPerfTelemetry: (telemetry: PerformanceTelemetry) => void;
  cleanPlateTriggerCounter: number;
}

export const VideoStage: React.FC<VideoStageProps> = ({
  vanishMode,
  activeMode,
  selectedFilter,
  targetFps,
  autoBackgroundInfill,
  voiceRms,
  avatarBgMode,
  avatarBgColor,
  customBgImageUrl,
  externalAvatarFile,
  resetAvatarCounter,
  onAvatarLoaded,
  onToggleVanish,
  onVisionTelemetry,
  onPerfTelemetry,
  cleanPlateTriggerCounter,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanPlateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const personCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenBridgeRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);

  const visionEngineRef = useRef<VisionEngine | null>(null);
  const vtuberEngineRef = useRef<VtuberEngine | null>(null);
  const arFilterRef = useRef<ArFilterProcessor | null>(null);
  const customBgImgRef = useRef<HTMLImageElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const vanishModeRef = useRef<boolean>(vanishMode);
  const activeModeRef = useRef<ActiveMode>(activeMode);
  const selectedFilterRef = useRef<ArFilterId>(selectedFilter);
  const targetFpsRef = useRef<30 | 60>(targetFps);
  const autoInfillRef = useRef<boolean>(autoBackgroundInfill);
  const voiceRmsRef = useRef<number>(voiceRms);
  const avatarBgModeRef = useRef<AvatarBackgroundMode>(avatarBgMode);
  const avatarBgColorRef = useRef<string>(avatarBgColor);

  const vanishOpacityRef = useRef<number>(vanishMode ? 0 : 1);
  const hasCleanPlateRef = useRef<boolean>(false);
  const usingSyntheticCamRef = useRef<boolean>(false);
  const virtualCamConnectedRef = useRef<boolean>(false);
  const virtualCamFramesSentRef = useRef<number>(0);
  const streamToVirtualCamRef = useRef<boolean>(true);

  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [hasCleanPlate, setHasCleanPlate] = useState<boolean>(false);
  const [isCapturingPlate, setIsCapturingPlate] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [streamToVirtualCam, setStreamToVirtualCam] = useState<boolean>(true);
  const [virtualCamConnected, setVirtualCamConnected] = useState<boolean>(false);
  const [cameraStatusText, setCameraStatusText] = useState<string>('Menginisialisasi kamera...');
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);

  useEffect(() => {
    vanishModeRef.current = vanishMode;
  }, [vanishMode]);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  useEffect(() => {
    selectedFilterRef.current = selectedFilter;
  }, [selectedFilter]);

  useEffect(() => {
    targetFpsRef.current = targetFps;
  }, [targetFps]);

  useEffect(() => {
    autoInfillRef.current = autoBackgroundInfill;
  }, [autoBackgroundInfill]);

  useEffect(() => {
    voiceRmsRef.current = voiceRms;
  }, [voiceRms]);

  useEffect(() => {
    avatarBgModeRef.current = avatarBgMode;
  }, [avatarBgMode]);

  useEffect(() => {
    avatarBgColorRef.current = avatarBgColor;
  }, [avatarBgColor]);

  useEffect(() => {
    streamToVirtualCamRef.current = streamToVirtualCam;
  }, [streamToVirtualCam]);

  useEffect(() => {
    if (!customBgImageUrl) {
      customBgImgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      customBgImgRef.current = img;
    };
    img.src = customBgImageUrl;
  }, [customBgImageUrl]);

  // Phase 4: WebSocket Client to Python Virtual Camera Bridge (ws://127.0.0.1:8765)
  useEffect(() => {
    let mounted = true;
    let reconnectTimer: number | null = null;

    function connectBridge() {
      if (!mounted) return;
      try {
        const ws = new WebSocket(VIRTUAL_CAM_WS_URL);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted) return;
          virtualCamConnectedRef.current = true;
          setVirtualCamConnected(true);
          ws.send(
            JSON.stringify({
              type: 'HELLO',
              width: STAGE_WIDTH,
              height: STAGE_HEIGHT,
              fps: targetFpsRef.current,
            })
          );
        };

        ws.onclose = () => {
          virtualCamConnectedRef.current = false;
          if (mounted) {
            setVirtualCamConnected(false);
            reconnectTimer = window.setTimeout(connectBridge, 3000);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        if (mounted) {
          reconnectTimer = window.setTimeout(connectBridge, 3500);
        }
      }
    }

    connectBridge();

    return () => {
      mounted = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const renderSyntheticStudioBackground = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0D131D');
      grad.addColorStop(0.55, '#131C2B');
      grad.addColorStop(1, '#0A0E16');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(34, 45, 64, 0.55)';
      ctx.lineWidth = 2;
      const cols = 8;
      for (let i = 1; i < cols; i++) {
        const x = (w / cols) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h * 0.78);
        ctx.stroke();
      }

      const ledGrad = ctx.createLinearGradient(w * 0.15, 0, w * 0.85, 0);
      ledGrad.addColorStop(0, 'rgba(0, 229, 255, 0)');
      ledGrad.addColorStop(0.5, 'rgba(0, 229, 255, 0.35)');
      ledGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
      ctx.fillStyle = ledGrad;
      ctx.fillRect(w * 0.15, h * 0.22, w * 0.7, 4);

      ctx.fillStyle = '#0B0F17';
      ctx.fillRect(0, h * 0.78, w, h * 0.22);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.78);
      ctx.lineTo(w, h * 0.78);
      ctx.stroke();
    },
    []
  );

  const captureCleanPlate = useCallback(() => {
    const cleanCanvas = cleanPlateCanvasRef.current;
    const video = videoRef.current;
    if (!cleanCanvas) return;

    setIsCapturingPlate(true);
    const ctx = cleanCanvas.getContext('2d');
    if (!ctx) return;

    if (video && video.readyState >= 2 && !usingSyntheticCamRef.current) {
      ctx.drawImage(video, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    } else {
      renderSyntheticStudioBackground(ctx, STAGE_WIDTH, STAGE_HEIGHT);
    }

    hasCleanPlateRef.current = true;
    setHasCleanPlate(true);
    window.setTimeout(() => {
      setIsCapturingPlate(false);
    }, 350);
  }, [renderSyntheticStudioBackground]);

  useEffect(() => {
    if (cleanPlateTriggerCounter > 0) {
      captureCleanPlate();
    }
  }, [cleanPlateTriggerCounter, captureCleanPlate]);

  const handleLoadAvatarFile = useCallback(
    async (file: File) => {
      if (!vtuberEngineRef.current) return;
      try {
        setAvatarNotice(`Memuat model ${file.name}...`);
        const info = await vtuberEngineRef.current.loadLocalFile(file);
        onAvatarLoaded(info);
        setAvatarNotice(`Model aktif: ${info.name}`);
        window.setTimeout(() => setAvatarNotice(null), 3000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat model';
        setAvatarNotice(msg);
        window.setTimeout(() => setAvatarNotice(null), 4000);
      }
    },
    [onAvatarLoaded]
  );

  useEffect(() => {
    if (externalAvatarFile) {
      void handleLoadAvatarFile(externalAvatarFile);
    }
  }, [externalAvatarFile, handleLoadAvatarFile]);

  useEffect(() => {
    if (resetAvatarCounter > 0 && vtuberEngineRef.current) {
      const info = vtuberEngineRef.current.resetToBuiltInAvatar();
      onAvatarLoaded(info);
      setAvatarNotice('Model direset ke HoloUnit-01 (3D Bawaan)');
      window.setTimeout(() => setAvatarNotice(null), 2500);
    }
  }, [resetAvatarCounter, onAvatarLoaded]);

  // Initialize Engines & OffscreenCanvas Bridge Buffer
  useEffect(() => {
    let mounted = true;

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = STAGE_WIDTH;
    cleanCanvas.height = STAGE_HEIGHT;
    cleanPlateCanvasRef.current = cleanCanvas;

    const workCanvas = document.createElement('canvas');
    workCanvas.width = STAGE_WIDTH;
    workCanvas.height = STAGE_HEIGHT;
    workCanvasRef.current = workCanvas;

    const personCanvas = document.createElement('canvas');
    personCanvas.width = STAGE_WIDTH;
    personCanvas.height = STAGE_HEIGHT;
    personCanvasRef.current = personCanvas;

    if (typeof OffscreenCanvas !== 'undefined') {
      offscreenBridgeRef.current = new OffscreenCanvas(STAGE_WIDTH, STAGE_HEIGHT);
    } else {
      const fallbackBridge = document.createElement('canvas');
      fallbackBridge.width = STAGE_WIDTH;
      fallbackBridge.height = STAGE_HEIGHT;
      offscreenBridgeRef.current = fallbackBridge;
    }

    const cleanCtx = cleanCanvas.getContext('2d');
    if (cleanCtx) {
      renderSyntheticStudioBackground(cleanCtx, STAGE_WIDTH, STAGE_HEIGHT);
    }

    const visionEngine = new VisionEngine(() => {
      if (mounted) {
        onToggleVanish('GESTURE_V_SIGN');
      }
    });
    visionEngineRef.current = visionEngine;
    void visionEngine.initialize();

    const vtuberEngine = new VtuberEngine();
    vtuberEngineRef.current = vtuberEngine;
    onAvatarLoaded(vtuberEngine.getModelInfo());

    const arFilter = new ArFilterProcessor();
    arFilterRef.current = arFilter;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: STAGE_WIDTH },
            height: { ideal: STAGE_HEIGHT },
            frameRate: { ideal: 60 },
          },
          audio: false,
        });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          usingSyntheticCamRef.current = false;
          setCameraReady(true);
          setCameraStatusText('Kamera Aktif (1280x720)');
        }
      } catch {
        if (!mounted) return;
        usingSyntheticCamRef.current = true;
        setCameraReady(true);
        setCameraStatusText('Mode Simulasi Studio (Tanpa Webcam Fisik)');
      }
    }

    void startCamera();

    return () => {
      mounted = false;
      visionEngine.dispose();
      vtuberEngine.dispose();
      arFilter.dispose();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [onAvatarLoaded, onToggleVanish, renderSyntheticStudioBackground]);

  // 60 FPS Render, AR Filter, VTuber & WebSocket Virtual Camera Bridge Loop
  useEffect(() => {
    let rafId = 0;
    let lastRenderMs = performance.now();
    let lastWsSendMs = performance.now();
    let lastTelemetryEmitMs = 0;
    let fpsFrameCount = 0;
    let fpsLastSecondMs = performance.now();
    let measuredFps = 60;

    const renderLoop = (nowMs: number) => {
      rafId = requestAnimationFrame(renderLoop);

      const minIntervalMs = targetFpsRef.current === 30 ? 1000 / 31 : 0;
      if (minIntervalMs > 0 && nowMs - lastRenderMs < minIntervalMs) {
        return;
      }

      const deltaMs = Math.min(100, Math.max(1, nowMs - lastRenderMs));
      lastRenderMs = nowMs;

      fpsFrameCount++;
      if (nowMs - fpsLastSecondMs >= 500) {
        measuredFps = Math.min(
          60,
          Math.round((fpsFrameCount * 1000) / (nowMs - fpsLastSecondMs))
        );
        fpsFrameCount = 0;
        fpsLastSecondMs = nowMs;
      }

      // Smooth 400ms Vanish Mode fade transition
      const targetOpacity = vanishModeRef.current ? 0.0 : 1.0;
      const step = deltaMs / VANISH_FADE_MS;
      if (vanishOpacityRef.current < targetOpacity) {
        vanishOpacityRef.current = Math.min(targetOpacity, vanishOpacityRef.current + step);
      } else if (vanishOpacityRef.current > targetOpacity) {
        vanishOpacityRef.current = Math.max(targetOpacity, vanishOpacityRef.current - step);
      }
      const currentOpacity = vanishOpacityRef.current;

      const outCanvas = outputCanvasRef.current;
      const cleanCanvas = cleanPlateCanvasRef.current;
      const workCanvas = workCanvasRef.current;
      const personCanvas = personCanvasRef.current;
      const video = videoRef.current;
      if (!outCanvas || !cleanCanvas || !workCanvas || !personCanvas) return;

      const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
      const workCtx = workCanvas.getContext('2d');
      const personCtx = personCanvas.getContext('2d');
      if (!outCtx || !workCtx || !personCtx) return;

      // 1. Run AI Vision Telemetry
      let visionData: VisionFrameTelemetry = {
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
      };

      if (video && !usingSyntheticCamRef.current && visionEngineRef.current) {
        visionData = visionEngineRef.current.processVideoFrame(video, nowMs, {
          enableHandTracking: true,
          enableFaceTracking:
            activeModeRef.current !== 'RAW_CAM' || selectedFilterRef.current !== 'none',
          enableSegmentation:
            currentOpacity < 0.999 || autoInfillRef.current,
        });
      }

      // 2. Draw Base Background Layer onto outCtx
      if (activeModeRef.current === 'VTUBER_3D') {
        if (avatarBgModeRef.current === 'solid') {
          outCtx.fillStyle = avatarBgColorRef.current || '#0D131D';
          outCtx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        } else if (avatarBgModeRef.current === 'custom_image' && customBgImgRef.current) {
          outCtx.drawImage(customBgImgRef.current, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        } else {
          outCtx.drawImage(cleanCanvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        }
      } else {
        outCtx.drawImage(cleanCanvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      }

      // 3. Render Subject Layer (VTuber 3D / 2D or Camera / Synthetic Feed)
      if (activeModeRef.current === 'VTUBER_3D' && vtuberEngineRef.current) {
        workCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        vtuberEngineRef.current.updateAndRenderVtuber(
          workCtx,
          visionData.faceLandmarks[0],
          voiceRmsRef.current,
          nowMs
        );
      } else if (video && video.readyState >= 2 && !usingSyntheticCamRef.current) {
        workCtx.drawImage(video, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      } else {
        renderSyntheticStudioBackground(workCtx, STAGE_WIDTH, STAGE_HEIGHT);
        const bobY = Math.sin(nowMs * 0.003) * 6;
        workCtx.save();
        workCtx.fillStyle = '#1E293B';
        workCtx.beginPath();
        workCtx.ellipse(
          STAGE_WIDTH * 0.5,
          STAGE_HEIGHT * 0.82 + bobY,
          170,
          140,
          0,
          Math.PI,
          Math.PI * 2
        );
        workCtx.fill();
        workCtx.fillStyle = '#334155';
        workCtx.beginPath();
        workCtx.arc(STAGE_WIDTH * 0.5, STAGE_HEIGHT * 0.48 + bobY, 72, 0, Math.PI * 2);
        workCtx.fill();
        workCtx.strokeStyle = '#00E5FF';
        workCtx.lineWidth = 2;
        workCtx.stroke();
        workCtx.restore();
      }

      // 4. Composite Subject with 400ms Vanish Mode Fade Opacity & Segmentation Mask
      if (currentOpacity > 0.005) {
        if (
          activeModeRef.current !== 'VTUBER_3D' &&
          visionData.categoryMask &&
          visionData.maskWidth === STAGE_WIDTH &&
          visionData.maskHeight === STAGE_HEIGHT &&
          (autoInfillRef.current || currentOpacity < 0.995)
        ) {
          const subjectImg = workCtx.getImageData(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
          const pixels = subjectImg.data;
          const mask = visionData.categoryMask;
          for (let i = 0; i < mask.length; i++) {
            pixels[i * 4 + 3] = Math.round(mask[i] * currentOpacity);
          }
          personCtx.putImageData(subjectImg, 0, 0);
          outCtx.drawImage(personCanvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        } else {
          outCtx.save();
          outCtx.globalAlpha = currentOpacity;
          outCtx.drawImage(workCanvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
          outCtx.restore();
        }
      }

      // 5. Apply AR Face Filter / Shader Overlay when selected
      const effectiveFilter =
        activeModeRef.current === 'AR_FILTER' && selectedFilterRef.current === 'none'
          ? 'neon_visor_01'
          : selectedFilterRef.current;

      if (effectiveFilter !== 'none' && arFilterRef.current && currentOpacity > 0.05) {
        arFilterRef.current.applyFilter(
          outCtx,
          outCanvas,
          effectiveFilter,
          visionData.faceLandmarks[0],
          visionData.headPose,
          nowMs
        );
      }

      // 6. Render Hand V-Sign Skeleton Overlay
      if (visionData.handLandmarks.length > 0) {
        drawHandOverlay(outCtx, visionData.handLandmarks, visionData.isVSignDetected);
      }

      // 7. Stream binary RGBA ArrayBuffer (1280x720) from OffscreenCanvas to ws://127.0.0.1:8765
      const ws = wsRef.current;
      if (
        streamToVirtualCamRef.current &&
        ws &&
        ws.readyState === WebSocket.OPEN &&
        ws.bufferedAmount <= EXPECTED_RGBA_BYTES &&
        nowMs - lastWsSendMs >= 32
      ) {
        lastWsSendMs = nowMs;
        const bridgeCanvas = offscreenBridgeRef.current;
        if (bridgeCanvas) {
          const bridgeCtx = bridgeCanvas.getContext('2d', {
            willReadFrequently: true,
          }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
          if (bridgeCtx) {
            bridgeCtx.drawImage(outCanvas, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
            const imgData = bridgeCtx.getImageData(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
            ws.send(imgData.data.buffer);
            virtualCamFramesSentRef.current += 1;
          }
        }
      }

      // Throttle HUD React state updates to ~12.5 Hz (every 80ms) to keep CPU <15%
      if (nowMs - lastTelemetryEmitMs >= 80) {
        lastTelemetryEmitMs = nowMs;
        onVisionTelemetry(visionData);
        onPerfTelemetry({
          fps: measuredFps,
          targetFps: targetFpsRef.current,
          frameTimeMs: deltaMs,
          vanishOpacity: currentOpacity,
          hasCleanPlate: hasCleanPlateRef.current,
          autoBackgroundInfill: autoInfillRef.current,
          virtualCamConnected: virtualCamConnectedRef.current,
          virtualCamFramesSent: virtualCamFramesSentRef.current,
        });
      }
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [onPerfTelemetry, onVisionTelemetry, renderSyntheticStudioBackground]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleLoadAvatarFile(file);
    }
  };

  return (
    <section
      aria-label="Kanvas Utama Pemrosesan Video"
      className="flex flex-col gap-3 w-full"
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative w-full aspect-video bg-studio-panel border rounded-xl overflow-hidden shadow-2xl transition-colors ${
          isDraggingOver
            ? 'border-studio-cyan ring-2 ring-studio-cyan/40'
            : 'border-studio-border'
        }`}
      >
        {/* Hidden raw webcam element */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="hidden"
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
        />

        {/* Primary 60 FPS Compositing Canvas */}
        <canvas
          ref={outputCanvasRef}
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          className="w-full h-full object-contain bg-studio-bg"
        />

        {/* Drag-and-Drop Overlay for Local .vrm / .png */}
        {isDraggingOver && (
          <div className="absolute inset-0 bg-studio-bg/85 backdrop-blur-md flex flex-col items-center justify-center gap-3 z-20 pointer-events-none">
            <div className="p-4 rounded-full bg-studio-cyan/15 border border-studio-cyan/40 text-studio-cyan">
              <Upload className="w-8 h-8" />
            </div>
            <p className="text-sm font-semibold text-studio-text">
              Lepaskan berkas <span className="font-mono text-studio-cyan">.vrm</span> atau{' '}
              <span className="font-mono text-studio-cyan">.png</span> untuk memuat Avatar Lokal
            </p>
          </div>
        )}

        {/* Top-left Live Status Badge */}
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 pointer-events-none">
          <div className="px-2.5 py-1 rounded-md bg-studio-bg/85 backdrop-blur-md border border-studio-border flex items-center gap-2 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                cameraReady ? 'bg-studio-emerald' : 'bg-studio-amber'
              }`}
            />
            <span className="text-studio-text">{cameraStatusText}</span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-studio-bg/85 backdrop-blur-md border border-studio-border text-xs font-mono text-studio-cyan flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5" />
            <span>{activeMode}</span>
          </div>

          {vanishMode && (
            <div className="px-2.5 py-1 rounded-md bg-studio-amber/20 backdrop-blur-md border border-studio-amber/50 text-studio-amber text-xs font-mono font-semibold flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5" />
              <span>VANISH MODE AKTIF</span>
            </div>
          )}

          {avatarNotice && (
            <div className="px-2.5 py-1 rounded-md bg-studio-cyan/20 backdrop-blur-md border border-studio-cyan/40 text-studio-cyan text-xs font-mono">
              {avatarNotice}
            </div>
          )}
        </div>

        {/* Bottom Floating Stage Action Bar */}
        <div className="absolute bottom-3 inset-x-3 flex flex-wrap items-center justify-between gap-2 bg-studio-bg/85 backdrop-blur-md border border-studio-border rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={captureCleanPlate}
              className="px-3 py-1.5 rounded-md bg-studio-surface hover:bg-studio-border text-studio-text border border-studio-border text-xs font-medium flex items-center gap-2 transition-colors"
            >
              <Camera className="w-3.5 h-3.5 text-studio-cyan" />
              <span>
                {isCapturingPlate
                  ? 'Menyimpan Clean Plate...'
                  : 'Ambil Latar Kosong (Clean Plate)'}
              </span>
            </button>

            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-studio-muted">
              {hasCleanPlate ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-studio-emerald" />
                  <span>Clean Plate Siap</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-studio-amber" />
                  <span>Auto Infill Siaga</span>
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStreamToVirtualCam((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-mono border flex items-center gap-1.5 transition-colors ${
                virtualCamConnected && streamToVirtualCam
                  ? 'bg-studio-emerald/15 text-studio-emerald border-studio-emerald/40'
                  : 'bg-studio-surface text-studio-muted border-studio-border'
              }`}
              title="Status Streaming ke ws://127.0.0.1:8765 (PyVirtualCam)"
            >
              <Cast className="w-3.5 h-3.5" />
              <span>{virtualCamConnected ? 'VirtualCam: ON' : 'VirtualCam: WS:8765'}</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleVanish('MANUAL')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                vanishMode
                  ? 'bg-studio-amber text-studio-bg hover:bg-studio-amber/90'
                  : 'bg-studio-cyan text-studio-bg hover:bg-studio-cyan/90'
              }`}
            >
              {vanishMode ? (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>Tampilkan Diri</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Aktifkan Vanish (400ms)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  hands: NormalizedLandmarkPoint[][],
  isVSign: boolean
): void {
  ctx.save();
  for (const hand of hands) {
    if (hand.length < 21) continue;
    ctx.strokeStyle = isVSign ? '#00E5FF' : 'rgba(148, 163, 184, 0.6)';
    ctx.lineWidth = isVSign ? 3 : 1.5;

    const chains = [
      [0, 5, 6, 7, 8],
      [0, 9, 10, 11, 12],
    ];
    for (const chain of chains) {
      ctx.beginPath();
      for (let i = 0; i < chain.length; i++) {
        const pt = hand[chain[i]];
        const x = pt.x * STAGE_WIDTH;
        const y = pt.y * STAGE_HEIGHT;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
