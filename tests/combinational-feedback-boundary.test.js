'use strict';

const assert = require('assert');

global.window = global;
require('../js/core.js');

const { Circuit, registry } = global.TernaryCore;
const circuit = new Circuit(registry);
const register = circuit.addComponent('register3', 0, 0);
const selector = circuit.addComponent('select3', 0, 0);
const control = circuit.addComponent('trit-input', 0, 0, { value: 0 });

// Register → logic → register is sequential feedback, not a combinational loop.
circuit.connect(register.id, 'q', selector.id, 'zero');
circuit.connect(control.id, 'out', selector.id, 'select');
assert.doesNotThrow(() => circuit.connect(selector.id, 'out', register.id, 'd'));

const first = circuit.addComponent('select3', 0, 0);
const second = circuit.addComponent('select3', 0, 0);
circuit.connect(first.id, 'out', second.id, 'zero');
assert.throws(() => circuit.connect(second.id, 'out', first.id, 'zero'), /combinational feedback loop/);

console.log('Combinational feedback boundaries correctly permit sequential register feedback and reject logic-only cycles.');
