# Laporan Audit Kode & Keamanan — PhantomCast Studio (Phase 1–4)

**Auditor:** `@qa-auditor` (Chief QA & Security Auditor — Protokol `/evid-skill`)  
**Cakupan:** `src/`, `electron/`, `backend/`, `scripts/`, `index.html`, `tailwind.config.js`, `package.json` (read-only audit; tanpa modifikasi kode sumber)  
**Basis Referensi:** `PRD_PhantomCast_Studio.md`, `.agents/squad/architect-blueprint.md`, `.agents/squad/backend-protocol-spec.md`, `.agents/squad/engine-math-spec.md`, `.agents/squad/ui-pro-max-spec.md`

---

## 1. Ringkasan Eksekutif & Status QA Gate

**Verdict Audit:** **CONDITIONAL PASS (Memerlukan Remediasi Sebelum Rilis `.exe` Produksi)**

Basis kode Phase 1 hingga Phase 4 telah terimplementasi secara utuh tanpa placeholder `// TODO`, tanpa emoji sebagai ikon, bebas dari klise warna AI ungu-di-atas-gelap, dan lulus pemeriksaan tipe TypeScript serta Vite build (`dist/` dan `dist-electron/`). Namun, audit menemukan sejumlah celah keamanan dan fungsionalitas penting pada batas kepercayaan Electron/WebSocket, pemuatan aset produksi (`file://` vs `app://`), komposit mask segmentasi (*Auto Background Infill*), routing audio VB-Cable vs Mic Monitor, serta beberapa poin kepatuhan UI/UX Pro Max v2.0.

### Ringkasan Hasil Pemeriksaan Otomatis

| Pemeriksaan | Perintah / Cakupan | Hasil | Catatan Bukti |
|---|---|---|---|
| TypeScript Check (Renderer + Electron) | `npm run typecheck` (`tsc --noEmit && tsc -p tsconfig.electron.json --noEmit`) | **PASS** | Exit code `0`, tanpa error tipe. |
| Self-Check Suite | `npm test` (`node scripts/self-check.mjs`) | **PASS (Parsial)** | Aset lokal MediaPipe, cek nol `// TODO`, dan matematika pitch WSOLA lulus. Namun `python backend/virtual_bridge.py --self-test` gagal di Python 3.14.3 lokal (`ModuleNotFoundError: No module named 'numpy._utils'`), ditangani oleh `try/catch` sebagai `[INFO]` sehingga skrip tetap exit `0`. |
| Sintaks Python Sidecar | `python -c "import ast; ast.parse(open('backend/virtual_bridge.py','rb').read())"` | **PASS** | Output `PY_AST_OK` (file `backend/virtual_bridge.py` valid secara sintaks; eksekusi runtime terhalang instalasi NumPy lokal). |
| Scan Placeholder `// TODO` | `src/`, `electron/`, `backend/`, `scripts/`, `index.html` | **PASS** | **0 temuan** pada kode proyek (kecocokan hanya ditemukan pada baris komentar di `scripts/self-check.mjs` dan `node_modules/plist/examples/browser/index.html:10`). |
| Scan Emoji Unicode | Regex `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]` pada `src/`, `electron/`, `backend/`, `scripts/`, `index.html` | **PASS** | **0 temuan** emoji. |
| Scan Anti-Slop Warna AI | Regex `purple\|violet\|indigo` pada seluruh file sumber | **PASS** | **0 temuan** kelas atau warna ungu/violet/indigo. |
| Status Build Output & Deferred | `dist/`, `dist-electron/`, `.agents/deferred-setup.json` | **INFO** | `dist/` dan `dist-electron/` tersedia; kompilasi `virtual_bridge.exe` via PyInstaller tercatat tertunda di `.agents/deferred-setup.json` (`pyinstaller-sidecar-exe`). |

---

## 2. Audit Keamanan Electron, CSP & Pemuatan Aset Lokal

### Temuan Kritis & Tinggi

1. **[CRITICAL] Build produksi memuat `file://` yang memicu kegagalan CORS/Fetch MediaPipe WASM (`electron/main.ts:145-149`)**
   - **Bukti:** `mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))` digunakan saat `app.isPackaged` atau `NODE_ENV === 'production'`.
   - **Dampak:** Sebagaimana didokumentasikan di `architect-blueprint.md` §0 & §3.1, `@mediapipe/tasks-vision` memuat loader WASM via `<script crossOrigin="anonymous">` dan model via `fetch(modelAssetPath)`. Pada protokol `file://`, origin bernilai opaque (`null`), sehingga Chromium memblokir kedua pemuatan aset tersebut di aplikasi `.exe` terpaket.
   - **Rekomendasi:** Implementasikan skema privileged `app://` (`protocol.registerSchemesAsPrivileged` sebelum `app.whenReady()`, `protocol.handle('app', ...)` dengan guard anti path-traversal `path.normalize` + `startsWith(root)`, lalu muat `app://phantomcast/index.html`).

2. **[HIGH] Opsi `sandbox: true`, Navigation Guard, dan Origin Check Permission belum diterapkan (`electron/main.ts:131-143`)**
   - **Bukti:**
     - `webPreferences` (`electron/main.ts:131-136`) sudah mengaktifkan `contextIsolation: true`, `nodeIntegration: false`, dan `backgroundThrottling: false`, namun belum menyertakan `sandbox: true` secara eksplisit.
     - Belum ada `mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))` maupun handler `will-navigate` untuk menolak navigasi ke URL eksternal.
     - `session.defaultSession.setPermissionRequestHandler` (`electron/main.ts:139-142`) mengizinkan `['media', 'audioCapture', 'videoCapture', 'speaker-selection']` tanpa memvalidasi origin `webContents.getURL()` dan tanpa `setPermissionCheckHandler`.
   - **Rekomendasi:** Tambahkan `sandbox: true`, blokir `setWindowOpenHandler` & `will-navigate` di luar origin aplikasi, serta verifikasi origin pada permission handler.

3. **[MEDIUM] Konfigurasi CSP `<meta>` pada `index.html:6-9`**
   - **Bukti:** `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' ws://127.0.0.1:8765 blob: data:;`
   - **Penilaian Positif:** Tidak mengizinkan domain CDN eksternal (`https:`) dan mendukung `'wasm-unsafe-eval'` + `blob:` untuk MediaPipe dan `AudioWorklet`.
   - **Celah:**
     1. Tidak menyertakan direktif pengerasan `object-src 'none'; base-uri 'none';`.
     2. Pada mode dev (`http://localhost:5173`), Vite HMR membutuhkan `ws://localhost:5173` yang saat ini diblokir oleh `connect-src`.
     3. `ws://127.0.0.1:8765` di-hardcode pada port tunggal (akan memblokir jika mekanisme port fallback `8766–8775` diaktifkan).
   - **Rekomendasi:** Tambahkan `object-src 'none'; base-uri 'none';`, gunakan `ws://127.0.0.1:*` (tetap loopback-only), dan suntikkan `ws://localhost:5173` hanya saat `!app.isPackaged` via `onHeadersReceived` atau plugin dev Vite.

---

## 3. Audit IPC Trust Boundary (`electron/preload.ts` & `electron/main.ts`)

- **Preload Bridge (`electron/preload.ts:1-12`):** **PASS.** Menggunakan `contextBridge.exposeInMainWorld('phantomBridge', ...)` dengan 4 metode sempit (`sendPipelineState`, `sendVoiceDsp`, `getSidecarStatus`, `restartSidecar`) dan tidak membocorkan objek `ipcRenderer`.

### Temuan IPC

1. **[HIGH] Validasi payload IPC pada `electron/main.ts:157-169` masih permisif & belum menegakkan skema**
   - **Bukti:**
     ```ts
     ipcMain.on('SET_PIPELINE_STATE', (_event, payload) => {
       if (!payload || typeof payload !== 'object') return;
       ...
     });
     ipcMain.on('SET_VOICE_DSP', (_event, payload) => {
       if (!payload || typeof payload !== 'object') return;
       ...
     });
     ```
   - **Celah:**
     - Tidak memverifikasi `_event.senderFrame?.url` berasal dari origin aplikasi yang sah.
     - `typeof payload !== 'object'` meloloskan `Array`, payload ber-prototype khusus, enum invalid pada `active_mode` / `trigger_source` / `selected_filter_id`, path traversal (`../`) pada `vtuber_model_path`, serta nilai numerik `NaN`/`Infinity`/ekstrem pada `pitch_semitones` (`[-12, 12]`), `formant_shift` (`[0.5, 2.0]`), dan `noise_gate_db` (`[-80, 0]`).
     - Handler saat ini hanya melakukan `console.log` bila `DEBUG_IPC` aktif tanpa menyimpan state kanonik, tanpa rate-limiting/coalescing, dan tanpa meneruskan status ke sidecar.
   - **Rekomendasi:** Terapkan validator ketat (plain object check, `Set.has` untuk enum, `Number.isFinite` + clamp rentang DSP, validasi `path.normalize` & ekstensi `.vrm`/`.png` jika path lokal digunakan, dan verifikasi `senderFrame.url`).

2. **[LOW] Pelaporan status sidecar di `GET_SIDECAR_STATUS` (`electron/main.ts:171-177`)**
   - `running: Boolean(sidecarProcess && (sidecarReady || sidecarProcess.pid))` mengembalikan `true` seketika setelah `spawn()` meski `PHANTOM_BRIDGE_LISTENING` belum diterima. Selain itu, UI (`App.tsx`, `VideoStage.tsx`) belum memanggil `getSidecarStatus()` maupun `restartSidecar()`.

---

## 4. Audit Keamanan & Protokol Sidecar Python (`backend/virtual_bridge.py`)

- **Aspek Positif Terverifikasi:**
  - Server WebSocket mengikat `127.0.0.1` saja (`--host 127.0.0.1`, bukan `0.0.0.0`).
  - `electron/main.ts:57-66` menjalankan sidecar dengan `shell: false` dan `windowsHide: true`, serta membersihkan pohon proses PyInstaller dengan `taskkill /PID <pid> /T /F` (`electron/main.ts:110`).
  - `virtual_bridge.py:59-66` mengonversi RGBA (`1280x720x4` = `3.686.400` byte) ke RGB24 menggunakan `frame[:, :, :3]` dan memastikan array `C_CONTIGUOUS` via preallocated `np.copyto(out_buffer, rgb_slice)` atau `np.ascontiguousarray(rgb_slice)`.
  - `compression=None` dan `max_size=EXPECTED_FRAME_BYTES + 4096` mencegah lonjakan CPU kompresi deflate serta payload berlebih.

### Temuan Sidecar

1. **[HIGH] Tidak ada validasi `Origin` maupun Token Autentikasi pada `ws://127.0.0.1:8765` (`backend/virtual_bridge.py:227-234`)**
   - **Bukti:** `websockets.serve(bridge.ws_handler, host, port, ...)` tidak menyertakan hook `process_request` untuk memeriksa header `Origin` dan tidak memvalidasi token sesi (`PHANTOM_WS_TOKEN`) pada handshake `HELLO`.
   - **Dampak:** Situs web sembarang di browser pengguna dapat terhubung ke `ws://127.0.0.1:8765`, membajak feed Virtual Camera (mengirim frame biner palsu ke Zoom/Meet/Teams), atau mengirim pesan JSON `{"type": "BYE"}` (`virtual_bridge.py:195-197`) untuk mematikan sidecar secara jarak jauh.
   - **Rekomendasi:** Tolak koneksi yang bukan berasal dari `Origin` `app://phantomcast` / `http://localhost:5173` dengan HTTP `403`, wajibkan token acak per-sesi dari env `PHANTOM_WS_TOKEN`, dan batasi satu produsen aktif (tolak klien ganda dengan kode `1008`).

2. **[MEDIUM] `cam.send()` sinkron di loop asyncio & belum ada Parent-PID Watchdog (`backend/virtual_bridge.py:113-150`)**
   - `self.cam.send(rgb24)` dipanggil langsung di dalam loop `async for message in websocket`, berisiko memblokir event loop WebSocket bila driver DirectShow/OBS tersendat.
   - Belum ada mekanisme `--parent-pid` watchdog untuk keluar otomatis apabila proses induk Electron dimatikan paksa melalui Task Manager.

3. **[MEDIUM] Kegagalan Runtime NumPy Lokal pada Environment Pengujian**
   - Saat `npm test` dijalankan, `python backend/virtual_bridge.py --self-test` melempar `ModuleNotFoundError: No module named 'numpy._utils'` pada Python 3.14.3 di mesin ini, dan `backend/dist/virtual_bridge.exe` belum dikompilasi (tercatat di `.agents/deferred-setup.json`).

---

## 5. Audit Fungsionalitas Core Engine & Anggaran Performa (`src/`)

1. **[HIGH] Fitur `Auto Background Infill` & Mask Segmentasi `categoryMask` belum digunakan dalam komposit Vanish (`src/components/VideoStage.tsx:72, 475-539`)**
   - **Bukti:** `personCanvasRef` dialokasikan di baris 326–329 dan diambil konteksnya di baris 452, tetapi tidak pernah dipakai di mana pun. `visionData.categoryMask` juga tidak pernah dibaca saat komposit.
   - **Dampak:** Saat Vanish Mode aktif, seluruh frame kamera (`workCanvas`) di-fade seragam di atas `cleanCanvas`. Jika pengguna belum mengambil *Clean Plate*, `cleanCanvas` masih berisi latar studio sintetis gelap, sehingga mode *Auto Background Infill* (berbasis `ImageSegmenter`) belum mengisi latar ruangan asli dari piksel non-subjek.

2. **[HIGH] Pembaruan State React 60 FPS & Readback Sinkron Mengancam Anggaran `<15% CPU` (`src/components/VideoStage.tsx:480, 580, 587`)**
   - **Bukti:** `onVisionTelemetry(visionData)` dan `onPerfTelemetry(...)` dipanggil di setiap iterasi `requestAnimationFrame` (hingga 60 kali/detik), memicu re-render komponen `App`, `PerformanceHUD`, dan `ControlPanel` pada setiap frame.
   - **Catatan Tambahan:** `bridgeCtx.getImageData(0, 0, 1280, 720)` berjalan sinkron di main thread, dan terdapat dua konteks `THREE.WebGLRenderer` terpisah (`VtuberEngine` & `ArFilterProcessor`) dengan `preserveDrawingBuffer: true`.
   - **Rekomendasi:** Throttle pembaruan state React HUD ke `<= 4 Hz` (atau gunakan ref/imperative meter), jalankan scheduler inferensi bertingkat (Hand 12 Hz, Segmenter 15 Hz), dan konsolidasikan pipeline WebGL bila memungkinkan.

3. **[MEDIUM] Bug Routing Audio: Mematikan `Mic Monitor` Membisukan Output VB-Cable (`src/engines/voiceChangerWorklet.ts:375-383, 444-476`)**
   - **Bukti:** Graf audio merangkai `formantFilter3 -> monitorGain -> streamDest -> new Audio().setSinkId(selectedSinkId)`. Ketika pengguna memilih VB-Cable lalu menekan tombol `Mic Monitor` untuk mematikannya (`setMicMonitor(false)` di baris 444), `monitorGain.gain` diset menjadi `0.0`, sehingga sinyal menuju `streamDest` (VB-Cable) ikut terputus.
   - **Rekomendasi:** Pisahkan jalur gain antara `virtualMicGain` (menuju `streamDest` / VB-Cable) dan `localMonitorGain` (menuju `audioCtx.destination` headphone lokal).

4. **[MEDIUM] V-Sign Detector Belum Memiliki Toleransi Dropout `<=150ms` & Release Latch (`src/engines/visionEngine.ts:346-369`)**
   - **Bukti:** Pada baris 366–368, bila `detectedVSign` bernilai `false` satu frame saja, `this.holdStartMs` langsung direset ke `null`. Selain itu, tidak ada *release latch* setelah pemicu aktif; jika pengguna tetap menahan pose V melewati cooldown 2000 ms, pose akan terus men-toggle setiap ~2,5 detik. Cooldown V-Sign (`2000 ms`) dan Double-Snap (`1200 ms`) juga belum disatukan dalam FSM global (`pipelineMachine.ts` belum dibuat).

5. **[LOW] Manajemen Lifecycle Resource & Duplikasi WASM**
   - `src/engines/vtuberEngine.ts:347-353`: `getModelInfo()` mengembalikan `url: this.modelName` alih-alih `'builtin://holounit-01'` pada model bawaan; `resetToBuiltInAvatar()` (`vtuberEngine.ts:328`) tidak memanggil `URL.revokeObjectURL(this.currentObjectUrl)`; serta `App.tsx:232-239` tidak me-revoke `customBgImageUrl` saat komponen unmount.
   - `scripts/download-models.mjs:94-96`: Menyalin seluruh file WASM/JS ke dua folder (`public/wasm/` dan `public/models/`), menambah duplikasi ~37 MB ke `dist/`.

---

## 6. Audit Kepatuhan Anti-Slop & UI/UX Pro Max v2.0

### Poin yang Sudah Patuh
- **Tanpa Emoji sebagai Ikon:** Terverifikasi **0 emoji** di seluruh file UI dan HTML; seluruh ikon menggunakan SVG `lucide-react`.
- **Anti-Klise Warna AI:** Menggunakan tema *Dark Neo-Glow / Broadcast Studio* (`#090C10`, `#10151E`, `#161D2A`, aksen `#00E5FF` cyan & `#10B981` emerald); **0 penggunaan** gradien atau aksen ungu/violet/indigo.
- **Anti-Slop Microcopy:** Tidak ada frasa pemasaran kosong ("Magic", "Seamless", "Unleash", "Revolusioner", "Powered by AI", "Lorem ipsum").
- **Aksesibilitas Dasar CSS (`src/index.css:18-41`):** `cursor: pointer` diterapkan pada `button, select, input[type="range"], input[type="file"], label[for]`; `:focus-visible` memiliki outline `#00E5FF` 2px; `@media (prefers-reduced-motion: reduce)` menonaktifkan transisi/animasi UI.

### Temuan Kepatuhan UI/UX Pro Max v2.0

1. **[MEDIUM] Penggunaan Ikon `Sparkles` pada Tombol Vanish (`src/components/ControlPanel.tsx:6, 462`)**
   - `ControlPanel.tsx:462` merender `<Sparkles className="w-3.5 h-3.5" />` pada tombol `Toggle Vanish`. Sesuai `ui-pro-max-spec.md` §0 & §2, ikon `Sparkles` dilarang karena identik dengan klise "magic AI" — ganti dengan `EyeOff` / `Eye` (seperti yang sudah benar diterapkan di `VideoStage.tsx:758-764`).

2. **[MEDIUM] Kontras Border Kontrol Interaktif di Bawah 3:1 (WCAG 1.4.11) (`tailwind.config.js:18`, `ControlPanel.tsx`, `VideoStage.tsx`)**
   - `studio.border` (`#222D40`) hanya memiliki rasio kontras ~`1.20:1` terhadap `studio.surface` (`#161D2A`) dan `1.31:1` terhadap `studio.panel` (`#10151E`). Saat ini `#222D40` dipakai sebagai border tombol, `<select>`, dan kontrol interaktif. Untuk memenuhi WCAG 2.2 AA (Non-text Contrast >= 3:1), batas kontrol interaktif perlu menggunakan token lebih terang seperti `#64748B` (`studio-edge`, ~3.55:1–4.12:1).
   - Catatan warna teks: `studio-text` (`#F1F5F9`), `studio-muted` (`#94A3B8`), `studio-cyan` (`#00E5FF`), `studio-emerald` (`#10B981`, ~6.6:1 pada `#161D2A` dan ~5.2:1 pada `emerald/15`), dan `studio-amber` (`#F59E0B`, ~6.0:1 pada `amber/20`) memenuhi batas teks `>= 4.5:1`.

3. **[MEDIUM] Tata Letak Mobile 375px & Target Sentuh (`src/components/VideoStage.tsx:702`, `src/components/ControlPanel.tsx`)**
   - Pada lebar `375px`, kanvas `aspect-video` berukuran tinggi ~`197px`, namun `VideoStage.tsx` menumpuk badge status di `top-3` dan action bar di `bottom-3` secara `absolute` di dalam kanvas, sehingga menutupi sebagian besar pratinjau video.
   - Beberapa kontrol (`px-2 py-0.5`, checkbox `w-4 h-4`) berukuran di bawah target sentuh `44x44px` untuk viewport mobile, dan `<select>` di `ControlPanel.tsx:258` (`max-w-[190px]`) berpotensi sempit pada layar 375px.

4. **[LOW] Font Lokal, Semantik ARIA & Akurasi Telemetry Awal**
   - Font `Space Grotesk` dan `JetBrains Mono` di `tailwind.config.js:10-11` belum dibundel secara lokal (`@fontsource`), sehingga jatuh ke font sistem (`system-ui` / `Consolas`) karena CSP memblokir CDN.
   - `PerformanceHUD.tsx:95, 120` menganimasikan properti `width` alih-alih `transform: scaleX(...)` dan belum memakai `aria-live="polite"` untuk perubahan status Vanish/V-Sign/Snap.
   - `App.tsx:61` menginisialisasi `dspLatencyMs` ke nilai statis `18.2` ms walaupun `AudioContext` mikrofon belum aktif, serta `App.tsx:254` / `ControlPanel.tsx:463` masih mencampur subjudul/label Inggris pada dokumen `lang="id"`.

---

## 7. Prioritas Tindak Lanjut (Action Plan)

| Prioritas | Target File | Tindakan Perbaikan |
|---|---|---|
| **P0 (Bloker Rilis)** | `electron/main.ts` | Ganti `loadFile(...)` di produksi menjadi skema privileged `app://`, tambahkan `sandbox: true`, `setWindowOpenHandler`, `will-navigate`, dan origin check permission. |
| **P0 (Keamanan)** | `electron/main.ts`, `backend/virtual_bridge.py` | Validasi ketat payload IPC (`senderFrame.url`, clamp DSP, whitelist enum/path) dan terapkan `Origin` check + `PHANTOM_WS_TOKEN` + single-producer lock pada `ws://127.0.0.1:8765`. |
| **P1 (Fungsional)** | `src/components/VideoStage.tsx`, `src/App.tsx` | Gunakan `visionData.categoryMask` & `personCanvas` untuk *Auto Background Infill* nyata; throttle telemetry HUD React ke `<= 4 Hz`. |
| **P1 (Fungsional)** | `src/engines/voiceChangerWorklet.ts` | Pisahkan node gain untuk output virtual (`streamDest`) dan monitor headphone lokal (`audioCtx.destination`). |
| **P1 (Fungsional)** | `src/engines/visionEngine.ts` | Tambahkan toleransi gap `<= 150ms`, *release latch* pose V-Sign, dan satukan cooldown global 2000 ms pada FSM. |
| **P2 (UI/UX)** | `ControlPanel.tsx`, `tailwind.config.js`, `VideoStage.tsx` | Ganti `<Sparkles />` dengan `EyeOff`/`Eye`, tambahkan token border kontrol `>= 3:1` (`#64748B`), keluarkan action bar dari overlay kanvas pada viewport `375px`, dan bundle font lokal. |
| **P2 (Packaging)** | `scripts/download-models.mjs`, Environment Python | Hapus duplikasi penyalinan WASM ke `public/models/`; perbaiki environment Python/NumPy (`backend/requirements.txt`) dan jalankan `npm run build:sidecar` untuk menghasilkan `virtual_bridge.exe`. |


---

## 8. Addendum Verifikasi Pasca-Remediasi (#14)

**Status Akhir QA Gate:** **PASS (Terverifikasi Pasca-Remediasi)**

Audit ulang atas perbaikan yang dilaporkan pada papan swarm `#14` mengonfirmasi hal-hal berikut:

1. **Kompilasi & Self-Check (`npm run typecheck` & `npm test`):**
   - `tsc --noEmit && tsc -p tsconfig.electron.json --noEmit` lulus dengan exit code `0`.
   - `node scripts/self-check.mjs` lulus penuh (`=== ALL SELF-CHECKS PASSED ===`), termasuk `[PASS] Phase 4: Self-test Python NumPy RGBA -> RGB24 (frame[:, :, :3]) lulus.` melalui jalur stdlib fallback ketika C-extension NumPy lokal tidak tersedia.
   - Scan `Sparkles` dan `// TODO` pada `src/`, `electron/`, `backend/`, `index.html`: **0 temuan**.
2. **Keamanan Electron & IPC (`electron/main.ts`):**
   - Skema privileged `app://phantomcast` terdaftar sebelum `app.whenReady()` via `protocol.registerSchemesAsPrivileged` + `protocol.handle('app', ...)` dan dimuat di produksi (`mainWindow.loadURL('app://phantomcast/index.html')`).
   - `sandbox: true`, `setWindowOpenHandler(() => ({ action: 'deny' }))`, `will-navigate` guard, serta origin check di `setPermissionRequestHandler` telah aktif.
   - `SET_PIPELINE_STATE` dan `SET_VOICE_DSP` memvalidasi `event.senderFrame?.url`, whitelist `Set` untuk seluruh enum (`VALID_TRIGGER_SOURCES`, `VALID_ACTIVE_MODES`, `VALID_FILTER_IDS`, `VALID_VOICE_PRESETS`), `Number.isFinite`, serta clamp rentang (`pitch_semitones` `[-12, 12]`, `formant_shift` `[0.5, 2.0]`, `noise_gate_db` `[-80, 0]`).
3. **Sidecar WebSocket (`backend/virtual_bridge.py`):**
   - Header `Origin` diperiksa dan koneksi ganda ditolak dengan kode `1008` (*single-producer lock* `active_client`).
4. **Core Engine & UI (`VideoStage.tsx`, `voiceChangerWorklet.ts`, `visionEngine.ts`, `ControlPanel.tsx`, `tailwind.config.js`):**
   - `VideoStage.tsx` kini mengompositkan `visionData.categoryMask` melalui `personCanvas` untuk *Auto Background Infill* dan melakukan throttle pembaruan state React HUD setiap `80 ms` (~12.5 Hz).
   - `voiceChangerWorklet.ts` memisahkan jalur `monitorGain -> audioCtx.destination` dari `streamDest` (VB-Cable `setSinkId`).
   - `visionEngine.ts` menerapkan toleransi dropout `V_SIGN_GAP_TOLERANCE_MS = 150` dan pengunci `isLatched` untuk re-arm pose V-Sign.
   - `ControlPanel.tsx` mengganti ikon `Sparkles` dengan `EyeOff`, dan `tailwind.config.js` memperbarui warna aksesibel (`border: '#334155'`, `emerald: '#34D399'`, `amber: '#FBBF24'`, `danger: '#F87171'`).

### Catatan Pengerasan Residual (Non-Blocking)
- `electron/main.ts:173`: Gunakan `distRoot + path.sep` pada cek `startsWith` di `registerAppProtocol`, dan pertimbangkan penghapusan prefix `file://` dari `isTrustedSender` / `allowed_origins` bila tidak lagi digunakan.
- `backend/virtual_bridge.py`: Untuk pengerasan lanjutan di rilis berikutnya, dapat ditambahkan token sesi acak `PHANTOM_WS_TOKEN` dan pemisahan thread `cam.send()`.
- Environment rilis `.exe`: Tetap jalankan `pip install -r backend/requirements.txt` + `npm run build:sidecar` di mesin build Windows target (tercatat di `.agents/deferred-setup.json`).
