# Ternary Lab v12

A static balanced-ternary circuit simulator built with plain JavaScript and PixiJS. No TypeScript, npm, bundler or backend is required.

## Run

From the project directory:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Editor controls

- Drag blocks to move them.
- Click an output, then **pointer-down/click an input** to connect.
- Or drag an output and release over an input.
- Click an already connected input to start rewiring it.
- Select a block or wire and press Delete/Backspace.
- Ctrl/Cmd+Z = undo.
- Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo.
- Drag empty background to pan; mouse wheel zooms.

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

The most useful next editor feature is multi-select / box selection followed by **Create component from selection**. That will let an already-built subcircuit be encapsulated directly instead of creating a new reusable component workspace first.


## v9 patch notes

This version intentionally keeps the complete v6 UI and editor behavior. It adds:

- reliable click-to-click connection fallback on canvas pointer-down
- isolated reusable-component testing in the existing right panel
- `-1 / 0 / +1` buttons for every external Component Input
- live external Component Output values
- Component Input blocks can also be clicked directly to cycle their test value

The component test uses the real internal circuit, including nested reusable components.

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
