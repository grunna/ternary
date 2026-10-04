'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, CPU_PHASES, UNKNOWN, signExtendAddress3, cpuControlFlow6 } = global.TernaryCore;
const ra = [0, 0, 0, -1, 1, 0];
const rb = [0, 0, 0, 1, -1, 1];
assert.deepStrictEqual(signExtendAddress3([-1, 1, 0]), [0, 0, 0, -1, 1, 0]);
assert.deepStrictEqual(cpuControlFlow6(CPU_PHASES.EXECUTE, { pcControl: 1, pcLoad: 1, branchIfZero: 0 }, 0, ra, rb), { pcControl: 0, pcLoad: 1, branchTaken: 0, target: [0, 0, 0, -1, 1, 0] });
assert.deepStrictEqual(cpuControlFlow6(CPU_PHASES.EXECUTE, { pcControl: 1, pcLoad: 0, branchIfZero: 1 }, 1, ra, rb), { pcControl: 0, pcLoad: 1, branchTaken: 1, target: [0, 0, 0, 1, -1, 1] });
assert.deepStrictEqual(cpuControlFlow6(CPU_PHASES.EXECUTE, { pcControl: 1, pcLoad: 0, branchIfZero: 1 }, 0, ra, rb), { pcControl: 1, pcLoad: 0, branchTaken: 0, target: [0, 0, 0, 1, -1, 1] });
const unresolved = cpuControlFlow6(CPU_PHASES.EXECUTE, { pcControl: 1, pcLoad: 0, branchIfZero: 1 }, UNKNOWN, ra, rb);
assert.strictEqual(unresolved.pcLoad, UNKNOWN, 'unknown equality must not select an architectural PC update');

const circuit = new Circuit(registry);
const flow = circuit.addComponent('cpu-control-flow6', 0, 0);
const sources = Object.fromEntries(registry.get('cpu-control-flow6').inputs.map((name) => [name, circuit.addComponent('trit-input', 0, 0, { value: 0 })]));
Object.entries(sources).forEach(([name, source]) => circuit.connect(source.id, 'out', flow.id, name));
const set = (values) => { Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value })); circuit.simulate(); };
set({ phase: 1, pcControlRequest: 1, pcLoadRequest: 0, branchIfZero: 1, compareEqual: 1, ra5: 0, ra4: 0, ra3: 0, ra2: -1, ra1: 1, ra0: 0, rb5: 0, rb4: 0, rb3: 0, rb2: 1, rb1: -1, rb0: 1 });
assert.strictEqual(flow.outputs.branchTaken, 1);
assert.strictEqual(flow.outputs.pcLoad, 1);
assert.deepStrictEqual(['5', '4', '3', '2', '1', '0'].map((lane) => flow.outputs[`target${lane}`]), [0, 0, 0, 1, -1, 1]);

console.log('CPU control-flow contract passed: JUMP and BRZ drive PC load only from valid decoded and equality controls.');
