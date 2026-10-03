'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { registry, Circuit, makeCustomDefinition } = global.TernaryCore;
const modes = new Set(['structural', 'accelerated-equivalent', 'external-adapter']);

for (const definition of registry.definitions.values()) {
  assert(definition.implementation, definition.type + ' must declare an implementation classification');
  assert(modes.has(definition.implementation.mode), definition.type + ' has an invalid implementation classification');
}

for (const type of ['negate', 'compare', 'select3', 'route3', 'adjust3', 'control3', 'min', 'max', 'normalize-carry', 'latch3', 'register3', 'register-bank3', 'memory3x1', 'memory3x6', 'memory9x6', 'memory27x6', 'memory81x6']) {
  const implementation = registry.get(type).implementation;
  assert.strictEqual(implementation.mode, 'accelerated-equivalent', type + ' must be an accelerated equivalent');
  assert.match(implementation.structuralImplementation || '', /^structural-[a-z0-9-]+-v1$/, type + ' must name a structural implementation');
}

const inner = new Circuit(registry);
const input = inner.addComponent('component-input', 0, 0, { name: 'in' });
const restorer = inner.addComponent('restore3', 100, 0);
const output = inner.addComponent('component-output', 200, 0, { name: 'out' });
inner.connect(input.id, 'out', restorer.id, 'in');
inner.connect(restorer.id, 'out', output.id, 'in');
const meta = { id: 'execution-cost-test', type: 'custom:execution-cost-test', label: 'Execution cost test', circuit: inner.serialize() };
registry.register(makeCustomDefinition(meta, registry));
const outer = new Circuit(registry);
const source = outer.addComponent('trit-input', 0, 0, { value: 1 });
const target = outer.addComponent(meta.type, 100, 0);
outer.connect(source.id, 'out', target.id, 'in');
outer.simulate();
assert(target.state.executionCost?.evaluations >= 3, 'structural execution cost must include internal evaluator work');
registry.remove(meta.type);

console.log('Implementation metadata passed: all built-ins classified; named accelerator references verified.');
