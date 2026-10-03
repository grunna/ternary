'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, FLOATING, UNKNOWN } = global.TernaryCore;

function setup() {
  const circuit = new Circuit(registry);
  const memory = circuit.addComponent('memory3x1', 100, 0);
  const sources = Object.fromEntries(['dataIn', 'address', 'action', 'clock', 'reset'].map((name) => [name, circuit.addComponent('trit-input', 0, 0, { value: 0 })]));
  for (const [name, source] of Object.entries(sources)) circuit.connect(source.id, 'out', memory.id, name);
  circuit.simulate();
  return { circuit, memory, sources };
}
function set(circuit, sources, values) { Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value })); circuit.simulate(); }
function edge(circuit, sources, values) { set(circuit, sources, { ...values, clock: 0 }); set(circuit, sources, { ...values, clock: 1 }); }

assert.strictEqual(registry.get('memory3x1').implementation.structuralImplementation, 'structural-memory3x1-v1', 'memory must name its structural reference');
const { circuit, memory, sources } = setup();
set(circuit, sources, { action: -1, address: 0 });
assert.strictEqual(memory.outputs.dataOut, UNKNOWN, 'memory must read unknown before reset');
edge(circuit, sources, { dataIn: 1, address: 0, action: 1, reset: 1 });
assert.deepStrictEqual(memory.state.values, [0, 0, 0], 'reset must initialize all three locations together');
for (const [address, value] of [[-1, -1], [0, 0], [1, 1]]) edge(circuit, sources, { dataIn: value, address, action: 1, reset: 0 });
for (const [address, value] of [[-1, -1], [0, 0], [1, 1]]) {
  set(circuit, sources, { address, action: -1, clock: 0, reset: 0 });
  assert.strictEqual(memory.outputs.dataOut, value, `read action must expose address ${address}`);
}
const before = [...memory.state.values];
edge(circuit, sources, { dataIn: 1, address: FLOATING, action: 1, reset: 0 });
assert.deepStrictEqual(memory.state.values, before, 'floating write address must not mutate memory');
edge(circuit, sources, { dataIn: UNKNOWN, address: -1, action: 1, reset: 0 });
assert.deepStrictEqual(memory.state.values, before, 'unknown write data must not mutate memory');
edge(circuit, sources, { dataIn: 1, address: 1, action: 0, reset: 0 });
assert.deepStrictEqual(memory.state.values, before, 'idle action must not mutate memory');
set(circuit, sources, { address: FLOATING, action: -1, clock: 0 });
assert.strictEqual(memory.outputs.dataOut, UNKNOWN, 'invalid read address must produce unknown');
set(circuit, sources, { address: 0, action: 0 });
assert.strictEqual(memory.outputs.dataOut, UNKNOWN, 'idle action must not claim a read value');
console.log('Memory 3×1 contract passed: reset, all addresses, read/idle/write actions, and invalid access behavior are correct.');
