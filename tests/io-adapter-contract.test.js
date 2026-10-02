'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, FLOATING, UNKNOWN } = global.TernaryCore;
const inputDefinition = registry.get('trit-input');
const wordInputDefinition = registry.get('word-input6');
const buttonDefinition = registry.get('input-button3');
const joystickDefinition = registry.get('input-joystick3');
const analogJoystickDefinition = registry.get('input-joystick6');
const wordDisplayDefinition = registry.get('word-display6');
const decimalDebugDefinition = registry.get('decimal-debug6');

assert.strictEqual(inputDefinition.implementation.mode, 'external-adapter', 'interactive trit input must remain an external adapter');
assert.strictEqual(inputDefinition.implementation.status, 'test/debug source boundary', 'input must declare its test/debug boundary role');
assert.strictEqual(wordInputDefinition.implementation.mode, 'external-adapter', 'word input must remain an external adapter');
assert.deepStrictEqual(wordInputDefinition.outputs, ['t5', 't4', 't3', 't2', 't1', 't0'], 'word input must expose ordered word lanes');
assert.strictEqual(buttonDefinition.implementation.mode, 'external-adapter', 'input button must remain an external adapter');
assert.deepStrictEqual(joystickDefinition.outputs, ['x', 'y'], 'joystick must expose independent x and y axes');
assert.deepStrictEqual(analogJoystickDefinition.outputs, ['x5', 'x4', 'x3', 'x2', 'x1', 'x0', 'y5', 'y4', 'y3', 'y2', 'y1', 'y0'], 'analog joystick must expose two ordered six-trit axes');
assert.strictEqual(wordDisplayDefinition.implementation.status, 'user I/O word display boundary', 'word display must declare its end-user display role');
assert.strictEqual(decimalDebugDefinition.implementation.status, 'debug decimal observer boundary', 'decimal debug view must declare its debug-only role');
assert.deepStrictEqual(decimalDebugDefinition.outputs, [], 'decimal debug view must not feed a value back into the circuit');

for (const value of [-1, 0, 1, FLOATING, UNKNOWN]) {
  const circuit = new Circuit(registry);
  const input = circuit.addComponent('trit-input', 0, 0, { value });
  const probe = circuit.addComponent('probe', 100, 0);
  circuit.connect(input.id, 'out', probe.id, 'in');
  circuit.simulate();
  assert.strictEqual(input.outputs.out, value, `input must drive ${String(value)}`);
  assert.strictEqual(probe.inputs.in, value, `ordinary propagation must carry ${String(value)} to observers`);
}

const wordCircuit = new Circuit(registry);
const word = wordCircuit.addComponent('word-input6', 0, 0, { values: [-1, 0, 1, FLOATING, UNKNOWN, -1] });
wordCircuit.simulate();
assert.deepStrictEqual(word.outputs, { t5: -1, t4: 0, t3: 1, t2: FLOATING, t1: UNKNOWN, t0: -1 }, 'word input must drive each lane independently, including Z and ?');

const displayCircuit = new Circuit(registry);
const display = displayCircuit.addComponent('word-display6', 100, 0);
[-1, 0, 1, FLOATING, UNKNOWN, -1].forEach((value, index) => {
  const source = displayCircuit.addComponent('trit-input', 0, 0, { value });
  displayCircuit.connect(source.id, 'out', display.id, ['t5', 't4', 't3', 't2', 't1', 't0'][index]);
});
displayCircuit.simulate();
assert.deepStrictEqual(display.state.values, [-1, 0, 1, FLOATING, UNKNOWN, -1], 'word display must sample every known, floating, and unknown lane without changing it');

const decimalCircuit = new Circuit(registry);
const decimalDebug = decimalCircuit.addComponent('decimal-debug6', 100, 0);
[1, -1, 0, 0, 0, 1].forEach((value, index) => {
  const source = decimalCircuit.addComponent('trit-input', 0, 0, { value });
  decimalCircuit.connect(source.id, 'out', decimalDebug.id, ['t5', 't4', 't3', 't2', 't1', 't0'][index]);
});
decimalCircuit.simulate();
assert.deepStrictEqual(decimalDebug.state.values, [1, -1, 0, 0, 0, 1], 'decimal debug view must observe every word lane');
assert.strictEqual(decimalDebug.state.decimal, 163, 'decimal debug view must convert a settled balanced-ternary word to decimal');
const invalidDecimalSource = [...decimalCircuit.components.values()].find((component) => component.type === 'trit-input' && component.outputs.out === 1);
decimalCircuit.setState(invalidDecimalSource.id, { value: FLOATING });
decimalCircuit.simulate();
assert.strictEqual(decimalDebug.state.decimal, null, 'decimal debug view must not invent a decimal value for floating or unknown inputs');

for (const mode of ['momentary', 'toggle', 'pulse']) {
  const buttonCircuit = new Circuit(registry);
  const button = buttonCircuit.addComponent('input-button3', 0, 0, { mode, releasedValue: -1, pressedValue: 1, pressed: false });
  buttonCircuit.simulate();
  assert.strictEqual(button.outputs.out, -1, `${mode} button must drive its released level`);
  buttonCircuit.setState(button.id, { pressed: true });
  buttonCircuit.simulate();
  assert.strictEqual(button.outputs.out, 1, `${mode} button must drive its pressed level`);
  buttonCircuit.setState(button.id, { pressed: false });
  buttonCircuit.simulate();
  assert.strictEqual(button.outputs.out, -1, `${mode} button must return to its released level`);
}

for (const [x, y] of [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [1, -1]]) {
  const joystickCircuit = new Circuit(registry);
  const joystick = joystickCircuit.addComponent('input-joystick3', 0, 0, { x, y });
  joystickCircuit.simulate();
  assert.deepStrictEqual(joystick.outputs, { x, y }, `joystick must drive x=${x}, y=${y}`);
}

for (const [x, y, expectedX, expectedY] of [[0, 0, [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]], [-364, 364, [-1, -1, -1, -1, -1, -1], [1, 1, 1, 1, 1, 1]], [364, -364, [1, 1, 1, 1, 1, 1], [-1, -1, -1, -1, -1, -1]]]) {
  const analogCircuit = new Circuit(registry);
  const analog = analogCircuit.addComponent('input-joystick6', 0, 0, { x, y });
  analogCircuit.simulate();
  assert.deepStrictEqual(['x5', 'x4', 'x3', 'x2', 'x1', 'x0'].map((name) => analog.outputs[name]), expectedX, `analog joystick x axis must encode ${x}`);
  assert.deepStrictEqual(['y5', 'y4', 'y3', 'y2', 'y1', 'y0'].map((name) => analog.outputs[name]), expectedY, `analog joystick y axis must encode ${y}`);
}
const diagonalCircuit = new Circuit(registry);
const diagonal = diagonalCircuit.addComponent('input-joystick6', 0, 0, { x: 1, y: -1 });
diagonalCircuit.simulate();
assert.deepStrictEqual(['x5', 'x4', 'x3', 'x2', 'x1', 'x0'].map((name) => diagonal.outputs[name]), [0, 0, 0, 0, 0, 1], 'analog joystick must encode a positive x diagonal component');
assert.deepStrictEqual(['y5', 'y4', 'y3', 'y2', 'y1', 'y0'].map((name) => diagonal.outputs[name]), [0, 0, 0, 0, 0, -1], 'analog joystick must encode a negative y diagonal component');
const invalidAnalogCircuit = new Circuit(registry);
const invalidAnalog = invalidAnalogCircuit.addComponent('input-joystick6', 0, 0, { x: FLOATING, y: UNKNOWN });
invalidAnalogCircuit.simulate();
assert.deepStrictEqual(['x5', 'x4', 'x3', 'x2', 'x1', 'x0'].map((name) => invalidAnalog.outputs[name]), Array(6).fill(FLOATING), 'floating analog axis must remain visibly floating on every lane');
assert.deepStrictEqual(['y5', 'y4', 'y3', 'y2', 'y1', 'y0'].map((name) => invalidAnalog.outputs[name]), Array(6).fill(UNKNOWN), 'unknown analog axis must remain unknown on every lane');

console.log('I/O adapter contract passed: inputs, controls, joysticks, and display/debug observers honor their external contracts.');
