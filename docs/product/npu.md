# NPU

The goal is for a reference model to run on the NPU itself
and produce output within the specified tolerance.
Further runs must remain available.
Test detection, driver, runtime, and recovery.
Voice AI is outside the product plan and is not an NPU acceptance criterion.

## Initial checks

1. Record revision, Flipper OS, kernel branch and version,
   patches, driver, runtime, and model.
2. Check accelerator availability for the selected execution method.
3. Run a computation with reference inputs and compare output with the reference.
4. Verify NPU use. Success through CPU fallback does not verify the accelerator.
5. Repeat the run; check completion, resource release,
   and availability for the next operation.

## Extended coverage

Check supported data types and sizes, invalid input,
model loading failures, repeated and parallel operations, and load.
Reference models, supported operations, and comparison tolerances: TBD.
Assess Mainline and BSP capabilities for the selected stack;
results from one driver or runtime do not transfer to another.

Measure latency, throughput, memory, temperature, and consumption
under defined conditions.
Define performance criteria separately from correctness.
A result for one model does not apply to other models and operations.

## Evidence

Retain reference inputs, model identifier, expected output, tolerance,
actual output, execution path observations, and load parameters.
Include product AI scenarios after a development solution
and requirements are available; their scope is TBD.

The [strategy](../strategy/overview.md) defines overall boundaries.
Thermal measurements are covered in [power](power.md).
