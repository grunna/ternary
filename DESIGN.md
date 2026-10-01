# Ternary Lab design rationale

This document records architectural and structural decisions for the sequential components and CPU datapath. The project deliberately stops above transistor- and voltage-level modeling.

## Component decisions

| Component | Contract / role | Decision and rationale |
| --- | --- | --- |
| Driven, floating and unknown | `-1`, `0`, `+1` driven; `Z` floating; `?` unresolved | Keep both `Z` and `?` distinct from logical zero. A disabled pass cell emits `Z`; logic requiring a driven value turns `Z` or `?` into `?`, so missing drive cannot silently select a path. |
| Normalize / carry | `A+B+C = Sum + 3×Carry` | Arithmetic reference primitive. It gives a compact, exhaustive-testable full-adder contract and is retained as the baseline rather than silently replaced by experimental alternatives. |
| Compare | `a,b → -1,0,+1` | Direct comparator reference. A normalized-difference construction is retained as an explored alternative, but costs more logical nodes and depth. |
| Select3 | `neg,zero,pos,select → out` | Native three-way data selection is preferred over a binary mux tree when all three choices are meaningful. Its 81-case contract is the routing baseline. |
| Route3 | `in,select → neg,zero,pos` | Reciprocal of Select3. It drives only the selected path and drives inactive paths to zero, making a routed signal's inactive paths explicit. |
| Adjust3 | `value,control → next,carry` | The intended counter/PC primitive. `-1 / 0 / +1` directly encodes decrement / hold / increment; carry enables composition into multi-trit arithmetic. |
| Control3 decode | packed action → three downstream paths | Keep the action packed as one trit in the logical datapath. Decode to one-hot physical paths only at a device boundary that genuinely needs separate read, idle and write lines. |
| Sequence generator | periodic trit source | A configurable sequence is preferred to a fixed binary clock for experiments. It can still emit a conventional clock when sequential timing requires one. |
| Ternary latch | `d,enable → q` | Stores one balanced trit. It is transparent only for `enable=+1`; nonpositive enable holds state, avoiding an invented third latch action. |
| Ternary register | `d,load,clock,reset → q` | Hardware-like D flip-flop: it samples D only when `load=+1` on a `0 → +1` clock edge. Clock is intentionally two-state (`0/+1`); a register begins unknown until reset. |
| Clocked state boundary | settle → clock edge | The simulator internally applies all samples from one clock edge together after combinational propagation. This is an implementation detail: users drive CLK directly and do not issue a separate commit command. |
| Ternary register bank | d,address,action,clock,reset → out | Three one-trit registers selected by `-1 / 0 / +1`; action is read / idle / write. Reads are combinational, writes commit only at the state boundary. |
| Reusable component boundary | named input/output ports | Components own an explicit public contract, saved regression cases and per-instance internal runtime. Structural sequential components can therefore retain state without sharing it across callers. |

## Technology-neutral device/cell boundary

### Signal contract

`-1`, `0` and `+1` are driven ternary levels. `?` means the simulator cannot determine a value. `Z` means a structural pass device intentionally does not drive the wire. A restorer requires a driven level; receiving `?` or `Z` produces `?`. This single-driver model does not yet resolve multiple `Z`/driver sources.

The device cells are a deliberate lower structural layer beneath functional logic cells. They make level detection, restoration, gated transmission and storage visible and testable, while the project deliberately leaves transistor technology, voltage/current encoding, electrical margins, power and delay out of scope.

## Structural comparison metric

Structural alternatives are compared above the physical layer: **nodes** is the expanded count of ideal cells, **depth** is the longest logical path, and **wires** counts internal and boundary connections. **Transitions** is the canonical number of signal changes for one known write from a settled idle state. It is an architectural activity measure, not an estimate of power, voltage behavior or delay.

## Two-state control audit

The following are intentionally flagged for the CPU design. The rule is not “make every bit ternary”; it is “use a trit whenever all three states carry distinct architectural meaning.”

| Conventional two-state control | Ternary replacement | CPU use |
| --- | --- | --- |
| PC decrement/increment plus separate hold/enable | One `Adjust3` control: `-1 / 0 / +1` | Branch back / hold / advance the program counter. |
| Read-enable and write-enable | One action trit: `-1 / 0 / +1` = read / idle / write | Register-file or memory-port access. Decode only at the downstream interface. |
| Two binary selects for three sources | One `Select3` selector | Choose among three ALU, register or memory data paths. |
| Direction plus enable | One routing trit | Route toward negative / zero / positive path, with a separate validity rule only if the operation needs one. |

## Controls that remain two-state

Some controls should stay binary because a third state would not be an architectural action:

- reset/assertion and fault/interlock signals;
- a clock edge or event-scheduler run/pause state;
- validity/error status where `?` already represents unresolved data;
- UI commands such as save, delete and undo.

## CPU implementation consequences

Phase 15 should build edge semantics, a ternary latch and a register while preserving the packed control-trit conventions above. The first CPU PC should use `Adjust3` and chained carry. Register/memory interfaces should accept the read/idle/write action trit before any one-hot adaptation.
