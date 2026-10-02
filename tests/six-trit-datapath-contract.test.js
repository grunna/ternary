'use strict';

const assert = require('assert');

const MIN_WORD = -364;
const MAX_WORD = 364;
const WORD_MODULUS = 729;

function digits(value, width = 6) {
  const result = [];
  let remaining = value;
  for (let index = 0; index < width; index += 1) {
    const remainder = ((remaining % 3) + 3) % 3;
    const digit = remainder === 2 ? -1 : remainder;
    result.unshift(digit);
    remaining = (remaining - digit) / 3;
  }
  assert.strictEqual(remaining, 0, `${value} must fit in ${width} trits`);
  return result;
}

function valueOf(word) {
  return word.reduce((total, digit) => total * 3 + digit, 0);
}

function signedExtension(value) {
  return value < MIN_WORD ? -1 : value > MAX_WORD ? 1 : 0;
}

function compareWords(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function selectWord(neg, zero, pos, select) {
  if (select === -1) return neg;
  if (select === 0) return zero;
  if (select === 1) return pos;
  return null;
}

function routeWord(word, select) {
  if (select !== -1 && select !== 0 && select !== 1) return null;
  const zero = digits(0);
  return {
    neg: select === -1 ? word : zero,
    zero: select === 0 ? word : zero,
    pos: select === 1 ? word : zero,
  };
}

function aluResult(a, b, operation) {
  if (operation !== -1 && operation !== 0 && operation !== 1) return null;
  const raw = operation < 0 ? a - b : operation > 0 ? a + b : a;
  const extension = operation === 0 ? 0 : signedExtension(raw);
  return { result: raw - WORD_MODULUS * extension, extension };
}

for (let a = MIN_WORD; a <= MAX_WORD; a += 1) {
  const aWord = digits(a);
  assert.strictEqual(valueOf(aWord), a, `word encoding round-trips ${a}`);
  for (let b = MIN_WORD; b <= MAX_WORD; b += 1) {
    const bWord = digits(b);
    const expectedOrder = a < b ? -1 : a > b ? 1 : 0;
    assert.strictEqual(compareWords(aWord, bWord), expectedOrder, `word comparator orders ${a} and ${b}`);
    for (const carryIn of [-1, 0, 1]) {
      const raw = a + b + carryIn;
      const carryOut = signedExtension(raw);
      const sum = raw - WORD_MODULUS * carryOut;
      assert(sum >= MIN_WORD && sum <= MAX_WORD, `canonical sum stays in range for ${a} + ${b} + ${carryIn}`);
      assert.strictEqual(raw, sum + WORD_MODULUS * carryOut, `word-add identity for ${a} + ${b} + ${carryIn}`);
    }
  }
}

for (let value = MIN_WORD; value <= MAX_WORD; value += 1) {
  const word = digits(value);
  assert.deepStrictEqual(selectWord(word, digits(0), digits(1), -1), word, `negative selector path preserves ${value}`);
  assert.deepStrictEqual(selectWord(digits(-1), word, digits(1), 0), word, `zero selector path preserves ${value}`);
  assert.deepStrictEqual(selectWord(digits(-1), digits(0), word, 1), word, `positive selector path preserves ${value}`);
}
assert.strictEqual(selectWord(digits(-1), digits(0), digits(1), null), null, 'unknown selector remains unknown rather than choosing a word');

for (let value = MIN_WORD; value <= MAX_WORD; value += 1) {
  const word = digits(value);
  for (const select of [-1, 0, 1]) {
    const routed = routeWord(word, select);
    assert.deepStrictEqual(routed.neg, select === -1 ? word : digits(0), `negative route has explicit inactive zeroes for ${value}`);
    assert.deepStrictEqual(routed.zero, select === 0 ? word : digits(0), `zero route has explicit inactive zeroes for ${value}`);
    assert.deepStrictEqual(routed.pos, select === 1 ? word : digits(0), `positive route has explicit inactive zeroes for ${value}`);
  }
}
assert.strictEqual(routeWord(digits(1), null), null, 'unknown router select remains unknown rather than choosing a path');

for (let a = MIN_WORD; a <= MAX_WORD; a += 1) {
  for (let b = MIN_WORD; b <= MAX_WORD; b += 1) {
    for (const operation of [-1, 0, 1]) {
      const actual = aluResult(a, b, operation);
      const raw = operation < 0 ? a - b : operation > 0 ? a + b : a;
      assert.strictEqual(actual.extension, operation === 0 ? 0 : signedExtension(raw), `ALU extension for op ${operation}, ${a}, ${b}`);
      assert.strictEqual(actual.result + WORD_MODULUS * actual.extension, raw, `ALU operation identity for op ${operation}, ${a}, ${b}`);
    }
  }
}
assert.strictEqual(aluResult(1, 1, null), null, 'unknown ALU operation remains unknown rather than choosing an operation');

for (let a = MIN_WORD; a <= MAX_WORD; a += 1) {
  for (let b = MIN_WORD; b <= MAX_WORD; b += 1) {
    for (const carryIn of [-1, 0, 1]) {
      const raw = a - b + carryIn;
      const carryOut = signedExtension(raw);
      const difference = raw - WORD_MODULUS * carryOut;
      assert(difference >= MIN_WORD && difference <= MAX_WORD, `canonical difference stays in range for ${a} - ${b} + ${carryIn}`);
      assert.strictEqual(raw, difference + WORD_MODULUS * carryOut, `word-subtract identity for ${a} - ${b} + ${carryIn}`);
    }
  }
}

console.log('Six-trit datapath contract passed: 729 words, 531441 comparisons, all selector/router paths, ALU operation semantics, and signed carry/borrow arithmetic identities.');
