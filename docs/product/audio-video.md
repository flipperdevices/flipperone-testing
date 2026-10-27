# Audio, Video, and Displays

The goal is for users to receive physical image and sound on the selected output,
control playback, and continue after reconnection.
Test recording, processing, and routing through a specific path.

## Initial checks

1. Record profile, kernel, Device Tree, video output, display,
   audio device, cable, and reference media.
2. Check the negotiated mode and actual image.
3. Check recording and physical audio output.
4. Play the media; check synchronization and control.
5. Pause, resume, seek, and reconnect;
   verify routing and control recover.

## Video path and processing

Test HDMI and USB-C DisplayPort separately and in declared combinations.
The maximum mode depends on the video port and Device Tree.
Build the matrix from the [RK3576 video output description](https://docs.flipper.net/one/hardware/rk3576/video-output)
and candidate configuration.
A SoC's maximum capability does not establish simultaneous availability
on every output.

For No Graphics, verify the specified absence of video output.
For GPU testing, use a reference scene.
For decoding, use media with known codec, profile, bit depth, resolution,
frame rate, and bitrate.
Record the decoder and hardware processing path.
Do not use a transcoded sample as a reference until its parameters are verified.

Reference media catalog and common quality limits: TBD.

## TV Media Box

Following [Watching a movie on TV](https://docs.flipper.net/one/testing/user-stories/watching-movie),
check Kodi launch, TV connection before and after boot,
displayed output and mode, settings changes,
and control through CEC or the device.

For the accepted scenario version, check 2.5 hours of continuous movie playback
and a TV notification below 20% battery.
Track the desired 3.5 hours separately from the minimum expected duration.
The plan records revision, media, brightness, peripherals, and battery state.
Storage and charge indication are covered in [power](power.md).

Add output switching, unavailable sources, extended operation,
and TV/CEC setups with different models and settings.
An accepted revision limitation does not change a failed check's result.

## Evidence

Retain the media identifier, parameters, decoder, settings,
receiver details, physical output, dropped frames,
synchronization, and recovery.
Distinguish observation from numerical measurement.
Compare earlier results only when their conditions and versions are known.

The OS profile is covered in [Linux profiles](linux/profiles.md),
and user actions in [input testing](applications-ui.md).
