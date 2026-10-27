# Applications and User Input

The goal is for users to launch an application, perform its main action,
cancel an operation or exit, and regain control.
Assess the display, physical input, and application lifecycle.
System actions are covered in [FlipCTL](flipctl.md);
the enclosure and access to controls are covered in [mechanics](mechanics.md).

The application catalog and supported versions per candidate are TBD.
Coverage includes App Manager, profile applications,
and [5G Modem](cellular.md) when declared for the candidate.

## Initial checks

1. Record applications, versions, profile, and runtime environment.
2. Launch an application, perform its main action, and exit.
3. Check physical buttons, the touchpad, and supported alternative input.
4. Check cancellation, return, application switching, and state persistence.
5. Trigger a specified error; check the message and ability to continue.

On the built-in 256x144 screen, check text layout, readability,
focus, current soft key labels, and whether labels match actions.
Use the accepted design version; see [User Interface](https://docs.flipper.net/one/user-interface/about).
Check brightness, backlight, and the physical display on the device.

## App Manager

Following the [application description](https://docs.flipper.net/one/dev-log/10),
check catalog retrieval, selection, installation, menu entry,
launch, and the main function's result.
Where update and removal are available, check versions and menu state
after the operation.

Add network unavailability, download errors, storage exhaustion,
cancellation, and retries.
Compare actual installation state with the UI message and launch result.
A process or catalog entry alone does not establish application functionality.

## Extended coverage

Check runtime errors, unavailable resources, interrupted operations,
return after restart, and repeated switching.
For declared languages, check text, input, and layout.

For Desktop, record the session, display, and input method.
Check focus and event routing when moving between
the built-in UI and Desktop.

CLI/RPC checks software input.
Physical presses and gestures require separate checks of the same function.

## Evidence

Retain versions, scenario, input method, visible and system results,
data after the operation, and failure logs.
Voice AI stays outside the product plan under the [strategy](../strategy/overview.md).
