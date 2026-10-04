# Opening ternary CPU ISA

This is the executable instruction-set reference for the first six-trit balanced-ternary CPU.

## Word and register format

One instruction is one six-trit word, most-significant trit first:

```text
Op2 Op1 Op0 Rd Ra Rb
```

`Rd`, `Ra` and `Rb` normally select one of the three six-trit registers:

| Trit | Register |
| --- | --- |
| `−` | `R−` |
| `0` | `R0` |
| `+` | `R+` |

An instruction completes in fetch then execute. Fetch reads the instruction word at PC; execute performs its operation and normally increments PC. Reads from the attached memory are combinational within their phase, while writes commit on the execute clock edge.

## Opcodes

| Opcode | Syntax | Effect |
| --- | --- | --- |
| `− − −` | `HALT` | Stop the CPU. PC and registers retain their values. |
| `− − 0` | `MOV Rd, Ra` | `Rd ← Ra`. |
| `− − +` | `ADD Rd, Ra, Rb` | `Rd ← Ra + Rb`, wrapped to the six-trit range `−364 … +364`. |
| `− 0 −` | `SUB Rd, Ra, Rb` | `Rd ← Ra − Rb`, using the same wrapping rule. |
| `− 0 0` | `LOAD Rd, [Ra]` | Read memory at the full six-trit address in `Ra`, then write the returned word to `Rd`. |
| `− 0 +` | `STORE [Ra], Rb` | Write `Rb` to the full six-trit address in `Ra`. `Rd` is ignored. |
| `− + −` | `JUMP Ra` | Load PC with the full six-trit value in `Ra`. |
| `− + 0` | `BRZ Ra, Rb` | If `Ra` is exactly zero, load PC from the full six-trit value in `Rb`; otherwise continue normally. |
| `− + +` | `NOP` | No data operation; advance PC normally. |
| `+ − −` | `LIT Rd, Imm1, Imm0` | Write the two-trit balanced literal `Imm1 Imm0` (`−4 … +4`) to `Rd`. `Ra` and `Rb` are literal digits, not register addresses. |

All remaining 17 opcodes are reserved. A reserved or malformed instruction is a safe no-op: it does not write registers, memory or PC.

## Addressing

`Memory 27×6` exposes the low three PC/address lanes, so it addresses `−13 … +13`. `Memory 729×6` exposes all six lanes, so it addresses `−364 … +364`. The CPU always produces and consumes full six-trit addresses; the small memory simply uses its low three lanes.

The reset PC is address `0`. Negative locations are still usable for data, code reached by a jump, or later system conventions.

## Writing a program in the console

Choose **Write program** in a runnable CPU console. Write one instruction per line; lines begin at address `0` unless an explicit decimal address is given:

```text
LIT R-, -, -
LIT R0, 0, +
2: ADD R+, R0, R0
HALT
```

`#` and `;` start comments. `R−`, `R0` and `R+` name registers (plain `R-` is accepted too). Use `.ORG 20` to continue at a different address, or `.WORD − 0 + 0 0 0` to place ordinary data. **Validate & load** loads through the public memory port and leaves the CPU stopped at PC `0`.

## Interactive I/O console map

`Interactive CPU I/O console (729×6)` adds a transparent memory-mapped adapter. Normal addresses still access RAM. Once loading is complete, these addresses access the existing ternary joystick and Pixel Display 3×3:

| Address | Operation | Word |
| --- | --- | --- |
| `−4` | `LOAD` joystick X | `0 0 0 x 0 0` |
| `−3` | `LOAD` joystick Y | `0 0 0 0 y 0` |
| `+4` | `STORE` display command | `t2 t1 t0` are display `x y color` |

The built-in I/O example reads X and Y, adds their packed words, adds a `+` color, then stores the result at `+4` in a loop. Each command clears the old position and writes one bounded pixel. Move the on-canvas joystick while it runs to change direction/position.

## Example program

This program creates `−4` and `+1`, adds `1 + 1`, stores the result at address `−4`, loads it back into `R0`, then stops.

| Address | Instruction |
| --- | --- |
| `0` | `LIT R−, −, −` |
| `1` | `LIT R0, 0, +` |
| `2` | `ADD R+, R0, R0` |
| `3` | `STORE [R−], R+` |
| `4` | `LOAD R0, [R−]` |
| `5` | `HALT` |

After `HALT`, `R0` and memory address `−4` both hold balanced value `+2`.
