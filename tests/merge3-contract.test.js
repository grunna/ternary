'use strict';
const assert = require('assert');
global.window = global;
require('../js/core.js');
const { registry, FLOATING, UNKNOWN } = global.TernaryCore;
const definition = registry.get('merge3');
const values = [-1, 0, 1, FLOATING, UNKNOWN];
const expected = (inputs) => {
  const driven = inputs.filter((value) => value !== FLOATING);
  if (driven.length === 0) return FLOATING;
  if (driven.length !== 1) return UNKNOWN;
  return [-1, 0, 1].includes(driven[0]) ? driven[0] : UNKNOWN;
};
let cases = 0;
for (const a of values) for (const b of values) for (const c of values) {
  const actual = definition.evaluate({ inputs: { a, b, c } }).out;
  assert.strictEqual(actual, expected([a, b, c]), 'Merge3 mismatch for ' + JSON.stringify([a, b, c]));
  cases += 1;
}
console.log('Merge3 contract passed: ' + cases + ' exhaustive Z/?/trit cases.');
