#!/usr/bin/env python3
"""
PhantomCast Studio — Windows Virtual Camera Sidecar Bridge (ws://127.0.0.1:8765)
Receives raw 1280x720 RGBA binary frames from Electron/OffscreenCanvas over WebSocket,
slices alpha channel via NumPy (frame[:, :, :3]) into contiguous RGB24, and forwards
to Windows DirectShow / OBS Virtual Camera via pyvirtualcam.
"""

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
import time
from typing import Optional, Union

try:
    import numpy as np
except Exception:
    np = None  # type: ignore

try:
    import websockets
except Exception:
    websockets = None  # type: ignore

try:
    import pyvirtualcam
except Exception:
    pyvirtualcam = None  # type: ignore

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
FRAME_CHANNELS_RGBA = 4
EXPECTED_FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * FRAME_CHANNELS_RGBA  # 3,686,400 bytes

logging.basicConfig(
    level=logging.INFO,
    format="[virtual_bridge] %(asctime)s %(levelname)s: %(message)s",
)
logger = logging.getLogger("phantomcast.bridge")


def rgba_bytes_to_rgb24(
    raw_bytes: bytes,
    width: int = FRAME_WIDTH,
    height: int = FRAME_HEIGHT,
    out_buffer: Optional[object] = None,
) -> Union["np.ndarray", bytearray]:
    """
    Converts a raw RGBA buffer (width x height x 4) into a C-contiguous RGB24 buffer (height, width, 3)
    using NumPy slice frame[:, :, :3] as specified in the PRD, with a safe stdlib fallback if NumPy C-extensions
    are not yet compiled for the host Python version.
    """
    expected_len = width * height * 4
    if len(raw_bytes) != expected_len:
        raise ValueError(
            f"Ukuran buffer RGBA tidak sesuai: diterima {len(raw_bytes)} byte, target {expected_len} byte"
        )

    if np is not None:
        frame = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((height, width, 4))
        rgb_slice = frame[:, :, :3]

        if out_buffer is not None and hasattr(out_buffer, "shape") and out_buffer.shape == (height, width, 3):
            np.copyto(out_buffer, rgb_slice)
            return out_buffer

        return np.ascontiguousarray(rgb_slice)

    # Pure-stdlib memoryview fallback when NumPy binary wheel is unavailable on host Python
    rgb_len = width * height * 3
    rgb_bytes = bytearray(rgb_len)
    rgb_bytes[0::3] = raw_bytes[0::4]
    rgb_bytes[1::3] = raw_bytes[1::4]
    rgb_bytes[2::3] = raw_bytes[2::4]
    return rgb_bytes


class VirtualCameraBridgeServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765, fps: int = 30) -> None:
        self.host = host
        self.port = port
        self.fps = fps
        self.cam = None
        self.cam_device_name = "Simulated VirtualCam (Driver Standby)"
        self.rgb_buffer = (
            np.zeros((FRAME_HEIGHT, FRAME_WIDTH, 3), dtype=np.uint8) if np is not None else None
        )
        self.frames_processed = 0
        self.bad_frames = 0
        self.running = True
        self.active_client = None
        self._open_virtual_camera()

    def _open_virtual_camera(self) -> None:
        if pyvirtualcam is None or np is None:
            logger.warning(
                "Modul pyvirtualcam/numpy belum aktif penuh. Berjalan dalam mode sink RGB24 tanpa driver DirectShow."
            )
            return

        try:
            self.cam = pyvirtualcam.Camera(
                width=FRAME_WIDTH,
                height=FRAME_HEIGHT,
                fps=self.fps,
                fmt=pyvirtualcam.PixelFormat.RGB,
            )
            self.cam_device_name = str(getattr(self.cam, "device", "OBS Virtual Camera"))
            logger.info(
                "Virtual Camera aktif: %s (%dx%d @ %dfps)",
                self.cam_device_name,
                FRAME_WIDTH,
                FRAME_HEIGHT,
                self.fps,
            )
        except Exception as exc:
            self.cam = None
            logger.warning(
                "Driver Virtual Camera (OBS Virtual Camera) belum terdeteksi (%s). Bridge tetap menerima dan mengonversi frame RGB24.",
                exc,
            )

    def process_binary_frame(self, payload: bytes) -> bool:
        try:
            rgb24 = rgba_bytes_to_rgb24(
                payload,
                width=FRAME_WIDTH,
                height=FRAME_HEIGHT,
                out_buffer=self.rgb_buffer,
            )
            if self.cam is not None:
                self.cam.send(rgb24)
            self.frames_processed += 1
            return True
        except ValueError as err:
            self.bad_frames += 1
            if self.bad_frames <= 5 or self.bad_frames % 60 == 0:
                logger.warning("Frame ditolak: %s", err)
            return False
        except Exception as exc:
            logger.error("Gagal mengirim frame ke Virtual Camera: %s", exc)
            return False

    async def ws_handler(self, websocket) -> None:
        # Validate WebSocket Origin header against untrusted web pages
        req_headers = getattr(websocket, "request_headers", None) or getattr(
            getattr(websocket, "request", None), "headers", {}
        )
        origin = ""
        if req_headers and hasattr(req_headers, "get"):
            origin = str(req_headers.get("Origin", "") or req_headers.get("origin", ""))

        allowed_origins = (
            "",
            "app://phantomcast",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        )
        if origin and not any(origin.startswith(prefix) for prefix in allowed_origins if prefix):
            logger.warning("Menolak koneksi WebSocket dari Origin tidak dikenal: %s", origin)
            await websocket.close(1008, "Origin tidak diizinkan")
            return

        if self.active_client is not None and self.active_client != websocket:
            logger.warning("Menolak koneksi kedua (single-producer lock aktif)")
            await websocket.close(1008, "Producer sedang aktif")
            return

        self.active_client = websocket
        client_addr = getattr(websocket, "remote_address", ("127.0.0.1", 0))
        logger.info("Klien renderer terhubung dari %s", client_addr)

        await websocket.send(
            json.dumps(
                {
                    "type": "READY",
                    "width": FRAME_WIDTH,
                    "height": FRAME_HEIGHT,
                    "fps": self.fps,
                    "device": self.cam_device_name,
                    "driver_active": self.cam is not None,
                }
            )
        )

        last_stats_time = time.monotonic()

        try:
            async for message in websocket:
                if isinstance(message, (bytes, bytearray, memoryview)):
                    raw_bytes = bytes(message) if not isinstance(message, bytes) else message
                    self.process_binary_frame(raw_bytes)

                    now = time.monotonic()
                    if now - last_stats_time >= 1.0:
                        last_stats_time = now
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "STATS",
                                    "frames_processed": self.frames_processed,
                                    "bad_frames": self.bad_frames,
                                    "device": self.cam_device_name,
                                    "driver_active": self.cam is not None,
                                }
                            )
                        )
                elif isinstance(message, str):
                    try:
                        ctrl = json.loads(message)
                    except json.JSONDecodeError:
                        continue

                    msg_type = ctrl.get("type")
                    if msg_type == "HELLO":
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "READY",
                                    "width": FRAME_WIDTH,
                                    "height": FRAME_HEIGHT,
                                    "fps": self.fps,
                                    "device": self.cam_device_name,
                                    "driver_active": self.cam is not None,
                                }
                            )
                        )
                    elif msg_type == "PING":
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "PONG",
                                    "frames_processed": self.frames_processed,
                                }
                            )
                        )
                    elif msg_type == "BYE":
                        self.running = False
                        break
        except Exception as exc:
            logger.info("Koneksi WebSocket ditutup: %s", exc)
        finally:
            if self.active_client == websocket:
                self.active_client = None

    def close(self) -> None:
        self.running = False
        if self.cam is not None:
            try:
                self.cam.close()
            except Exception:
                pass
            self.cam = None


async def run_server(host: str, port: int, fps: int) -> None:
    if websockets is None:
        logger.error("Pustaka 'websockets' belum terinstal. Jalankan: pip install -r backend/requirements.txt")
        sys.exit(2)

    bridge = VirtualCameraBridgeServer(host=host, port=port, fps=fps)
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    async with websockets.serve(
        bridge.ws_handler,
        host,
        port,
        max_size=EXPECTED_FRAME_BYTES + 4096,
        max_queue=2,
        compression=None,
    ):
        ready_banner = json.dumps(
            {
                "status": "LISTENING",
                "host": host,
                "port": port,
                "device": bridge.cam_device_name,
                "driver_active": bridge.cam is not None,
            }
        )
        print(f"PHANTOM_BRIDGE_LISTENING {ready_banner}", flush=True)

        while bridge.running and not stop_event.is_set():
            await asyncio.sleep(0.25)

    bridge.close()


def run_self_test() -> int:
    """
    Validates RGBA (1280x720x4) -> RGB24 (720, 1280, 3) slice conversion.
    """
    pixel_RGBA = bytes([12, 229, 255, 128])
    raw_bytes = pixel_RGBA * (FRAME_WIDTH * FRAME_HEIGHT)
    rgb = rgba_bytes_to_rgb24(raw_bytes, FRAME_WIDTH, FRAME_HEIGHT)

    if np is not None and hasattr(rgb, "shape"):
        assert rgb.shape == (FRAME_HEIGHT, FRAME_WIDTH, 3), f"Invalid shape: {rgb.shape}"
        assert rgb.dtype == np.uint8, f"Invalid dtype: {rgb.dtype}"
        assert rgb.flags["C_CONTIGUOUS"], "Output RGB24 array must be C-contiguous"
        assert int(rgb[0, 0, 0]) == 12 and int(rgb[0, 0, 1]) == 229 and int(rgb[0, 0, 2]) == 255
    else:
        assert len(rgb) == FRAME_WIDTH * FRAME_HEIGHT * 3
        assert rgb[0] == 12 and rgb[1] == 229 and rgb[2] == 255

    print("VIRTUAL_BRIDGE_SELFTEST_OK", flush=True)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="PhantomCast Studio Virtual Camera Bridge")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port (default: 8765)")
    parser.add_argument("--fps", type=int, default=30, help="Target Virtual Camera FPS (default: 30)")
    parser.add_argument("--self-test", action="store_true", help="Run RGBA->RGB24 self-test and exit")
    args = parser.parse_args()

    if args.self_test:
        sys.exit(run_self_test())

    try:
        asyncio.run(run_server(args.host, args.port, args.fps))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
