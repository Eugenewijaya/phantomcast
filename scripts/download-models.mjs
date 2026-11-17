import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const MODELS_DIR = path.join(ROOT_DIR, 'public', 'models');
const WASM_DIR = path.join(ROOT_DIR, 'public', 'wasm');
const NODE_WASM_DIR = path.join(ROOT_DIR, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');

const MODEL_ASSETS = [
  {
    name: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    name: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  {
    name: 'selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  },
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const tempPath = `${destPath}.tmp`;
    const file = fs.createWriteStream(tempPath);

    const request = https.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.rmSync(tempPath, { force: true });
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.rmSync(tempPath, { force: true });
        reject(new Error(`HTTP ${response.statusCode} when fetching ${url}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tempPath, destPath);
          resolve(true);
        });
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.rmSync(tempPath, { force: true });
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      file.close();
      fs.rmSync(tempPath, { force: true });
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

function syncWasmFromNodeModules() {
  ensureDir(WASM_DIR);
  ensureDir(MODELS_DIR);

  if (!fs.existsSync(NODE_WASM_DIR)) {
    console.warn('[models] node_modules/@mediapipe/tasks-vision/wasm belum ditemukan.');
    return false;
  }

  const files = fs.readdirSync(NODE_WASM_DIR);
  let copiedCount = 0;
  for (const file of files) {
    if (file.endsWith('.wasm') || file.endsWith('.js')) {
      const src = path.join(NODE_WASM_DIR, file);
      const destWasm = path.join(WASM_DIR, file);
      const destModels = path.join(MODELS_DIR, file);
      fs.copyFileSync(src, destWasm);
      fs.copyFileSync(src, destModels);
      copiedCount++;
    }
  }
  console.log(`[models] Menyalin ${copiedCount} berkas runtime WASM ke public/wasm/ dan public/models/`);
  return copiedCount > 0;
}

async function main() {
  ensureDir(MODELS_DIR);
  ensureDir(WASM_DIR);

  syncWasmFromNodeModules();

  const deferred = [];
  for (const asset of MODEL_ASSETS) {
    const targetPath = path.join(MODELS_DIR, asset.name);
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 1024) {
      const sizeKb = Math.round(fs.statSync(targetPath).size / 1024);
      console.log(`[models] Tersedia lokal: ${asset.name} (${sizeKb} KB)`);
      continue;
    }

    try {
      console.log(`[models] Mengunduh ${asset.name} dari penyimpanan resmi MediaPipe...`);
      await downloadFile(asset.url, targetPath);
      const sizeKb = Math.round(fs.statSync(targetPath).size / 1024);
      console.log(`[models] Selesai mengunduh ${asset.name} (${sizeKb} KB)`);
    } catch (err) {
      console.warn(`[models] Gagal mengunduh ${asset.name}: ${err.message}`);
      deferred.push({
        asset: asset.name,
        url: asset.url,
        target: `public/models/${asset.name}`,
        reason: err.message,
      });
    }
  }

  if (deferred.length > 0) {
    const agentsDir = path.join(ROOT_DIR, '.agents');
    ensureDir(agentsDir);
    const deferredPath = path.join(agentsDir, 'deferred-setup.json');
    fs.writeFileSync(
      deferredPath,
      JSON.stringify({ updatedAt: new Date().toISOString(), deferredAssets: deferred }, null, 2),
      'utf-8'
    );
  }
}

main().catch((err) => {
  console.error('[models] Error fatal:', err);
  process.exitCode = 1;
});
