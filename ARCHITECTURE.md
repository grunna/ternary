# Ternary Lab – structural vs optimized component architecture

## Goal

The simulator should always preserve the ability to understand and rebuild a circuit from its lowest-level ternary building blocks.

Optimized components are allowed and encouraged for simulation performance, but they must never become opaque "magic" components that introduce behavior which cannot be reproduced structurally.

The core rule is:

> Every optimized component must have an equivalent structural implementation built from lower-level components.

The optimized component and the structural component must represent the same logical behavior.

---

## Component levels

We should think of the simulator as having multiple abstraction levels.

Example:

```text
Memory
  ↓
Memory bank
  ↓
Word
  ↓
Register
  ↓
Latch
  ↓
Pass / Restore / Threshold / Storage
  ↓
Physical implementation
```

The simulator does not necessarily need to simulate actual transistors, voltages, current, timing or a specific semiconductor technology.

The lowest simulator-level primitives should instead act as technology-neutral ternary building blocks.

Later, those primitives could potentially be mapped to a real hardware technology such as CMOS, CNTFETs or another ternary implementation.

---

## Structural components

Structural components are built from other components.

Examples:

```text
Structural Register
Structural Counter
Structural Register Bank
Structural Memory
Structural ALU
```

A structural component must be possible to open and inspect.

For example:

```text
Register
  ↓
Latch
  ↓
Pass3
Storage Node
Restore3
Threshold3
```

The user should be able to keep opening nested components until reaching the primitive/device level.

This is important both for learning and for validating that the ternary architecture could theoretically be implemented in hardware.

---

## Optimized components

Large structural circuits can become expensive to simulate.

Therefore we should also support optimized implementations such as:

```text
Fast Register
Fast Register Bank
Fast RAM
Fast Counter
Fast ALU
```

These may be implemented directly in JavaScript/TypeScript or another simulator-native implementation.

However:

```text
Fast Register
      ≡
Structural Register
```

and:

```text
Fast RAM
      ≡
Structural RAM
```

The optimized version must not expose any behavior that cannot be reproduced by the structural version.

Optimized components are simulation accelerators, not new logical primitives.

---

## Inspecting optimized components

Even if a circuit currently uses the optimized implementation, the user should still be able to inspect how that component would be built structurally.

Possible UI behavior:

```text
Fast RAM 27x6
    ↓ Open implementation
Structural RAM 27x6
    ↓
Memory banks
    ↓
Words
    ↓
Registers
    ↓
Latches
    ↓
Primitives
```

The optimized component can therefore contain or reference a structural definition used for inspection.

The simulator does not necessarily need to instantiate the structural circuit during normal execution.

---

## Structural definition vs runtime implementation

A useful architecture could be:

```text
Component definition
├── interface
├── structuralImplementation
└── optimizedImplementation
```

Conceptually:

```text
Register
{
    inputs
    outputs

    structural:
        circuit definition using primitives

    optimized:
        native simulator implementation
}
```

The structural implementation explains what the component is.

The optimized implementation explains how the simulator executes it efficiently.

They must remain behaviorally equivalent.

---

## Verification

Optimized components should ideally be tested against their structural equivalents.

For example:

```text
structuralRegister(sequence)
fastRegister(sequence)

assert(outputs are identical)
```

The same approach should later work for:

```text
registers
counters
selectors
memory
register banks
ALU operations
decoders
etc.
```

Where practical, the same test vectors should run against both implementations.

This gives confidence that optimization has not changed the logical machine.

---

## Important design rule

Avoid adding high-level components that cannot eventually be expressed using the primitive set.

Before introducing a new optimized primitive, ask:

> Could this behavior be built structurally using the existing lower-level components?

If yes, the component may be added as an optimization.

If no, either:

1. the primitive set is missing something fundamental, or
2. the proposed component is too magical and should not be added.

---

## Memory example

Memory is a good first test of this architecture.

Start by building:

```text
Memory 3x1
```

structurally.

Three addresses:

```text
-1
 0
+1
```

Each stores one trit.

A possible hierarchy:

```text
Memory 3x1
├── address decoder
├── write-selection logic
├── Register -1
├── Register 0
├── Register +1
└── Select3 read path
```

Each register should itself be structural and inspectable.

Once this works, larger memories can be composed hierarchically:

```text
3x1
↓
3x6
↓
9x6
↓
27x6
↓
81x6
```

Later a Fast RAM implementation can replace the structural RAM during simulation, while retaining the structural definition for inspection.

---

## I/O and external devices

The same philosophy applies when eventually building something resembling a complete ternary computer.

Internally, the system should remain ternary as far as practical:

```text
CPU
↓
RAM
↓
Framebuffer
↓
Display controller
↓
Ternary output
```

Conversion to today's binary hardware should happen as late as possible.

For example:

```text
Ternary computer
      ↓
ternary display controller
      ↓
ternary pixel/output values
      ↓
binary/physical bridge
      ↓
HDMI / SPI / RGB / normal display
```

The binary bridge represents the external world, not the internal architecture.

The same could later apply to:

```text
keyboard
storage
network
USB
display
other peripherals
```

---

## Suggested component categories

It may be useful to make the distinction visible in the UI.

For example:

```text
Primitives
Structural
Optimized
I/O
```

Or optimized components could simply have a clear indicator such as:

```text
Register
Register [Fast]
```

with an action like:

```text
View structural implementation
```

The exact UI can be decided later.

The important part is that users can always discover how an optimized component maps back to the fundamental ternary circuit.

---

## Summary

The architecture should follow these principles:

1. Fundamental ternary primitives form the bottom of the simulator model.

2. Higher-level circuits should be constructible hierarchically from those primitives.

3. Structural components should be inspectable recursively down to primitives.

4. Optimized/native components are allowed for performance.

5. Every optimized component must have a structural equivalent.

6. Optimized components must not introduce capabilities unavailable to structural circuits.

7. Structural and optimized implementations should share test vectors and be verified for equivalent behavior.

8. Even when the optimized implementation is running, the user should be able to open the component and inspect its structural implementation.

9. Physical binary conversion for external hardware should happen at the edge of the system, not inside the ternary architecture.

The long-term goal is that Ternary Lab can scale from educational circuits to larger simulated computers without losing the ability to answer:

> "How would this actually be built from the fundamental ternary components?"

---

## Ternary Lab project contract

This is a binding design rule for future work in Ternary Lab:

1. A component may be accelerated by native simulator code, but that code is never a new logical primitive.
2. Every accelerated component must reference an inspectable structural implementation made from lower-level components.
3. Repeatedly opening that structure must end at the documented, technology-neutral ternary cell boundary: detection, restoration, controlled transmission and declared storage.
4. The accelerated and structural forms must have the same public interface, signal semantics and state/clock behavior. Shared saved cases and sequence tests are the proof of that equivalence.
5. If a proposed high-level block cannot be expressed below this boundary, it is not added as a convenience shortcut. We first identify and document the missing fundamental cell or reject the block as a magic component.

“Physically viable” here means *structurally realizable in principle*: the simulator models logic contracts and storage boundaries that could later be mapped to a ternary technology. It deliberately does **not** claim a transistor-level implementation, voltage encoding, noise margins, timing closure, power or a particular material/device technology.

## Current status and next application

The current ideal cell boundary from Phase 14 is the base of this hierarchy. Existing opening structural latch/register work demonstrates the intended drill-down path. The next important proof point is a structural `Memory 3×1`, built from an address decoder, write selection, three inspectable registers and a `Select3` read path. Larger memories must be compositions of such structures before a fast RAM execution path is considered.

Future component documentation should state one of these execution modes:

- **Structural** — evaluated by its inspectable nested circuit.
- **Accelerated, structurally equivalent** — evaluated natively for speed while exposing the named structural implementation and its equivalence tests.
- **External adapter** — bridges to a non-ternary peripheral only at the boundary; it is not part of the ternary machine’s internal logic.


## Current accelerated-component inventory

The Inspector is the live inventory: selecting a component now shows its execution role, structural status and known lower-level path. The present classifications are intentionally conservative.

- Ideal restorer, detector, pass switch and storage node are the technology-neutral cell boundary, not accelerators.
- Ternary latch and register are accelerated, structurally equivalent: the Structural storage project opens their pass/restorer/storage and two-latch references.
- The register bank is accelerated but structural-circuit pending: address decode, three registers, write selection and a Select3 read path must become open components.
- Arithmetic, logic and routing candidates remain functional primitives with structural circuits pending. Their direct contracts are experiments, not proof that a cell-level network exists.
- Display and probe are external/observation boundaries and do not add ternary-machine behavior.

A component marked **structural circuit pending** has a documented intended path, but is not evidence that the corresponding construction has been implemented yet.
