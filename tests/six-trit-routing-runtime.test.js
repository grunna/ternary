'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, makeCustomDefinition, FLOATING, UNKNOWN } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];

function register(meta) {
  registry.register(makeCustomDefinition(meta, registry));
  return meta.type;
}

function evaluate(type, values) {
  const circuit = new Circuit(registry);
  const target = circuit.addComponent(type, 100, 0);
  for (const [name, value] of Object.entries(values)) {
    const source = circuit.addComponent('trit-input', 0, 0, { value });
    circuit.connect(source.id, 'out', target.id, name);
  }
  circuit.simulate();
  return target.outputs;
}

function selectorMeta() {
  const inner = new Circuit(registry);
  const neg = lanes.map((lane) => inner.addComponent('component-input', 0, 0, { name: `n${lane}` }));
  const zero = lanes.map((lane) => inner.addComponent('component-input', 0, 0, { name: `z${lane}` }));
  const pos = lanes.map((lane) => inner.addComponent('component-input', 0, 0, { name: `p${lane}` }));
  const select = inner.addComponent('component-input', 0, 0, { name: 'select' });
  const cells = lanes.map(() => inner.addComponent('select3'));
  const outputs = lanes.map((lane) => inner.addComponent('component-output', 0, 0, { name: `o${lane}` }));
  lanes.forEach((lane, index) => {
    inner.connect(neg[index].id, 'out', cells[index].id, 'neg'); inner.connect(zero[index].id, 'out', cells[index].id, 'zero'); inner.connect(pos[index].id, 'out', cells[index].id, 'pos'); inner.connect(select.id, 'out', cells[index].id, 'select'); inner.connect(cells[index].id, 'out', outputs[index].id, 'in');
  });
  return { id: 'runtime-word-selector', type: 'custom:runtime-word-selector', label: 'Runtime word selector', circuit: inner.serialize() };
}

function routerMeta() {
  const inner = new Circuit(registry);
  const inputs = lanes.map((lane) => inner.addComponent('component-input', 0, 0, { name: `i${lane}` }));
  const select = inner.addComponent('component-input', 0, 0, { name: 'select' });
  const cells = lanes.map(() => inner.addComponent('route3'));
  const outputs = ['n', 'z', 'p'].flatMap((prefix) => lanes.map((lane) => inner.addComponent('component-output', 0, 0, { name: `${prefix}${lane}` })));
  lanes.forEach((lane, index) => {
    inner.connect(inputs[index].id, 'out', cells[index].id, 'in'); inner.connect(select.id, 'out', cells[index].id, 'select');
    ['neg', 'zero', 'pos'].forEach((port, path) => inner.connect(cells[index].id, port, outputs[path * lanes.length + index].id, 'in'));
  });
  return { id: 'runtime-word-router', type: 'custom:runtime-word-router', label: 'Runtime word router', circuit: inner.serialize() };
}

function aluMeta() {
  const inner = new Circuit(registry);
  const a = lanes.map((lane) => inner.addComponent('component-input', 0, 0, { name: `a${lane}` }));
  const b = lanes.map((lane) => inner.addComponent('component-input', 0, 0, { name: `b${lane}` }));
  const operation = inner.addComponent('component-input', 0, 0, { name: 'operation' });
  const zero = inner.addComponent('ternary-reference', 0, 0, { value: 0 });
  const negated = lanes.map(() => inner.addComponent('negate'));
  const operands = lanes.map(() => inner.addComponent('select3'));
  const adders = lanes.map(() => inner.addComponent('normalize-carry'));
  const outputs = lanes.map((lane) => inner.addComponent('component-output', 0, 0, { name: `r${lane}` }));
  const extension = inner.addComponent('component-output', 0, 0, { name: 'extension' });
  lanes.forEach((lane, index) => {
    inner.connect(b[index].id, 'out', negated[index].id, 'in'); inner.connect(negated[index].id, 'out', operands[index].id, 'neg'); inner.connect(zero.id, 'out', operands[index].id, 'zero'); inner.connect(b[index].id, 'out', operands[index].id, 'pos'); inner.connect(operation.id, 'out', operands[index].id, 'select');
    inner.connect(a[index].id, 'out', adders[index].id, 'a'); inner.connect(operands[index].id, 'out', adders[index].id, 'b'); inner.connect(adders[index].id, 'sum', outputs[index].id, 'in');
    if (index === lanes.length - 1) inner.connect(zero.id, 'out', adders[index].id, 'c'); else inner.connect(adders[index + 1].id, 'carry', adders[index].id, 'c');
  });
  inner.connect(adders[0].id, 'carry', extension.id, 'in');
  return { id: 'runtime-word-alu', type: 'custom:runtime-word-alu', label: 'Runtime word ALU', circuit: inner.serialize() };
}

const types = [register(selectorMeta()), register(routerMeta()), register(aluMeta())];

const selectorValues = Object.fromEntries(lanes.flatMap((lane, index) => [[`n${lane}`, index === 0 ? -1 : 0], [`z${lane}`, 0], [`p${lane}`, index === 5 ? 1 : 0]]));
assert.deepStrictEqual(lanes.map((lane) => evaluate(types[0], { ...selectorValues, select: -1 })[`o${lane}`]), [-1, 0, 0, 0, 0, 0], 'selector chooses the complete negative word');
assert.deepStrictEqual(lanes.map((lane) => evaluate(types[0], { ...selectorValues, select: FLOATING })[`o${lane}`]), Array(6).fill(UNKNOWN), 'floating selector control produces unknown output lanes');
assert.strictEqual(evaluate(types[0], { ...selectorValues, p0: FLOATING, select: 1 }).o0, FLOATING, 'selected floating selector data remains visibly floating');

const routerValues = Object.fromEntries(lanes.map((lane, index) => [`i${lane}`, index === 0 ? 1 : 0]));
const routed = evaluate(types[1], { ...routerValues, select: 0 });
assert.deepStrictEqual(lanes.map((lane) => routed[`n${lane}`]), Array(6).fill(0), 'inactive negative route is explicitly zero');
assert.deepStrictEqual(lanes.map((lane) => routed[`z${lane}`]), [1, 0, 0, 0, 0, 0], 'selected zero route carries the word');
assert.deepStrictEqual(lanes.map((lane) => routed[`p${lane}`]), Array(6).fill(0), 'inactive positive route is explicitly zero');
assert.strictEqual(evaluate(types[1], { ...routerValues, i5: FLOATING, select: -1 }).n5, FLOATING, 'selected floating router data remains visibly floating');
assert.deepStrictEqual(lanes.map((lane) => evaluate(types[1], { ...routerValues, select: FLOATING })[`n${lane}`]), Array(6).fill(UNKNOWN), 'floating router control produces unknown output lanes');

const aluValues = Object.fromEntries(lanes.flatMap((lane, index) => [[`a${lane}`, index === 5 ? 1 : 0], [`b${lane}`, 0]]));
assert.deepStrictEqual(lanes.map((lane) => evaluate(types[2], { ...aluValues, operation: 0 })[`r${lane}`]), [0, 0, 0, 0, 0, 1], 'ALU pass-A returns A');
assert.strictEqual(evaluate(types[2], { ...aluValues, b0: FLOATING, operation: 0 }).r0, 1, 'ALU pass-A intentionally ignores floating B');
assert.deepStrictEqual(lanes.map((lane) => evaluate(types[2], { ...aluValues, b0: FLOATING, operation: 1 })[`r${lane}`]), Array(6).fill(UNKNOWN), 'ALU add treats floating selected B as unknown');
assert.deepStrictEqual(lanes.map((lane) => evaluate(types[2], { ...aluValues, operation: FLOATING })[`r${lane}`]), Array(6).fill(UNKNOWN), 'ALU floating operation produces unknown output lanes');

types.forEach((type) => registry.remove(type));
console.log('Six-trit routing runtime passed: known paths, explicit inactive zeroes, floating data, and unknown controls.');
