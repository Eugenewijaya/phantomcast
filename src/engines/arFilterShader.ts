import * as THREE from 'three';
import type { ArFilterId, NormalizedLandmarkPoint } from '../types/phantomcast';

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;

const LUT_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const LUT_FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D uTexture;
  uniform int uLutMode; // 1 = Warm Cinema, 2 = Noir Monochrome, 3 = Anime Cel Shader
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uTexture, vUv);
    vec3 col = tex.rgb;

    if (uLutMode == 1) {
      // Warm Cinema LUT: S-curve contrast + golden highlights + teal shadows
      col = smoothstep(0.02, 0.98, col);
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = vec3(0.04, 0.09, 0.14);
      vec3 highlightTint = vec3(1.06, 0.96, 0.84);
      col = mix(col + shadowTint * (1.0 - luma), col * highlightTint, luma);
    } else if (uLutMode == 2) {
      // High-contrast Silver Halide Monochrome LUT
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      luma = clamp((luma - 0.5) * 1.28 + 0.5, 0.0, 1.0);
      col = vec3(luma * 0.96, luma * 0.98, luma * 1.02);
    } else if (uLutMode == 3) {
      // Anime Cel-Shading LUT: quantized luminance bands + vivid saturation + Sobel edge ink
      vec2 texel = 1.0 / uResolution;
      vec3 cLeft = texture2D(uTexture, vUv - vec2(texel.x, 0.0)).rgb;
      vec3 cRight = texture2D(uTexture, vUv + vec2(texel.x, 0.0)).rgb;
      vec3 cUp = texture2D(uTexture, vUv - vec2(0.0, texel.y)).rgb;
      vec3 cDown = texture2D(uTexture, vUv + vec2(0.0, texel.y)).rgb;
      float edge = length(cRight - cLeft) + length(cDown - cUp);

      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float levels = 5.0;
      float celLuma = floor(luma * levels + 0.5) / levels;
      vec3 chroma = col / max(luma, 0.001);
      col = clamp(chroma * celLuma * 1.12, 0.0, 1.0);
      if (edge > 0.28) {
        col *= 0.25;
      }
    }

    // Subtle broadcast vignette
    vec2 centered = vUv - 0.5;
    float vig = 1.0 - dot(centered, centered) * 0.35;
    gl_FragColor = vec4(col * vig, tex.a);
  }
`;

export class ArFilterProcessor {
  private lutRenderer: THREE.WebGLRenderer | null = null;
  private lutScene: THREE.Scene | null = null;
  private lutCamera: THREE.OrthographicCamera | null = null;
  private lutMaterial: THREE.ShaderMaterial | null = null;
  private lutTexture: THREE.CanvasTexture | null = null;
  private pixelCanvas: HTMLCanvasElement;

  constructor() {
    this.pixelCanvas = document.createElement('canvas');
    this.pixelCanvas.width = 80;
    this.pixelCanvas.height = 45;
  }

  private ensureLutPipeline(sourceCanvas: HTMLCanvasElement): boolean {
    if (this.lutRenderer && this.lutMaterial && this.lutTexture) {
      return true;
    }

    try {
      const glCanvas = document.createElement('canvas');
      glCanvas.width = STAGE_WIDTH;
      glCanvas.height = STAGE_HEIGHT;
      this.lutRenderer = new THREE.WebGLRenderer({
        canvas: glCanvas,
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      this.lutRenderer.setSize(STAGE_WIDTH, STAGE_HEIGHT, false);

      this.lutScene = new THREE.Scene();
      this.lutCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      this.lutTexture = new THREE.CanvasTexture(sourceCanvas);
      this.lutTexture.minFilter = THREE.LinearFilter;
      this.lutTexture.magFilter = THREE.LinearFilter;

      this.lutMaterial = new THREE.ShaderMaterial({
        vertexShader: LUT_VERTEX_SHADER,
        fragmentShader: LUT_FRAGMENT_SHADER,
        uniforms: {
          uTexture: { value: this.lutTexture },
          uLutMode: { value: 1 },
          uResolution: { value: new THREE.Vector2(STAGE_WIDTH, STAGE_HEIGHT) },
        },
      });

      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMaterial);
      this.lutScene.add(quad);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Applies the active AR Filter onto targetCtx (1280x720)
   */
  public applyFilter(
    targetCtx: CanvasRenderingContext2D,
    targetCanvas: HTMLCanvasElement,
    filterId: ArFilterId,
    faceLandmarks: NormalizedLandmarkPoint[] | undefined,
    headPose: { roll: number; pitch: number; yaw: number },
    nowMs: number
  ): void {
    if (filterId === 'none') return;

    if (
      filterId === 'lut_warm' ||
      filterId === 'lut_monochrome' ||
      filterId === 'lut_anime'
    ) {
      const modeInt =
        filterId === 'lut_warm' ? 1 : filterId === 'lut_monochrome' ? 2 : 3;

      if (
        this.ensureLutPipeline(targetCanvas) &&
        this.lutRenderer &&
        this.lutScene &&
        this.lutCamera &&
        this.lutMaterial &&
        this.lutTexture
      ) {
        this.lutTexture.image = targetCanvas;
        this.lutTexture.needsUpdate = true;
        this.lutMaterial.uniforms.uLutMode.value = modeInt;
        this.lutRenderer.render(this.lutScene, this.lutCamera);
        targetCtx.drawImage(this.lutRenderer.domElement, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      }
      return;
    }

    if (filterId === 'privacy_pixelate') {
      this.renderPrivacyPixelate(targetCtx, targetCanvas, faceLandmarks, nowMs);
      return;
    }

    if (filterId === 'neon_visor_01') {
      this.renderCyberVisor3D(targetCtx, faceLandmarks, headPose, nowMs);
    }
  }

  private renderPrivacyPixelate(
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement,
    faceLandmarks: NormalizedLandmarkPoint[] | undefined,
    nowMs: number
  ): void {
    let minX = STAGE_WIDTH * 0.36;
    let maxX = STAGE_WIDTH * 0.64;
    let minY = STAGE_HEIGHT * 0.24;
    let maxY = STAGE_HEIGHT * 0.72;

    if (faceLandmarks && faceLandmarks.length >= 468) {
      minX = STAGE_WIDTH;
      maxX = 0;
      minY = STAGE_HEIGHT;
      maxY = 0;
      for (const pt of faceLandmarks) {
        const px = pt.x * STAGE_WIDTH;
        const py = pt.y * STAGE_HEIGHT;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      const padX = (maxX - minX) * 0.14;
      const padY = (maxY - minY) * 0.16;
      minX = Math.max(0, minX - padX);
      maxX = Math.min(STAGE_WIDTH, maxX + padX);
      minY = Math.max(0, minY - padY);
      maxY = Math.min(STAGE_HEIGHT, maxY + padY);
    } else {
      const bobY = Math.sin(nowMs * 0.003) * 6;
      minY += bobY;
      maxY += bobY;
    }

    const boxW = Math.max(32, maxX - minX);
    const boxH = Math.max(32, maxY - minY);

    // Downsample to mosaic grid and draw back with nearest-neighbor (imageSmoothingEnabled = false)
    const mosaicW = 14;
    const mosaicH = 14;
    this.pixelCanvas.width = mosaicW;
    this.pixelCanvas.height = mosaicH;
    const pCtx = this.pixelCanvas.getContext('2d');
    if (!pCtx) return;

    pCtx.drawImage(sourceCanvas, minX, minY, boxW, boxH, 0, 0, mosaicW, mosaicH);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(minX, minY, boxW, boxH, 16);
    ctx.clip();

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pixelCanvas, 0, 0, mosaicW, mosaicH, minX, minY, boxW, boxH);

    // Subtle HUD privacy frame
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(minX, minY, boxW, boxH);
    ctx.restore();
  }

  /**
   * Renders a 3D perspective-projected Cyber Visor anchored to MediaPipe FaceMesh landmarks
   * (#33 left eye outer, #263 right eye outer, #168 nose bridge) following head roll, pitch, yaw.
   */
  private renderCyberVisor3D(
    ctx: CanvasRenderingContext2D,
    faceLandmarks: NormalizedLandmarkPoint[] | undefined,
    headPose: { roll: number; pitch: number; yaw: number },
    nowMs: number
  ): void {
    let centerX = STAGE_WIDTH * 0.5;
    let centerY = STAGE_HEIGHT * 0.45 + Math.sin(nowMs * 0.003) * 6;
    let visorWidth = 210;
    let roll = headPose.roll;
    let yaw = headPose.yaw;
    let pitch = headPose.pitch;

    if (faceLandmarks && faceLandmarks.length >= 468) {
      const leftEye = faceLandmarks[33];
      const rightEye = faceLandmarks[263];
      const bridge = faceLandmarks[168];

      const lx = leftEye.x * STAGE_WIDTH;
      const ly = leftEye.y * STAGE_HEIGHT;
      const rx = rightEye.x * STAGE_WIDTH;
      const ry = rightEye.y * STAGE_HEIGHT;

      centerX = bridge.x * STAGE_WIDTH;
      centerY = bridge.y * STAGE_HEIGHT;
      const eyeSpan = Math.hypot(rx - lx, ry - ly);
      visorWidth = Math.max(120, eyeSpan * 2.15);
      roll = Math.atan2(ry - ly, rx - lx);
    }

    const visorHeight = visorWidth * 0.34;
    const yawSkew = yaw * 28;
    const pitchOffset = pitch * 18;

    ctx.save();
    ctx.translate(centerX + yawSkew, centerY + pitchOffset);
    ctx.rotate(roll);

    // Outer neon cyan holographic glow
    ctx.shadowColor = '#00E5FF';
    ctx.shadowBlur = 22;

    const w2 = visorWidth * 0.5;
    const h2 = visorHeight * 0.5;

    // 3D curved shield polygon
    ctx.beginPath();
    ctx.moveTo(-w2, -h2 * 0.65);
    ctx.quadraticCurveTo(0, -h2 * 1.15, w2, -h2 * 0.65);
    ctx.lineTo(w2 * 0.92, h2 * 0.75);
    ctx.quadraticCurveTo(centerX * 0.001, h2 * 0.3, 0, h2 * 0.95);
    ctx.quadraticCurveTo(-centerX * 0.001, h2 * 0.3, -w2 * 0.92, h2 * 0.75);
    ctx.closePath();

    const visorGrad = ctx.createLinearGradient(-w2, -h2, w2, h2);
    visorGrad.addColorStop(0, 'rgba(0, 229, 255, 0.78)');
    visorGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0.55)');
    visorGrad.addColorStop(1, 'rgba(0, 229, 255, 0.82)');
    ctx.fillStyle = visorGrad;
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#E0F2FE';
    ctx.stroke();

    // Holographic scanline & reticle inside the 3D visor
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w2 * 0.75, 0);
    ctx.lineTo(w2 * 0.75, 0);
    ctx.stroke();

    // Specular highlight flare
    const scanX = ((nowMs * 0.18) % (visorWidth * 1.4)) - visorWidth * 0.7;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.ellipse(scanX * 0.4, -h2 * 0.2, visorWidth * 0.12, h2 * 0.45, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  public dispose(): void {
    this.lutTexture?.dispose();
    this.lutMaterial?.dispose();
    this.lutRenderer?.dispose();
    this.lutRenderer = null;
  }
}
