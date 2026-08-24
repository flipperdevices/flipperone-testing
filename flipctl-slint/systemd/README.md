# Running flipctl under a compositor

`flipctl-sway.service` puts `sway` on the SPI panel and flipctl inside it as a
Wayland client. Both files are installed by hand for now, at
`/etc/systemd/system/flipctl-sway.service` and `/etc/flipctl/sway.conf`; they move
into the image overlays once the shape settles.

Three details cost real time to find, so they are worth stating rather than
leaving in the file as bare directives:

- **`XDG_SEAT=seat1`.** The panel and the Flipper's buttons are tagged
  `ID_SEAT=seat1` by `72-seat-cog.rules`, and wlroots' libinput backend only takes
  devices on its own seat. Without this the compositor comes up on seat0, which is
  KDE's, and finds no buttons at all.
- **`XDG_SESSION_CLASS=user` and `XDG_SESSION_TYPE=wayland`.** logind refuses
  device control to a session of class `background`, with
  "Session class doesn't support taking device control", and `PAMName=login` alone
  produces exactly that class. cog never needed this because its DRM platform opens
  the card directly rather than through logind.
- **`WorkingDirectory`.** App discovery is relative to it; without it flipctl
  starts happily and reports `apps 0 found`.

The panel is addressed by path, never by card number, for the same reason the rest
of the stack does: numbers move between kernels.

Verified on a cold boot: `NRestarts=0`, sway holding master on the panel, KDE
untouched on HDMI, and flipctl's UI on the glass.
