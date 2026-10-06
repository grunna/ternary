'use strict';

const assert = require('assert');
global.window = global;
require('../js/core.js');

const { Circuit, registry, CPU_OPCODES, balancedWordDigits } = global.TernaryCore;
const lanes = ['5', '4', '3', '2', '1', '0'];
const coordinateIndex = (x, y) => (1 - y) * 3 + (x + 1);
const instruction = (opcode, rd = 0, ra = 0, rb = 0) => [...opcode, rd, ra, rb];

function createMachine(program) {
  const circuit = new Circuit(registry);
  const cpu = circuit.addComponent('cpu6', 0, 0);
  const adapter = circuit.addComponent('cpu-io-adapter3x3', 0, 0);
  const memory = circuit.addComponent('memory729x6', 0, 0);
  const display = circuit.addComponent('pixel-display3', 0, 0);
  const clock = circuit.addComponent('trit-input', 0, 0, { value: 0 });
  const cpuReset = circuit.addComponent('trit-input', 0, 0, { value: 0 });
  const reset = circuit.addComponent('trit-input', 0, 0, { value: 0 });
  const ioEnable = circuit.addComponent('trit-input', 0, 0, { value: 1 });
  const joystickX = circuit.addComponent('trit-input', 0, 0, { value: 0 });
  const joystickY = circuit.addComponent('trit-input', 0, 0, { value: 0 });
  const trace = [];
  circuit.events.on('output-changed', ({ componentId, port, value }) => {
    if (componentId === adapter.id && ['displayX', 'displayY', 'displayColor', 'displayClock', 'displayClearBeforeWrite'].includes(port)) trace.push({ source: 'adapter', port, value });
    if (componentId === cpu.id && ['memoryAction', 'memoryWrite2', 'memoryWrite1', 'memoryWrite0', 'phase'].includes(port)) trace.push({ source: 'cpu', port, value });
  });

  lanes.forEach((lane) => {
    circuit.connect(cpu.id, `address${lane}`, adapter.id, `address${lane}`);
    circuit.connect(cpu.id, `memoryWrite${lane}`, adapter.id, `dataIn${lane}`);
    circuit.connect(adapter.id, `ramAddress${lane}`, memory.id, `address${lane}`);
    circuit.connect(adapter.id, `ramDataIn${lane}`, memory.id, `dataIn${lane}`);
    circuit.connect(memory.id, `dataOut${lane}`, adapter.id, `ramData${lane}`);
    circuit.connect(adapter.id, `dataOut${lane}`, cpu.id, `memoryData${lane}`);
  });
  // The three packed low trits drive the display. The loop above only connects
  // the useful lanes once; explicit wiring keeps this public port map readable.
  for (const [from, to] of [['displayX', 'x'], ['displayY', 'y'], ['displayColor', 'color'], ['displayClearBeforeWrite', 'clearBeforeWrite'], ['displayClock', 'clock'], ['displayReset', 'reset']]) circuit.connect(adapter.id, from, display.id, to);
  circuit.connect(cpu.id, 'memoryAction', adapter.id, 'action');
  circuit.connect(cpu.id, 'phase', adapter.id, 'phase');
  circuit.connect(adapter.id, 'ramAction', memory.id, 'action');
  for (const component of [cpu, adapter, memory]) circuit.connect(clock.id, 'out', component.id, 'clock');
  circuit.connect(cpuReset.id, 'out', cpu.id, 'reset');
  circuit.connect(reset.id, 'out', adapter.id, 'reset');
  circuit.connect(ioEnable.id, 'out', adapter.id, 'ioEnable');
  circuit.connect(joystickX.id, 'out', adapter.id, 'joystickX');
  circuit.connect(joystickY.id, 'out', adapter.id, 'joystickY');

  const values = Array.from({ length: 729 }, () => Array(6).fill(0));
  program.forEach((word, address) => { values[address + 364] = word; });
  circuit.setState(memory.id, { values, previousClock: 0 });
  circuit.simulate();

  const pulse = () => {
    circuit.setState(clock.id, { value: 0 }); circuit.simulate();
    circuit.setState(clock.id, { value: 1 }); circuit.simulate();
  };
  circuit.setState(cpuReset.id, { value: 1 }); pulse();
  circuit.setState(cpuReset.id, { value: 0 }); circuit.setState(clock.id, { value: 0 }); circuit.simulate();
  return { circuit, cpu, adapter, display, clock, pulse, trace };
}

function stepInstruction(machine) { machine.pulse(); machine.pulse(); }
function frameWith(x, y, color = 1) { const pixels = Array(9).fill(0); pixels[coordinateIndex(x, y)] = color; return pixels; }

const A = { x: 0, y: 0, color: 1, immediate: [0, 1] }; // 0 0 +
const B = { x: 0, y: 1, color: 1, immediate: [1, 1] }; // 0 + +
const C = { x: 0, y: -1, color: 1, immediate: [-1, 1] }; // 0 - +
const D = { x: -1, y: 1, color: 1, immediate: [1, 1] }; // - + +

function displayProgram(sequence) {
  // R+ is the memory-mapped display address +4. R0 carries packed t2/t1/t0.
  const words = [instruction(CPU_OPCODES.LIT, 1, 1, 1)];
  sequence.forEach((pixel) => {
    if (pixel === D) {
      // −1 − +4 = −5, whose low trits are − + + (top-left green).
      words.push(instruction(CPU_OPCODES.LIT, -1, 0, -1));
      words.push(instruction(CPU_OPCODES.LIT, 0, 1, 1));
      words.push(instruction(CPU_OPCODES.SUB, 0, -1, 0));
    } else words.push(instruction(CPU_OPCODES.LIT, 0, pixel.immediate[0], pixel.immediate[1]));
    words.push(instruction(CPU_OPCODES.STORE, 0, 1, 0));
  });
  words.push(instruction(CPU_OPCODES.HALT));
  return words;
}

function executeInstructions(machine, count) { for (let index = 0; index < count; index += 1) stepInstruction(machine); }

{
  const machine = createMachine(displayProgram([A, B]));
  executeInstructions(machine, 3);
  assert.deepStrictEqual(machine.display.state.pixels, frameWith(A.x, A.y), 'STORE A must update the display');
  executeInstructions(machine, 2);
  if (process.env.TERNARY_TRACE) console.log('after B', { display: machine.display.state, adapter: Object.fromEntries(['displayX', 'displayY', 'displayColor', 'displayClock', 'displayClearBeforeWrite'].map((name) => [name, machine.adapter.outputs[name]])), cpu: machine.cpu.state, clock: machine.clock.state.value, trace: machine.trace });
  assert.deepStrictEqual(machine.display.state.pixels, frameWith(B.x, B.y), 'the immediately following STORE B must replace A');
}

{
  const machine = createMachine(displayProgram([A, B, B]));
  executeInstructions(machine, 3); assert.deepStrictEqual(machine.display.state.pixels, frameWith(A.x, A.y), 'A must be visible after the first STORE');
  executeInstructions(machine, 2); assert.deepStrictEqual(machine.display.state.pixels, frameWith(B.x, B.y), 'B must be visible after the second STORE');
  executeInstructions(machine, 2); assert.deepStrictEqual(machine.display.state.pixels, frameWith(B.x, B.y), 'repeating B must remain B');
}

{
  const machine = createMachine(displayProgram([A, B, C, D]));
  [3, 2, 2, 4].forEach((instructionCount, index) => {
    const pixel = [A, B, C, D][index];
    executeInstructions(machine, instructionCount);
    assert.deepStrictEqual(machine.display.state.pixels, frameWith(pixel.x, pixel.y), `STORE ${index + 1} must display its packed x/y/color value`);
  });
}

console.log('CPU Pixel Display STORE regression passed: consecutive memory-mapped writes produce A → B, A → B → B, and A → B → C → D.');
