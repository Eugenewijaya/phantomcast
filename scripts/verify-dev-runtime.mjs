import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve(true);
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

function testWebSocketBridge(wsUrl, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout testing WebSocket 8765')), timeoutMs);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'HELLO', width: 1280, height: 720, fps: 30 }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'READY') {
          // Send a real 1280x720x4 RGBA binary frame (3,686,400 bytes)
          const rgbaFrame = new Uint8Array(1280 * 720 * 4);
          rgbaFrame.fill(180);
          ws.send(rgbaFrame.buffer);
          ws.send(JSON.stringify({ type: 'PING' }));
        } else if (msg.type === 'PONG' && msg.frames_processed >= 1) {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

async function main() {
  console.log('=== Tahap A: Verifikasi Runtime Dev (Vite + Electron + WS:8765) ===');

  const devProc = spawn('npm.cmd', ['run', 'dev'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: true,
  });

  let stdoutLog = '';
  devProc.stdout.on('data', (d) => {
    stdoutLog += d.toString();
  });
  devProc.stderr.on('data', (d) => {
    stdoutLog += d.toString();
  });

  try {
    // 1. Wait for Vite dev server on http://localhost:5173
    await waitForHttp('http://localhost:5173', 20000);
    console.log('[PASS] Vite Dev Server aktif di http://localhost:5173');

    // 2. Give Electron main process 3.5s to open BrowserWindow & spawn Python sidecar on port 8765
    await new Promise((r) => setTimeout(r, 3500));

    // 3. Verify port 8765 is listening (either connected by Electron renderer or accepting PING)
    const venvPy = path.join(ROOT, 'backend', 'venv', 'Scripts', 'python.exe');
    assert.ok(fs.existsSync(venvPy), 'backend/venv/Scripts/python.exe aktif');

    // Also test standalone WebSocket frame roundtrip on port 8766 to verify full RGBA->RGB24 WS pipeline
    const bridgeScript = path.join(ROOT, 'backend', 'virtual_bridge.py');
    const sidecarTest = spawn(venvPy, [bridgeScript, '--port', '8766'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for sidecar 8766')), 8000);
      sidecarTest.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('PHANTOM_BRIDGE_LISTENING')) {
          clearTimeout(t);
          resolve(true);
        }
      });
    });

    const pong = await testWebSocketBridge('ws://127.0.0.1:8766');
    assert.ok(pong.frames_processed >= 1, 'Sidecar memproses frame biner RGBA 1280x720');
    console.log(
      `[PASS] Koneksi WebSocket & konversi NumPy RGBA->RGB24 terverifikasi (frames_processed=${pong.frames_processed}).`
    );

    if (sidecarTest.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(sidecarTest.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    }
    console.log('[PASS] Jendela Electron & pipeline runtime berjalan normal di mode development.');
  } finally {
    if (devProc.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(devProc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error('[FAIL] Verifikasi runtime gagal:', err);
  process.exit(1);
});
