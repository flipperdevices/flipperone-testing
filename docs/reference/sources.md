# Requirement and Test Method Sources

The [Developer Portal](https://docs.flipper.net/one) contains product descriptions,
architecture, instructions, and research results.
Testing documentation defines how to select checks, handle results,
and assess releases.
Link technical specifications and instructions to their primary sources.

## Applying a source

For each check, record the source page or issue, source version,
expected result, and applicability to the candidate.
Distinguish requirements, implementation descriptions, planned capabilities,
and experimental results.
A feature's development status does not verify it on a target configuration.

If sources conflict, the feature owner defines expected behavior
in a linked task. Until resolved, retain observations without a verdict
on the disputed criterion.
A preliminary value does not automatically become a release criterion.

## Main sources

| Area | Material |
| --- | --- |
| System composition and specifications | [Tech specs](https://docs.flipper.net/one/general/tech-specs) |
| Profiles and snapshots | [OS profiles and snapshots](https://docs.flipper.net/one/cpu-software/profiles) |
| Installation | [How to install a Linux image](https://docs.flipper.net/one/cpu-software/how-to-install-linux-image) |
| Boot and recovery | [Boot Menu](https://docs.flipper.net/one/dev-log/9), [Recovery OS](https://docs.flipper.net/one/dev-log/7) |
| MCU | [Architecture](https://docs.flipper.net/one/mcu-firmware/architecture), [firmware by revision](https://docs.flipper.net/one/mcu-firmware/firmware-update) |
| Applications | [5G Modem](https://docs.flipper.net/one/cpu-software/flipctl/5g-modem-app), [App Manager](https://docs.flipper.net/one/dev-log/10) |
| Network scenarios | [Features](https://docs.flipper.net/one/general/features), [Wi-Fi](https://docs.flipper.net/one/testing/network/wifi), [modems](https://docs.flipper.net/one/testing/network/cellular) |
| Power and physical components | [Power Meter](https://docs.flipper.net/one/hardware/power-meter), [power subsystem](https://docs.flipper.net/one/hardware/power-subsystem), [module mounts](https://docs.flipper.net/one/mechanics/module-mounting-system) |
| User requirements | [Watching a movie on TV](https://docs.flipper.net/one/testing/user-stories/watching-movie) |
| Test setup and observation | [Debug Probe](https://docs.flipper.net/one/hardware/debug-probe), [input events](https://docs.flipper.net/one/dev-log/8) |

Dev Log describes changes at publication time.
Check feature and interface availability against the candidate.
Apply the [release rules](../release/cycle.md) when reusing earlier results.

## Source versions

For reproducibility, record a source commit or a date and copy of the requirement.
The [portal source repository](https://github.com/flipperdevices/flipperone-docs/tree/public-release)
supports links to a specific page version.
