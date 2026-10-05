# Tutorial 2 – Create a reusable component

Here you package a small circuit that can be used more than once. Reusable components are real internal circuits, not merely visual groups.

## 1. Create the component

Choose **New component**. A new internal workspace opens. The breadcrumbs at the top show where you are, for example `Project > My component`.

## 2. Define its interface

Under *Component interface*, place:

1. One **Component Input**, then rename its port to `in` in Inspector.
2. One **Component Output**, then rename its port to `out`.

Place a **Negate** between them and connect `in → Negate → out`.

## 3. Test before leaving the component

Select Component Input. Inspector has `-1`, `0`, and `+1` buttons; try each and verify that Component Output shows the opposite. Optionally save a named test case so the contract can be run again after future changes.

## 4. Use the block in a project

Go back using **Back**, or save. The component now appears under *Reusable components*. Place two instances in the project, give each a trit input, and observe them with LEDs.

Each instance has its own internal state if the component contains registers or memory. The instances still share the saved construction and port contract.

## Open the right level

Select an instance and choose **Open internals** to see that instance's internal circuit. Components with a separate reference implementation may instead offer **Open structural implementation** first. Follow both routes when they exist: the first shows the package's own internals, while the second shows how optimized behavior is structurally specified.

Next, continue to [Tutorial 3: Run and debug a program](03-cpu-program.md).
