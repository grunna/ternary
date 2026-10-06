(function (global) {
  'use strict';

  const TRITS = Object.freeze([-1, 0, 1]);
  const UNKNOWN = null;
  const FLOATING = 'Z';
  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const isUnknown = (value) => value === null || value === undefined;
  const isFloating = (value) => value === FLOATING;
  const isKnownTrit = (value) => !isUnknown(value) && !isFloating(value);
  const trit = (value) => isUnknown(value) ? UNKNOWN : isFloating(value) ? FLOATING : Number(value) < 0 ? -1 : Number(value) > 0 ? 1 : 0;
  const balancedWordDigits = (value, width = 6) => {
    const digits = [];
    let remaining = Math.round(Number(value));
    for (let index = 0; index < width; index += 1) {
      const remainder = ((remaining % 3) + 3) % 3;
      const digit = remainder === 2 ? -1 : remainder;
      digits.unshift(digit);
      remaining = (remaining - digit) / 3;
    }
    return remaining === 0 ? digits : null;
  };
  const balancedWordValue = (values) => values.every(isKnownTrit) ? values.reduce((total, value) => total * 3 + trit(value), 0) : null;
  const CPU_OPCODES = Object.freeze({ HALT: [-1, -1, -1], MOV: [-1, -1, 0], ADD: [-1, -1, 1], SUB: [-1, 0, -1], LOAD: [-1, 0, 0], STORE: [-1, 0, 1], JUMP: [-1, 1, -1], BRZ: [-1, 1, 0], NOP: [-1, 1, 1], LIT: [1, -1, -1], LITW: [1, -1, 0] });
  const opcodeKey = (values) => values.map(trit).join(',');
  const decodeInstruction6 = (values) => {
    const word = Array.isArray(values) ? values.map(trit) : [];
    if (word.length !== 6 || !word.every(isKnownTrit)) return { valid: false, mnemonic: 'INVALID', registerWrite: 0, memoryAction: 0, pcLoad: 0, pcControl: 0 };
    const [op2, op1, op0, rd, ra, rb] = word;
    const base = { valid: true, rd, ra, rb, registerWrite: 0, writeBackSelect: 0, aluOperation: 0, memoryAction: 0, pcLoad: 0, pcControl: 1, halt: 0, branchIfZero: 0 };
    const mnemonic = Object.entries(CPU_OPCODES).find(([, opcode]) => opcodeKey(opcode) === opcodeKey([op2, op1, op0]))?.[0];
    if (!mnemonic) return { ...base, valid: false, mnemonic: 'RESERVED', pcControl: 0 };
    if (mnemonic === 'HALT') return { ...base, mnemonic, halt: 1, pcControl: 0 };
    if (mnemonic === 'MOV') return { ...base, mnemonic, registerWrite: 1, writeBackSelect: 0 };
    if (mnemonic === 'ADD') return { ...base, mnemonic, registerWrite: 1, writeBackSelect: 1, aluOperation: 1 };
    if (mnemonic === 'SUB') return { ...base, mnemonic, registerWrite: 1, writeBackSelect: 1, aluOperation: -1 };
    if (mnemonic === 'LOAD') return { ...base, mnemonic, registerWrite: 1, writeBackSelect: -1, memoryAction: -1 };
    if (mnemonic === 'STORE') return { ...base, mnemonic, memoryAction: 1 };
    if (mnemonic === 'JUMP') return { ...base, mnemonic, pcLoad: 1 };
    if (mnemonic === 'BRZ') return { ...base, mnemonic, branchIfZero: 1 };
    if (mnemonic === 'LIT') return { ...base, mnemonic, registerWrite: 1, writeBackSelect: -1, immediate: 1 };
    if (mnemonic === 'LITW') return { ...base, mnemonic, literalWord: 1 };
    return { ...base, mnemonic };
  };
  const CPU_PHASES = Object.freeze({ FETCH: 'fetch', EXECUTE: 'execute', HALTED: 'halted' });
  const cpuSequencerControls = (phase, decoded = {}, branchZero = false) => {
    if (phase === CPU_PHASES.FETCH) return { instructionLoad: 1, memoryAction: -1, registerWrite: 0, pcControl: 0, pcLoad: 0, halted: 0 };
    if (phase === CPU_PHASES.HALTED) return { instructionLoad: 0, memoryAction: 0, registerWrite: 0, pcControl: 0, pcLoad: 0, halted: 1 };
    const branchTaken = decoded.branchIfZero === 1 && branchZero === true;
    return { instructionLoad: 0, memoryAction: decoded.memoryAction || 0, registerWrite: decoded.registerWrite || 0, writeBackSelect: decoded.writeBackSelect || 0, immediate: decoded.immediate || 0, aluOperation: decoded.aluOperation || 0, pcControl: decoded.halt === 1 || decoded.valid === false ? 0 : 1, pcLoad: decoded.pcLoad === 1 || branchTaken ? 1 : 0, halted: 0 };
  };
  const nextCpuPhase = (phase, decoded = {}, { reset = false } = {}) => {
    if (reset) return CPU_PHASES.FETCH;
    if (phase === CPU_PHASES.HALTED) return CPU_PHASES.HALTED;
    if (phase === CPU_PHASES.FETCH) return CPU_PHASES.EXECUTE;
    return decoded.halt === 1 ? CPU_PHASES.HALTED : CPU_PHASES.FETCH;
  };
  const signExtendAddress3 = (values) => {
    const address = Array.isArray(values) ? values.map(trit) : [];
    if (address.length !== 3 || !address.every(isKnownTrit)) return Array(6).fill(UNKNOWN);
    // Balanced ternary is positional, not two's complement: leading copies of
    // a negative trit change the number. Zero-prefixing preserves −13…+13.
    return [0, 0, 0, ...address];
  };
  // Memory reads are zero-cycle: the selected word settles before this phase's
  // closing edge. LOAD therefore writes that settled word at its execute edge;
  // STORE instead commits its input word on that same edge.
  const cpuMemoryCycle = (phase, executeAction = 0, executeRegisterWrite = 0) => {
    if (phase === CPU_PHASES.FETCH) return { action: -1, instructionLoad: 1, readSample: 1, loadWrite: 0, storeWrite: 0, readLatency: 0 };
    if (phase !== CPU_PHASES.EXECUTE) return { action: 0, instructionLoad: 0, readSample: 0, loadWrite: 0, storeWrite: 0, readLatency: 0 };
    const action = trit(executeAction), registerWrite = trit(executeRegisterWrite);
    if (!isKnownTrit(action) || !isKnownTrit(registerWrite)) return { action: UNKNOWN, instructionLoad: 0, readSample: UNKNOWN, loadWrite: UNKNOWN, storeWrite: UNKNOWN, readLatency: 0 };
    return { action, instructionLoad: 0, readSample: action === -1 ? 1 : 0, loadWrite: action === -1 && registerWrite === 1 ? 1 : 0, storeWrite: action === 1 ? 1 : 0, readLatency: 0 };
  };
  const cpuControlFlow6 = (phase, controls = {}, compareEqual = UNKNOWN, ra = [], rb = []) => {
    const idle = { pcControl: 0, pcLoad: 0, branchTaken: 0, target: Array(6).fill(UNKNOWN) };
    if (phase !== CPU_PHASES.EXECUTE || trit(controls.pcControl) !== 1) return idle;
    const branchIfZero = trit(controls.branchIfZero), pcLoadRequest = trit(controls.pcLoad);
    if (branchIfZero === 1) {
      const target = signExtendAddress3(rb.slice(-3));
      if (compareEqual === 1 && target.every(isKnownTrit)) return { pcControl: 0, pcLoad: 1, branchTaken: 1, target };
      if (compareEqual === 0) return { pcControl: 1, pcLoad: 0, branchTaken: 0, target };
      return { pcControl: UNKNOWN, pcLoad: UNKNOWN, branchTaken: UNKNOWN, target };
    }
    if (pcLoadRequest === 1) {
      const target = signExtendAddress3(ra.slice(-3));
      return target.every(isKnownTrit) ? { pcControl: 0, pcLoad: 1, branchTaken: 0, target } : { pcControl: UNKNOWN, pcLoad: UNKNOWN, branchTaken: 0, target };
    }
    return { ...idle, pcControl: 1, target: signExtendAddress3(ra.slice(-3)) };
  };
  const RGB_WORD_PORTS = ['r5', 'r4', 'r3', 'r2', 'r1', 'r0', 'g5', 'g4', 'g3', 'g2', 'g1', 'g0', 'b5', 'b4', 'b3', 'b2', 'b1', 'b0'];
  const RGB_DISPLAY_SIZE = 24;
  const emptyRgbFrame = () => Array.from({ length: RGB_DISPLAY_SIZE * RGB_DISPLAY_SIZE }, () => [0, 0, 0]);
  const rgbInput = (inputs) => ({
    r: balancedWordValue(['r5', 'r4', 'r3', 'r2', 'r1', 'r0'].map((name) => trit(inputs[name]))),
    g: balancedWordValue(['g5', 'g4', 'g3', 'g2', 'g1', 'g0'].map((name) => trit(inputs[name]))),
    b: balancedWordValue(['b5', 'b4', 'b3', 'b2', 'b1', 'b0'].map((name) => trit(inputs[name]))),
  });

  // A declared state boundary retains a value between evaluations. Its output can
  // therefore feed a later combinational path back to its input without making the
  // combinational graph cyclic. All other feedback remains invalid.
  const breaksCombinationalPath = (component, registry) => Boolean(component && registry.get(component.type)?.breaksCombinationalPath);
  const hasGraphCycle = (wires, components, registry) => {
    const outgoing = new Map();
    for (const wire of wires) {
      const source = components.get(wire.from.componentId);
      if (breaksCombinationalPath(source, registry)) continue;
      if (!outgoing.has(wire.from.componentId)) outgoing.set(wire.from.componentId, []);
      outgoing.get(wire.from.componentId).push(wire.to.componentId);
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (componentId) => {
      if (visiting.has(componentId)) return true;
      if (visited.has(componentId)) return false;
      visiting.add(componentId);
      for (const next of outgoing.get(componentId) || []) if (visit(next)) return true;
      visiting.delete(componentId);
      visited.add(componentId);
      return false;
    };
    return [...outgoing.keys()].some(visit);
  };

  const normalizeSequence = (sequence) => {
    const values = Array.isArray(sequence) ? sequence : String(sequence || '').split(/[\s,;]+/);
    const normalized = values
      .filter((value) => value !== '' && value !== null && value !== undefined)
      .map((value) => trit(value));
    return normalized.length ? normalized : [0, 1];
  };

  const nextSequenceState = (state = {}) => {
    const sequence = normalizeSequence(state.sequence);
    const mode = state.mode === 'loop' ? 'loop' : 'pingpong';
    let index = Number.isInteger(Number(state.index)) ? Number(state.index) : 0;
    let direction = Number(state.direction) < 0 ? -1 : 1;
    index = Math.max(0, Math.min(sequence.length - 1, index));

    if (sequence.length === 1) {
      return { sequence, mode, index: 0, direction: 1, value: sequence[0] };
    }

    if (mode === 'loop') {
      index = (index + 1) % sequence.length;
    } else {
      let next = index + direction;
      if (next >= sequence.length) {
        direction = -1;
        next = Math.max(0, sequence.length - 2);
      } else if (next < 0) {
        direction = 1;
        next = Math.min(sequence.length - 1, 1);
      }
      index = next;
    }

    return { sequence, mode, index, direction, value: sequence[index] };
  };

  class EventBus {
    constructor() { this.listeners = new Map(); }
    on(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
      return () => this.listeners.get(type)?.delete(listener);
    }
    emit(type, payload) {
      for (const listener of this.listeners.get(type) || []) listener(payload);
      for (const listener of this.listeners.get('*') || []) listener({ type, payload });
    }
  }

  class ComponentRegistry {
    constructor() { this.definitions = new Map(); }
    register(definition, { replace = false } = {}) {
      if (!definition?.type) throw new Error('Component definition needs a type.');
      if (!replace && this.definitions.has(definition.type)) throw new Error(`Duplicate component type: ${definition.type}`);
      this.definitions.set(definition.type, {
        label: definition.type, inputs: [], outputs: [], candidate: false, category: 'utility',
        cost: { logical: { nodes: 1, depth: 1 } },
        ...definition,
      });
      return this.definitions.get(definition.type);
    }
    remove(type) { this.definitions.delete(type); }
    get(type) {
      const definition = this.definitions.get(type);
      if (!definition) throw new Error(`Unknown component type: ${type}`);
      return definition;
    }
    has(type) { return this.definitions.has(type); }
    list() { return [...this.definitions.values()]; }
  }

  class Circuit {
    constructor(registry) {
      this.registry = registry;
      this.components = new Map();
      this.wires = new Map();
      this.events = new EventBus();
      this.nextComponentId = 1;
      this.nextWireId = 1;
      this.stats = { evaluations: 0, signalChanges: 0, lastSteps: 0 };
      this.maxPropagationSteps = 10000;

      // Propagation can either settle immediately (normal editing) or be kept
      // in a persistent queue so the UI can pause, visualize and single-step.
      this.executionMode = 'instant';
      this.propagationQueue = [];
      this.propagationQueued = new Set();
      this.propagationSequence = 1;
      this.propagationStepsSinceSettle = 0;
      this.generatorElapsed = new Map();
      // Sequential components stage their next state while combinational logic settles.
      // A commit applies every staged change together at a clock boundary.
      this.pendingStateCommits = new Map();
    }

    getStagedState(componentId) {
      const component = this.components.get(componentId);
      return { ...(component?.state || {}), ...(this.pendingStateCommits.get(componentId) || {}) };
    }

    stageStateCommit(componentId, patch) {
      const component = this.components.get(componentId);
      if (!component || !patch) return false;
      const next = { ...this.getStagedState(componentId), ...clone(patch) };
      const current = this.getStagedState(componentId);
      if (JSON.stringify(next) === JSON.stringify(current)) return false;
      this.pendingStateCommits.set(componentId, next);
      this.events.emit('state-staged', { componentId, patch: clone(patch), pendingCount: this.pendingStateCommits.size });
      return true;
    }

    getPendingStateCommitCount() { return this.pendingStateCommits.size; }

    flushSequentialState() {
      const staged = [...this.pendingStateCommits.entries()];
      this.pendingStateCommits.clear();
      const changes = [];
      for (const [componentId, nextState] of staged) {
        const component = this.components.get(componentId);
        if (!component || JSON.stringify(component.state) === JSON.stringify(nextState)) continue;
        const before = clone(component.state);
        component.state = clone(nextState);
        changes.push({ componentId, before, after: clone(component.state) });
        this.events.emit('component-state', component);
        this.enqueuePropagation(componentId, 'clocked state update');
      }
      if (changes.length) this.events.emit('state-committed', { changes: clone(changes) });
      return changes.length;
    }

    addComponent(type, x = 0, y = 0, state = {}) {
      const definition = this.registry.get(type);
      const id = `c${this.nextComponentId++}`;
      const component = {
        id, type, x, y,
        state: { ...(definition.defaultState || {}), ...clone(state) },
        inputs: Object.fromEntries(definition.inputs.map((name) => [name, UNKNOWN])),
        outputs: Object.fromEntries(definition.outputs.map((name) => [name, UNKNOWN])),
      };
      this.components.set(id, component);
      this.events.emit('component-added', component);
      this.requestSimulation([id], 'component added');
      return component;
    }

    removeComponent(id) {
      if (!this.components.has(id)) return;
      [...this.wires.values()]
        .filter((wire) => wire.from.componentId === id || wire.to.componentId === id)
        .map((wire) => wire.id)
        .forEach((wireId) => this.disconnect(wireId));
      const component = this.components.get(id);
      this.components.delete(id);
      this.generatorElapsed.delete(id);
      this.pendingStateCommits.delete(id);
      this.propagationQueued.delete(id);
      this.propagationQueue = this.propagationQueue.filter((event) => event.componentId !== id);
      this.events.emit('component-removed', component);
      this.emitQueueChanged();
    }

    moveComponent(id, x, y) {
      const component = this.components.get(id);
      if (!component) return;
      component.x = Number(x) || 0;
      component.y = Number(y) || 0;
      this.events.emit('component-moved', component);
    }

    setState(id, patch) {
      const component = this.components.get(id);
      if (!component) return;
      Object.assign(component.state, clone(patch));
      this.events.emit('component-state', component);
      this.requestSimulation([id], 'state changed');
    }

    cycleTritInput(id) {
      const component = this.components.get(id);
      if (!component || component.type !== 'trit-input') return;
      const current = trit(component.state.value);
      this.setState(id, { value: current === -1 ? 0 : current === 0 ? 1 : -1 });
    }

    connect(fromComponentId, fromPort, toComponentId, toPort) {
      const fromComponent = this.components.get(fromComponentId);
      const toComponent = this.components.get(toComponentId);
      if (!fromComponent || !toComponent) throw new Error('Both components must exist.');
      const fromDef = this.registry.get(fromComponent.type);
      const toDef = this.registry.get(toComponent.type);
      if (!fromDef.outputs.includes(fromPort)) throw new Error(`${fromPort} is not an output.`);
      if (!toDef.inputs.includes(toPort)) throw new Error(`${toPort} is not an input.`);
      if (fromComponentId === toComponentId && !breaksCombinationalPath(fromComponent, this.registry)) throw new Error('Self-connections require a declared storage cell.');

      const existing = [...this.wires.values()].find((wire) => wire.to.componentId === toComponentId && wire.to.port === toPort);
      if (this.wouldCreateCombinationalLoop(fromComponentId, toComponentId, existing?.id)) {
        throw new Error('Connection would create a combinational feedback loop.');
      }
      if (existing) this.disconnect(existing.id);

      const id = `w${this.nextWireId++}`;
      const value = trit(fromComponent.outputs[fromPort]);
      const wire = { id, from: { componentId: fromComponentId, port: fromPort }, to: { componentId: toComponentId, port: toPort }, value, label: '' };
      this.wires.set(id, wire);
      toComponent.inputs[toPort] = value;
      this.events.emit('wire-added', wire);
      this.requestSimulation([toComponentId], `connected ${id}`);
      return wire;
    }

    wouldCreateCombinationalLoop(fromComponentId, toComponentId, ignoredWireId = null) {
      // A storage output is a temporal boundary. Even if its value is later
      // routed back to that storage cell's input, the new outgoing edge cannot
      // close a *combinational* path.
      if (breaksCombinationalPath(this.components.get(fromComponentId), this.registry)) return false;
      const outgoing = new Map();
      for (const wire of this.wires.values()) {
        if (wire.id === ignoredWireId) continue;
        const source = this.components.get(wire.from.componentId);
        if (breaksCombinationalPath(source, this.registry)) continue;
        if (!outgoing.has(wire.from.componentId)) outgoing.set(wire.from.componentId, []);
        outgoing.get(wire.from.componentId).push(wire.to.componentId);
      }
      const pending = [toComponentId];
      const visited = new Set();
      while (pending.length) {
        const componentId = pending.pop();
        if (componentId === fromComponentId) return true;
        if (visited.has(componentId)) continue;
        visited.add(componentId);
        pending.push(...(outgoing.get(componentId) || []));
      }
      return false;
    }

    setWireLabel(id, label) {
      const wire = this.wires.get(id);
      if (!wire) return;
      wire.label = String(label || '').trim();
      this.events.emit('wire-updated', wire);
    }

    disconnect(id) {
      const wire = this.wires.get(id);
      if (!wire) return;
      this.wires.delete(id);
      const target = this.components.get(wire.to.componentId);
      if (target) {
        target.inputs[wire.to.port] = UNKNOWN;
        this.requestSimulation([target.id], `disconnected ${id}`);
      }
      this.events.emit('wire-removed', wire);
    }

    setExecutionMode(mode) {
      if (!['instant', 'manual'].includes(mode)) throw new Error(`Unknown execution mode: ${mode}`);
      this.executionMode = mode;
      this.events.emit('execution-mode', mode);
    }

    requestSimulation(initialIds, reason = 'changed') {
      if (this.executionMode === 'instant') return this.simulate(initialIds, reason);
      this.queueSimulation(initialIds, reason);
      return 0;
    }

    queueSimulation(initialIds, reason = 'queued') {
      const ids = Array.isArray(initialIds) && initialIds.length
        ? initialIds
        : [...this.components.keys()];
      for (const id of ids) this.enqueuePropagation(id, reason);
      return this.propagationQueue.length;
    }

    enqueuePropagation(componentId, reason = 'signal changed') {
      if (!componentId || !this.components.has(componentId) || this.propagationQueued.has(componentId)) return false;
      const event = { sequence: this.propagationSequence++, componentId, reason };
      this.propagationQueued.add(componentId);
      this.propagationQueue.push(event);
      this.events.emit('event-queued', event);
      this.emitQueueChanged();
      return true;
    }

    emitQueueChanged() {
      this.events.emit('queue-changed', this.getQueuedEvents());
    }

    getQueuedEvents() {
      return this.propagationQueue.map((event) => {
        const component = this.components.get(event.componentId);
        const definition = component ? this.registry.get(component.type) : null;
        return {
          ...event,
          type: component?.type || null,
          label: component ? (component.state?.label || definition?.label || component.type) : 'missing component',
        };
      });
    }

    clearPropagationQueue() {
      this.propagationQueue.length = 0;
      this.propagationQueued.clear();
      this.propagationStepsSinceSettle = 0;
      this.emitQueueChanged();
    }

    stepPropagation() {
      const event = this.propagationQueue.shift();
      if (!event) return null;
      this.propagationQueued.delete(event.componentId);
      this.emitQueueChanged();

      if (++this.propagationStepsSinceSettle > this.maxPropagationSteps) {
        this.clearPropagationQueue();
        const error = new Error('Propagation did not settle. Possible feedback loop or unstable circuit.');
        this.events.emit('simulation-error', error);
        throw error;
      }

      const component = this.components.get(event.componentId);
      if (!component) return event;
      const definition = this.registry.get(component.type);
      const beforeState = JSON.stringify(component.state);
      const nextOutputs = definition.evaluate(component, { trit, circuit: this, registry: this.registry }) || {};
      this.stats.evaluations++;
      if (JSON.stringify(component.state) !== beforeState) this.events.emit('component-state', component);

      const changedOutputs = [];
      for (const port of definition.outputs) {
        const nextValue = trit(nextOutputs[port]);
        const previousValue = trit(component.outputs[port]);
        if (nextValue === previousValue) continue;
        component.outputs[port] = nextValue;
        this.stats.signalChanges++;
        changedOutputs.push({ port, previousValue, value: nextValue });
        this.events.emit('output-changed', { componentId: component.id, port, previousValue, value: nextValue });

        for (const wire of this.wires.values()) {
          if (wire.from.componentId !== component.id || wire.from.port !== port) continue;
          if (wire.value !== nextValue) {
            const previousWireValue = wire.value;
            wire.value = nextValue;
            this.events.emit('wire-signal', { wire, previousValue: previousWireValue, value: nextValue });
          }
          const target = this.components.get(wire.to.componentId);
          if (target && target.inputs[wire.to.port] !== nextValue) {
            target.inputs[wire.to.port] = nextValue;
            this.enqueuePropagation(target.id, `${component.id}.${port} → ${wire.id}`);
          }
        }
      }

      this.events.emit('component-evaluated', component);
      const result = { ...event, component, changedOutputs, queueLength: this.propagationQueue.length };
      this.events.emit('propagation-step', result);

      if (!this.propagationQueue.length && this.pendingStateCommits.size) this.flushSequentialState();
      if (!this.propagationQueue.length) {
        const steps = this.propagationStepsSinceSettle;
        this.stats.lastSteps = steps;
        this.propagationStepsSinceSettle = 0;
        this.events.emit('settled', { ...this.stats, steps });
      }
      return result;
    }

    simulate(initialIds, reason = 'settle') {
      this.queueSimulation(initialIds, reason);
      let steps = 0;
      while (this.propagationQueue.length) {
        this.stepPropagation();
        steps++;
      }
      return steps;
    }

    advanceSequenceGenerator(component, reason = 'clock step') {
      if (!component || (component.type !== 'sequence-generator' && component.type !== 'clock')) return false;

      if (component.type === 'clock') {
        const current = trit(component.state.value);
        component.state.value = current === 0 ? 1 : 0;
      } else {
        const next = nextSequenceState(component.state);
        component.state.sequence = next.sequence;
        component.state.mode = next.mode;
        component.state.index = next.index;
        component.state.direction = next.direction;
        component.state.value = next.value;
      }

      this.events.emit('component-state', component);
      this.requestSimulation([component.id], reason);
      return true;
    }

    clockStep() {
      const generators = [...this.components.values()]
        .filter((component) => component.type === 'sequence-generator' || component.type === 'clock');
      const mode = this.executionMode;
      this.executionMode = 'manual';
      for (const generator of generators) this.advanceSequenceGenerator(generator, 'clock step');
      this.executionMode = mode;
      if (mode === 'instant' && this.propagationQueue.length) this.simulate();
      this.events.emit('clock-step', { clocks: generators.map((generator) => generator.id), pendingCommits: this.getPendingStateCommitCount() });
      return generators.length;
    }

    tickSequenceGenerators(deltaMs) {
      const elapsedMs = Math.max(0, Number(deltaMs) || 0);
      if (!elapsedMs) return 0;

      let advances = 0;
      for (const generator of this.components.values()) {
        if (generator.type !== 'sequence-generator' || !generator.state.auto) continue;
        const interval = Math.max(20, Number(generator.state.intervalMs) || 500);
        let elapsed = (this.generatorElapsed.get(generator.id) || 0) + elapsedMs;
        let guard = 0;
        while (elapsed >= interval && guard++ < 100) {
          elapsed -= interval;
          if (this.advanceSequenceGenerator(generator, 'sequence interval')) advances++;
        }
        this.generatorElapsed.set(generator.id, elapsed);
      }
      return advances;
    }

    resetSequenceTiming(componentId = null) {
      if (componentId) this.generatorElapsed.delete(componentId);
      else this.generatorElapsed.clear();
    }

    clear() {
      this.components.clear(); this.wires.clear();
      this.nextComponentId = 1; this.nextWireId = 1;
      this.stats = { evaluations: 0, signalChanges: 0, lastSteps: 0 };
      this.generatorElapsed.clear();
      this.pendingStateCommits.clear();
      this.clearPropagationQueue();
      this.events.emit('cleared');
    }

    serialize() {
      return { version: 1, components: [...this.components.values()].map(clone), wires: [...this.wires.values()].map(clone) };
    }

    load(data) {
      if (!data || data.version !== 1) throw new Error('Unsupported circuit format.');
      const rawComponents = new Map((data.components || []).map((component) => [component.id, component]));
      const validWires = (data.wires || []).filter((wire) => {
        const source = rawComponents.get(wire.from?.componentId);
        const target = rawComponents.get(wire.to?.componentId);
        if (!source || !target) return false;
        const sourceDef = this.registry.get(source.type);
        const targetDef = this.registry.get(target.type);
        return sourceDef.outputs.includes(wire.from?.port) && targetDef.inputs.includes(wire.to?.port);
      });
      if (hasGraphCycle(validWires, rawComponents, this.registry)) throw new Error('Circuit contains a combinational feedback loop.');
      this.clear();
      let maxComponent = 0;
      for (const raw of data.components || []) {
        const definition = this.registry.get(raw.type);
        const component = {
          id: raw.id, type: raw.type,
          x: Number(raw.x) || 0, y: Number(raw.y) || 0,
          state: { ...(definition.defaultState || {}), ...(raw.state || {}) },
          inputs: Object.fromEntries(definition.inputs.map((name) => [name, trit(raw.inputs?.[name])])),
          outputs: Object.fromEntries(definition.outputs.map((name) => [name, trit(raw.outputs?.[name])])),
        };
        this.components.set(component.id, component);
        maxComponent = Math.max(maxComponent, Number(component.id.slice(1)) || 0);
      }
      let maxWire = 0;
      for (const raw of data.wires || []) {
        const source = this.components.get(raw.from?.componentId);
        const target = this.components.get(raw.to?.componentId);
        if (!source || !target) continue;
        const sourceDef = this.registry.get(source.type);
        const targetDef = this.registry.get(target.type);
        if (!sourceDef.outputs.includes(raw.from?.port) || !targetDef.inputs.includes(raw.to?.port)) continue;
        const wire = { id: raw.id, from: clone(raw.from), to: clone(raw.to), value: trit(raw.value), label: String(raw.label || '') };
        this.wires.set(wire.id, wire);
        maxWire = Math.max(maxWire, Number(wire.id.slice(1)) || 0);
      }
      this.nextComponentId = maxComponent + 1;
      this.nextWireId = maxWire + 1;
      for (const component of this.components.values()) {
        const definition = this.registry.get(component.type);
        for (const input of definition.inputs) component.inputs[input] = UNKNOWN;
      }
      for (const wire of this.wires.values()) {
        const source = this.components.get(wire.from.componentId);
        const target = this.components.get(wire.to.componentId);
        wire.value = trit(source.outputs[wire.from.port]);
        target.inputs[wire.to.port] = wire.value;
      }
      this.events.emit('loaded', this.serialize());
      this.requestSimulation(null, 'circuit loaded');
    }
  }

  function slug(text) {
    return String(text || 'component').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'component';
  }

  function boundaryPorts(circuitData) {
    const inputs = [];
    const outputs = [];
    const displays = [];
    const usedInputs = new Set();
    const usedOutputs = new Set();
    for (const component of circuitData.components || []) {
      if (component.type === 'component-input') {
        const name = String(component.state?.name || 'in').trim();
        if (!name) throw new Error('Component Input needs a name.');
        if (usedInputs.has(name)) throw new Error(`Duplicate component input name: ${name}`);
        usedInputs.add(name); inputs.push({ name, componentId: component.id });
      } else if (component.type === 'component-output') {
        const name = String(component.state?.name || 'out').trim();
        if (!name) throw new Error('Component Output needs a name.');
        if (usedOutputs.has(name)) throw new Error(`Duplicate component output name: ${name}`);
        usedOutputs.add(name); outputs.push({ name, componentId: component.id });
      } else if (component.type === 'component-seven-segment-display') {
        displays.push({ componentId: component.id });
      }
    }
    if (displays.length > 1) throw new Error('A reusable component can have only one 7-segment display output.');
    return { inputs, outputs, display: displays[0] || null };
  }

  function makeCustomDefinition(meta, registry) {
    const boundaries = boundaryPorts(meta.circuit);
    const runtimeVersion = Math.max(1, Number(meta.runtimeVersion) || 1);
    const breaksPath = (meta.circuit.components || []).some((component) => registry.get(component.type)?.breaksCombinationalPath);
    return {
      type: meta.type,
      label: meta.label,
      inputs: boundaries.inputs.map((p) => p.name),
      outputs: boundaries.outputs.map((p) => p.name),
      custom: true,
      customId: meta.id,
      visual: boundaries.display ? { kind: 'seven-segment', componentId: boundaries.display.componentId } : null,
      breaksCombinationalPath: breaksPath,
      circuit: clone(meta.circuit),
      defaultState: { runtimeVersion, runtime: null },
      evaluate(component) {
        // Runtime belongs to this *instance*, rather than the reusable definition.
        // It lets nested storage cells retain state and makes multiple instances independent.
        const inner = new Circuit(registry);
        const canRestore = component.state.runtime && Number(component.state.runtimeVersion) === runtimeVersion;
        try { inner.load(canRestore ? component.state.runtime : meta.circuit); }
        catch (_) { inner.load(meta.circuit); }
        for (const input of boundaries.inputs) inner.setState(input.componentId, { value: trit(component.inputs[input.name]) });
        inner.simulate();
        const result = {};
        for (const output of boundaries.outputs) {
          const boundary = inner.components.get(output.componentId);
          result[output.name] = trit(boundary?.state?.value);
        }
        if (boundaries.display) {
          const display = inner.components.get(boundaries.display.componentId);
          component.state.displaySegments = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'sign'].map((name) => [name, trit(display?.inputs?.[name])]));
        }
        // Keep a per-evaluation cost record for equivalence comparisons. A
        // nested custom component reports its own recursive work, so the
        // parent cost includes every evaluated structural node.
        const nestedEvaluations = [...inner.components.values()].reduce((total, child) => total + (Number(child.state?.executionCost?.evaluations) || 0), 0);
        component.state.executionCost = { evaluations: inner.stats.evaluations + nestedEvaluations, signalChanges: inner.stats.signalChanges };
        component.state.runtimeVersion = runtimeVersion;
        component.state.runtime = inner.serialize();
        return result;
      },
    };
  }

  const needsKnownInputs = (component, names) => names.every((name) => isKnownTrit(component.inputs[name]));

  const registry = new ComponentRegistry();

  registry.register({ type: 'trit-input', label: 'Interactive trit input', inputs: [], outputs: ['out'], defaultState: { value: 0 }, evaluate: (c) => ({ out: trit(c.state.value) }) });
  registry.register({ type: 'word-input6', label: 'Interactive 6-trit word input', inputs: [], outputs: ['t5', 't4', 't3', 't2', 't1', 't0'], defaultState: { values: [0, 0, 0, 0, 0, 0] }, evaluate: (c) => Object.fromEntries(['t5', 't4', 't3', 't2', 't1', 't0'].map((name, index) => [name, trit(c.state.values?.[index])])) });
  registry.register({ type: 'input-button3', label: 'Interactive input button', inputs: [], outputs: ['out'], defaultState: { releasedValue: 0, pressedValue: 1, mode: 'momentary', pulseMs: 120, pressed: false }, evaluate: (c) => ({ out: trit(c.state.pressed ? c.state.pressedValue : c.state.releasedValue) }) });
  registry.register({ type: 'input-joystick3', label: 'Interactive ternary joystick', inputs: [], outputs: ['x', 'y'], defaultState: { x: 0, y: 0 }, evaluate: (c) => ({ x: trit(c.state.x), y: trit(c.state.y) }) });
  registry.register({ type: 'input-joystick6', label: 'Interactive analog 6-trit joystick', inputs: [], outputs: ['x5', 'x4', 'x3', 'x2', 'x1', 'x0', 'y5', 'y4', 'y3', 'y2', 'y1', 'y0'], defaultState: { x: 0, y: 0 }, evaluate: (c) => {
    const axis = (value) => {
      if (isFloating(value)) return Array(6).fill(FLOATING);
      if (isUnknown(value)) return Array(6).fill(UNKNOWN);
      const number = Number(value);
      if (!Number.isFinite(number)) return Array(6).fill(UNKNOWN);
      return balancedWordDigits(Math.max(-364, Math.min(364, Math.round(number))), 6);
    };
    const x = axis(c.state.x), y = axis(c.state.y);
    return Object.fromEntries([...x.map((value, index) => [`x${5 - index}`, value]), ...y.map((value, index) => [`y${5 - index}`, value])]);
  } });
  registry.register({ type: 'clock', label: 'Clock', inputs: [], outputs: ['out'], defaultState: { value: 0 }, evaluate: (c) => ({ out: trit(c.state.value) }) });
  registry.register({
    type: 'sequence-generator',
    label: 'Sequence generator',
    inputs: [],
    outputs: ['out'],
    defaultState: {
      value: 0,
      sequence: [0, 1],
      mode: 'pingpong',
      index: 0,
      direction: 1,
      intervalMs: 500,
      auto: false,
    },
    evaluate: (c) => ({ out: trit(c.state.value) }),
  });
  // Stateful primitives own their state per circuit component instance. They do not
  // feed their output back through combinational wires, so the graph remains acyclic.
  registry.register({
    type: 'latch3', label: 'Ternary latch', category: 'storage', breaksCombinationalPath: true,
    inputs: ['d', 'enable', 'reset'], outputs: ['q'], defaultState: { value: UNKNOWN, initialValue: 0 },
    evaluate(c, { circuit }) {
      const reset = trit(c.inputs.reset), enable = trit(c.inputs.enable);
      if (reset === 1) circuit.stageStateCommit(c.id, { value: trit(c.state.initialValue) });
      else if (enable === 1 && isKnownTrit(c.inputs.d)) circuit.stageStateCommit(c.id, { value: trit(c.inputs.d) });
      return { q: reset === 1 ? trit(c.state.initialValue) : enable === 1 && isKnownTrit(c.inputs.d) ? trit(c.inputs.d) : trit(c.state.value) };
    },
  });
  registry.register({
    type: 'register3', label: 'Ternary register', category: 'storage', breaksCombinationalPath: true,
    inputs: ['d', 'load', 'clock', 'reset'], outputs: ['q'], defaultState: { value: UNKNOWN, initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const clock = trit(c.inputs.clock), load = trit(c.inputs.load), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) !== 1 && clock === 1;
        const patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.value = trit(c.state.initialValue);
        else if (risingEdge && load === 1 && isKnownTrit(c.inputs.d)) patch.value = trit(c.inputs.d);
        circuit.stageStateCommit(c.id, patch);
      }
      return { q: trit(c.state.value) };
    },
  });
  registry.register({
    type: 'register-bank3', label: 'Ternary register bank', category: 'storage', breaksCombinationalPath: true,
    inputs: ['d', 'address', 'action', 'clock', 'reset'], outputs: ['out'],
    defaultState: { values: [UNKNOWN, UNKNOWN, UNKNOWN], initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const address = trit(c.inputs.address), action = trit(c.inputs.action), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) !== 1 && clock === 1;
        const patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.values = [trit(c.state.initialValue), trit(c.state.initialValue), trit(c.state.initialValue)];
        else if (risingEdge && action === 1 && isKnownTrit(address) && isKnownTrit(c.inputs.d)) {
          const values = [...(Array.isArray(staged.values) ? staged.values : [UNKNOWN, UNKNOWN, UNKNOWN])].map(trit);
          values[address < 0 ? 0 : address > 0 ? 2 : 1] = trit(c.inputs.d); patch.values = values;
        }
        circuit.stageStateCommit(c.id, patch);
      }
      if (action !== -1 || !isKnownTrit(address)) return { out: UNKNOWN };
      const values = Array.isArray(c.state.values) ? c.state.values : [UNKNOWN, UNKNOWN, UNKNOWN];
      return { out: trit(values[address < 0 ? 0 : address > 0 ? 2 : 1]) };
    },
  });
  const wordLanes = ['5', '4', '3', '2', '1', '0'];
  registry.register({
    type: 'register-bank3x6', label: '6-trit ternary register bank', category: 'storage', breaksCombinationalPath: true,
    inputs: [...wordLanes.map((lane) => `dataIn${lane}`), 'address', 'action', 'clock', 'reset'], outputs: wordLanes.map((lane) => `dataOut${lane}`),
    defaultState: { values: Array.from({ length: 3 }, () => Array(6).fill(UNKNOWN)), initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const address = trit(c.inputs.address), action = trit(c.inputs.action), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) === 0 && clock === 1;
        const patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.values = Array.from({ length: 3 }, () => Array(6).fill(trit(c.state.initialValue)));
        else if (risingEdge && reset === 0 && action === 1 && isKnownTrit(address) && wordLanes.every((lane) => isKnownTrit(c.inputs[`dataIn${lane}`]))) {
          const values = (Array.isArray(staged.values) ? staged.values : []).map((word) => Array.isArray(word) ? word.map(trit) : Array(6).fill(UNKNOWN));
          while (values.length < 3) values.push(Array(6).fill(UNKNOWN));
          values[address < 0 ? 0 : address > 0 ? 2 : 1] = wordLanes.map((lane) => trit(c.inputs[`dataIn${lane}`]));
          patch.values = values;
        }
        circuit.stageStateCommit(c.id, patch);
      }
      if (action !== -1 || !isKnownTrit(address)) return Object.fromEntries(wordLanes.map((lane) => [`dataOut${lane}`, UNKNOWN]));
      const word = (c.state.values || [])[address < 0 ? 0 : address > 0 ? 2 : 1] || Array(6).fill(UNKNOWN);
      return Object.fromEntries(wordLanes.map((lane, index) => [`dataOut${lane}`, trit(word[index])]));
    },
  });
  registry.register({
    type: 'program-counter6', label: '6-trit program counter', category: 'storage', breaksCombinationalPath: true,
    inputs: ['control', ...wordLanes.map((lane) => `loadData${lane}`), 'load', 'clock', 'reset'], outputs: [...wordLanes.map((lane) => `pc${lane}`), 'extension'],
    defaultState: { values: Array(6).fill(UNKNOWN), initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const control = trit(c.inputs.control), load = trit(c.inputs.load), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      const current = Array.isArray(c.state.values) ? c.state.values.map(trit) : Array(6).fill(UNKNOWN);
      const currentValue = balancedWordValue(current);
      let extension = UNKNOWN, next = null;
      if (currentValue !== null && isKnownTrit(control)) {
        const raw = currentValue + control;
        extension = raw < -364 ? -1 : raw > 364 ? 1 : 0;
        next = balancedWordDigits(raw - 729 * extension, 6);
      }
      const loadData = wordLanes.map((lane) => trit(c.inputs[`loadData${lane}`]));
      const validLoad = load === 1 && loadData.every(isKnownTrit);
      if (validLoad) extension = 0;
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) === 0 && clock === 1;
        const patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.values = Array(6).fill(trit(c.state.initialValue));
        else if (risingEdge && reset === 0 && validLoad) patch.values = loadData;
        else if (risingEdge && reset === 0 && load !== null && load !== 'Z' && next) patch.values = next;
        circuit.stageStateCommit(c.id, patch);
      }
      return { ...Object.fromEntries(wordLanes.map((lane, index) => [`pc${lane}`, current[index]])), extension };
    },
  });
  registry.register({
    type: 'instruction-register6', label: '6-trit instruction register', category: 'storage', breaksCombinationalPath: true,
    inputs: [...wordLanes.map((lane) => `instruction${lane}`), 'load', 'clock', 'reset'], outputs: wordLanes.map((lane) => `instruction${lane}`),
    defaultState: { values: Array(6).fill(UNKNOWN), initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const load = trit(c.inputs.load), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      const incoming = wordLanes.map((lane) => trit(c.inputs[`instruction${lane}`]));
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) === 0 && clock === 1;
        const patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.values = Array(6).fill(trit(c.state.initialValue));
        else if (risingEdge && load === 1 && incoming.every(isKnownTrit)) patch.values = incoming;
        circuit.stageStateCommit(c.id, patch);
      }
      const values = Array.isArray(c.state.values) ? c.state.values.map(trit) : Array(6).fill(UNKNOWN);
      return Object.fromEntries(wordLanes.map((lane, index) => [`instruction${lane}`, values[index]]));
    },
  });
  registry.register({
    type: 'instruction-control6', label: 'Instruction control — 6-trit', category: 'control',
    inputs: [...wordLanes.map((lane) => `instruction${lane}`), 'phase', 'branchZero'], outputs: ['rd', 'ra', 'rb', 'instructionLoad', 'registerWrite', 'writeBackSelect', 'immediate', 'aluOperation', 'memoryAction', 'pcLoad', 'pcControl', 'halt', 'branchIfZero'],
    evaluate(c) {
      const instruction = wordLanes.map((lane) => trit(c.inputs[`instruction${lane}`]));
      const decoded = decodeInstruction6(instruction);
      const phase = trit(c.inputs.phase);
      const controls = cpuSequencerControls(phase === 0 ? CPU_PHASES.FETCH : phase === 1 ? CPU_PHASES.EXECUTE : CPU_PHASES.HALTED, decoded, trit(c.inputs.branchZero) === 1);
      return { rd: decoded.rd ?? UNKNOWN, ra: decoded.ra ?? UNKNOWN, rb: decoded.rb ?? UNKNOWN, instructionLoad: controls.instructionLoad, registerWrite: controls.registerWrite, writeBackSelect: controls.writeBackSelect ?? 0, immediate: controls.immediate ?? 0, aluOperation: controls.aluOperation ?? 0, memoryAction: controls.memoryAction, pcLoad: controls.pcLoad, pcControl: controls.pcControl, halt: controls.halted || decoded.halt || 0, branchIfZero: decoded.branchIfZero || 0 };
    },
  });
  registry.register({
    type: 'cpu-sequencer3', label: 'CPU fetch / execute sequencer', category: 'control', breaksCombinationalPath: true,
    inputs: ['halt', 'clock', 'reset'], outputs: ['phase'], defaultState: { phase: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const halt = trit(c.inputs.halt), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) === 0 && clock === 1, patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.phase = 0;
        else if (risingEdge && trit(staged.phase) === 0) patch.phase = 1;
        else if (risingEdge && trit(staged.phase) === 1) patch.phase = halt === 1 ? -1 : 0;
        circuit.stageStateCommit(c.id, patch);
      }
      return { phase: trit(c.state.phase) };
    },
  });
  registry.register({ type: 'word-zero6', label: '6-trit zero test', category: 'control', inputs: wordLanes.map((lane) => `t${lane}`), outputs: ['zero'], evaluate(c) { const values = wordLanes.map((lane) => trit(c.inputs[`t${lane}`])); return { zero: values.every(isKnownTrit) ? (values.every((value) => value === 0) ? 1 : 0) : UNKNOWN }; } });
  registry.register({ type: 'cpu-address27', label: 'CPU fetch / data address select', category: 'control', inputs: ['pc2', 'pc1', 'pc0', 'ra2', 'ra1', 'ra0', 'phase'], outputs: ['address2', 'address1', 'address0'], evaluate(c) { const phase = trit(c.inputs.phase); const prefix = phase === 1 ? 'ra' : phase === 0 || phase === -1 ? 'pc' : null; return Object.fromEntries(['2', '1', '0'].map((lane) => [`address${lane}`, prefix ? trit(c.inputs[`${prefix}${lane}`]) : UNKNOWN])); } });
  registry.register({ type: 'cpu-memory-port27', label: 'CPU / Memory 27×6 port', category: 'control', inputs: ['pc2', 'pc1', 'pc0', 'ra2', 'ra1', 'ra0', 'phase', 'executeAction', ...wordLanes.map((lane) => `dataIn${lane}`)], outputs: ['address2', 'address1', 'address0', 'action', ...wordLanes.map((lane) => `dataOut${lane}`)], evaluate(c) { const phase = trit(c.inputs.phase), prefix = phase === 1 ? 'ra' : phase === 0 || phase === -1 ? 'pc' : null; const action = phase === 0 ? -1 : phase === 1 ? trit(c.inputs.executeAction) : 0; const data = Object.fromEntries(wordLanes.map((lane) => [`dataOut${lane}`, trit(c.inputs[`dataIn${lane}`])])); return { ...Object.fromEntries(['2', '1', '0'].map((lane) => [`address${lane}`, prefix ? trit(c.inputs[`${prefix}${lane}`]) : UNKNOWN])), action, ...data }; } });
  registry.register({
    type: 'cpu-io-adapter3x3', label: 'CPU I/O adapter — joystick + Pixel Display 3×3', category: 'computer', breaksCombinationalPath: true,
    inputs: [...wordLanes.map((lane) => `address${lane}`), 'phase', 'action', ...wordLanes.map((lane) => `dataIn${lane}`), ...wordLanes.map((lane) => `ramData${lane}`), 'clock', 'reset', 'ioEnable', 'joystickX', 'joystickY'],
    outputs: [...wordLanes.map((lane) => `ramAddress${lane}`), 'ramAction', ...wordLanes.map((lane) => `ramDataIn${lane}`), ...wordLanes.map((lane) => `dataOut${lane}`), 'displayX', 'displayY', 'displayColor', 'displayClearBeforeWrite', 'displayClock', 'displayReset'],
    // A STORE becomes visible after the CPU has committed its fetch state,
    // which can happen while the shared clock is already high.  Gating the
    // display clock directly with `writeDisplay ? clock : 0` therefore makes
    // a false rising edge at that point, followed by the real execute edge.
    // Keep a latched display-clock level instead: only a real 0 → +1 CPU
    // transition may raise it, and the following CPU low phase clears it.
    defaultState: { previousClock: 0, displayClockHigh: 0 },
    evaluate(c, { circuit }) {
      const address = balancedWordValue(wordLanes.map((lane) => trit(c.inputs[`address${lane}`])));
      const phase = trit(c.inputs.phase), action = trit(c.inputs.action), enabled = trit(c.inputs.ioEnable) === 1;
      // FETCH uses the same read action as LOAD.  Map I/O only in execute
      // phase, otherwise instruction address +4 is mistaken for the display
      // register and the second STORE in a small program is never fetched.
      const isIo = enabled && phase === 1 && (address === -4 || address === -3 || address === 4);
      const read = isIo && action === -1;
      const writeDisplay = isIo && address === 4 && action === 1;
      const clock = trit(c.inputs.clock), staged = circuit.getStagedState(c.id);
      let displayClock = trit(c.state.displayClockHigh);
      if (clock === 0 || clock === 1) {
        const previousClock = trit(staged.previousClock);
        const patch = { previousClock: clock };
        if (previousClock === 0 && clock === 1) patch.displayClockHigh = writeDisplay ? 1 : 0;
        else if (clock === 0) patch.displayClockHigh = 0;
        circuit.stageStateCommit(c.id, patch);
      } else {
        displayClock = 0;
      }
      const joystickX = trit(c.inputs.joystickX), joystickY = trit(c.inputs.joystickY);
      const ioData = address === -4 ? [0, 0, 0, joystickX, 0, 0] : address === -3 ? [0, 0, 0, 0, joystickY, 0] : Array(6).fill(UNKNOWN);
      const data = read ? ioData : wordLanes.map((lane) => trit(c.inputs[`ramData${lane}`]));
      const writeWord = wordLanes.map((lane) => trit(c.inputs[`dataIn${lane}`]));
      return {
        ...Object.fromEntries(wordLanes.map((lane) => [`ramAddress${lane}`, trit(c.inputs[`address${lane}`])])),
        ramAction: isIo ? 0 : action,
        ...Object.fromEntries(wordLanes.map((lane, index) => [`ramDataIn${lane}`, writeWord[index]])),
        ...Object.fromEntries(wordLanes.map((lane, index) => [`dataOut${lane}`, data[index]])),
        // Keep clear asserted for the complete emitted display-clock pulse.
        // `writeDisplay` can fall when the CPU advances phase while that pulse
        // is still high; clearing from the pulse preserves the transaction.
        displayX: writeWord[3], displayY: writeWord[4], displayColor: writeWord[5], displayClearBeforeWrite: displayClock,
        displayClock,
        displayReset: trit(c.inputs.reset),
      };
    },
  });
  registry.register({
    type: 'cpu-memory-cycle6', label: 'CPU memory-cycle timing', category: 'control',
    inputs: ['phase', 'executeAction', 'executeRegisterWrite'], outputs: ['action', 'instructionLoad', 'readSample', 'loadWrite', 'storeWrite'],
    evaluate(c) {
      const phase = trit(c.inputs.phase) === 0 ? CPU_PHASES.FETCH : trit(c.inputs.phase) === 1 ? CPU_PHASES.EXECUTE : CPU_PHASES.HALTED;
      const cycle = cpuMemoryCycle(phase, c.inputs.executeAction, c.inputs.executeRegisterWrite);
      return Object.fromEntries(['action', 'instructionLoad', 'readSample', 'loadWrite', 'storeWrite'].map((name) => [name, cycle[name]]));
    },
  });
  registry.register({
    type: 'cpu-control-flow6', label: 'CPU branch / PC control', category: 'control',
    inputs: ['phase', 'pcControlRequest', 'pcLoadRequest', 'branchIfZero', 'compareEqual', ...wordLanes.map((lane) => `ra${lane}`), ...wordLanes.map((lane) => `rb${lane}`)], outputs: ['pcControl', 'pcLoad', 'branchTaken', ...wordLanes.map((lane) => `target${lane}`)],
    evaluate(c) {
      const phase = trit(c.inputs.phase) === 0 ? CPU_PHASES.FETCH : trit(c.inputs.phase) === 1 ? CPU_PHASES.EXECUTE : CPU_PHASES.HALTED;
      const flow = cpuControlFlow6(phase, { pcControl: c.inputs.pcControlRequest, pcLoad: c.inputs.pcLoadRequest, branchIfZero: c.inputs.branchIfZero }, trit(c.inputs.compareEqual), wordLanes.map((lane) => trit(c.inputs[`ra${lane}`])), wordLanes.map((lane) => trit(c.inputs[`rb${lane}`])));
      return { pcControl: flow.pcControl, pcLoad: flow.pcLoad, branchTaken: flow.branchTaken, ...Object.fromEntries(wordLanes.map((lane, index) => [`target${lane}`, flow.target[index]])) };
    },
  });
  registry.register({
    type: 'register-file3x6', label: '6-trit dual-read register file', category: 'storage', breaksCombinationalPath: true,
    inputs: [...wordLanes.map((lane) => `dataIn${lane}`), 'readAAddress', 'readBAddress', 'writeAddress', 'writeAction', 'clock', 'reset'], outputs: [...wordLanes.map((lane) => `readA${lane}`), ...wordLanes.map((lane) => `readB${lane}`)],
    defaultState: { values: Array.from({ length: 3 }, () => Array(6).fill(UNKNOWN)), initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const readAAddress = trit(c.inputs.readAAddress), readBAddress = trit(c.inputs.readBAddress), writeAddress = trit(c.inputs.writeAddress), writeAction = trit(c.inputs.writeAction), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) === 0 && clock === 1;
        const patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.values = Array.from({ length: 3 }, () => Array(6).fill(trit(c.state.initialValue)));
        else if (risingEdge && reset === 0 && writeAction === 1 && isKnownTrit(writeAddress) && wordLanes.every((lane) => isKnownTrit(c.inputs[`dataIn${lane}`]))) {
          const values = (Array.isArray(staged.values) ? staged.values : []).map((word) => Array.isArray(word) ? word.map(trit) : Array(6).fill(UNKNOWN));
          while (values.length < 3) values.push(Array(6).fill(UNKNOWN));
          values[writeAddress < 0 ? 0 : writeAddress > 0 ? 2 : 1] = wordLanes.map((lane) => trit(c.inputs[`dataIn${lane}`]));
          patch.values = values;
        }
        circuit.stageStateCommit(c.id, patch);
      }
      const values = Array.isArray(c.state.values) ? c.state.values : [];
      const read = (address) => isKnownTrit(address) ? (values[address < 0 ? 0 : address > 0 ? 2 : 1] || Array(6).fill(UNKNOWN)) : Array(6).fill(UNKNOWN);
      const a = read(readAAddress), b = read(readBAddress);
      return { ...Object.fromEntries(wordLanes.map((lane, index) => [`readA${lane}`, trit(a[index])])), ...Object.fromEntries(wordLanes.map((lane, index) => [`readB${lane}`, trit(b[index])])) };
    },
  });
  registry.register({
    type: 'cpu6', label: 'Opening ternary CPU — 6-trit', category: 'computer', breaksCombinationalPath: true,
    inputs: [...wordLanes.map((lane) => `memoryData${lane}`), 'clock', 'reset'],
    outputs: [...wordLanes.map((lane) => `address${lane}`), 'memoryAction', ...wordLanes.map((lane) => `memoryWrite${lane}`), ...wordLanes.map((lane) => `pc${lane}`), ...wordLanes.flatMap((lane) => [`rNeg${lane}`, `rZero${lane}`, `rPos${lane}`]), ...wordLanes.map((lane) => `instruction${lane}`), 'phase', 'halted'],
    defaultState: { pc: Array(6).fill(UNKNOWN), registers: Array.from({ length: 3 }, () => Array(6).fill(UNKNOWN)), instruction: Array(6).fill(UNKNOWN), phase: 0, previousClock: 0, literalPending: false, literalDestination: 0 },
    evaluate(c, { circuit }) {
      const state = circuit.getStagedState(c.id);
      const pc = Array.isArray(c.state.pc) ? c.state.pc.map(trit) : Array(6).fill(UNKNOWN);
      const registers = Array.isArray(c.state.registers) ? c.state.registers.map((word) => Array.isArray(word) ? word.map(trit) : Array(6).fill(UNKNOWN)) : Array.from({ length: 3 }, () => Array(6).fill(UNKNOWN));
      const instruction = Array.isArray(c.state.instruction) ? c.state.instruction.map(trit) : Array(6).fill(UNKNOWN);
      const phase = trit(c.state.phase);
      const literalPending = state.literalPending === true, literalDestination = trit(state.literalDestination);
      const decoded = decodeInstruction6(instruction);
      const index = (address) => address < 0 ? 0 : address > 0 ? 2 : 1;
      const read = (address) => isKnownTrit(address) ? (registers[index(address)] || Array(6).fill(UNKNOWN)) : Array(6).fill(UNKNOWN);
      const ra = read(decoded.ra), rb = read(decoded.rb);
      // The second LITW tryte is literal data. It must never be decoded as a
      // LOAD/STORE/JUMP instruction while its value is being consumed.
      const memoryAction = phase === 0 ? -1 : phase === 1 ? (literalPending ? 0 : trit(decoded.memoryAction)) : 0;
      const addressWord = phase === 0 ? pc : phase === 1 ? ra : Array(6).fill(UNKNOWN);
      const memoryData = wordLanes.map((lane) => trit(c.inputs[`memoryData${lane}`]));
      const clock = trit(c.inputs.clock), reset = trit(c.inputs.reset);
      const increment = (word) => {
        const value = balancedWordValue(word);
        if (value === null) return null;
        return balancedWordDigits(((value + 1 + 364) % 729 + 729) % 729 - 364, 6);
      };
      const arithmetic = (left, right, operation) => {
        const a = balancedWordValue(left), b = balancedWordValue(right);
        if (a === null || b === null) return null;
        const raw = operation === -1 ? a - b : operation === 1 ? a + b : a;
        return balancedWordDigits(((raw + 364) % 729 + 729) % 729 - 364, 6);
      };
      if (isKnownTrit(clock)) {
        const rising = trit(state.previousClock) === 0 && clock === 1;
        const patch = { previousClock: clock };
        if (rising && reset === 1) {
          patch.pc = Array(6).fill(0); patch.registers = Array.from({ length: 3 }, () => Array(6).fill(0)); patch.instruction = Array(6).fill(0); patch.phase = 0; patch.literalPending = false; patch.literalDestination = 0;
        } else if (rising && reset === 0 && phase === 0) {
          if (memoryData.every(isKnownTrit)) patch.instruction = memoryData;
          patch.phase = 1;
        } else if (rising && reset === 0 && phase === 1 && literalPending) {
          if (instruction.every(isKnownTrit) && isKnownTrit(literalDestination)) {
            const nextRegisters = registers.map((word) => [...word]);
            nextRegisters[index(literalDestination)] = [...instruction];
            patch.registers = nextRegisters;
          }
          const nextPc = increment(pc);
          if (nextPc?.every(isKnownTrit)) patch.pc = nextPc;
          patch.literalPending = false; patch.phase = 0;
        } else if (rising && reset === 0 && phase === 1) {
          const nextRegisters = registers.map((word) => [...word]);
          let write = null;
          if (decoded.mnemonic === 'MOV') write = ra;
          else if (decoded.mnemonic === 'ADD' || decoded.mnemonic === 'SUB') write = arithmetic(ra, rb, decoded.aluOperation);
          else if (decoded.mnemonic === 'LOAD' && memoryData.every(isKnownTrit)) write = memoryData;
          else if (decoded.mnemonic === 'LIT') write = [0, 0, 0, 0, trit(decoded.ra), trit(decoded.rb)];
          if (decoded.registerWrite === 1 && write?.every(isKnownTrit) && isKnownTrit(decoded.rd)) { nextRegisters[index(decoded.rd)] = write; patch.registers = nextRegisters; }
          if (decoded.mnemonic === 'LITW' && decoded.ra === 0 && decoded.rb === 0) {
            const nextPc = increment(pc);
            if (nextPc?.every(isKnownTrit)) patch.pc = nextPc;
            patch.literalPending = true; patch.literalDestination = decoded.rd; patch.phase = 0;
          } else if (decoded.halt === 1) patch.phase = -1;
          else {
            const zero = ra.every((value) => value === 0);
            const target = decoded.mnemonic === 'JUMP' ? ra : decoded.mnemonic === 'BRZ' && zero ? rb : null;
            const nextPc = target || increment(pc);
            if (nextPc?.every(isKnownTrit)) patch.pc = nextPc;
            patch.phase = 0;
          }
        }
        circuit.stageStateCommit(c.id, patch);
      }
      const registerOutputs = { ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`rNeg${lane}`, trit(registers[0][laneIndex])])), ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`rZero${lane}`, trit(registers[1][laneIndex])])), ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`rPos${lane}`, trit(registers[2][laneIndex])])) };
      return { ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`address${lane}`, addressWord[laneIndex]])), memoryAction, ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`memoryWrite${lane}`, trit(rb[laneIndex])])), ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`pc${lane}`, pc[laneIndex]])), ...registerOutputs, ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`instruction${lane}`, instruction[laneIndex]])), phase, halted: phase === -1 ? 1 : 0 };
    },
  });
  registry.register({
    type: 'cpu-program-loader6', label: 'CPU example-program loader', category: 'computer', breaksCombinationalPath: true,
    inputs: ['clock'], outputs: [...wordLanes.map((lane) => `address${lane}`), 'action', ...wordLanes.map((lane) => `data${lane}`), 'done', 'cpuReset'],
    defaultState: { index: 0, previousClock: 0, active: false, programName: '18C arithmetic and memory', programDescription: '', programSource: '', program: [{ address: 0, word: [...CPU_OPCODES.LIT, -1, -1, -1] }, { address: 1, word: [...CPU_OPCODES.LIT, 0, 0, 1] }, { address: 2, word: [...CPU_OPCODES.ADD, 1, 0, 0] }, { address: 3, word: [...CPU_OPCODES.STORE, 0, -1, 1] }, { address: 4, word: [...CPU_OPCODES.LOAD, 0, -1, 0] }, { address: 5, word: [...CPU_OPCODES.HALT, 0, 0, 0] }] },
    evaluate(c, { circuit }) {
      const program = (Array.isArray(c.state.program) ? c.state.program : []).filter((entry) => Number.isInteger(Number(entry?.address)) && Number(entry.address) >= -364 && Number(entry.address) <= 364 && Array.isArray(entry.word) && entry.word.length === 6 && entry.word.every(isKnownTrit));
      const index = Math.max(0, Number(c.state.index) || 0), active = c.state.active === true && index < program.length;
      const clock = trit(c.inputs.clock), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) { const rising = trit(staged.previousClock) === 0 && clock === 1; const patch = { previousClock: clock }; if (rising && active) { patch.index = index + 1; if (index + 1 >= program.length) patch.active = false; } circuit.stageStateCommit(c.id, patch); }
      const entry = active ? program[index] : null, address = entry ? balancedWordDigits(Number(entry.address), 6) : Array(6).fill(UNKNOWN), data = entry ? entry.word.map(trit) : Array(6).fill(UNKNOWN);
      return { ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`address${lane}`, address[laneIndex]])), action: active ? 1 : 0, ...Object.fromEntries(wordLanes.map((lane, laneIndex) => [`data${lane}`, data[laneIndex]])), done: active ? 0 : 1, cpuReset: active ? 1 : 0 };
    },
  });
  registry.register({
    type: 'memory3x1', label: 'Memory 3×1', category: 'storage', breaksCombinationalPath: true,
    inputs: ['dataIn', 'address', 'action', 'clock', 'reset'], outputs: ['dataOut'],
    defaultState: { values: [UNKNOWN, UNKNOWN, UNKNOWN], initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const address = trit(c.inputs.address), action = trit(c.inputs.action), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) {
        const risingEdge = trit(staged.previousClock) === 0 && clock === 1;
        const patch = { previousClock: clock };
        if (risingEdge && reset === 1) patch.values = [trit(c.state.initialValue), trit(c.state.initialValue), trit(c.state.initialValue)];
        else if (risingEdge && reset === 0 && action === 1 && isKnownTrit(address) && isKnownTrit(c.inputs.dataIn)) {
          const values = [...(Array.isArray(staged.values) ? staged.values : [UNKNOWN, UNKNOWN, UNKNOWN])].map(trit);
          values[address < 0 ? 0 : address > 0 ? 2 : 1] = trit(c.inputs.dataIn); patch.values = values;
        }
        circuit.stageStateCommit(c.id, patch);
      }
      if (action !== -1 || !isKnownTrit(address)) return { dataOut: UNKNOWN };
      const values = Array.isArray(c.state.values) ? c.state.values : [UNKNOWN, UNKNOWN, UNKNOWN];
      return { dataOut: trit(values[address < 0 ? 0 : address > 0 ? 2 : 1]) };
    },
  });
  registry.register({
    type: 'memory3x6', label: 'Memory 3×6', category: 'storage', breaksCombinationalPath: true,
    inputs: [...wordLanes.map((lane) => `dataIn${lane}`), 'address', 'action', 'clock', 'reset'], outputs: wordLanes.map((lane) => `dataOut${lane}`),
    defaultState: { values: Array.from({ length: 3 }, () => Array(6).fill(UNKNOWN)), initialValue: 0, previousClock: 0 },
    evaluate(c, { circuit }) {
      const address = trit(c.inputs.address), action = trit(c.inputs.action), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
      if (isKnownTrit(clock)) {
        const rising = trit(staged.previousClock) === 0 && clock === 1, patch = { previousClock: clock };
        if (rising && reset === 1) patch.values = Array.from({ length: 3 }, () => Array(6).fill(trit(c.state.initialValue)));
        else if (rising && reset === 0 && action === 1 && isKnownTrit(address) && wordLanes.every((lane) => isKnownTrit(c.inputs[`dataIn${lane}`]))) {
          const values = (Array.isArray(staged.values) ? staged.values : []).map((word) => Array.isArray(word) ? word.map(trit) : Array(6).fill(UNKNOWN));
          while (values.length < 3) values.push(Array(6).fill(UNKNOWN));
          values[address < 0 ? 0 : address > 0 ? 2 : 1] = wordLanes.map((lane) => trit(c.inputs[`dataIn${lane}`])); patch.values = values;
        }
        circuit.stageStateCommit(c.id, patch);
      }
      if (action !== -1 || !isKnownTrit(address)) return Object.fromEntries(wordLanes.map((lane) => [`dataOut${lane}`, UNKNOWN]));
      const values = Array.isArray(c.state.values) ? c.state.values : [];
      const word = values[address < 0 ? 0 : address > 0 ? 2 : 1] || Array(6).fill(UNKNOWN);
      return Object.fromEntries(wordLanes.map((lane, index) => [`dataOut${lane}`, trit(word[index])]));
    },
  });
  const registerScaledWordMemory = (type, label, locations, addressWidth, structuralImplementation) => {
    const addressPorts = Array.from({ length: addressWidth }, (_, index) => `address${addressWidth - 1 - index}`);
    const offset = (locations - 1) / 2;
    registry.register({ type, label, category: 'storage', breaksCombinationalPath: true,
      inputs: [...wordLanes.map((lane) => `dataIn${lane}`), ...addressPorts, 'action', 'clock', 'reset'], outputs: wordLanes.map((lane) => `dataOut${lane}`),
      defaultState: { values: Array.from({ length: locations }, () => Array(6).fill(UNKNOWN)), initialValue: 0, previousClock: 0 },
      evaluate(c, { circuit }) {
        const address = balancedWordValue(addressPorts.map((name) => trit(c.inputs[name]))), action = trit(c.inputs.action), clock = trit(c.inputs.clock), reset = trit(c.inputs.reset), staged = circuit.getStagedState(c.id);
        const validAddress = address !== null && address >= -offset && address <= offset;
        if (isKnownTrit(clock)) { const rising = trit(staged.previousClock) === 0 && clock === 1, patch = { previousClock: clock };
          if (rising && reset === 1) patch.values = Array.from({ length: locations }, () => Array(6).fill(trit(c.state.initialValue)));
          else if (rising && reset === 0 && action === 1 && validAddress && wordLanes.every((lane) => isKnownTrit(c.inputs[`dataIn${lane}`]))) { const values = (staged.values || []).map((word) => Array.isArray(word) ? word.map(trit) : Array(6).fill(UNKNOWN)); while (values.length < locations) values.push(Array(6).fill(UNKNOWN)); values[address + offset] = wordLanes.map((lane) => trit(c.inputs[`dataIn${lane}`])); patch.values = values; }
          circuit.stageStateCommit(c.id, patch); }
        if (action !== -1 || !validAddress) return Object.fromEntries(wordLanes.map((lane) => [`dataOut${lane}`, UNKNOWN]));
        const word = (c.state.values || [])[address + offset] || Array(6).fill(UNKNOWN); return Object.fromEntries(wordLanes.map((lane, index) => [`dataOut${lane}`, trit(word[index])]));
      },
    });
    registry.get(type).implementation = { mode: 'accelerated-equivalent', status: 'structural reference available', summary: `${label} accelerates a named hierarchy of proven Memory 3×6 blocks.`, layers: [`${locations} tryte locations`, `${addressWidth}-trit balanced address hierarchy`, 'Atomic six-trit word boundary'], structuralImplementation };
  };
  // These are execution accelerators only. Each has a recursively composed
  // Memory 3×6 hierarchy with the same public address/action/clock contract.
  registerScaledWordMemory('memory9x6', 'Memory 9×6', 9, 2, 'structural-memory9x6-v1');
  registerScaledWordMemory('memory27x6', 'Memory 27×6', 27, 3, 'structural-memory27x6-v1');
  registerScaledWordMemory('memory81x6', 'Memory 81×6', 81, 4, 'structural-memory81x6-v1');
  registerScaledWordMemory('memory243x6', 'Memory 243×6', 243, 5, 'structural-memory243x6-v1');
  registerScaledWordMemory('memory729x6', 'Memory 729×6', 729, 6, 'structural-memory729x6-v1');

  const experimentalCost = () => ({ logical: { nodes: 1, depth: 1 } });

  // Technology-neutral device/cell layer. These are idealized electrical cells,
  // deliberately separate from any CMOS, CNTFET, current-mode or memristive mapping.
  const idealDeviceCost = () => ({ logical: { nodes: 1, depth: 1 } });
  registry.register({ type: 'restore3', label: 'Ternary restorer', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: ['in'], outputs: ['out'], evaluate(c) { return { out: isKnownTrit(c.inputs.in) ? trit(c.inputs.in) : UNKNOWN }; } });
  registry.register({ type: 'threshold3', label: 'Ternary level detector', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: ['in'], outputs: ['neg', 'zero', 'pos'], evaluate(c) { const value = trit(c.inputs.in); if (!isKnownTrit(value)) return { neg: UNKNOWN, zero: UNKNOWN, pos: UNKNOWN }; return { neg: value < 0 ? 1 : 0, zero: value === 0 ? 1 : 0, pos: value > 0 ? 1 : 0 }; } });
  registry.register({ type: 'pass3', label: 'Ternary pass switch', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: ['in', 'gate'], outputs: ['out'], evaluate(c) { const gate = trit(c.inputs.gate); if (!isKnownTrit(gate)) return { out: UNKNOWN }; return { out: gate === 1 ? trit(c.inputs.in) : FLOATING }; } });
  registry.register({ type: 'ternary-reference', label: 'Ternary reference rail', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: [], outputs: ['out'], defaultState: { value: 0 }, evaluate: (c) => ({ out: trit(c.state.value) }) });
  // Merge3 is a strict resolved bus cell. It represents a physical join only for mutually exclusive pass paths: exactly one non-Z driver is allowed.
  registry.register({ type: 'merge3', label: 'Ternary resolved merge', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: ['a', 'b', 'c'], outputs: ['out'], evaluate(c) { const driven = ['a', 'b', 'c'].map((port) => trit(c.inputs[port])).filter((value) => !isFloating(value)); if (!driven.length) return { out: FLOATING }; if (driven.length !== 1) return { out: UNKNOWN }; return { out: isKnownTrit(driven[0]) ? driven[0] : UNKNOWN }; } });
  registry.register({ type: 'storage-node3', label: 'Ternary storage node', category: 'device', candidate: true, breaksCombinationalPath: true, cost: idealDeviceCost(), inputs: ['drive', 'write', 'reset'], outputs: ['q'], defaultState: { value: UNKNOWN, initialValue: 0 }, evaluate(c, { circuit }) { const reset = trit(c.inputs.reset), write = trit(c.inputs.write); if (reset === 1) circuit.stageStateCommit(c.id, { value: trit(c.state.initialValue) }); else if (write === 1 && isKnownTrit(c.inputs.drive)) circuit.stageStateCommit(c.id, { value: trit(c.inputs.drive) }); return { q: trit(c.state.value) }; } });
  registry.register({ type: 'clock-phase3', label: 'Clock phase inverter', category: 'control', candidate: true, cost: idealDeviceCost(), inputs: ['clock'], outputs: ['out'], evaluate(c) { const clock = trit(c.inputs.clock); return { out: clock === 0 ? 1 : clock === 1 ? 0 : UNKNOWN }; } });

  registry.register({ type: 'negate', label: 'Negate', category: 'logic', candidate: true, cost: experimentalCost('Balanced ternary inversion candidate.'), inputs: ['in'], outputs: ['out'], evaluate: (c) => ({ out: needsKnownInputs(c, ['in']) ? -trit(c.inputs.in) : UNKNOWN }) });
  registry.register({ type: 'compare', label: 'Compare', category: 'logic', candidate: true, cost: experimentalCost('Returns -1, 0 or +1 for less/equal/greater.'), inputs: ['a', 'b'], outputs: ['out'], evaluate(c) { if (!needsKnownInputs(c, ['a', 'b'])) return { out: UNKNOWN }; const a = trit(c.inputs.a), b = trit(c.inputs.b); return { out: a < b ? -1 : a > b ? 1 : 0 }; } });
  registry.register({ type: 'select3', label: 'Select3', category: 'routing', candidate: true, cost: experimentalCost('Native three-way selector candidate.'), inputs: ['neg', 'zero', 'pos', 'select'], outputs: ['out'], evaluate(c) { const s = trit(c.inputs.select); if (!isKnownTrit(s)) return { out: UNKNOWN }; return { out: trit(c.inputs[s < 0 ? 'neg' : s > 0 ? 'pos' : 'zero']) }; } });
  registry.register({ type: 'route3', label: 'Route3', category: 'routing', candidate: true, cost: experimentalCost('Native one-to-three ternary router candidate; inactive paths are zero.'), inputs: ['in', 'select'], outputs: ['neg', 'zero', 'pos'], evaluate(c) { const s = trit(c.inputs.select); if (!isKnownTrit(s)) return { neg: UNKNOWN, zero: UNKNOWN, pos: UNKNOWN }; const out = { neg: 0, zero: 0, pos: 0 }; out[s < 0 ? 'neg' : s > 0 ? 'pos' : 'zero'] = trit(c.inputs.in); return out; } });
  registry.register({ type: 'adjust3', label: 'Adjust3', category: 'control', candidate: true, cost: experimentalCost('Applies -1 / 0 / +1 as decrement / hold / increment and reports ternary carry.'), inputs: ['value', 'control'], outputs: ['next', 'carry'], evaluate(c) { if (!needsKnownInputs(c, ['value', 'control'])) return { next: UNKNOWN, carry: UNKNOWN }; const raw = trit(c.inputs.value) + trit(c.inputs.control); const carry = raw < -1 ? -1 : raw > 1 ? 1 : 0; return { next: trit(raw - (3 * carry)), carry }; } });
  registry.register({ type: 'control3', label: 'Control3 decode', category: 'control', candidate: true, cost: experimentalCost('Decodes one packed ternary action signal into three physical paths.'), inputs: ['control'], outputs: ['neg', 'zero', 'pos'], evaluate(c) { const s = trit(c.inputs.control); if (!isKnownTrit(s)) return { neg: UNKNOWN, zero: UNKNOWN, pos: UNKNOWN }; return { neg: s < 0 ? 1 : 0, zero: s === 0 ? 1 : 0, pos: s > 0 ? 1 : 0 }; } });
  registry.register({ type: 'min', label: 'MIN', category: 'logic', candidate: true, cost: experimentalCost('MIN(A,B) ternary logic candidate.'), inputs: ['a', 'b'], outputs: ['out'], evaluate(c) { return { out: needsKnownInputs(c, ['a', 'b']) ? Math.min(trit(c.inputs.a), trit(c.inputs.b)) : UNKNOWN }; } });
  registry.register({ type: 'max', label: 'MAX', category: 'logic', candidate: true, cost: experimentalCost('MAX(A,B) ternary logic candidate.'), inputs: ['a', 'b'], outputs: ['out'], evaluate(c) { return { out: needsKnownInputs(c, ['a', 'b']) ? Math.max(trit(c.inputs.a), trit(c.inputs.b)) : UNKNOWN }; } });
  registry.register({
    type: 'normalize-carry', label: 'Normalize / carry', category: 'arithmetic', candidate: true,
    cost: experimentalCost('Normalizes A+B+C into Sum + 3×Carry.'),
    inputs: ['a', 'b', 'c'], outputs: ['sum', 'carry'],
    evaluate(c) {
      if (!needsKnownInputs(c, ['a', 'b', 'c'])) return { sum: UNKNOWN, carry: UNKNOWN };
      const raw = trit(c.inputs.a) + trit(c.inputs.b) + trit(c.inputs.c);
      const carry = raw <= -2 ? -1 : raw >= 2 ? 1 : 0;
      return { sum: trit(raw - (3 * carry)), carry };
    },
  });
  registry.register({ type: 'seven-segment-display', label: '7-segment display', category: 'output', inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'sign'], outputs: [], cost: { logical: { nodes: 0, depth: 0 } }, evaluate() { return {}; } });
  registry.register({ type: 'trit-led', label: 'Trit LED', category: 'output', inputs: ['in'], outputs: [], defaultState: { value: UNKNOWN }, cost: { logical: { nodes: 0, depth: 0 } }, evaluate(c) { c.state.value = trit(c.inputs.in); return {}; } });
  registry.register({ type: 'binary-led', label: 'Binary LED', category: 'output', inputs: ['in'], outputs: [], defaultState: { value: UNKNOWN, lit: false }, cost: { logical: { nodes: 0, depth: 0 } }, evaluate(c) { const value = trit(c.inputs.in); c.state.value = value; c.state.lit = isKnownTrit(value) && value !== 0; return {}; } });
  registry.register({ type: 'word-display6', label: '6-trit word display', category: 'output', inputs: ['t5', 't4', 't3', 't2', 't1', 't0'], outputs: [], defaultState: { values: [UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN] }, cost: { logical: { nodes: 0, depth: 0 } }, evaluate(c) { c.state.values = ['t5', 't4', 't3', 't2', 't1', 't0'].map((name) => trit(c.inputs[name])); return {}; } });
  registry.register({
    type: 'pixel-display3', label: 'Pixel Display 3×3', category: 'output', breaksCombinationalPath: true,
    inputs: ['x', 'y', 'color', 'clearBeforeWrite', 'clock', 'reset'], outputs: [],
    defaultState: { pixels: Array(9).fill(0), previousClock: 0, invalidIo: null },
    cost: { logical: { nodes: 0, depth: 0 } },
    evaluate(c, { circuit }) {
      const clock = trit(c.inputs.clock), staged = circuit.getStagedState(c.id);
      // State commits happen after propagation settles.  Use the committed
      // level for edge detection, so a later x/y/color wire update during the
      // same clock-high propagation pass can replace an earlier provisional
      // write.  Using `staged.previousClock` consumed the edge too early and
      // made a CPU STORE sample a stale packed display word.
      const previousClock = trit(c.state.previousClock);
      const knownClock = clock === 0 || clock === 1;
      const patch = { previousClock: clock };
      if (!knownClock) {
        patch.invalidIo = `clock=${clock === 'Z' ? 'Z' : clock === null ? '?' : '−1'} is not a valid 0/+1 clock level`;
        circuit.stageStateCommit(c.id, patch);
        return {};
      }
      const risingEdge = previousClock === 0 && clock === 1;
      if (!risingEdge) {
        circuit.stageStateCommit(c.id, patch);
        return {};
      }
      const reset = trit(c.inputs.reset);
      if (reset === 1) {
        patch.pixels = Array(9).fill(0); patch.invalidIo = null;
      } else if (reset !== 0) {
        patch.invalidIo = `reset=${reset === 'Z' ? 'Z' : reset === null ? '?' : '−1'} is not supported`;
      } else {
        const x = trit(c.inputs.x), y = trit(c.inputs.y), color = trit(c.inputs.color);
        if (!isKnownTrit(x) || !isKnownTrit(y) || !isKnownTrit(color)) {
          const display = (value) => value === 'Z' ? 'Z' : value === null ? '?' : value === -1 ? '−1' : String(value);
          patch.invalidIo = `invalid pixel ports: x=${display(x)} y=${display(y)} color=${display(color)}`;
        } else {
          const pixels = trit(c.inputs.clearBeforeWrite) === 1 ? Array(9).fill(0) : (Array.isArray(staged.pixels) ? staged.pixels : Array(9).fill(0)).slice(0, 9).map(trit);
          const column = x + 1, row = 1 - y;
          pixels[row * 3 + column] = color;
          patch.pixels = pixels; patch.invalidIo = null;
        }
      }
      circuit.stageStateCommit(c.id, patch);
      return {};
    },
  });
  const evaluateAddressedRgbDisplay24 = (c, { circuit }) => {
    const clock = trit(c.inputs.clock), staged = circuit.getStagedState(c.id), previousClock = trit(staged.previousClock);
    const patch = { previousClock: clock };
    if (![0, 1].includes(clock)) {
      patch.invalidIo = `clock=${clock === 'Z' ? 'Z' : clock === null ? '?' : '−1'} is not a valid 0/+1 clock level`;
      circuit.stageStateCommit(c.id, patch); return {};
    }
    if (!(previousClock === 0 && clock === 1)) {
      circuit.stageStateCommit(c.id, patch); return {};
    }
    const reset = trit(c.inputs.reset);
    if (reset === 1) {
      patch.pixels = emptyRgbFrame(); patch.cursor = 0; patch.invalidIo = null;
      circuit.stageStateCommit(c.id, patch); return {};
    }
    if (reset !== 0) {
      patch.invalidIo = `reset=${reset === 'Z' ? 'Z' : reset === null ? '?' : '−1'} is not supported`;
      circuit.stageStateCommit(c.id, patch); return {};
    }
    const rgb = rgbInput(c.inputs);
    if ([rgb.r, rgb.g, rgb.b].some((value) => value === null)) {
      patch.invalidIo = 'RGB data contains Z or ?'; circuit.stageStateCommit(c.id, patch); return {};
    }
    const x = balancedWordValue(['x3', 'x2', 'x1', 'x0'].map((name) => trit(c.inputs[name])));
    const y = balancedWordValue(['y3', 'y2', 'y1', 'y0'].map((name) => trit(c.inputs[name])));
    if (x === null || y === null || x < -12 || x > 11 || y < -12 || y > 11) {
      patch.invalidIo = 'address is unsupported';
    }
    else {
      const pixels = (Array.isArray(staged.pixels) ? staged.pixels : emptyRgbFrame()).map((pixel) => Array.isArray(pixel) ? [...pixel] : [0, 0, 0]);
      pixels[(11 - y) * 24 + (x + 12)] = [rgb.r, rgb.g, rgb.b]; patch.pixels = pixels; patch.invalidIo = null;
    }
    circuit.stageStateCommit(c.id, patch); return {};
  };
  registry.register({
    type: 'rgb-display24-addressed', label: 'RGB Display 24×24 — addressed', category: 'output', breaksCombinationalPath: true,
    inputs: ['x3', 'x2', 'x1', 'x0', 'y3', 'y2', 'y1', 'y0', ...RGB_WORD_PORTS, 'clock', 'reset'], outputs: [],
    defaultState: { pixels: emptyRgbFrame(), previousClock: 0, cursor: 0, invalidIo: null }, cost: { logical: { nodes: 0, depth: 0 } },
    evaluate(c, context) { return evaluateAddressedRgbDisplay24(c, context); },
  });
  registry.register({
    type: 'rgb-display24-stream', label: 'RGB Display 24×24 — raster stream', category: 'output', breaksCombinationalPath: true,
    inputs: ['data', 'clock'], outputs: [],
    defaultState: { pixels: emptyRgbFrame(), previousClock: 0, cursor: 0, packet: [], invalidIo: null }, cost: { logical: { nodes: 0, depth: 0 } },
    evaluate(c, { circuit }) {
      const clock = trit(c.inputs.clock), staged = circuit.getStagedState(c.id), previousClock = trit(staged.previousClock);
      const patch = { previousClock: clock };
      if (![0, 1].includes(clock)) {
        patch.invalidIo = `clock=${clock === 'Z' ? 'Z' : clock === null ? '?' : '−1'} is not a valid 0/+1 clock level`;
      } else if (previousClock === 0 && clock === 1) {
        const data = trit(c.inputs.data);
        if (!isKnownTrit(data)) patch.invalidIo = `data=${data === 'Z' ? 'Z' : '?'} cannot be part of an RGB packet`;
        else {
          const packet = [...(Array.isArray(staged.packet) ? staged.packet : []), data];
          if (packet.length < 18) { patch.packet = packet; patch.invalidIo = null; }
          else {
            const rgb = { r: balancedWordValue(packet.slice(0, 6)), g: balancedWordValue(packet.slice(6, 12)), b: balancedWordValue(packet.slice(12, 18)) };
            const cursor = Math.max(0, Math.min(575, Number(staged.cursor) || 0));
            const pixels = (Array.isArray(staged.pixels) ? staged.pixels : emptyRgbFrame()).map((pixel) => Array.isArray(pixel) ? [...pixel] : [0, 0, 0]);
            pixels[cursor] = [rgb.r, rgb.g, rgb.b]; patch.pixels = pixels; patch.cursor = (cursor + 1) % 576; patch.packet = []; patch.invalidIo = null;
          }
        }
      }
      circuit.stageStateCommit(c.id, patch); return {};
    },
  });
  registry.register({ type: 'word-probe6', label: '6-trit word probe', category: 'debug', inputs: ['t5', 't4', 't3', 't2', 't1', 't0'], outputs: [], defaultState: { values: [UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN] }, cost: { logical: { nodes: 0, depth: 0 } }, evaluate(c) { c.state.values = ['t5', 't4', 't3', 't2', 't1', 't0'].map((name) => trit(c.inputs[name])); return {}; } });
  registry.register({ type: 'decimal-debug6', label: '6-trit decimal debug view', category: 'debug', inputs: ['t5', 't4', 't3', 't2', 't1', 't0'], outputs: [], defaultState: { values: [UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN], decimal: null }, cost: { logical: { nodes: 0, depth: 0 } }, evaluate(c) { const values = ['t5', 't4', 't3', 't2', 't1', 't0'].map((name) => trit(c.inputs[name])); c.state.values = values; c.state.decimal = values.every(isKnownTrit) ? values.reduce((total, value) => total * 3 + value, 0) : null; return {}; } });
  registry.register({ type: 'probe', label: 'Probe', inputs: ['in'], outputs: [], defaultState: { value: UNKNOWN }, evaluate(c) { c.state.value = trit(c.inputs.in); return {}; } });
  registry.register({ type: 'component-input', label: 'Component Input', inputs: [], outputs: ['out'], defaultState: { name: 'in', value: 0 }, boundary: 'input', evaluate: (c) => ({ out: trit(c.state.value) }) });
  registry.register({ type: 'component-seven-segment-display', label: '7-segment Output', inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'sign'], outputs: [], boundary: 'display', evaluate() { return {}; } });
  registry.register({ type: 'component-output', label: 'Component Output', inputs: ['in'], outputs: [], defaultState: { name: 'out', value: UNKNOWN }, boundary: 'output', evaluate(c) { c.state.value = trit(c.inputs.in); return {}; } });

  // Every built-in component declares its execution role and the lowest known
  // structural path. This is displayed in the Inspector; it prevents native
  // evaluation from silently becoming a magic architectural primitive.
  const implementationMetadata = {
    'trit-input': { mode: 'external-adapter', status: 'test/debug source boundary', summary: 'A general test source drives one declared ternary level, Z (floating), or ? (unknown) onto the circuit; it is not presented as an end-user control.', layers: ['Test/source state', 'Driven ternary wire'] },
    'word-input6': { mode: 'external-adapter', status: 'test/debug source boundary', summary: 'A general test source independently drives six ordered word lanes t5…t0. Each lane may be a known trit, Z (floating), or ? (unknown).', layers: ['Six test/source states', 'Six driven ternary word wires'] },
    'input-button3': { mode: 'external-adapter', status: 'user I/O button boundary', summary: 'A clickable two-state end-user control drives configured released and pressed ternary levels. It supports momentary, toggle, or declared-duration pulse behavior.', layers: ['User button action', 'Declared two-level ternary output'] },
    'input-joystick3': { mode: 'external-adapter', status: 'user I/O joystick boundary', summary: 'A clickable end-user controller drives independent ternary x and y axes. The 3×3 pad expresses center, cardinals and diagonals.', layers: ['User directional action', 'Two driven ternary axis wires'] },
    'input-joystick6': { mode: 'external-adapter', status: 'user I/O analog joystick boundary', summary: 'A drag-based end-user controller quantizes independent x and y positions to six balanced trits each (-364…+364).', layers: ['User analog position', 'Two six-trit driven word wires'] },
    clock: { mode: 'external-adapter', status: 'boundary', summary: 'A timing source is outside the combinational ternary datapath.', layers: ['External timing source → clock wire'] },
    'sequence-generator': { mode: 'external-adapter', status: 'boundary', summary: 'A simulator/UI source emits a declared sequence; it is not internal logic.', layers: ['External timing/control source → ternary wire'] },
    'ternary-reference': { mode: 'structural', status: 'cell boundary', summary: 'Declared fixed ternary reference rail used when a structural circuit needs a known -1, 0 or +1 level.', layers: ['Ideal ternary reference rail'] },
    restore3: { mode: 'structural', status: 'cell boundary', summary: 'Technology-neutral cell: accepts a driven trit and restores an ideal resolved level.', layers: ['Ideal ternary restorer cell'] },
    threshold3: { mode: 'structural', status: 'cell boundary', summary: 'Technology-neutral cell: detects negative, zero and positive input regions.', layers: ['Ideal ternary level-detector cell'] },
    pass3: { mode: 'structural', status: 'cell boundary', summary: 'Technology-neutral cell: a +1 gate passes the input; other known gates intentionally float the output.', layers: ['Ideal controlled ternary transmission cell'] },
    merge3: { mode: 'structural', status: 'cell boundary', summary: 'Technology-neutral resolved bus cell. It accepts exactly one non-floating driver; no drivers yield Z and every contention or uncertainty yields ?.', layers: ['Three mutually exclusive ternary pass paths', 'Strict resolved-output merge'] },
    'storage-node3': { mode: 'structural', status: 'cell boundary', summary: 'Technology-neutral declared storage boundary. It is the lowest state-holding cell represented by this simulator.', layers: ['Ideal ternary storage cell'] },
    'clock-phase3': { mode: 'structural', status: 'cell boundary', summary: 'Technology-neutral two-state control inverter: 0 becomes +1 and +1 becomes 0; other levels are unresolved.', layers: ['Ideal two-state control inverter cell'] },
    negate: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named pass/merge level-permutation circuit.', layers: ['Ternary level detector', 'reference rails', 'pass paths', 'resolved merge'], structuralImplementation: 'structural-negate-v1' },
    compare: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named structural Select3 decision tree.', layers: ['reference rails', 'four structural Select3 components'], structuralImplementation: 'structural-compare-v1' },
    select3: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named detector/pass/Merge3 circuit.', layers: ['Ternary level detector', 'three pass paths', 'resolved merge'], structuralImplementation: 'structural-select3-v1' },
    route3: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named gated and merged routing circuit.', layers: ['Ternary level detector', 'pass paths', 'reference rail', 'resolved merges'], structuralImplementation: 'structural-route3-v1' },
    adjust3: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named structural Normalize / carry composition.', layers: ['zero reference rail', 'structural Normalize / carry'], structuralImplementation: 'structural-adjust3-v1' },
    control3: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named level-detector circuit.', layers: ['Ternary level detector'], structuralImplementation: 'structural-control3-v1' },
    min: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named structural Select3 tree.', layers: ['reference rails', 'two structural Select3 components'], structuralImplementation: 'structural-min-v1' },
    max: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named structural Select3 tree.', layers: ['reference rails', 'two structural Select3 components'], structuralImplementation: 'structural-max-v1' },
    'normalize-carry': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named exhaustive structural Select3 decision tree.', layers: ['reference rails', 'structural Select3 tree'], structuralImplementation: 'structural-normalize-carry-v1' },
    latch3: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named structural latch.', layers: ['Ternary restorer', 'Ternary pass switch', 'Ternary storage node'], structuralImplementation: 'structural-latch-v1' },
    register3: { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native execution accelerates the named two-latch register.', layers: ['Clock phase inverter', 'load control', 'two structural latches'], structuralImplementation: 'structural-register-v1' },
    'register-bank3': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native bank execution accelerates the named structural 3×1 bank.', layers: ['Ternary address decoder', 'three structural registers', 'write pass paths', 'Select3 read path'], structuralImplementation: 'structural-register-bank3-v1' },
    'register-bank3x6': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native word register-bank execution accelerates six aligned structural ternary register banks.', layers: ['Six structural three-register banks', 'Shared address/action/clock/reset', 'Atomic six-trit register boundary'], structuralImplementation: 'structural-register-bank3x6-v1' },
    'program-counter6': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native PC execution accelerates six structural registers and a chained Adjust3 increment/hold/decrement path.', layers: ['Six structural ternary registers', 'Six chained Adjust3 cells', 'Shared clock/reset and packed PC control'], structuralImplementation: 'structural-program-counter6-v1' },
    'instruction-register6': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native instruction-register execution represents six aligned edge-triggered registers at the fetch/decode boundary.', layers: ['Six structural ternary registers', 'Shared fetch-load/clock/reset'], structuralImplementation: 'structural-instruction-register6-v1' },
    'instruction-control6': { mode: 'accelerated-equivalent', status: 'architectural control contract', summary: 'A declared instruction truth table translates the captured tryte and fetch/execute phase into named packed control trits. It is an inspectable control boundary, not an ISA primitive.', layers: ['Op2/Op1/Op0 decode', 'Rd/Ra/Rb field routing', 'Packed register/ALU/memory/PC controls'] },
    'cpu-sequencer3': { mode: 'accelerated-equivalent', status: 'architectural control contract', summary: 'A declared state boundary alternates fetch and execute on shared clock edges, then retains halted state until reset.', layers: ['Fetch state', 'Execute state', 'Halted state'] },
    'word-zero6': { mode: 'accelerated-equivalent', status: 'architectural control contract', summary: 'A declared word boundary reports +1 only for a fully known all-zero tryte.', layers: ['Six known ternary lanes', 'All-zero decision'] },
    'cpu-address27': { mode: 'accelerated-equivalent', status: 'architectural control contract', summary: 'A declared address selector presents PC low trits during fetch and register-A low trits during execute.', layers: ['Fetch PC address', 'Execute register address', 'Three-trit Memory 27×6 address'] },
    'cpu-memory-port27': { mode: 'accelerated-equivalent', status: 'architectural control contract', summary: 'A declared CPU-facing port multiplexes fetch reads and execute data accesses onto the public Memory 27×6 address/action/data contract.', layers: ['Fetch action −1', 'Execute read/idle/write action', 'Unmodified six-trit write data'] },
    'cpu-io-adapter3x3': { mode: 'external-adapter', status: 'memory-mapped I/O boundary', summary: 'Routes execute-phase CPU data transactions either to RAM or to documented joystick/display registers. Instruction fetch always remains a RAM read, including at mapped device addresses.', layers: ['Execute-phase −4 joystick X read', 'Execute-phase −3 joystick Y read', 'Execute-phase +4 packed Pixel Display 3×3 write', 'RAM pass-through for every fetch and every other transaction'], structuralImplementation: 'io-contract-cpu-io-adapter3x3-v1' },
    'cpu-memory-cycle6': { mode: 'accelerated-equivalent', status: 'architectural timing contract', summary: 'Makes the zero-cycle memory-read and synchronous write schedule explicit for fetch, LOAD and STORE.', layers: ['Fetch read and instruction-register sample', 'Execute LOAD read and register-file sample', 'Execute STORE edge write'] },
    'cpu-control-flow6': { mode: 'accelerated-equivalent', status: 'architectural control contract', summary: 'Uses the proven 0 / +1 equality result to select normal PC increment, a conditional BRZ target or an unconditional JUMP target.', layers: ['Equal comparison result', 'Three-trit address sign extension', 'PC increment/load controls'] },
    cpu6: { mode: 'accelerated-equivalent', status: 'documented architectural machine reference', summary: 'A complete six-trit fetch/execute CPU state boundary. Its public Memory 27×6 port, PC, register and instruction outputs make every architectural transition inspectable.', layers: ['Program counter and fetch/execute phase', 'Instruction decode and six-trit register file', 'ALU/write-back, branch control and Memory 27×6 port'], structuralImplementation: 'structural-cpu6-v1' },
    'cpu-program-loader6': { mode: 'external-adapter', status: 'example fixture boundary', summary: 'Writes the documented 18C example program through the ordinary Memory 27×6 port before releasing CPU reset; it is not a memory preload backdoor.', layers: ['One public write transaction per clock edge', 'Example-program completion signal', 'CPU reset release after loading'], structuralImplementation: 'io-contract-cpu-program-loader6-v1' },
    'register-file3x6': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native register-file execution accelerates eighteen structural registers, one ternary write decoder and two six-lane Select3 read paths.', layers: ['Three six-trit registers', 'Packed ternary write action', 'Two independent ternary read addresses'], structuralImplementation: 'structural-register-file3x6-v1' },
    'memory3x1': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native memory execution accelerates the named structural three-location ternary memory.', layers: ['Ternary address decoder', 'three structural registers', 'action-gated write paths', 'Select3 read path'], structuralImplementation: 'structural-memory3x1-v1' },
    'memory3x6': { mode: 'accelerated-equivalent', status: 'structural reference available', summary: 'Native word memory execution accelerates six aligned structural Memory 3×1 lanes.', layers: ['Six structural Memory 3×1 lanes', 'Shared address/action/clock/reset', 'Atomic six-trit word boundary'], structuralImplementation: 'structural-memory3x6-v1' },
    'seven-segment-display': { mode: 'external-adapter', status: 'user I/O display boundary', summary: 'An end-user peripheral consumes eight two-state segment-control lines. It is outside the ternary logic hierarchy, not a ternary shortcut.', layers: ['Ternary decoder component', '0 / +1 segment-control boundary', 'Physical/display adapter'] },
    'trit-led': { mode: 'external-adapter', status: 'user I/O indicator boundary', summary: 'A visible end-user indicator samples one ternary wire and renders −1, 0, +1, Z or ? without driving a signal back into the circuit.', layers: ['One sampled ternary wire', 'Visible trit LED adapter'] },
    'binary-led': { mode: 'external-adapter', status: 'user I/O binary indicator boundary', summary: 'A two-terminal physical LED module treats either driven ternary polarity (−1 or +1) as on and 0 as off. Z and ? are simulator-visible invalid wiring states, never normal physical LED states.', layers: ['One sampled ternary wire', 'Polarity-independent LED driver', 'Two-terminal physical LED'] },
    'word-display6': { mode: 'external-adapter', status: 'user I/O word display boundary', summary: 'An end-user peripheral observes and renders six ordered ternary word lanes. It shows known, floating and unknown values without contributing logic.', layers: ['Six ternary word wires', 'Visible − / 0 / + / Z / ? display adapter'] },
    'pixel-display3': { mode: 'external-adapter', status: 'clocked user I/O display boundary', summary: 'A stateful 3×3 ternary pixel peripheral samples x, y, color, clock and reset. A known 0 → +1 edge always writes or synchronously clears its private frame; invalid I/O is visible and never mutates pixels.', layers: ['Ternary x/y/color and control ports', 'Clocked 3×3 peripheral state', 'Visible ternary pixel frame'] },
    'rgb-display24-addressed': { mode: 'external-adapter', status: 'accelerated 24×24 addressed RGB peripheral', summary: 'A named accelerated display reference stores 24×24 RGB pixels. Each R/G/B channel is a six-trit word; two four-trit coordinates select one pixel on every known clock edge.', layers: ['4-trit x/y coordinates', 'Three six-trit RGB data words', 'Clocked 24×24 frame state'], reference: '24×24 addressed frame reference; larger physical display composition is deferred' },
    'rgb-display24-stream': { mode: 'external-adapter', status: 'accelerated two-wire 24×24 serial RGB peripheral', summary: 'A named accelerated display reference accepts one ternary data wire and one clock. Every 18 known trits form R5…R0, G5…G0, B5…B0 for the next raster pixel.', layers: ['One ternary serial data wire', 'Known 0 → +1 serial clock', 'Clocked 24×24 frame state'], reference: '24×24 two-wire serial frame reference; larger physical display composition is deferred' },
    'word-probe6': { mode: 'external-adapter', status: 'debug word observer boundary', summary: 'A compact debug observer samples six ordered ternary word lanes and shows each resolved state without contributing logic or acting as a finished-machine display.', layers: ['Six sampled ternary word wires', 'Debug word readout'] },
    'decimal-debug6': { mode: 'external-adapter', status: 'debug decimal observer boundary', summary: 'A non-structural debug observer converts a settled known six-trit word to decimal for inspection only. It has no circuit output and is not a user-facing hardware peripheral.', layers: ['Six ternary word wires', 'Debug-only decimal readout'] },
    probe: { mode: 'external-adapter', status: 'debug observer boundary', summary: 'Reads a wire without contributing logical behavior or acting as an end-user display.', layers: ['Observation/debug boundary'] },
    'component-input': { mode: 'external-adapter', status: 'module interface boundary', summary: 'Named internal module input to an inspectable reusable circuit; it is not itself an end-user peripheral.', layers: ['Reusable-component input boundary'] },
    'component-output': { mode: 'external-adapter', status: 'module interface boundary', summary: 'Named internal module output from an inspectable reusable circuit; it is not itself an end-user peripheral.', layers: ['Reusable-component output boundary'] },
    'component-seven-segment-display': { mode: 'external-adapter', status: 'boundary', summary: 'Reusable-component boundary for a visible seven-segment peripheral.', layers: ['Ternary decoder component', '0 / +1 segment-control boundary', 'Physical/display adapter'] },
  };
  for (const [type, implementation] of Object.entries(implementationMetadata)) registry.get(type).implementation = implementation;

  global.TernaryCore = { TRITS, UNKNOWN, FLOATING, isUnknown, isFloating, isKnownTrit, trit, balancedWordDigits, balancedWordValue, CPU_OPCODES, decodeInstruction6, CPU_PHASES, cpuSequencerControls, nextCpuPhase, signExtendAddress3, cpuMemoryCycle, cpuControlFlow6, clone, normalizeSequence, nextSequenceState, EventBus, ComponentRegistry, Circuit, registry, slug, boundaryPorts, makeCustomDefinition };
})(window);
