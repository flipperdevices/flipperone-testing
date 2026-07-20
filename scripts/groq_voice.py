#!/usr/bin/env python3
"""Voice Assistant backend: send a recorded WAV to Groq.

Transcribes the clip with Groq's Whisper endpoint and (optionally) asks a Groq
chat model for an assistant reply, then prints a single JSON object on stdout:

    {"ok": true, "transcript": "...", "reply": "..."}
    {"ok": false, "error": "..."}

The Groq API key and models come from an `llm.conf` file (simple KEY=VALUE):

    GROQ_API_KEY=gsk_...
    STT_MODEL=whisper-large-v3
    CHAT_MODEL=llama-3.3-70b-versatile   # or "none" to skip the reply
    SYSTEM_PROMPT=You are a helpful voice assistant...

Usage:
    groq_voice.py --conf /path/to/llm.conf /path/to/clip.wav
"""

import argparse
import json
import os
import sys


# Set once args are parsed; changes fail()/output framing to NDJSON events.
STREAM = False


def emit(obj):
    """Print one JSON object as a line and flush (so the server sees it live)."""
    print(json.dumps(obj), flush=True)


def fail(msg):
    """Emit an error and exit 0 so the caller always gets parseable output.

    In stream mode this is a `{"type":"error"}` event; otherwise the batch
    `{"ok":false}` shape.
    """
    emit({"type": "error", "error": str(msg)} if STREAM else {"ok": False, "error": str(msg)})
    sys.exit(0)


def load_conf(path):
    conf = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                conf[key.strip()] = val.strip().strip('"').strip("'")
    except FileNotFoundError:
        fail(f"config not found: {path}")
    except OSError as exc:
        fail(f"cannot read config {path}: {exc}")
    return conf


def main():
    ap = argparse.ArgumentParser(description="Send a WAV clip to Groq.")
    ap.add_argument("wav", help="path to the recorded WAV file")
    ap.add_argument(
        "--conf",
        default=os.environ.get("FLIPCTL_LLM_CONF", "llm.conf"),
        help="path to llm.conf (KEY=VALUE)",
    )
    ap.add_argument(
        "--stream",
        action="store_true",
        help="emit newline-delimited events (transcript/delta/done) as they arrive",
    )
    args = ap.parse_args()
    global STREAM
    STREAM = args.stream

    if not os.path.isfile(args.wav):
        fail(f"recording not found: {args.wav}")
    if os.path.getsize(args.wav) < 1024:
        fail("recording too short")

    conf = load_conf(args.conf)
    api_key = conf.get("GROQ_API_KEY", "").strip()
    if not api_key:
        fail("GROQ_API_KEY missing in llm.conf")

    stt_model = conf.get("STT_MODEL", "whisper-large-v3")
    chat_model = conf.get("CHAT_MODEL", "llama-3.3-70b-versatile")
    system_prompt = conf.get(
        "SYSTEM_PROMPT",
        "You are a helpful voice assistant on a Flipper One handheld. "
        "Answer in one or two short sentences.",
    )

    try:
        from groq import Groq
    except ImportError:
        fail("the 'groq' package is not installed (pip install -r requirements.txt)")

    client = Groq(api_key=api_key)

    # --- speech to text ---
    try:
        with open(args.wav, "rb") as fh:
            tr = client.audio.transcriptions.create(
                file=(os.path.basename(args.wav), fh.read()),
                model=stt_model,
            )
        transcript = (getattr(tr, "text", "") or "").strip()
    except Exception as exc:  # noqa: BLE001 - surface any API/network error as JSON
        fail(f"transcription failed: {exc}")

    reply_disabled = not chat_model or chat_model.lower() == "none"
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": transcript},
    ]

    # ── streaming mode: transcript, then reply tokens as they arrive ──
    if STREAM:
        emit({"type": "transcript", "text": transcript})
        if not transcript or reply_disabled:
            emit({"type": "done"})
            return
        try:
            stream = client.chat.completions.create(
                model=chat_model,
                messages=messages,
                max_tokens=200,
                temperature=0.5,
                stream=True,
            )
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    emit({"type": "delta", "text": delta})
            emit({"type": "done"})
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "error": f"chat failed: {exc}"})
        return

    # ── batch mode (single JSON) ──
    if not transcript:
        emit({"ok": True, "transcript": "", "reply": ""})
        return
    reply = ""
    if not reply_disabled:
        try:
            chat = client.chat.completions.create(
                model=chat_model, messages=messages, max_tokens=200, temperature=0.5,
            )
            reply = (chat.choices[0].message.content or "").strip()
        except Exception as exc:  # noqa: BLE001
            emit({"ok": True, "transcript": transcript, "reply": "", "error": f"chat failed: {exc}"})
            return
    emit({"ok": True, "transcript": transcript, "reply": reply})


if __name__ == "__main__":
    main()
