(function (global) {
  'use strict';

  const TRITS = Object.freeze([-1, 0, 1]);
  const UNKNOWN = null;
  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const isUnknown = (value) => value === null || value === undefined;
  const trit = (value) => isUnknown(value) ? UNKNOWN : Number(value) < 0 ? -1 : Number(value) > 0 ? 1 : 0;

  const hasGraphCycle = (wires) => {
    const outgoing = new Map();
    for (const wire of wires) {
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
        cost: {
          logical: { nodes: 1, depth: 1 },
          physical: { model: 'unmodeled', transistorEstimate: null, delayUnits: null, staticPowerUnits: null },
        },
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
      if (fromComponentId === toComponentId) throw new Error('Self-connections are not allowed.');

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
      const outgoing = new Map();
      for (const wire of this.wires.values()) {
        if (wire.id === ignoredWireId) continue;
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
      for (const generator of generators) this.advanceSequenceGenerator(generator, 'clock step');
      this.events.emit('clock-step', { clocks: generators.map((generator) => generator.id) });
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
      if (hasGraphCycle(validWires)) throw new Error('Circuit contains a combinational feedback loop.');
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
      }
    }
    return { inputs, outputs };
  }

  function makeCustomDefinition(meta, registry) {
    const boundaries = boundaryPorts(meta.circuit);
    return {
      type: meta.type,
      label: meta.label,
      inputs: boundaries.inputs.map((p) => p.name),
      outputs: boundaries.outputs.map((p) => p.name),
      custom: true,
      customId: meta.id,
      circuit: clone(meta.circuit),
      evaluate(component) {
        const inner = new Circuit(registry);
        inner.load(meta.circuit);
        for (const input of boundaries.inputs) inner.setState(input.componentId, { value: trit(component.inputs[input.name]) });
        inner.simulate();
        const result = {};
        for (const output of boundaries.outputs) {
          const boundary = inner.components.get(output.componentId);
          result[output.name] = trit(boundary?.state?.value);
        }
        return result;
      },
    };
  }

  const needsKnownInputs = (component, names) => names.every((name) => !isUnknown(component.inputs[name]));

  const registry = new ComponentRegistry();

  registry.register({ type: 'trit-input', label: 'Trit input', inputs: [], outputs: ['out'], defaultState: { value: 0 }, evaluate: (c) => ({ out: trit(c.state.value) }) });
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
  const experimentalCost = (notes = '') => ({
    logical: { nodes: 1, depth: 1 },
    // Physical values are intentionally unknown until a concrete transistor/comparator
    // implementation is chosen. Keeping null is better than inventing hardware numbers.
    physical: { model: 'unmodeled', transistorEstimate: null, delayUnits: null, staticPowerUnits: null, notes },
  });

  registry.register({ type: 'negate', label: 'Negate', category: 'logic', candidate: true, cost: experimentalCost('Balanced ternary inversion candidate.'), inputs: ['in'], outputs: ['out'], evaluate: (c) => ({ out: needsKnownInputs(c, ['in']) ? -trit(c.inputs.in) : UNKNOWN }) });
  registry.register({ type: 'compare', label: 'Compare', category: 'logic', candidate: true, cost: experimentalCost('Returns -1, 0 or +1 for less/equal/greater.'), inputs: ['a', 'b'], outputs: ['out'], evaluate(c) { if (!needsKnownInputs(c, ['a', 'b'])) return { out: UNKNOWN }; const a = trit(c.inputs.a), b = trit(c.inputs.b); return { out: a < b ? -1 : a > b ? 1 : 0 }; } });
  registry.register({ type: 'select3', label: 'Select3', category: 'routing', candidate: true, cost: experimentalCost('Native three-way selector candidate.'), inputs: ['neg', 'zero', 'pos', 'select'], outputs: ['out'], evaluate(c) { const s = trit(c.inputs.select); if (isUnknown(s)) return { out: UNKNOWN }; return { out: trit(c.inputs[s < 0 ? 'neg' : s > 0 ? 'pos' : 'zero']) }; } });
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
  registry.register({ type: 'probe', label: 'Probe', inputs: ['in'], outputs: [], defaultState: { value: UNKNOWN }, evaluate(c) { c.state.value = trit(c.inputs.in); return {}; } });
  registry.register({ type: 'component-input', label: 'Component Input', inputs: [], outputs: ['out'], defaultState: { name: 'in', value: 0 }, boundary: 'input', evaluate: (c) => ({ out: trit(c.state.value) }) });
  registry.register({ type: 'component-output', label: 'Component Output', inputs: ['in'], outputs: [], defaultState: { name: 'out', value: UNKNOWN }, boundary: 'output', evaluate(c) { c.state.value = trit(c.inputs.in); return {}; } });

  global.TernaryCore = { TRITS, UNKNOWN, isUnknown, trit, clone, normalizeSequence, nextSequenceState, EventBus, ComponentRegistry, Circuit, registry, slug, boundaryPorts, makeCustomDefinition };
})(window);
