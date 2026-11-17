# PRODUCT REQUIREMENTS DOCUMENT (PRD)
# PhantomCast Studio (.exe)
Aplikasi Desktop Virtual Camera, Gesture & Audio Vanish Mode, Filter Wajah AR, Local VTuber Studio, dan Real-Time Voice Changer untuk Windows

## 1. Ringkasan Eksekutif & Tujuan Produk
PhantomCast Studio adalah perangkat lunak middleware kamera dan mikrofon virtual berbasis desktop mandiri (`.exe`) yang ringan untuk sistem operasi Windows. Aplikasi ini menangkap umpan webcam bawaan laptop dan mikrofon fisik secara langsung, memproses manipulasi visual dan audio secara real-time di perangkat lokal, lalu mendaftarkannya sebagai opsi perangkat kamera dan mikrofon baru di Zoom, Google Meet, Microsoft Teams, dan Discord.

| Parameter Teknis | Spesifikasi Target |
| :--- | :--- |
| **Platform Target** | Windows 10 / 11 (64-bit Standalone `.exe` & Installer) |
| **Konsumsi CPU & RAM** | Kurang dari 15% CPU (Intel Core i5/i7 Gen-11 ke atas), konsumsi RAM di bawah 350 MB |
| **Target Frame Rate** | 30 FPS (Mode Hemat Daya) atau 60 FPS (Mode Performa) pada resolusi 720p / 1080p |
| **Latensi Audio (Voice)** | Kurang dari 25 milidetik (Real-time DSP Pitch & Formant Shifting) |
| **Kompatibilitas Meeting** | Terdeteksi otomatis sebagai kamera & mikrofon virtual di Zoom, Google Meet, Teams, dan Discord |

## 2. Arsitektur Sistem (Lightweight Hybrid Stack)
- **Frontend & Rendering Engine (Electron + Vite + React + TypeScript + Three.js)**: Mengelola antarmuka kontrol, kanvas pemrosesan video terakselerasi GPU (WebGL), serta rendering model VTuber lokal (`.vrm` dan `.png`) menggunakan pustaka `@pixiv/three-vrm`.
- **AI Vision & Audio Trigger Engine (MediaPipe Tasks Vision & Web Audio API)**: Berjalan menggunakan model kuantisasi ringan yang dibundel secara lokal di folder `public/models/` dan `public/wasm/` (memuat file `.wasm`, `.task`, dan `.tflite` secara offline agar tidak terblokir kebijakan keamanan Electron CSP) untuk mengenali pose jari huruf "V", 478 titik koordinat wajah (Face Mesh), segmentasi tubuh, dan analisis spektrum frekuensi suara jentikan jari secara real-time.
- **Virtual Device Bridge (Python Sidecar + PyVirtualCam + SoundDevice)**: Layanan pendamping ringan yang dikemas menjadi `.exe` menggunakan PyInstaller. Lapisan ini menerima stream frame video `RGBA` dari kanvas, mengonversinya menjadi format 3-channel `RGB24` menggunakan NumPy (`frame[:, :, :3]`), lalu meneruskannya ke Virtual Camera DirectShow Windows serta merutekan sinyal suara terproses ke Virtual Audio Device.

## 3. Spesifikasi Fitur Utama (Functional Requirements)

### 3.1 Fitur Vanish Mode (Menghilang Otomatis saat Meeting)
- **Mekanisme Clean Plate & Segmentasi**: Pengguna dapat menekan tombol *Ambil Latar Kosong (Clean Plate)* selama 1 detik sebelum rapat, atau mengaktifkan mode *Auto Background Infill* berbasis MediaPipe ImageSegmenter yang mengganti piksel tubuh dengan latar ruangan kosong.
- **Transisi Halus (Fade Transition)**: Saat pemicu aktif, opacity tubuh memudar selama 400 milidetik hingga menghilang sepenuhnya menyisakan latar belakang ruangan.
- **Pemicu Visual (Gesture Pose Huruf "V")**: Mengangkat tangan dengan jari telunjuk (Landmark 8) dan jari tengah (Landmark 12) terbuka membentuk huruf "V" sementara jari manis dan kelingking tertekuk selama 500 ms akan mengubah status menghilang (toggle) dengan jeda pengaman (cooldown) 2 detik.
- **Pemicu Audio (Suara Jentikan Jari / "Tak")**: Algoritma FFT (512) mendeteksi lonjakan energi singkat pada frekuensi 2.500 Hz hingga 7.000 Hz berdurasi di bawah 35 ms. Sistem menerapkan *Double-Snap Detection* (dua jentikan dalam rentang 200 ms hingga 800 ms) dengan pengatur sensitivitas agar tidak terpicu oleh suara ketikan papan ketik.

### 3.2 Fitur Face Filter & Efek Khusus AR
Menyediakan lapisan efek visual real-time yang mengikuti rotasi kepala (*roll, pitch, yaw*) berdasarkan titik koordinat wajah dari MediaPipe FaceLandmarker (478 titik):
- **Privacy Pixelate**: Sensor mozaik piksel otomatis yang mengikuti area mata atau seluruh wajah pengguna.
- **Cyberpunk / Neon Visor**: Kacamata hologram 3D futuristik yang menempel presisi di antara mata kiri dan kanan mengikuti kemiringan kepala.
- **Cinematic & Anime Color LUT**: Shader WebGL / kanvas ringan untuk mengubah pencahayaan dan gradasi warna kamera (Warm, Monochrome, dan Anime Shading).

### 3.3 Fitur Local VTuber Studio (Import Model Sendiri)
- **Ekstraksi & Import Lokal**: Mendukung fitur *drag-and-drop* file model `.vrm` (standar VRoid Studio / Booth) serta gambar berlapis `.png` (PNGTuber) langsung dari penyimpanan lokal komputer.
- **Kinematika Wajah Real-Time (Kalidokit)**: Mengonversi pelacakan wajah webcam dan amplitudo mikrofon menjadi gerakan kepala, kedipan mata kiri dan kanan, serta sinkronisasi gerak mulut vokal (`aa, ih, ou, ee, oh`) secara mulus.
- **Opsi Latar Belakang Avatar**: Avatar dapat ditampilkan di atas latar ruangan asli pengguna, latar warna solid, atau gambar latar kustom.

### 3.4 Fitur Real-Time Voice Changer (Virtual Microphone)
Pemrosesan sinyal suara digital (DSP) berbasis `AudioWorkletProcessor` menggunakan algoritma **Modulated Dual-Delay Line (Jungle / WSOLA)** untuk penggeseran *Pitch* secara real-time tanpa mengubah kecepatan bicara, dikombinasikan dengan rangkaian **BiquadFilter** untuk menggeser resonansi *Formant* agar karakter suara terdengar alami dengan latensi di bawah 25 milidetik:
- **Normal (Bypass)**: Pitch 0 st, Formant 1.00
- **Wanita / VTuber (`VTUBER_GIRL`)**: Pitch +5 st, Formant +15% (1.15)
- **Anak-Anak (`CHILD`)**: Pitch +7 st, Formant +25% (1.25), HPF 160 Hz
- **Anonim / Berat (`DEEP_ANON`)**: Pitch -5 st, Formant -12% (0.88)
- Dilengkapi pemilih **Audio Output Device** (`setSinkId`) untuk merutekan suara ke perangkat virtual (seperti VB-CABLE) serta tombol **Mic Monitor** agar pengguna dapat mendengar hasil suara sendiri saat pengujian.

## 4. Spesifikasi Kontrak API Internal & IPC
Saluran IPC Electron serta WebSocket lokal pada alamat `ws://127.0.0.1:8765`:
- `SET_PIPELINE_STATE` (`IPC_SEND`): `{ vanish_mode, trigger_source: "GESTURE_V_SIGN | AUDIO_SNAP | MANUAL", active_mode: "RAW_CAM | AR_FILTER | VTUBER_3D", selected_filter_id, vtuber_model_path }`
- `SET_VOICE_DSP` (`IPC_SEND`): `{ enabled, preset: "VTUBER_GIRL | CHILD | DEEP_ANON | CUSTOM", pitch_semitones, formant_shift, noise_gate_db }`
- `STREAM_VIDEO_FRAME` (`BINARY_WEBSOCKET_8765`): Raw RGBA ArrayBuffer (1280x720) -> NumPy RGBA-to-RGB24 Slice (`frame[:, :, :3]`) -> PyVirtualCam.

## 5. Struktur Direktori Proyek Target
```
phantomcast-studio/
├── .antigravityignore
├── public/
│   ├── models/                # hand_landmarker.task, face_landmarker.task, selfie_segmenter.tflite
│   └── wasm/                  # Aset offline MediaPipe .wasm
├── backend/
│   ├── requirements.txt       # pyvirtualcam, websockets, numpy, opencv-python-headless
│   └── virtual_bridge.py      # Menerima buffer RGBA via WS, slice ke RGB24, & kirim ke Virtual Camera OS
├── electron/
│   ├── main.ts                # Mengelola window aplikasi & proses sidecar Python
│   └── preload.ts             # Jembatan IPC aman antara UI dan sistem operasi
├── src/
│   ├── components/
│   │   ├── VideoStage.tsx     # Kanvas utama WebGL/2D (Kamera + Vanish + Filter + VTuber)
│   │   ├── ControlPanel.tsx   # Panel pengaturan Trigger, Filter, Import VRM, & Voice Changer
│   │   └── PerformanceHUD.tsx # Indikator FPS, deteksi pose V-Sign, & level meter Snap Audio
│   ├── engines/
│   │   ├── visionEngine.ts    # MediaPipe Hand, Face, & Segmentation + kalkulasi sudut V-Sign
│   │   ├── snapDetector.ts    # Algoritma FFT pendeteksi suara jentikan jari ("tak")
│   │   ├── vtuberEngine.ts    # Three.js + @pixiv/three-vrm + Kalidokit solver
│   │   └── voiceChangerWorklet.ts # DSP Dual-Delay Pitch & BiquadFilter Formant shifting pada AudioWorklet
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── vite.config.ts
```
