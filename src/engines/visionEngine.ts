import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';
import type { NormalizedLandmarkPoint, VisionFrameTelemetry } from '../types/phantomcast';

export const V_SIGN_HOLD_MS = 500;
export const V_SIGN_COOLDOWN_MS = 2000;
export const V_SIGN_GAP_TOLERANCE_MS = 150;

export interface VSignEvalResult {
  isVSign: boolean;
  angleDeg: number;
}

/**
 * Evaluates whether a 21-point MediaPipe hand landmark array forms a "V" sign:
 * - Index finger (MCP 5, PIP 6, TIP 8) extended
 * - Middle finger (MCP 9, PIP 10, TIP 12) extended
 * - Ring finger (MCP 13, PIP 14, TIP 16) curled
 * - Pinky finger (MCP 17, PIP 18, TIP 20) curled
 * - Spread angle between index (5->8) and middle (9->12) between 7 deg and 75 deg
 */
export function evaluateVSignLandmarks(landmarks: NormalizedLandmarkPoint[]): VSignEvalResult {
  if (!landmarks || landmarks.length < 21) {
    return { isVSign: false, angleDeg: 0 };
  }

  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const indexPip = landmarks[6];
  const indexTip = landmarks[8];

  const middleMcp = landmarks[9];
  const middlePip = landmarks[10];
  const middleTip = landmarks[12];

  const ringMcp = landmarks[13];
  const ringPip = landmarks[14];
  const ringTip = landmarks[16];

  const pinkyMcp = landmarks[17];
  const pinkyPip = landmarks[18];
  const pinkyTip = landmarks[20];

  const dist2D = (a: NormalizedLandmarkPoint, b: NormalizedLandmarkPoint): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

  // Distance from wrist makes the check robust across hand orientation
  const indexExtended =
    dist2D(wrist, indexTip) > dist2D(wrist, indexPip) * 1.14 &&
    dist2D(wrist, indexTip) > dist2D(wrist, indexMcp) * 1.35;

  const middleExtended =
    dist2D(wrist, middleTip) > dist2D(wrist, middlePip) * 1.14 &&
    dist2D(wrist, middleTip) > dist2D(wrist, middleMcp) * 1.35;

  const ringCurled = dist2D(wrist, ringTip) < dist2D(wrist, ringPip) * 1.08;
  const pinkyCurled = dist2D(wrist, pinkyTip) < dist2D(wrist, pinkyPip) * 1.08;

  // Compute angle between index vector (5 -> 8) and middle vector (9 -> 12)
  const v1x = indexTip.x - indexMcp.x;
  const v1y = indexTip.y - indexMcp.y;
  const v2x = middleTip.x - middleMcp.x;
  const v2y = middleTip.y - middleMcp.y;

  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);

  if (mag1 < 1e-5 || mag2 < 1e-5) {
    return { isVSign: false, angleDeg: 0 };
  }

  const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (mag1 * mag2)));
  const angleDeg = (Math.acos(cosTheta) * 180) / Math.PI;

  const tipSeparation = dist2D(indexTip, middleTip);
  const mcpSeparation = Math.max(0.01, dist2D(indexMcp, middleMcp));
  const hasVSpread = angleDeg >= 7 && angleDeg <= 75 && tipSeparation > mcpSeparation * 1.08;

  return {
    isVSign: indexExtended && middleExtended && ringCurled && pinkyCurled && hasVSpread,
    angleDeg: Math.round(angleDeg * 10) / 10,
  };
}

/**
 * Computes head orientation (roll, pitch, yaw in radians) from 478 MediaPipe FaceMesh landmarks.
 */
export function estimateHeadPoseFromFace(landmarks: NormalizedLandmarkPoint[]): {
  roll: number;
  pitch: number;
  yaw: number;
} {
  if (!landmarks || landmarks.length < 468) {
    return { roll: 0, pitch: 0, yaw: 0 };
  }

  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const noseTip = landmarks[1];
  const forehead = landmarks[10];
  const chin = landmarks[152];

  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  const roll = Math.atan2(dy, dx);

  const eyeMidX = (leftEye.x + rightEye.x) * 0.5;
  const eyeSpan = Math.max(0.01, Math.hypot(dx, dy));
  const yaw = Math.max(-0.85, Math.min(0.85, ((noseTip.x - eyeMidX) / (eyeSpan * 0.5)) * 0.75));

  const faceHeight = Math.max(0.01, Math.hypot(chin.x - forehead.x, chin.y - forehead.y));
  const faceMidY = (forehead.y + chin.y) * 0.5;
  const pitch = Math.max(-0.75, Math.min(0.75, ((noseTip.y - faceMidY) / (faceHeight * 0.5)) * 0.8));

  return { roll, pitch, yaw };
}

export class VisionEngine {
  private handLandmarker: HandLandmarker | null = null;
  private faceLandmarker: FaceLandmarker | null = null;
  private imageSegmenter: ImageSegmenter | null = null;

  private isInitializing = false;
  private modelsLoaded = {
    hand: false,
    face: false,
    segmenter: false,
  };

  private holdStartMs: number | null = null;
  private lastSeenVSignMs = -Infinity;
  private isLatched = false;
  private lastTriggerMs = -Infinity;
  private lastVideoTime = -1;
  private frameCounter = 0;

  private cachedHandLandmarks: NormalizedLandmarkPoint[][] = [];
  private cachedFaceLandmarks: NormalizedLandmarkPoint[][] = [];
  private cachedHeadPose = { roll: 0, pitch: 0, yaw: 0 };
  private cachedMask: Uint8Array | null = null;
  private cachedMaskWidth = 0;
  private cachedMaskHeight = 0;
  private cachedVAngleDeg = 0;
  private cachedIsVSign = false;

  private onVSignTrigger?: () => void;

  constructor(onVSignTrigger?: () => void) {
    this.onVSignTrigger = onVSignTrigger;
  }

  public setOnVSignTrigger(cb: () => void): void {
    this.onVSignTrigger = cb;
  }

  public async initialize(): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      // Load WASM strictly from local public/wasm or public/models directory (Anti-CSP block)
      let visionWasm;
      try {
        visionWasm = await FilesetResolver.forVisionTasks('./wasm');
      } catch {
        visionWasm = await FilesetResolver.forVisionTasks('./models');
      }

      // 1. HandLandmarker
      try {
        this.handLandmarker = await this.createWithFallback((delegate) =>
          HandLandmarker.createFromOptions(visionWasm, {
            baseOptions: {
              modelAssetPath: './models/hand_landmarker.task',
              delegate,
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          })
        );
        this.modelsLoaded.hand = true;
      } catch (err) {
        console.warn('[VisionEngine] HandLandmarker gagal dimuat secara lokal:', err);
      }

      // 2. FaceLandmarker (478 points + blendshapes)
      try {
        this.faceLandmarker = await this.createWithFallback((delegate) =>
          FaceLandmarker.createFromOptions(visionWasm, {
            baseOptions: {
              modelAssetPath: './models/face_landmarker.task',
              delegate,
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          })
        );
        this.modelsLoaded.face = true;
      } catch (err) {
        console.warn('[VisionEngine] FaceLandmarker gagal dimuat secara lokal:', err);
      }

      // 3. ImageSegmenter (Selfie Segmenter)
      try {
        this.imageSegmenter = await this.createWithFallback((delegate) =>
          ImageSegmenter.createFromOptions(visionWasm, {
            baseOptions: {
              modelAssetPath: './models/selfie_segmenter.tflite',
              delegate,
            },
            runningMode: 'VIDEO',
            outputCategoryMask: true,
            outputConfidenceMasks: true,
          })
        );
        this.modelsLoaded.segmenter = true;
      } catch (err) {
        console.warn('[VisionEngine] ImageSegmenter gagal dimuat secara lokal:', err);
      }
    } catch (err) {
      console.warn('[VisionEngine] Runtime WASM lokal belum siap:', err);
    } finally {
      this.isInitializing = false;
    }
  }

  private async createWithFallback<T>(factory: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
    try {
      return await factory('GPU');
    } catch {
      return await factory('CPU');
    }
  }

  /**
   * Processes a video frame and returns full vision telemetry.
   * Runs segmentation and landmark detection with monotonic timestamps.
   */
  public processVideoFrame(
    video: HTMLVideoElement,
    nowMs: number,
    options: {
      enableSegmentation: boolean;
      enableFaceTracking: boolean;
      enableHandTracking: boolean;
    }
  ): VisionFrameTelemetry {
    this.frameCounter++;
    const videoReady = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
    const isNewFrame = videoReady && video.currentTime !== this.lastVideoTime;

    if (isNewFrame) {
      this.lastVideoTime = video.currentTime;
      const timestampMs = Math.floor(nowMs);

      // Hand Detection & V-Sign Pose Check
      if (options.enableHandTracking && this.handLandmarker) {
        try {
          const handRes = this.handLandmarker.detectForVideo(video, timestampMs);
          this.cachedHandLandmarks = (handRes.landmarks ?? []) as NormalizedLandmarkPoint[][];
        } catch {
          // Ignore transient timestamp collisions
        }
      }

      // Face Landmarks (478 points) for AR Filter & VTuber Kalidokit
      if (options.enableFaceTracking && this.faceLandmarker) {
        try {
          const faceRes = this.faceLandmarker.detectForVideo(video, timestampMs + 1);
          this.cachedFaceLandmarks = (faceRes.faceLandmarks ?? []) as NormalizedLandmarkPoint[][];
          if (this.cachedFaceLandmarks.length > 0) {
            this.cachedHeadPose = estimateHeadPoseFromFace(this.cachedFaceLandmarks[0]);
          }
        } catch {
          // Ignore transient timestamp collisions
        }
      }

      // Body Segmentation for Vanish Mode / Background Replacement
      if (options.enableSegmentation && this.imageSegmenter) {
        try {
          this.imageSegmenter.segmentForVideo(video, timestampMs + 2, (result) => {
            if (result.confidenceMasks && result.confidenceMasks.length > 0) {
              const confMask = result.confidenceMasks[0];
              const floatArr = confMask.getAsFloat32Array();
              const w = confMask.width;
              const h = confMask.height;
              if (!this.cachedMask || this.cachedMask.length !== floatArr.length) {
                this.cachedMask = new Uint8Array(floatArr.length);
              }
              for (let i = 0; i < floatArr.length; i++) {
                this.cachedMask[i] = Math.min(255, Math.max(0, Math.round(floatArr[i] * 255)));
              }
              this.cachedMaskWidth = w;
              this.cachedMaskHeight = h;
              confMask.close();
            } else if (result.categoryMask) {
              const catMask = result.categoryMask;
              const uintArr = catMask.getAsUint8Array();
              const w = catMask.width;
              const h = catMask.height;
              if (!this.cachedMask || this.cachedMask.length !== uintArr.length) {
                this.cachedMask = new Uint8Array(uintArr.length);
              }
              for (let i = 0; i < uintArr.length; i++) {
                // In selfie_segmenter, category 0 or >0 indicates person mask depending on model variant
                this.cachedMask[i] = uintArr[i] > 0 ? 255 : 0;
              }
              this.cachedMaskWidth = w;
              this.cachedMaskHeight = h;
              catMask.close();
            }
          });
        } catch {
          // Ignore transient segmentation frame errors
        }
      }
    }

    // Evaluate V-Sign across any detected hand
    let detectedVSign = false;
    let bestAngle = 0;
    for (const hand of this.cachedHandLandmarks) {
      const evalResult = evaluateVSignLandmarks(hand);
      if (evalResult.angleDeg > bestAngle) {
        bestAngle = evalResult.angleDeg;
      }
      if (evalResult.isVSign) {
        detectedVSign = true;
        bestAngle = evalResult.angleDeg;
        break;
      }
    }

    this.cachedIsVSign = detectedVSign;
    this.cachedVAngleDeg = bestAngle;

    const cooldownElapsed = nowMs - this.lastTriggerMs;
    const cooldownRemainingMs = Math.max(0, V_SIGN_COOLDOWN_MS - cooldownElapsed);
    let holdProgress = 0;

    if (detectedVSign) {
      this.lastSeenVSignMs = nowMs;
    } else if (nowMs - this.lastSeenVSignMs > 100) {
      this.isLatched = false;
    }

    const effectivelyHolding =
      detectedVSign ||
      (this.holdStartMs !== null && nowMs - this.lastSeenVSignMs <= V_SIGN_GAP_TOLERANCE_MS);

    if (cooldownRemainingMs > 0 || this.isLatched) {
      this.holdStartMs = null;
      holdProgress = 0;
    } else if (effectivelyHolding) {
      if (this.holdStartMs === null) {
        this.holdStartMs = nowMs;
      }
      const heldMs = nowMs - this.holdStartMs;
      holdProgress = Math.min(1, heldMs / V_SIGN_HOLD_MS);

      if (heldMs >= V_SIGN_HOLD_MS) {
        this.lastTriggerMs = nowMs;
        this.holdStartMs = null;
        this.isLatched = true;
        holdProgress = 1;
        this.onVSignTrigger?.();
      }
    } else {
      this.holdStartMs = null;
      holdProgress = 0;
    }

    return {
      isVSignDetected: this.cachedIsVSign,
      vSignHoldProgress: holdProgress,
      vSignCooldownMs: Math.round(cooldownRemainingMs),
      vSignAngleDeg: this.cachedVAngleDeg,
      handLandmarks: this.cachedHandLandmarks,
      faceLandmarks: this.cachedFaceLandmarks,
      categoryMask: this.cachedMask,
      maskWidth: this.cachedMaskWidth,
      maskHeight: this.cachedMaskHeight,
      headPose: this.cachedHeadPose,
      modelsLoaded: { ...this.modelsLoaded },
    };
  }

  public dispose(): void {
    this.handLandmarker?.close();
    this.faceLandmarker?.close();
    this.imageSegmenter?.close();
    this.handLandmarker = null;
    this.faceLandmarker = null;
    this.imageSegmenter = null;
  }
}
