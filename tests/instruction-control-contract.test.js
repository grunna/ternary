'use strict';
const assert = require('assert'); global.window = global; require('../js/core.js');
const { Circuit, registry, CPU_OPCODES } = global.TernaryCore;
const circuit = new Circuit(registry), control = circuit.addComponent('instruction-control6', 0, 0), sources = {};
for (const name of registry.get('instruction-control6').inputs) { sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 }); circuit.connect(sources[name].id, 'out', control.id, name); }
function set(values) { Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value })); circuit.simulate(); }
function instruction(opcode, rd = 0, ra = 0, rb = 0) { return { instruction5: opcode[0], instruction4: opcode[1], instruction3: opcode[2], instruction2: rd, instruction1: ra, instruction0: rb }; }
set({ ...instruction(CPU_OPCODES.ADD, 1, -1, 0), phase: 1, branchZero: 0 });
assert.deepStrictEqual(control.outputs, { rd: 1, ra: -1, rb: 0, instructionLoad: 0, registerWrite: 1, writeBackSelect: 1, immediate: 0, aluOperation: 1, memoryAction: 0, pcLoad: 0, pcControl: 1, halt: 0, branchIfZero: 0 });
set({ ...instruction(CPU_OPCODES.LOAD, -1, 1, 0), phase: 1 }); assert.strictEqual(control.outputs.memoryAction, -1); assert.strictEqual(control.outputs.writeBackSelect, -1);
set({ ...instruction(CPU_OPCODES.BRZ, 0, -1, 1), phase: 1, branchZero: 1 }); assert.strictEqual(control.outputs.pcLoad, 1);
set({ ...instruction(CPU_OPCODES.LIT, -1, 1, -1), phase: 1 }); assert.strictEqual(control.outputs.immediate, 1);
set({ ...instruction(CPU_OPCODES.LITW, -1, 0, 0), phase: 1 }); assert.strictEqual(control.outputs.registerWrite, 0); assert.strictEqual(control.outputs.memoryAction, 0);
set({ ...instruction(CPU_OPCODES.ADD), phase: 0 }); assert.strictEqual(control.outputs.instructionLoad, 1); assert.strictEqual(control.outputs.registerWrite, 0);
console.log('Instruction-control contract passed: inspectable fetch/execute controls map every instruction field to packed datapath, memory and PC signals.');
