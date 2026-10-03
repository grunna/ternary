'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry } = global.TernaryCore;

function digits(value, width) {
  const result = [];
  let remaining = value;
  for (let index = 0; index < width; index += 1) {
    const remainder = ((remaining % 3) + 3) % 3;
    const digit = remainder === 2 ? -1 : remainder;
    result.unshift(digit); remaining = (remaining - digit) / 3;
  }
  return result;
}

function create(type) {
  const circuit = new Circuit(registry), display = circuit.addComponent(type, 100, 0), sources = {};
  for (const name of registry.get(type).inputs) {
    sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 });
    circuit.connect(sources[name].id, 'out', display.id, name);
  }
  circuit.simulate();
  return { circuit, display, sources };
}

function set(circuit, sources, values) {
  for (const [name, value] of Object.entries(values)) circuit.setState(sources[name].id, { value });
  circuit.simulate();
}

function edge(circuit, sources, values) {
  set(circuit, sources, { ...values, clock: 0 });
  set(circuit, sources, { ...values, clock: 1 });
}

function rgb(r, g, b) {
  return Object.fromEntries(['r', 'g', 'b'].flatMap((channel, channelIndex) => digits([r, g, b][channelIndex], 6).map((value, index) => [`${channel}${5 - index}`, value])));
}

function coordinate(axis, value) {
  return Object.fromEntries(digits(value, 4).map((digit, index) => [`${axis}${3 - index}`, digit]));
}

function sendSerialPixel(circuit, sources, r, g, b) {
  for (const value of [...digits(r, 6), ...digits(g, 6), ...digits(b, 6)]) edge(circuit, sources, { data: value });
}

assert.strictEqual(registry.get('rgb-display24-addressed').implementation.mode, 'external-adapter', 'addressed RGB display must remain an external adapter');
assert.strictEqual(registry.get('rgb-display24-stream').implementation.mode, 'external-adapter', 'stream RGB display must remain an external adapter');

{
  const { circuit, display, sources } = create('rgb-display24-addressed');
  edge(circuit, sources, { ...coordinate('x', -12), ...coordinate('y', 11), ...rgb(-364, 0, 364), reset: 0 });
  assert.deepStrictEqual(display.state.pixels[0], [-364, 0, 364], 'addressed display must map x=-12, y=+11 to the top-left pixel');
  edge(circuit, sources, { ...coordinate('x', 11), ...coordinate('y', -12), ...rgb(12, -34, 56), reset: 0 });
  assert.deepStrictEqual(display.state.pixels[575], [12, -34, 56], 'addressed display must map x=+11, y=-12 to the bottom-right pixel');
  edge(circuit, sources, { ...coordinate('x', 12), ...coordinate('y', 0), ...rgb(1, 1, 1), reset: 0 });
  assert.match(display.state.invalidIo || '', /address/, 'out-of-range addressed coordinate must be diagnosed');
  assert.deepStrictEqual(display.state.pixels[575], [12, -34, 56], 'invalid addressed write must preserve the frame');
}

{
  const { circuit, display, sources } = create('rgb-display24-stream');
  sendSerialPixel(circuit, sources, 1, 2, 3);
  sendSerialPixel(circuit, sources, -4, -5, -6);
  assert.deepStrictEqual(display.state.pixels.slice(0, 2), [[1, 2, 3], [-4, -5, -6]], 'stream display must write sequential raster pixels');
  assert.strictEqual(display.state.cursor, 2, 'stream display must advance after each write');
  const packet = [...digits(7, 6), ...digits(8, 6), ...digits(9, 6)];
  for (const value of packet.slice(0, 17)) edge(circuit, sources, { data: value });
  assert.strictEqual(display.state.cursor, 2, 'a partial packet must not advance the raster cursor');
  assert.strictEqual(display.state.packet.length, 17, 'the peripheral must retain a partial serial RGB packet');
  edge(circuit, sources, { data: packet[17] });
  assert.deepStrictEqual(display.state.pixels[2], [7, 8, 9], 'the eighteenth trit must commit one complete serial RGB pixel');
}

console.log('RGB Display 24×24 contract passed: six-trit RGB words, addressed bounds, two-wire serial packets, and reset behavior are correct.');
