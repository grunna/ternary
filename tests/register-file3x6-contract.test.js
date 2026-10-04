'use strict';

const assert = require('assert'); global.window = global; require('../js/core.js');
const { Circuit, registry, UNKNOWN } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];
function digits(value) { const result = []; let n = value; for (let index = 0; index < 6; index += 1) { const r = ((n % 3) + 3) % 3; const d = r === 2 ? -1 : r; result.unshift(d); n = (n - d) / 3; } return result; }
function setup() { const circuit = new Circuit(registry), file = circuit.addComponent('register-file3x6', 0, 0), sources = {}; for (const name of registry.get('register-file3x6').inputs) { sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 }); circuit.connect(sources[name].id, 'out', file.id, name); } circuit.simulate(); return { circuit, file, sources }; }
function set(circuit, sources, values) { Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value })); circuit.simulate(); }
function inputs(word, readAAddress, readBAddress, writeAddress, writeAction, clock, reset) { return { ...Object.fromEntries(digits(word).map((d, index) => [`dataIn${lanes[index]}`, d])), readAAddress, readBAddress, writeAddress, writeAction, clock, reset }; }
const { circuit, file, sources } = setup();
assert.strictEqual(registry.get('register-file3x6').implementation.structuralImplementation, 'structural-register-file3x6-v1');
set(circuit, sources, inputs(0, 0, 0, 0, 0, 0, 1)); set(circuit, sources, inputs(0, 0, 0, 0, 0, 1, 1));
for (const address of [-1, 0, 1]) for (let word = -364; word <= 364; word += 1) { set(circuit, sources, inputs(word, address, address, address, 1, 0, 0)); set(circuit, sources, inputs(word, address, address, address, 1, 1, 0)); }
for (const [address, word] of [[-1, 364], [0, -364], [1, 0]]) { set(circuit, sources, inputs(word, address, address, address, 1, 0, 0)); set(circuit, sources, inputs(word, address, address, address, 1, 1, 0)); }
for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) { set(circuit, sources, inputs(0, a, b, 0, 0, 0, 0)); const expectedA = digits(a === -1 ? 364 : a === 0 ? -364 : 0); const expectedB = digits(b === -1 ? 364 : b === 0 ? -364 : 0); assert.deepStrictEqual(lanes.map((lane) => file.outputs[`readA${lane}`]), expectedA, `A port must read register ${a}`); assert.deepStrictEqual(lanes.map((lane) => file.outputs[`readB${lane}`]), expectedB, `B port must independently read register ${b}`); }
const before = JSON.stringify(file.state.values); set(circuit, sources, inputs(123, -1, 1, 0, 0, 0, 0)); set(circuit, sources, inputs(123, -1, 1, 0, 0, 1, 0)); assert.strictEqual(JSON.stringify(file.state.values), before, 'non-write action must preserve all registers');
set(circuit, sources, inputs(0, UNKNOWN, 0, 0, 0, 0, 0)); assert.deepStrictEqual(lanes.map((lane) => file.outputs[`readA${lane}`]), Array(6).fill(UNKNOWN), 'unknown A address must remain unknown');
console.log('Dual-read 6-trit register-file contract passed: atomic writes and independent A/B reads preserve the ternary state contract.');
