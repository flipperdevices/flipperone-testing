# FlipCTL

The goal is for users to see device state, perform system actions,
and return from applications to device control.
The UI must match actual system state.
Test system services, UI, rendering, and application management.
The [overview](https://docs.flipper.net/one/cpu-software/flipctl) defines
architecture goals; application requirements and candidate content
define the implementation under test.

## Scope

Record the FlipCTL version, implementation, and display path,
Linux, MCU, revision, and OS profile.
Results from WebKit/HTML, Slint, and browser paths are not interchangeable.
Record which components run on the device and which the setup simulates.

| Part | Checks |
| --- | --- |
| Services and API | Startup, readiness, permissions, responses, and dependency failures |
| System actions | Actual Linux state changes and displayed success or failure |
| Rendering and input | Screen, navigation, focus, state updates, and recovery |
| Applications | Catalog, launch, switching, cancellation, and exit |
| Resources | Settings, memory, CPU, processes, and service connections |
| MCU communication | Events, connection loss, reconnection, and restart of either side |

## Initial checks

1. After boot, verify service and UI readiness.
2. Navigate and compare displayed state with the system.
3. Change a setting or perform an action; verify its actual effect,
   permissions, and persistence where required.
4. Launch an application, perform its main action, exit,
   and verify control returns.
5. Restart the service; check settings, control, and resource release.

## Extended coverage

Check unavailable system services, access denial, connection loss,
and repeated operations.
The UI must show actual state and the specified way to continue.

For [5G Modem](cellular.md), check ModemManager and NetworkManager integration,
SIM state, and radio state.
For [App Manager](applications-ui.md), check the catalog, installation,
and application lifecycle.
Assess FlipCTL-based Boot Menu behavior in [boot testing](linux/boot-recovery.md).

Treat browser, headless rendering, and the built-in display
as separate observation paths.
CLI/RPC events check software processing;
test buttons, the touchpad, and the physical screen on the device.

## Evidence

Retain versions, display path, state before and after actions,
service logs, and UI images.
Compare visible confirmation with the system effect.
A prototype or simulated dependency verifies only the scope executed with it.

Use Component for a single layer, Integration for interactions,
and E2E for a complete user action.
Report defects according to the [issue rules](../process/issues.md).
