'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, UNKNOWN } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];

function digits(value) {
  const result = [];
  let remaining = value;
  for (let index = 0; index < 6; index += 1) {
    const remainder = ((remaining % 3) + 3) % 3;
    const digit = remainder === 2 ? -1 : remainder;
    result.unshift(digit);
    remaining = (remaining - digit) / 3;
  }
  return result;
}

function addressDigits(value, width) {
  const result = [];
  let remaining = value;
  for (let index = 0; index < width; index += 1) {
    const remainder = ((remaining % 3) + 3) % 3;
    const digit = remainder === 2 ? -1 : remainder;
    result.unshift(digit);
    remaining = (remaining - digit) / 3;
  }
  return result;
}

function setup(type) {
  const circuit = new Circuit(registry);
  const memory = circuit.addComponent(type, 0, 0);
  const sources = {};
  for (const name of registry.get(type).inputs) {
    sources[name] = circuit.addComponent('trit-input', 0, 0, { value: 0 });
    circuit.connect(sources[name].id, 'out', memory.id, name);
  }
  circuit.simulate();
  return { circuit, memory, sources };
}

function set(circuit, sources, values) {
  Object.entries(values).forEach(([name, value]) => circuit.setState(sources[name].id, { value }));
  circuit.simulate();
}

function inputs(width, address, value, action, clock, reset) {
  return {
    ...Object.fromEntries(digits(value).map((digit, index) => [`dataIn${lanes[index]}`, digit])),
    ...Object.fromEntries(addressDigits(address, width).map((digit, index) => [`address${width - 1 - index}`, digit])),
    action, clock, reset,
  };
}

for (const [type, locations, width] of [['memory9x6', 9, 2], ['memory27x6', 27, 3], ['memory81x6', 81, 4]]) {
  const definition = registry.get(type);
  assert.strictEqual(definition.implementation.mode, 'accelerated-equivalent', `${type} must be an accelerator`);
  assert.strictEqual(definition.implementation.status, 'structural reference available', `${type} must name an available structural reference`);
  assert.match(definition.implementation.structuralImplementation, /^structural-memory\d+x6-v1$/);
  const { circuit, memory, sources } = setup(type);
  const offset = (locations - 1) / 2;
  set(circuit, sources, inputs(width, 0, 0, 0, 0, 1));
  set(circuit, sources, inputs(width, 0, 0, 0, 1, 1));
  for (let address = -offset; address <= offset; address += 1) {
    const value = ((address * 37 + 400) % 729) - 364;
    set(circuit, sources, inputs(width, address, value, 1, 0, 0));
    set(circuit, sources, inputs(width, address, value, 1, 1, 0));
    set(circuit, sources, inputs(width, address, value, -1, 0, 0));
    assert.deepStrictEqual(lanes.map((lane) => memory.outputs[`dataOut${lane}`]), digits(value), `${type} must return the whole word at ${address}`);
  }
  const before = JSON.stringify(memory.state.values);
  set(circuit, sources, inputs(width, 0, 123, 0, 0, 0));
  set(circuit, sources, inputs(width, 0, 123, 0, 1, 0));
  assert.strictEqual(JSON.stringify(memory.state.values), before, `${type} idle must not change state`);
  set(circuit, sources, inputs(width, 0, 0, 0, 0, 0));
  assert.deepStrictEqual(lanes.map((lane) => memory.outputs[`dataOut${lane}`]), Array(6).fill(UNKNOWN), `${type} idle must not claim a read`);
}

console.log('Scaled memory contract passed: 9×6, 27×6 and 81×6 preserve balanced addressing, atomic words, reset and idle behavior.');
