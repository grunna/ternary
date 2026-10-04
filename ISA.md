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

An instruction completes in fetch then execute. Fetch reads the instruction word at PC; execute performs its operation and normally increments PC. Reads from `Memory 27×6` are combinational within their phase, while writes commit on the execute clock edge.

## Opcodes

| Opcode | Syntax | Effect |
| --- | --- | --- |
| `− − −` | `HALT` | Stop the CPU. PC and registers retain their values. |
| `− − 0` | `MOV Rd, Ra` | `Rd ← Ra`. |
| `− − +` | `ADD Rd, Ra, Rb` | `Rd ← Ra + Rb`, wrapped to the six-trit range `−364 … +364`. |
| `− 0 −` | `SUB Rd, Ra, Rb` | `Rd ← Ra − Rb`, using the same wrapping rule. |
| `− 0 0` | `LOAD Rd, [Ra]` | Read memory at the low three trits of `Ra`, then write the returned word to `Rd`. |
| `− 0 +` | `STORE [Ra], Rb` | Write `Rb` to memory at the low three trits of `Ra`. `Rd` is ignored. |
| `− + −` | `JUMP Ra` | Load PC with the low three trits of `Ra`, zero-prefixed to six trits. |
| `− + 0` | `BRZ Ra, Rb` | If `Ra` is exactly zero, load PC from the low three trits of `Rb`; otherwise continue normally. |
| `− + +` | `NOP` | No data operation; advance PC normally. |
| `+ − −` | `LIT Rd, Imm1, Imm0` | Write the two-trit balanced literal `Imm1 Imm0` (`−4 … +4`) to `Rd`. `Ra` and `Rb` are literal digits, not register addresses. |

All remaining 17 opcodes are reserved. A reserved or malformed instruction is a safe no-op: it does not write registers, memory or PC.

## Addressing

`Memory 27×6` has three-trit balanced addresses `−13 … +13`. `LOAD`, `STORE`, `JUMP` and a taken `BRZ` take an address from the three least-significant trits of their address register.

To preserve a balanced-ternary value when placing it in the six-trit PC, addresses are zero-prefixed:

```text
a2 a1 a0  →  0 0 0 a2 a1 a0
```

The reset PC is address `0`. Negative locations are still usable for data, code reached by a jump, or later system conventions.

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
