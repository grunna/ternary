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
- [ ] Decide how a multi-trit value is shown natively
- [ ] Defer balanced-ternary → decimal conversion until multi-trit arithmetic exists

## Phase 16B — CPU building blocks
- [ ] Native ternary adder
- [ ] Negation/subtraction strategy
- [ ] Comparator
- [ ] Selector/router network
- [ ] ALU only after primitive/operation experiments justify its shape
- [ ] Register bank
- [ ] Program-counter strategy
- [ ] Instruction representation
- [ ] Control architecture
- [ ] Memory interface
- [ ] Branching
- [ ] Minimal runnable ternary CPU

## Phase 17 — CPU debugging
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
