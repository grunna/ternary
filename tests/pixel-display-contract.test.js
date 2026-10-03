'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, FLOATING, UNKNOWN } = global.TernaryCore;

function createDisplay() {
  const circuit = new Circuit(registry);
  const display = circuit.addComponent('pixel-display3', 100, 0);
  const sources = Object.fromEntries(['x', 'y', 'color', 'clock', 'reset'].map((name) => [name, circuit.addComponent('trit-input', 0, 0, { value: 0 })]));
  for (const [name, source] of Object.entries(sources)) circuit.connect(source.id, 'out', display.id, name);
  circuit.simulate();
  return { circuit, display, sources };
}

function set(circuit, sources, values) {
  for (const [name, value] of Object.entries(values)) circuit.setState(sources[name].id, { value });
  circuit.simulate();
}

function risingEdge(circuit, sources, values = {}) {
  set(circuit, sources, { ...values, clock: 0 });
  set(circuit, sources, { ...values, clock: 1 });
}

const coordinateIndex = (x, y) => (1 - y) * 3 + (x + 1);

assert.strictEqual(registry.get('pixel-display3').implementation.status, 'clocked user I/O display boundary', 'pixel display must declare its clocked external-adapter boundary');
assert.deepStrictEqual(registry.get('pixel-display3').outputs, [], 'pixel display must not drive a circuit output');

for (const y of [1, 0, -1]) {
  for (const x of [-1, 0, 1]) {
    for (const color of [-1, 0, 1]) {
      const { circuit, display, sources } = createDisplay();
      risingEdge(circuit, sources, { x, y, color, reset: 0 });
      const expected = Array(9).fill(0);
      expected[coordinateIndex(x, y)] = color;
      assert.deepStrictEqual(display.state.pixels, expected, `clock edge must store color ${color} at x=${x}, y=${y}`);
      assert.strictEqual(display.state.invalidIo, null, 'valid clocked write must clear a prior I/O diagnostic');
    }
  }
}

{
  const { circuit, display, sources } = createDisplay();
  risingEdge(circuit, sources, { x: 1, y: -1, color: 1, reset: 0 });
  const written = [...display.state.pixels];
  set(circuit, sources, { x: -1, y: 1, color: -1, reset: 0, clock: 1 });
  assert.deepStrictEqual(display.state.pixels, written, 'holding clock at +1 must not create another write edge');

  risingEdge(circuit, sources, { x: -1, y: 1, color: -1, reset: 0 });
  assert.strictEqual(display.state.pixels[coordinateIndex(-1, 1)], -1, 'a later genuine 0 → +1 edge must write');
}

{
  const { circuit, display, sources } = createDisplay();
  risingEdge(circuit, sources, { x: 0, y: 0, color: 1, reset: 0 });
  risingEdge(circuit, sources, { x: FLOATING, y: UNKNOWN, color: FLOATING, reset: 1 });
  assert.deepStrictEqual(display.state.pixels, Array(9).fill(0), 'reset must clear the full frame and take priority over irrelevant write ports');
  assert.strictEqual(display.state.invalidIo, null, 'valid reset must not retain an I/O error');
}

for (const values of [
  { x: FLOATING, y: 0, color: 1, reset: 0 },
  { x: 0, y: UNKNOWN, color: 1, reset: 0 },
  { x: 0, y: 0, color: FLOATING, reset: 0 },
  { x: 0, y: 0, color: UNKNOWN, reset: 0 },
  { x: 0, y: 0, color: 1, reset: -1 },
  { x: 0, y: 0, color: 1, reset: FLOATING },
  { x: 0, y: 0, color: 1, reset: UNKNOWN },
]) {
  const { circuit, display, sources } = createDisplay();
  risingEdge(circuit, sources, { x: 1, y: 1, color: 1, reset: 0 });
  const before = [...display.state.pixels];
  risingEdge(circuit, sources, values);
  assert.deepStrictEqual(display.state.pixels, before, `invalid I/O ${JSON.stringify(values)} must not alter the frame`);
  assert.match(display.state.invalidIo || '', /invalid pixel ports|reset=/, 'invalid I/O must be recorded for the Inspector');
}

{
  const { circuit, display, sources } = createDisplay();
  set(circuit, sources, { x: 0, y: 0, color: 1, reset: 0, clock: FLOATING });
  assert.deepStrictEqual(display.state.pixels, Array(9).fill(0), 'floating clock must not write');
  assert.match(display.state.invalidIo || '', /clock=Z/, 'floating clock must be diagnosed');
  set(circuit, sources, { clock: 1 });
  assert.deepStrictEqual(display.state.pixels, Array(9).fill(0), 'Z → +1 is not a valid known rising edge');
  risingEdge(circuit, sources, { x: 0, y: 0, color: 1, reset: 0 });
  assert.strictEqual(display.state.pixels[coordinateIndex(0, 0)], 1, 'a recovered known 0 → +1 edge must write normally');
}

console.log('Pixel Display 3×3 contract passed: all addresses, colors, edge/reset behavior, and invalid I/O preserve the stated peripheral contract.');
