# Enclosure and Physical Controls

The goal is for the assembled device to accept selected cables and modules,
allow use of controls, and show indicators.
Test fit, mounts, buttons, touchpad, and screen.
Use the [mechanical documentation](https://docs.flipper.net/one/mechanics/about)
and [module mounting system](https://docs.flipper.net/one/mechanics/module-mounting-system)
as sources.

## Configuration

Record revisions of the Main PCB, Control PCB, enclosure, rear cover,
and antenna rail, plus installed modules, cables, and assembly state.
Treat an open setup, DevKit, and enclosed device separately:
results depend on fit, cable routing, and heat dissipation.

## Initial checks

1. Assemble the selected combination according to documentation
   and check that parts are secured.
2. Insert reference USB, HDMI, Ethernet, and audio cables;
   check fit, connection retention, and access to adjacent ports.
3. Press each button and perform main touchpad gestures;
   check action availability and absence of mechanical sticking.
4. Install a supported M.2/GPIO module with the required cover and antenna rail;
   check fasteners, component height, and cable routing.
5. Check readability of the screen, Power Meter, port LEDs,
   and labels in intended positions of use.

## Extended coverage

Check repeated assembly and module replacement, SIM/microSD access,
controls obstructed by external modules, and antenna cable tension or pinching.
Assess form factor, connector keying, and electrical compatibility
together with [expansion](expansion.md).

Run thermal checks with recorded enclosure, cooling, load,
and external conditions using the [power method](power.md).
A result with an external fan applies to that configuration.

Criteria for actuation force, retention, button endurance,
and assembly cycles: TBD.
Record observed failures with conditions; take numerical limits
from requirements for the relevant revision.

## Evidence

Retain part identifiers, assembly photos, cable and module models,
failure observations, and measurements where criteria exist.
Link software input failures to [user input](applications-ui.md)
and mechanical causes to [Mechanics Issues](https://github.com/flipperdevices/flipperone-mechanics/issues).
An event injected through CLI does not verify a physical control.
