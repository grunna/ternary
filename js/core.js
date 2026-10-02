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
      if (fromComponentId === toComponentId && breaksCombinationalPath(this.components.get(fromComponentId), this.registry)) return false;
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
        component.state.runtimeVersion = runtimeVersion;
        component.state.runtime = inner.serialize();
        return result;
      },
    };
  }

  const needsKnownInputs = (component, names) => names.every((name) => isKnownTrit(component.inputs[name]));

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

  const experimentalCost = () => ({ logical: { nodes: 1, depth: 1 } });

  // Technology-neutral device/cell layer. These are idealized electrical cells,
  // deliberately separate from any CMOS, CNTFET, current-mode or memristive mapping.
  const idealDeviceCost = () => ({ logical: { nodes: 1, depth: 1 } });
  registry.register({ type: 'restore3', label: 'Ternary restorer', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: ['in'], outputs: ['out'], evaluate(c) { return { out: isKnownTrit(c.inputs.in) ? trit(c.inputs.in) : UNKNOWN }; } });
  registry.register({ type: 'threshold3', label: 'Ternary level detector', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: ['in'], outputs: ['neg', 'zero', 'pos'], evaluate(c) { const value = trit(c.inputs.in); if (!isKnownTrit(value)) return { neg: UNKNOWN, zero: UNKNOWN, pos: UNKNOWN }; return { neg: value < 0 ? 1 : 0, zero: value === 0 ? 1 : 0, pos: value > 0 ? 1 : 0 }; } });
  registry.register({ type: 'pass3', label: 'Ternary pass switch', category: 'device', candidate: true, cost: idealDeviceCost(), inputs: ['in', 'gate'], outputs: ['out'], evaluate(c) { const gate = trit(c.inputs.gate); if (!isKnownTrit(gate)) return { out: UNKNOWN }; return { out: gate === 1 ? trit(c.inputs.in) : FLOATING }; } });
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
  registry.register({ type: 'probe', label: 'Probe', inputs: ['in'], outputs: [], defaultState: { value: UNKNOWN }, evaluate(c) { c.state.value = trit(c.inputs.in); return {}; } });
  registry.register({ type: 'component-input', label: 'Component Input', inputs: [], outputs: ['out'], defaultState: { name: 'in', value: 0 }, boundary: 'input', evaluate: (c) => ({ out: trit(c.state.value) }) });
  registry.register({ type: 'component-seven-segment-display', label: '7-segment Output', inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'sign'], outputs: [], boundary: 'display', evaluate() { return {}; } });
  registry.register({ type: 'component-output', label: 'Component Output', inputs: ['in'], outputs: [], defaultState: { name: 'out', value: UNKNOWN }, boundary: 'output', evaluate(c) { c.state.value = trit(c.inputs.in); return {}; } });

  // Every built-in component declares its execution role and the lowest known
  // structural path. This is displayed in the Inspector; it prevents native
  // evaluation from silently becoming a magic architectural primitive.
  const implementationMetadata = {
    'trit-input': { mode: 'source boundary', status: 'boundary', summary: 'A user or external device drives one resolved ternary level onto the circuit.', layers: ['External/user source → driven ternary wire'] },
    clock: { mode: 'source boundary', status: 'boundary', summary: 'A timing source is outside the combinational ternary datapath.', layers: ['External timing source → clock wire'] },
    'sequence-generator': { mode: 'source boundary', status: 'boundary', summary: 'A simulator/UI source emits a declared sequence; it is not internal logic.', layers: ['External timing/control source → ternary wire'] },
    restore3: { mode: 'ideal structural cell', status: 'cell boundary', summary: 'Technology-neutral cell: accepts a driven trit and restores an ideal resolved level.', layers: ['Ideal ternary restorer cell'] },
    threshold3: { mode: 'ideal structural cell', status: 'cell boundary', summary: 'Technology-neutral cell: detects negative, zero and positive input regions.', layers: ['Ideal ternary level-detector cell'] },
    pass3: { mode: 'ideal structural cell', status: 'cell boundary', summary: 'Technology-neutral cell: a +1 gate passes the input; other known gates intentionally float the output.', layers: ['Ideal controlled ternary transmission cell'] },
    'storage-node3': { mode: 'ideal structural cell', status: 'cell boundary', summary: 'Technology-neutral declared storage boundary. It is the lowest state-holding cell represented by this simulator.', layers: ['Ideal ternary storage cell'] },
    'clock-phase3': { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native clock-phase contract. Its lower cell network must be captured before it can be treated as an accelerator.', layers: ['Ternary level detection', 'phase-selection network', 'restored clock output'] },
    negate: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native balanced-trit inversion contract. A cell-level truth-table network has not yet been drawn in the editor.', layers: ['Ternary level detection', 'three-way inversion decision network', 'restored output'] },
    compare: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native comparison contract. A lower-level comparator network remains an explicit construction task.', layers: ['Ternary level detection', 'pairwise decision network', 'restored -1 / 0 / +1 output'] },
    select3: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native three-way selection contract. A structural version needs select decoding, three controlled paths and an explicit resolved-output/merge cell.', layers: ['Ternary level detector (select)', 'three controlled ternary paths', 'resolved output merge', 'ternary restorer'] },
    route3: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native one-to-three routing contract. Its structural form is select decoding plus three gated paths.', layers: ['Ternary level detector (select)', 'three controlled ternary paths', 'restorers on output paths'] },
    adjust3: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native decrement/hold/increment contract. It must eventually be expressed as a cell-level arithmetic decision network.', layers: ['Ternary level detection', 'nine-case arithmetic decision network', 'restored next and carry outputs'] },
    control3: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native packed-control decoder. It maps naturally to the three outputs of a level detector; the explicit structural circuit is still to be captured.', layers: ['Ternary level detector', 'restored negative/zero/positive control paths'] },
    min: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native MIN candidate. A lower-level decision network remains to be drawn and tested.', layers: ['Ternary level detection', 'pairwise MIN decision network', 'ternary restorer'] },
    max: { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native MAX candidate. A lower-level decision network remains to be drawn and tested.', layers: ['Ternary level detection', 'pairwise MAX decision network', 'ternary restorer'] },
    'normalize-carry': { mode: 'functional primitive', status: 'structural circuit pending', summary: 'Native full-adder reference contract. Its 27-case behavior is proven; its explicit cell-level decision network is a separate future structural component.', layers: ['Ternary level detection', '27-case sum/carry decision network', 'restored sum and carry outputs'] },
    latch3: { mode: 'accelerated, structurally equivalent', status: 'structural reference available', summary: 'Native execution accelerates the same latch contract demonstrated by the opening structural latch.', layers: ['Ternary restorer (D)', 'Ternary pass switch (enable)', 'Ternary storage node', 'Ternary restorer (Q)'], reference: 'Load the Structural storage demo and open Latch — structural pass cell.' },
    register3: { mode: 'accelerated, structurally equivalent', status: 'structural reference available', summary: 'Native execution accelerates the same edge-triggered register contract demonstrated by two structural latches.', layers: ['Clock phase inverter', 'MIN (load ∧ clock-low)', 'Master structural latch', 'Slave structural latch'], reference: 'Load the Structural storage demo and open Register — two structural latches.' },
    'register-bank3': { mode: 'accelerated', status: 'structural circuit pending', summary: 'The native bank is a three-register convenience implementation. It is not yet allowed to claim structural equivalence until its decoder, write selection and read selector are open components.', layers: ['Ternary address decoder', 'Three ternary registers', 'Write-selection network', 'Select3 read path'] },
    'seven-segment-display': { mode: 'external adapter', status: 'boundary', summary: 'A peripheral consumes eight two-state segment-control lines. It is outside the ternary logic hierarchy, not a ternary shortcut.', layers: ['Ternary decoder component', '0 / +1 segment-control boundary', 'Physical/display adapter'] },
    probe: { mode: 'observation boundary', status: 'boundary', summary: 'Reads a wire without contributing logical behavior.', layers: ['Observation/debug boundary'] },
    'component-input': { mode: 'component boundary', status: 'boundary', summary: 'Named external input to an inspectable reusable circuit.', layers: ['Reusable-component input boundary'] },
    'component-output': { mode: 'component boundary', status: 'boundary', summary: 'Named external output from an inspectable reusable circuit.', layers: ['Reusable-component output boundary'] },
    'component-seven-segment-display': { mode: 'external adapter', status: 'boundary', summary: 'Reusable-component boundary for a visible seven-segment peripheral.', layers: ['Ternary decoder component', '0 / +1 segment-control boundary', 'Physical/display adapter'] },
  };
  for (const [type, implementation] of Object.entries(implementationMetadata)) registry.get(type).implementation = implementation;

  global.TernaryCore = { TRITS, UNKNOWN, FLOATING, isUnknown, isFloating, isKnownTrit, trit, clone, normalizeSequence, nextSequenceState, EventBus, ComponentRegistry, Circuit, registry, slug, boundaryPorts, makeCustomDefinition };
})(window);
