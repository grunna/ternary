const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, balancedWordDigits } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];
const coordinateIndex = (x, y) => (1 - y) * 3 + (x + 1);
const circuit = new Circuit(registry);
const adapter = circuit.addComponent('cpu-io-adapter3x3', 0, 0);
const display = circuit.addComponent('pixel-display3', 0, 0);
const source = (value = 0) => circuit.addComponent('trit-input', 0, 0, { value });
const inputs = {};
for (const lane of lanes) {
  inputs[`address${lane}`] = source(0); circuit.connect(inputs[`address${lane}`].id, 'out', adapter.id, `address${lane}`);
  inputs[`dataIn${lane}`] = source(0); circuit.connect(inputs[`dataIn${lane}`].id, 'out', adapter.id, `dataIn${lane}`);
  inputs[`ramData${lane}`] = source(0); circuit.connect(inputs[`ramData${lane}`].id, 'out', adapter.id, `ramData${lane}`);
}
for (const name of ['phase', 'action', 'clock', 'reset', 'ioEnable', 'joystickX', 'joystickY']) { inputs[name] = source(0); circuit.connect(inputs[name].id, 'out', adapter.id, name); }
for (const [from, to] of [['displayX', 'x'], ['displayY', 'y'], ['displayColor', 'color'], ['displayClearBeforeWrite', 'clearBeforeWrite'], ['displayClock', 'clock'], ['displayReset', 'reset']]) circuit.connect(adapter.id, from, display.id, to);
const setWord = (prefix, value) => balancedWordDigits(value, 6).forEach((digit, index) => circuit.setState(inputs[`${prefix}${lanes[index]}`].id, { value: digit }));
const outputs = (prefix) => lanes.map((lane) => adapter.outputs[`${prefix}${lane}`]);

circuit.setState(inputs.ioEnable.id, { value: 1 });
circuit.setState(inputs.phase.id, { value: 1 });
circuit.setState(inputs.action.id, { value: -1 });
circuit.setState(inputs.joystickX.id, { value: 1 });
setWord('address', -4); circuit.simulate();
assert.deepStrictEqual(outputs('dataOut'), [0, 0, 0, 1, 0, 0], '−4 read must expose joystick X in t2');
assert.strictEqual(adapter.outputs.ramAction, 0, 'mapped joystick read must not reach RAM');

setWord('address', 2); circuit.setState(inputs.ramData5.id, { value: 1 }); circuit.simulate();
assert.strictEqual(adapter.outputs.ramAction, -1, 'ordinary reads must pass to RAM');
assert.strictEqual(adapter.outputs.dataOut5, 1, 'ordinary reads must return RAM data');

circuit.setState(inputs.action.id, { value: 1 });
setWord('address', 4);
[0, 0, 0, -1, 1, 1].forEach((value, index) => circuit.setState(inputs[`dataIn${lanes[index]}`].id, { value }));
circuit.setState(inputs.clock.id, { value: 1 }); circuit.simulate();
assert.deepStrictEqual([adapter.outputs.displayX, adapter.outputs.displayY, adapter.outputs.displayColor], [-1, 1, 1], 'display write must unpack t2/t1/t0');
assert.strictEqual(adapter.outputs.displayClock, 1, 'display write must forward the CPU rising clock');
assert.strictEqual(adapter.outputs.ramAction, 0, 'mapped display write must not reach RAM');

// Isolated adapter/display regression: every consecutive packed display STORE
// must generate one valid pulse with its own stable word, not a stale prior one.
const frame = (x, y) => { const pixels = Array(9).fill(0); pixels[coordinateIndex(x, y)] = 1; return pixels; };
const storePacked = (value) => {
  circuit.setState(inputs.phase.id, { value: 1 }); circuit.setState(inputs.action.id, { value: 1 }); setWord('address', 4); setWord('dataIn', value);
  circuit.setState(inputs.clock.id, { value: 0 }); circuit.simulate();
  circuit.setState(inputs.clock.id, { value: 1 }); circuit.simulate();
  circuit.setState(inputs.clock.id, { value: 0 }); circuit.simulate();
};
storePacked(1); assert.deepStrictEqual(display.state.pixels, frame(0, 0), 'isolated adapter STORE A must write centre green');
storePacked(4); assert.deepStrictEqual(display.state.pixels, frame(0, 1), 'isolated adapter STORE B must replace A with top-centre green');
storePacked(-2); assert.deepStrictEqual(display.state.pixels, frame(0, -1), 'isolated adapter STORE C must replace B with bottom-centre green');
storePacked(-5); assert.deepStrictEqual(display.state.pixels, frame(-1, 1), 'isolated adapter STORE D must replace C with top-left green');

// FETCH has action=-1 too, but must always read program RAM even at +4.
circuit.setState(inputs.phase.id, { value: 0 });
circuit.setState(inputs.action.id, { value: -1 });
setWord('address', 4); circuit.setState(inputs.ramData4.id, { value: 1 }); circuit.simulate();
assert.strictEqual(adapter.outputs.ramAction, -1, 'instruction fetch at +4 must pass through to RAM instead of being mistaken for display I/O');
assert.strictEqual(adapter.outputs.dataOut4, 1, 'instruction fetch at +4 must return RAM program data');

console.log('CPU I/O adapter contract passed: joystick LOAD reads, RAM pass-through and packed Pixel Display STORE writes are explicit.');
