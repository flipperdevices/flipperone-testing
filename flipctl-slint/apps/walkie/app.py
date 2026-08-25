#!/usr/bin/env python3
"""The walkie-talkie, ported from the flipctl2 mockup to a Wayland client.

The original was a scene in the node UI: two full-screen images swapped by the PTT
key, three signal-level bars animated from a hand-authored timeline, and a clip the
server looped through sox. It never recorded anything. This keeps its art, its
geometry and its clip, and replaces the two parts that were pretending:

  * the receive bar is a real VU meter. A capture stream on the speaker's monitor
    reports what is actually leaving the codec, so the bar follows the clip, the
    playback of your own recording, or anything else that plays, rather than a table
    of times. While transmitting it meters the microphone instead, which is the level
    that matters when you are the one talking;
  * holding PTT records from the microphone and releases play it back, which is what
    a walkie-talkie does and what the mockup left out. The incoming clip stops while
    transmitting, as it would on a half-duplex radio.

The top 13 pixels are flipctl's. The art has a drawing of a status bar; the manifest
asks for the real one, and flipctl paints it over every frame with the clock, the
battery and the radios. An app has no way of knowing any of that, so it does not try.

Audio is a socket, not a device: flipctl links PipeWire's sockets into this app's
runtime directory and pins it to the panel's speaker, so `aplay` and `arecord` reach
the codec while the desktop keeps HDMI. Both come from alsa-utils and go through the
ALSA plugin PipeWire ships, so there is no library to bind to.

Keys: PTT (the `a` key) transmits while held, the pad's up and down move the volume.
Back and the app switcher never arrive here, because the compositor keeps them for
flipctl.
"""
import json
import math
import os
import subprocess
import signal
import sys
import time

from PyQt6.QtCore import Qt, QRect, QTimer
from PyQt6.QtGui import QColor, QImage, QPainter
from PyQt6.QtWidgets import QApplication, QWidget

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
PANEL = (256, 144)

# The mockup's own geometry, kept so the art still lines up with what is drawn over it.
RX_BAR = QRect(63, 29, 3, 85)
VOL_CHIP = QRect(197, 5, 11, 83)
RECORDING = "/tmp/walkie-ptt.wav"
CLICK_MS = 100
# What the meter listens to. The sink's own name captures its monitor, so the bar shows
# what is leaving the speaker; the source is the microphone, for when we are the one
# talking.
SPEAKER = os.environ.get("PULSE_SINK", "alsa_output.platform-sound.stereo-fallback")
MICROPHONE = SPEAKER.replace("alsa_output", "alsa_input")
# The panel commits at about 62 fps, so the meter runs at the same pace: a bar that
# updates slower than the screen is a bar that stutters for no reason.
TICK_MS = 16
# VU ballistics: near-instant attack, and a decay slow enough that the bar reads as a
# level rather than a flicker. Per tick, so it is a rate rather than a number: about
# 190 a second, which empties the bar in half a second of silence.
DECAY_PER_TICK = 3


def rms_to_level(peak):
    """A sample peak as a bar height, 0..100.

    Logarithmic, because loudness is: a linear bar spends most of its travel in the
    top few decibels and reads as either full or empty. -40dB is the floor, which is
    quiet enough to sit still between words.
    """
    if peak <= 0:
        return 0
    db = 20 * math.log10(min(1.0, peak / 32767))
    if db <= -40:
        return 0
    return int((db + 40) * 100 / 40)


class Walkie(QWidget):
    def __init__(self):
        super().__init__()
        self.setFixedSize(*PANEL)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

        self.idle = QImage(os.path.join(ASSETS, "idle.png"))
        self.pressed = QImage(os.path.join(ASSETS, "pressed.png"))
        self.clip = os.path.join(ASSETS, "415_audio.wav")

        self.volume = 60
        self._sink_id = None
        self.transmitting = False
        self.player = None
        self.recorder = None
        self.playing_back = False
        self.meter = None
        self.meter_target = None
        self.shown_level = 0
        self.pending_record = None

        self.receive()
        self.tick = QTimer(self)
        self.tick.timeout.connect(self.step)
        self.tick.start(TICK_MS)

    # ── audio ────────────────────────────────────────────────────────────────────

    def receive(self):
        """Start the incoming clip, looping for as long as nobody is transmitting."""
        self.stop_player()
        self.player = self.play(self.clip)

    def play(self, path):
        return subprocess.Popen(
            ["aplay", "-q", path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def stop_player(self):
        if self.player and self.player.poll() is None:
            self.player.terminate()
        self.player = None

    def start_recording(self):
        # Half duplex, like the radio it imitates: what is coming in stops while the
        # microphone is open.
        self.stop_player()
        # After the click, not through it.
        self.pending_record = QTimer(self)
        self.pending_record.setSingleShot(True)
        self.pending_record.timeout.connect(self.open_microphone)
        self.pending_record.start(CLICK_MS)

    def open_microphone(self):
        if not self.transmitting:
            print("walkie: ptt let go before the click passed", file=sys.stderr, flush=True)
            return
        # Pointed at the microphone, not at the speaker. flipctl pins the app to the
        # sink through PIPEWIRE_NODE, which is right for playback and wrong for a
        # capture client: arecord inherited it and asked an output for input.
        self.recorder = subprocess.Popen(
            ["arecord", "-q", "-f", "S16_LE", "-r", "48000", "-c", "1", RECORDING],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env={**os.environ, "PIPEWIRE_NODE": MICROPHONE},
        )
        print(f"walkie: recording from {MICROPHONE}", file=sys.stderr, flush=True)

    def stop_recording(self):
        if self.pending_record:
            self.pending_record.stop()
            self.pending_record = None
        held = self.recorder
        self.recorder = None
        if held and held.poll() is None:
            # Interrupt rather than kill: arecord writes its header size on the way
            # out, and a file with a zero-length header plays as nothing.
            held.send_signal(signal.SIGINT)
            try:
                held.wait(timeout=2)
            except subprocess.TimeoutExpired:
                held.kill()
        if held:
            trouble = (held.stderr.read() or b"").decode(errors="replace").strip()
            if trouble:
                print(f"walkie: arecord said {trouble}", file=sys.stderr, flush=True)
        size = os.path.getsize(RECORDING) if os.path.exists(RECORDING) else 0
        # Play back what was said, then go back to listening. A quarter second is the
        # floor: shorter than that is the button, not a word.
        if size > 48000 // 2:
            print(f"walkie: playing back {size} bytes", file=sys.stderr, flush=True)
            self.player = subprocess.Popen(
                ["aplay", RECORDING], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            self.playing_back = True
        else:
            print(f"walkie: nothing to play back ({size} bytes)", file=sys.stderr, flush=True)
            self.receive()

    def sink_id(self):
        """The pinned sink's PipeWire id, looked up once by name.

        By name because card numbers move between kernels and ids move between boots;
        wpctl wants an id, so the name is resolved to one here. amixer would be the
        other way, and the way the mockup did it, but a hosted app has no access to
        /dev/snd and does not need any: this is the sink flipctl pinned it to.
        """
        if self._sink_id is not None:
            return self._sink_id
        name = os.environ.get("PULSE_SINK", "")
        if not name:
            return None
        try:
            dump = subprocess.run(
                ["pw-dump"], capture_output=True, text=True, timeout=4, check=False
            ).stdout
            for node in json.loads(dump):
                props = (node.get("info") or {}).get("props") or {}
                if props.get("node.name") == name:
                    self._sink_id = node.get("id")
                    break
        except (OSError, ValueError, subprocess.SubprocessError):
            self._sink_id = None
        return self._sink_id

    def volume_by(self, delta):
        self.volume = max(0, min(100, self.volume + delta))
        target = self.sink_id()
        if target is None:
            return
        # The panel's speaker, not the desktop's output: this is the sink flipctl pinned
        # this app to, so turning it down cannot quiet a film on the television.
        subprocess.run(
            ["wpctl", "set-volume", str(target), f"{self.volume / 100:.2f}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )

    def listen_to(self, target):
        """Point the meter at a node, restarting it if that is a change.

        One capture stream at a time: the bar shows either what is going out or what
        is coming in, and which of those matters is exactly the PTT state.
        """
        if target == self.meter_target and self.meter and self.meter.poll() is None:
            return
        self.stop_meter()
        self.meter_target = target
        # Metering an output means capturing its monitor, and that takes saying so:
        # `--target <sink>` on its own is not an error, it quietly falls back to the
        # default source, so the bar was showing the microphone the whole time while
        # the speaker played. `stream.capture.sink` is what asks for the monitor.
        monitor = target == SPEAKER
        self.meter = subprocess.Popen(
            [
                "pw-record",
                "--target",
                target,
            ]
            + (["-P", "{ stream.capture.sink=true }"] if monitor else [])
            + [
                "--format",
                "s16",
                "--rate",
                "48000",
                "--channels",
                "1",
                "-",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "PIPEWIRE_NODE": target},
        )
        os.set_blocking(self.meter.stdout.fileno(), False)

    def stop_meter(self):
        if self.meter and self.meter.poll() is None:
            self.meter.terminate()
        self.meter = None
        self.meter_target = None

    def measure(self):
        """Whatever the meter has heard since the last tick, as a bar height."""
        if not self.meter:
            return 0
        if self.meter.poll() is not None:
            print(
                f"walkie: meter on {self.meter_target} exited {self.meter.returncode}",
                file=sys.stderr,
                flush=True,
            )
            self.meter = None
            self.meter_target = None
            return 0
        try:
            # A tick's worth at most: reading everything available would let a backlog
            # show a level from a second ago.
            chunk = self.meter.stdout.read(48000 * 2 * TICK_MS // 1000)
        except (BlockingIOError, ValueError):
            return 0
        if not chunk:
            return 0
        samples = memoryview(chunk[: len(chunk) // 2 * 2]).cast("h")
        peak = 0
        for value in samples:
            magnitude = value if value >= 0 else -value
            if magnitude > peak:
                peak = magnitude
        return rms_to_level(peak)

    # ── state ────────────────────────────────────────────────────────────────────

    def step(self):
        # The meter follows the direction of the conversation.
        self.listen_to(MICROPHONE if self.transmitting else SPEAKER)
        heard = self.measure()
        self.shown_level = (
            heard if heard >= self.shown_level else max(0, self.shown_level - DECAY_PER_TICK)
        )
        if self.playing_back and self.player and self.player.poll() is not None:
            self.playing_back = False
            self.receive()
        elif not self.transmitting and not self.playing_back:
            if self.player is None or self.player.poll() is not None:
                self.receive()
        self.update()

    def level(self):
        """The bar's height, 0..100, as measured rather than as scheduled."""
        return self.shown_level

    # ── drawing ──────────────────────────────────────────────────────────────────

    def paintEvent(self, _):
        frame = QImage(*PANEL, QImage.Format.Format_RGB32)
        painter = QPainter(frame)
        art = self.pressed if self.transmitting else self.idle
        painter.drawImage(0, 0, art)

        black = QColor(0, 0, 0)
        level = self.level()
        if level > 0:
            height = round(level * RX_BAR.height() / 100)
            painter.fillRect(
                RX_BAR.x(),
                RX_BAR.y() + RX_BAR.height() - height,
                RX_BAR.width(),
                height,
                black,
            )

        # The volume chip: a grey trough with a black fill from the bottom, as the
        # mockup drew it.
        painter.fillRect(VOL_CHIP, QColor(229, 229, 229))
        filled = round(self.volume * VOL_CHIP.height() / 100)
        if filled > 0:
            painter.fillRect(
                VOL_CHIP.x(),
                VOL_CHIP.y() + VOL_CHIP.height() - filled,
                VOL_CHIP.width(),
                filled,
                black,
            )
        painter.end()

        # Two colours, like the panel: a threshold rather than the greys Qt would
        # otherwise leave in the art's edges.
        binary = frame.convertToFormat(
            QImage.Format.Format_Mono, Qt.ImageConversionFlag.ThresholdDither
        )
        out = QPainter(self)
        out.drawImage(0, 0, binary)
        out.end()

    # ── keys ─────────────────────────────────────────────────────────────────────

    def keyPressEvent(self, event):
        # Auto-repeat is ignored on purpose. A held button arrives as a stream of
        # press and release pairs, which Qt marks as repeats, so the first real press
        # and the last real release are the transmission's edges.
        if event.key() == Qt.Key.Key_A and not event.isAutoRepeat():
            self.transmitting = True
            self.start_recording()
        elif event.key() == Qt.Key.Key_Up:
            self.volume_by(+10)
        elif event.key() == Qt.Key.Key_Down:
            self.volume_by(-10)
        self.update()

    def keyReleaseEvent(self, event):
        if event.key() == Qt.Key.Key_A and not event.isAutoRepeat():
            self.transmitting = False
            self.stop_recording()
        self.update()

    def closeEvent(self, event):
        self.stop_meter()
        self.stop_player()
        if self.recorder and self.recorder.poll() is None:
            self.recorder.terminate()
        event.accept()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = Walkie()
    # Fullscreen rather than shown: a window is a window, and the compositor gives it
    # the whole output only when it asks. Belt and braces with the launcher's
    # QT_WAYLAND_DISABLE_WINDOWDECORATION, since a frame drawn by the client would eat
    # a seventh of a 144 pixel panel.
    window.showFullScreen()
    sys.exit(app.exec())
