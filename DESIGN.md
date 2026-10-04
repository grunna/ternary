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

## Core terminology

The project uses these English terms consistently:

| Term | Meaning |
| --- | --- |
| **trit** | One balanced ternary digit: `−1`, `0` or `+1`. |
| **tryte** | Exactly six trits. A tryte represents `−364 … +364`, or 729 distinct states. |
| **word** | The CPU's normal data unit. In the first CPU, one word is one tryte. A later wider CPU may define a word as multiple trytes without changing the meaning of a trit or tryte. |
| **memory location** | One addressed storage position. In `Memory 3×6`, each of the three memory locations holds one tryte. |

“Byte” is deliberately not used: it means eight binary bits and would obscure the ternary architecture.
| 6-trit ripple adder | `A + B + CarryIn = Sum + 729×CarryOut` | Six Normalize / carry cells chain from `t0` to `t5`. This is the opening word-level arithmetic reference: every cell retains the proven 27-case contract and only its carry travels to the next trit weight. `CarryOut` is signed word extension: `-1` below range, `0` in range and `+1` above range. The six output trits always contain the canonical modulo-729 result; there is no saturation or trap. |
| 6-trit negate / subtract | `A − B + CarryIn = Difference + 729×CarryOut` | Negation is digitwise in balanced ternary, so a reusable six-lane negator needs no carry propagation. Subtraction feeds the negated B word into the same six-cell Normalize / carry ripple chain; `CarryIn` supports later multi-word composition. For subtraction, `CarryOut=-1` is negative underflow (the borrow direction), `0` is in range and `+1` is positive overflow; it is deliberately not a binary no-borrow flag. |
| 6-trit comparator | `A,B → Order, Less, Equal, Greater` | Six proven Compare blocks are resolved most-significant-first by five Select3 stages. `Order` is the native `-1 / 0 / +1` comparison result; `Less`, `Equal` and `Greater` are one-hot `0 / +1` control outputs made by a final Threshold3 boundary decode. |
| 6-trit Select3 | `Neg[5:0], Zero[5:0], Pos[5:0], Select → Out[5:0]` | One packed balanced select trit fans out to six proven Select3 cells. It chooses a complete word without inventing a binary control bus: `-1` selects Neg, `0` Zero and `+1` Pos. Unknown/floating selection remains unknown at every output lane. |
| 6-trit Route3 | `In[5:0], Select → Neg[5:0], Zero[5:0], Pos[5:0]` | One packed balanced select trit fans out to six proven Route3 cells for a read-path split. The selected word path carries the input; each inactive path is explicitly six logical zeroes, never an implicit floating or stale bus value. |
| First 6-trit ALU control | `A[5:0], B[5:0], Op → Result[5:0], Extension` | `Op` stays packed as one balanced trit: `-1` is `A − B`, `0` passes `A` unchanged, and `+1` is `A + B`. Arithmetic results use the established signed-extension contract; pass-A always reports extension `0`. `B` is deliberately ignored only by pass-A; unknown/floating operation or a data input used by the selected operation produces unknown outputs rather than choosing an operation. |
| 6-trit register bank | `DataIn[5:0], Address, Action, Clock, Reset → DataOut[5:0]` | Three complete tryte registers retain the established packed `−1 / 0 / +1 = read / idle / write` access action. A known `0 → +1` write edge updates every lane of the selected register together; reset has priority and establishes all three words as zero. This is register-file state for the opening CPU, distinct in role from addressable memory while retaining the same safe public timing contract. |
| 6-trit program counter | `Control, LoadData[5:0], Load, Clock, Reset → PC[5:0], Extension` | Six edge-triggered registers feed a least-significant-first `Adjust3` chain. `Control=−1 / 0 / +1` means decrement / hold / increment on a known `0 → +1` edge. `Load=+1` replaces that adjustment with the complete known `LoadData` word, allowing jumps; otherwise the adjustment path is used. The output word wraps canonically modulo 729 and `Extension` reports `−1` below range, `0` in range or `+1` above range; reset has priority and synchronously establishes PC = 0. |

### Opening CPU state-transition order

The opening CPU datapath uses one shared known `0 → +1` clock edge. Before that edge, the dual-read register file exposes operand A and B combinatorially, the ALU settles, and the packed write-back selector chooses `−1 = external future-memory data`, `0 = A move` or `+1 = ALU result`. On the edge, every selected register write and the PC adjustment sample the same pre-edge state; their commits become visible together and ordinary propagation then settles the new reads and ALU result. `reset=+1` has priority over every write and PC control on that edge: it sets all three register-file trytes and the PC to zero. An unknown, floating or invalid address/control/data input never commits state.

## Opening CPU instruction set

An instruction is exactly one six-trit word, ordered most-significant first: `Op2 Op1 Op0 Rd Ra Rb`. `Rd`, `Ra` and `Rb` are one-trit register addresses (`−1 = R−`, `0 = R0`, `+1 = R+`), except that `LIT` reuses its final two fields as a small literal. Three opcode trits create 27 primary slots: the opening CPU uses ten and reserves the remaining 17, including room for an eventual extension form. Reserved or malformed instructions are safe no-ops: they do not write a register, memory or PC.

| Opcode | Mnemonic | Meaning |
| --- | --- | --- |
| `− − −` | `HALT` | Stop instruction stepping; machine state is unchanged. |
| `− − 0` | `MOV Rd, Ra` | `Rd ← Ra`. |
| `− − +` | `ADD Rd, Ra, Rb` | `Rd ← Ra + Rb`, using the established wrapping ALU contract. |
| `− 0 −` | `SUB Rd, Ra, Rb` | `Rd ← Ra − Rb`. |
| `− 0 0` | `LOAD Rd, [Ra]` | Read `Memory 27×6` at the low three trits of `Ra`, then write the returned tryte to `Rd`. |
| `− 0 +` | `STORE [Ra], Rb` | Write `Rb` to `Memory 27×6` at the low three trits of `Ra`; `Rd` is ignored. |
| `− + −` | `JUMP Ra` | Load PC from the low three trits of `Ra`, sign-extended to a six-trit address. |
| `− + 0` | `BRZ Ra, Rb` | If `Ra` is exactly zero, load PC from the low three trits of `Rb`; otherwise advance normally. |
| `− + +` | `NOP` | Advance normally with no write. |
| `+ − −` | `LIT Rd, Imm1, Imm0` | Write the two-trit balanced literal `Imm1 Imm0` (`−4 … +4`) to `Rd`. This bootstraps useful program constants after reset. |

`Memory 27×6` is the opening program/data store. Its address is an ordered three-trit word `a2 a1 a0`, representing `−13…+13`; `LOAD`, `STORE`, `JUMP` and `BRZ` take that address from the three least-significant trits of their named address register. This makes indirect addressing explicit and keeps all memory traffic on the established public memory-port contract. Fetch is zero-cycle combinational: the controller presents PC's low three trits with memory action `−1`, lets the instruction word settle, then performs decode/execute on a later state edge. A future `EXT` opcode may consume the following tryte as a full-width immediate or address without changing this base format.

The opening sequencer has three states: **fetch**, **execute** and **halted**. In fetch it requests the instruction word with memory action `−1` and asserts instruction-register load; the following edge enters execute. In execute it applies the decoded register, ALU, memory and PC controls to the captured instruction; the following edge returns to fetch, except `HALT` enters halted. Reset always returns to fetch and clears PC, the instruction register, register file and memory through their existing public reset ports. A fetch edge never writes architectural state other than the instruction register; an execute edge never replaces that instruction register.

### CPU memory-cycle and control-flow schedule

`Memory 27×6` has zero-cycle combinational reads and edge-triggered writes. The CPU therefore has no hidden wait state or read-data latch in this first machine: a read address and action settle during the active phase, and the consumer samples that settled word at the phase's closing shared `0 → +1` edge.

| Phase | Memory action and address | Closing-edge state changes |
| --- | --- | --- |
| Fetch | `−1` read at PC low trits | Instruction register captures the settled instruction; no register-file, memory or PC update occurs. |
| Execute: `LOAD` | `−1` read at `Ra` low trits | Register file writes the settled memory word to `Rd`; PC advances normally. |
| Execute: `STORE` | `+1` write `Rb` at `Ra` low trits | Memory commits `Rb`; PC advances normally. |
| Execute: arithmetic, `MOV`, `NOP` | `0` idle | The selected register result commits where applicable; PC advances normally. |
| Execute: `JUMP` / taken `BRZ` | `0` idle | PC loads the sign-extended low-three-trit target; no normal adjustment occurs. |

The named `CPU memory-cycle timing` control exposes this schedule as packed `action`, `instructionLoad`, `readSample`, `loadWrite` and `storeWrite` trits. `readSample=+1` means that the public memory output must already be stable for the same upcoming edge; it is a timing declaration, not a separate binary handshake.

`BRZ` uses the existing six-trit all-zero equality result: `Equal=+1` is a taken branch, `Equal=0` is not taken, and `?` keeps PC control invalid so no ambiguous state update can commit. `JUMP` loads the low three trits of `Ra`; a taken `BRZ` uses those of `Rb`. A balanced-ternary address is widened by **zero-prefixing**, not two's-complement-style sign extension: target `a2 a1 a0` becomes `0 0 0 a2 a1 a0`, preserving its value `−13 … +13` in the six-trit PC. The named `CPU branch / PC control` component turns these proven equality and decoded control outputs into the PC's packed `Control`, `Load` and six target-trit ports.

### Minimal runnable machine

`Opening ternary CPU — 6-trit` is the documented architectural machine boundary used by the runnable console. It owns PC, three six-trit registers, the captured instruction and fetch/execute/halted phase. Its only data connection is the public `Memory 27×6` port: three address trits, packed read/idle/write action and six write-data trits leave the CPU; six memory-data trits return. It exposes PC, all registers, instruction and phase as observer outputs, so each architectural edge can be checked while the underlying register, ALU, memory and control contracts remain separately drillable.

The first runnable fixture writes its program through that public memory port before releasing CPU reset. It executes `LIT`, `ADD`, `STORE`, `LOAD`, `BRZ` and `HALT`, proving arithmetic, memory transfer, branching and PC transitions end-to-end. `LIT` is intentionally small (`−4 … +4`): it only bootstraps constants after reset and does not introduce a hidden program-initialization state.

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

### Opening `Pixel Display 3×3` contract

The first pixel peripheral is intentionally small enough to exhaustively test. It owns a 3×3 frame of ternary pixel values and has no circuit outputs. Its public ports are `x`, `y`, `color`, `clock` and `reset`.

| Port | Values and meaning |
| --- | --- |
| `x` | Known `−1 / 0 / +1` selects left / centre / right. |
| `y` | Known `+1 / 0 / −1` selects top / centre / bottom, preserving ordinary Cartesian orientation. |
| `color` | The ternary value stored in the addressed pixel: `−1` is the negative-color swatch, `0` is off/black, and `+1` is the positive-color swatch. The exact screen colours are visual mapping only; all three stored values remain distinct. |
| `clock` | Every known rising edge `0 → +1` writes the current known x, y and color values. All other transitions are observational only. A pixel is erased by writing `color=0`, not by a special erase command. |
| `reset` | `+1` on a known rising clock edge clears all nine pixels to `0` and takes priority over `write`. `0` permits normal operation. `−1`, `Z` and `?` are invalid controls and must not alter the frame. |

At a rising edge with `reset=0`, x, y and color must be known supported values. If an address, color or control is `Z` or `?`, or `reset` is `−1`, the frame remains unchanged and the peripheral records an explicit invalid-I/O diagnostic for Inspector and the visual bezel. A valid `reset=+1` edge ignores address and color because reset has priority. There is no silent address selection, stale-data write or implicit clear. Reset is synchronous; changing `reset` between clock edges does not modify pixels. This contract is the future memory-mapped display boundary as well: a later bus adapter must translate its public memory/I/O transaction into these same sampled ports rather than bypassing the device state.

### Experimental 24×24 RGB display profiles

The two 24×24 RGB peripherals are named accelerated I/O references, not a claim that a 576-pixel panel has been structurally expanded in the editor. Each pixel stores three independent six-trit balanced words: red, green and blue. This is 18 trits of pixel data, preserving the current CPU word width per channel without a binary colour bus.

`RGB Display 24×24 — addressed` has four-trit `x3…x0` and `y3…y0` coordinates, 18 RGB data inputs, `clock` and `reset`. Only coordinate values `−12 … +11` are valid: x grows left-to-right and y grows bottom-to-top. Its physical row mapping puts `(−12,+11)` at top-left. Every known `0 → +1` edge updates the addressed pixel.

`RGB Display 24×24 — raster stream` is a two-wire serial interface: one ternary `data` input and one `clock` input. Each known `0 → +1` edge captures one trit. Exactly 18 captured trits, in `R5…R0, G5…G0, B5…B0` order, form the next pixel and advance the private raster cursor; the cursor wraps after pixel 575. The opening serial profile deliberately has no reset, address or frame-start pin: a complete 576-pixel stream is self-aligned from its creation point and subsequent full frames overwrite the same raster order. A future physical transport profile may add an explicit framing/escape protocol if it needs recovery after an interrupted stream. Invalid clock or data is diagnosed and never modifies the frame.

### Future memory-mapped display adapter

The adapter is deferred until the Phase 17 memory-port timing is fixed, but its public boundary is fixed now: it uses the same balanced `address`, six-trit `data`, ternary `action`, `clock` and `reset` ports as CPU memory. `action=−1` reads device status, `0` is idle, and `+1` writes the selected device register on a known CPU `0 → +1` edge. No binary write-enable, byte lane or display-only control bus is introduced.

The opening register map fits the first six-trit CPU address range:

| Address | `action=+1` write | `action=−1` read |
| --- | --- | --- |
| `−1` | Display command. Data `−1` clears the future transport/frame state; `0` is a no-op; `+1` rewinds the serial packet/raster position without clearing. | Status word: `0` means ready; `?` means the adapter has latched an invalid transaction. |
| `0` | Serial-data window. The adapter serializes the six trits most-significant first onto the RGB display's `data`/`clock` pair. | Six-trit balanced count `0…17` of trits currently collected for the next 18-trit pixel packet. |
| `+1` | Reserved for a later explicit framing/transport extension. | Reserved; reads as balanced word `0`. |

Thus one RGB pixel takes three ordinary CPU writes to address `0`: R word, then G word, then B word. The adapter produces six internal serial display clocks for each CPU data write, and its third write completes the display's 18-trit pixel packet. A full 24×24 frame is 1,728 six-trit CPU writes. The adapter owns this serialization state and exposes only status through the normal memory read action; it must never let an invalid address, action, data or clock partially alter the serial packet or display frame. Its read timing now follows the memory contract below; its wait/ready policy and structural-vs-accelerated implementation remain deferred until the adapter itself is built.

## Memory port contract

The opening memory interface is shared by `Memory 3×1`, word memory and future memory-mapped adapters. It has one balanced `address` trit (or an ordered balanced address word in larger memories), `dataIn`, `dataOut`, ternary `action`, `clock` and `reset`. The action trit remains packed through the CPU-facing port: `−1 = read`, `0 = idle`, `+1 = write`. There are no separate binary read-enable and write-enable wires.

| Condition | `dataOut` | Stored state |
| --- | --- | --- |
| `action=−1`, known address | Combinatorially exposes the addressed stored trit after ordinary propagation settles. | Unchanged. |
| `action=0` | `?` — no read result is being claimed. | Unchanged. |
| `action=+1`, known address/data, known `clock: 0 → +1` | `?` during the write transaction. | The addressed location commits `dataIn` on the edge. |
| `reset=+1`, known `clock: 0 → +1` | `?` during reset. | Reset has priority and commits every location to its declared initial value, initially `0`. |
| Invalid/floating/unknown address, data, action or clock | `?` whenever a read result cannot be determined. | Never changes because of that invalid access. |

Memory starts unresolved until a valid reset edge establishes its initial contents. Reads are **zero-cycle combinational** after a settled address/action: an instruction or later CPU controller must make its read action and address stable, then sample `dataOut` in its documented state transition. Writes and reset are **synchronous**, occurring only on the exact known `0 → +1` edge. A read and write cannot happen together because one action trit selects exactly one of them. The implementation stages every location from the same pre-edge snapshot, so a future six-trit word write cannot become a mixture of old and new lanes.

### Scaled memory hierarchy and initialization

`Memory 9×6`, `27×6` and `81×6` use two, three and four ordered address trits respectively, most-significant first. Their valid balanced address ranges are `−4…+4`, `−13…+13` and `−40…+40`. Each extra high trit selects one of three complete smaller memory banks; a `Route3` forwards the packed action only to that bank and six `Select3` cells return its word. This preserves a single read/idle/write action and never introduces a binary chip-select port.

All scaled memories begin unresolved. A public reset transaction (`reset=+1` on a known `0 → +1` clock edge) broadcasts to every child bank and initializes every word to the declared initial value, currently zero; address and data are irrelevant to that reset edge. There is deliberately no preload backdoor. Programs or fixtures load contents only through ordinary known-address write transactions, so the accelerated RAM and its inspectable hierarchy share the same observable initialization, read, write and reset behavior.

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
