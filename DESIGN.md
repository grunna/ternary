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
| 6-trit ripple adder | `A + B + CarryIn = Sum + 729×CarryOut` | Six Normalize / carry cells chain from `t0` to `t5`. This is the opening word-level arithmetic reference: every cell retains the proven 27-case contract and only its carry travels to the next trit weight. `CarryOut` is signed word extension: `-1` below range, `0` in range and `+1` above range. The six output trits always contain the canonical modulo-729 result; there is no saturation or trap. |
| 6-trit negate / subtract | `A − B + CarryIn = Difference + 729×CarryOut` | Negation is digitwise in balanced ternary, so a reusable six-lane negator needs no carry propagation. Subtraction feeds the negated B word into the same six-cell Normalize / carry ripple chain; `CarryIn` supports later multi-word composition. For subtraction, `CarryOut=-1` is negative underflow (the borrow direction), `0` is in range and `+1` is positive overflow; it is deliberately not a binary no-borrow flag. |
| 6-trit comparator | `A,B → Order, Less, Equal, Greater` | Six proven Compare blocks are resolved most-significant-first by five Select3 stages. `Order` is the native `-1 / 0 / +1` comparison result; `Less`, `Equal` and `Greater` are one-hot `0 / +1` control outputs made by a final Threshold3 boundary decode. |
| 6-trit Select3 | `Neg[5:0], Zero[5:0], Pos[5:0], Select → Out[5:0]` | One packed balanced select trit fans out to six proven Select3 cells. It chooses a complete word without inventing a binary control bus: `-1` selects Neg, `0` Zero and `+1` Pos. Unknown/floating selection remains unknown at every output lane. |
| 6-trit Route3 | `In[5:0], Select → Neg[5:0], Zero[5:0], Pos[5:0]` | One packed balanced select trit fans out to six proven Route3 cells for a read-path split. The selected word path carries the input; each inactive path is explicitly six logical zeroes, never an implicit floating or stale bus value. |
| First 6-trit ALU control | `A[5:0], B[5:0], Op → Result[5:0], Extension` | `Op` stays packed as one balanced trit: `-1` is `A − B`, `0` passes `A` unchanged, and `+1` is `A + B`. Arithmetic results use the established signed-extension contract; pass-A always reports extension `0`. `B` is deliberately ignored only by pass-A; unknown/floating operation or a data input used by the selected operation produces unknown outputs rather than choosing an operation. |

The initial ALU-shape comparison keeps the same public contract for both candidates. Candidate A selects `−B`, `0` or `+B` before one six-cell Normalize/carry ripple: 19 nodes, depth 8. Candidate B computes full add and subtract ripples in parallel and selects their results afterward: 26 nodes, depth 8. Candidate A is selected for the opening ALU because it has the same behavior and critical depth while avoiding seven nodes and an entire duplicated arithmetic path.

The opening `6-trit ALU` is Candidate A as a reusable, inspectable component. It introduces no word-level magic primitive: its six Negate, six Select3 and six Normalize/carry instances each retain the named structural reference established for their accelerated behavior.

## I/O adapter contract

I/O is an explicit boundary between the simulated ternary circuit and a user-facing or host-facing device. An adapter is never a hidden logic primitive and must declare whether it is a source, observer or clocked peripheral.

| Adapter kind | Public behavior | Timing | `Z` / `?` behavior |
| --- | --- | --- | --- |
| Source/input | Holds and drives its declared trit or word value onto output ports. A user action is an external state change, not an internal gate operation. | Its output is available on the next ordinary propagation settle. | May deliberately drive `-1`, `0`, `+1`, `Z` or `?`; its UI must label the latter two distinctly. |
| Observer/output | Samples declared input ports and renders them without feeding any signal back into the circuit. | Rendering reflects the settled current input; it creates no event or state update. | `Z` and `?` must be visibly distinct from each other and from logical zero/off. |
| Clocked peripheral | Samples its public data/control ports and owns only its declared peripheral state, such as pixels. | A write commits only on its declared clock edge. The opening convention is `clock: 0 → +1` with `write=+1`; reset behavior is stated by the peripheral contract. | Unknown/floating control, address or data must never silently select an address, write a value or retain a seemingly valid display state. The peripheral presents an explicit invalid/unknown indication instead. |

Every adapter declares its ports, state ownership, clock/reset policy and visual mapping in Inspector metadata. Inputs and outputs are classified as `external-adapter`; a stateful peripheral must expose the same update contract that a CPU-facing memory/I/O interface will later use.

An input button is a two-state external adapter, not a generic trit source: it declares two distinct known released and pressed trit values (default `0` and `+1`) plus momentary, toggle or pulse behavior. A momentary button drives the pressed level while the pointer is held; toggle changes state on each press; a pulse drives the pressed level for its declared external duration (120 ms by default). A joystick is two independent ternary axes, `x` and `y`, each `-1 / 0 / +1`; this directly represents center, cardinal directions and diagonals. The future computer console is a top-level composition of these peripherals, a drillable Computer component and visual outputs. Its `Run computer`, step and reset controls operate the public computer clock/reset contract and remain distinct from simulator propagation controls.

The opening analog joystick uses the current CPU word width: six balanced trits for `x` and six for `y`, giving `−364 … +364` independently on each axis (12 output trits in total). It therefore connects directly to current word-level components with no hidden scaling. A later high-resolution design must state width **per axis** — for example, 12 trits per axis means 24 output trits total — and add an explicit conversion adapter if the CPU word remains six trits.
| Native multi-trit display | one `− / 0 / +` glyph per trit, most-significant trit first | A CPU value is shown as its balanced-ternary word, without conversion or a separate sign bit. It scales directly from one trit to the fixed six-trit CPU word and keeps every stored state visible. Decimal rendering is intentionally deferred: it is a debugger/peripheral adapter, built from open reusable pieces (word converter, digit decoder and three displays) after multi-trit arithmetic exists. |
| Decimal display capacity | sign plus three decimal positions | The future decimal peripheral covers the whole first CPU-word range `−364 … +364`; its unused capacity up to 999 is acceptable. It is not an architectural reason to widen the CPU word. |

**Decision update:** Decimal rendering is not an end-user peripheral. A debug-only six-trit decimal observer may be used for inspection; physical decimal output remains a user-composed module using explicit conversion logic and multiple 7-segment displays. This supersedes the earlier deferred-peripheral note above.

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
