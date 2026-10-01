# Ternary Lab

A static balanced-ternary circuit simulator built with plain JavaScript and PixiJS. No TypeScript, npm, bundler or backend is required.

## Run

Just open the index.html in a web browser

You can also run in NodeJs with **npx serve . -l 3000**

## Editor controls

- Drag blocks to move them.
- Click an output, then **pointer-down/click an input** to connect.
- Or drag an output and release over an input.
- Click an already connected input to start rewiring it.
- Select a block or wire and press Delete/Backspace.
- Ctrl/Cmd+Z = undo.
- Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo.
- Drag empty background to pan; mouse wheel zooms.
- Use **Auto layout** to arrange connected components in signal-flow columns without overlap.

## Signal states

`-1`, `0` and `+1` are driven logical ternary values. `?` means unknown or unresolved. `Z` means a pass switch deliberately does not drive the wire (floating); ordinary logic needs a driven input and therefore returns `?` for `Z`. A purely combinational feedback loop is rejected. A loop is allowed only when its path crosses an explicitly declared stateful component, such as `Storage node` or a structural latch that contains one.

## Reusable / hierarchical components

Version 6 adds reusable circuit-backed components.

1. Press **New component**.
2. The component opens as its own circuit.
3. Use **Component Input** blocks for external inputs.
4. Use **Component Output** blocks for external outputs.
5. Select a boundary block and rename its external port in the Inspector.
6. Build the internal logic from primitives or other reusable components.
7. Press **Back** (or Save) to update the definition.
8. The component appears under **Reusable components** and can be instantiated multiple times.
9. Select a reusable instance and press **Open internals** in Inspector to drill into it.
10. Reusable components may contain other reusable components, so you can drill down through multiple levels.

To extract an existing design, Shift+click or box-select its blocks, then choose **Create component from selection** in Inspector. Internal wiring moves into the new reusable component; connections crossing the selection edge become named Component Input/Output ports. Component dependency cycles, including indirect cycles such as `A → B → A`, are rejected.

Reusable components can be removed from the library with **Remove**. Removal is blocked while the component is still instantiated in the project or referenced by another reusable component.

Breadcrumbs show the current hierarchy, for example:

`Project > ALU > Adder > Normalize`

The direct self-reference of a component is hidden while editing that component. General cycle detection between custom definitions is a later task.

### Current hierarchy model

Custom components are real circuit definitions, not visual groups. Their public ports are derived from the `Component Input` and `Component Output` boundary blocks. During simulation, a custom block evaluates its internal circuit, so nested custom components work recursively.

Reusable components retain a separate serialized internal runtime for every placed instance. This means a nested `storage-node3` or other stateful primitive holds its value between evaluations without leaking state to another instance. Saving a changed reusable definition increments its runtime version, so existing instances safely reinitialize from the new structure.

## Project files

Phase 12 component decisions and the CPU control-signal audit are recorded in [DESIGN.md](DESIGN.md).

- `index.html` — static application shell
- `styles.css` — application styling
- `js/core.js` — ternary values, circuit model, custom-component evaluation
- `js/renderer.js` — PixiJS workspace/editor rendering and interaction
- `js/storage.js` — IndexedDB storage
- `js/app.js` — UI, navigation, history, reusable component library
- `ROADMAP.md` — complete Phase 1–17 checklist

## Known next steps

The next major editor milestone is stateful sequential components: explicit clock-edge semantics, registers and per-instance internal runtime. That is the foundation for a ternary CPU's program counter and register bank.


## v9 patch notes

This version intentionally keeps the complete v6 UI and editor behavior. It adds:

- reliable click-to-click connection fallback on canvas pointer-down
- isolated reusable-component testing in the existing right panel
- `-1 / 0 / +1` buttons for every external Component Input
- live external Component Output values
- Component Input blocks can also be clicked directly to cycle their test value

The component test uses the real internal circuit, including nested reusable components.

Saved component tests live below the input/output controls while editing a reusable component. Give the current setup a name and choose **Save current** to store its input values and current outputs as an expected-result regression case. **Run saved** reports every failing port. **Run all combinations** produces the full ternary truth table (`3^n` rows) for components with up to six inputs.

Before saving a test, set its expected output values explicitly in **Expected outputs for next saved case**. If a later edit removes a port used by a saved test, the runner reports that its component contract changed instead of silently treating the test as valid.

Use **Demo** to load a self-contained experiment. Loading any demo replaces the root circuit, reusable-component library and saved component tests, so the selected demo is always shown on its own. The Full Adder reference has `a`, `b`, `c` inputs and `sum`, `carry` outputs; its saved suite covers all 27 ternary input combinations.

## Phase 12 adder experiments

`Normalize / carry` is the reference full-adder implementation. Every alternative must expose the same `a`, `b`, `c` → `sum`, `carry` contract and pass the same 27 saved cases before it is considered a candidate. Record its primitive set, node count and design rationale alongside the component; do not replace the reference implementation.

Choose **Adder comparison** in the Demo menu to create three saved full-adder implementations: a one-node Normalize reference, an a+b cascaded-normalize construction, and a b+c pairwise cascade. All have the same exhaustive 27-case suite. Selecting an instance shows its primitive inventory, logical node count, critical depth and rationale in the Inspector; comparison is intentionally limited to logical structure and behavior.

Choose **Primitive set comparison** in the Demo menu to create a full-adder baseline for every current preset set. The result is deliberately recorded rather than hidden: every current set includes `Normalize / carry`, so all four implement the contract in one primitive node and pass the same 27 cases. Their extra primitives are therefore not a full-adder advantage yet; they remain candidates for the following comparator, selector and control experiments.

Choose **Comparator comparison** in the Demo menu to compare a direct `Compare` reference with normalized-difference candidates. The candidate creates a stable zero using `Normalize(a,a,a).sum`, normalizes `a-b`, and uses `Select3` to preserve the sign across a normalized overflow. Each comparator has the `a`, `b` → `out` contract and an exhaustive 9-case suite.

Choose **Selector / router** to inspect `Select3` (`neg, zero, pos, select → out`) and its reciprocal `Route3` (`in, select → neg, zero, pos`). Their saved suites cover 81 and 9 cases. Inactive Route3 paths are deliberately driven to zero.

Choose **Ternary control signals** to test `Adjust3`: `-1 / 0 / +1` means decrement / hold / increment and exposes carry for a multi-trit program counter. The same demo also records `-1 / 0 / +1` as read / idle / write. That action remains one packed trit; its three one-hot outputs are an explicit adapter only when separate downstream paths require it.

This is the design decision for the CPU path: retain the packed control trit through the datapath and only decode it at an explicit downstream branch. `Adjust3` is the intended PC/running-counter primitive; `Control3 decode` is intentionally not a general replacement for ternary control, but the boundary adapter for distinct read, idle and write hardware paths.

Component and test-case names are unique within their respective project scopes. If a name is already used, Ternary Lab assigns the next available suffix, such as `Adder 2`.

Component Input and Component Output ports are named uniquely as soon as they are added: `in`, `in 2`, … and `out`, `out 2`, …. Renaming a port uses the same rule.

## Ternary sequential storage

Choose **Ternary latch / register** in the Demo menu to load the storage experiment. The **Ternary latch** is transparent only while `enable = +1`; `0` and `-1` hold its current trit. The **Ternary register** is a hardware-like D flip-flop: it captures `d` only when `load = +1` and `clock` transitions from `0` to `+1`. Changing data while the clock stays high does not alter `q`. A new storage element begins as `?` until reset is clocked.

The demo uses ordinary Trit Inputs for `D`, `LOAD`, `CLK` and `RESET`: set `D` and `LOAD` to `+1`, then change `CLK` from `0` to `+1`. The register updates automatically; there is no simulator-only commit control. Use `0` before the next pulse. Reset is synchronous: set reset to `+1` and provide a rising clock edge to restore the initial value `0`.

## v12 simulation controls and sequence generators

The propagation scheduler is persistent and inspectable instead of always being hidden inside a full settle.

- **RUN** — normal editing; changes settle immediately.
- **VISUALIZE** — executes one real propagation event at a configurable interval.
- **Pause / Resume** — pauses both propagation and automatic sequence generators.
- **STEP** — executes exactly one queued component-evaluation event.
- **CLOCK STEP** — advances every Sequence Generator by exactly one item in its sequence.
- **Event queue** — shows queued component evaluations and why they were scheduled.
- **Settle circuit now** — drains the current queue immediately regardless of UI mode.

### Sequence Generator

The old fixed clock is replaced in the component library by a configurable **Sequence Generator**. It can act as a conventional clock or as a ternary periodic control source. Select it to configure it in Inspector.

Built-in presets:

- `0 ↔ +1` clock
- `-1 → 0 → +1 → -1 ...` ternary loop
- `-1 → 0 → +1 → 0 → -1 ...` ternary ping-pong
- custom sequences such as `0, 0, +1, 0, -1`

Each generator has its own interval (milliseconds), loop/ping-pong mode and optional auto-run. The interval controls when the generator advances; VISUALIZE speed still controls how quickly queued logical propagation events are displayed.

The legacy `Clock` type is retained internally so older saved projects can still load. New circuits should use Sequence Generator.


## v13 primitive experiments

The primitive library can now be switched between experiment sets without invalidating existing circuits. Current candidate primitives include `MIN`, `MAX`, and `Normalize / carry` (`A+B+C = Sum + 3×Carry`). Each candidate carries logical structural metadata. The project deliberately does not estimate transistor count, voltage encoding, delay or power.

Preset sets include **All candidates**, **MIN / MAX**, **Compare / Select**, **Arithmetic core**, plus a **Custom experiment** assembled with checkboxes. The active experiment is saved with the project.

## Project persistence

Projects are stored locally in the browser with IndexedDB. **New project** creates a separate empty project with the next available name (`New project`, `New project 2`, and so on); duplicate project names are rejected. Choose a project in the **Project** menu and use **Delete project** to remove it after confirmation. The active project is autosaved when it changes and the most recently used project is reopened on the next start.

- Use **New project** to create another named project.
- Rename the current project in the name field in the top toolbar.
- The project selector switches between locally saved projects.
- **Save now** forces an immediate save; normal editing is autosaved about every 1.5 seconds.
- **Export JSON** creates a portable `.ternary.json` backup.
- **Import JSON** imports older/current project files and stores the imported project locally.
- Primitive-set selection, reusable components and the test-suite storage slot are part of the project format.
- Project format version 6 includes a migration entry point so older project data can be upgraded when loaded.


## Technology-neutral device cells

Signal states are distinct: `-1`, `0` and `+1` are driven logic levels; `?` means unknown/unresolved; `Z` means a switch deliberately drives no value (floating). In this single-driver simulator, ordinary logic and a restorer treat `Z` as unavailable and return `?`.

Choose **Structural latch / register** to compare behavioral reference blocks with their opening structural versions. Select **Register — two structural latches**, choose **Open internals**, then open either latch to reach its restorer, pass switch and storage node. The shared input controls drive both versions, so their probes can be compared directly. The Inspector gives the same comparison dimensions for every option: nodes, depth, wires and canonical write transitions.

Choose **Ternary device cells** to explore the new lower abstraction layer. **Ternary restorer**, **Ternary level detector**, **Ternary pass switch** and **Ternary storage node** are ideal structural cells: they define level restoration, detection, gated transmission and retention without choosing a transistor technology. A disabled pass switch emits `Z`; this is distinct from an unresolved `?`.

## 7-segment output

Choose **7-segment display** to load a visible output component with eight independent inputs: `A`–`G` and `Sign`. This peripheral intentionally uses two-state control: `0` means off and `+1` means on. A `-1`, `?` or `Z` input is rendered as an invalid segment state instead of silently becoming off. The display contains no number decoder; the future ternary decoder will be a separate, openable logic component that drives these eight ports. When editing a reusable component, choose **7-segment Output** under **Component interface** to make this visual display the component’s visible output; connect internal logic to its A–G/Sign ports.

**Segment-control boundary:** the display is deliberately a two-state peripheral. Inside a decoder, signals remain ternary and `-1 / 0 / +1` may each have a meaning. At its final boundary, each LED-like segment only needs **off** or **on**, represented by `0 / +1`. This conversion is explicit and openable; `-1`, `?` and `Z` are kept visible as invalid instead of being coerced to off.

Choose **1-trit signed display decoder** for the smallest open decoder. Its sole trit maps to `-1`, `0` and `+1`. Open it to see the complete construction: `Threshold3` produces one-hot rails, `MAX` creates the shared segments for digit 1, and `MIN` produces an explicit off signal for the middle segment. Its three input cases are checked exhaustively.

Choose **3-trit signed display decoder** to load an opening fixed-range experiment. Its inputs have weights `9`, `3` and `1`; the 19 words for `-9 … +9` show a signed decimal digit, while the eight remaining three-trit words are blank. Its gate-level mapping has been checked across all 27 input words. Open the component to inspect the full gate network: three level detectors, exact-match MIN chains, and MAX trees for each segment.

**First CPU word decision:** the first CPU uses six balanced trits, covering `−364 … +364` (729 states). It is deliberately small enough to keep the first register, ALU and display experiments open and understandable.

**Native multi-trit display decision:** CPU words will be shown directly as a row of `−`, `0` and `+` glyphs, one per trit with the most-significant trit on the left. For example, `+ 0 −` means `(+1 × 9) + (0 × 3) + (−1 × 1) = +8`. This has no separate sign trit and requires no number conversion. Balanced-ternary-to-decimal display is deferred until multi-trit arithmetic exists. It will be an optional, opening peripheral made from reusable parts: a six-trit word converter, digit decoders and three 7-segment displays. Three decimal positions comfortably cover the first CPU range, `−364 … +364`.

## Six-trit CPU word

Choose **6-trit word component** to load the reusable word boundary for the first CPU. It carries `t5 … t0` unchanged in most-significant-first order, with weights `243, 81, 27, 9, 3, 1`. It is intentionally neither a register nor an ALU: it establishes a clear six-lane interface which later reusable components can share. Every one of its 729 possible input words is saved as a contract case.

## Six-trit ripple adder

Choose **6-trit ripple adder** to load the first reusable CPU arithmetic block. It accepts `A5 … A0`, `B5 … B0` and `Carry in`, then produces `Sum5 … Sum0` and `Carry out`. Open it to see six `Normalize / carry` cells. Carry begins at the least-significant `t0` cell and ripples toward `t5`; the output represents `A + B + Carry in = Sum + 729 × Carry out`.

## Register bank

**Ternary register bank** demo provides three stored trits addressed by `-1 / 0 / +1`. Its action input is `-1 = read`, `0 = idle`, `+1 = write`; a write occurs on the clock rising edge when action is `+1`.
