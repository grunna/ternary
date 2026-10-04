'use strict';
const assert = require('assert'); global.window = global; require('../js/core.js');
const { Circuit, registry, UNKNOWN } = global.TernaryCore; const lanes = ['5', '4', '3', '2', '1', '0'];
const circuit = new Circuit(registry), ir = circuit.addComponent('instruction-register6', 0, 0), sources = {};
for (const name of registry.get('instruction-register6').inputs) { sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 }); circuit.connect(sources[name].id, 'out', ir.id, name); }
function set(values) { Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value })); circuit.simulate(); }
function edge(values) { set({ ...values, clock: 0 }); set({ ...values, clock: 1 }); }
circuit.simulate(); assert.strictEqual(registry.get('instruction-register6').implementation.structuralImplementation, 'structural-instruction-register6-v1');
edge({ load: 1, reset: 0, instruction5: -1, instruction4: 0, instruction3: 1, instruction2: -1, instruction1: 0, instruction0: 1 });
assert.deepStrictEqual(lanes.map((lane) => ir.outputs[`instruction${lane}`]), [-1, 0, 1, -1, 0, 1]);
edge({ load: 0, reset: 0, instruction5: 1, instruction4: 1, instruction3: 1, instruction2: 1, instruction1: 1, instruction0: 1 });
assert.deepStrictEqual(ir.state.values, [-1, 0, 1, -1, 0, 1], 'non-load edge holds instruction');
edge({ load: 0, reset: 1 }); assert.deepStrictEqual(ir.state.values, Array(6).fill(0), 'reset clears instruction register');
edge({ load: 1, reset: 0, instruction5: UNKNOWN }); assert.deepStrictEqual(ir.state.values, Array(6).fill(0), 'invalid fetch cannot alter instruction register');
console.log('Instruction-register contract passed: fetch load, hold, reset and invalid instruction behavior are correct.');
