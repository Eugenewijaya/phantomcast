import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { Face } from 'kalidokit';
import type { NormalizedLandmarkPoint } from '../types/phantomcast';

export type LoadedAvatarType = 'procedural_3d' | 'vrm_3d' | 'png_2d';

export interface VtuberModelInfo {
  type: LoadedAvatarType;
  name: string;
  url: string;
}

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export class VtuberEngine {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock: THREE.Clock;

  private currentVrm: VRM | null = null;
  private proceduralGroup: THREE.Group | null = null;
  private proceduralHead: THREE.Group | null = null;
  private proceduralLeftEye: THREE.Mesh | null = null;
  private proceduralRightEye: THREE.Mesh | null = null;
  private proceduralMouth: THREE.Mesh | null = null;
  private cyberVisorGroup: THREE.Group | null = null;

  private pngImage: HTMLImageElement | null = null;
  private avatarType: LoadedAvatarType = 'procedural_3d';
  private modelName = 'HoloUnit-01 (Built-in 3D)';
  private currentObjectUrl: string | null = null;

  // Smoothed kinematics state
  private smoothHead = { x: 0, y: 0, z: 0 };
  private smoothEye = { l: 1, r: 1 };
  private smoothVowels = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, STAGE_WIDTH / STAGE_HEIGHT, 0.1, 25);
    this.camera.position.set(0, 1.32, 1.85);
    this.camera.lookAt(0, 1.28, 0);
    this.clock = new THREE.Clock();

    this.setupLighting();
    this.buildProceduralAvatar();
    this.buildCyberVisor3D();
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = STAGE_WIDTH;
      canvas.height = STAGE_HEIGHT;
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      this.renderer.setSize(STAGE_WIDTH, STAGE_HEIGHT, false);
      this.renderer.setPixelRatio(1);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      return this.renderer;
    } catch {
      return null;
    }
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 1.35);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.9);
    keyLight.position.set(1.2, 2.2, 2.0);
    this.scene.add(keyLight);

    const rimCyan = new THREE.DirectionalLight(0x00e5ff, 1.1);
    rimCyan.position.set(-1.8, 1.6, -1.2);
    this.scene.add(rimCyan);

    const fillEmerald = new THREE.DirectionalLight(0x10b981, 0.55);
    fillEmerald.position.set(1.5, 0.5, -1.0);
    this.scene.add(fillEmerald);
  }

  /**
   * Builds a default 3D articulated VTuber unit so VTUBER_3D works immediately before a user drops a .vrm file
   */
  private buildProceduralAvatar(): void {
    const root = new THREE.Group();
    root.position.set(0, 0.92, 0);

    // Torso / Shoulders
    const torsoGeo = new THREE.CylinderGeometry(0.16, 0.24, 0.42, 24);
    const torsoMat = new THREE.MeshStandardMaterial({
      color: 0x161d2a,
      roughness: 0.35,
      metalness: 0.65,
    });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.set(0, 0.12, 0);
    root.add(torso);

    // Glowing chest core
    const coreGeo = new THREE.OctahedronGeometry(0.045, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 0.18, 0.17);
    root.add(core);

    // Head Group
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.42, 0);

    const headGeo = new THREE.SphereGeometry(0.145, 32, 32);
    headGeo.scale(0.92, 1.05, 0.95);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.25,
      metalness: 0.5,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headGroup.add(headMesh);

    // Visor faceplate
    const visorGeo = new THREE.BoxGeometry(0.21, 0.08, 0.08);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x090c10,
      roughness: 0.1,
      metalness: 0.9,
    });
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 0.015, 0.11);
    headGroup.add(visorMesh);

    // Left & Right Glowing Eyes
    const eyeGeo = new THREE.PlaneGeometry(0.052, 0.024);
    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
    });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.048, 0.016, 0.152);
    headGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.048, 0.016, 0.152);
    headGroup.add(rightEye);

    // Reactive Mouth Bar
    const mouthGeo = new THREE.PlaneGeometry(0.06, 0.014);
    const mouthMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
    });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.055, 0.142);
    headGroup.add(mouth);

    // Side audio headphones / antennae
    const earGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16);
    earGeo.rotateZ(Math.PI * 0.5);
    const earMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.8,
    });
    const leftEar = new THREE.Mesh(earGeo, earMat);
    leftEar.position.set(-0.145, 0.01, 0);
    headGroup.add(leftEar);

    const rightEar = new THREE.Mesh(earGeo, earMat);
    rightEar.position.set(0.145, 0.01, 0);
    headGroup.add(rightEar);

    root.add(headGroup);
    this.scene.add(root);

    this.proceduralGroup = root;
    this.proceduralHead = headGroup;
    this.proceduralLeftEye = leftEye;
    this.proceduralRightEye = rightEye;
    this.proceduralMouth = mouth;
  }

  /**
   * Builds a 3D Cyber Visor mesh for AR Filter mode
   */
  private buildCyberVisor3D(): void {
    const group = new THREE.Group();
    group.visible = false;

    const frameGeo = new THREE.TorusGeometry(0.18, 0.012, 12, 48, Math.PI);
    frameGeo.rotateX(Math.PI * 0.5);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.65,
      metalness: 0.9,
      roughness: 0.15,
    });
    const topBar = new THREE.Mesh(frameGeo, frameMat);
    topBar.position.set(0, 0.03, 0);
    group.add(topBar);

    const lensGeo = new THREE.CylinderGeometry(0.175, 0.165, 0.075, 32, 1, true, -Math.PI * 0.42, Math.PI * 0.84);
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: 0x00e5ff,
      emissive: 0x006688,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.62,
      roughness: 0.08,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    group.add(lens);

    this.scene.add(group);
    this.cyberVisorGroup = group;
  }

  /**
   * Loads a local .vrm or .png file from drag-and-drop or file picker
   */
  public async loadLocalFile(file: File): Promise<VtuberModelInfo> {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    const objectUrl = URL.createObjectURL(file);
    this.currentObjectUrl = objectUrl;

    if (ext === 'png' || ext === 'webp' || ext === 'jpg' || ext === 'jpeg') {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Gagal memuat berkas gambar PNGTuber'));
        el.src = objectUrl;
      });

      this.pngImage = img;
      this.avatarType = 'png_2d';
      this.modelName = file.name;
      if (this.currentVrm) {
        this.scene.remove(this.currentVrm.scene);
        VRMUtils.deepDispose(this.currentVrm.scene);
        this.currentVrm = null;
      }
      if (this.proceduralGroup) {
        this.proceduralGroup.visible = false;
      }

      return {
        type: 'png_2d',
        name: file.name,
        url: file.name,
      };
    }

    if (ext === 'vrm' || ext === 'glb') {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      const gltf = await loader.loadAsync(objectUrl);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) {
        throw new Error('Berkas bukan model VRM yang valid');
      }

      if (this.currentVrm) {
        this.scene.remove(this.currentVrm.scene);
        VRMUtils.deepDispose(this.currentVrm.scene);
        this.currentVrm = null;
      }

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.combineMorphs(vrm);
      VRMUtils.rotateVRM0(vrm);

      vrm.scene.traverse((obj) => {
        obj.frustumCulled = false;
      });

      // Relax upper arms from default T-pose into natural broadcast posture
      const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
      const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
      if (leftUpperArm) leftUpperArm.rotation.z = 1.15;
      if (rightUpperArm) rightUpperArm.rotation.z = -1.15;

      this.scene.add(vrm.scene);
      this.currentVrm = vrm;
      this.pngImage = null;
      this.avatarType = 'vrm_3d';
      this.modelName = file.name;

      if (this.proceduralGroup) {
        this.proceduralGroup.visible = false;
      }

      return {
        type: 'vrm_3d',
        name: file.name,
        url: file.name,
      };
    }

    throw new Error(`Format berkas .${ext} tidak didukung. Gunakan .vrm atau .png`);
  }

  public resetToBuiltInAvatar(): VtuberModelInfo {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      VRMUtils.deepDispose(this.currentVrm.scene);
      this.currentVrm = null;
    }
    this.pngImage = null;
    this.avatarType = 'procedural_3d';
    this.modelName = 'HoloUnit-01 (Built-in 3D)';
    if (this.proceduralGroup) {
      this.proceduralGroup.visible = true;
    }
    return {
      type: 'procedural_3d',
      name: this.modelName,
      url: 'builtin://holounit-01',
    };
  }

  public getModelInfo(): VtuberModelInfo {
    return {
      type: this.avatarType,
      name: this.modelName,
      url: this.modelName,
    };
  }

  /**
   * Solves face kinematics via Kalidokit from 478 MediaPipe FaceLandmarker points + microphone RMS,
   * and renders the VTuber (3D VRM, Built-in 3D, or 2D PNGTuber) onto targetCtx.
   */
  public updateAndRenderVtuber(
    targetCtx: CanvasRenderingContext2D,
    faceLandmarks: NormalizedLandmarkPoint[] | undefined,
    voiceRms: number,
    nowMs: number
  ): void {
    const dt = Math.min(0.1, this.clock.getDelta());

    // Clone landmarks before passing to Kalidokit.Face.solve because Kalidokit mutates coordinates in place
    let riggedFace: ReturnType<typeof Face.solve> | undefined;
    if (faceLandmarks && faceLandmarks.length >= 468) {
      const clonedLandmarks = faceLandmarks.map((pt) => ({
        x: pt.x,
        y: pt.y,
        z: pt.z,
      }));
      riggedFace = Face.solve(clonedLandmarks, {
        runtime: 'mediapipe',
        imageSize: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
        smoothBlink: true,
        blinkSettings: [0.35, 0.5],
      });
    }

    if (riggedFace) {
      this.smoothHead.x = lerp(this.smoothHead.x, riggedFace.head.x, 0.35);
      this.smoothHead.y = lerp(this.smoothHead.y, riggedFace.head.y, 0.35);
      this.smoothHead.z = lerp(this.smoothHead.z, riggedFace.head.z, 0.35);

      this.smoothEye.l = lerp(this.smoothEye.l, riggedFace.eye.l, 0.45);
      this.smoothEye.r = lerp(this.smoothEye.r, riggedFace.eye.r, 0.45);

      const micBoost = Math.min(1, voiceRms * 1.45);
      const shape = riggedFace.mouth.shape;
      this.smoothVowels.aa = lerp(
        this.smoothVowels.aa,
        Math.min(1, Math.max(shape.A || 0, micBoost * 0.9)),
        0.45
      );
      this.smoothVowels.ih = lerp(
        this.smoothVowels.ih,
        Math.min(1, Math.max(shape.I || 0, micBoost * 0.35)),
        0.45
      );
      this.smoothVowels.ou = lerp(
        this.smoothVowels.ou,
        Math.min(1, Math.max(shape.U || 0, micBoost * 0.4)),
        0.45
      );
      this.smoothVowels.ee = lerp(
        this.smoothVowels.ee,
        Math.min(1, Math.max(shape.E || 0, micBoost * 0.3)),
        0.45
      );
      this.smoothVowels.oh = lerp(
        this.smoothVowels.oh,
        Math.min(1, Math.max(shape.O || 0, micBoost * 0.5)),
        0.45
      );
    } else {
      // Natural idle breathing + periodic blink + microphone lip-sync when no face is in frame
      const t = nowMs * 0.001;
      this.smoothHead.x = lerp(this.smoothHead.x, Math.sin(t * 1.3) * 0.06, 0.15);
      this.smoothHead.y = lerp(this.smoothHead.y, Math.cos(t * 0.9) * 0.1, 0.15);
      this.smoothHead.z = lerp(this.smoothHead.z, Math.sin(t * 0.7) * 0.04, 0.15);

      const isBlinking = (nowMs % 3800) < 140;
      const targetEye = isBlinking ? 0.05 : 1.0;
      this.smoothEye.l = lerp(this.smoothEye.l, targetEye, 0.4);
      this.smoothEye.r = lerp(this.smoothEye.r, targetEye, 0.4);

      const micOpen = Math.min(1, voiceRms * 1.5);
      this.smoothVowels.aa = lerp(this.smoothVowels.aa, micOpen, 0.45);
      this.smoothVowels.oh = lerp(this.smoothVowels.oh, micOpen * 0.5, 0.35);
      this.smoothVowels.ih = lerp(this.smoothVowels.ih, micOpen * 0.25, 0.35);
      this.smoothVowels.ou = lerp(this.smoothVowels.ou, 0, 0.35);
      this.smoothVowels.ee = lerp(this.smoothVowels.ee, 0, 0.35);
    }

    // 1. PNGTuber 2D Rendering Path
    if (this.avatarType === 'png_2d' && this.pngImage) {
      const img = this.pngImage;
      const bounceY = -Math.min(28, this.smoothVowels.aa * 24) + Math.sin(nowMs * 0.004) * 4;
      const scaleBoost = 1 + this.smoothVowels.aa * 0.04;

      const maxH = STAGE_HEIGHT * 0.82;
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      const drawH = maxH * scaleBoost;
      const drawW = drawH * aspect;

      targetCtx.save();
      targetCtx.translate(STAGE_WIDTH * 0.5, STAGE_HEIGHT * 0.56 + bounceY);
      targetCtx.rotate(this.smoothHead.z * 0.45);

      if (this.smoothVowels.aa > 0.12) {
        targetCtx.shadowColor = 'rgba(0, 229, 255, 0.65)';
        targetCtx.shadowBlur = 24 * this.smoothVowels.aa;
      }

      targetCtx.drawImage(img, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
      targetCtx.restore();
      return;
    }

    // 2. Three.js VRM / Procedural 3D Rendering Path
    if (this.cyberVisorGroup) {
      this.cyberVisorGroup.visible = false;
    }

    if (this.avatarType === 'vrm_3d' && this.currentVrm) {
      const vrm = this.currentVrm;
      const neck = vrm.humanoid?.getNormalizedBoneNode('neck');
      const head = vrm.humanoid?.getNormalizedBoneNode('head');
      const chest = vrm.humanoid?.getNormalizedBoneNode('spine');

      if (neck) {
        neck.rotation.x = this.smoothHead.x * 0.45;
        neck.rotation.y = this.smoothHead.y * 0.45;
        neck.rotation.z = this.smoothHead.z * 0.45;
      }
      if (head) {
        head.rotation.x = this.smoothHead.x * 0.55;
        head.rotation.y = this.smoothHead.y * 0.55;
        head.rotation.z = this.smoothHead.z * 0.55;
      }
      if (chest) {
        chest.rotation.x = this.smoothHead.x * 0.15;
        chest.rotation.y = this.smoothHead.y * 0.15;
        chest.rotation.z = this.smoothHead.z * 0.15;
      }

      const expr = vrm.expressionManager;
      if (expr) {
        expr.setValue('blinkLeft', Math.max(0, Math.min(1, 1 - this.smoothEye.l)));
        expr.setValue('blinkRight', Math.max(0, Math.min(1, 1 - this.smoothEye.r)));
        expr.setValue('aa', this.smoothVowels.aa);
        expr.setValue('ih', this.smoothVowels.ih);
        expr.setValue('ou', this.smoothVowels.ou);
        expr.setValue('ee', this.smoothVowels.ee);
        expr.setValue('oh', this.smoothVowels.oh);
      }

      vrm.update(dt);
    } else if (this.proceduralGroup && this.proceduralHead) {
      this.proceduralGroup.visible = true;
      this.proceduralHead.rotation.x = -this.smoothHead.x * 0.8;
      this.proceduralHead.rotation.y = this.smoothHead.y * 0.85;
      this.proceduralHead.rotation.z = -this.smoothHead.z * 0.8;

      if (this.proceduralLeftEye) {
        this.proceduralLeftEye.scale.y = Math.max(0.1, this.smoothEye.l);
      }
      if (this.proceduralRightEye) {
        this.proceduralRightEye.scale.y = Math.max(0.1, this.smoothEye.r);
      }
      if (this.proceduralMouth) {
        const mouthOpen = 1 + this.smoothVowels.aa * 4.2;
        this.proceduralMouth.scale.y = mouthOpen;
        this.proceduralMouth.scale.x = 1 + this.smoothVowels.ee * 0.4;
      }
    }

    const renderer = this.ensureRenderer();
    if (renderer) {
      renderer.render(this.scene, this.camera);
      targetCtx.drawImage(renderer.domElement, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    }
  }

  public dispose(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    if (this.currentVrm) {
      VRMUtils.deepDispose(this.currentVrm.scene);
      this.currentVrm = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
  }
}
