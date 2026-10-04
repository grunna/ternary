'use strict';
const assert = require('assert'); global.window = global; require('../js/core.js');
const { CPU_OPCODES, decodeInstruction6 } = global.TernaryCore;
for (const [mnemonic, opcode] of Object.entries(CPU_OPCODES)) {
  const decoded = decodeInstruction6([...opcode, 1, 0, -1]);
  assert.strictEqual(decoded.mnemonic, mnemonic, `${mnemonic} opcode must decode`);
  assert.strictEqual(decoded.valid, true);
}
assert.deepStrictEqual(decodeInstruction6([...CPU_OPCODES.ADD, -1, 0, 1]), { valid: true, rd: -1, ra: 0, rb: 1, registerWrite: 1, writeBackSelect: 1, aluOperation: 1, memoryAction: 0, pcLoad: 0, pcControl: 1, halt: 0, branchIfZero: 0, mnemonic: 'ADD' });
assert.deepStrictEqual(decodeInstruction6([...CPU_OPCODES.LOAD, 1, -1, 0]).memoryAction, -1);
assert.deepStrictEqual(decodeInstruction6([...CPU_OPCODES.STORE, 1, -1, 0]).memoryAction, 1);
assert.strictEqual(decodeInstruction6([0, 0, 0, 0, 0, 0]).mnemonic, 'RESERVED');
assert.strictEqual(decodeInstruction6([null, 0, 0, 0, 0, 0]).mnemonic, 'INVALID');
console.log('Instruction-decode contract passed: all defined opcodes, reserved words and invalid words produce safe packed controls.');
