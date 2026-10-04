'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, CPU_PHASES, cpuMemoryCycle } = global.TernaryCore;

assert.deepStrictEqual(cpuMemoryCycle(CPU_PHASES.FETCH), { action: -1, instructionLoad: 1, readSample: 1, loadWrite: 0, storeWrite: 0, readLatency: 0 });
assert.deepStrictEqual(cpuMemoryCycle(CPU_PHASES.EXECUTE, -1, 1), { action: -1, instructionLoad: 0, readSample: 1, loadWrite: 1, storeWrite: 0, readLatency: 0 });
assert.deepStrictEqual(cpuMemoryCycle(CPU_PHASES.EXECUTE, 1, 0), { action: 1, instructionLoad: 0, readSample: 0, loadWrite: 0, storeWrite: 1, readLatency: 0 });
assert.deepStrictEqual(cpuMemoryCycle(CPU_PHASES.EXECUTE, 0, 1), { action: 0, instructionLoad: 0, readSample: 0, loadWrite: 0, storeWrite: 0, readLatency: 0 });

const circuit = new Circuit(registry);
const timing = circuit.addComponent('cpu-memory-cycle6', 0, 0);
const sources = Object.fromEntries(registry.get('cpu-memory-cycle6').inputs.map((name) => [name, circuit.addComponent('trit-input', 0, 0, { value: 0 })]));
Object.entries(sources).forEach(([name, source]) => circuit.connect(source.id, 'out', timing.id, name));
circuit.simulate();
assert.deepStrictEqual(timing.outputs, { action: -1, instructionLoad: 1, readSample: 1, loadWrite: 0, storeWrite: 0 });
circuit.setState(sources.phase.id, { value: 1 });
circuit.setState(sources.executeAction.id, { value: -1 });
circuit.setState(sources.executeRegisterWrite.id, { value: 1 });
circuit.simulate();
assert.deepStrictEqual(timing.outputs, { action: -1, instructionLoad: 0, readSample: 1, loadWrite: 1, storeWrite: 0 });

console.log('CPU memory-cycle contract passed: fetch/LOAD reads settle in zero cycles and STORE writes only on execute edges.');
