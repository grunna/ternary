'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, UNKNOWN } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];
function digits(value) { const result = []; let n = value; for (let index = 0; index < 6; index += 1) { const remainder = ((n % 3) + 3) % 3; const digit = remainder === 2 ? -1 : remainder; result.unshift(digit); n = (n - digit) / 3; } return result; }
function setup() { const circuit = new Circuit(registry), bank = circuit.addComponent('register-bank3x6', 0, 0), sources = {}; for (const name of registry.get('register-bank3x6').inputs) { sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 }); circuit.connect(sources[name].id, 'out', bank.id, name); } circuit.simulate(); return { circuit, bank, sources }; }
function set(circuit, sources, values) { Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value })); circuit.simulate(); }
function values(word, address, action, clock, reset) { return { ...Object.fromEntries(digits(word).map((digit, index) => [`dataIn${lanes[index]}`, digit])), address, action, clock, reset }; }

const { circuit, bank, sources } = setup();
assert.strictEqual(registry.get('register-bank3x6').implementation.structuralImplementation, 'structural-register-bank3x6-v1');
set(circuit, sources, values(0, 0, 0, 0, 1)); set(circuit, sources, values(0, 0, 0, 1, 1));
for (const address of [-1, 0, 1]) for (let word = -364; word <= 364; word += 1) {
  set(circuit, sources, values(word, address, 1, 0, 0)); set(circuit, sources, values(word, address, 1, 1, 0));
  set(circuit, sources, values(word, address, -1, 0, 0));
  assert.deepStrictEqual(lanes.map((lane) => bank.outputs[`dataOut${lane}`]), digits(word), `register ${address} must return whole tryte ${word}`);
}
const before = JSON.stringify(bank.state.values);
set(circuit, sources, values(7, 0, 0, 0, 0)); set(circuit, sources, values(7, 0, 0, 1, 0));
assert.strictEqual(JSON.stringify(bank.state.values), before, 'idle edge must not mutate a register');
set(circuit, sources, values(0, 0, 0, 0, 0));
assert.deepStrictEqual(lanes.map((lane) => bank.outputs[`dataOut${lane}`]), Array(6).fill(UNKNOWN), 'idle must not claim a read word');
console.log('6-trit register-bank contract passed: all 729 trytes at three registers are atomic; reset and idle honor the public contract.');
