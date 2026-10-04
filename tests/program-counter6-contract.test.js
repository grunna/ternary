'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, UNKNOWN } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];
function digits(value) { const result = []; let n = value; for (let index = 0; index < 6; index += 1) { const remainder = ((n % 3) + 3) % 3; const digit = remainder === 2 ? -1 : remainder; result.unshift(digit); n = (n - digit) / 3; } return result; }
function setup() { const circuit = new Circuit(registry), pc = circuit.addComponent('program-counter6', 0, 0), sources = {}; for (const name of registry.get('program-counter6').inputs) { sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 }); circuit.connect(sources[name].id, 'out', pc.id, name); } circuit.simulate(); return { circuit, pc, sources }; }
function set(circuit, sources, values) { Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value })); circuit.simulate(); }
function edge(circuit, sources, values) { set(circuit, sources, { ...values, clock: 0 }); set(circuit, sources, { ...values, clock: 1 }); }
function pcValue(pc) { return lanes.reduce((value, lane) => value * 3 + pc.state.values[lanes.indexOf(lane)], 0); }

const { circuit, pc, sources } = setup();
assert.strictEqual(registry.get('program-counter6').implementation.structuralImplementation, 'structural-program-counter6-v1');
edge(circuit, sources, { control: 0, reset: 1 });
assert.deepStrictEqual(pc.state.values, Array(6).fill(0), 'reset edge establishes PC zero');
edge(circuit, sources, { control: 1, load: 1, loadData5: 1, loadData4: 0, loadData3: -1, loadData2: 1, loadData1: 0, loadData0: -1, reset: 0 });
assert.deepStrictEqual(pc.state.values, [1, 0, -1, 1, 0, -1], 'known PC load must override adjustment on the edge');
for (let value = -364; value <= 364; value += 1) for (const control of [-1, 0, 1]) {
  set(circuit, sources, { control, load: 0, reset: 0, clock: 0 });
  circuit.setState(pc.id, { values: digits(value), previousClock: 0 });
  circuit.simulate();
  const raw = value + control, extension = raw < -364 ? -1 : raw > 364 ? 1 : 0;
  assert.strictEqual(pc.outputs.extension, extension, `extension must describe ${value} + ${control}`);
  set(circuit, sources, { control, reset: 0, clock: 1 });
  assert.deepStrictEqual(pc.state.values, digits(raw - extension * 729), `PC must canonically wrap ${value} + ${control}`);
}
circuit.setState(pc.id, { values: Array(6).fill(UNKNOWN), previousClock: 0 }); circuit.simulate();
edge(circuit, sources, { control: 1, load: 0, reset: 0 });
assert.deepStrictEqual(pc.state.values, Array(6).fill(UNKNOWN), 'unknown PC must not change on an otherwise valid edge');
console.log('6-trit program-counter contract passed: all PC values, decrement/hold/increment, wrap extension and reset behavior are correct.');
