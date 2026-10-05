<p align="center">
  <img src="assets/ternary-lab-icon.png" alt="Ternary Lab icon" width="160" />
</p>

# Ternary Lab

A visual balanced-ternary sandbox: build circuits, open their implementations, simulate signals, and follow a small ternary computer from instruction to I/O.

[Get started](#get-started) · [Tutorials](tutorials/README.md) · [ISA](ISA.md) · [Design](DESIGN.md) · [Roadmap](ROADMAP.md)

## See the simulator

<p align="center">
  <img src="screenshot/small-computer.png" alt="Ternary Lab's small CPU with program memory, joystick, and 3×3 pixel display" width="900" />
</p>

The small computer has program memory, registers, an ALU, a program counter, and explicit I/O adapters. Parts can be opened down through the hierarchy where a structural implementation is available.

<p align="center">
  <img src="screenshot/7seg-display.png" alt="An inspectable structural 3-trit display decoder in Ternary Lab" width="900" />
</p>

## Get started

1. Open `index.html` in a modern browser, or run `npx serve . -l 3000`.
2. Choose an example from **Demo projects**.
3. Select a component and read its contract in the Inspector panel.
4. Use **Open internals** or **Open structural implementation**, when available, to descend one level.

For a first circuit, follow [Tutorial 1: Your first circuit](tutorials/01-your-first-circuit.md). For the CPU, begin with [Tutorial 3: Run and debug a program](tutorials/03-cpu-program.md).

## What can it build?

- Ternary combinational logic with `-1`, `0`, `+1`, and explicit `Z` and `?` states.
- Reusable, nested components with named ports and saved contract tests.
- Sequential logic: latches, registers, memory, clocks, and program counters.
- A six-trit CPU with loadable programs, stepping, tracing, and breakpoints.
- Human I/O including a joystick, word displays, a seven-segment display, and a 3×3 pixel display.

## Tutorials

The guides are short and build on one another. They are meant to be followed in the simulator, not merely read.

| Guide | You will learn |
| --- | --- |
| [1. Your first circuit](tutorials/01-your-first-circuit.md) | Place, connect, and try a simple trit circuit. |
| [2. Create a reusable component](tutorials/02-reusable-component.md) | External ports, internal circuits, and hierarchy. |
| [3. Run and debug a program](tutorials/03-cpu-program.md) | Load programs, step the CPU, and read program memory. |
| [4. Debug signals and the CPU](tutorials/04-debugging.md) | Probes, timeline, tracing, and breakpoints. |

## Documentation

| Document | Contents |
| --- | --- |
| [tutorials/](tutorials/README.md) | Practical step-by-step guides with screenshots. |
| [ISA.md](ISA.md) | Current CPU instructions and the direction for Base ISA and `EXT`. |
| [DESIGN.md](DESIGN.md) | Technical decisions, component contracts, and architecture notes. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The principle that behavioral components should be structurally inspectable. |
| [ROADMAP.md](ROADMAP.md) | Completed work and upcoming phases. |

## Working in the editor

- Drag components to move them and drag the background to pan.
- Click an output and then an input to connect, or drag directly between them.
- Click a connected input to rewire it. Delete/Backspace removes selected objects.
- The mouse wheel zooms. Ctrl/Cmd+Z undoes and Ctrl/Cmd+Y redoes.
- **RUN**, **VISUALIZE**, **STEP**, and **CLOCK STEP** control simulation progress.

`-1`, `0`, and `+1` are driven logic levels. `Z` means a floating disconnected signal and `?` means an unknown or unresolved signal. Combinational feedback loops are rejected; storage must pass through an explicitly stateful component.

## Projects and sharing

Projects are stored locally in the browser. You can create several projects, export/import `.ternary.json` files, and share reusable components as `.ternary-component.json` packages. CPU programs can be loaded, written, imported, and exported from the **Program** menu.

## Architecture principle

The simulator may use fast reference implementations, but not opaque magic blocks. A high-level component should have an inspectable structural path down to the project's technology-neutral cell boundary. Optimized execution is a faster way to execute the same specified behavior, not different semantics.

## Source map

- `index.html` — application shell and menus.
- `styles.css` — interface styling.
- `js/core.js` — ternary values, circuit model, and component evaluation.
- `js/renderer.js` — PixiJS workspace and interaction.
- `js/storage.js` — local IndexedDB storage.
- `js/app.js` — UI, demos, CPU tools, and component library.

Detailed historical decisions and component descriptions deliberately live in [DESIGN.md](DESIGN.md), keeping this front page a quick way into the project.
