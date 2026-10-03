'use strict';
const assert = require('assert'); global.window = global; require('../js/core.js');
const { Circuit, registry, UNKNOWN } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];
function digits(value) { const out = []; let n = value; for (let i = 0; i < 6; i++) { const r = ((n % 3) + 3) % 3; const d = r === 2 ? -1 : r; out.unshift(d); n = (n - d) / 3; } return out; }
function setup() { const circuit = new Circuit(registry), memory = circuit.addComponent('memory3x6', 0, 0), sources = {}; for (const name of registry.get('memory3x6').inputs) { sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 }); circuit.connect(sources[name].id, 'out', memory.id, name); } circuit.simulate(); return { circuit, memory, sources }; }
function set(c, s, values) { Object.entries(values).forEach(([name, value]) => c.setState(s[name].id, { value })); c.simulate(); }
function edge(c, s, values) { set(c, s, { ...values, clock: 0 }); set(c, s, { ...values, clock: 1 }); }
function wordInputs(value) { return Object.fromEntries(digits(value).map((digit, index) => [`dataIn${lanes[index]}`, digit])); }
function output(memory) { return lanes.map((lane) => memory.outputs[`dataOut${lane}`]); }
const { circuit, memory, sources } = setup();
edge(circuit, sources, { ...wordInputs(0), address: 0, action: 1, reset: 1 });
for (const address of [-1, 0, 1]) for (let value = -364; value <= 364; value++) {
  edge(circuit, sources, { ...wordInputs(value), address, action: 1, reset: 0 });
  set(circuit, sources, { address, action: -1, clock: 0, reset: 0 });
  assert.deepStrictEqual(output(memory), digits(value), `address ${address} must read complete word ${value}`);
}
const before = memory.state.values.map((word) => [...word]);
edge(circuit, sources, { ...wordInputs(9), address: 0, action: 0, reset: 0 });
assert.deepStrictEqual(memory.state.values, before, 'idle edge must not alter any word lane');
set(circuit, sources, { address: 0, action: 0 });
assert.deepStrictEqual(output(memory), Array(6).fill(UNKNOWN), 'idle must not claim a word read');
console.log('Memory 3×6 contract passed: 2187 address/word writes are atomic and readable; idle preserves every lane.');
