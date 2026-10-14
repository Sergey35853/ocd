#!/usr/bin/env python3
"""Voice helper for OCD: text-to-speech and speech-to-text.

Every sub-command prints a single JSON object on stdout so the Electron
main process can parse it without guessing. Failures come back as
{"ok": false, "error": "..."} instead of a traceback.

Usage:
    python voice.py tts     --text-file F --out F.mp3 [--engine edge|sapi] [--voice ...]
    python voice.py stt     --file F.wav [--model small] [--language ru|auto]
    python voice.py dictate --out F.wav [--model small] [--language ru] [--max-seconds 120]
    python voice.py devices
    python voice.py voices

`dictate` records until stdin receives a line, then transcribes and prints
{"ok": true, "text": ...}. Closing stdin without a line cancels the take.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def force_utf8_stdio() -> None:
    """Windows consoles default to a legacy code page; force UTF-8 output."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def fail(message: str) -> None:
    emit({"ok": False, "error": message})


# --------------------------------------------------------------------------- tts

EDGE_VOICE_RE = re.compile(r"^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$")


async def tts_edge(args: argparse.Namespace, text: str, out: Path) -> dict:
    import edge_tts  # imported lazily so sapi still works without it

    voice = args.voice or "ru-RU-SvetlanaNeural"
    kwargs = {"text": text, "voice": voice}
    if args.rate:
        kwargs["rate"] = args.rate
    if args.volume:
        kwargs["volume"] = args.volume
    if args.pitch:
        kwargs["pitch"] = args.pitch

    communicate = edge_tts.Communicate(**kwargs)
    await communicate.save(str(out))
    return {"engine": "edge", "voice": voice, "file": str(out)}


def tts_sapi(args: argparse.Namespace, text: str, out: Path) -> dict:
    """Offline fallback using the Windows SAPI voice through PowerShell."""
    wav = out.with_suffix(".wav")
    text_file = out.with_suffix(".txt")
    text_file.write_text(text, encoding="utf-8")

    script = TEMPLATE_SAPI.replace("__VOICE__", (args.voice or "").replace("'", "''"))
    script_file = out.with_suffix(".ps1")
    script_file.write_text(script, encoding="utf-8-sig")

    errors: list = []
    for shell in ("powershell", "pwsh"):
        exe = shutil.which(shell)
        if not exe:
            errors.append(f"{shell}: not found")
            continue
        try:
            proc = subprocess.run(
                [
                    exe,
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(script_file),
                    "-TextFile",
                    str(text_file),
                    "-Out",
                    str(wav),
                    "-Voice",
                    args.voice or "",
                ],
                capture_output=True,
                timeout=180,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            errors.append(f"{shell}: {exc}")
            continue
        if proc.returncode == 0 and wav.exists() and wav.stat().st_size > 44:
            return {
                "engine": "sapi",
                "voice": proc.stdout.decode("utf-8", "replace").strip(),
                "file": str(wav),
            }
        errors.append(
            f"{shell}: {proc.stderr.decode('utf-8', 'replace').strip() or f'exit {proc.returncode}'}"
        )
    raise RuntimeError("; ".join(errors))


# --------------------------------------------------------------------------- stt

_MODEL_CACHE: dict = {}


def load_model(name: str):
    if name not in _MODEL_CACHE:
        from faster_whisper import WhisperModel

        # cpu + int8 keeps latency low on a desktop CPU.
        _MODEL_CACHE[name] = WhisperModel(name, device="cpu", compute_type="int8")
    return _MODEL_CACHE[name]


def transcribe(path: Path, model_name: str, language: str) -> dict:
    model = load_model(model_name)
    segments, info = model.transcribe(
        str(path),
        language=None if language in ("", "auto", None) else language,
        vad_filter=True,
        beam_size=1,
    )
    parts = [segment.text.strip() for segment in segments if segment.text.strip()]
    return {
        "text": " ".join(parts).strip(),
        "lang": getattr(info, "language", "") or "",
        "duration": round(float(getattr(info, "duration", 0.0) or 0.0), 2),
    }


def record_until_stopped(
    out: Path, device: str, max_seconds: float, model_name: str, language: str
) -> None:
    """Record 16 kHz mono PCM until stdin receives a line, then emit JSON.

    Node starts this as a long-lived child: writing "stop\\n" ends the capture
    and returns the transcript, closing stdin discards it.
    """
    import numpy as np
    import sounddevice as sd

    # Explicit stop arrives as a stdin line; stdin EOF means "cancel".
    stop_event = threading.Event()
    cancelled = threading.Event()

    def watch_stdin() -> None:
        try:
            for line in sys.stdin:
                if line.strip():
                    stop_event.set()
                    return
        except Exception:
            pass
        cancelled.set()
        stop_event.set()

    threading.Thread(target=watch_stdin, daemon=True).start()

    rate = 16000
    frames: list = []

    def callback(indata, _frames, _time_info, status):  # noqa: ANN001
        if status:
            print(f"warn: {status}", file=sys.stderr)
        # RawInputStream hands over a cffi buffer, which has no .copy().
        frames.append(bytes(indata))

    # sounddevice treats a bare number as a name; indexes must be ints.
    if device and device.strip().isdigit():
        device_arg: object = int(device.strip())
    else:
        device_arg = device if device else None

    try:
        with sd.RawInputStream(
            samplerate=rate,
            blocksize=1600,
            dtype="int16",
            channels=1,
            callback=callback,
            device=device_arg,
        ):
            deadline = time.time() + max_seconds if max_seconds > 0 else None
            while not stop_event.is_set():
                stop_event.wait(0.1)
                if deadline and time.time() >= deadline:
                    break
    except Exception as exc:
        fail(f"recording failed: {exc}")
        return

    if cancelled.is_set():
        fail("cancelled")
        return

    if not frames:
        fail("no audio captured")
        return

    data = np.frombuffer(b"".join(frames), dtype=np.int16)
    seconds = len(data) / rate
    if seconds < 0.3:
        fail("recording too short")
        return

    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(data.tobytes())

    emit({"ok": True, "stage": "recorded", "file": str(out), "seconds": round(seconds, 2)})

    try:
        result = transcribe(out, model_name, language)
    except Exception as exc:
        fail(f"transcription failed: {exc}")
        return
    result["ok"] = True
    result["seconds"] = round(seconds, 2)
    emit(result)


# --------------------------------------------------------------------------- probes

def list_devices() -> dict:
    try:
        import sounddevice as sd
    except Exception as exc:  # pragma: no cover - depends on host
        return {"ok": False, "error": f"sounddevice unavailable: {exc}"}
    devices = []
    try:
        for index, device in enumerate(sd.query_devices()):
            if int(device.get("max_input_channels", 0)) <= 0:
                continue
            devices.append({"index": index, "name": device.get("name", "")})
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    try:
        default = sd.default.device[0]
    except Exception:
        default = None
    return {"ok": True, "devices": devices, "default": default}


async def list_voices() -> dict:
    try:
        import edge_tts
    except Exception as exc:
        return {"ok": False, "error": f"edge-tts unavailable: {exc}"}
    voices = []
    try:
        for item in await edge_tts.list_voices():
            if EDGE_VOICE_RE.match(item.get("ShortName", "")):
                voices.append(
                    {
                        "id": item.get("ShortName"),
                        "name": item.get("FriendlyName") or item.get("ShortName"),
                        "gender": item.get("Gender"),
                        "locale": item.get("Locale"),
                    }
                )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "voices": voices}


# --------------------------------------------------------------------------- cli

TEMPLATE_SAPI = r'''
param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Voice = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
if ([string]::IsNullOrWhiteSpace($text)) { exit 1 }
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$wanted = "__VOICE__"
if (-not [string]::IsNullOrWhiteSpace($wanted)) {
  $installed = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
  if ($installed -contains $wanted) { $synth.SelectVoice($wanted) }
  else { $wanted = "" }
}
if ([string]::IsNullOrWhiteSpace($wanted)) {
  $female = @($synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Gender -eq "Female" } | ForEach-Object { $_.VoiceInfo.Name })
  if ($female.Count -gt 0) { $synth.SelectVoice($female[0]) }
}
$synth.SetOutputToWaveFile($Out)
$synth.Speak($text)
$synth.SetOutputToNull()
$synth.Dispose()
Write-Output $synth.Voice.Name
'''


def sanitize(text: str, limit: int) -> str:
    """Strip markdown noise that sounds wrong when read aloud."""
    text = re.sub(r"```[\s\S]*?```", " блок кода ", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"^[#>\-\*\+]{1,}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~]{1,3}", "", text)
    text = re.sub(r"\n{2,}", ". ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    if limit and len(text) > limit:
        text = text[:limit].rsplit(".", 1)[0] + "."
    return text.strip()


def cmd_tts(args: argparse.Namespace) -> None:
    text = Path(args.text_file).read_text(encoding="utf-8")
    text = sanitize(text, args.max_chars)
    if not text:
        emit({"ok": True, "skipped": True, "reason": "empty"})
        return
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    order = ["edge", "sapi"] if args.engine == "auto" else [args.engine]
    errors = []
    for engine in order:
        try:
            if engine == "edge":
                result = asyncio.run(tts_edge(args, text, out))
            else:
                result = tts_sapi(args, text, out)
            result["ok"] = True
            emit(result)
            return
        except Exception as exc:
            errors.append(f"{engine}: {exc}")
    fail("; ".join(errors) or "no tts engine available")


def cmd_stt(args: argparse.Namespace) -> None:
    path = Path(args.file)
    if not path.exists():
        fail(f"audio file missing: {path}")
        return
    try:
        result = transcribe(path, args.model, args.language)
    except Exception as exc:
        fail(f"transcription failed: {exc}")
        return
    result["ok"] = True
    emit(result)


def main() -> None:
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    force_utf8_stdio()
    parser = argparse.ArgumentParser(add_help=True)
    sub = parser.add_subparsers(dest="command", required=True)

    p_tts = sub.add_parser("tts")
    p_tts.add_argument("--text-file", required=True)
    p_tts.add_argument("--out", required=True)
    p_tts.add_argument("--engine", default="auto", choices=["auto", "edge", "sapi"])
    p_tts.add_argument("--voice", default="")
    p_tts.add_argument("--rate", default="")
    p_tts.add_argument("--volume", default="")
    p_tts.add_argument("--pitch", default="")
    p_tts.add_argument("--max-chars", type=int, default=420)
    p_tts.set_defaults(func=cmd_tts)

    p_stt = sub.add_parser("stt")
    p_stt.add_argument("--file", required=True)
    p_stt.add_argument("--model", default="small")
    p_stt.add_argument("--language", default="auto")
    p_stt.set_defaults(func=cmd_stt)

    p_dict = sub.add_parser("dictate")
    p_dict.add_argument("--out", required=True)
    p_dict.add_argument("--device", default="")
    p_dict.add_argument("--model", default="small")
    p_dict.add_argument("--language", default="auto")
    p_dict.add_argument("--max-seconds", type=float, default=120.0)
    p_dict.set_defaults(
        func=lambda a: record_until_stopped(
            Path(a.out), a.device, a.max_seconds, a.model, a.language
        )
    )

    p_dev = sub.add_parser("devices")
    p_dev.set_defaults(func=lambda _a: emit(list_devices()))

    p_voices = sub.add_parser("voices")
    p_voices.set_defaults(func=lambda _a: emit(asyncio.run(list_voices())))

    args = parser.parse_args()
    try:
        args.func(args)
    except SystemExit:
        raise
    except Exception as exc:  # last-resort guard
        fail(str(exc))


if __name__ == "__main__":
    main()