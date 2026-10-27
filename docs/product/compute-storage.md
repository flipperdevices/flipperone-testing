# CPU, RAM, and Storage

The goal is computation within the specified tolerance
and stored data that can be read without corruption and persists as required.
Check resource availability, operation under load, and error handling.
Assess performance against separate numerical criteria.

## Initial checks

| Area | Check |
| --- | --- |
| CPU | Core configuration, reference computation, and output comparison |
| RAM | Available size and a complete pass over allocated memory |
| Storage | Write and read reference data, then compare content |
| System | Control remains available; no unexpected restart or hang |

Record the algorithm, size, duration, parallelism, and completion status.
Testing part of RAM does not verify all memory;
file operations do not verify every storage region.

## Extended coverage

Check combined loads, RAM size variants, memory exhaustion,
full storage, operation errors, and recovery.
Where persistence across restart is required, complete writes
as specified, restart, and read again.

For interrupted operations, define permitted data changes.
Also test profiles and updates in [Linux](linux/README.md)
and [update testing](linux/boot-recovery.md).

## Evidence

Retain the tool and version, parameters, reference output or checksum,
actual processed size, completion status, and errors.
Resource metrics and temperature supplement correctness checks.

Numerical performance and resource use criteria: TBD.
Temperature and consumption are covered in [power](power.md),
GPU and decoding in [media](audio-video.md),
and AI acceleration in [NPU](npu.md).
