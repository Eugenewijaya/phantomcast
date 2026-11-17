# PhantomCast Studio — Backend / IPC / WebSocket Protocol Spec

Author: backend-eng · Source: `PRD_PhantomCast_Studio.md` §2, §4, §5 · Status: **normative draft v1** (spec only; no changes made to `src/`, `electron/`, `backend/`).

## 0. Topology

```
Renderer (React/WebGL) ──contextBridge──> preload.ts ──ipcRenderer.send/invoke──> main.ts (ipcMain)
        │                                                                              │ spawn/kill, stdio
        │  binary WS frames (RGBA)                                                     ▼
        └────────────── ws://127.0.0.1:8765 ───────────────────────────────> virtual_bridge.py (sidecar)
                                                                       numpy[:,:,:3] -> pyvirtualcam -> OS virtual cam
```

- The renderer is the **only** producer of frames and connects **directly** to the sidecar (main does not proxy 3.7 MB frames; proxying would add a copy per frame).
- Main owns: sidecar lifecycle, IPC validation, canonical pipeline/voice state, settings persistence.
- Voice DSP runs in the renderer (AudioWorklet). The sidecar does **not** process audio in v1 (see §6, Open Item O1).

## 1. IPC contract (Electron)

### 1.1 Channels
| Channel | Direction | Kind | Payload |
|---|---|---|---|
| `SET_PIPELINE_STATE` | renderer → main | `ipcRenderer.send` (fire-and-forget) | `PipelineState` |
| `SET_VOICE_DSP` | renderer → main | `ipcRenderer.send` | `VoiceDsp` |
| `PIPELINE_STATE_CHANGED` *(added)* | main → renderer | `webContents.send` | `PipelineState` (canonical, post-validation) |
| `BRIDGE_STATUS` *(added)* | main → renderer | `webContents.send` | `{ state, port, device?, error?, fps? }` |
| `GET_BRIDGE_STATUS` *(added)* | renderer ↔ main | `invoke` | same as above |

PRD only defines the first two; the three additions are needed so the UI can show sidecar health (see §5). They are additive and optional.

### 1.2 Types (TypeScript, shared by preload + main)
```ts
type TriggerSource = "GESTURE_V_SIGN" | "AUDIO_SNAP" | "MANUAL";
type ActiveMode    = "RAW_CAM" | "AR_FILTER" | "VTUBER_3D";
type VoicePreset   = "VTUBER_GIRL" | "CHILD" | "DEEP_ANON" | "CUSTOM";

interface PipelineState {
  vanish_mode: boolean;
  trigger_source: TriggerSource;          // who caused this change (audit/HUD), not a filter
  active_mode: ActiveMode;
  selected_filter_id: string | null;      // required non-null iff active_mode === "AR_FILTER"
  vtuber_model_path: string | null;       // required non-null iff active_mode === "VTUBER_3D"
}
interface VoiceDsp {
  enabled: boolean;
  preset: VoicePreset;
  pitch_semitones: number;                // [-12, +12]
  formant_shift: number;                  // [0.50, 2.00], 1.00 = neutral
  noise_gate_db: number;                  // [-80, 0]
}
```

### 1.3 Validation rules (main process = trust boundary; run on every message)
Renderer content is untrusted-by-default (loads user VRM/PNG, drag-drop). Main must **validate then clamp/reject**, never forward raw.

`PipelineState`
1. Payload must be a plain object; unknown keys dropped; wrong types ⇒ **reject** (log, keep previous state, no throw).
2. Enums checked by `Set.has` (not `includes` on user string with coercion).
3. `selected_filter_id`: `^[a-z0-9_-]{1,64}$` or `null`; must be in the built-in filter registry (`privacy_pixelate`, `neon_visor`, `lut_warm`, `lut_mono`, `lut_anime` — architect/ui own final IDs). Unknown ⇒ coerce to `null` and, if `active_mode==="AR_FILTER"`, fall back to `RAW_CAM`.
4. `vtuber_model_path`: only when `active_mode==="VTUBER_3D"`. Must be a string ≤ 1024 chars, `path.isAbsolute`, `path.normalize` result equal to input (no `..`), extension (case-insens.) ∈ `{.vrm, .png}`, `fs.statSync().isFile()`, size ≤ 200 MB. Failing ⇒ reject and emit `PIPELINE_STATE_CHANGED` with the previous state. The path is **never** passed to the sidecar or to a shell.
   - Electron ≥32 removed `File.path`: preload must resolve dropped files with `webUtils.getPathForFile(file)`; the renderer then loads bytes via a `phantomcast-asset://` protocol or `fs` read in preload — **not** `file://` (CSP, see architect blueprint).
5. Cross-field: `vanish_mode` is allowed in every `active_mode`. `trigger_source:"MANUAL"` is the default for UI clicks.
6. **Rate limit**: coalesce to ≤ 30 msgs/s (last-write-wins). Vanish toggles are already throttled by the 2 s gesture cooldown, but a stuck renderer must not flood main.

`VoiceDsp`
1. Types as above; `pitch_semitones` clamp [-12,12]; `formant_shift` clamp [0.5,2.0]; `noise_gate_db` clamp [-80,0]; non-finite numbers (`NaN`, `±Infinity`) ⇒ reject message.
2. For non-`CUSTOM` presets main **overwrites** numeric fields with canonical values (authoritative table, matches PRD §3.4):

| preset | pitch_semitones | formant_shift | extra |
|---|---|---|---|
| `VTUBER_GIRL` | +5 | 1.15 | — |
| `CHILD` | +7 | 1.25 | HPF 160 Hz (renderer-side; not part of the payload) |
| `DEEP_ANON` | −5 | 0.88 | — |
| `CUSTOM` | as sent (clamped) | as sent (clamped) | — |
| (disabled) | `enabled:false` ⇒ bypass = 0 st / 1.00 | | |

   `noise_gate_db` is not preset-controlled (default −50).
3. Coalesce to ≤ 20 msgs/s (slider drag). Latest wins.

### 1.4 Preload surface (contextIsolation: true, nodeIntegration: false, sandbox: true)
Expose a **narrow, typed** API; never expose `ipcRenderer` itself:
```ts
contextBridge.exposeInMainWorld("phantom", {
  setPipelineState: (s: PipelineState) => ipcRenderer.send("SET_PIPELINE_STATE", s),
  setVoiceDsp:      (v: VoiceDsp)      => ipcRenderer.send("SET_VOICE_DSP", v),
  onPipelineState:  (cb) => { const h=(_e,s)=>cb(s); ipcRenderer.on("PIPELINE_STATE_CHANGED",h); return ()=>ipcRenderer.removeListener("PIPELINE_STATE_CHANGED",h); },
  onBridgeStatus:   (cb) => /* same pattern */,
  getBridgeStatus:  () => ipcRenderer.invoke("GET_BRIDGE_STATUS"),
  pathForFile:      (f: File) => webUtils.getPathForFile(f),
});
```
In `main.ts` handlers, also verify `event.senderFrame.url` origin is the app (`http://localhost:5173` in dev, `file://…/dist/index.html` in prod) before honoring any channel.

### 1.5 Forwarding to the sidecar
Main forwards a **minimal subset** as a WS **text** control message (§2.4) so the sidecar can pick placeholder content and report status: `{type:"PIPELINE_STATE", active_mode, vanish_mode}`. `vtuber_model_path`, `selected_filter_id`, and all voice params stay in main/renderer. If the sidecar is down the forward is dropped silently (state is still stored; re-sent on reconnect).

## 2. WebSocket binary protocol — `ws://127.0.0.1:8765`

### 2.1 Transport rules
- Server: `websockets` (Python) bound to **`127.0.0.1` only** (never `0.0.0.0`/`localhost` — `localhost` may resolve to `::1` on Windows and bind/connect mismatch: renderer must also use the literal `127.0.0.1`).
- Single active producer. A second connection ⇒ server rejects the **newer** one with close code `1008` (policy violation) reason `"producer-busy"` — prevents a stale/hijacking client from stealing the cam. Exception: if the existing socket has been silent > 3 s it is considered dead and replaced.
- Origin check: accept `Origin` ∈ {`app://phantomcast` (prod, per architect §3.2), `http://localhost:5173` (dev only, when `!app.isPackaged`), absent}. Any other web origin (a browser page doing `new WebSocket("ws://127.0.0.1:8765")`, i.e. DNS-rebinding / drive-by) ⇒ HTTP 403 before upgrade. Optionally add a per-launch random token: main generates 128-bit hex, passes it to sidecar via env `PHANTOM_WS_TOKEN`, renderer gets it through preload and sends it in the `HELLO` message (§2.4); wrong token ⇒ close `1008`. **Recommended** (cheap, closes the rogue-local-process hole).
- `websockets` params: `max_size = frame_bytes + 64`, `max_queue = 1`, `ping_interval = 5`, `ping_timeout = 10`, `compression = None` (permessage-deflate on 3.7 MB raw RGBA burns CPU and violates the <15 % budget), `close_timeout = 1`.
- Client: `ws.binaryType = "arraybuffer"`, `perMessageDeflate` is N/A in browsers (disabled by default for loopback; server sets `compression=None` so it is never negotiated).

### 2.2 `STREAM_VIDEO_FRAME` (binary message)
Each **binary** WS message is exactly one frame, **no header, no framing**:

| Property | Value |
|---|---|
| Pixel layout | RGBA, 8 bit/channel, row-major, top-left origin, tightly packed (stride = width×4) |
| Default size | 1280 × 720 → **3 686 400 bytes** (`1280*720*4`) |
| Alpha | Must be 255 everywhere (sender guarantees opaque canvas); server ignores/drops it |
| Color | sRGB, **non-premultiplied** |
| Endianness | n/a (byte-wise) |

Server pipeline (reference implementation contract):
```python
buf = np.frombuffer(msg, dtype=np.uint8)               # zero-copy view over bytes
frame = buf.reshape(H, W, 4)                            # (720,1280,4)
rgb = np.ascontiguousarray(frame[:, :, :3])             # REQUIRED copy: slice is non-contiguous
cam.send(rgb)                                           # pyvirtualcam.Camera(fmt=PixelFormat.RGB)
```
Notes:
- `frame[:, :, :3]` is a **strided view**; `pyvirtualcam.Camera.send` requires a C-contiguous `uint8` array of shape `(H,W,3)`. Without `np.ascontiguousarray` the send either raises or silently produces garbage. Preallocate `rgb_out = np.empty((H,W,3), np.uint8)` once and use `np.copyto(rgb_out, frame[:, :, :3])` to avoid a 2.7 MB allocation per frame.
- `np.frombuffer` over `bytes` is read-only — fine because we only read it.
- Don't `await`-block on `cam.send` + `sleep_until_next_frame` inside the receive handler; see §2.5.

### 2.3 Sender-side requirements (renderer)
- Source canvas must be **exactly** `width×height` of the negotiated config (render target, not CSS size; no DPR scaling: set `canvas.width/height` explicitly, ignore `devicePixelRatio`).
- Readback options, cheapest first:
  1. 2D canvas: `ctx.getImageData(0,0,W,H).data.buffer` (use `willReadFrequently:true` context so Chromium keeps it in CPU memory).
  2. WebGL: `gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf)` into a **preallocated** `Uint8Array`. **WebGL origin is bottom-left ⇒ rows are upside down**: flip either in the shader (render to FBO with flipped Y — preferred, free) or reject; the server does **not** flip. Create context with `alpha:false, premultipliedAlpha:false, preserveDrawingBuffer:false` and call `readPixels` in the same task as the draw.
- Send `ws.send(typedArray)` only when `ws.bufferedAmount <= frameBytes` (aligned with architect §4.3 rule 4); otherwise **drop the frame** (backpressure, §2.5). Never queue.
- Reuse two buffers (double-buffer); `ws.send(view)` copies synchronously in Chromium, so reuse after the call is safe.
- Rate: tied to the selected mode, 30 fps (power-save) or 60 fps (performance). Bandwidth: 30 fps ≈ 110 MB/s, 60 fps ≈ 221 MB/s on loopback — fine for the socket, but the readback + copy is the real CPU cost (architect must budget it; fallback is 30 fps or downscale, see §2.6).

### 2.4 Text (control) messages — JSON, UTF-8, ≤ 4 KB
Binary = video only; text = control. Added to remove the hard-coded 1280×720 assumption (PRD §1 also promises 720p/1080p) and to give health info.

Client → server:
```jsonc
{ "type":"HELLO", "protocol":1, "token":"<hex>", "width":1280, "height":720, "fps":30 }
{ "type":"PIPELINE_STATE", "active_mode":"RAW_CAM", "vanish_mode":false }   // from main only
{ "type":"BYE" }
```
Server → client:
```jsonc
{ "type":"READY",  "width":1280, "height":720, "fps":30, "device":"OBS Virtual Camera", "backend":"obs" }
{ "type":"STATS",  "fps_in":29.8, "fps_out":30.0, "dropped":3, "cam_state":"running" }   // every 1 s
{ "type":"ERROR",  "code":"E_...", "message":"...", "fatal":false }
```
Handshake: the sender **must not** stream binary until it receives `READY`. Allowed sizes: `{1280×720, 1920×1080}` × `{30, 60}`; anything else ⇒ `ERROR E_BAD_CONFIG fatal:true`, close `1007`. If no `HELLO` arrives within 2 s the server assumes the PRD default (1280×720@30) so a PRD-literal minimal client still works.

### 2.5 Server concurrency, backpressure, latency
- One asyncio task receives; it **keeps only the latest frame** (`latest = msg`, overwriting; count overwritten ones as `dropped`). A separate dedicated thread (pyvirtualcam is blocking) loops: `grab latest → convert → cam.send → cam.sleep_until_next_frame()`. This decouples network jitter from camera cadence and bounds latency to ≤ 1 frame (≤ 33 ms @30, ≤ 17 ms @60). Never an unbounded queue (3.7 MB × N = RAM leak against the 350 MB cap).
- If no new frame for 100 ms the camera thread re-sends the previous frame (cams must keep ticking or meeting apps mark the device frozen). If silent > 2 s (renderer stalled) it keeps repeating the last frame; after 10 s with no client it switches to a generated **"standby" slate** (solid dark + text) so Zoom/Teams never show a frozen last frame of the user; this is a privacy-relevant default.
- Fixed `cam` fps = negotiated fps. Input fps variance is absorbed by repeat/drop.

### 2.6 Error taxonomy & mitigations
| Code / symptom | Cause | Mitigation |
|---|---|---|
| Binary length ≠ `W*H*4` | wrong canvas size, DPR scaling, cropped readback, header added | server drops the frame, increments `bad_frames`, sends `ERROR E_BAD_FRAME_SIZE fatal:false` at most 1/s; after 30 consecutive ⇒ close `1007`. Renderer shows "Resolution mismatch" in HUD |
| Text frame received where binary expected / vice versa | client bug | text ⇒ JSON parse w/ try/except (ignore + warn); binary before `READY` ⇒ ignore |
| JSON invalid / unknown `type` | bug / probing | ignore, no crash, log at debug |
| Image upside down | WebGL readPixels origin | fixed on the sender (§2.3); **do not** flip in server |
| Green/purple, shifted rows | stride/pixel-format mismatch (BGR vs RGB, premultiplied) | contract fixes RGBA/non-premul; self-check test pattern (§7) |
| `pyvirtualcam` `RuntimeError: no virtual camera backend found` | OBS Virtual Camera (DirectShow driver) not installed — **this is the #1 first-run failure** | sidecar emits `ERROR E_NO_VCAM_BACKEND fatal:true`; UI shows a modal "Install the virtual camera driver" w/ button → installer step (bundle OBS-VirtualCam or run `regsvr32` of the driver in the NSIS installer, needs admin). Detect early at sidecar startup via a dry `Camera(...)` open in `READY` path |
| Virtual cam busy / in exclusive use by another app | another process holds the device | retry open 3× with 500 ms backoff, then `E_VCAM_BUSY` non-fatal, UI banner |
| `Camera` crashes mid-stream (device removed, driver reload) | OS | catch in camera thread, close, reopen with exponential backoff 0.5→4 s (max 5 tries) then `E_VCAM_LOST fatal:true`. Sidecar must not exit silently |
| Port 8765 in use (stale sidecar, other app) | crash leftover | sidecar exits code **`78`** (`EX_CONFIG`) with message `E_PORT_IN_USE`; main handles per §3.4 (try 8766–8775, pass `--port`, tell renderer via `BRIDGE_STATUS.port`). Renderer **must read the port from `BRIDGE_STATUS`**, not hard-code 8765 (8765 stays the default) |
| `bufferedAmount` grows | consumer slower than producer | sender drops frames (§2.3); HUD "Bridge slow" if > 20 % dropped over 3 s; offer fallback 60→30 fps |
| WS closes unexpectedly | sidecar died / ping timeout | renderer auto-reconnect: backoff 250 ms ×2 → 5 s, jitter ±20 %, re-sends `HELLO`; frame loop pauses while not `READY` |
| Frame stall in renderer (tab hidden, `requestAnimationFrame` throttled) | Electron background throttling | main: `webPreferences.backgroundThrottling:false`; sender uses a `MessageChannel`/worker-timer pump if the window is minimized — architect to decide; otherwise slate fallback of §2.5 kicks in |
| Memory growth in server | per-frame allocation | preallocated `rgb_out`; no queue; verified by self-check |

## 3. Sidecar lifecycle (Electron main)

### 3.1 Locating the executable
- **Packaged**: `process.resourcesPath/backend/dist/virtual_bridge.exe` (matches `extraResources` `backend/dist/**/*` in `package.json`; PyInstaller `--onefile` or `--onedir` output must land in `backend/dist/`; `scripts/build-sidecar.py` — referenced by `build:sidecar` but **not yet present** — must produce it).
- **Dev** (`!app.isPackaged`): `python backend/virtual_bridge.py` using `PHANTOM_PYTHON` env or `py -3` / `python` fallback.
- Fail-fast check `fs.existsSync(exe)` before spawn ⇒ `BRIDGE_STATUS{state:"missing"}`.

### 3.2 Spawn
```ts
spawn(exe, ["--host","127.0.0.1","--port",String(port)], {
  stdio: ["ignore","pipe","pipe"],
  windowsHide: true,                 // no console window flashing
  env: { ...process.env, PHANTOM_WS_TOKEN: token, PYTHONUNBUFFERED:"1", PYTHONIOENCODING:"utf-8" },
  shell: false,                      // no shell => no injection through paths with spaces/&
});
```
Paths with spaces ("PhantomCast Studio") are safe because `shell:false` + args array is used.

### 3.3 State machine (`BridgeState`)
```
stopped ─start()→ starting ─LISTENING line→ ready
starting ─timeout 10 s→ failed(E_START_TIMEOUT)
ready ─exit/crash→ restarting ─backoff→ starting
restarting ─5 failures in 60 s→ failed (stop auto-restart; UI shows "Retry")
any ─app quit→ stopping ─→ stopped
```
- **Readiness**: sidecar prints one line `PHANTOM_BRIDGE_LISTENING {"port":8765}` on stdout after `serve()` is bound, **and** the cam is opened lazily on `HELLO` (so a missing driver surfaces as `ERROR` over WS, not as a silent startup failure). Main waits for the stdout line (timeout 10 s; PyInstaller `--onefile` cold start incl. antivirus scan can take 3–6 s), not for a fixed sleep. Do not poll the port with a connect (it would register as a client).
- **Logs**: stdout/stderr piped line-buffered into `app.getPath("logs")/bridge.log` (rotate at 5 MB × 3); also keep last 200 lines in memory for `BRIDGE_STATUS.error` detail.
- **Crash restart**: on `exit` with non-zero code or signal and not `stopping`: restart with backoff 0.5, 1, 2, 4, 8 s (cap 5 attempts / 60 s window). Exit code `78` ⇒ port conflict ⇒ rotate port instead of back-off. Exit code `79` (proposed) ⇒ missing vcam backend ⇒ **do not auto-restart** (needs user action).
- **Single instance**: `app.requestSingleInstanceLock()` — a 2nd app instance would otherwise spawn a second sidecar and fight for the port/camera. On lock failure `app.quit()`.
- **Orphan prevention** (most common real bug with Python sidecars on Windows — leaves `virtual_bridge.exe` holding the camera and port 8765 after the app dies):
  1. `before-quit` / `will-quit` / `window-all-closed`: send WS text `BYE`, wait ≤ 1 s for exit, else `child.kill()` and, if still alive after 1 s more, `taskkill /PID <pid> /T /F` (`/T` kills PyInstaller `--onefile`'s bootloader→child process tree; `child.kill()` alone only kills the bootloader, leaving the Python child running).
  2. Handle `process.on("exit")`, `uncaughtException`, `SIGINT`, `SIGTERM` the same way (synchronously — `execFileSync("taskkill",…)` inside `exit`).
  3. **Sidecar-side watchdog**: if the WS has had no client for 30 s *and* a parent-liveness check fails (`--parent-pid <electron pid>` ⇒ `psutil.pid_exists` / `OpenProcess`) ⇒ sidecar exits. Covers hard-kills of Electron (Task Manager) that no handler can catch. Recommend `--parent-pid` flag; add `psutil` to `requirements.txt` or use `ctypes` `OpenProcess` (no new dep).
  4. On startup main looks for a stale pidfile (`app.getPath("userData")/bridge.pid`) and kills that PID if its image name is `virtual_bridge.exe`, before binding.
- **Graceful sidecar shutdown**: handle `SIGBREAK`/`SIGTERM` + WS `BYE`: stop camera thread, `cam.close()` (releases the DirectShow device immediately so Zoom doesn't keep a ghost device), close server, exit 0.
- **Auto-start policy**: spawn at `app.whenReady()` **before** `createWindow()`, so port/driver errors are known when UI mounts; the renderer only begins streaming once `BRIDGE_STATUS.state==="ready"`.
- **Security**: sidecar binds loopback only; token in env (not argv — argv is visible to every local process via `wmic`/Process Explorer); the exe path is never user-supplied.

### 3.4 Port selection
Try `8765` then `8766…8775`; main picks the first free port via `net.createServer().listen(p,"127.0.0.1")` probe (TOCTOU race is tolerated; sidecar's exit 78 triggers next port). The chosen port is published in `BRIDGE_STATUS.port`.

## 4. Performance budget (backend slice; supports architect's <15 % CPU, <350 MB RAM)
| Item | 720p30 | 720p60 | Notes |
|---|---|---|---|
| WS payload | 110 MB/s | 221 MB/s | loopback, uncompressed |
| Server conversion `copyto` RGB | ~1–2 ms/frame | same | SIMD memcpy-strided, ≈ 0.3–0.5 % CPU @30 |
| Server RAM | ~3.7 MB (latest) + 2.7 MB (rgb_out) + 3.7 MB (in-flight) ≈ 10 MB + interpreter/numpy ≈ 60–80 MB (PyInstaller) | | `opencv-python-headless` is in requirements but is **not needed** for this path — drop it from the bundle if unused (saves ~50 MB, import time ~0.5 s) |
| Latency added by bridge | ≤ 1 frame | ≤ 1 frame | latest-frame-wins design |
| Fallback ladder | 720p60 → 720p30 → 640×360 (upscale server-side only if Meet needs fixed size) | | triggered when `dropped` > 20 % |

1080p@60 = 498 MB/s of RGBA — **not recommended** over the WS with canvas readback on i5; keep 1080p as 30 fps only, or readback at 720p and let the sidecar scale (cv2.resize — the one legitimate use of opencv).

## 5. Status contract for the UI (additive)
`BRIDGE_STATUS.state ∈ "missing" | "starting" | "ready" | "restarting" | "failed" | "stopped"`; `error?: {code, message}` using codes in §2.6; `fps`, `device` from the last `STATS`/`READY`. PerformanceHUD may show: green dot (`ready`), amber (`starting|restarting`), red (`failed|missing`) with remediation text from the table.

## 6. Open items / contradictions found in the PRD (decisions requested)
- **O1 Audio path ambiguity.** PRD §2 says the sidecar "merutekan sinyal suara terproses ke Virtual Audio Device" (SoundDevice), while §3.4 routes via `setSinkId` to VB-CABLE. Spec v1 chooses **`setSinkId` only** (no raw PCM over WS, no sounddevice dependency). Hence `SET_VOICE_DSP` is main-state + persistence only. If the sidecar must carry audio later, add a binary channel type byte; the current "binary = video only" rule would have to change (`0x01` video / `0x02` audio prefix) — breaking, hence decide now.
- **O2 Virtual camera driver.** PRD says "DirectShow"; default pyvirtualcam backend on Windows is **OBS Virtual Camera** (requires the OBS driver registered; RGBA native input needs `unitycapture` backend, which is why we convert to RGB). The installer must ship/verify a driver; otherwise the product's headline feature fails on a clean Windows install. Needs architect/coordinator decision (license: OBS is GPLv2; pyvirtualcam is GPL-2.0 too — the sidecar `.exe` distribution implies GPL obligations; flag for legal review).
- **O3 `SET_PIPELINE_STATE` listed under the WS address** in PRD §4 header, but marked `IPC_SEND`: spec treats it as IPC-only plus the minimal forwarded text subset (§1.5).
- **O4 Resolution**: PRD frame contract is 1280×720 fixed but §1 lists 720p/1080p; resolved via `HELLO` negotiation with 720p30 default.
- **O5 Missing files for build**: `scripts/build-sidecar.py`, `scripts/self-check.mjs` are referenced by `package.json` scripts but do not exist yet; `backend/`, `electron/` not yet created.
- **O6 `pyvirtualcam`/`websockets` versions** to pin in `backend/requirements.txt`: `pyvirtualcam>=0.11`, `websockets>=12` (new asyncio API: `websockets.asyncio.server.serve`; `max_size`/`compression` kwargs as in §2.1), `numpy>=1.26,<3`; add `pyinstaller` only to a build-time requirements file.

## 7. Verification (one runnable check each; for whoever implements `backend/`)
1. **Frame contract self-check** (`scripts/self-check.mjs` + `backend` test, no frameworks): sender produces a 1280×720 RGBA gradient with alpha=0x7F; server-side conversion must output shape `(720,1280,3)`, `flags['C_CONTIGUOUS']==True`, pixel `(y,x)` == source RGB (alpha dropped), and a buffer of length `W*H*4−1` must be rejected without exception.
2. **Lifecycle smoke**: spawn sidecar, wait for `PHANTOM_BRIDGE_LISTENING`, connect, `HELLO`→`READY`, send 90 frames, assert `STATS.fps_out≈30`, send `BYE`, assert process gone in < 2 s and port 8765 free (`netstat`), repeat with `taskkill` of the parent to exercise the watchdog.
3. **Negative**: wrong-origin connect ⇒ 403; wrong token ⇒ close 1008; second producer ⇒ 1008; oversize message ⇒ close 1009 (message too big); IPC with `pitch_semitones:1e9` ⇒ clamped to 12; `vtuber_model_path:"..\\..\\x.exe"` ⇒ rejected.

## 8. Summary of deltas vs PRD (all additive / clarifying, none breaking)
1. Added `HELLO/READY/STATS/ERROR/BYE` JSON control messages; binary frames remain headerless raw RGBA (PRD-literal clients still work with 720p30 default).
2. `np.ascontiguousarray` (or preallocated `copyto`) mandatory after `frame[:, :, :3]`.
3. Sender must flip Y for WebGL readback; server never flips.
4. Latest-frame-wins single-slot buffer, no queues, `compression=None`.
5. Origin + token auth on the WS; loopback literal `127.0.0.1`.
6. Port fallback 8765→8775 published via `BRIDGE_STATUS`.
7. Sidecar lifecycle: stdout readiness line, `windowsHide`, `shell:false`, tree-kill via `taskkill /T /F`, parent-pid watchdog, single-instance lock, crash backoff (5 in 60 s), standby slate when no producer.


## 9. Addendum — reconciliation with `architect-blueprint.md` (board #8)

| Blueprint item | Resolution in this spec |
|---|---|
| **Q2** 8-byte frame header `(w:u16,h:u16,seq:u32)` vs 720p-only | **No per-frame header.** Size is negotiated once via `HELLO`/`READY` (§2.4); a header would add a copy/offset on a 3.7 MB buffer and break `np.frombuffer(...).reshape` zero-copy alignment concerns for no gain, since size cannot change mid-stream (a resolution change = new `HELLO` on the same socket, server re-opens the camera). Frame `seq` for latency/drop stats, if wanted, goes in a JSON text message `{"type":"FRAME_META","seq":n,"t":ms}` sent every 30 frames — not per frame. If the coordinator still prefers a header, it must be a breaking v2 (`HELLO.protocol:2`). |
| **§3.2 main.ts** (`app://` scheme, `backgroundThrottling:false`, disable `CalculateNativeWinOcclusion`, `sandbox:true`) | Adopted. Backend requirement added: the WS `Origin` allow-list is `app://phantomcast` (prod) and `http://localhost:5173` (dev) — see §2.1 (patched). Sidecar spawn (§3.2/3.3), single-instance lock, and quit handlers live in the same `main.ts` and must run **before** `protocol.handle`/`createWindow`. `webPreferences.preload` must stay a CommonJS-compiled `preload.js` (sandbox:true cannot load ESM preload). |
| **§3.4 CSP** hard-codes `connect-src ws://127.0.0.1:8765` | **Conflicts with port fallback (§3.4 of this spec).** Use `connect-src 'self' ws://127.0.0.1:* blob: data:` (CSP port wildcard; loopback literal only, so no widening to remote hosts). If the architect prefers a fixed port, drop the fallback and fail with `E_PORT_IN_USE` instead — **decision requested (D1)**; default of this spec = wildcard. Dev adds `ws://localhost:5173` for HMR only when `!app.isPackaged`. |
| **§3.4 VRM via IPC path** (`main` reads buffer → `parseAsync`) | Needs a channel not in the PRD: `READ_VTUBER_MODEL` (`ipcRenderer.invoke`, renderer→main) taking `{path}`, applying the §1.3 path rules (absolute, no `..`, `.vrm`/`.png`, ≤ 200 MB, `isFile`) and returning an `ArrayBuffer`; errors resolve as `{ok:false, code:"E_MODEL_PATH"\|"E_MODEL_TOO_LARGE"\|"E_MODEL_READ"}` (never throws across IPC). Replaces the `phantomcast-asset://` idea in §1.3.4. Drag-and-drop without IPC (blob URLs) remains valid and needs no main involvement; only `SET_PIPELINE_STATE.vtuber_model_path` persistence uses the path. |
| **§4.2 sidecar budget 2.0 %** | Consistent with §4 here (`copyto` ≈ 0.3–0.5 % + interpreter + `cam.send`). Measured numbers still TBD. |
| **§4.3 rule 4** backpressure `bufferedAmount > 1 frame` | Adopted verbatim (§2.3 patched). |
| **Q1** egress FPS | Spec-neutral. Server supports 30 and 60 via `HELLO.fps`; recommendation matches architect: preview 60, egress 30 default. |
| **§4.6 RAM / WASM duplicate** | Out of backend scope. Backend note: drop `opencv-python-headless` unless server-side scaling is used (§4). |

### Updated IPC channel table (supersedes §1.1 additions)
`SET_PIPELINE_STATE`, `SET_VOICE_DSP` (renderer→main, `send`); `PIPELINE_STATE_CHANGED`, `BRIDGE_STATUS` (main→renderer, `send`); `GET_BRIDGE_STATUS`, `READ_VTUBER_MODEL` (renderer→main, `invoke`).

### Ownership note for implementers (no overlap with others)
`electron/main.ts` (architect §3.2 snippet **plus** §3 of this spec) and `electron/preload.ts` are one owner's work; `backend/virtual_bridge.py`, `backend/requirements.txt`, and `scripts/build-sidecar.py` are another. Interfaces between them = this spec only.
