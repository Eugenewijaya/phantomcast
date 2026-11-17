import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Register app:// as a standard, secure, fetch-enabled scheme BEFORE app.whenReady()
// so MediaPipe WASM (<script crossOrigin>) and .task/.tflite fetch() never fail on file://
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Disable occlusion throttling so Virtual Camera stream stays alive when window is minimized
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let mainWindow: BrowserWindow | null = null;
let sidecarProcess: ChildProcess | null = null;
let sidecarReady = false;
const sidecarPort = 8765;
let isQuitting = false;

const VALID_TRIGGER_SOURCES = new Set(['GESTURE_V_SIGN', 'AUDIO_SNAP', 'MANUAL']);
const VALID_ACTIVE_MODES = new Set(['RAW_CAM', 'AR_FILTER', 'VTUBER_3D']);
const VALID_FILTER_IDS = new Set([
  'none',
  'neon_visor_01',
  'privacy_pixelate',
  'lut_warm',
  'lut_monochrome',
  'lut_anime',
]);
const VALID_VOICE_PRESETS = new Set([
  'NORMAL',
  'VTUBER_GIRL',
  'CHILD',
  'DEEP_ANON',
  'CUSTOM',
]);

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function isTrustedSender(url: string): boolean {
  return (
    url.startsWith('app://phantomcast') ||
    url.startsWith('http://localhost:5173') ||
    url.startsWith('http://127.0.0.1:5173')
  );
}

function resolveSidecarCommand(): { command: string; args: string[] } | null {
  const portArgs = ['--host', '127.0.0.1', '--port', String(sidecarPort)];

  const packagedExe = path.join(process.resourcesPath, 'backend', 'dist', 'virtual_bridge.exe');
  if (app.isPackaged && fs.existsSync(packagedExe)) {
    return { command: packagedExe, args: portArgs };
  }

  const packagedFlatExe = path.join(process.resourcesPath, 'backend', 'virtual_bridge.exe');
  if (app.isPackaged && fs.existsSync(packagedFlatExe)) {
    return { command: packagedFlatExe, args: portArgs };
  }

  const localExe = path.join(__dirname, '..', 'backend', 'dist', 'virtual_bridge.exe');
  if (fs.existsSync(localExe)) {
    return { command: localExe, args: portArgs };
  }

  const venvPython = path.join(__dirname, '..', 'backend', 'venv', 'Scripts', 'python.exe');
  const devScript = path.join(__dirname, '..', 'backend', 'virtual_bridge.py');
  if (fs.existsSync(venvPython) && fs.existsSync(devScript)) {
    return { command: venvPython, args: [devScript, ...portArgs] };
  }

  const packagedScript = path.join(process.resourcesPath, 'backend', 'virtual_bridge.py');
  if (app.isPackaged && fs.existsSync(packagedScript)) {
    return { command: 'python', args: [packagedScript, ...portArgs] };
  }

  if (fs.existsSync(devScript)) {
    return { command: 'python', args: [devScript, ...portArgs] };
  }

  return null;
}

function startPythonSidecar(): void {
  if (sidecarProcess || isQuitting) return;

  const resolved = resolveSidecarCommand();
  if (!resolved) {
    console.warn('[main] Berkas sidecar virtual_bridge tidak ditemukan.');
    return;
  }

  try {
    const child = spawn(resolved.command, resolved.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    sidecarProcess = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (text.includes('PHANTOM_BRIDGE_LISTENING')) {
        sidecarReady = true;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text && process.env.DEBUG_SIDECAR) {
        console.warn('[sidecar]', text);
      }
    });

    child.on('exit', () => {
      sidecarProcess = null;
      sidecarReady = false;
    });

    child.on('error', (err) => {
      console.warn('[main] Gagal menjalankan proses sidecar Python:', err.message);
      sidecarProcess = null;
      sidecarReady = false;
    });
  } catch (err) {
    console.warn('[main] Eksepsi saat spawn sidecar:', err);
  }
}

function stopPythonSidecar(): void {
  if (!sidecarProcess) return;
  const pid = sidecarProcess.pid;
  try {
    sidecarProcess.kill();
  } catch {
    // Ignore kill error
  }
  if (process.platform === 'win32' && pid) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // Process already exited
    }
  }
  sidecarProcess = null;
  sidecarReady = false;
}

function registerAppProtocol(): void {
  const distRoot = path.resolve(__dirname, '../dist');
  const resourcesRoot = process.resourcesPath ? path.resolve(process.resourcesPath) : distRoot;

  protocol.handle('app', (request) => {
    const reqUrl = new URL(request.url);
    let relPath = decodeURIComponent(reqUrl.pathname || '/');
    if (relPath === '/' || relPath === '') {
      relPath = '/index.html';
    }
    const targetPath = path.normalize(path.join(distRoot, relPath));
    // Prevent path traversal outside distRoot using trailing path.sep check
    if (targetPath !== distRoot && !targetPath.startsWith(distRoot + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (fs.existsSync(targetPath)) {
      return net.fetch(pathToFileURL(targetPath).toString());
    }
    // Fallback to extraResources (resources/models or resources/wasm) in packaged mode
    const resTargetPath = path.normalize(path.join(resourcesRoot, relPath));
    if (
      (resTargetPath === resourcesRoot || resTargetPath.startsWith(resourcesRoot + path.sep)) &&
      fs.existsSync(resTargetPath)
    ) {
      return net.fetch(pathToFileURL(resTargetPath).toString());
    }
    return new Response('Not Found', { status: 404 });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 375,
    minHeight: 640,
    backgroundColor: '#090C10',
    title: 'PhantomCast Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Block external popups and untrusted navigation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedSender(targetUrl)) {
      event.preventDefault();
    }
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const senderUrl = webContents.getURL() || '';
    const allowed = ['media', 'audioCapture', 'videoCapture', 'speaker-selection'];
    callback(isTrustedSender(senderUrl) && allowed.includes(permission));
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged && process.env.NODE_ENV !== 'production') {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadURL('app://phantomcast/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Contract Handlers with Strict Trust Boundary Validation
ipcMain.on('SET_PIPELINE_STATE', (event, rawPayload: unknown) => {
  const senderUrl = event.senderFrame?.url || '';
  if (!isTrustedSender(senderUrl) || !rawPayload || typeof rawPayload !== 'object') {
    return;
  }
  const p = rawPayload as Record<string, unknown>;
  if (
    typeof p.vanish_mode !== 'boolean' ||
    typeof p.trigger_source !== 'string' ||
    !VALID_TRIGGER_SOURCES.has(p.trigger_source) ||
    typeof p.active_mode !== 'string' ||
    !VALID_ACTIVE_MODES.has(p.active_mode) ||
    typeof p.selected_filter_id !== 'string' ||
    !VALID_FILTER_IDS.has(p.selected_filter_id)
  ) {
    return;
  }
  if (process.env.DEBUG_IPC) {
    console.log('[IPC] SET_PIPELINE_STATE validated:', p.active_mode, p.vanish_mode);
  }
});

ipcMain.on('SET_VOICE_DSP', (event, rawPayload: unknown) => {
  const senderUrl = event.senderFrame?.url || '';
  if (!isTrustedSender(senderUrl) || !rawPayload || typeof rawPayload !== 'object') {
    return;
  }
  const p = rawPayload as Record<string, unknown>;
  if (
    typeof p.enabled !== 'boolean' ||
    typeof p.preset !== 'string' ||
    !VALID_VOICE_PRESETS.has(p.preset) ||
    typeof p.pitch_semitones !== 'number' ||
    !Number.isFinite(p.pitch_semitones) ||
    typeof p.formant_shift !== 'number' ||
    !Number.isFinite(p.formant_shift) ||
    typeof p.noise_gate_db !== 'number' ||
    !Number.isFinite(p.noise_gate_db)
  ) {
    return;
  }
  const clampedPitch = Math.max(-12, Math.min(12, p.pitch_semitones));
  const clampedFormant = Math.max(0.5, Math.min(2.0, p.formant_shift));
  const clampedGate = Math.max(-80, Math.min(0, p.noise_gate_db));
  if (process.env.DEBUG_IPC) {
    console.log('[IPC] SET_VOICE_DSP validated:', p.preset, clampedPitch, clampedFormant, clampedGate);
  }
});

ipcMain.handle('GET_SIDECAR_STATUS', async (event) => {
  const senderUrl = event.senderFrame?.url || '';
  if (!isTrustedSender(senderUrl)) {
    return { running: false, pid: null, wsUrl: '' };
  }
  return {
    running: Boolean(sidecarProcess && (sidecarReady || sidecarProcess.pid)),
    pid: sidecarProcess?.pid ?? null,
    wsUrl: `ws://127.0.0.1:${sidecarPort}`,
  };
});

ipcMain.handle('RESTART_SIDECAR', async (event) => {
  const senderUrl = event.senderFrame?.url || '';
  if (!isTrustedSender(senderUrl)) {
    return { running: false, pid: null };
  }
  stopPythonSidecar();
  startPythonSidecar();
  return {
    running: Boolean(sidecarProcess),
    pid: sidecarProcess?.pid ?? null,
  };
});

app.whenReady().then(() => {
  registerAppProtocol();
  startPythonSidecar();
  createWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopPythonSidecar();
});

app.on('will-quit', () => {
  stopPythonSidecar();
});

app.on('window-all-closed', () => {
  stopPythonSidecar();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
