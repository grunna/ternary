# Ternary Lab design rationale

This document records architectural and structural decisions for the sequential components and CPU datapath. The project deliberately stops above transistor- and voltage-level modeling.

## Structural equivalence rule

Every non-primitive component must remain explainable as an open, lower-level ternary circuit down to the technology-neutral cell boundary. A faster native simulator implementation is allowed only as an **accelerated, structurally equivalent** execution path: it must retain the same interface, logical behavior and sequential/clock semantics as a named structural definition, and both forms must share verification vectors where practical. An accelerator is never a new logical primitive.

This is the project’s definition of physically viable: the logic is structurally realizable in principle and can later be mapped to a concrete ternary technology. Ternary Lab still intentionally does not model transistors, voltages, current, power, noise margins or physical timing. If a desired component cannot eventually be constructed from the available lower-level cells, we add and document a necessary fundamental cell first—or reject the component as a magic shortcut. The full evolving policy is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Component decisions

| Component | Contract / role | Decision and rationale |
| --- | --- | --- |
| Driven, floating and unknown | `-1`, `0`, `+1` driven; `Z` floating; `?` unresolved | Keep both `Z` and `?` distinct from logical zero. A disabled pass cell emits `Z`; logic requiring a driven value turns `Z` or `?` into `?`, so missing drive cannot silently select a path. |
| Resolved Merge3 | `a,b,c → out` | Ideal interconnect cell for mutually exclusive pass paths. Exactly one non-`Z` driver reaches `out`; all `Z` produces `Z`; any contention or unknown drive produces `?`. It makes bus ownership explicit instead of silently selecting a driver. |
| Ternary reference rail | fixed `-1`, `0` or `+1` → out | Explicit ideal reference source for structural circuits. It replaces hidden simulator constants; a `Route3` structural implementation uses a declared zero rail to drive its inactive outputs to logical zero. |
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
| 7-segment output boundary | `A–G, Sign`: `0` = off, `+1` = on | This is a deliberate two-state peripheral adapter, not binary logic leaking into the ternary datapath. Ternary decoders remain open components; they turn ternary decisions into the two physical states an individual segment needs. `-1`, `?` and `Z` remain visible as invalid at this boundary rather than being mistaken for off. |
| CPU word width | 6 balanced trits, `−364 … +364` | Six trits give 729 states and are small enough for the first opening CPU components while still requiring meaningful multi-trit carry, comparison and storage. This fixes the first register, ALU and instruction-word width; wider words can be introduced later without changing ternary semantics. |
| 6-trit ripple adder | `A + B + CarryIn = Sum + 729×CarryOut` | Six Normalize / carry cells chain from `t0` to `t5`. This is the opening word-level arithmetic reference: every cell retains the proven 27-case contract and only its carry travels to the next trit weight. |
| 6-trit negate / subtract | `A − B + CarryIn = Difference + 729×CarryOut` | Negation is digitwise in balanced ternary, so a reusable six-lane negator needs no carry propagation. Subtraction feeds the negated B word into the same six-cell Normalize / carry ripple chain; `CarryIn` supports later multi-word composition. |
| Native multi-trit display | one `− / 0 / +` glyph per trit, most-significant trit first | A CPU value is shown as its balanced-ternary word, without conversion or a separate sign bit. It scales directly from one trit to the fixed six-trit CPU word and keeps every stored state visible. Decimal rendering is intentionally deferred: it is a debugger/peripheral adapter, built from open reusable pieces (word converter, digit decoder and three displays) after multi-trit arithmetic exists. |
| Decimal display capacity | sign plus three decimal positions | The future decimal peripheral covers the whole first CPU-word range `−364 … +364`; its unused capacity up to 999 is acceptable. It is not an architectural reason to widen the CPU word. |

## Technology-neutral device/cell boundary

### Signal contract

`-1`, `0` and `+1` are driven ternary levels. `?` means the simulator cannot determine a value. `Z` means a structural pass device intentionally does not drive the wire. A restorer requires a driven level; receiving `?` or `Z` produces `?`. Ordinary component inputs retain a single driver; `Merge3` is the explicit exception at an interconnect boundary. It accepts exactly one non-`Z` branch, returns `Z` when all branches float, and returns `?` for any contention or unresolved branch.

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
