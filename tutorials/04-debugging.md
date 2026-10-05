# Tutorial 4 – Debug signals and the CPU

When a circuit produces the wrong value, the goal is to find the **first point where a signal differs from expectation**. Start narrow and follow the signal forward instead of trying to read the whole workspace at once.

## Signals in an ordinary circuit

1. Select the wire or component and read its value in Inspector.
2. Add a **Probe**, **Trit LED**, or **6-trit word probe** near the point under investigation.
3. Use **STEP** for one propagation event or **VISUALIZE** to watch several events slowly.
4. Check `Z` or `?` first. A later `?` is often only the consequence of an earlier error.

## Debug the CPU

CPU demos provide tools under **Debug**:

- Add a breakpoint at the current PC to stop when a specific instruction is reached.
- Trace PC, instruction, memory access, or a register to add a clear event to the state timeline.
- Add a word probe for a register when you need to see all six trits together.
- Open CPU architecture when you need to follow a control signal between registers, decoder, memory port, and program counter.

Step one instruction, then compare PC, instruction row, and the registers that instruction should change. For memory instructions, you often need to inspect two stages: address/read and the later write-back.

## Common causes

| Symptom | Check first |
| --- | --- |
| Nothing happens | The clock's rising `0 → +1` edge and whether reset is still active. |
| A value becomes `?` | Inputs, floating `Z`, and whether a component lacks a required connection. |
| The program branches incorrectly | PC, branch condition, and the decoded instruction at the current memory row. |
| The display does not change | That the CPU truly performs an I/O or memory write and the display receives its clock edge. |

When you find a recurring failure, save a component test or export the program together with a brief note about which step should produce a different result.
