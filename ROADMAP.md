# Ternary Lab roadmap

Status legend: `[x]` implemented, `[ ]` not implemented yet.

The guiding rule is: **discover a native balanced-ternary architecture instead of translating a binary CPU gate-for-gate.**

## Phase 1 — Project foundation
- [x] Static HTML application; no backend required
- [x] Plain JavaScript; no TypeScript or build step
- [x] PixiJS workspace renderer
- [x] HTML/CSS controls around the workspace
- [x] Pan and zoom
- [x] Grid and snapping
- [x] Simulation core separated from renderer

## Phase 2 — Trit model
- [x] Logical values `-1`, `0`, `+1`
- [x] Trit normalization/validation helper
- [x] Separate `unknown/unconnected` state from logical zero
- [x] Signal changes propagate through the circuit
- [x] Logical values are independent of UI rendering

## Phase 3 — Circuit model
- [x] `Circuit`
- [x] `Component`
- [x] Input/output port definitions
- [x] `Wire`
- [x] Fan-out: one output can drive multiple inputs
- [x] Reject invalid port direction / missing components
- [x] One driver per input; a new wire replaces the old input connection
- [x] Explicit graph-level combinational-loop detection
- [x] Runtime protection against non-settling propagation

## Phase 4 — Simulation engine
- [x] Event-driven propagation queue
- [x] Dirty/queued component evaluation
- [x] Propagate only changed output values
- [x] Deterministic single-threaded evaluation
- [x] Maximum propagation-step guard
- [x] Evaluation and signal-change statistics
- [x] Core can run without Pixi/rendering
- [x] Core/renderer separation leaves room for a later Web Worker
- [ ] Actual Web Worker execution

## Phase 5 — Primitive ternary components
- [x] Trit Input
- [x] Probe / Trit Output
- [x] Negate `x -> -x`
- [x] Compare `A<B -> -1`, `A=B -> 0`, `A>B -> +1`
- [x] Select3
- [x] MIN candidate
- [x] MAX candidate
- [x] Normalize / carry primitive candidate
- [x] Primitive sets configurable as experiments instead of one fixed registry
- [x] Primitive-set metadata for logical/structural cost

## Phase 6 — Graphical editor
- [x] Add components from library
- [x] Drag/move components
- [x] Visible named ports
- [x] Drag output -> input to connect
- [x] Click output -> pointer-down on input to connect
- [x] Rewire an existing input connection
- [x] Select components
- [x] Select wires
- [x] Delete selected component
- [x] Delete selected wire
- [x] Pan / zoom
- [x] Grid snapping
- [x] Inspector
- [x] Visual signal values/colors
- [x] Highlight possible input ports while connecting
- [x] Undo / redo (toolbar + Ctrl/Cmd shortcuts)
- [x] Multi-select
- [x] Copy / paste
- [x] Box selection
- [x] Rename components/signals
- [x] Configurable component placement / port layout

## Phase 7 — Signal visualization and stepping
- [x] Current trit shown on wires/components
- [x] Separate Pixi animation layer
- [x] Animated signal pulses
- [x] Animation is separate from logical propagation speed
- [x] Settle/run-to-stable command
- [x] Slow `VISUALIZE` mode that schedules logical events visibly
- [x] `STEP` one propagation event at a time
- [x] Pause/resume
- [x] `CLOCK STEP`
- [x] Configurable sequence generator for timing/control signals
- [x] Sequence presets: `0 ↔ +1`, ternary loop, ternary ping-pong
- [x] Custom trit sequences
- [x] Per-generator interval and auto-run
- [x] Inspect queued events

## Phase 8 — Hierarchical/custom components
- [x] Select an existing subcircuit and create a component directly (depends on multi-select)
- [x] Create a new reusable component circuit
- [x] Define external input/output ports with Component Input / Component Output blocks
- [x] Rename external ports in Inspector
- [x] Save custom component definition in library
- [x] Instantiate custom component multiple times
- [x] Open/drill into a custom component from Inspector
- [x] Breadcrumb navigation and Back
- [x] Custom components may contain other custom components
- [x] Recursive multi-level drill-down works for combinational components
- [x] Custom block behavior is evaluated from its internal circuit rather than a hard-coded shortcut
- [x] Detect indirect custom-component recursion cycles (A -> B -> A)
- [x] Preserve stateful internal runtime per instance for sequential components (Phase 15)

## Phase 9 — Persistence and project format
- [x] IndexedDB project storage
- [x] Save/load project
- [x] Autosave changed projects to IndexedDB
- [x] Automatically reopen the last active project on startup
- [x] Circuit data separated from Pixi objects
- [x] Versioned circuit serialization format
- [x] Named multiple projects
- [x] Reusable custom-component library stored with the project
- [x] Primitive-set storage
- [x] Test-suite storage
- [x] Export JSON file
- [x] Import JSON file
- [x] Migration strategy between future file-format versions

## Phase 10 — Component test system
- [x] Define input/output contract
- [x] Expected-output test cases
- [x] Automatic truth-table testing
- [x] Exhaustive ternary testing for small components
- [x] Example: all `3^3 = 27` full-adder inputs
- [x] Show exact failing combinations
- [x] Regression tests for edited components
- [x] Recursive tests of hierarchical components

## Phase 11 — Benchmarking
- [x] Basic component count
- [x] Basic wire count
- [x] Evaluation count
- [x] Signal-change count
- [ ] Primitive count through hierarchy
- [ ] Circuit depth
- [ ] Critical propagation path
- [ ] Fan-out metrics
- [ ] Transition counts per test/workload
- [ ] Logical cost model
- [ ] Side-by-side implementation comparison
- [ ] Pareto comparison rather than one arbitrary global score

## Phase 12 — Native ternary architecture experiments
- [x] Establish Normalize / carry as the full-adder reference contract (27 cases)
- [x] Compare alternative primitive sets
- [x] Compare adder constructions
- [x] Compare ternary comparator constructions
- [x] Explore native 3-way selectors/routers
- [x] Explore ternary control signals
- [x] `-1 / 0 / +1` as decrement / hold / increment where useful
- [x] `-1 / 0 / +1` as read / idle / write where architecturally useful
- [x] Record design rationale for major components
- [x] Flag binary-style two-state control where a ternary design may be better

## Phase 13 — Automatic circuit search
- [ ] Generate candidate circuits from a contract
- [ ] Exhaustively test generated candidates
- [ ] Reject incorrect candidates
- [ ] Mutate circuit graphs
- [ ] Evolutionary/genetic search
- [ ] Optimize multiple metrics: nodes, depth, wires, transitions and test coverage
- [ ] Preserve Pareto-optimal alternatives
- [ ] Open generated circuits in the normal editor

## Phase 14 — Structural ternary cell library

The simulator stops at idealized structural cells. It does not model transistors, voltages, power, noise margins or a hardware technology mapping.

- [x] Define ideal ternary device/cell abstraction boundary
- [x] Add level detector, restorer, pass switch and ideal storage node
- [x] Add device-cell exploration demo
- [x] Define structural-cell contracts and unknown/floating behavior
- [x] Preserve stateful runtime per reusable-component instance
- [x] Allow feedback only when a declared storage cell breaks the combinational path
- [x] Build an opening structural latch from device cells
- [x] Build an opening structural register from latch/cell components
- [x] Compare structural alternatives by nodes, depth, wires and transitions

## Phase 14A — Structural equivalence and accelerated execution

A component must never become a magic shortcut: every high-level behavior needs an inspectable path to the ideal ternary cell boundary. Native execution is permitted only as an accelerator for that structural behavior, never as a new logical primitive. See [ARCHITECTURE.md](ARCHITECTURE.md).

### Phase 14A.1 — Classification and visibility

- [x] Show each built-in component’s execution role, structural status and known lower-level path in Inspector
- [x] Document the initial accelerated-component inventory and distinguish cell boundaries from external adapters
- [ ] Classify every reusable/system component as structural, accelerated-equivalent or external adapter
- [ ] Store a named structural implementation reference alongside every accelerated component
- [ ] Let an accelerated component open its structural implementation directly in the editor

### Phase 14A.2 — Missing structural links

- [ ] Define a structural resolved-output/merge cell for mutually exclusive ternary pass paths
- [ ] Build and validate cell-level structural circuits for Control3, Route3 and Select3
- [ ] Build and validate cell-level structural circuits for Negate, MIN, MAX, Compare and Normalize / carry
- [ ] Record any still-missing fundamental cell before allowing a higher-level accelerator to depend on it

### Phase 14A.3 — Equivalence verification

- [ ] Run common combinational vectors against structural and accelerated forms
- [ ] Run common clock/reset/write sequences against structural and accelerated stateful forms
- [ ] Report an equivalence failure as a component regression failure
- [ ] Compare structural and accelerated forms by nodes, depth, wires, transitions and execution cost

## Phase 15 — Sequential ternary logic
- [x] Clock / sequence source model
- [x] Ternary latch experiments
- [x] Ternary register
- [x] Defined clock-edge semantics
- [x] Separate combinational settle from state commit
- [x] Reset / initial state
- [x] Register bank
- [x] Signal/register timeline

## Phase 16A — Ternary display experiments
- [x] 7-segment output component with explicit `0 / +1` segment-control contract
- [x] Visual 7-segment output for reusable components
- [x] Build an opening one-trit → 7-segment decoder from `Threshold3`, `MIN` and `MAX`
- [x] Build a fixed-range three-trit `-9 … +9` display decoder from `Threshold3`, `MIN` and `MAX`
- [x] Validate all 27 input words for the fixed-range three-trit decoder
- [x] Verify all three decoder cases: `-1`, `0`, `+1`
- [x] Record the two-state segment-control boundary
- [x] Decide how a multi-trit value is shown natively: one visible `− / 0 / +` glyph per trit, most-significant first
- [x] Defer balanced-ternary → decimal conversion until multi-trit arithmetic exists; treat it as an optional debugger/peripheral adapter
- [ ] Build the three-decimal-position `−364 … +364` peripheral only after its ternary word converter has a structural implementation

## Component sharing and demo projects
- [x] Separate reusable component library from demo-project intent
- [x] Export a reusable component with nested dependencies and saved tests
- [x] Import component packages with fresh ids and recursion validation

## Phase 16B — Six-trit datapath building blocks

This phase ends with tested, reusable word-level operations. It deliberately does not assemble a CPU or memory yet.

### Phase 16B.1 — Word representation and arithmetic

- [x] Fix the first CPU word width at 6 balanced trits (`−364 … +364`)
- [x] Build an opening reusable 6-trit word component
- [x] Validate all 729 six-trit words at the word boundary
- [x] Native ternary adder — opening 6-trit Normalize / carry ripple chain
- [x] Negation/subtraction strategy — reusable 6-trit negator feeding 6-trit ripple subtraction
- [ ] Define and test word carry/borrow and out-of-range-result policy
- [ ] Build a 6-trit comparator from proven lower-level comparison blocks
- [ ] Define word equality, less-than and greater-than outputs for CPU/control use

### Phase 16B.2 — Word routing and ALU experiments

- [ ] Build a 6-trit `Select3` word selector with one shared select trit
- [ ] Build a 6-trit router/read-path network with explicit inactive-path behavior
- [ ] Define a compact ternary ALU-operation control contract
- [ ] Compare candidate ALU operations and structures before fixing the first ALU shape
- [ ] Build an opening structural 6-trit ALU only after its operations, control and equivalence paths are justified
- [ ] Validate every chosen word operation with saved vectors, boundary values and unknown/floating behavior

## Phase 17 — Structural ternary memory

Memory is completed before CPU integration. It must be a reusable, inspectable subsystem with a stable word-level contract.

### Phase 17A — One-trit memory fabric

- [ ] Define the memory-port contract: balanced address, data-in, data-out, read/idle/write action, clock and reset
- [ ] Decide and document read latency, write edge, reset behavior and invalid/unknown-address behavior
- [ ] Build `Memory 3×1` structurally: ternary address decode, write selection, three structural registers and Select3 read path
- [ ] Make every internal decoder, selector and register openable from the memory component
- [ ] Test all addresses and read/idle/write actions across clock/reset sequences
- [ ] Verify that an idle or invalid access cannot alter stored values

### Phase 17B — Six-trit word memory

- [ ] Build `Memory 3×6` from six aligned Memory 3×1 lanes
- [ ] Guarantee one clock-edge write updates one complete 6-trit word, never a mixture of old and new trits
- [ ] Validate all 729 data words at each of the three addresses through the public memory interface
- [ ] Add word-level read probes and a native balanced-ternary word display for inspection
- [ ] Package the structural memory as a reusable component with saved regression and sequence tests

### Phase 17C — Scaled and accelerated memory

- [ ] Compose structural `9×6`, `27×6` and larger memories from the proven smaller references
- [ ] Define balanced multi-trit addressing and address-decode hierarchy for each capacity
- [ ] Measure nodes, depth, wires, transitions and simulator execution cost at each size
- [ ] Define initialization/loading and reset policy without bypassing the public memory contract
- [ ] Build a fast RAM implementation only after its named structural reference exists
- [ ] Run the same read/write/reset sequence suite against structural memory and fast RAM
- [ ] Let fast RAM open its structural reference and report equivalence failures as regressions

## Phase 18 — First ternary computer

### Phase 18A — Datapath and state

- [ ] Build a 6-trit register bank from the proven register/memory conventions
- [ ] Build program-counter storage and an `Adjust3` increment/hold/decrement path
- [ ] Connect the selected 6-trit ALU, register read paths and write-back selector
- [ ] Define CPU reset state and clocked state-transition order

### Phase 18B — Instructions, control and memory integration

- [ ] Fix a 6-trit instruction representation and field layout
- [ ] Define the smallest instruction set that exercises arithmetic, register movement, memory and branching
- [ ] Build an inspectable ternary control architecture from instruction decode to packed control trits
- [ ] Connect the CPU to the Phase 17 memory-port contract for instruction fetch and data access
- [ ] Define load/store sequencing and memory-read latency handling
- [ ] Implement conditional and unconditional branching using proven comparator outputs and PC control

### Phase 18C — Minimal runnable machine

- [ ] Load a small ternary program into the public memory interface
- [ ] Run arithmetic, memory and branch programs end-to-end
- [ ] Verify each instruction by its register, PC and memory state transitions
- [ ] Keep every CPU subsystem drillable down to its structural reference or documented cell boundary

## Phase 19 — CPU debugging
- [ ] Load a small ternary program
- [ ] Instruction step
- [ ] Clock step
- [ ] Propagation step
- [ ] Highlight active components
- [ ] Follow a trit through the CPU
- [ ] Breakpoints
- [ ] Probes
- [ ] Waveform/timeline
- [ ] Drill from CPU to primitive implementation while debugging

## v9 additions

- [x] Preserve full v6 editor UI while adding new features
- [x] Click output → click input connection using pointer-down fallback
- [x] Isolated reusable-component test panel
- [x] Set each external input to -1 / 0 / +1
- [x] Show external outputs live
- [x] Test nested reusable components through the real circuit evaluator
- [x] Save named component test cases
- [x] Exhaustive truth-table runner


## v10 additions

- [x] Shift+click multi-select
- [x] Shift+drag box selection
- [x] Move selected components as a group
- [x] Copy/paste selected subcircuits including internal wires
- [x] Rename component instances
- [x] Rename wire signals and render signal labels
- [x] Configure component X/Y placement, width, port spacing and input/output side
