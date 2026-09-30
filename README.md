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

## Signal states

`-1`, `0` and `+1` are logical ternary values. An unconnected or unresolved port is shown as `?`, rather than being treated as logical zero. Connecting a wire that would create a combinational feedback loop is rejected; sequential feedback will be introduced later with explicit stateful components.

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

For now custom components are intended for combinational logic. Sequential/stateful custom-component runtime semantics will be designed with Phase 15.

## Project files

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

Use **Demo** to create a reusable ternary Full Adder with `a`, `b`, `c` inputs and `sum`, `carry` outputs. Its saved suite covers all 27 ternary input combinations.

Component and test-case names are unique within their respective project scopes. If a name is already used, Ternary Lab assigns the next available suffix, such as `Adder 2`.

Component Input and Component Output ports are named uniquely as soon as they are added: `in`, `in 2`, … and `out`, `out 2`, …. Renaming a port uses the same rule.

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

The primitive library can now be switched between experiment sets without invalidating existing circuits. Current candidate primitives include `MIN`, `MAX`, and `Normalize / carry` (`A+B+C = Sum + 3×Carry`). Each candidate carries logical-cost metadata and a physical-cost record. Physical transistor/delay/power values intentionally remain `unmodeled` until a concrete hardware implementation is selected.

Preset sets include **All candidates**, **MIN / MAX**, **Compare / Select**, **Arithmetic core**, plus a **Custom experiment** assembled with checkboxes. The active experiment is saved with the project.

## Project persistence

Projects are stored locally in the browser with IndexedDB. The active project is autosaved when it changes and the most recently used project is reopened on the next start.

- Use **New project** to create another named project.
- Rename the current project in the name field in the top toolbar.
- The project selector switches between locally saved projects.
- **Save now** forces an immediate save; normal editing is autosaved about every 1.5 seconds.
- **Export JSON** creates a portable `.ternary.json` backup.
- **Import JSON** imports older/current project files and stores the imported project locally.
- Primitive-set selection, reusable components and the test-suite storage slot are part of the project format.
- Project format version 6 includes a migration entry point so older project data can be upgraded when loaded.
