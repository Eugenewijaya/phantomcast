# PhantomCast Studio — UI/UX Pro Max Spec v2.0 (Dark Neo-Glow / Broadcast Studio)

Owner: ui-specialist. Basis: `PRD_PhantomCast_Studio.md`, `tailwind.config.js` (palet `studio.*` yang sudah ada), `index.html` (CSP).
Semua rasio kontras di bawah **dihitung** (WCAG 2.x relative luminance), bukan perkiraan.

## 0. Konsep & Anti-Klise
- Metafora: **ruang kontrol siaran** (broadcast switcher / mixing desk), bukan "dashboard AI". Biru-hitam tinta + **cyan sinyal** + **emerald "on-air"** + **amber peringatan**. Merah hanya untuk REC/error.
- **DILARANG**: gradien ungu/indigo/violet di atas gelap, `from-purple-* to-blue-*`, blob gradien, kartu bergradien pelangi, glow ungu, ikon sparkles ✨ sebagai "AI". Tidak ada hue 250–320° pada aksen.
- Glow = **sinyal status** (punya arti), bukan dekorasi: hanya elemen aktif/live yang bercahaya.
- Tidak ada emoji di UI, label, tombol, toast, log, atau `<title>`. Ikon = SVG **lucide-react** saja (sudah di `package.json`).

## 1. Design Tokens

### 1.1 Warna (CSS variables → mapping ke `theme.extend.colors.studio`)
| Token | Hex | Peran |
|---|---|---|
| `--bg` (`studio-bg`) | `#090C10` | kanvas aplikasi |
| `--panel` (`studio-panel`) | `#10151E` | panel samping / header |
| `--surface` (`studio-surface`) | `#161D2A` | kartu, input |
| `--raised` (baru `studio-raised`) | `#1D2636` | hover/selected, popover |
| `--hairline` (`studio-border`) | `#222D40` | pemisah dekoratif saja (BUKAN batas kontrol) |
| `--control-border` (baru `studio-edge`) | `#64748B` | batas input/toggle/button outline (>=3:1) |
| `--text` | `#F1F5F9` | teks utama |
| `--text-muted` | `#94A3B8` | teks sekunder |
| `--text-subtle` | `#7C8CA3` | placeholder/caption, **hanya di bg/panel/surface** |
| `--signal` (cyan) | `#00E5FF` | aksen utama, fokus, nilai aktif |
| `--onair` (emerald) | `#34D399` (ganti `#10B981`) | status live / sukses |
| `--warn` (amber) | `#FBBF24` (ganti `#F59E0B`) | peringatan, cooldown |
| `--danger` | `#F87171` | error, REC, hapus |
| `--on-signal` | `#04141A` | teks di atas fill cyan |
| `--focus-ring` | `#67E8F9` | outline `:focus-visible` |

Catatan perubahan palet: emerald/amber/danger dicerahkan agar lolos sebagai **teks** (≥4.5:1) pada semua permukaan; nilai lama (`#10B981`, `#F59E0B`, `#EF4444`) boleh tetap dipakai hanya sebagai fill/ikon dekoratif.

### 1.2 Tabel Kontras Terverifikasi
| Foreground | bg `#090C10` | panel `#10151E` | surface `#161D2A` | raised `#1D2636` | Lulus |
|---|---|---|---|---|---|
| text `#F1F5F9` | 17.89 | 16.70 | 15.42 | 13.86 | AAA |
| muted `#94A3B8` | 7.64 | 7.13 | 6.59 | 5.92 | AA/AAA |
| subtle `#7C8CA3` | 5.73 | 5.35 | 4.94 | **4.44** | AA kecuali di raised → **jangan dipakai di raised** |
| cyan `#00E5FF` | 12.74 | 11.89 | 10.98 | 9.87 | AAA |
| emerald `#34D399` | 10.19 | 9.52 | 8.79 | 7.90 | AAA |
| amber `#FBBF24` | 11.74 | 10.96 | 10.12 | 9.10 | AAA |
| danger `#F87171` | 7.08 | 6.61 | 6.11 | 5.49 | AA/AAA |
| focus `#67E8F9` | 13.52 | 12.62 | 11.65 | 10.48 | AAA |
| control-border `#64748B` (non-teks, perlu 3:1) | 4.12 | 3.84 | 3.55 | 3.19 | AA 1.4.11 |

Teks pada fill: `#04141A` di cyan = **12.19**; `#04140D` di emerald = **9.83**; `#1A0505` di danger = **7.11**.
Aturan: teks ≥4.5:1; teks besar (≥18.66px bold / ≥24px) & ikon/batas kontrol ≥3:1. Status tidak boleh hanya warna → selalu pasangkan ikon + label teks.
`--hairline #222D40` (1.2–1.4:1) hanya pemisah dekoratif; jangan menjadi satu-satunya penanda batas tombol/input.

### 1.3 Tipografi
- Sans: `Space Grotesk` (judul/label), fallback `Plus Jakarta Sans`, `Inter`, `system-ui`. Mono: `JetBrains Mono` (angka FPS, ms, dB, semitone — wajib `font-variant-numeric: tabular-nums`).
- **CSP**: `font-src` jatuh ke `default-src 'self'` → **dilarang** Google Fonts CDN. Bundle lokal (mis. `@fontsource/space-grotesk`, `@fontsource/jetbrains-mono`, weight 400/500/700, `font-display: swap`) atau fallback system. *(Penambahan dependensi = keputusan engine-lead/coordinator; spec ini tidak mengubah `package.json`.)*
- Skala (rem, base 16): `xs .75 / sm .8125 / base .9375 / lg 1.125 / xl 1.375 / 2xl 1.75`. Teks isi minimum **13px**; teks kontrol 14–15px. Line-height 1.5 (isi) / 1.2 (judul). Label kategori: uppercase, `letter-spacing .08em`, 11–12px **hanya** untuk label ≥ muted.

### 1.4 Spasi, Radius, Elevasi, Z
- Grid 4px: `4 8 12 16 24 32 48`. Padding panel 16 (mobile) / 20–24 (desktop). Gap antar kontrol 8–12.
- Radius: kontrol `8px`, kartu `12px`, stage video `16px`, pill/status `999px`.
- Elevasi (tanpa blur berlebihan): `--shadow-card: 0 1px 0 rgb(255 255 255 / .04) inset, 0 8px 24px rgb(0 0 0 / .35)`.
- Glow sinyal (hanya state aktif): `--glow-signal: 0 0 0 1px rgb(0 229 255 / .55), 0 0 18px rgb(0 229 255 / .25)`; `--glow-onair: 0 0 0 1px rgb(52 211 153 / .55), 0 0 16px rgb(52 211 153 / .25)`.
- Glass (header, popover, HUD di atas video): `background: rgb(16 21 30 / .72); backdrop-filter: blur(14px) saturate(1.2); border: 1px solid rgb(148 163 184 / .16)`. **Teks di atas glass wajib dihitung terhadap worst-case**: di atas video tak terduga, pakai fill min `.72` + teks `--text` (kontras ≥ 7:1 pada hitam pekat 72% overlay). Fallback tanpa `backdrop-filter`: solid `--panel`.
- Z-index: stage 0, HUD 10, panel 20, popover 30, toast 40, modal 50.

### 1.5 Gerak
- Durasi: `--dur-fast 120ms` (hover), `--dur-base 200ms` (toggle/panel), `--dur-slow 320ms` (layout). Easing: `cubic-bezier(.2,.8,.2,1)`.
- **Vanish Mode = tepat 400ms** (kontrak PRD) — durasi ini milik kanvas (`VideoStage`), bukan token UI; UI hanya mencerminkan status dengan progress ring 400ms linear.
- Animasi yang diizinkan: transisi `opacity`/`transform`/`box-shadow`. Dilarang animasi `width/height/top/left` (layout thrash menambah CPU; budget <15% CPU).
- Denyut "ON AIR"/REC: 1 animasi `opacity` 1.6s, satu elemen saja.
- **`prefers-reduced-motion: reduce`** (wajib):
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```
  Denyut diganti indikator statis (ikon + teks). Efek pada video (fade Vanish 400ms) tetap berjalan — itu isi video, bukan UI chrome — tetapi sediakan opsi pengaturan "Vanish instan" bila reduced-motion aktif.

## 2. Komponen & Perilaku Wajib (semua interaktif)
- `cursor: pointer` pada semua `button, [role=button], [role=switch], select, label[for], summary, a`; `cursor: not-allowed` + `aria-disabled` pada disabled (opacity .5 **tidak boleh** menurunkan teks di bawah 4.5 untuk info penting → pakai ikon gembok + keterangan).
- **`:focus-visible`** global (tidak pernah `outline: none` tanpa pengganti):
```css
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: inherit; }
:focus:not(:focus-visible) { outline: none; }
```
  Cincin fokus ≥3:1 terhadap latar tetangga (terverifikasi 10–13:1). Di atas fill cyan, pakai `outline-color: #F1F5F9` + offset 2px.
- **Target sentuh/klik ≥ 44×44px** pada ≤768px, ≥ 32×32px desktop (WCAG 2.5.8 min 24px).
- Toggle = `role="switch"` + `aria-checked`; segmented mode (RAW_CAM/AR_FILTER/VTUBER_3D) = `role="radiogroup"` dengan arrow-key roving tabindex.
- Slider (pitch/formant/noise gate/sensitivitas snap): `<input type=range>` native distilasi, `aria-valuetext` berisi satuan ("+5 semiton", "−42 dB"); tampilkan nilai numerik mono di sebelahnya.
- Status live memakai `aria-live="polite"` (pose V terdeteksi, snap terdeteksi, state Vanish); error = `role="alert"`.
- Urutan Tab = urutan visual; shortcut keyboard untuk Vanish (mis. `Ctrl+Shift+V`) agar pemicu manual (`trigger_source: MANUAL`) selalu bisa diakses tanpa mouse.
- Skip-link "Lewati ke kontrol" muncul saat fokus.

### Ikon (Lucide, SVG, stroke 1.75, ukuran 16/20/24, `aria-hidden` bila ada label teks)
| Fungsi | Ikon |
|---|---|
| Raw camera | `Camera` |
| AR filter | `ScanFace` |
| VTuber 3D | `Box` (atau `User`) |
| Vanish | `EyeOff` / `Eye` |
| Gesture V | `Hand` |
| Snap audio | `AudioWaveform` |
| Voice changer | `Mic` / `MicOff` |
| Mic monitor | `Headphones` |
| Output device | `Speaker` |
| Clean plate | `Image` / `ImagePlus` |
| Import VRM | `Upload` / `FileUp` |
| Performance | `Gauge`, `Cpu` |
| Virtual cam live | `Radio` |
| Peringatan / error / sukses | `TriangleAlert` / `CircleAlert` / `CircleCheck` |
| Pengaturan | `Settings2` |
Dilarang: `Sparkles`, `Wand2` sebagai simbol "magic AI", emoji, ikon raster.

## 3. Layout Responsif (mobile-first; uji 375 / 768 / 1024 / 1440)
Breakpoint Tailwind: default <768, `md` 768, `lg` 1024, `xl` 1440 (tambah `screens: { xl: '1440px' }` bila perlu).

| Lebar | Layout |
|---|---|
| **375** | 1 kolom. Header ringkas (logo + status ON AIR). `VideoStage` 16:9 penuh lebar di atas (sticky top). Kontrol di bawah dalam **tab bar bawah** (Mode · Vanish · Suara · Performa), satu panel tampil sekaligus. Tanpa scroll horizontal. Target ≥44px. HUD diringkas jadi satu baris chip (FPS · V-Sign · Snap). |
| **768** | 1 kolom lebar + panel kontrol 2 kolom grid (Mode/Filter | Vanish/Trigger). Voice Changer akordeon. HUD overlay di pojok stage. |
| **1024** | 2 kolom: stage (flex 1, min 560) + panel kanan tetap 360px (scroll internal). Header penuh. Tab bar bawah hilang → akordeon panel. |
| **1440** | 3 zona: rail kiri 72px (navigasi mode ikon+tooltip), stage tengah (max 960px, rasio 16:9), panel kanan 400px. Stage tidak melebihi 100vh − header; HUD penuh (mini-graph FPS & level meter snap). |
- Aplikasi Electron: `min-width: 375px` jendela; tidak ada elemen yang bergantung hover (hover hanya tambahan).
- Tidak ada scroll horizontal pada 320–1920px; uji reflow 400% zoom (WCAG 1.4.10).
- Stage video: `aspect-ratio: 16/9`, `object-fit: contain`, latar `#000` dengan hairline; selalu tampilkan **state kosong** (kamera belum diizinkan) dengan CTA jelas.

## 4. Blok Layar Utama (memetakan ke `src/components/`)
1. **Header**: logo-teks "PhantomCast", chip `Virtual Camera` (Radio + "Tersambung"/"Terputus"), chip `Mikrofon virtual`.
2. **VideoStage.tsx**: kanvas + overlay badge mode, tombol Vanish besar (primer), indikator cooldown 2 dtk (ring amber) & hold 500 ms (ring cyan mengisi) untuk pose V.
3. **ControlPanel.tsx**: (a) Mode pipeline segmented, (b) Pemicu Vanish (Gestur V / Jentik / Manual) + sensitivitas, Clean Plate, (c) Filter AR (Pixelate, Neon Visor, LUT Warm/Mono/Anime) sebagai kartu pilihan, (d) VTuber: dropzone `.vrm`/`.png`, pilih latar, (e) Voice Changer: preset (Normal, Vtuber Wanita, Anak-anak, Anonim Berat, Kustom), slider, device output, Mic Monitor.
4. **PerformanceHUD.tsx**: FPS (mono), CPU%, `V-Sign` hold meter, `Snap` level meter (bar `transform: scaleX`, bukan width). Warna ambang: ≤ target hijau, mendekati batas amber, melewati merah — **selalu + teks angka**.

State visual per komponen: default · hover (`--raised`) · active (translateY 1px) · selected (border cyan + glow-signal + ikon centang) · disabled · loading (skeleton, bukan spinner generik) · error.
Anti-pergeseran: tinggi kontrol tetap; jangan tampilkan nilai yang mengubah lebar baris (gunakan tabular-nums + lebar min).

## 5. Anti-Slop Microcopy (Bahasa Indonesia, `lang="id"`)
**Prinsip**: konkret, aktif, ≤ 8 kata per label, satu tindakan per tombol, sebut apa yang terjadi + nilai nyata. Nada: operator studio tenang, bukan marketing.

Larangan:
- Emoji, tanda seru beruntun, "✨ Magic", "Luar biasa!", "Ups!", "Oops", "Yay".
- Frasa kosong: "Nikmati pengalaman terbaik", "Revolusioner", "Powered by AI", "Seamless", "Unleash", "Tingkatkan produktivitas Anda", "Solusi canggih".
- Pesan error tanpa penyebab/tindakan: "Terjadi kesalahan", "Sesuatu salah".
- Label ambigu: "Submit", "OK", "Klik di sini", "Proses".
- Lorem ipsum / angka palsu (mis. "99.9%") / testimoni palsu.
- Menyebut "AI" bila hanya algoritma deterministik (FFT jentik, sudut jari).

Pola:
| Konteks | Tulis | Jangan |
|---|---|---|
| Tombol utama | `Hilang`, `Munculkan`, `Ambil latar kosong` | "Aktifkan Magic Vanish ✨" |
| Status Vanish | `Menghilang… 400 ms` → `Tersembunyi` | "Sedang memproses keajaiban" |
| Gestur V | `Tahan pose V 0,5 detik` · `Jeda 2 dtk sebelum bisa dipakai lagi` | "Tunjukkan pose ajaibmu!" |
| Jentik | `Jentik dua kali dalam 0,8 detik` · `Ketukan keyboard diabaikan` | "Snap untuk sihir" |
| Clean plate | `Diam selama 1 detik. Keluar dari frame dulu.` | "Bersiaplah!" |
| Izin kamera ditolak | `Kamera diblokir. Izinkan akses kamera di Pengaturan Windows › Privasi, lalu muat ulang.` | "Oops, kamera error" |
| Sidecar mati | `Kamera virtual terputus. Mencoba lagi dalam 3 dtk (2/5).` + tombol `Coba sekarang` | "Koneksi gagal" |
| VRM invalid | `Berkas bukan .vrm atau .png yang valid. Pilih berkas VRoid/Booth lain.` | "File tidak didukung" |
| Model belum ada | `Model deteksi tangan tidak ditemukan di public/models/. Aplikasi berjalan tanpa gestur.` | "Gagal memuat AI" |
| Mic monitor | `Dengar suara sendiri` + peringatan `Pakai headphone agar tidak berdengung.` | "Aktifkan monitor!" |
| FPS rendah | `FPS 18 di bawah target 30. Beralih ke mode hemat daya?` + `Beralih`/`Tetap` | "Performa buruk!" |
| Kosong | `Belum ada model. Seret berkas .vrm atau .png ke sini.` | "Tidak ada data" |
- Angka & satuan: pakai spasi + satuan jelas (`+5 semiton`, `Formant 1,15×`, `−42 dB`, `400 ms`); desimal koma (id-ID) di UI, titik di kode/IPC.
- Kapitalisasi kalimat biasa (sentence case); nama preset sesuai PRD: Normal, Wanita/VTuber, Anak-anak, Anonim/Berat.
- Konfirmasi hanya untuk aksi destruktif (hapus model); gunakan kata kerja yang sama dengan tombolnya ("Hapus model" / "Batal").
- Toast: ≤ 1 kalimat, hilang 5 dtk, `role=status`; error tetap sampai ditutup, `role=alert`.

## 6. Implementasi — Starter CSS (untuk dipasang engine-lead di `src/index.css`; BUKAN dibuat di sini)
```css
:root{
  --bg:#090C10;--panel:#10151E;--surface:#161D2A;--raised:#1D2636;--hairline:#222D40;--control-border:#64748B;
  --text:#F1F5F9;--text-muted:#94A3B8;--text-subtle:#7C8CA3;
  --signal:#00E5FF;--onair:#34D399;--warn:#FBBF24;--danger:#F87171;--on-signal:#04141A;--focus-ring:#67E8F9;
  --ease:cubic-bezier(.2,.8,.2,1);--dur-fast:120ms;--dur-base:200ms;--dur-slow:320ms;
  color-scheme: dark;
}
html{font-family:"Space Grotesk","Plus Jakarta Sans",Inter,system-ui,sans-serif;font-size:16px}
body{background:var(--bg);color:var(--text);line-height:1.5}
.num{font-family:"JetBrains Mono",Consolas,monospace;font-variant-numeric:tabular-nums}
button,[role=button],[role=switch],select,label[for],summary,a{cursor:pointer}
button:disabled,[aria-disabled=true]{cursor:not-allowed}
:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.glass{background:rgb(16 21 30/.72);backdrop-filter:blur(14px) saturate(1.2);border:1px solid rgb(148 163 184/.16)}
@supports not (backdrop-filter:blur(1px)){.glass{background:var(--panel)}}
```
Tailwind extend yang disarankan: `studio.raised '#1D2636'`, `studio.edge '#64748B'`, ubah `emerald '#34D399'`, `amber '#FBBF24'`, `danger '#F87171'`, `muted` tetap, tambah `studio.subtle '#7C8CA3'`, `studio.focus '#67E8F9'`. Latar `body` di `index.html` sudah selaras.

## 7. Checklist Pre-Delivery (QA gate)
- [ ] Tidak ada emoji / ikon non-Lucide (`rg "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" src`).
- [ ] Tidak ada hue ungu/indigo/violet; tidak ada `purple-`/`violet-`/`indigo-` di kelas Tailwind.
- [ ] Semua teks ≥4.5:1 (cek ulang bila warna baru ditambah); batas kontrol & ikon ≥3:1.
- [ ] `cursor:pointer` pada semua interaktif; `:focus-visible` terlihat pada setiap kontrol; urutan Tab logis.
- [ ] `prefers-reduced-motion` mematikan animasi chrome UI.
- [ ] Layout bersih tanpa scroll horizontal di 375 / 768 / 1024 / 1440.
- [ ] Font dimuat lokal (CSP), tanpa CDN.
- [ ] Hanya `opacity`/`transform` dianimasikan; HUD tidak menyebabkan re-layout per frame (update ≤ 4 Hz untuk teks, rAF hanya untuk meter `scaleX`).
- [ ] Microcopy lolos daftar larangan §5; semua string ber-bahasa Indonesia, satuan jelas.
