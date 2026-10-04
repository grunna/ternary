'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, CPU_OPCODES, balancedWordDigits } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];
const circuit = new Circuit(registry);
const memory = circuit.addComponent('memory27x6', 0, 0);
const cpu = circuit.addComponent('cpu6', 0, 0);
const cpuClock = circuit.addComponent('trit-input', 0, 0, { value: 0 });
const memoryClock = circuit.addComponent('trit-input', 0, 0, { value: 0 });
const cpuReset = circuit.addComponent('trit-input', 0, 0, { value: 0 });
const memoryReset = circuit.addComponent('trit-input', 0, 0, { value: 0 });
lanes.forEach((lane) => { circuit.connect(memory.id, `dataOut${lane}`, cpu.id, `memoryData${lane}`); circuit.connect(cpu.id, `memoryWrite${lane}`, memory.id, `dataIn${lane}`); });
['2', '1', '0'].forEach((lane) => circuit.connect(cpu.id, `address${lane}`, memory.id, `address${lane}`));
circuit.connect(cpu.id, 'memoryAction', memory.id, 'action'); circuit.connect(cpuClock.id, 'out', cpu.id, 'clock'); circuit.connect(memoryClock.id, 'out', memory.id, 'clock'); circuit.connect(cpuReset.id, 'out', cpu.id, 'reset'); circuit.connect(memoryReset.id, 'out', memory.id, 'reset');
const pulse = (source) => { circuit.setState(source.id, { value: 0 }); circuit.simulate(); circuit.setState(source.id, { value: 1 }); circuit.simulate(); circuit.flushSequentialState(); circuit.simulate(); };
const writeMemory = (address, word) => {
  const writer = Object.fromEntries([...lanes.map((lane) => [`dataIn${lane}`, circuit.addComponent('trit-input', 0, 0, { value: word[lanes.indexOf(lane)] })]), ...['2', '1', '0'].map((lane, index) => [`address${lane}`, circuit.addComponent('trit-input', 0, 0, { value: balancedWordDigits(address, 3)[index] })]), ['action', circuit.addComponent('trit-input', 0, 0, { value: 1 })]]);
  Object.entries(writer).forEach(([port, source]) => circuit.connect(source.id, 'out', memory.id, port));
  circuit.connect(memoryClock.id, 'out', memory.id, 'clock');
  pulse(memoryClock);
  lanes.forEach((lane) => circuit.connect(cpu.id, `memoryWrite${lane}`, memory.id, `dataIn${lane}`));
  ['2', '1', '0'].forEach((lane) => circuit.connect(cpu.id, `address${lane}`, memory.id, `address${lane}`));
  circuit.connect(cpu.id, 'memoryAction', memory.id, 'action');
};
const instruction = (opcode, rd = 0, ra = 0, rb = 0) => [...opcode, rd, ra, rb];

// Reset reaches both public state ports before program loading.
circuit.setState(memoryReset.id, { value: 1 }); pulse(memoryClock); circuit.setState(memoryReset.id, { value: 0 }); circuit.simulate();
// LIT R−, −, − = −4; LIT R0, 0, + = +1; ADD R+,R0,R0; STORE [R−],R+; LOAD R0,[R−]; HALT.
writeMemory(0, instruction(CPU_OPCODES.LIT, -1, -1, -1));
writeMemory(1, instruction(CPU_OPCODES.LIT, 0, 0, 1));
writeMemory(2, instruction(CPU_OPCODES.ADD, 1, 0, 0));
writeMemory(3, instruction(CPU_OPCODES.STORE, 0, -1, 1));
writeMemory(4, instruction(CPU_OPCODES.LOAD, 0, -1, 0));
writeMemory(5, instruction(CPU_OPCODES.HALT));
circuit.connect(cpuClock.id, 'out', memory.id, 'clock');
circuit.setState(cpuReset.id, { value: 1 }); pulse(cpuClock); circuit.setState(cpuReset.id, { value: 0 });
for (let step = 0; step < 12; step += 1) pulse(cpuClock);
assert.strictEqual(cpu.outputs.halted, 1, 'program halts after fetch/execute pairs');
assert.deepStrictEqual(lanes.map((lane) => cpu.outputs[`rZero${lane}`]), balancedWordDigits(2), 'LOAD receives the word written by STORE through the public memory port');
assert.deepStrictEqual(memory.state.values[-4 + 13], balancedWordDigits(2), 'STORE commits its word at the selected public memory address');

// A separate branch program proves a taken BRZ loads the PC target and reaches HALT.
writeMemory(0, instruction(CPU_OPCODES.LIT, -1, 1, 1));
writeMemory(1, instruction(CPU_OPCODES.LIT, 0, 0, 0));
writeMemory(2, instruction(CPU_OPCODES.BRZ, 0, 0, -1));
writeMemory(3, instruction(CPU_OPCODES.NOP));
writeMemory(4, instruction(CPU_OPCODES.HALT));
circuit.connect(cpuClock.id, 'out', memory.id, 'clock');
circuit.setState(cpuReset.id, { value: 1 }); pulse(cpuClock); circuit.setState(cpuReset.id, { value: 0 });
for (let step = 0; step < 10; step += 1) pulse(cpuClock);
assert.strictEqual(cpu.outputs.halted, 1, 'taken BRZ reaches its sign-preserving three-trit target');

console.log('CPU6 machine contract passed: public-memory program loading, arithmetic, LOAD/STORE, BRZ, PC and halt execute end-to-end.');
