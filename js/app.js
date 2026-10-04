(function () {
  'use strict';

  const { Circuit, registry, makeCustomDefinition, boundaryPorts, slug, clone, normalizeSequence, trit, CPU_OPCODES } = window.TernaryCore;
  const { ProjectStorage } = window.TernaryStorage;
  const { CircuitRenderer } = window.TernaryRenderer;

  const storage = new ProjectStorage();
  const customComponents = new Map();
  // A stable reference name maps to the project-local custom definition that
  // currently realizes it. IDs are regenerated when a project is loaded.
  const structuralReferences = new Map();
  const navigation = [];
  let rootCircuit = new Circuit(registry);
  let current = { kind: 'root', label: 'Project', circuit: rootCircuit, customId: null };
  let renderer;
  let clipboard = null;
  let computerRunTimer = null;

  const simulation = { mode: 'run', previousMode: 'run', timer: null, generatorTimer: null, generatorLastTick: performance.now(), activeUnsubscribers: [] };

  const UTILITY_PRIMITIVES = ['trit-input', 'word-input6', 'input-button3', 'input-joystick3', 'input-joystick6', 'ternary-reference', 'sequence-generator', 'latch3', 'register3', 'register-bank3', 'register-bank3x6', 'register-file3x6', 'program-counter6', 'instruction-register6', 'instruction-control6', 'cpu-memory-cycle6', 'cpu-control-flow6', 'cpu6', 'cpu-program-loader6', 'cpu-io-adapter3x3', 'memory3x1', 'memory3x6', 'memory9x6', 'memory27x6', 'memory81x6', 'memory243x6', 'memory729x6', 'seven-segment-display', 'trit-led', 'binary-led', 'word-display6', 'pixel-display3', 'rgb-display24-addressed', 'rgb-display24-stream', 'word-probe6', 'decimal-debug6', 'probe'];
  const EXPERIMENTAL_PRIMITIVES = ['negate', 'compare', 'select3', 'route3', 'adjust3', 'control3', 'threshold3', 'restore3', 'pass3', 'merge3', 'ternary-reference', 'storage-node3', 'clock-phase3', 'min', 'max', 'normalize-carry'];
  const PRIMITIVE_SETS = {
    all: { label: 'All candidates', description: 'Expose every current ternary primitive candidate.', types: [...EXPERIMENTAL_PRIMITIVES], metadata: { purpose: 'exploration', logicalCostModel: 'sum primitive node costs' } },
    minmax: { label: 'MIN / MAX', description: 'Explore symmetric MIN, MAX and negate logic, with normalize/carry for arithmetic experiments.', types: ['negate', 'min', 'max', 'normalize-carry'], metadata: { purpose: 'min/max ternary logic', logicalCostModel: 'sum primitive node costs' } },
    selector: { label: 'Compare / Select', description: 'Explore compare and native three-way routing as the main ternary building blocks.', types: ['negate', 'compare', 'select3', 'route3', 'adjust3', 'control3', 'threshold3', 'restore3', 'pass3', 'merge3', 'storage-node3', 'clock-phase3', 'normalize-carry'], metadata: { purpose: 'comparison/routing architecture', logicalCostModel: 'sum primitive node costs' } },
    arithmetic: { label: 'Arithmetic core', description: 'Small set focused on balanced-ternary arithmetic experiments.', types: ['negate', 'compare', 'adjust3', 'normalize-carry'], metadata: { purpose: 'arithmetic', logicalCostModel: 'sum primitive node costs' } },
  };
  const PRIMITIVE_GROUPS = [
    { label: 'User I/O peripherals', types: ['input-button3', 'input-joystick3', 'input-joystick6', 'seven-segment-display', 'trit-led', 'binary-led', 'word-display6', 'pixel-display3', 'rgb-display24-addressed', 'rgb-display24-stream'] },
    { label: 'Test, debug & internal sources', types: ['trit-input', 'word-input6', 'ternary-reference', 'sequence-generator', 'probe', 'word-probe6', 'decimal-debug6'] },
    { label: 'Logic & signal shaping', types: ['negate', 'min', 'max', 'threshold3', 'restore3', 'pass3', 'merge3'] },
    { label: 'Compare & routing', types: ['compare', 'select3', 'route3', 'control3'] },
    { label: 'Arithmetic', types: ['adjust3', 'normalize-carry'] },
    { label: 'State & timing', types: ['latch3', 'register3', 'register-bank3', 'register-bank3x6', 'register-file3x6', 'program-counter6', 'instruction-register6', 'instruction-control6', 'cpu-memory-cycle6', 'cpu-control-flow6', 'cpu6', 'cpu-io-adapter3x3', 'memory3x1', 'memory3x6', 'memory9x6', 'memory27x6', 'memory81x6', 'storage-node3', 'clock-phase3'] },
  ];
  const primitiveExperiment = { activeId: 'all', customTypes: new Set(EXPERIMENTAL_PRIMITIVES) };
  const PROJECT_FORMAT_VERSION = 6;
  const COMPONENT_PACKAGE_FORMAT_VERSION = 1;
  let currentProjectId = null;
  let currentProjectName = 'Project 1';
  let testSuites = [];
  let componentTestDraftExpected = {};
  let componentTestDraftComponentId = null;
  let lastSavedSnapshot = '';
  let autosaveTimer = null;
  let projectActionBusy = false;
  let lastProjectError = '';
  const stateTimeline = [];

  const history = { undo: [], redo: [], pending: null, restoring: false };

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const inspectorEl = $('inspector');
  const deleteBtn = $('deleteBtn');
  const undoBtn = $('undoBtn');
  const redoBtn = $('redoBtn');
  const copyBtn = $('copyBtn');
  const pasteBtn = $('pasteBtn');
  const backBtn = $('backBtn');
  const primitiveList = $('primitiveList');
  const interfaceSection = $('interfaceSection');
  const interfaceList = $('interfaceList');
  const customList = $('customList');
  const customEmpty = $('customEmpty');
  const breadcrumbs = $('breadcrumbs');
  const componentTestSection = $('componentTestSection');
  const componentTestPanel = $('componentTestPanel');
  const runBtn = $('runBtn');
  const visualizeBtn = $('visualizeBtn');
  const pauseBtn = $('pauseBtn');
  const stepBtn = $('stepBtn');
  const clockStepBtn = $('clockStepBtn');
  const computerControls = $('computerControls');
  const computerRunBtn = $('computerRunBtn');
  const computerInstructionBtn = $('computerInstructionBtn');
  const computerClockBtn = $('computerClockBtn');
  const loadExampleProgramBtn = $('loadExampleProgramBtn');
  const writeProgramBtn = $('writeProgramBtn');
  const importProgramBtn = $('importProgramBtn');
  const exportProgramBtn = $('exportProgramBtn');
  const programFile = $('programFile');
  const programEditorDialog = $('programEditorDialog');
  const programEditorName = $('programEditorName');
  const programEditorDescription = $('programEditorDescription');
  const programEditorSource = $('programEditorSource');
  const loadWrittenProgramBtn = $('loadWrittenProgramBtn');
  const stateTimelineEl = $('stateTimeline');
  const visualizeSpeed = $('visualizeSpeed');
  const queueCount = $('queueCount');
  const queueList = $('queueList');
  const primitiveSetSelect = $('primitiveSetSelect');
  const primitiveSetDescription = $('primitiveSetDescription');
  const primitiveSetChecks = $('primitiveSetChecks');
  const primitiveSetCost = $('primitiveSetCost');
  const projectSelect = $('projectSelect');
  const projectNameInput = $('projectName');
  const projectMessage = $('projectMessage');
  const importFile = $('importFile');
  const importComponentBtn = $('importComponentBtn');
  const importComponentFile = $('importComponentFile');

  function circuit() { return current.circuit; }
  function fmt(value) { value = trit(value); return value === null ? '?' : value === 'Z' ? 'Z' : value > 0 ? '+1' : String(value); }
  function esc(value) { return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function setStatus(message, error = false) { statusEl.textContent = message; statusEl.classList.toggle('error', Boolean(error)); }

  function setProjectMessage(message = '', error = false) {
    if (!projectMessage) return;
    projectMessage.hidden = !message;
    projectMessage.textContent = message;
    projectMessage.classList.toggle('error', Boolean(error));
  }

  function updateStats() {
    $('statComponents').textContent = circuit().components.size;
    $('statWires').textContent = circuit().wires.size;
    $('statEvaluations').textContent = circuit().stats.evaluations;
    $('statChanges').textContent = circuit().stats.signalChanges;
  }

  function snapshotString() { return JSON.stringify(circuit().serialize()); }
  function updateHistoryButtons() { undoBtn.disabled = !history.undo.length; redoBtn.disabled = !history.redo.length; }
  function resetHistory() { history.undo.length = 0; history.redo.length = 0; history.pending = null; updateHistoryButtons(); }
  function beginHistory(label) { if (!history.restoring) history.pending = { label, before: snapshotString() }; }
  function commitHistory(label, metadata = null) {
    if (history.restoring || !history.pending) return;
    const after = snapshotString();
    const entry = history.pending; history.pending = null;
    if (entry.before === after) return;
    history.undo.push({ label: label || entry.label, before: entry.before, after, metadata });
    if (history.undo.length > 100) history.undo.shift();
    history.redo.length = 0; updateHistoryButtons();
  }
  function restoreSnapshot(serialized) {
    history.restoring = true;
    try { circuit().load(JSON.parse(serialized)); renderer.select(null); updateStats(); }
    finally { history.restoring = false; history.pending = null; }
  }
  function componentLayoutSize(component) {
    const definition = registry.get(component.type);
    const visual = component.type === 'seven-segment-display' || component.type === 'component-seven-segment-display' || definition.visual?.kind === 'seven-segment';
    const wordDisplay = component.type === 'word-display6';
    const wordProbe = component.type === 'word-probe6';
    const pixelDisplay = component.type === 'pixel-display3';
    const rgbDisplay = component.type === 'rgb-display24-addressed' || component.type === 'rgb-display24-stream';
    const decimalDebug = component.type === 'decimal-debug6';
    const width = visual ? 240 : wordDisplay ? 260 : wordProbe ? 230 : pixelDisplay ? 270 : rgbDisplay ? 320 : decimalDebug ? 250 : component.type === 'select3' ? 170 : 150;
    const rows = Math.max(definition.inputs.length, definition.outputs.length, 1);
    return { width, height: Math.max(visual ? 240 : wordDisplay || wordProbe || pixelDisplay || decimalDebug ? 210 : rgbDisplay ? 570 : 78, 48 + rows * 24) };
  }

  function autoLayoutCircuit() {
    const components = [...circuit().components.values()];
    if (!components.length) return setStatus('Auto layout: the circuit is empty.', true);
    const definitionFor = (id) => registry.get(circuit().components.get(id).type);
    const layer = new Map(components.map((component) => [component.id, 0]));
    const incoming = new Map(components.map((component) => [component.id, 0]));
    const outgoing = new Map(components.map((component) => [component.id, []]));
    const predecessors = new Map(components.map((component) => [component.id, []]));

    // A state boundary starts a new logical stage: feedback into it does not
    // force its stored output into the same combinational layer.
    for (const wire of circuit().wires.values()) {
      const target = circuit().components.get(wire.to.componentId);
      if (!target || definitionFor(target.id).breaksCombinationalPath) continue;
      outgoing.get(wire.from.componentId)?.push(wire.to.componentId);
      predecessors.get(wire.to.componentId)?.push(wire.from.componentId);
      incoming.set(wire.to.componentId, (incoming.get(wire.to.componentId) || 0) + 1);
    }
    const order = (left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);
    const queue = components.filter((component) => incoming.get(component.id) === 0).sort(order);
    const processed = new Set();
    while (queue.length) {
      const component = queue.shift();
      if (processed.has(component.id)) continue;
      processed.add(component.id);
      for (const nextId of outgoing.get(component.id) || []) {
        layer.set(nextId, Math.max(layer.get(nextId) || 0, (layer.get(component.id) || 0) + 1));
        incoming.set(nextId, incoming.get(nextId) - 1);
        if (incoming.get(nextId) === 0) queue.push(circuit().components.get(nextId));
      }
      queue.sort(order);
    }
    // Invalid/imported cycles cannot block the editor; keep their nodes visible
    // in the first column rather than leaving them unplaced.
    for (const component of components) if (!processed.has(component.id)) layer.set(component.id, 0);

    const columns = new Map();
    for (const component of components) {
      const index = layer.get(component.id) || 0;
      if (!columns.has(index)) columns.set(index, []);
      columns.get(index).push(component);
    }
    const indices = [...columns.keys()].sort((a, b) => a - b);
    const sizes = new Map(components.map((component) => [component.id, componentLayoutSize(component)]));
    const columnWidths = new Map(indices.map((index) => [index, Math.max(...columns.get(index).map((component) => sizes.get(component.id).width))]));
    const horizontalGap = 115;
    const totalWidth = indices.reduce((sum, index) => sum + columnWidths.get(index), 0) + horizontalGap * Math.max(0, indices.length - 1);
    let x = -totalWidth / 2;
    const placedY = new Map();
    const positions = new Map();
    for (const index of indices) {
      const column = columns.get(index);
      column.sort((left, right) => {
        const average = (component) => {
          const parents = predecessors.get(component.id) || [];
          const ys = parents.map((id) => placedY.get(id)).filter(Number.isFinite);
          return ys.length ? ys.reduce((sum, value) => sum + value, 0) / ys.length : component.y;
        };
        return average(left) - average(right) || order(left, right);
      });
      const verticalGap = 32;
      const totalHeight = column.reduce((sum, component) => sum + sizes.get(component.id).height, 0) + verticalGap * Math.max(0, column.length - 1);
      let y = -totalHeight / 2;
      for (const component of column) {
        positions.set(component.id, { x, y });
        placedY.set(component.id, y + sizes.get(component.id).height / 2);
        y += sizes.get(component.id).height + verticalGap;
      }
      x += columnWidths.get(index) + horizontalGap;
    }

    beginHistory('Auto layout by signal layers');
    for (const component of components) {
      const position = positions.get(component.id);
      circuit().moveComponent(component.id, Math.round(position.x), Math.round(position.y));
    }
    commitHistory('Auto layout by signal layers');
    renderer.select(null);
    const bounds = [...positions.entries()].reduce((box, [id, position]) => {
      const size = sizes.get(id);
      return { left: Math.min(box.left, position.x), top: Math.min(box.top, position.y), right: Math.max(box.right, position.x + size.width), bottom: Math.max(box.bottom, position.y + size.height) };
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    const padding = 80;
    const scale = Math.max(0.25, Math.min(1.35, Math.min((renderer.app.screen.width - padding) / (bounds.right - bounds.left + padding), (renderer.app.screen.height - padding) / (bounds.bottom - bounds.top + padding))));
    renderer.setViewState({ x: renderer.app.screen.width / 2 - ((bounds.left + bounds.right) / 2) * scale, y: renderer.app.screen.height / 2 - ((bounds.top + bounds.bottom) / 2) * scale, scale });
    updateStats();
    setStatus(`Auto layout arranged ${components.length} components in ${indices.length} signal layer${indices.length === 1 ? '' : 's'}.`);
  }

  function undo() {
    const e = history.undo.pop(); if (!e) return;
    if (e.metadata?.addedCustom) {
      customComponents.delete(e.metadata.addedCustom.id);
      registry.remove(e.metadata.addedCustom.type);
    }
    restoreSnapshot(e.before); renderLibrary();
    history.redo.push(e); updateHistoryButtons(); setStatus(`Undo: ${e.label}.`);
  }
  function redo() {
    const e = history.redo.pop(); if (!e) return;
    if (e.metadata?.addedCustom) {
      customComponents.set(e.metadata.addedCustom.id, clone(e.metadata.addedCustom));
      registerCustom(e.metadata.addedCustom);
    }
    restoreSnapshot(e.after); renderLibrary();
    history.undo.push(e); updateHistoryButtons(); setStatus(`Redo: ${e.label}.`);
  }

  function copySelection() {
    const ids = renderer.getSelectedComponentIds();
    if (!ids.length) return setStatus('Select one or more components to copy.', true);
    const idSet = new Set(ids);
    const components = ids.map((id) => clone(circuit().components.get(id))).filter(Boolean);
    const wires = [...circuit().wires.values()]
      .filter((wire) => idSet.has(wire.from.componentId) && idSet.has(wire.to.componentId))
      .map(clone);
    const minX = Math.min(...components.map((c) => c.x));
    const minY = Math.min(...components.map((c) => c.y));
    clipboard = { components, wires, minX, minY, pasteCount: 0 };
    pasteBtn.disabled = false;
    setStatus(`Copied ${components.length} component${components.length === 1 ? '' : 's'} and ${wires.length} internal connection${wires.length === 1 ? '' : 's'}.`);
  }

  function pasteSelection() {
    if (!clipboard?.components?.length) return setStatus('Nothing copied yet.', true);
    const offset = 40 + (clipboard.pasteCount * 20);
    const idMap = new Map();
    const newIds = [];
    beginHistory('Paste components');
    try {
      for (const source of clipboard.components) {
        const component = circuit().addComponent(
          source.type,
          source.x + offset,
          source.y + offset,
          clone(source.state || {}),
        );
        idMap.set(source.id, component.id);
        newIds.push(component.id);
      }
      for (const sourceWire of clipboard.wires) {
        const fromId = idMap.get(sourceWire.from.componentId);
        const toId = idMap.get(sourceWire.to.componentId);
        if (!fromId || !toId) continue;
        const wire = circuit().connect(fromId, sourceWire.from.port, toId, sourceWire.to.port);
        if (sourceWire.label) circuit().setWireLabel(wire.id, sourceWire.label);
      }
      clipboard.pasteCount++;
      commitHistory('Paste components');
      renderer.setSelectedComponents(newIds);
      updateStats();
      setStatus(`Pasted ${newIds.length} component${newIds.length === 1 ? '' : 's'}.`);
    } catch (error) {
      history.pending = null;
      setStatus(`Paste failed: ${error.message}`, true);
    }
  }

  function endpointText(endpoint) {
    const component = circuit().components.get(endpoint.componentId);
    const label = component ? registry.get(component.type).label : endpoint.componentId;
    return `${label} (${endpoint.componentId}).${endpoint.port}`;
  }

  function structuralImplementationPanel(def) {
    const info = def.implementation || {
      mode: def.custom ? 'structural' : 'unclassified',
      status: def.custom ? 'inspectable' : 'needs classification',
      summary: def.custom ? 'Open this reusable component to inspect its circuit.' : 'This component has not yet been classified against the structural-equivalence rule.',
      layers: def.custom ? ['Open internals → nested components and primitives'] : [],
    };
    const layers = (info.layers || []).map((layer) => '<li>' + esc(layer) + '</li>').join('');
    return '<details class="implementation-panel" open>' +
      '<summary>Implementation: ' + esc(info.mode) + '</summary>' +
      '<p class="implementation-status">Status: <strong>' + esc(info.status) + '</strong></p>' +
      '<p>' + esc(info.summary) + '</p>' +
      (layers ? '<p class="implementation-label">Structural path</p><ol>' + layers + '</ol>' : '') +
      (info.reference ? '<p class="implementation-reference">' + esc(info.reference) + '</p>' : '') +
      (info.structuralImplementation ? '<div class="selection-actions"><button id="openStructuralImplementationBtn" class="primary-action" type="button">Open structural implementation</button></div>' : '') +
      '</details>';
  }

  function updateInspector(selection) {
    deleteBtn.disabled = !selection;
    const componentSelection = selection && (selection.kind === 'component' || selection.kind === 'components');
    copyBtn.disabled = !componentSelection;

    if (!selection) {
      inspectorEl.className = 'inspector empty';
      inspectorEl.textContent = 'Select a component or connection.';
      return;
    }

    if (selection.kind === 'components') {
      inspectorEl.className = 'inspector';
      inspectorEl.innerHTML = `<p><strong>${selection.ids.length} components selected</strong></p>
        <p class="hint">Drag any selected block to move the whole selection. Copy/paste preserves wires between selected blocks.</p>
        <div class="selection-actions"><button id="createComponentFromSelectionBtn" class="primary-action" type="button">Create component from selection</button><button id="inspectorDeleteBtn" type="button">Delete selected blocks</button></div>`;
      $('createComponentFromSelectionBtn').addEventListener('click', createComponentFromSelection);
      $('inspectorDeleteBtn').addEventListener('click', () => renderer.deleteSelection());
      return;
    }

    if (selection.kind === 'wire') {
      const wire = selection.item;
      inspectorEl.className = 'inspector';
      inspectorEl.innerHTML = `<dl>
        <dt>Type</dt><dd>Connection</dd><dt>ID</dt><dd>${wire.id}</dd>
        <dt>Signal</dt><dd>${fmt(wire.value)}</dd>
        <dt>From</dt><dd class="wire-endpoint">${endpointText(wire.from)}</dd>
        <dt>To</dt><dd class="wire-endpoint">${endpointText(wire.to)}</dd>
      </dl>
      <label class="editor-field">Signal name<input id="signalName" type="text" value="${esc(wire.label || '')}" placeholder="optional" /></label>
      <div class="selection-actions">
        <button id="renameSignalBtn" type="button">Rename signal</button>
        <button id="inspectorDeleteBtn" type="button">Delete connection</button>
      </div>`;
      $('renameSignalBtn').addEventListener('click', () => {
        beginHistory('Rename signal');
        circuit().setWireLabel(wire.id, $('signalName').value);
        commitHistory('Rename signal');
        updateInspector({ kind: 'wire', id: wire.id, item: circuit().wires.get(wire.id) });
        setStatus('Signal renamed.');
      });
      $('inspectorDeleteBtn').addEventListener('click', () => renderer.deleteSelection());
      return;
    }

    const component = selection.item;
    const def = registry.get(component.type);
    const layout = component.state.layout || {};
    const defaultWidth = component.type === 'select3' ? 170 : 150;
    const width = Number(layout.width) || defaultWidth;
    const portSpacing = Number(layout.portSpacing) || 24;
    const inputSide = layout.inputSide === 'right' ? 'right' : 'left';
    const outputSide = layout.outputSide === 'left' ? 'left' : 'right';
    const inputText = def.inputs.length ? def.inputs.map((p) => `${p}: ${fmt(component.inputs[p])}`).join(', ') : '—';
    const outputText = def.outputs.length ? def.outputs.map((p) => `${p}: ${fmt(component.outputs[p])}`).join(', ') : '—';
    inspectorEl.className = 'inspector';

    let extra = `<label class="editor-field">Instance name<input id="componentLabel" type="text" value="${esc(component.state.label || '')}" placeholder="${esc(def.label)}" /></label>
      <div class="selection-actions"><button id="renameComponentBtn" type="button">Rename component</button></div>`;

    if (def.boundary === 'input' || def.boundary === 'output') {
      extra += `<label class="editor-field">External port name<input id="boundaryName" type="text" value="${esc(component.state.name || '')}" /></label>
        <div class="selection-actions"><button id="renameBoundaryBtn" type="button">Rename port</button></div>`;
    }

    if (['trit-input', 'ternary-reference'].includes(component.type)) {
      const currentValue = trit(component.state.value);
      const valueLabel = component.type === 'ternary-reference' ? 'Reference level' : 'Input value';
      const exceptionalChoices = component.type === 'trit-input' ? `<button type="button" data-trit-value="Z"${currentValue === 'Z' ? ' class="active"' : ''}>Z</button><button type="button" data-trit-value="unknown"${currentValue === null ? ' class="active"' : ''}>?</button>` : '';
      extra += `<div class="cost-note trit-value-editor"><strong>${valueLabel}</strong><div class="selection-actions trit-choice" role="group" aria-label="Set trit input value"><button type="button" data-trit-value="-1"${currentValue === -1 ? ' class="active"' : ''}>−1</button><button type="button" data-trit-value="0"${currentValue === 0 ? ' class="active"' : ''}>0</button><button type="button" data-trit-value="1"${currentValue === 1 ? ' class="active"' : ''}>+1</button>${exceptionalChoices}</div>${component.type === 'trit-input' ? '<br><span>−1 / 0 / +1 drive a known level; Z is floating and ? is an explicitly unknown external drive.</span>' : ''}</div>`;
    }
    if (component.type === 'word-input6') {
      const values = Array.isArray(component.state.values) ? component.state.values : [0, 0, 0, 0, 0, 0];
      const choices = [-1, 0, 1, 'Z', null];
      const labelFor = (value) => value === null ? '?' : value === 'Z' ? 'Z' : fmt(value);
      extra += `<div class="cost-note trit-value-editor"><strong>Word input · t5 … t0</strong><br><span>Each lane is an independent external drive.</span>${['t5', 't4', 't3', 't2', 't1', 't0'].map((name, index) => `<div class="word-input-choice"><span>${name}</span><div class="selection-actions trit-choice" role="group" aria-label="Set ${name} input value">${choices.map((value) => { const key = value === null ? 'unknown' : value; return `<button type="button" data-word-trit-index="${index}" data-word-trit-value="${key}"${trit(values[index]) === value ? ' class="active"' : ''}>${labelFor(value)}</button>`; }).join('')}</div></div>`).join('')}</div>`;
    }
    if (component.type === 'input-button3') {
      const released = trit(component.state.releasedValue), pressed = trit(component.state.pressedValue);
      const option = (value, selected) => `<option value="${value}"${selected === value ? ' selected' : ''}>${fmt(value)}</option>`;
      extra += `<details class="layout-editor input-button-editor" open><summary>Input button</summary><label class="editor-field">Mode<select id="buttonMode"><option value="momentary"${component.state.mode === 'momentary' ? ' selected' : ''}>Momentary</option><option value="toggle"${component.state.mode === 'toggle' ? ' selected' : ''}>Toggle</option><option value="pulse"${component.state.mode === 'pulse' ? ' selected' : ''}>Pulse</option></select></label><div class="field-grid"><label class="editor-field">Released<select id="buttonReleased">${[-1, 0, 1].map((value) => option(value, released)).join('')}</select></label><label class="editor-field">Pressed<select id="buttonPressed">${[-1, 0, 1].map((value) => option(value, pressed)).join('')}</select></label></div><label class="editor-field">Pulse duration (ms)<input id="buttonPulseMs" type="number" min="20" max="5000" step="10" value="${Math.max(20, Number(component.state.pulseMs) || 120)}" /></label><div class="selection-actions"><button id="applyInputButtonBtn" type="button">Apply button</button></div><span>Momentary drives Pressed while held. Toggle changes on each press. Pulse drives Pressed for the declared external duration.</span></details>`;
    }
    if (component.type === 'input-joystick3') {
      const currentX = trit(component.state.x), currentY = trit(component.state.y);
      extra += `<div class="cost-note joystick-editor"><strong>Ternary joystick</strong><br><span>x = ${fmt(currentX)} · y = ${fmt(currentY)}</span><div class="joystick-choice" role="group" aria-label="Set joystick position">${[1, 0, -1].map((y) => [-1, 0, 1].map((x) => `<button type="button" data-joystick-x="${x}" data-joystick-y="${y}"${currentX === x && currentY === y ? ' class="active"' : ''} aria-label="x ${fmt(x)}, y ${fmt(y)}">${x === 0 && y === 0 ? '●' : '•'}</button>`).join('')).join('')}</div><span>Top is y = +1; right is x = +1. Corners are diagonals.</span></div>`;
    }
    if (component.type === 'input-joystick6') {
      const x = Number(component.state.x), y = Number(component.state.y);
      const axisText = (value) => value === 'Z' ? 'Z' : value === null || value === undefined ? '?' : Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '?';
      extra += `<details class="layout-editor" open><summary>Analog 6-trit joystick</summary><span>Current external state: x = ${axisText(component.state.x)} · y = ${axisText(component.state.y)}</span><div class="field-grid"><label class="editor-field">X (−364 … +364)<input id="analogJoystickX" type="number" min="-364" max="364" step="1" value="${Number.isFinite(x) ? x : 0}" /></label><label class="editor-field">Y (−364 … +364)<input id="analogJoystickY" type="number" min="-364" max="364" step="1" value="${Number.isFinite(y) ? y : 0}" /></label></div><div class="selection-actions"><button id="applyAnalogJoystickBtn" type="button">Set position</button><button id="centerAnalogJoystickBtn" type="button">Center</button></div><span>Drag the pad on the block for analog input. The center 12% radius is a dead zone; X/Y are quantized to six balanced trits each.</span></details>`;
    }
    if (component.type === 'pixel-display3') {
      const pixels = Array.isArray(component.state.pixels) ? component.state.pixels.slice(0, 9).map(trit) : Array(9).fill(0);
      const glyph = (value) => value === null ? '?' : value === 'Z' ? 'Z' : value < 0 ? '−' : value > 0 ? '+' : '0';
      const classFor = (value) => value === null ? 'unknown' : value === 'Z' ? 'floating' : value < 0 ? 'negative' : value > 0 ? 'positive' : 'zero';
      const coordinates = [[-1, 1], [0, 1], [1, 1], [-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1], [1, -1]];
      const cells = pixels.map((value, index) => `<span class="pixel-frame-cell ${classFor(value)}" title="x=${coordinates[index][0]}, y=${coordinates[index][1]}: ${fmt(value)}">${glyph(value)}</span>`).join('');
      const diagnostic = component.state.invalidIo ? `<p class="pixel-frame-error">Invalid I/O: ${esc(component.state.invalidIo)}</p>` : '<p class="pixel-frame-ok">No current I/O error.</p>';
      extra += `<details class="layout-editor pixel-display-inspector" open><summary>Pixel frame &amp; I/O contract</summary><div class="pixel-frame-grid" role="img" aria-label="Current 3 by 3 ternary pixel frame; top row is y plus one">${cells}</div>${diagnostic}<p><strong>Coordinates:</strong> x: −1 / 0 / +1 = left / centre / right; y: +1 / 0 / −1 = top / centre / bottom.</p><p><strong>Clock:</strong> every known <code>0 → +1</code> edge stores <code>color</code> at the current address. <code>color=0</code> erases one pixel.</p><p><strong>Reset:</strong> <code>reset=+1</code> on that edge clears all nine pixels and has priority. <code>Z</code>, <code>?</code>, or unsupported controls never change the frame.</p></details>`;
    }
    if (component.type === 'sequence-generator') {
      const sequence = normalizeSequence(component.state.sequence);
      const sequenceText = sequence.map((v) => v > 0 ? '+1' : String(v)).join(', ');
      const preset = sequence.join(',') === '0,1' ? 'clock'
        : sequence.join(',') === '-1,0,1' && component.state.mode === 'loop' ? 'ternary-loop'
        : sequence.join(',') === '-1,0,1' && component.state.mode !== 'loop' ? 'ternary-pingpong'
        : 'custom';
      extra += `<details class="layout-editor generator-editor" open>
        <summary>Sequence generator</summary>
        <label class="editor-field">Preset<select id="generatorPreset">
          <option value="clock"${preset === 'clock' ? ' selected' : ''}>Clock: 0 ↔ +1</option>
          <option value="ternary-loop"${preset === 'ternary-loop' ? ' selected' : ''}>Ternary loop: -1 → 0 → +1 → -1</option>
          <option value="ternary-pingpong"${preset === 'ternary-pingpong' ? ' selected' : ''}>Ternary ping-pong: -1 ↔ 0 ↔ +1</option>
          <option value="custom"${preset === 'custom' ? ' selected' : ''}>Custom</option>
        </select></label>
        <label class="editor-field">Sequence<input id="generatorSequence" type="text" value="${esc(sequenceText)}" placeholder="-1, 0, +1" /></label>
        <label class="editor-field">Mode<select id="generatorMode"><option value="pingpong"${component.state.mode !== 'loop' ? ' selected' : ''}>Ping-pong</option><option value="loop"${component.state.mode === 'loop' ? ' selected' : ''}>Loop</option></select></label>
        <label class="editor-field">Interval (ms)<input id="generatorInterval" type="number" min="20" max="60000" step="10" value="${Math.max(20, Number(component.state.intervalMs) || 500)}" /></label>
        <label class="toggle-row compact"><input id="generatorAuto" type="checkbox"${component.state.auto ? ' checked' : ''} /><span>Auto-run</span></label>
        <div class="selection-actions"><button id="applyGeneratorBtn" type="button">Apply generator</button><button id="advanceGeneratorBtn" type="button">Advance once</button></div>
      </details>`;
    }
    if (component.type === 'memory27x6' || component.type === 'memory729x6') {
      const words = Array.isArray(component.state.values) ? component.state.values : [];
      const offset = component.type === 'memory729x6' ? 364 : 13;
      const cpu = current.kind === 'root' ? [...rootCircuit.components.values()].find((candidate) => candidate.type === 'cpu6') : null;
      const pcWord = Array.isArray(cpu?.state.pc) ? cpu.state.pc.map(trit) : [];
      const pcAddress = pcWord.length === 6 && pcWord.every((value) => value === -1 || value === 0 || value === 1) ? pcWord.reduce((total, value) => total * 3 + value, 0) : null;
      const phase = trit(cpu?.state.phase);
      const glyph = (value) => value === null || value === undefined ? '?' : value === 'Z' ? 'Z' : trit(value) < 0 ? '−' : trit(value) > 0 ? '+' : '0';
      const indices = component.type === 'memory729x6'
        ? [...new Set([...words.map((word, index) => Array.isArray(word) && word.some((value) => value !== null && value !== undefined) ? index : null).filter((index) => index !== null), ...(pcAddress !== null ? [pcAddress + offset] : [])])].filter((index) => index >= 0 && index < 729).sort((a, b) => a - b)
        : Array.from({ length: 27 }, (_, index) => index);
      const rows = indices.map((index) => {
        const word = Array.isArray(words[index]) ? words[index].map(trit) : Array(6).fill(null);
        const known = word.every((value) => value === -1 || value === 0 || value === 1);
        const decoded = known ? window.TernaryCore.decodeInstruction6(word) : null;
        const mnemonic = decoded?.valid ? decoded.mnemonic : known ? 'data / reserved' : 'unwritten';
        const address = index - offset;
        return `<tr${address === pcAddress ? ' class="program-current"' : ''}><td>${address === pcAddress ? '▶ ' : ''}${address}</td><td><code>${word.map(glyph).join(' ')}</code></td><td>${esc(mnemonic)}</td></tr>`;
      }).join('');
      const phaseText = phase === 0 ? 'fetch' : phase === 1 ? 'execute' : phase === -1 ? 'halted' : '?';
      extra += `<details class="layout-editor" open><summary>Memory program / data list</summary><p><strong>PC:</strong> ${pcAddress ?? '?'} · <strong>phase:</strong> ${phaseText}. The ▶ row is the current fetch address.</p><p>Rows are public ${component.type === 'memory729x6' ? 'Memory 729×6' : 'Memory 27×6'} locations. Mnemonics are a live decode view; a row can also be ordinary data.</p><table class="component-test-table"><thead><tr><th>Address</th><th>Tryte</th><th>Decode</th></tr></thead><tbody>${rows}</tbody></table></details>`;
    }

    const logicalCost = def.cost?.logical || {};
    extra += structuralImplementationPanel(def);
    extra += `<div class="cost-note"><strong>Structural metadata</strong><br>Logical: ${Number(logicalCost.nodes) || 0} node unit · ${Number(logicalCost.depth) || 0} depth unit</div>`;

    extra += `<details class="layout-editor">
      <summary>Layout</summary>
      <div class="field-grid"><label class="editor-field">X<input id="layoutX" type="number" step="20" value="${Math.round(component.x)}" /></label><label class="editor-field">Y<input id="layoutY" type="number" step="20" value="${Math.round(component.y)}" /></label></div>
      <label class="editor-field">Width<input id="layoutWidth" type="number" min="120" max="320" step="10" value="${width}" /></label>
      <label class="editor-field">Port spacing<input id="layoutSpacing" type="number" min="18" max="60" step="2" value="${portSpacing}" /></label>
      <label class="editor-field">Inputs<select id="layoutInputSide"><option value="left"${inputSide === 'left' ? ' selected' : ''}>Left</option><option value="right"${inputSide === 'right' ? ' selected' : ''}>Right</option></select></label>
      <label class="editor-field">Outputs<select id="layoutOutputSide"><option value="right"${outputSide === 'right' ? ' selected' : ''}>Right</option><option value="left"${outputSide === 'left' ? ' selected' : ''}>Left</option></select></label>
      <div class="selection-actions"><button id="applyLayoutBtn" type="button">Apply layout</button></div>
    </details>`;

    if (def.custom) {
      const experiment = customComponents.get(def.customId)?.experiment;
      if (experiment) {
        const primitives = Object.entries(experiment.primitiveCounts || {}).map(([type, count]) => `${registry.get(type)?.label || type} ×${count}`).join(', ');
        const metrics = experiment.metrics;
        const metricLine = metrics ? `<br><strong>Structural comparison</strong><br>${metrics.nodes} nodes · depth ${metrics.depth} · ${metrics.wires} wires · ${metrics.transitions} transitions (${esc(metrics.transitionScenario || 'canonical scenario')})` : '';
        const verification = experiment.equivalence?.lastRun;
        const comparison = verification?.comparison;
        const comparisonLine = comparison ? `<br><strong>Native ↔ structural</strong><br>nodes ${comparison.native.nodes} ↔ ${comparison.structural.nodes} · depth ${comparison.native.depth} ↔ ${comparison.structural.depth}<br>wires ${comparison.native.wires} ↔ ${comparison.structural.wires} · transitions ${comparison.native.transitions} ↔ ${comparison.structural.transitions}<br>execution ${comparison.native.executionCost} ↔ ${comparison.structural.executionCost} evaluations` : '';
        const verificationLine = verification ? `<br><strong>Equivalence run</strong><br>${verification.vectors.passed}/${verification.vectors.total} vectors · ${verification.sequences.passed}/${verification.sequences.total} sequences${comparisonLine}${verification.failures.length ? `<br><span class="error">Regression: ${esc(verification.failures[0])}</span>` : ''}` : '';
        extra += `<div class="cost-note"><strong>Experiment details</strong><br>${esc(experiment.role || 'candidate')} · ${experiment.nodeCount} primitive nodes · critical depth ${experiment.depth}${metricLine}<br>Primitive set: ${esc(primitives)}<br>${esc(experiment.rationale)}<br>${experiment.setName ? `<br>Experiment set: ${esc(experiment.setName)}` : ''}<br>Validation: ${esc(experiment.validation || 'not recorded')}${verificationLine}</div>`;
      }
      extra += `<div class="selection-actions"><button id="openComponentBtn" class="primary-action" type="button">Open internals</button></div>`;
    }
    extra += `<div class="selection-actions"><button id="inspectorDeleteBtn" type="button">Delete block</button></div>`;

    inspectorEl.innerHTML = `<dl>
      <dt>ID</dt><dd>${component.id}</dd><dt>Type</dt><dd>${def.label}</dd>
      <dt>Inputs</dt><dd>${inputText}</dd><dt>Outputs</dt><dd>${outputText}</dd>
      <dt>Position</dt><dd>${Math.round(component.x)}, ${Math.round(component.y)}</dd>
    </dl>${extra}`;

    $('renameComponentBtn').addEventListener('click', () => {
      beginHistory('Rename component');
      circuit().setState(component.id, { label: $('componentLabel').value.trim() });
      commitHistory('Rename component');
      renderer.rebuild();
      renderer.selectComponent(component.id);
      setStatus('Component renamed.');
    });

    if (['trit-input', 'ternary-reference'].includes(component.type)) {
      inspectorEl.querySelectorAll('[data-trit-value]').forEach((button) => button.addEventListener('click', () => {
        const rawValue = button.dataset.tritValue;
        const value = rawValue === 'Z' ? 'Z' : rawValue === 'unknown' ? null : Number(rawValue);
        if (trit(component.state.value) === value) return;
        beginHistory('Set trit input');
        circuit().setState(component.id, { value });
        commitHistory('Set trit input');
        renderer.rebuild();
        renderer.selectComponent(component.id);
        setStatus(`Trit input set to ${fmt(value)}.`);
      }));
    }
    if (component.type === 'word-input6') {
      inspectorEl.querySelectorAll('[data-word-trit-index]').forEach((button) => button.addEventListener('click', () => {
        const index = Number(button.dataset.wordTritIndex);
        const rawValue = button.dataset.wordTritValue;
        const value = rawValue === 'Z' ? 'Z' : rawValue === 'unknown' ? null : Number(rawValue);
        const values = Array.isArray(component.state.values) ? [...component.state.values] : [0, 0, 0, 0, 0, 0];
        if (trit(values[index]) === value) return;
        values[index] = value;
        beginHistory('Set word input trit');
        circuit().setState(component.id, { values });
        commitHistory('Set word input trit');
        renderer.rebuild();
        renderer.selectComponent(component.id);
        setStatus(`Word input ${['t5', 't4', 't3', 't2', 't1', 't0'][index]} set to ${fmt(value)}.`);
      }));
    }
    if (component.type === 'input-button3') {
      $('applyInputButtonBtn').addEventListener('click', () => {
        const releasedValue = Number($('buttonReleased').value), pressedValue = Number($('buttonPressed').value);
        if (releasedValue === pressedValue) return setStatus('A button needs two distinct released and pressed levels.', true);
        beginHistory('Configure input button');
        circuit().setState(component.id, { mode: $('buttonMode').value, releasedValue, pressedValue, pulseMs: Math.max(20, Math.min(5000, Number($('buttonPulseMs').value) || 120)), pressed: false });
        commitHistory('Configure input button');
        renderer.rebuild(); renderer.selectComponent(component.id);
        setStatus(`Input button configured: ${fmt(releasedValue)} released, ${fmt(pressedValue)} pressed.`);
      });
    }
    if (component.type === 'input-joystick3') {
      inspectorEl.querySelectorAll('[data-joystick-x]').forEach((button) => button.addEventListener('click', () => {
        const x = Number(button.dataset.joystickX), y = Number(button.dataset.joystickY);
        if (trit(component.state.x) === x && trit(component.state.y) === y) return;
        beginHistory('Set joystick position'); circuit().setState(component.id, { x, y }); commitHistory('Set joystick position');
        renderer.rebuild(); renderer.selectComponent(component.id); setStatus(`Joystick set to x=${fmt(x)}, y=${fmt(y)}.`);
      }));
    }
    if (component.type === 'input-joystick6') {
      const setPosition = (x, y, name) => {
        beginHistory(name); circuit().setState(component.id, { x: Math.max(-364, Math.min(364, Math.round(x))), y: Math.max(-364, Math.min(364, Math.round(y))) }); commitHistory(name);
        renderer.rebuild(); renderer.selectComponent(component.id); setStatus(`Analog joystick set to x=${Math.max(-364, Math.min(364, Math.round(x)))}, y=${Math.max(-364, Math.min(364, Math.round(y)))}.`);
      };
      $('applyAnalogJoystickBtn').addEventListener('click', () => setPosition(Number($('analogJoystickX').value), Number($('analogJoystickY').value), 'Set analog joystick position'));
      $('centerAnalogJoystickBtn').addEventListener('click', () => setPosition(0, 0, 'Center analog joystick'));
    }
    if (component.type === 'sequence-generator') {
      const applyPreset = () => {
        const preset = $('generatorPreset').value;
        if (preset === 'clock') { $('generatorSequence').value = '0, +1'; $('generatorMode').value = 'pingpong'; }
        else if (preset === 'ternary-loop') { $('generatorSequence').value = '-1, 0, +1'; $('generatorMode').value = 'loop'; }
        else if (preset === 'ternary-pingpong') { $('generatorSequence').value = '-1, 0, +1'; $('generatorMode').value = 'pingpong'; }
      };
      $('generatorPreset').addEventListener('change', applyPreset);
      $('applyGeneratorBtn').addEventListener('click', () => {
        const sequence = normalizeSequence($('generatorSequence').value);
        const intervalMs = Math.max(20, Math.min(60000, Number($('generatorInterval').value) || 500));
        const mode = $('generatorMode').value === 'loop' ? 'loop' : 'pingpong';
        beginHistory('Configure sequence generator');
        circuit().setState(component.id, {
          sequence, mode, intervalMs, auto: $('generatorAuto').checked,
          index: 0, direction: 1, value: sequence[0],
        });
        circuit().resetSequenceTiming(component.id);
        commitHistory('Configure sequence generator');
        renderer.rebuild();
        renderer.selectComponent(component.id);
        setStatus(`Sequence generator set to [${sequence.map(fmt).join(', ')}], ${mode}, ${intervalMs} ms.`);
      });
      $('advanceGeneratorBtn').addEventListener('click', () => {
        beginHistory('Advance sequence generator');
        circuit().advanceSequenceGenerator(component, 'manual generator step');
        commitHistory('Advance sequence generator');
        renderer.rebuild();
        renderer.selectComponent(component.id);
        renderQueueInspector();
        setStatus('Sequence generator advanced one step.');
      });
    }

    $('applyLayoutBtn').addEventListener('click', () => {
      const nextLayout = {
        width: Math.max(120, Math.min(320, Number($('layoutWidth').value) || defaultWidth)),
        portSpacing: Math.max(18, Math.min(60, Number($('layoutSpacing').value) || 24)),
        inputSide: $('layoutInputSide').value === 'right' ? 'right' : 'left',
        outputSide: $('layoutOutputSide').value === 'left' ? 'left' : 'right',
      };
      beginHistory('Change component layout');
      circuit().moveComponent(component.id, Number($('layoutX').value) || 0, Number($('layoutY').value) || 0);
      circuit().setState(component.id, { layout: nextLayout });
      commitHistory('Change component layout');
      renderer.rebuild();
      renderer.selectComponent(component.id);
      setStatus('Component layout updated.');
    });

    $('inspectorDeleteBtn').addEventListener('click', () => renderer.deleteSelection());
    if (def.custom) $('openComponentBtn').addEventListener('click', () => openCustomComponent(def.type));
    if (def.implementation?.structuralImplementation) $('openStructuralImplementationBtn').addEventListener('click', () => openStructuralImplementation(def.implementation.structuralImplementation));
    if (def.boundary === 'input' || def.boundary === 'output') $('renameBoundaryBtn').addEventListener('click', () => {
      const requestedName = $('boundaryName').value.trim();
      if (!requestedName) return setStatus('Port name cannot be empty.', true);
      const name = uniqueBoundaryName(component.type, requestedName, component.id);
      beginHistory('Rename component port');
      circuit().setState(component.id, { name });
      commitHistory('Rename component port');
      updateInspector({ ...selection, item: circuit().components.get(component.id) });
      renderComponentTestPanel();
      setStatus(`Port renamed to ${name}.${name !== requestedName ? ' A unique name was assigned.' : ''} Save/back will update the reusable component interface.`);
    });
  }

  function addLibraryButton(container, type, title, subtitle, custom = false, candidate = false) {
    const button = document.createElement('button');
    button.className = `component-button${custom ? ' custom' : ''}`;
    button.type = 'button';
    button.dataset.type = type;
    button.innerHTML = `<strong>${title}${candidate ? '<em class="candidate-badge">CANDIDATE</em>' : ''}</strong><span>${subtitle}</span>`;
    button.addEventListener('click', () => {
      const initialState = uniqueBoundaryState(type);
      const component = renderer.addAtViewportCenter(type, initialState || undefined);
      updateStats();
      setStatus(`Added ${registry.get(type).label}${initialState ? ` “${component.state.name}”` : ''}.`);
      renderer.app.canvas.focus();
    });
    container.appendChild(button);
  }

  function uniqueBoundaryName(type, preferred, excludeId = null) {
    const fallback = type === 'component-input' ? 'in' : 'out';
    const names = [...circuit().components.values()]
      .filter((component) => component.type === type && component.id !== excludeId)
      .map((component) => component.state?.name);
    return uniqueName(preferred, names, fallback);
  }

  function uniqueBoundaryState(type) {
    if (current.kind !== 'custom' || !['component-input', 'component-output'].includes(type)) return null;
    const fallback = type === 'component-input' ? 'in' : 'out';
    return { name: uniqueBoundaryName(type, fallback) };
  }

  function componentTestBoundaries() {
    if (current.kind !== 'custom') return { inputs: [], outputs: [] };
    try { return boundaryPorts(circuit().serialize()); }
    catch (_) { return { inputs: [], outputs: [] }; }
  }

  function componentTestSuite() {
    if (current.kind !== 'custom') return null;
    let suite = testSuites.find((entry) => entry.componentId === current.customId);
    if (!suite) {
      suite = { componentId: current.customId, cases: [] };
      testSuites.push(suite);
    }
    if (!Array.isArray(suite.cases)) suite.cases = [];
    return suite;
  }

  function uniqueName(preferred, existingNames, fallback = 'Untitled') {
    const base = String(preferred || '').trim().replace(/\s+/g, ' ').slice(0, 80) || fallback;
    const names = new Set(existingNames.map((name) => String(name || '').trim().toLocaleLowerCase()));
    if (!names.has(base.toLocaleLowerCase())) return base;
    let suffix = 2;
    while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
    return `${base} ${suffix}`;
  }

  function testPortValues(boundaries) {
    return {
      inputs: Object.fromEntries(boundaries.inputs.map((port) => [port.componentId, trit(circuit().components.get(port.componentId)?.state?.value)])),
      outputs: Object.fromEntries(boundaries.outputs.map((port) => [port.componentId, trit(circuit().components.get(port.componentId)?.state?.value)])),
    };
  }

  function evaluateComponentTest(inputs, boundaries) {
    const isolated = new Circuit(registry);
    isolated.load(circuit().serialize());
    for (const input of boundaries.inputs) {
      if (!(input.componentId in inputs)) throw new Error(`Test input “${input.name}” no longer exists.`);
      isolated.setState(input.componentId, { value: trit(inputs[input.componentId]) });
    }
    isolated.simulate();
    return Object.fromEntries(boundaries.outputs.map((output) => [
      output.componentId,
      trit(isolated.components.get(output.componentId)?.state?.value),
    ]));
  }

  function evaluateComponentType(type, valuesByName) {
    const definition = registry.get(type);
    const isolated = new Circuit(registry);
    const inputs = new Map();
    for (const name of definition.inputs) {
      const input = isolated.addComponent('trit-input', -160, 0, { value: trit(valuesByName[name]) });
      inputs.set(name, input);
    }
    const target = isolated.addComponent(type, 0, 0);
    for (const [name, input] of inputs) isolated.connect(input.id, 'out', target.id, name);
    isolated.simulate();
    return Object.fromEntries(definition.outputs.map((name) => [name, trit(target.outputs[name])]));
  }

  function evaluateComponentSequence(type, steps) {
    const definition = registry.get(type);
    const isolated = new Circuit(registry);
    const inputs = new Map();
    for (const name of definition.inputs) inputs.set(name, isolated.addComponent('trit-input', -160, 0, { value: 0 }));
    const target = isolated.addComponent(type, 0, 0);
    for (const [name, input] of inputs) isolated.connect(input.id, 'out', target.id, name);
    return steps.map((step) => {
      for (const [name, input] of inputs) {
        if (!(name in step.inputs)) throw new Error(`sequence step is missing input “${name}”`);
        isolated.setState(input.id, { value: trit(step.inputs[name]) });
      }
      isolated.simulate();
      return Object.fromEntries(definition.outputs.map((name) => [name, trit(target.outputs[name])]));
    });
  }

  function measureComponentExecution(type, steps) {
    const definition = registry.get(type);
    const isolated = new Circuit(registry);
    const inputs = new Map();
    for (const name of definition.inputs) inputs.set(name, isolated.addComponent('trit-input', -160, 0, { value: 0 }));
    const target = isolated.addComponent(type, 0, 0);
    for (const [name, input] of inputs) isolated.connect(input.id, 'out', target.id, name);
    let evaluations = 0;
    let signalChanges = 0;
    for (const step of steps) {
      for (const [name, input] of inputs) isolated.setState(input.id, { value: trit(step.inputs[name]) });
      isolated.simulate();
      const cost = target.state.executionCost || { evaluations: 1, signalChanges: 0 };
      evaluations += Number(cost.evaluations) || 1;
      signalChanges += Number(cost.signalChanges) || 0;
    }
    return { evaluations, signalChanges };
  }

  function verifyStructuralReference(meta) {
    const equivalence = meta?.experiment?.equivalence;
    if (!equivalence?.directType) return null;
    const boundary = boundaryPorts(meta.circuit);
    const inputById = new Map(boundary.inputs.map((port) => [port.componentId, port.name]));
    const outputNames = boundary.outputs.map((port) => port.name);
    const cases = testSuites.find((entry) => entry.componentId === meta.id)?.cases || [];
    let vectorsPassed = 0;
    let sequencesPassed = 0;
    const execution = { structural: { evaluations: 0, signalChanges: 0 }, direct: { evaluations: 0, signalChanges: 0 } };
    const failures = [];
    for (const testCase of cases) {
      try {
        const values = {};
        for (const [id, name] of inputById) values[name] = trit(testCase.inputs?.[id]);
        const structural = evaluateComponentType(meta.type, values);
        const direct = evaluateComponentType(equivalence.directType, values);
        const step = { inputs: values };
        const structuralCost = measureComponentExecution(meta.type, [step]);
        const directCost = measureComponentExecution(equivalence.directType, [step]);
        execution.structural.evaluations += structuralCost.evaluations; execution.structural.signalChanges += structuralCost.signalChanges;
        execution.direct.evaluations += directCost.evaluations; execution.direct.signalChanges += directCost.signalChanges;
        const mismatch = outputNames.find((name) => structural[name] !== direct[name]);
        if (mismatch) failures.push(`${testCase.name || 'vector'}: ${mismatch} structural ${fmt(structural[mismatch])}, direct ${fmt(direct[mismatch])}`);
        else vectorsPassed += 1;
      } catch (error) { failures.push(`${testCase.name || 'vector'}: ${error.message}`); }
    }
    for (const sequence of equivalence.sequences || []) {
      try {
        const structural = evaluateComponentSequence(meta.type, sequence.steps);
        const direct = evaluateComponentSequence(equivalence.directType, sequence.steps);
        const structuralCost = measureComponentExecution(meta.type, sequence.steps);
        const directCost = measureComponentExecution(equivalence.directType, sequence.steps);
        execution.structural.evaluations += structuralCost.evaluations; execution.structural.signalChanges += structuralCost.signalChanges;
        execution.direct.evaluations += directCost.evaluations; execution.direct.signalChanges += directCost.signalChanges;
        const index = structural.findIndex((outputs, step) => outputNames.some((name) => outputs[name] !== direct[step][name]));
        if (index >= 0) failures.push(`${sequence.name || 'sequence'}: regression at step ${index + 1}`);
        else sequencesPassed += 1;
      } catch (error) { failures.push(`${sequence.name || 'sequence'}: ${error.message}`); }
    }
    const structuralMetrics = meta.experiment.metrics || { nodes: meta.experiment.nodeCount, depth: meta.experiment.depth, wires: (meta.circuit.wires || []).length, transitions: 0, transitionScenario: 'equivalence suite' };
    structuralMetrics.transitions = execution.structural.signalChanges;
    structuralMetrics.executionCost = execution.structural.evaluations;
    meta.experiment.metrics = structuralMetrics;
    equivalence.lastRun = {
      vectors: { passed: vectorsPassed, total: cases.length }, sequences: { passed: sequencesPassed, total: (equivalence.sequences || []).length }, execution, failures,
      comparison: {
        native: { nodes: registry.get(equivalence.directType).cost?.logical?.nodes || 1, depth: registry.get(equivalence.directType).cost?.logical?.depth || 1, wires: registry.get(equivalence.directType).inputs.length + registry.get(equivalence.directType).outputs.length, transitions: execution.direct.signalChanges, executionCost: execution.direct.evaluations },
        structural: { nodes: structuralMetrics.nodes, depth: structuralMetrics.depth, wires: structuralMetrics.wires, transitions: structuralMetrics.transitions, executionCost: structuralMetrics.executionCost },
      },
    };
    return equivalence.lastRun;
  }

  function runDirectEquivalenceTests(meta) {
    const directType = meta?.experiment?.equivalence?.directType;
    if (!directType) return;
    const structuralBoundary = boundaryPorts(meta.circuit);
    const suite = testSuites.find((entry) => entry.componentId === meta.id) || { cases: [] };
    const inputById = new Map(structuralBoundary.inputs.map((port) => [port.componentId, port.name]));
    const outputById = new Map(structuralBoundary.outputs.map((port) => [port.componentId, port.name]));
    const list = document.createElement('div');
    list.className = 'component-test-run-list';
    let failures = 0;
    for (const testCase of suite.cases) {
      const row = document.createElement('div');
      row.className = 'component-test-run';
      try {
        const values = {};
        for (const [id, name] of inputById) {
          if (!(id in (testCase.inputs || {}))) throw new Error('saved case is missing input ' + name);
          values[name] = trit(testCase.inputs[id]);
        }
        const structural = evaluateComponentType(meta.type, values);
        const direct = evaluateComponentType(directType, values);
        const mismatches = [...outputById.values()].filter((name) => structural[name] !== direct[name]);
        if (mismatches.length) {
          failures += 1; row.classList.add('failed');
          row.textContent = (testCase.name || 'Unnamed case') + ' — mismatch: ' + mismatches.map((name) => name + ' structural ' + fmt(structural[name]) + ', direct ' + fmt(direct[name])).join('; ');
        } else {
          row.classList.add('passed'); row.textContent = (testCase.name || 'Unnamed case') + ' — equivalent';
        }
      } catch (error) {
        failures += 1; row.classList.add('failed'); row.textContent = (testCase.name || 'Unnamed case') + ' — could not compare: ' + error.message;
      }
      list.appendChild(row);
    }
    renderTestResults('Direct equivalence: ' + (suite.cases.length - failures) + '/' + suite.cases.length + ' passed', list, failures ? 'has-failures' : 'all-passed');
    setStatus(failures ? failures + ' component regression' + (failures === 1 ? '' : 's') + ' failed during direct equivalence.' : 'Structural and direct implementations are equivalent for all ' + suite.cases.length + ' saved cases.', Boolean(failures));
  }

  function runSequenceEquivalenceTests(meta) {
    const directType = meta?.experiment?.equivalence?.directType;
    const sequences = meta?.experiment?.equivalence?.sequences || [];
    if (!directType || !sequences.length) return;
    const outputNames = boundaryPorts(meta.circuit).outputs.map((port) => port.name);
    const list = document.createElement('div');
    list.className = 'component-test-run-list';
    let failures = 0;
    for (const sequence of sequences) {
      const row = document.createElement('div');
      row.className = 'component-test-run';
      try {
        const structural = evaluateComponentSequence(meta.type, sequence.steps);
        const direct = evaluateComponentSequence(directType, sequence.steps);
        const mismatch = structural.findIndex((outputs, index) => outputNames.some((name) => outputs[name] !== direct[index][name]));
        if (mismatch >= 0) {
          failures += 1; row.classList.add('failed');
          const names = outputNames.filter((name) => structural[mismatch][name] !== direct[mismatch][name]);
          row.textContent = `${sequence.name || 'Unnamed sequence'} — regression at step ${mismatch + 1}: ${names.map((name) => `${name} structural ${fmt(structural[mismatch][name])}, direct ${fmt(direct[mismatch][name])}`).join('; ')}`;
        } else {
          row.classList.add('passed'); row.textContent = `${sequence.name || 'Unnamed sequence'} — equivalent (${sequence.steps.length} steps)`;
        }
      } catch (error) {
        failures += 1; row.classList.add('failed'); row.textContent = `${sequence.name || 'Unnamed sequence'} — could not compare: ${error.message}`;
      }
      list.appendChild(row);
    }
    renderTestResults(`Sequence equivalence: ${sequences.length - failures}/${sequences.length} passed`, list, failures ? 'has-failures' : 'all-passed');
    setStatus(failures ? `${failures} sequence-equivalence regression${failures === 1 ? '' : 's'} failed.` : `Structural and direct sequences are equivalent for all ${sequences.length} saved sequences.`, Boolean(failures));
  }

  function renderTestResults(title, content, modifier = '') {
    const result = document.createElement('div');
    result.className = `component-test-results ${modifier}`.trim();
    const heading = document.createElement('h3');
    heading.textContent = title;
    result.appendChild(heading);
    result.appendChild(content);
    const previous = componentTestPanel.querySelector('.component-test-results');
    if (previous) previous.replaceWith(result);
    else componentTestPanel.appendChild(result);
  }

  function renderSavedTestCases(boundaries) {
    const suite = componentTestSuite();
    const group = document.createElement('div');
    group.className = 'component-test-group component-test-cases';
    group.innerHTML = '<h3>Saved cases</h3>';

    const controls = document.createElement('div');
    controls.className = 'component-test-actions';
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    name.placeholder = `Case ${(suite?.cases.length || 0) + 1}`;
    name.setAttribute('aria-label', 'Test case name');
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save current';
    save.addEventListener('click', () => {
      const activeSuite = componentTestSuite();
      const values = testPortValues(boundaries);
      const label = uniqueName(name.value, activeSuite.cases.map((testCase) => testCase.name), 'Case');
      const expectedOutputs = Object.fromEntries(boundaries.outputs.map((port) => [port.componentId, trit(componentTestDraftExpected[port.componentId] ?? values.outputs[port.componentId])]));
      activeSuite.cases.push({ id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: label, inputs: values.inputs, expectedOutputs });
      autosaveIfChanged();
      renderComponentTestPanel();
      setStatus(`Saved test case “${label}”.`);
    });
    const runSaved = document.createElement('button');
    runSaved.type = 'button';
    runSaved.textContent = 'Run saved';
    runSaved.disabled = !suite?.cases.length;
    runSaved.addEventListener('click', () => runSavedComponentTests(boundaries));
    const exhaustive = document.createElement('button');
    exhaustive.type = 'button';
    exhaustive.textContent = 'Run all combinations';
    exhaustive.disabled = boundaries.inputs.length > 6;
    exhaustive.title = boundaries.inputs.length > 6 ? 'Exhaustive runs are limited to six inputs (729 combinations).' : '';
    exhaustive.addEventListener('click', () => runExhaustiveTruthTable(boundaries));
    const meta = customComponents.get(current.customId);
    const directType = meta?.experiment?.equivalence?.directType;
    controls.append(name, save, runSaved, exhaustive);
    if (directType) {
      const compare = document.createElement('button');
      compare.type = 'button'; compare.textContent = 'Compare direct'; compare.disabled = !suite?.cases.length;
      compare.title = 'Run the saved cases against this structural component and ' + (registry.get(directType)?.label || directType) + '.';
      compare.addEventListener('click', () => runDirectEquivalenceTests(meta));
      controls.append(compare);
      if (meta?.experiment?.equivalence?.sequences?.length) {
        const compareSequences = document.createElement('button');
        compareSequences.type = 'button'; compareSequences.textContent = 'Compare sequences';
        compareSequences.title = 'Run saved state/clock sequences against this structural component and its direct reference.';
        compareSequences.addEventListener('click', () => runSequenceEquivalenceTests(meta));
        controls.append(compareSequences);
      }
    }
    group.appendChild(controls);

    if (!suite?.cases.length) {
      const empty = document.createElement('div');
      empty.className = 'component-test-empty';
      empty.textContent = 'Save the current inputs and outputs as a named expected-result case.';
      group.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'component-test-case-list';
      for (const testCase of suite.cases) {
        const row = document.createElement('div');
        row.className = 'component-test-case';
        const summary = document.createElement('span');
        summary.textContent = testCase.name || 'Unnamed case';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'case-remove';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          suite.cases = suite.cases.filter((entry) => entry.id !== testCase.id);
          autosaveIfChanged();
          renderComponentTestPanel();
          setStatus(`Removed test case “${testCase.name || 'Unnamed case'}”.`);
        });
        row.append(summary, remove);
        list.appendChild(row);
      }
      group.appendChild(list);
    }
    componentTestPanel.appendChild(group);
  }

  function runSavedComponentTests(boundaries) {
    const suite = componentTestSuite();
    const list = document.createElement('div');
    list.className = 'component-test-run-list';
    let failures = 0;
    for (const testCase of suite.cases) {
      const row = document.createElement('div');
      row.className = 'component-test-run';
      try {
        const currentInputIds = new Set(boundaries.inputs.map((port) => port.componentId));
        const currentOutputIds = new Set(boundaries.outputs.map((port) => port.componentId));
        const staleInputs = Object.keys(testCase.inputs || {}).filter((id) => !currentInputIds.has(id));
        const staleOutputs = Object.keys(testCase.expectedOutputs || {}).filter((id) => !currentOutputIds.has(id));
        if (staleInputs.length || staleOutputs.length) {
          throw new Error(`port contract changed (${staleInputs.length} removed input${staleInputs.length === 1 ? '' : 's'}, ${staleOutputs.length} removed output${staleOutputs.length === 1 ? '' : 's'})`);
        }
        const actual = evaluateComponentTest(testCase.inputs || {}, boundaries);
        const mismatches = boundaries.outputs.filter((port) => !(port.componentId in (testCase.expectedOutputs || {})) || actual[port.componentId] !== Number(testCase.expectedOutputs[port.componentId]));
        if (mismatches.length) {
          failures += 1;
          row.classList.add('failed');
          row.textContent = `${testCase.name || 'Unnamed case'} — failed: ${mismatches.map((port) => {
            const expected = testCase.expectedOutputs?.[port.componentId];
            return `${port.name} expected ${expected === undefined ? 'not recorded' : fmt(expected)}, got ${fmt(actual[port.componentId])}`;
          }).join('; ')}`;
        } else {
          row.classList.add('passed');
          row.textContent = `${testCase.name || 'Unnamed case'} — passed`;
        }
      } catch (error) {
        failures += 1;
        row.classList.add('failed');
        row.textContent = `${testCase.name || 'Unnamed case'} — incompatible or could not run: ${error.message}`;
      }
      list.appendChild(row);
    }
    renderTestResults(`Saved cases: ${suite.cases.length - failures}/${suite.cases.length} passed`, list, failures ? 'has-failures' : 'all-passed');
    setStatus(failures ? `${failures} saved test case${failures === 1 ? '' : 's'} failed.` : `All ${suite.cases.length} saved test cases passed.`, Boolean(failures));
  }

  function runExhaustiveTruthTable(boundaries) {
    const combinations = 3 ** boundaries.inputs.length;
    if (boundaries.inputs.length > 6) return setStatus('Exhaustive tests are limited to six inputs (729 combinations).', true);
    const table = document.createElement('table');
    table.className = 'truth-table';
    const head = document.createElement('thead');
    const headingRow = document.createElement('tr');
    for (const port of [...boundaries.inputs, ...boundaries.outputs]) {
      const cell = document.createElement('th');
      cell.textContent = port.name;
      headingRow.appendChild(cell);
    }
    head.appendChild(headingRow);
    table.appendChild(head);
    const body = document.createElement('tbody');
    for (let index = 0; index < combinations; index += 1) {
      let remaining = index;
      const inputs = {};
      for (const input of boundaries.inputs) {
        inputs[input.componentId] = [-1, 0, 1][remaining % 3];
        remaining = Math.floor(remaining / 3);
      }
      const outputs = evaluateComponentTest(inputs, boundaries);
      const row = document.createElement('tr');
      for (const input of boundaries.inputs) {
        const cell = document.createElement('td');
        cell.textContent = fmt(inputs[input.componentId]);
        row.appendChild(cell);
      }
      for (const output of boundaries.outputs) {
        const cell = document.createElement('td');
        cell.textContent = fmt(outputs[output.componentId]);
        row.appendChild(cell);
      }
      body.appendChild(row);
    }
    table.appendChild(body);
    renderTestResults(`Truth table — ${combinations} combination${combinations === 1 ? '' : 's'}`, table);
    setStatus(`Ran all ${combinations} ternary input combinations.`);
  }

  function setComponentTestInput(componentId, value) {
    if (current.kind !== 'custom') return;
    const component = circuit().components.get(componentId);
    if (!component || component.type !== 'component-input') return;
    beginHistory('Change component test input');
    try { circuit().setState(componentId, { value }); }
    catch (error) { setStatus(error.message, true); }
    commitHistory('Change component test input');
    refreshComponentTestPanel();
    updateStats();
    setStatus(`Test input ${component.state.name || 'in'} = ${fmt(value)}.`);
  }

  function createComponentTestGroup(title, count, open = false) {
    const group = document.createElement('details');
    group.className = 'component-test-group component-test-fold';
    group.open = open;
    const summary = document.createElement('summary');
    summary.textContent = `${title} (${count})`;
    const content = document.createElement('div');
    content.className = 'component-test-fold-content';
    group.append(summary, content);
    return { group, content };
  }

  function renderComponentTestPanel() {
    componentTestSection.hidden = current.kind !== 'custom';
    componentTestPanel.innerHTML = '';
    if (current.kind !== 'custom') return;
    const heading = componentTestSection.querySelector('h2');
    if (heading) heading.textContent = `Component test — ${current.label}`;
    if (componentTestDraftComponentId !== current.customId) {
      componentTestDraftComponentId = current.customId;
      componentTestDraftExpected = {};
    }

    const boundaries = componentTestBoundaries();
    if (!boundaries.inputs.length && !boundaries.outputs.length) {
      componentTestPanel.innerHTML = '<div class="component-test-empty">Add Component Input/Output blocks to define the interface.</div>';
      return;
    }

    if (boundaries.inputs.length) {
      const { group, content } = createComponentTestGroup('Inputs', boundaries.inputs.length, true);
      for (const input of boundaries.inputs) {
        const row = document.createElement('div');
        row.className = 'component-test-row';
        const component = circuit().components.get(input.componentId);
        const value = trit(component?.state?.value);
        row.innerHTML = `<span class="component-test-name">${input.name}</span><span class="trit-choice"></span>`;
        const choices = row.querySelector('.trit-choice');
        for (const v of [-1, 0, 1]) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = fmt(v);
          btn.dataset.value = String(v);
          btn.classList.toggle('active', value === v);
          btn.addEventListener('click', () => setComponentTestInput(input.componentId, v));
          choices.appendChild(btn);
        }
        content.appendChild(row);
      }
      componentTestPanel.appendChild(group);
    }

    if (boundaries.outputs.length) {
      const { group, content } = createComponentTestGroup('Outputs', boundaries.outputs.length);
      for (const output of boundaries.outputs) {
        const row = document.createElement('div');
        row.className = 'component-test-row';
        const component = circuit().components.get(output.componentId);
        const value = trit(component?.state?.value);
        row.innerHTML = `<span class="component-test-name">${output.name}</span><span class="component-test-value" data-output-id="${output.componentId}">${fmt(value)}</span>`;
        content.appendChild(row);
      }
      componentTestPanel.appendChild(group);

      const { group: expected, content: expectedContent } = createComponentTestGroup('Expected outputs for next saved case', boundaries.outputs.length);
      for (const output of boundaries.outputs) {
        const row = document.createElement('div');
        row.className = 'component-test-row';
        const actual = trit(circuit().components.get(output.componentId)?.state?.value);
        const selected = trit(componentTestDraftExpected[output.componentId] ?? actual);
        row.innerHTML = `<span class="component-test-name">${output.name}</span><span class="trit-choice"></span>`;
        const choices = row.querySelector('.trit-choice');
        for (const value of [-1, 0, 1]) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = fmt(value);
          button.classList.toggle('active', selected === value);
          button.addEventListener('click', () => { componentTestDraftExpected[output.componentId] = value; renderComponentTestPanel(); });
          choices.appendChild(button);
        }
        expectedContent.appendChild(row);
      }
      componentTestPanel.appendChild(expected);
    }

    renderSavedTestCases(boundaries);
  }

  function refreshComponentTestPanel() {
    if (current.kind !== 'custom' || componentTestSection.hidden) return;
    const boundaries = componentTestBoundaries();
    let structuralMismatch = false;
    for (const input of boundaries.inputs) {
      const component = circuit().components.get(input.componentId);
      const value = trit(component?.state?.value);
      const buttons = componentTestPanel.querySelectorAll(`button[data-value]`);
      // Update by row name below; if structure changed, rebuild instead.
      const row = [...componentTestPanel.querySelectorAll('.component-test-row')].find((r) => r.querySelector('.component-test-name')?.textContent === input.name);
      if (!row) { structuralMismatch = true; break; }
      row.querySelectorAll('button[data-value]').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.value) === value));
    }
    if (structuralMismatch) return renderComponentTestPanel();
    for (const output of boundaries.outputs) {
      const component = circuit().components.get(output.componentId);
      const el = componentTestPanel.querySelector(`[data-output-id="${output.componentId}"]`);
      if (!el) return renderComponentTestPanel();
      el.textContent = fmt(component?.state?.value);
    }
  }

  function activePrimitiveTypes() {
    if (primitiveExperiment.activeId === 'custom') return [...primitiveExperiment.customTypes];
    return [...(PRIMITIVE_SETS[primitiveExperiment.activeId]?.types || PRIMITIVE_SETS.all.types)];
  }

  function primitiveSubtitle(type) {
    const descriptions = {
      'trit-input': 'test source: −1 / 0 / +1 / Z / ?',
      'word-input6': 'test source: six ternary word lanes',
      'input-button3': 'user I/O: clickable two-level control',
      'input-joystick3': 'user I/O: clickable ternary x/y controller',
      'input-joystick6': 'user I/O: drag-based x/y words, −364 … +364 per axis',
      'ternary-reference': 'fixed -1 / 0 / +1 structural rail',
      'sequence-generator': 'clock / ternary / custom sequence',
      latch3: 'transparent ternary storage while enable = +1',
      register3: 'D flip-flop: LOAD on clock 0 → +1',
      'register-bank3': 'three trit registers with ternary read / idle / write',
      'memory3x1': 'three addressed trit locations; read / idle / write',
      'memory3x6': 'three addressed six-trit words; atomic word writes',
      negate: 'x → -x',
      compare: 'A<B / = / >',
      select3: 'native 3-way route',
      min: 'MIN(A, B)',
      max: 'MAX(A, B)',
      'normalize-carry': 'A+B+C → Sum + 3×Carry',
      route3: 'route one input by -1 / 0 / +1',
      adjust3: '-1 / 0 / +1 = decrement / hold / increment',
      control3: 'decode one ternary control trit',
      threshold3: 'detect negative / zero / positive level',
      restore3: 'restore an ideal ternary level',
      pass3: 'controlled ternary pass switch',
      merge3: 'one driven path or Z; contention → ?',
      'storage-node3': 'ideal gated ternary storage node',
      'seven-segment-display': '8 inputs: A–G + sign; 0 = off, +1 = on',
      'trit-led': 'user I/O: visible one-trit LED',
      'binary-led': 'user I/O: ±1 = on, 0 = off; Z / ? flag invalid wiring',
      'word-display6': 'user I/O: visible − / 0 / + word lanes',
      'pixel-display3': 'user I/O: clocked 3×3 ternary frame',
      'rgb-display24-addressed': 'user I/O: 18-trit RGB, four-trit x/y, clocked writes',
      'rgb-display24-stream': 'user I/O: serial RGB data + clock; 18 trits per pixel',
      'word-probe6': 'debug observer: read six ordered trits',
      'decimal-debug6': 'debug only: inspect a six-trit word as decimal',
      probe: 'debug observer: read a trit',
    };
    return descriptions[type] || registry.get(type).label;
  }

  function renderPrimitiveSetControls() {
    const active = primitiveExperiment.activeId;
    primitiveSetSelect.innerHTML = '';
    for (const [id, set] of Object.entries(PRIMITIVE_SETS)) {
      const option = document.createElement('option');
      option.value = id; option.textContent = set.label; option.selected = active === id;
      primitiveSetSelect.appendChild(option);
    }
    const customOption = document.createElement('option');
    customOption.value = 'custom'; customOption.textContent = 'Custom experiment'; customOption.selected = active === 'custom';
    primitiveSetSelect.appendChild(customOption);

    const set = active === 'custom'
      ? { label: 'Custom experiment', description: 'Choose exactly which candidate primitives are available in the library.', types: [...primitiveExperiment.customTypes], metadata: { purpose: 'custom experiment' } }
      : PRIMITIVE_SETS[active] || PRIMITIVE_SETS.all;
    primitiveSetDescription.textContent = set.description;

    primitiveSetChecks.innerHTML = '';
    for (const type of EXPERIMENTAL_PRIMITIVES) {
      const def = registry.get(type);
      const row = document.createElement('label'); row.className = 'primitive-set-check';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = set.types.includes(type);
      checkbox.addEventListener('change', () => {
        const base = primitiveExperiment.activeId === 'custom' ? new Set(primitiveExperiment.customTypes) : new Set(activePrimitiveTypes());
        if (checkbox.checked) base.add(type); else base.delete(type);
        primitiveExperiment.customTypes = base;
        primitiveExperiment.activeId = 'custom';
        renderPrimitiveSetControls(); renderLibrary();
        setStatus(`Primitive experiment changed: ${base.size} candidate primitive${base.size === 1 ? '' : 's'} enabled.`);
      });
      const text = document.createElement('span'); text.textContent = def.label;
      row.append(checkbox, text); primitiveSetChecks.appendChild(row);
    }

    const defs = set.types.map((type) => registry.get(type));
    const nodeCost = defs.reduce((sum, def) => sum + (Number(def.cost?.logical?.nodes) || 0), 0);
    primitiveSetCost.innerHTML = `<strong>Set metadata</strong><br>${esc(set.metadata?.purpose || 'experiment')} · ${defs.length} candidates · base logical node cost ${nodeCost}`;
  }

  function renderLibrary() {
    primitiveList.innerHTML = '';
    const visibleTypes = new Set([...UTILITY_PRIMITIVES, ...activePrimitiveTypes()]);
    for (const group of PRIMITIVE_GROUPS) {
      const types = group.types.filter((type) => visibleTypes.has(type));
      if (!types.length) continue;
      const section = document.createElement('section');
      section.className = 'primitive-group';
      const heading = document.createElement('h3');
      heading.textContent = group.label;
      const entries = document.createElement('div');
      entries.className = 'component-list primitive-group-list';
      for (const type of types) {
        const def = registry.get(type);
        addLibraryButton(entries, type, def.label, primitiveSubtitle(type), false, Boolean(def.candidate));
      }
      section.append(heading, entries);
      primitiveList.appendChild(section);
    }

    interfaceSection.hidden = current.kind !== 'custom';
    interfaceList.innerHTML = '';
    if (current.kind === 'custom') {
      addLibraryButton(interfaceList, 'component-input', 'Component Input', 'external input → internal signal');
      addLibraryButton(interfaceList, 'component-output', 'Component Output', 'internal signal → external output');
      addLibraryButton(interfaceList, 'component-seven-segment-display', '7-segment Output', 'A–G + Sign → visible component output');
    }

    customList.innerHTML = '';
    let shown = 0;
    for (const meta of customComponents.values()) {
      if (current.kind === 'custom' && meta.id === current.customId) continue; // prevent direct self recursion
      const def = registry.get(meta.type);
      const experiment = meta.experiment;
      const comparison = experiment?.nodeCount != null ? ` · ${experiment.nodeCount} primitive node${experiment.nodeCount === 1 ? '' : 's'}` : '';
      const visual = def.visual?.kind === 'seven-segment' ? ' · 7-segment output' : '';
      addCustomLibraryEntry(meta, `${def.inputs.length} in · ${def.outputs.length} out${visual}${comparison}`);
      shown++;
    }
    customEmpty.hidden = shown > 0;
  }

  function addCustomLibraryEntry(meta, subtitle) {
    const entry = document.createElement('div');
    entry.className = 'custom-library-entry';
    addLibraryButton(entry, meta.type, meta.label, subtitle, true);
    const actions = document.createElement('div');
    actions.className = 'custom-library-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open-custom-component';
    open.textContent = 'Open';
    open.setAttribute('aria-label', `Open reusable component ${meta.label}`);
    open.addEventListener('click', () => openCustomComponent(meta.type));
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'export-custom-component';
    exportButton.textContent = 'Export';
    exportButton.setAttribute('aria-label', `Export reusable component ${meta.label}`);
    exportButton.addEventListener('click', () => exportCustomComponent(meta.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-custom-component';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove reusable component ${meta.label}`);
    remove.addEventListener('click', () => removeCustomComponent(meta.id));
    actions.append(open, exportButton, remove);
    entry.appendChild(actions);
    customList.appendChild(entry);
  }

  function renderBreadcrumbs() {
    breadcrumbs.innerHTML = '';
    const chain = [...navigation.map((n) => ({ label: n.context.label, index: n.index })), { label: current.label, current: true }];
    chain.forEach((item, i) => {
      if (i) { const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '›'; breadcrumbs.appendChild(sep); }
      if (item.current) { const span = document.createElement('span'); span.className = 'current'; span.textContent = item.label; breadcrumbs.appendChild(span); }
      else {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = item.label;
        const targetDepth = i;
        btn.addEventListener('click', () => navigateToDepth(targetDepth));
        breadcrumbs.appendChild(btn);
      }
    });
    backBtn.disabled = navigation.length === 0;
  }

  function registerCustom(meta) {
    const def = makeCustomDefinition(meta, registry);
    registry.register(def, { replace: true });
    return def;
  }

  function customComponentUsages(meta) {
    const usages = [];
    const inspect = (owner, data) => {
      const count = (data?.components || []).filter((component) => component.type === meta.type).length;
      if (count) usages.push({ owner, count });
    };
    inspect('Project', current.kind === 'root' ? circuit().serialize() : rootCircuit.serialize());
    for (const candidate of customComponents.values()) {
      if (candidate.id === meta.id) continue;
      inspect(candidate.label, current.kind === 'custom' && candidate.id === current.customId ? circuit().serialize() : candidate.circuit);
    }
    return usages;
  }

  function componentDependencyIds(rootId, components = customComponents) {
    const ids = new Set();
    const typeToId = new Map([...components.values()].map((meta) => [meta.type, meta.id]));
    const visit = (id) => {
      if (ids.has(id)) return;
      const meta = components.get(id);
      if (!meta) throw new Error('Missing component dependency: ' + id);
      ids.add(id);
      for (const component of meta.circuit?.components || []) {
        const childId = typeToId.get(component.type);
        if (childId) visit(childId);
      }
    };
    visit(rootId);
    return ids;
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportCustomComponent(id) {
    try {
      if (!saveCurrentCustomDefinition()) return;
      const root = customComponents.get(id);
      if (!root) throw new Error('Component is no longer available.');
      const ids = componentDependencyIds(id);
      const components = [...ids].map((componentId) => clone(customComponents.get(componentId)));
      const packageTests = testSuites.filter((suite) => ids.has(suite.componentId)).map(clone);
      downloadJson((slug(root.label) || 'ternary-component') + '.ternary-component.json', { format: 'ternary-component-package', version: COMPONENT_PACKAGE_FORMAT_VERSION, rootComponentId: id, components, testSuites: packageTests });
      setStatus('Exported “' + root.label + '” with ' + components.length + ' component definition' + (components.length === 1 ? '' : 's') + '.');
    } catch (error) { setStatus('Component export failed: ' + error.message, true); }
  }

  function importedComponentId(label, used) {
    const base = slug(label) || 'component';
    let number = 1; let id = base + '-imported';
    while (used.has(id)) { number += 1; id = base + '-imported-' + number; }
    used.add(id); return id;
  }

  async function importComponentPackage(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== 'ternary-component-package' || Number(data.version) !== COMPONENT_PACKAGE_FORMAT_VERSION) throw new Error('This is not a supported component package.');
      if (!Array.isArray(data.components) || !data.components.length || !data.rootComponentId) throw new Error('Package has no root component.');
      const original = new Map(data.components.map((meta) => [meta.id, clone(meta)]));
      const root = original.get(data.rootComponentId);
      if (!root) throw new Error('Package root component is missing.');
      for (const meta of original.values()) if (!meta.id || !meta.type || !meta.circuit) throw new Error('A packaged component is incomplete.');
      const usedIds = new Set(customComponents.keys());
      const idMap = new Map(), typeMap = new Map(), imported = new Map();
      for (const meta of original.values()) { const id = importedComponentId(meta.label, usedIds); idMap.set(meta.id, id); typeMap.set(meta.type, 'custom:' + id); }
      const usedLabels = [...customComponents.values()].map((meta) => meta.label);
      for (const meta of original.values()) {
        const next = clone(meta); next.id = idMap.get(meta.id); next.type = typeMap.get(meta.type);
        next.label = uniqueName(meta.label, [...usedLabels, ...[...imported.values()].map((entry) => entry.label)], 'Imported component');
        for (const component of next.circuit.components || []) if (typeMap.has(component.type)) component.type = typeMap.get(component.type);
        imported.set(next.id, next);
      }
      const combined = new Map([...customComponents, ...imported]);
      const cycle = customRecursionPath(null, null, combined);
      if (cycle) throw new Error('Imported component would create recursion: ' + recursionMessage(cycle, combined));
      for (const meta of imported.values()) { customComponents.set(meta.id, meta); registerCustom(meta); }
      const suites = (data.testSuites || []).map((suite) => { const componentId = idMap.get(suite.componentId); return componentId ? { ...clone(suite), componentId } : null; }).filter(Boolean);
      testSuites.push(...suites); renderLibrary(); await autosaveIfChanged();
      const importedRoot = imported.get(idMap.get(root.id));
      setStatus('Imported “' + importedRoot.label + '” with ' + imported.size + ' component definition' + (imported.size === 1 ? '' : 's') + '.');
    } catch (error) { setStatus('Component import failed: ' + error.message, true); }
    finally { importComponentFile.value = ''; }
  }
  function removeCustomComponent(id) {
    const meta = customComponents.get(id);
    if (!meta) return;
    const usages = customComponentUsages(meta);
    if (usages.length) {
      const detail = usages.map((usage) => `${usage.owner} (${usage.count})`).join(', ');
      return setStatus(`Cannot remove “${meta.label}”; it is still used by ${detail}.`, true);
    }
    if (!window.confirm(`Remove reusable component “${meta.label}”? This cannot be undone.`)) return;
    customComponents.delete(id);
    registry.remove(meta.type);
    testSuites = testSuites.filter((suite) => suite.componentId !== id);
    renderLibrary();
    autosaveIfChanged();
    setStatus(`Removed reusable component “${meta.label}”.`);
  }

  function customRecursionPath(candidateId = null, candidateCircuit = null, components = customComponents) {
    const typeToId = new Map([...components.values()].map((meta) => [meta.type, meta.id]));
    const dependencies = (id) => {
      const data = id === candidateId ? candidateCircuit : components.get(id)?.circuit;
      return [...new Set((data?.components || []).map((component) => typeToId.get(component.type)).filter(Boolean))];
    };
    const visiting = new Set();
    const visited = new Set();
    const path = [];
    const visit = (id) => {
      if (visiting.has(id)) return [...path, id];
      if (visited.has(id)) return null;
      visiting.add(id); path.push(id);
      for (const dependency of dependencies(id)) {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
      path.pop(); visiting.delete(id); visited.add(id);
      return null;
    };
    for (const id of components.keys()) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
    return null;
  }

  function recursionMessage(path, components = customComponents) {
    return path.map((id) => components.get(id)?.label || id).join(' → ');
  }

  function saveCurrentCustomDefinition() {
    if (current.kind !== 'custom') return true;
    const meta = customComponents.get(current.customId);
    if (!meta) return true;
    const data = circuit().serialize();
    try {
      const boundaries = boundaryPorts(data);
      if (!boundaries.inputs.length && !boundaries.outputs.length && !boundaries.display) throw new Error('A reusable component needs an input, signal output or visual output.');
      const cycle = customRecursionPath(current.customId, data);
      if (cycle) throw new Error(`Custom component recursion is not allowed: ${recursionMessage(cycle)}.`);
      meta.circuit = clone(data);
      meta.runtimeVersion = Math.max(1, Number(meta.runtimeVersion) || 1) + 1;
      registerCustom(meta);
      renderLibrary();
      return true;
    } catch (error) {
      setStatus(`Cannot save component: ${error.message}`, true);
      return false;
    }
  }

  function switchContext(next, viewState = null) {
    current = next;
    renderer.setCircuit(current.circuit);
    applyExecutionModeToCircuit();
    const fallback = { x: renderer.app.screen.width / 2, y: renderer.app.screen.height / 2, scale: 1 };
    renderer.setViewState(viewState || fallback);
    renderer.select(null);
    resetHistory(); updateStats(); renderLibrary(); renderBreadcrumbs(); renderComponentTestPanel(); hookActiveCircuitEvents(); updateComputerControls();
  }

  function createCustomComponent() {
    const requestedLabel = window.prompt('Name the reusable component:', 'My Component');
    if (!requestedLabel?.trim()) return;
    const label = uniqueName(requestedLabel, [...customComponents.values()].map((meta) => meta.label), 'My Component');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const type = `custom:${id}`;
    const inner = new Circuit(registry);
    inner.addComponent('component-input', -220, 0, { name: 'in' });
    inner.addComponent('component-output', 220, 0, { name: 'out' });
    const meta = { id, type, label: label.trim(), circuit: inner.serialize() };
    customComponents.set(id, meta);
    registerCustom(meta);
    navigation.push({ context: current, view: renderer.getViewState(), index: navigation.length });
    switchContext({ kind: 'custom', label: meta.label, circuit: inner, customId: id });
    setStatus(`Editing reusable component “${meta.label}”.${label !== requestedLabel.trim() ? ' A unique name was assigned.' : ''} Connect Component Input/Output blocks to define its interface.`);
  }

  function createComponentFromSelection() {
    const selectedIds = renderer.getSelectedComponentIds();
    if (!selectedIds.length) return setStatus('Select one or more components first.', true);
    const requestedLabel = window.prompt('Name the new reusable component:', 'New Component');
    if (!requestedLabel?.trim()) return;

    const parent = circuit();
    const selected = selectedIds.map((id) => parent.components.get(id)).filter(Boolean);
    const selectedSet = new Set(selected.map((component) => component.id));
    if (!selected.length) return setStatus('The selected components no longer exist.', true);
    const label = uniqueName(requestedLabel, [...customComponents.values()].map((meta) => meta.label), 'New Component');
    const minX = Math.min(...selected.map((component) => component.x));
    const minY = Math.min(...selected.map((component) => component.y));
    const maxX = Math.max(...selected.map((component) => component.x));
    const maxY = Math.max(...selected.map((component) => component.y));
    const incoming = [...parent.wires.values()].filter((wire) => !selectedSet.has(wire.from.componentId) && selectedSet.has(wire.to.componentId));
    const outgoing = [...parent.wires.values()].filter((wire) => selectedSet.has(wire.from.componentId) && !selectedSet.has(wire.to.componentId));
    const internal = [...parent.wires.values()].filter((wire) => selectedSet.has(wire.from.componentId) && selectedSet.has(wire.to.componentId));
    const inner = new Circuit(registry);
    const idMap = new Map();
    const parentSnapshot = parent.serialize();
    let meta = null;

    try {
      for (const component of selected) {
        const copy = inner.addComponent(component.type, component.x - minX, component.y - minY, clone(component.state));
        idMap.set(component.id, copy.id);
      }
      for (const wire of internal) {
        const copy = inner.connect(idMap.get(wire.from.componentId), wire.from.port, idMap.get(wire.to.componentId), wire.to.port);
        if (wire.label) inner.setWireLabel(copy.id, wire.label);
      }

      const usedInputs = [];
      const inputPorts = incoming.map((wire, index) => {
        const target = parent.components.get(wire.to.componentId);
        const targetLabel = target?.state?.label || registry.get(target?.type || 'component-output').label;
        const name = uniqueName(`${slug(targetLabel)} ${wire.to.port}`, usedInputs, 'input');
        usedInputs.push(name);
        const boundary = inner.addComponent('component-input', -220, index * 70, { name });
        inner.connect(boundary.id, 'out', idMap.get(wire.to.componentId), wire.to.port);
        return { wire, name };
      });

      const usedOutputs = [];
      const outputPorts = new Map();
      for (const wire of outgoing) {
        const key = `${wire.from.componentId}:${wire.from.port}`;
        if (outputPorts.has(key)) { outputPorts.get(key).wires.push(wire); continue; }
        const source = parent.components.get(wire.from.componentId);
        const sourceLabel = source?.state?.label || registry.get(source?.type || 'component-input').label;
        const name = uniqueName(`${slug(sourceLabel)} ${wire.from.port}`, usedOutputs, 'output');
        usedOutputs.push(name);
        const boundary = inner.addComponent('component-output', (maxX - minX) + 220, outputPorts.size * 70, { name });
        inner.connect(idMap.get(wire.from.componentId), wire.from.port, boundary.id, 'in');
        outputPorts.set(key, { wire, wires: [wire], name });
      }

      const id = `${slug(label)}-${Date.now().toString(36)}`;
      meta = { id, type: `custom:${id}`, label, circuit: inner.serialize() };
      customComponents.set(id, meta);
      registerCustom(meta);

      beginHistory('Create component from selection');
      for (const component of selected) parent.removeComponent(component.id);
      const instance = parent.addComponent(meta.type, Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2));
      for (const port of inputPorts) {
        const wire = parent.connect(port.wire.from.componentId, port.wire.from.port, instance.id, port.name);
        if (port.wire.label) parent.setWireLabel(wire.id, port.wire.label);
      }
      for (const port of outputPorts.values()) {
        for (const wire of port.wires) {
          const replacement = parent.connect(instance.id, port.name, wire.to.componentId, wire.to.port);
          if (wire.label) parent.setWireLabel(replacement.id, wire.label);
        }
      }
      commitHistory('Create component from selection', { addedCustom: clone(meta) });
      renderer.selectComponent(instance.id);
      renderLibrary(); updateStats();
      setStatus(`Created reusable component “${label}” from ${selected.length} selected block${selected.length === 1 ? '' : 's'}.`);
    } catch (error) {
      history.pending = null;
      if (meta) {
        customComponents.delete(meta.id);
        registry.remove(meta.type);
      }
      parent.load(parentSnapshot);
      renderer.select(null); renderLibrary(); updateStats();
      setStatus(`Could not create component: ${error.message}`, true);
    }
  }

  function openCustomComponent(type) {
    const def = registry.get(type);
    if (!def.custom) return;
    if (!saveCurrentCustomDefinition()) return;
    const meta = customComponents.get(def.customId);
    if (!meta) return setStatus('Custom component definition is missing.', true);
    navigation.push({ context: current, view: renderer.getViewState(), index: navigation.length });
    const inner = new Circuit(registry);
    inner.load(meta.circuit);
    switchContext({ kind: 'custom', label: meta.label, circuit: inner, customId: meta.id });
    setStatus(`Opened ${meta.label}. You can open nested reusable components from the Inspector.`);
  }

  function openStructuralImplementation(reference) {
    let meta = structuralReferences.get(reference);
    if (!meta || !customComponents.has(meta.id)) {
      const references = reference === 'structural-instruction-register6-v1'
        ? buildStructuralInstructionRegisterDemo(false)
        : reference === 'structural-cpu6-v1'
        ? buildStructuralCpuArchitecture(false)
        : reference === 'structural-register-file3x6-v1'
        ? buildStructuralRegisterFileDemo(false)
        : reference === 'structural-program-counter6-v1'
        ? buildStructuralProgramCounterDemo(false)
        : reference === 'structural-register-bank3x6-v1'
        ? buildStructuralWordRegisterBankDemo(false)
        : reference === 'structural-memory81x6-v1'
        ? buildStructuralScaledMemoryDemo(81, false)
        : reference === 'structural-memory27x6-v1'
        ? buildStructuralScaledMemoryDemo(27, false)
        : reference === 'structural-memory9x6-v1'
        ? buildStructuralScaledMemoryDemo(9, false)
        : reference === 'structural-memory3x6-v1'
        ? buildStructuralMemoryWordDemo(false)
        : reference === 'structural-memory3x1-v1'
        ? buildStructuralMemoryDemo(false)
        : reference === 'structural-register-bank3-v1'
        ? buildStructuralRegisterBankDemo(false)
        : reference.startsWith('structural-latch') || reference.startsWith('structural-register')
          ? buildStructuralStorageDemo(false)
          : buildStructuralRoutingDemo(false);
      meta = references?.[reference];
    }
    if (!meta) return setStatus('The named structural implementation is not available.', true);
    openCustomComponent(meta.type);
  }

  function goBack() {
    if (!navigation.length) return;
    if (!saveCurrentCustomDefinition()) return;
    const previous = navigation.pop();
    // Reload through the registry so changed child interfaces are reflected in parent instances.
    const data = previous.context.circuit.serialize();
    previous.context.circuit.load(data);
    switchContext(previous.context, previous.view);
    setStatus(`Back to ${current.label}.`);
  }

  function navigateToDepth(depth) {
    while (navigation.length > depth) {
      if (!saveCurrentCustomDefinition()) return;
      const previous = navigation.pop();
      const data = previous.context.circuit.serialize();
      previous.context.circuit.load(data);
      current = previous.context;
      if (navigation.length === depth) {
        switchContext(current, previous.view);
        setStatus(`Back to ${current.label}.`);
        return;
      }
    }
  }

  function sanitizeProjectName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'Untitled project';
  }

  function makeProjectId(name) {
    const base = slug(sanitizeProjectName(name)) || 'project';
    return `${base}-${Date.now().toString(36)}`;
  }

  const projectNameKey = (name) => sanitizeProjectName(name).toLocaleLowerCase();

  async function projectNameTaken(name, exceptId = currentProjectId) {
    const key = projectNameKey(name);
    const projects = await storage.list();
    return projects.some((entry) => entry.id !== exceptId && projectNameKey(entry.project?.projectName || entry.id) === key);
  }

  async function nextAvailableProjectName(base = 'New project') {
    const cleanBase = sanitizeProjectName(base);
    const projects = await storage.list();
    const used = new Set(projects.map((entry) => projectNameKey(entry.project?.projectName || entry.id)));
    if (!used.has(projectNameKey(cleanBase))) return cleanBase;
    for (let number = 2; ; number += 1) {
      const candidate = `${cleanBase} ${number}`;
      if (!used.has(projectNameKey(candidate))) return candidate;
    }
  }

  async function renameCurrentProject() {
    const requested = sanitizeProjectName(projectNameInput.value);
    if (projectNameKey(requested) === projectNameKey(currentProjectName)) {
      projectNameInput.value = currentProjectName;
      return;
    }
    if (await projectNameTaken(requested)) {
      projectNameInput.value = currentProjectName;
      setStatus(`Project name “${requested}” is already in use. Choose a different name.`, true);
      return;
    }
    currentProjectName = requested;
    projectNameInput.value = currentProjectName;
    await saveProject({ quiet: true });
    setStatus(`Renamed project to “${currentProjectName}”.`);
  }

  function migrateProject(rawProject) {
    const project = clone(rawProject || {});
    const version = Number(project.formatVersion || project.appVersion || 1);
    if (version > PROJECT_FORMAT_VERSION) {
      throw new Error(`This project uses format version ${version}, but this app supports up to ${PROJECT_FORMAT_VERSION}.`);
    }

    // Historical files stored the main circuit as either rootCircuit or circuit.
    if (!project.rootCircuit && project.circuit) project.rootCircuit = project.circuit;
    if (!project.customComponents) project.customComponents = [];
    if (!project.primitiveExperiment) {
      project.primitiveExperiment = { activeId: 'all', customTypes: [...EXPERIMENTAL_PRIMITIVES] };
    }
    if (!project.testSuites) project.testSuites = [];
    if (!project.projectName) project.projectName = 'Imported project';
    project.formatVersion = PROJECT_FORMAT_VERSION;
    project.appVersion = PROJECT_FORMAT_VERSION;
    return project;
  }

  function projectSnapshot() {
    saveCurrentCustomDefinition();
    return {
      formatVersion: PROJECT_FORMAT_VERSION,
      appVersion: PROJECT_FORMAT_VERSION,
      projectId: currentProjectId,
      projectName: sanitizeProjectName(currentProjectName),
      primitiveExperiment: { activeId: primitiveExperiment.activeId, customTypes: [...primitiveExperiment.customTypes] },
      rootCircuit: rootCircuit.serialize(),
      customComponents: [...customComponents.values()].map(clone),
      testSuites: clone(testSuites),
      view: current.kind === 'root' ? renderer.getViewState() : null,
    };
  }

  async function refreshProjectList() {
    const projects = await storage.list();
    projectSelect.innerHTML = '';
    for (const entry of projects) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.project?.projectName || entry.id;
      projectSelect.appendChild(option);
    }
    if (currentProjectId && !projects.some((entry) => entry.id === currentProjectId)) {
      const option = document.createElement('option');
      option.value = currentProjectId;
      option.textContent = currentProjectName;
      projectSelect.appendChild(option);
    }
    if (currentProjectId) projectSelect.value = currentProjectId;
    const deleteProjectBtn = $('deleteProjectBtn');
    if (deleteProjectBtn) deleteProjectBtn.disabled = !currentProjectId;
  }

  async function saveProject({ quiet = false } = {}) {
    try {
      if (!currentProjectId) currentProjectId = makeProjectId(currentProjectName);
      currentProjectName = sanitizeProjectName(projectNameInput.value || currentProjectName);
      if (await projectNameTaken(currentProjectName)) throw new Error(`Project name “${currentProjectName}” is already in use.`);
      projectNameInput.value = currentProjectName;
      const snapshot = projectSnapshot();
      snapshot.projectId = currentProjectId;
      snapshot.projectName = currentProjectName;
      const serialized = JSON.stringify(snapshot);
      await storage.save(currentProjectId, snapshot);
      await storage.setMeta('lastProjectId', currentProjectId);
      lastSavedSnapshot = serialized;
      await refreshProjectList();
      lastProjectError = '';
      if (!quiet) setStatus(`Saved “${currentProjectName}” to IndexedDB.`);
      return true;
    } catch (error) {
      lastProjectError = error.message || String(error);
      setStatus(`Save failed: ${lastProjectError}`, true);
      return false;
    }
  }

  function clearCustomRegistry() {
    for (const meta of customComponents.values()) registry.remove(meta.type);
    customComponents.clear();
    structuralReferences.clear();
  }

  function resetProjectSessionState() {
    navigation.length = 0;
    componentTestDraftComponentId = null;
    componentTestDraftExpected = {};
    stateTimeline.length = 0;
    renderStateTimeline();
  }

  function recoverMissingCustomComponents(project, incomingComponents) {
    // Older autosaves can contain an instance of a demo component while its
    // reusable definition was not persisted. Rebuild a safe passthrough
    // definition from the saved port contract so the project remains loadable.
    const missing = new Map();
    const registeredTypes = new Set([...incomingComponents.values()].map((meta) => meta.type));
    const inspect = (data) => {
      for (const raw of data?.components || []) {
        if (!String(raw.type || '').startsWith('custom:')) continue;
        // The early 6-trit-word demo could save a malformed inner definition.
        // Its public contract is intentionally a pure six-lane passthrough, so
        // always reconstruct this known demo type from its saved ports.
        const isLegacySixTritWord = String(raw.type).startsWith('custom:6-trit-word-');
        if (isLegacySixTritWord || !registeredTypes.has(raw.type)) missing.set(raw.type, raw);
      }
    };
    inspect(project.rootCircuit || project.circuit);
    for (const meta of incomingComponents.values()) inspect(meta.circuit);

    const recovered = [];
    for (const [type, raw] of missing) {
      const id = type.slice('custom:'.length);
      const inputs = Object.keys(raw.inputs || {});
      const outputs = Object.keys(raw.outputs || {});
      const inner = new Circuit(registry);
      const inputNodes = new Map(inputs.map((name, index) => [name, inner.addComponent('component-input', -240, index * 60, { name })]));
      outputs.forEach((name, index) => {
        const output = inner.addComponent('component-output', 240, index * 60, { name });
        const inputIterator = inputNodes.values().next();
        const source = inputNodes.get(name) || (inputIterator.done ? null : inputIterator.value);
        if (source) inner.connect(source.id, 'out', output.id, 'in');
      });
      const label = raw.state?.label || ('Recovered ' + id);
      const meta = {
        id, type, label, circuit: inner.serialize(), recovered: true,
        experiment: {
          role: 'recovered compatibility component', nodeCount: 0, depth: 0, primitiveCounts: {},
          rationale: 'The original reusable definition was absent from this saved project. The loader reconstructed a safe port-preserving passthrough so the project can open.',
          validation: 'Recovered automatically from the saved component port contract; inspect and rebuild its internal logic before relying on it.',
        },
      };
      incomingComponents.set(id, meta);
      recovered.push(label);
    }
    return recovered;
  }
  function applyProject(project, { id = null, savedAt = null } = {}) {
    project = migrateProject(project);
    const incomingComponents = new Map((project.customComponents || []).map((meta) => [meta.id, clone(meta)]));
    const recoveredComponents = recoverMissingCustomComponents(project, incomingComponents);
    const cycle = customRecursionPath(null, null, incomingComponents);
    if (cycle) throw new Error(`Custom component recursion is not allowed: ${recursionMessage(cycle, incomingComponents)}.`);
    resetProjectSessionState();
    clearCustomRegistry();
    for (const meta of incomingComponents.values()) customComponents.set(meta.id, meta);
    for (const meta of customComponents.values()) registerCustom(meta);
    const savedExperiment = project.primitiveExperiment || {};
    primitiveExperiment.activeId = savedExperiment.activeId === 'custom' || PRIMITIVE_SETS[savedExperiment.activeId] ? (savedExperiment.activeId || 'all') : 'all';
    primitiveExperiment.customTypes = new Set((savedExperiment.customTypes || EXPERIMENTAL_PRIMITIVES).filter((type) => EXPERIMENTAL_PRIMITIVES.includes(type)));
    testSuites = clone(project.testSuites || []);
    currentProjectId = id || project.projectId || makeProjectId(project.projectName);
    currentProjectName = sanitizeProjectName(project.projectName || 'Project');
    projectNameInput.value = currentProjectName;
    renderPrimitiveSetControls(); renderLibrary();
    rootCircuit = new Circuit(registry);
    rootCircuit.load(project.rootCircuit || project.circuit);
    switchContext({ kind: 'root', label: 'Project', circuit: rootCircuit, customId: null }, project.view);
    resetHistory();
    lastSavedSnapshot = JSON.stringify(projectSnapshot());
    storage.setMeta('lastProjectId', currentProjectId).catch(() => {});
    refreshProjectList().catch(() => {});
    const recoveryNote = recoveredComponents.length ? ' Recovered ' + recoveredComponents.length + ' missing reusable component definition' + (recoveredComponents.length === 1 ? '' : 's') + ': ' + recoveredComponents.join(', ') + '.' : '';
    setStatus((savedAt ? `Loaded “${currentProjectName}” saved ${new Date(savedAt).toLocaleString()}.` : `Loaded “${currentProjectName}”.`) + recoveryNote, Boolean(recoveredComponents.length));
    return { recoveredComponents };
  }

  async function loadProject(id = null) {
    try {
      const targetId = id || projectSelect.value || currentProjectId || 'default';
      const saved = await storage.load(targetId);
      if (!saved) return setStatus('No saved project found.', true);
      applyProject(saved.project, { id: saved.id, savedAt: saved.savedAt });
    } catch (error) { setStatus(`Load failed: ${error.message}`, true); }
  }

  async function switchProject(id) {
    const targetId = String(id || '');
    if (!targetId || targetId === currentProjectId || projectActionBusy) return;
    const targetName = projectSelect.options[projectSelect.selectedIndex]?.textContent || targetId;
    projectActionBusy = true;
    try {
      setProjectMessage(`Switching to “${targetName}”…`);
      setStatus('Loading project…');
      if (!saveCurrentCustomDefinition()) throw new Error('The current reusable component has an invalid interface and could not be saved.');
      if (!await saveProject({ quiet: true })) throw new Error(`Could not save the current project: ${lastProjectError || 'unknown storage error'}`);
      const saved = await storage.load(targetId);
      if (!saved) throw new Error(`No locally saved project exists with id “${targetId}”.`);
      const loaded = applyProject(saved.project, { id: saved.id, savedAt: saved.savedAt });
      const repaired = loaded.recoveredComponents || [];
      setProjectMessage(repaired.length
        ? `Now editing “${currentProjectName}”. Recovered missing component definition${repaired.length === 1 ? '' : 's'}: ${repaired.join(', ')}. Open the recovered component and rebuild it before relying on its logic.`
        : `Now editing “${currentProjectName}”.`, Boolean(repaired.length));
    } catch (error) {
      const detail = error.message || String(error);
      projectSelect.value = currentProjectId;
      setProjectMessage(`Could not switch to “${targetName}”: ${detail}`, true);
      setStatus(`Project switch failed: ${detail}`, true);
    } finally {
      projectActionBusy = false;
    }
  }

  async function createNewProject({ saveCurrent = true } = {}) {
    if (projectActionBusy) return;
    projectActionBusy = true;
    try {
      setProjectMessage('Creating a new empty project…');
      setStatus('Creating new project…');
      if (saveCurrent) {
        if (!saveCurrentCustomDefinition()) return;
        if (!await saveProject({ quiet: true })) return;
      }
      // Clear the old circuit before replacing it. Its saved project remains
      // intact, while both the data model and renderer are forced to empty.
      rootCircuit.clear();
      resetProjectSessionState();
      clearCustomRegistry();
      rootCircuit = new Circuit(registry);
      currentProjectName = await nextAvailableProjectName('New project');
      currentProjectId = makeProjectId(currentProjectName);
      projectNameInput.value = currentProjectName;
      testSuites = [];
      primitiveExperiment.activeId = 'all';
      primitiveExperiment.customTypes = new Set(EXPERIMENTAL_PRIMITIVES);
      renderPrimitiveSetControls(); renderLibrary();
      switchContext({ kind: 'root', label: 'Project', circuit: rootCircuit, customId: null });
      renderer.rebuild();
      resetHistory();
      lastSavedSnapshot = '';
      if (!await saveProject({ quiet: true })) return;
      setProjectMessage(`Now editing empty project “${currentProjectName}”.`);
      setStatus('Created a new empty project. The canvas has no components or wires. Rename it in the project-name field; changes autosave.');
    } catch (error) {
      setStatus(`Could not create project: ${error.message}`, true);
    } finally {
      projectActionBusy = false;
    }
  }

  async function deleteCurrentProject() {
    if (current.kind !== 'root') return setStatus('Return to Project before deleting a project.', true);
    if (!currentProjectId) return setStatus('There is no saved project to delete.', true);
    const id = currentProjectId;
    const name = currentProjectName;
    if (!window.confirm(`Delete project “${name}”? This removes its locally saved circuit, components and tests.`)) return;
    try {
      await storage.remove(id);
      const remaining = await storage.list();
      if (remaining.length) {
        const next = remaining[0];
        applyProject(next.project, { id: next.id, savedAt: next.savedAt });
        setStatus(`Deleted “${name}”. Loaded “${next.project?.projectName || next.id}”.`);
      } else {
        currentProjectId = null;
        await storage.setMeta('lastProjectId', null);
        await createNewProject({ saveCurrent: false });
        setStatus(`Deleted “${name}”. Created a new empty project.`);
      }
    } catch (error) {
      setStatus(`Could not delete project: ${error.message}`, true);
    }
  }

  function exportProject() {
    try {
      currentProjectName = sanitizeProjectName(projectNameInput.value || currentProjectName);
      const snapshot = projectSnapshot();
      snapshot.projectName = currentProjectName;
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${slug(currentProjectName) || 'ternary-project'}.ternary.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus(`Exported “${currentProjectName}” as JSON.`);
    } catch (error) { setStatus(`Export failed: ${error.message}`, true); }
  }

  async function importProjectFile(file) {
    try {
      const text = await file.text();
      const imported = migrateProject(JSON.parse(text));
      const importedName = sanitizeProjectName(imported.projectName || file.name.replace(/\.ternary\.json$|\.json$/i, '') || 'Imported project');
      imported.projectName = await nextAvailableProjectName(importedName);
      imported.projectId = makeProjectId(imported.projectName);
      applyProject(imported, { id: imported.projectId });
      await saveProject({ quiet: true });
      setStatus(`Imported “${currentProjectName}” and saved it locally.`);
    } catch (error) { setStatus(`Import failed: ${error.message}`, true); }
    finally { importFile.value = ''; }
  }

  async function autosaveIfChanged() {
    if (!renderer || !currentProjectId) return;
    try {
      // A project name is committed by its change handler, not while the user
      // is still typing. This keeps duplicate-name validation deterministic.
      if (projectNameKey(projectNameInput.value) !== projectNameKey(currentProjectName)) return;
      const snapshot = projectSnapshot();
      snapshot.projectName = currentProjectName;
      const serialized = JSON.stringify(snapshot);
      if (serialized === lastSavedSnapshot) return;
      await storage.save(currentProjectId, snapshot);
      await storage.setMeta('lastProjectId', currentProjectId);
      lastSavedSnapshot = serialized;
      await refreshProjectList();
      setStatus(`Autosaved “${currentProjectName}”.`);
    } catch (error) {
      console.error(error);
    }
  }

  function resetForDemo() {
    // A demo is a self-contained experiment, not an addition to the current library.
    rootCircuit.clear();
    clearCustomRegistry();
    testSuites = [];
    stateTimeline.length = 0;
    if (stateTimelineEl) renderStateTimeline();
    stopComputerRun(); updateComputerControls();
  }

  function buildDemo() {
    if (current.kind !== 'root') return setStatus('Return to Project before loading the demo.', true);
    resetForDemo();
    if ($('demoSelect').value === 'compare') return buildCompareDemo();
    if ($('demoSelect').value === 'adder-comparison') return buildAdderComparisonDemo();
    if ($('demoSelect').value === 'primitive-set-comparison') return buildPrimitiveSetComparisonDemo();
    if ($('demoSelect').value === 'comparator-comparison') return buildComparatorComparisonDemo();
    if ($('demoSelect').value === 'selector-router') return buildSelectorRouterDemo();
    if ($('demoSelect').value === 'control-signals') return buildControlSignalsDemo();
    if ($('demoSelect').value === 'sequential-storage') return buildSequentialStorageDemo();
    if ($('demoSelect').value === 'register-bank') return buildRegisterBankDemo();
    if ($('demoSelect').value === 'word-register-bank') return buildWordRegisterBankDemo();
    if ($('demoSelect').value === 'large-memory') return buildLargeMemoryDemo();
    if ($('demoSelect').value === 'program-counter') return buildProgramCounterDemo();
    if ($('demoSelect').value === 'cpu-datapath') {
      try { return buildCpuDatapathDemo(); }
      catch (error) { console.error(error); return setStatus(`Could not load CPU datapath: ${error.message}`, true); }
    }
    if ($('demoSelect').value === 'cpu-console') return buildCpuConsoleDemo();
    if ($('demoSelect').value === 'cpu-console-729') return buildCpuConsoleDemo(729);
    if ($('demoSelect').value === 'cpu-io-console') return buildCpuConsoleDemo(729, true);
    if ($('demoSelect').value === 'device-cells') return buildDeviceCellsDemo();
    if ($('demoSelect').value === 'seven-segment') return buildSevenSegmentDemo();
    if ($('demoSelect').value === 'one-trit-display') return buildOneTritDisplayDemo();
    if ($('demoSelect').value === 'three-trit-display') return buildThreeTritDisplayDemo();
    if ($('demoSelect').value === 'six-trit-word') return buildSixTritWordDemo();
    if ($('demoSelect').value === 'six-trit-adder') return buildSixTritAdderDemo();
    if ($('demoSelect').value === 'six-trit-subtractor') return buildSixTritSubtractorDemo();
    if ($('demoSelect').value === 'six-trit-comparator') return buildSixTritComparatorDemo();
    if ($('demoSelect').value === 'six-trit-selector') return buildSixTritSelectorDemo();
    if ($('demoSelect').value === 'six-trit-router') return buildSixTritRouterDemo();
    if ($('demoSelect').value === 'six-trit-alu-comparison') return buildSixTritAluComparisonDemo();
    if ($('demoSelect').value === 'six-trit-alu') return buildSixTritAluDemo();
    if ($('demoSelect').value === 'structural-storage') return buildStructuralStorageDemo();
    if ($('demoSelect').value === 'structural-routing') return buildStructuralRoutingDemo();
    const label = uniqueName('Ternary Full Adder', [...customComponents.values()].map((meta) => meta.label), 'Ternary Full Adder');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const inputs = ['a', 'b', 'c'].map((name, index) => inner.addComponent('component-input', -260, (index - 1) * 90, { name }));
    const normalize = inner.addComponent('normalize-carry', 0, 0);
    const sum = inner.addComponent('component-output', 260, -65, { name: 'sum' });
    const carry = inner.addComponent('component-output', 260, 65, { name: 'carry' });
    inputs.forEach((input, index) => inner.connect(input.id, 'out', normalize.id, ['a', 'b', 'c'][index]));
    inner.connect(normalize.id, 'sum', sum.id, 'in');
    inner.connect(normalize.id, 'carry', carry.id, 'in');
    const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize() };
    customComponents.set(id, meta); registerCustom(meta);
    const cases = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
      const raw = a + b + c;
      const carryValue = raw <= -2 ? -1 : raw >= 2 ? 1 : 0;
      cases.push({ id: `full-adder-${a}-${b}-${c}`, name: `a=${fmt(a)}, b=${fmt(b)}, c=${fmt(c)}`,
        inputs: { [inputs[0].id]: a, [inputs[1].id]: b, [inputs[2].id]: c },
        expectedOutputs: { [sum.id]: raw - (3 * carryValue), [carry.id]: carryValue } });
    }
    testSuites = testSuites.filter((suite) => suite.componentId !== id);
    testSuites.push({ componentId: id, cases });
    rootCircuit.clear();
    rootCircuit.addComponent(meta.type, 0, 0, { label });
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus(`Created “${label}” with all 27 ternary full-adder test cases.`);
  }

  function addFullAdderCases(componentId, inputs, sum, carry) {
    const cases = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
      const raw = a + b + c;
      const carryValue = raw <= -2 ? -1 : raw >= 2 ? 1 : 0;
      cases.push({ id: `full-adder-${a}-${b}-${c}`, name: `a=${fmt(a)}, b=${fmt(b)}, c=${fmt(c)}`, inputs: { [inputs[0].id]: a, [inputs[1].id]: b, [inputs[2].id]: c }, expectedOutputs: { [sum.id]: raw - (3 * carryValue), [carry.id]: carryValue } });
    }
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildAdderComparisonDemo() {
    const add = (labelBase, experiment, wire) => {
      const label = uniqueName(labelBase, [...customComponents.values()].map((meta) => meta.label), labelBase);
      const id = `${slug(label)}-${Date.now().toString(36)}`;
      const inner = new Circuit(registry);
      const inputs = ['a', 'b', 'c'].map((name, index) => inner.addComponent('component-input', -360, (index - 1) * 100, { name }));
      const sum = inner.addComponent('component-output', 360, -70, { name: 'sum' });
      const carry = inner.addComponent('component-output', 360, 80, { name: 'carry' });
      wire(inner, inputs, sum, carry);
      const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment };
      customComponents.set(id, meta); registerCustom(meta); addFullAdderCases(id, inputs, sum, carry);
      return meta;
    };
    const reference = add('Full Adder — Normalize reference', { role: 'reference', nodeCount: 1, depth: 1, primitiveCounts: { 'normalize-carry': 1 }, rationale: 'One direct normalization gives both outputs with the shortest known logical path.', validation: 'Exhaustive 27/27 a,b,c cases saved.' }, (inner, inputs, sum, carry) => {
      const normalize = inner.addComponent('normalize-carry', 0, 0);
      inputs.forEach((input, index) => inner.connect(input.id, 'out', normalize.id, ['a', 'b', 'c'][index]));
      inner.connect(normalize.id, 'sum', sum.id, 'in'); inner.connect(normalize.id, 'carry', carry.id, 'in');
    });
    const cascade = add('Full Adder — Cascaded normalize', { role: 'candidate', nodeCount: 4, depth: 4, primitiveCounts: { compare: 1, 'normalize-carry': 3 }, rationale: 'Decomposes addition into a+b, then partial-sum+c; a final normalization merges the two mutually exclusive carries.', validation: 'Exhaustive 27/27 a,b,c cases saved.' }, (inner, inputs, sum, carry) => {
      const zero = inner.addComponent('compare', -150, -190), first = inner.addComponent('normalize-carry', 0, -80), second = inner.addComponent('normalize-carry', 160, -15), merge = inner.addComponent('normalize-carry', 180, 150);
      inner.connect(inputs[0].id, 'out', zero.id, 'a'); inner.connect(inputs[0].id, 'out', zero.id, 'b');
      inner.connect(inputs[0].id, 'out', first.id, 'a'); inner.connect(inputs[1].id, 'out', first.id, 'b'); inner.connect(zero.id, 'out', first.id, 'c');
      inner.connect(first.id, 'sum', second.id, 'a'); inner.connect(inputs[2].id, 'out', second.id, 'b'); inner.connect(zero.id, 'out', second.id, 'c');
      inner.connect(first.id, 'carry', merge.id, 'a'); inner.connect(second.id, 'carry', merge.id, 'b'); inner.connect(zero.id, 'out', merge.id, 'c');
      inner.connect(second.id, 'sum', sum.id, 'in'); inner.connect(merge.id, 'sum', carry.id, 'in');
    });
    const alternate = add('Full Adder — Pairwise cascade (b+c)', { role: 'candidate', nodeCount: 4, depth: 4, primitiveCounts: { compare: 1, 'normalize-carry': 3 }, rationale: 'Uses the same staged reduction as the first candidate but starts with b+c, checking that the construction is symmetric under input ordering.', validation: 'Exhaustive 27/27 a,b,c cases saved.' }, (inner, inputs, sum, carry) => {
      const zero = inner.addComponent('compare', -150, -190), first = inner.addComponent('normalize-carry', 0, -80), second = inner.addComponent('normalize-carry', 160, -15), merge = inner.addComponent('normalize-carry', 180, 150);
      inner.connect(inputs[0].id, 'out', zero.id, 'a'); inner.connect(inputs[0].id, 'out', zero.id, 'b');
      inner.connect(inputs[1].id, 'out', first.id, 'a'); inner.connect(inputs[2].id, 'out', first.id, 'b'); inner.connect(zero.id, 'out', first.id, 'c');
      inner.connect(first.id, 'sum', second.id, 'a'); inner.connect(inputs[0].id, 'out', second.id, 'b'); inner.connect(zero.id, 'out', second.id, 'c');
      inner.connect(first.id, 'carry', merge.id, 'a'); inner.connect(second.id, 'carry', merge.id, 'b'); inner.connect(zero.id, 'out', merge.id, 'c');
      inner.connect(second.id, 'sum', sum.id, 'in'); inner.connect(merge.id, 'sum', carry.id, 'in');
    });
    rootCircuit.clear();
    [reference, cascade, alternate].forEach((meta, index) => rootCircuit.addComponent(meta.type, -250 + (index * 250), 0, { label: meta.label }));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Created three full-adder constructions, each with the same a,b,c → sum,carry contract and 27 saved cases.');
  }

  function buildPrimitiveSetComparisonDemo() {
    const eligibleSets = Object.entries(PRIMITIVE_SETS).filter(([, set]) => set.types.includes('normalize-carry'));
    const candidates = eligibleSets.map(([setId, set]) => {
      const labelBase = `Full Adder — ${set.label} baseline`;
      const label = uniqueName(labelBase, [...customComponents.values()].map((meta) => meta.label), labelBase);
      const id = `${slug(label)}-${Date.now().toString(36)}`;
      const inner = new Circuit(registry);
      const inputs = ['a', 'b', 'c'].map((name, index) => inner.addComponent('component-input', -260, (index - 1) * 90, { name }));
      const normalize = inner.addComponent('normalize-carry', 0, 0);
      const sum = inner.addComponent('component-output', 260, -65, { name: 'sum' });
      const carry = inner.addComponent('component-output', 260, 65, { name: 'carry' });
      inputs.forEach((input, index) => inner.connect(input.id, 'out', normalize.id, ['a', 'b', 'c'][index]));
      inner.connect(normalize.id, 'sum', sum.id, 'in'); inner.connect(normalize.id, 'carry', carry.id, 'in');
      const extras = set.types.filter((type) => type !== 'normalize-carry').map((type) => registry.get(type).label).join(', ') || 'none';
      const experiment = {
        role: 'primitive-set baseline', setName: set.label, nodeCount: 1, depth: 1,
        primitiveCounts: { 'normalize-carry': 1 },
        rationale: `The shared Normalize / carry primitive implements the complete contract directly. Other enabled candidates (${extras}) are not needed by this baseline.`,
        validation: 'Exhaustive 27/27 a,b,c cases saved.',
      };
      const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment, primitiveSetId: setId };
      customComponents.set(id, meta); registerCustom(meta); addFullAdderCases(id, inputs, sum, carry);
      return meta;
    });
    rootCircuit.clear();
    candidates.forEach((meta, index) => rootCircuit.addComponent(meta.type, -360 + (index * 240), 0, { label: meta.label }));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus(`Compared ${candidates.length} primitive sets. Each contains Normalize / carry, so each baseline passes the same 27-case contract in one primitive node.`);
  }

  function addComparatorCases(componentId, inputs, out) {
    const cases = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
      cases.push({ id: `comparator-${a}-${b}`, name: `a=${fmt(a)}, b=${fmt(b)}`, inputs: { [inputs[0].id]: a, [inputs[1].id]: b }, expectedOutputs: { [out.id]: a < b ? -1 : a > b ? 1 : 0 } });
    }
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildComparatorComparisonDemo() {
    const add = (labelBase, experiment, wire) => {
      const label = uniqueName(labelBase, [...customComponents.values()].map((meta) => meta.label), labelBase);
      const id = `${slug(label)}-${Date.now().toString(36)}`;
      const inner = new Circuit(registry);
      const inputs = ['a', 'b'].map((name, index) => inner.addComponent('component-input', -360, (index ? 1 : -1) * 90, { name }));
      const out = inner.addComponent('component-output', 360, 0, { name: 'out' });
      wire(inner, inputs, out);
      const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment };
      customComponents.set(id, meta); registerCustom(meta); addComparatorCases(id, inputs, out);
      return meta;
    };
    const reference = add('Comparator — Direct Compare', { role: 'reference', nodeCount: 1, depth: 1, primitiveCounts: { compare: 1 }, rationale: 'Compare directly returns -1, 0 or +1 for a<b, a=b and a>b.', validation: 'Exhaustive 9/9 a,b cases saved.' }, (inner, inputs, out) => {
      const compare = inner.addComponent('compare', 0, 0);
      inner.connect(inputs[0].id, 'out', compare.id, 'a'); inner.connect(inputs[1].id, 'out', compare.id, 'b'); inner.connect(compare.id, 'out', out.id, 'in');
    });
    const normalized = add('Comparator — Normalized difference', { role: 'candidate', nodeCount: 4, depth: 3, primitiveCounts: { negate: 1, 'normalize-carry': 2, select3: 1 }, rationale: 'Forms a-b, then Select3 chooses the normalized sum when carry is zero and the carry itself when magnitude overflow proves the sign.', validation: 'Exhaustive 9/9 a,b cases saved.' }, (inner, inputs, out) => {
      const zero = inner.addComponent('normalize-carry', -160, -170);
      const negateB = inner.addComponent('negate', -160, 100);
      const difference = inner.addComponent('normalize-carry', 40, 0);
      const route = inner.addComponent('select3', 220, 0);
      inner.connect(inputs[0].id, 'out', zero.id, 'a'); inner.connect(inputs[0].id, 'out', zero.id, 'b'); inner.connect(inputs[0].id, 'out', zero.id, 'c');
      inner.connect(inputs[1].id, 'out', negateB.id, 'in');
      inner.connect(inputs[0].id, 'out', difference.id, 'a'); inner.connect(negateB.id, 'out', difference.id, 'b'); inner.connect(zero.id, 'sum', difference.id, 'c');
      inner.connect(difference.id, 'carry', route.id, 'neg'); inner.connect(difference.id, 'sum', route.id, 'zero'); inner.connect(difference.id, 'carry', route.id, 'pos'); inner.connect(difference.id, 'carry', route.id, 'select');
      inner.connect(route.id, 'out', out.id, 'in');
    });
    const reversed = add('Comparator — Reversed difference', { role: 'candidate', nodeCount: 5, depth: 4, primitiveCounts: { negate: 2, 'normalize-carry': 2, select3: 1 }, rationale: 'Computes sign(b-a) with the same normalization-and-routing method, then inverts it. This checks the antisymmetry of the comparator construction.', validation: 'Exhaustive 9/9 a,b cases saved.' }, (inner, inputs, out) => {
      const zero = inner.addComponent('normalize-carry', -160, 170);
      const negateA = inner.addComponent('negate', -160, -100);
      const difference = inner.addComponent('normalize-carry', 40, 0);
      const route = inner.addComponent('select3', 190, 0);
      const invert = inner.addComponent('negate', 300, 0);
      inner.connect(inputs[1].id, 'out', zero.id, 'a'); inner.connect(inputs[1].id, 'out', zero.id, 'b'); inner.connect(inputs[1].id, 'out', zero.id, 'c');
      inner.connect(inputs[0].id, 'out', negateA.id, 'in');
      inner.connect(inputs[1].id, 'out', difference.id, 'a'); inner.connect(negateA.id, 'out', difference.id, 'b'); inner.connect(zero.id, 'sum', difference.id, 'c');
      inner.connect(difference.id, 'carry', route.id, 'neg'); inner.connect(difference.id, 'sum', route.id, 'zero'); inner.connect(difference.id, 'carry', route.id, 'pos'); inner.connect(difference.id, 'carry', route.id, 'select');
      inner.connect(route.id, 'out', invert.id, 'in'); inner.connect(invert.id, 'out', out.id, 'in');
    });
    rootCircuit.clear();
    [reference, normalized, reversed].forEach((meta, index) => rootCircuit.addComponent(meta.type, -250 + (index * 250), 0, { label: meta.label }));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Created three ternary comparator constructions, each with the same a,b → out contract and 9 saved cases.');
  }

  function buildSelectorRouterDemo() {
    const add = (labelBase, experiment, inputNames, outputNames, wire, cases) => {
      const label = uniqueName(labelBase, [...customComponents.values()].map((meta) => meta.label), labelBase);
      const id = `${slug(label)}-${Date.now().toString(36)}`;
      const inner = new Circuit(registry);
      const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -360, (index - (inputNames.length - 1) / 2) * 75, { name }));
      const outputs = outputNames.map((name, index) => inner.addComponent('component-output', 360, (index - (outputNames.length - 1) / 2) * 75, { name }));
      wire(inner, inputs, outputs);
      const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment };
      customComponents.set(id, meta); registerCustom(meta); testSuites.push({ componentId: id, cases: cases(inputs, outputs) });
      return meta;
    };
    const selector = add('Selector — Direct Select3', { role: 'reference', nodeCount: 1, depth: 1, primitiveCounts: { select3: 1 }, rationale: 'A packed select trit chooses the -1, 0 or +1 data path directly.', validation: 'Exhaustive 81/81 neg,zero,pos,select cases saved.' }, ['neg', 'zero', 'pos', 'select'], ['out'], (inner, inputs, outputs) => {
      const select = inner.addComponent('select3', 0, 0);
      ['neg', 'zero', 'pos', 'select'].forEach((port, index) => inner.connect(inputs[index].id, 'out', select.id, port)); inner.connect(select.id, 'out', outputs[0].id, 'in');
    }, (inputs, outputs) => {
      const cases = []; for (const neg of [-1, 0, 1]) for (const zero of [-1, 0, 1]) for (const pos of [-1, 0, 1]) for (const select of [-1, 0, 1]) cases.push({ id: `select3-${neg}-${zero}-${pos}-${select}`, name: `neg=${fmt(neg)}, zero=${fmt(zero)}, pos=${fmt(pos)}, select=${fmt(select)}`, inputs: { [inputs[0].id]: neg, [inputs[1].id]: zero, [inputs[2].id]: pos, [inputs[3].id]: select }, expectedOutputs: { [outputs[0].id]: select < 0 ? neg : select > 0 ? pos : zero } }); return cases;
    });
    const router = add('Router — Direct Route3', { role: 'candidate', nodeCount: 1, depth: 1, primitiveCounts: { route3: 1 }, rationale: 'The reciprocal one-to-three router sends input to the selected path and drives inactive paths to zero.', validation: 'Exhaustive 9/9 in,select cases saved.' }, ['in', 'select'], ['neg', 'zero', 'pos'], (inner, inputs, outputs) => {
      const route = inner.addComponent('route3', 0, 0); inner.connect(inputs[0].id, 'out', route.id, 'in'); inner.connect(inputs[1].id, 'out', route.id, 'select'); ['neg', 'zero', 'pos'].forEach((port, index) => inner.connect(route.id, port, outputs[index].id, 'in'));
    }, (inputs, outputs) => {
      const cases = []; for (const value of [-1, 0, 1]) for (const select of [-1, 0, 1]) cases.push({ id: `route3-${value}-${select}`, name: `in=${fmt(value)}, select=${fmt(select)}`, inputs: { [inputs[0].id]: value, [inputs[1].id]: select }, expectedOutputs: { [outputs[0].id]: select < 0 ? value : 0, [outputs[1].id]: select === 0 ? value : 0, [outputs[2].id]: select > 0 ? value : 0 } }); return cases;
    });
    rootCircuit.clear(); [selector, router].forEach((meta, index) => rootCircuit.addComponent(meta.type, -150 + index * 300, 0, { label: meta.label }));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory(); setStatus('Created Select3 and Route3 experiments with 81 and 9 saved contract cases.');
  }

  function buildControlSignalsDemo() {
    const add = (labelBase, experiment, inputNames, outputNames, wire, cases) => {
      const label = uniqueName(labelBase, [...customComponents.values()].map((meta) => meta.label), labelBase);
      const id = `${slug(label)}-${Date.now().toString(36)}`; const inner = new Circuit(registry);
      const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -300, (index - .5) * 90, { name }));
      const outputs = outputNames.map((name, index) => inner.addComponent('component-output', 300, (index - (outputNames.length - 1) / 2) * 75, { name }));
      wire(inner, inputs, outputs); const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment };
      customComponents.set(id, meta); registerCustom(meta); testSuites.push({ componentId: id, cases: cases(inputs, outputs) }); return meta;
    };
    const delta = add('Control — Decrement / hold / increment', { role: 'control experiment', nodeCount: 1, depth: 1, primitiveCounts: { adjust3: 1 }, rationale: 'One control trit is the operation: -1 decrements, 0 holds and +1 increments. Carry is exposed for multi-trit program-counter arithmetic.', validation: 'Exhaustive 9/9 value,control cases saved.' }, ['value', 'control'], ['next', 'carry'], (inner, inputs, outputs) => {
      const adjust = inner.addComponent('adjust3', 0, 0); inner.connect(inputs[0].id, 'out', adjust.id, 'value'); inner.connect(inputs[1].id, 'out', adjust.id, 'control'); inner.connect(adjust.id, 'next', outputs[0].id, 'in'); inner.connect(adjust.id, 'carry', outputs[1].id, 'in');
    }, (inputs, outputs) => { const cases = []; for (const value of [-1, 0, 1]) for (const control of [-1, 0, 1]) { const raw = value + control, carry = raw < -1 ? -1 : raw > 1 ? 1 : 0; cases.push({ id: `adjust3-${value}-${control}`, name: `value=${fmt(value)}, control=${fmt(control)}`, inputs: { [inputs[0].id]: value, [inputs[1].id]: control }, expectedOutputs: { [outputs[0].id]: raw - 3 * carry, [outputs[1].id]: carry } }); } return cases; });
    const access = add('Control — Read / idle / write', { role: 'control experiment', nodeCount: 1, depth: 1, primitiveCounts: { control3: 1 }, rationale: 'Keep read/idle/write packed in one ternary action trit. The three one-hot outputs are only an adapter for devices that require separate physical paths.', validation: 'Exhaustive 3/3 action cases saved.' }, ['action'], ['read', 'idle', 'write'], (inner, inputs, outputs) => {
      const decode = inner.addComponent('control3', 0, 0); inner.connect(inputs[0].id, 'out', decode.id, 'control'); ['neg', 'zero', 'pos'].forEach((port, index) => inner.connect(decode.id, port, outputs[index].id, 'in'));
    }, (inputs, outputs) => { const cases = []; for (const action of [-1, 0, 1]) cases.push({ id: `access-${action}`, name: `action=${fmt(action)}`, inputs: { [inputs[0].id]: action }, expectedOutputs: { [outputs[0].id]: action < 0 ? 1 : 0, [outputs[1].id]: action === 0 ? 1 : 0, [outputs[2].id]: action > 0 ? 1 : 0 } }); return cases; });
    rootCircuit.clear(); [delta, access].forEach((meta, index) => rootCircuit.addComponent(meta.type, -150 + index * 300, 0, { label: meta.label }));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory(); setStatus('Created ternary delta and read/idle/write control experiments with saved contract cases.');
  }

  function buildSequentialStorageDemo() {
    const data = rootCircuit.addComponent('trit-input', -360, -140, { value: 1, label: 'D' });
    const enable = rootCircuit.addComponent('trit-input', -360, -20, { value: 0, label: 'Latch enable' });
    const load = rootCircuit.addComponent('trit-input', -360, 55, { value: 0, label: 'LOAD (+1)' });
    const clock = rootCircuit.addComponent('trit-input', -360, 130, { value: 0, label: 'CLK (0 / +1)' });
    const latch = rootCircuit.addComponent('latch3', 0, -70, { label: 'Transparent latch' });
    const register = rootCircuit.addComponent('register3', 0, 130, { label: 'Edge register' });
    const reset = rootCircuit.addComponent('trit-input', -360, 205, { value: 0, label: 'Reset (+1)' });
    const latchProbe = rootCircuit.addComponent('probe', 290, -70, { label: 'Latch Q' });
    const registerProbe = rootCircuit.addComponent('probe', 290, 130, { label: 'Register Q' });
    rootCircuit.connect(data.id, 'out', latch.id, 'd'); rootCircuit.connect(enable.id, 'out', latch.id, 'enable'); rootCircuit.connect(reset.id, 'out', latch.id, 'reset'); rootCircuit.connect(latch.id, 'q', latchProbe.id, 'in');
    rootCircuit.connect(data.id, 'out', register.id, 'd'); rootCircuit.connect(load.id, 'out', register.id, 'load'); rootCircuit.connect(clock.id, 'out', register.id, 'clock'); rootCircuit.connect(reset.id, 'out', register.id, 'reset'); rootCircuit.connect(register.id, 'q', registerProbe.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Sequential storage demo loaded. Set D and LOAD to +1, then change CLK from 0 to +1 to store D immediately. Use 0 before the next clock pulse.');
  }

  function buildRegisterBankDemo() {
    const data = rootCircuit.addComponent('trit-input', -400, -150, { value: 1, label: 'Write data' });
    const address = rootCircuit.addComponent('trit-input', -400, -55, { value: -1, label: 'Address (-1 / 0 / +1)' });
    const action = rootCircuit.addComponent('trit-input', -400, 45, { value: 0, label: 'Action: read / idle / write' });
    const reset = rootCircuit.addComponent('trit-input', -400, 145, { value: 0, label: 'Reset (+1)' });
    const clock = rootCircuit.addComponent('trit-input', -400, 245, { value: 0, label: 'CLK (0 / +1)' });
    const bank = rootCircuit.addComponent('register-bank3', 0, 20, { label: 'Three-register bank' });
    const read = rootCircuit.addComponent('probe', 320, 20, { label: 'Read bus' });
    rootCircuit.connect(data.id, 'out', bank.id, 'd'); rootCircuit.connect(address.id, 'out', bank.id, 'address'); rootCircuit.connect(action.id, 'out', bank.id, 'action'); rootCircuit.connect(clock.id, 'out', bank.id, 'clock'); rootCircuit.connect(reset.id, 'out', bank.id, 'reset'); rootCircuit.connect(bank.id, 'out', read.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Register bank demo loaded. Action -1 reads, 0 idles and +1 writes on a CLK 0 → +1 transition.');
  }

  function buildWordRegisterBankDemo() {
    const data = rootCircuit.addComponent('word-input6', -430, -130, { values: [0, 0, 0, 0, 0, 1], label: 'Write tryte' });
    const address = rootCircuit.addComponent('trit-input', -430, -30, { value: -1, label: 'Register address' });
    const action = rootCircuit.addComponent('trit-input', -430, 55, { value: 0, label: 'Action: read / idle / write' });
    const reset = rootCircuit.addComponent('trit-input', -430, 140, { value: 0, label: 'Reset (+1)' });
    const clock = rootCircuit.addComponent('trit-input', -430, 225, { value: 0, label: 'CLK (0 / +1)' });
    const bank = rootCircuit.addComponent('register-bank3x6', 0, 25, { label: 'Three tryte registers' });
    const display = rootCircuit.addComponent('word-display6', 330, 25, { label: 'Read tryte' });
    ['5', '4', '3', '2', '1', '0'].forEach((lane) => { rootCircuit.connect(data.id, `t${lane}`, bank.id, `dataIn${lane}`); rootCircuit.connect(bank.id, `dataOut${lane}`, display.id, `t${lane}`); });
    ['address', 'action', 'clock', 'reset'].forEach((name) => rootCircuit.connect(({ address, action, clock, reset })[name].id, 'out', bank.id, name));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit register-bank demo loaded. Action −1 reads one complete tryte, 0 idles and +1 atomically writes the addressed tryte on CLK 0 → +1.');
  }

  function buildLargeMemoryDemo() {
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const address = rootCircuit.addComponent('word-input6', -460, -180, { values: [0, 0, 0, 0, 0, 0], label: 'Six-trit RAM address' });
    const data = rootCircuit.addComponent('word-input6', -460, 20, { values: [0, 0, 0, 0, 0, 1], label: 'RAM write tryte' });
    const action = rootCircuit.addComponent('trit-input', -460, 190, { value: 0, label: 'Action: read / idle / write' });
    const clock = rootCircuit.addComponent('trit-input', -460, 270, { value: 0, label: 'CLK (0 / +1)' });
    const reset = rootCircuit.addComponent('trit-input', -460, 350, { value: 0, label: 'Reset (+1)' });
    const memory = rootCircuit.addComponent('memory729x6', 0, 0, { label: 'Large RAM 729×6' });
    const display = rootCircuit.addComponent('word-display6', 360, 0, { label: 'RAM read tryte' });
    lanes.forEach((lane) => { rootCircuit.connect(address.id, `t${lane}`, memory.id, `address${lane}`); rootCircuit.connect(data.id, `t${lane}`, memory.id, `dataIn${lane}`); rootCircuit.connect(memory.id, `dataOut${lane}`, display.id, `t${lane}`); });
    rootCircuit.connect(action.id, 'out', memory.id, 'action'); rootCircuit.connect(clock.id, 'out', memory.id, 'clock'); rootCircuit.connect(reset.id, 'out', memory.id, 'reset');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Large RAM 729×6 loaded. It has six balanced address trits (−364 … +364) and is a hierarchy of 243×6, 81×6, 27×6, 9×6 and 3×6 banks.');
  }

  function buildProgramCounterDemo() {
    const control = rootCircuit.addComponent('trit-input', -360, -80, { value: 0, label: 'PC control: decrement / hold / increment' });
    const loadData = rootCircuit.addComponent('word-input6', -360, 20, { values: [0, 0, 0, 0, 0, 0], label: 'PC load target' });
    const load = rootCircuit.addComponent('trit-input', -360, 125, { value: 0, label: 'PC load (+1)' });
    const clock = rootCircuit.addComponent('trit-input', -360, 205, { value: 0, label: 'CLK (0 / +1)' });
    const reset = rootCircuit.addComponent('trit-input', -360, 285, { value: 0, label: 'Reset (+1)' });
    const pc = rootCircuit.addComponent('program-counter6', 0, 0, { label: 'Program counter' });
    const display = rootCircuit.addComponent('word-display6', 320, -30, { label: 'PC word' });
    const extension = rootCircuit.addComponent('probe', 320, 105, { label: 'PC extension' });
    rootCircuit.connect(control.id, 'out', pc.id, 'control'); rootCircuit.connect(load.id, 'out', pc.id, 'load'); rootCircuit.connect(clock.id, 'out', pc.id, 'clock'); rootCircuit.connect(reset.id, 'out', pc.id, 'reset');
    ['5', '4', '3', '2', '1', '0'].forEach((lane) => rootCircuit.connect(loadData.id, `t${lane}`, pc.id, `loadData${lane}`));
    ['5', '4', '3', '2', '1', '0'].forEach((lane) => rootCircuit.connect(pc.id, `pc${lane}`, display.id, `t${lane}`));
    rootCircuit.connect(pc.id, 'extension', extension.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit program-counter demo loaded. Reset on CLK 0 → +1; use control −1 / 0 / +1 for normal movement, or set a known target and PC load=+1 to jump on the next edge.');
  }

  function buildCpuDatapathDemo() {
    const alu = createSixTritAluCandidate('CPU datapath ALU', 'controlled-operand', true);
    const label = uniqueName('CPU datapath — 6-trit opening', [...customComponents.values()].map((meta) => meta.label), 'CPU datapath — 6-trit opening');
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const inputNames = [...lanes.map((lane) => `external${lane}`), 'readAAddress', 'readBAddress', 'writeAddress', 'writeAction', 'aluOperation', 'writeBackSelect', 'clock', 'reset'];
    const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -680, (index - 6.5) * 44, { name }));
    const outputs = [...lanes.map((lane, index) => inner.addComponent('component-output', 600, (index - 8.5) * 48, { name: `a${lane}` })), ...lanes.map((lane, index) => inner.addComponent('component-output', 600, (index - 2.5) * 48, { name: `b${lane}` })), ...lanes.map((lane, index) => inner.addComponent('component-output', 600, (index + 3.5) * 48, { name: `result${lane}` })), inner.addComponent('component-output', 600, 300, { name: 'extension' })];
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    const file = inner.addComponent('register-file3x6', -260, 0, { label: 'Dual-read register file' });
    const aluInstance = inner.addComponent(alu.meta.type, 10, 0, { label: 'Selected 6-trit ALU' });
    const writeBack = lanes.map((lane, index) => inner.addComponent('select3', 245, (index - 2.5) * 58, { label: `Write-back lane ${lane}` }));
    ['readAAddress', 'readBAddress', 'writeAddress', 'writeAction', 'clock', 'reset'].forEach((name) => inner.connect(byName[name].id, 'out', file.id, name));
    inner.connect(byName.aluOperation.id, 'out', aluInstance.id, 'operation');
    inner.connect(byName.writeBackSelect.id, 'out', writeBack[0].id, 'select');
    lanes.forEach((lane, index) => {
      if (index > 0) inner.connect(byName.writeBackSelect.id, 'out', writeBack[index].id, 'select');
      inner.connect(file.id, `readA${lane}`, aluInstance.id, `a${lane}`); inner.connect(file.id, `readB${lane}`, aluInstance.id, `b${lane}`);
      inner.connect(byName[`external${lane}`].id, 'out', writeBack[index].id, 'neg');
      inner.connect(file.id, `readA${lane}`, writeBack[index].id, 'zero');
      inner.connect(aluInstance.id, `r${lane}`, writeBack[index].id, 'pos');
      inner.connect(writeBack[index].id, 'out', file.id, `dataIn${lane}`);
      inner.connect(file.id, `readA${lane}`, outputs[index].id, 'in');
      inner.connect(file.id, `readB${lane}`, outputs[index + 6].id, 'in');
      inner.connect(aluInstance.id, `r${lane}`, outputs[index + 12].id, 'in');
    });
    inner.connect(aluInstance.id, 'extension', outputs[18].id, 'in');
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'CPU datapath integration', nodeCount: 26, depth: 10, primitiveCounts: { 'register-file3x6': 1, [alu.meta.type]: 1, select3: 6 },
        metrics: { nodes: 26, depth: 10, wires: inner.wires.size, transitions: 0, transitionScenario: 'register read, ALU operation and one write-back edge' },
        rationale: 'The opening datapath keeps both operand reads explicit. Write-back is one packed ternary select: −1 accepts an external future-memory result, 0 moves A unchanged and +1 accepts the selected ALU result. Only writeAction=+1 commits the selected word on the shared clock edge.',
        validation: 'Register-file and ALU contracts are independently exhaustive; the opening integration is exposed as a reusable component so every data path can be inspected before instruction control is added.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta);
    const external = rootCircuit.addComponent('word-input6', -670, -250, { values: [0, 0, 0, 0, 0, 0], label: 'External write-back word' });
    const readA = rootCircuit.addComponent('trit-input', -670, -100, { value: -1, label: 'Read A address' });
    const readB = rootCircuit.addComponent('trit-input', -670, -35, { value: 0, label: 'Read B address' });
    const writeAddress = rootCircuit.addComponent('trit-input', -670, 30, { value: 1, label: 'Write address' });
    const writeAction = rootCircuit.addComponent('trit-input', -670, 95, { value: 0, label: 'Write action (+1)' });
    const operation = rootCircuit.addComponent('trit-input', -670, 160, { value: 1, label: 'ALU op' });
    const writeBackSelect = rootCircuit.addComponent('trit-input', -670, 225, { value: 1, label: 'Write-back: external / A / ALU' });
    const clock = rootCircuit.addComponent('trit-input', -670, 290, { value: 0, label: 'CLK (0 / +1)' });
    const reset = rootCircuit.addComponent('trit-input', -670, 355, { value: 0, label: 'Reset (+1)' });
    const instance = rootCircuit.addComponent(meta.type, -30, -300, { label });
    const aDisplay = rootCircuit.addComponent('word-display6', 420, -240, { label: 'Operand A' });
    const bDisplay = rootCircuit.addComponent('word-display6', 420, 0, { label: 'Operand B' });
    const resultDisplay = rootCircuit.addComponent('word-display6', 420, 240, { label: 'ALU result' });
    const extension = rootCircuit.addComponent('probe', 420, 405, { label: 'ALU extension' });
    lanes.forEach((lane) => { rootCircuit.connect(external.id, `t${lane}`, instance.id, `external${lane}`); rootCircuit.connect(instance.id, `a${lane}`, aDisplay.id, `t${lane}`); rootCircuit.connect(instance.id, `b${lane}`, bDisplay.id, `t${lane}`); rootCircuit.connect(instance.id, `result${lane}`, resultDisplay.id, `t${lane}`); });
    [[readA, 'readAAddress'], [readB, 'readBAddress'], [writeAddress, 'writeAddress'], [writeAction, 'writeAction'], [operation, 'aluOperation'], [writeBackSelect, 'writeBackSelect'], [clock, 'clock'], [reset, 'reset']].forEach(([source, port]) => rootCircuit.connect(source.id, 'out', instance.id, port));
    rootCircuit.connect(instance.id, 'extension', extension.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Opening CPU datapath loaded. Reset on a clock edge, inspect two register reads and the ALU, then select external / A / ALU write-back and assert write action on the next edge.');
  }

  function buildCpuConsoleDemo(memorySize = 27, withIo = false) {
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const clock = rootCircuit.addComponent('sequence-generator', -610, -220, { sequence: [0, 1], mode: 'loop', auto: false, label: 'Computer clock (CLOCK STEP)' });
    const reset = rootCircuit.addComponent('trit-input', -610, -120, { value: 0, label: 'Memory reset (+1)' });
    const loader = rootCircuit.addComponent('cpu-program-loader6', -360, -210, { label: '18C example-program loader' });
    const cpu = rootCircuit.addComponent('cpu6', -80, -210, { label: 'Opening ternary Computer' });
    const io = withIo ? rootCircuit.addComponent('cpu-io-adapter3x3', 180, -210, { label: 'Memory-mapped joystick / Pixel Display adapter' }) : null;
    const memory = rootCircuit.addComponent(`memory${memorySize}x6`, 250, -210, { label: `Program / data memory ${memorySize}×6` });
    const pc = rootCircuit.addComponent('word-display6', 560, -225, { label: 'PC' });
    const rNeg = rootCircuit.addComponent('word-display6', 560, -80, { label: 'R−' });
    const rZero = rootCircuit.addComponent('word-display6', 560, 65, { label: 'R0' });
    const rPos = rootCircuit.addComponent('word-display6', 560, 210, { label: 'R+' });
    const instruction = rootCircuit.addComponent('word-display6', 560, 355, { label: 'Instruction register' });
    const phase = rootCircuit.addComponent('probe', 250, 190, { label: 'CPU phase: fetch / execute / halted' });
    const halt = rootCircuit.addComponent('probe', 250, 265, { label: 'HALTED (+1)' });
    const joystick = withIo ? rootCircuit.addComponent('input-joystick3', 300, 410, { label: 'Joystick: CPU reads −4 / −3' }) : null;
    const display = withIo ? rootCircuit.addComponent('pixel-display3', 570, 430, { label: 'Pixel Display 3×3: CPU writes +4' }) : null;
    rootCircuit.connect(clock.id, 'out', loader.id, 'clock'); rootCircuit.connect(clock.id, 'out', cpu.id, 'clock'); rootCircuit.connect(clock.id, 'out', memory.id, 'clock'); rootCircuit.connect(reset.id, 'out', memory.id, 'reset'); rootCircuit.connect(loader.id, 'cpuReset', cpu.id, 'reset');
    const bus = io || memory;
    const mux = (name, loaderPort, cpuPort, busPort, y) => { const select = rootCircuit.addComponent('select3', 70, y, { label: `Program loader / CPU ${name}` }); rootCircuit.connect(loader.id, 'done', select.id, 'select'); rootCircuit.connect(loader.id, loaderPort, select.id, 'zero'); rootCircuit.connect(cpu.id, cpuPort, select.id, 'pos'); rootCircuit.connect(select.id, 'out', bus.id, busPort); };
    const addressLanes = memorySize === 27 ? ['2', '1', '0'] : lanes;
    addressLanes.forEach((lane, index) => mux(`address ${lane}`, `address${lane}`, `address${lane}`, `address${lane}`, -335 + index * 55));
    mux('action', 'action', 'memoryAction', 'action', -150);
    lanes.forEach((lane, index) => { mux(`data ${lane}`, `data${lane}`, `memoryWrite${lane}`, `dataIn${lane}`, -60 + index * 55); rootCircuit.connect((io || memory).id, `dataOut${lane}`, cpu.id, `memoryData${lane}`); rootCircuit.connect(cpu.id, `pc${lane}`, pc.id, `t${lane}`); rootCircuit.connect(cpu.id, `rNeg${lane}`, rNeg.id, `t${lane}`); rootCircuit.connect(cpu.id, `rZero${lane}`, rZero.id, `t${lane}`); rootCircuit.connect(cpu.id, `rPos${lane}`, rPos.id, `t${lane}`); rootCircuit.connect(cpu.id, `instruction${lane}`, instruction.id, `t${lane}`); });
    if (io) {
      lanes.forEach((lane) => { rootCircuit.connect(io.id, `ramAddress${lane}`, memory.id, `address${lane}`); rootCircuit.connect(io.id, `ramDataIn${lane}`, memory.id, `dataIn${lane}`); rootCircuit.connect(memory.id, `dataOut${lane}`, io.id, `ramData${lane}`); });
      rootCircuit.connect(io.id, 'ramAction', memory.id, 'action'); rootCircuit.connect(clock.id, 'out', io.id, 'clock'); rootCircuit.connect(reset.id, 'out', io.id, 'reset'); rootCircuit.connect(loader.id, 'done', io.id, 'ioEnable');
      rootCircuit.connect(joystick.id, 'x', io.id, 'joystickX'); rootCircuit.connect(joystick.id, 'y', io.id, 'joystickY');
      rootCircuit.connect(io.id, 'displayX', display.id, 'x'); rootCircuit.connect(io.id, 'displayY', display.id, 'y'); rootCircuit.connect(io.id, 'displayColor', display.id, 'color'); rootCircuit.connect(io.id, 'displayClearBeforeWrite', display.id, 'clearBeforeWrite'); rootCircuit.connect(io.id, 'displayClock', display.id, 'clock'); rootCircuit.connect(io.id, 'displayReset', display.id, 'reset');
    }
    rootCircuit.connect(cpu.id, 'phase', phase.id, 'in'); rootCircuit.connect(cpu.id, 'halted', halt.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus(withIo ? 'Interactive CPU I/O console loaded. Program code remains in RAM; after loading, LOAD [R−] at −4 / −3 reads joystick X / Y and STORE [R+] at +4 writes packed x/y/color to Pixel Display 3×3.' : 'Runnable CPU console loaded. The example loader writes six program words through Memory 27×6, then releases the CPU automatically. Run computer now executes LIT, ADD, STORE, LOAD and HALT; select Memory 27×6 to inspect its program list.');
  }

  function buildStructuralCpuArchitecture(loadDemo = false) {
    const label = uniqueName('Opening CPU — architecture reference', [...customComponents.values()].map((meta) => meta.label), 'Opening CPU — architecture reference');
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const clock = inner.addComponent('component-input', -620, -220, { name: 'clock' });
    const reset = inner.addComponent('component-input', -620, -150, { name: 'reset' });
    const memory = lanes.map((lane, index) => inner.addComponent('component-input', -620, -70 + index * 45, { name: `memoryData${lane}` }));
    const pc = inner.addComponent('program-counter6', -310, -210, { label: 'Program counter' });
    const sequencer = inner.addComponent('cpu-sequencer3', -310, 20, { label: 'Fetch / execute sequencer' });
    const instruction = inner.addComponent('instruction-register6', -60, -170, { label: 'Instruction register' });
    const control = inner.addComponent('instruction-control6', 180, -170, { label: 'Instruction decode / control' });
    const registers = inner.addComponent('register-file3x6', 180, 90, { label: 'Dual-read register file' });
    const timing = inner.addComponent('cpu-memory-cycle6', 410, -70, { label: 'Memory-cycle timing' });
    const flow = inner.addComponent('cpu-control-flow6', 410, 130, { label: 'Branch / PC control' });
    const port = inner.addComponent('cpu-memory-port27', 650, 20, { label: 'Memory 27×6 port' });
    [pc, sequencer, instruction, registers].forEach((component) => { inner.connect(clock.id, 'out', component.id, 'clock'); inner.connect(reset.id, 'out', component.id, 'reset'); });
    lanes.forEach((lane, index) => { inner.connect(memory[index].id, 'out', instruction.id, `instruction${lane}`); inner.connect(instruction.id, `instruction${lane}`, control.id, `instruction${lane}`); });
    inner.connect(sequencer.id, 'phase', control.id, 'phase'); inner.connect(sequencer.id, 'phase', timing.id, 'phase'); inner.connect(control.id, 'memoryAction', timing.id, 'executeAction'); inner.connect(control.id, 'registerWrite', timing.id, 'executeRegisterWrite');
    const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment: { role: 'documented CPU architecture reference', nodeCount: 8, depth: 5, primitiveCounts: { 'program-counter6': 1, 'cpu-sequencer3': 1, 'instruction-register6': 1, 'instruction-control6': 1, 'register-file3x6': 1, 'cpu-memory-cycle6': 1, 'cpu-control-flow6': 1, 'cpu-memory-port27': 1 }, rationale: 'This is the inspectable architecture map for the accelerated CPU machine boundary. Each named state, control and memory subsystem retains its own public contract and documented structural reference where available.', validation: 'The CPU6 machine contract exercises the corresponding public PC, register, control and memory transitions end-to-end.' } };
    customComponents.set(id, meta); registerCustom(meta); structuralReferences.set('structural-cpu6-v1', meta);
    return { 'structural-cpu6-v1': meta };
  }

  function buildDeviceCellsDemo() {
    const signal = rootCircuit.addComponent('trit-input', -410, -155, { value: 1, label: 'Signal level' });
    const switchGate = rootCircuit.addComponent('trit-input', -410, -45, { value: 0, label: 'Pass gate (+1)' });
    const write = rootCircuit.addComponent('trit-input', -410, 75, { value: 0, label: 'Write (+1)' });
    const reset = rootCircuit.addComponent('trit-input', -410, 185, { value: 0, label: 'Reset (+1)' });
    const restorer = rootCircuit.addComponent('restore3', -120, -155, { label: 'Level restorer' });
    const detector = rootCircuit.addComponent('threshold3', 80, -155, { label: 'Level detector' });
    const pass = rootCircuit.addComponent('pass3', -120, -35, { label: 'Pass switch' });
    const storage = rootCircuit.addComponent('storage-node3', 100, 85, { label: 'Storage node' });
    const passProbe = rootCircuit.addComponent('probe', 340, -35, { label: 'Pass output' });
    const nodeProbe = rootCircuit.addComponent('probe', 340, 85, { label: 'Stored Q' });
    const negProbe = rootCircuit.addComponent('probe', 340, -225, { label: 'Negative detected' });
    const zeroProbe = rootCircuit.addComponent('probe', 340, -155, { label: 'Zero detected' });
    const posProbe = rootCircuit.addComponent('probe', 340, -85, { label: 'Positive detected' });
    const mergeA = rootCircuit.addComponent('trit-input', -410, 330, { value: -1, label: 'Merge A' });
    const mergeAGate = rootCircuit.addComponent('trit-input', -410, 380, { value: 1, label: 'A gate' });
    const mergeB = rootCircuit.addComponent('trit-input', -410, 470, { value: 0, label: 'Merge B' });
    const mergeBGate = rootCircuit.addComponent('trit-input', -410, 520, { value: 0, label: 'B gate' });
    const mergeC = rootCircuit.addComponent('trit-input', -410, 610, { value: 1, label: 'Merge C' });
    const mergeCGate = rootCircuit.addComponent('trit-input', -410, 660, { value: 0, label: 'C gate' });
    const mergePassA = rootCircuit.addComponent('pass3', -120, 330, { label: 'A pass' });
    const mergePassB = rootCircuit.addComponent('pass3', -120, 470, { label: 'B pass' });
    const mergePassC = rootCircuit.addComponent('pass3', -120, 610, { label: 'C pass' });
    const merge = rootCircuit.addComponent('merge3', 100, 470, { label: 'Resolved merge' });
    const mergeProbe = rootCircuit.addComponent('probe', 350, 470, { label: 'Merged output' });
    rootCircuit.connect(signal.id, 'out', restorer.id, 'in'); rootCircuit.connect(restorer.id, 'out', detector.id, 'in');
    rootCircuit.connect(restorer.id, 'out', pass.id, 'in'); rootCircuit.connect(switchGate.id, 'out', pass.id, 'gate'); rootCircuit.connect(pass.id, 'out', passProbe.id, 'in');
    rootCircuit.connect(restorer.id, 'out', storage.id, 'drive'); rootCircuit.connect(write.id, 'out', storage.id, 'write'); rootCircuit.connect(reset.id, 'out', storage.id, 'reset'); rootCircuit.connect(storage.id, 'q', nodeProbe.id, 'in');
    rootCircuit.connect(detector.id, 'neg', negProbe.id, 'in'); rootCircuit.connect(detector.id, 'zero', zeroProbe.id, 'in'); rootCircuit.connect(detector.id, 'pos', posProbe.id, 'in');
    rootCircuit.connect(mergeA.id, 'out', mergePassA.id, 'in'); rootCircuit.connect(mergeAGate.id, 'out', mergePassA.id, 'gate'); rootCircuit.connect(mergePassA.id, 'out', merge.id, 'a');
    rootCircuit.connect(mergeB.id, 'out', mergePassB.id, 'in'); rootCircuit.connect(mergeBGate.id, 'out', mergePassB.id, 'gate'); rootCircuit.connect(mergePassB.id, 'out', merge.id, 'b');
    rootCircuit.connect(mergeC.id, 'out', mergePassC.id, 'in'); rootCircuit.connect(mergeCGate.id, 'out', mergePassC.id, 'gate'); rootCircuit.connect(mergePassC.id, 'out', merge.id, 'c');
    rootCircuit.connect(merge.id, 'out', mergeProbe.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Device cell demo loaded. The Merge3 section joins three pass paths: set exactly one gate to +1; all off yields Z and two enabled paths yield ? for contention.');
  }

  function addSixTritWordCases(componentId, inputs, outputs) {
    const cases = [];
    for (const t5 of [-1, 0, 1]) for (const t4 of [-1, 0, 1]) for (const t3 of [-1, 0, 1]) {
      for (const t2 of [-1, 0, 1]) for (const t1 of [-1, 0, 1]) for (const t0 of [-1, 0, 1]) {
        const values = [t5, t4, t3, t2, t1, t0];
        const inputValues = Object.fromEntries(inputs.map((input, index) => [input.id, values[index]]));
        const expectedOutputs = Object.fromEntries(outputs.map((output, index) => [output.id, values[index]]));
        cases.push({ id: `word-${values.join('-')}`, name: `word ${values.map(fmt).join(' ')}`, inputs: inputValues, expectedOutputs });
      }
    }
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildSixTritWordDemo() {
    // A word is a named bundle of six independent balanced-trit lanes. It has
    // no storage or arithmetic; those belong to the register and ALU layers.
    const label = uniqueName('6-trit word', [...customComponents.values()].map((meta) => meta.label), '6-trit word');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const inputs = names.map((name, index) => inner.addComponent('component-input', -290, -145 + index * 58, { name, label: `${name} (${weights[index]})` }));
    const outputs = names.map((name, index) => inner.addComponent('component-output', 290, -145 + index * 58, { name, label: `${name} (${weights[index]})` }));
    inputs.forEach((input, index) => inner.connect(input.id, 'out', outputs[index].id, 'in'));
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'word interface', nodeCount: 0, depth: 0, primitiveCounts: {},
        metrics: { nodes: 0, depth: 0, wires: inner.wires.size, transitions: 0, transitionScenario: 'a passive word interface does not change a trit' },
        rationale: 'Names and orders six parallel balanced-trit lanes without inventing hidden storage or logic. t5 is the most-significant trit (weight 243) and t0 is the least-significant trit (weight 1).',
        validation: 'Exhaustive 729/729 words preserve each lane unchanged.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); addSixTritWordCases(id, inputs, outputs);
    const initial = [1, 0, 0, 0, 0, 0];
    const controls = names.map((name, index) => rootCircuit.addComponent('trit-input', -390, -145 + index * 58, { value: initial[index], label: `${name} · ${weights[index]}s` }));
    const word = rootCircuit.addComponent(meta.type, -20, -165, { label });
    const probes = names.map((name, index) => rootCircuit.addComponent('probe', 270, -145 + index * 58, { label: `${name} out` }));
    controls.forEach((control, index) => rootCircuit.connect(control.id, 'out', word.id, names[index]));
    probes.forEach((probe, index) => rootCircuit.connect(word.id, names[index], probe.id, 'in'));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit word component loaded. It preserves six named lanes (t5…t0, weights 243…1); all 729 possible words are saved as contract cases. Open it to inspect the explicit word boundary.');
  }

  function balancedWordDigits(value, width = 6) {
    const digits = [];
    let remaining = Number(value);
    for (let index = 0; index < width; index += 1) {
      const remainder = ((remaining % 3) + 3) % 3;
      const digit = remainder === 2 ? -1 : remainder;
      digits.unshift(digit);
      remaining = (remaining - digit) / 3;
    }
    if (remaining !== 0) throw new Error(`${value} does not fit in ${width} balanced trits.`);
    return digits;
  }

  function addSixTritAdderCases(componentId, aInputs, bInputs, carryInput, sumOutputs, carryOutput) {
    const vectors = [
      { name: 'zero + zero', a: 0, b: 0, carry: 0 },
      { name: 'one + one', a: 1, b: 1, carry: 0 },
      { name: 'positive ripple', a: 364, b: 1, carry: 0 },
      { name: 'negative ripple', a: -364, b: -1, carry: 0 },
      { name: 'full positive overflow', a: 364, b: 364, carry: 1 },
      { name: 'full negative overflow', a: -364, b: -364, carry: -1 },
      { name: 'mixed signs with carry in', a: 123, b: -45, carry: 1 },
    ];
    const cases = vectors.map((vector) => {
      const a = balancedWordDigits(vector.a), b = balancedWordDigits(vector.b);
      const raw = vector.a + vector.b + vector.carry;
      const carry = raw < -364 ? -1 : raw > 364 ? 1 : 0;
      const sum = balancedWordDigits(raw - 729 * carry);
      return {
        id: `six-trit-add-${vector.a}-${vector.b}-${vector.carry}`, name: vector.name,
        inputs: { ...Object.fromEntries(aInputs.map((input, index) => [input.id, a[index]])), ...Object.fromEntries(bInputs.map((input, index) => [input.id, b[index]])), [carryInput.id]: vector.carry },
        expectedOutputs: { ...Object.fromEntries(sumOutputs.map((output, index) => [output.id, sum[index]])), [carryOutput.id]: carry },
      };
    });
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildSixTritAdderDemo() {
    const label = uniqueName('6-trit ripple adder', [...customComponents.values()].map((meta) => meta.label), '6-trit ripple adder');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const aInputs = names.map((name, index) => inner.addComponent('component-input', -480, -250 + index * 86, { name: `a${name.slice(1)}`, label: `A${name.slice(1)} (${weights[index]})` }));
    const bInputs = names.map((name, index) => inner.addComponent('component-input', -350, -250 + index * 86, { name: `b${name.slice(1)}`, label: `B${name.slice(1)} (${weights[index]})` }));
    const carryInput = inner.addComponent('component-input', -480, 300, { name: 'carryIn', label: 'Carry in' });
    const adders = names.map((name, index) => inner.addComponent('normalize-carry', -20, -250 + index * 86, { label: `Add ${name}` }));
    const sumOutputs = names.map((name, index) => inner.addComponent('component-output', 250, -250 + index * 86, { name: `s${name.slice(1)}`, label: `Sum ${name.slice(1)}` }));
    const carryOutput = inner.addComponent('component-output', 250, -330, { name: 'carryOut', label: 'Carry out' });
    for (let index = 0; index < names.length; index += 1) {
      inner.connect(aInputs[index].id, 'out', adders[index].id, 'a');
      inner.connect(bInputs[index].id, 'out', adders[index].id, 'b');
      inner.connect(adders[index].id, 'sum', sumOutputs[index].id, 'in');
      if (index === names.length - 1) inner.connect(carryInput.id, 'out', adders[index].id, 'c');
      else inner.connect(adders[index + 1].id, 'carry', adders[index].id, 'c');
    }
    inner.connect(adders[0].id, 'carry', carryOutput.id, 'in');
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'six-trit arithmetic building block', nodeCount: 6, depth: 6, primitiveCounts: { 'normalize-carry': 6 },
        metrics: { nodes: 6, depth: 6, wires: inner.wires.size, transitions: 0, transitionScenario: 'static arithmetic result; transition count intentionally not measured yet' },
        rationale: 'Six Normalize / carry cells form a least-significant-to-most-significant ripple chain. Each cell keeps its sum trit and forwards only balanced carry to the next weight. Carry out is a signed word-extension trit: A + B + Carry in = Sum + 729 × Carry out. It is -1 below the six-trit range, 0 in range, and +1 above it; results wrap canonically rather than saturating or trapping.',
        validation: 'Each cell uses the 27-case full-adder contract; saved word cases cover zero, mixed-sign addition and both signed word-boundary overflows.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); addSixTritAdderCases(id, aInputs, bInputs, carryInput, sumOutputs, carryOutput);
    const aValue = 1, bValue = 1, carryValue = 0;
    const aDigits = balancedWordDigits(aValue), bDigits = balancedWordDigits(bValue);
    const controls = [
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -500, -250 + index * 58, { value: aDigits[index], label: `A${name.slice(1)} · ${weights[index]}s` })),
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -350, -250 + index * 58, { value: bDigits[index], label: `B${name.slice(1)} · ${weights[index]}s` })),
      rootCircuit.addComponent('trit-input', -500, 130, { value: carryValue, label: 'Carry in' }),
    ];
    const adder = rootCircuit.addComponent(meta.type, -20, -270, { label });
    const probes = [
      ...names.map((name, index) => rootCircuit.addComponent('probe', 280, -250 + index * 58, { label: `Sum ${name.slice(1)}` })),
      rootCircuit.addComponent('probe', 280, 130, { label: 'Carry out' }),
    ];
    aInputs.forEach((input, index) => rootCircuit.connect(controls[index].id, 'out', adder.id, input.state.name));
    bInputs.forEach((input, index) => rootCircuit.connect(controls[index + 6].id, 'out', adder.id, input.state.name));
    rootCircuit.connect(controls[12].id, 'out', adder.id, 'carryIn');
    sumOutputs.forEach((output, index) => rootCircuit.connect(adder.id, output.state.name, probes[index].id, 'in'));
    rootCircuit.connect(adder.id, 'carryOut', probes[6].id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit ripple adder loaded. Set A, B and Carry in; inspect Sum t5…t0 and Carry out. Open the component to follow the six Normalize / carry cells from t0 toward t5.');
  }

  function addSixTritNegateCases(componentId, inputs, outputs) {
    const cases = [];
    for (let value = -364; value <= 364; value += 1) {
      const source = balancedWordDigits(value), expected = balancedWordDigits(-value);
      cases.push({
        id: `six-trit-negate-${value}`, name: `negate ${value}`,
        inputs: Object.fromEntries(inputs.map((input, index) => [input.id, source[index]])),
        expectedOutputs: Object.fromEntries(outputs.map((output, index) => [output.id, expected[index]])),
      });
    }
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function addSixTritSubtractCases(componentId, aInputs, bInputs, carryInput, differenceOutputs, carryOutput) {
    const vectors = [
      { name: 'zero minus zero', a: 0, b: 0, carry: 0 },
      { name: 'zero minus one', a: 0, b: 1, carry: 0 },
      { name: 'negative ripple', a: -364, b: 1, carry: 0 },
      { name: 'positive ripple', a: 364, b: -1, carry: 0 },
      { name: 'positive word overflow', a: 364, b: -364, carry: 0 },
      { name: 'negative word overflow', a: -364, b: 364, carry: 0 },
      { name: 'mixed signs with carry in', a: 123, b: -45, carry: -1 },
    ];
    const cases = vectors.map((vector) => {
      const a = balancedWordDigits(vector.a), b = balancedWordDigits(vector.b);
      const raw = vector.a - vector.b + vector.carry;
      const carry = raw < -364 ? -1 : raw > 364 ? 1 : 0;
      const difference = balancedWordDigits(raw - 729 * carry);
      return {
        id: `six-trit-sub-${vector.a}-${vector.b}-${vector.carry}`, name: vector.name,
        inputs: { ...Object.fromEntries(aInputs.map((input, index) => [input.id, a[index]])), ...Object.fromEntries(bInputs.map((input, index) => [input.id, b[index]])), [carryInput.id]: vector.carry },
        expectedOutputs: { ...Object.fromEntries(differenceOutputs.map((output, index) => [output.id, difference[index]])), [carryOutput.id]: carry },
      };
    });
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildSixTritSubtractorDemo() {
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const negatorLabel = uniqueName('6-trit negate', [...customComponents.values()].map((meta) => meta.label), '6-trit negate');
    const negatorId = `${slug(negatorLabel)}-${Date.now().toString(36)}`;
    const negatorInner = new Circuit(registry);
    const negateInputs = names.map((name, index) => negatorInner.addComponent('component-input', -260, -150 + index * 60, { name: `in${name.slice(1)}`, label: `In ${name.slice(1)}` }));
    const negates = names.map((name, index) => negatorInner.addComponent('negate', 0, -150 + index * 60, { label: `Negate ${name}` }));
    const negateOutputs = names.map((name, index) => negatorInner.addComponent('component-output', 240, -150 + index * 60, { name: `out${name.slice(1)}`, label: `Out ${name.slice(1)}` }));
    names.forEach((name, index) => { negatorInner.connect(negateInputs[index].id, 'out', negates[index].id, 'in'); negatorInner.connect(negates[index].id, 'out', negateOutputs[index].id, 'in'); });
    const negatorMeta = {
      id: negatorId, type: `custom:${negatorId}`, label: negatorLabel, circuit: negatorInner.serialize(),
      experiment: { role: 'six-trit arithmetic building block', nodeCount: 6, depth: 1, primitiveCounts: { negate: 6 }, metrics: { nodes: 6, depth: 1, wires: negatorInner.wires.size, transitions: 0, transitionScenario: 'static negation; transition count intentionally not measured yet' }, rationale: 'Balanced ternary negation is digitwise: every +1 becomes -1, every -1 becomes +1, and zero remains zero. No carry chain is needed.', validation: 'Exhaustive 729/729 word cases saved.' },
    };
    customComponents.set(negatorId, negatorMeta); registerCustom(negatorMeta); addSixTritNegateCases(negatorId, negateInputs, negateOutputs);

    const subtractLabel = uniqueName('6-trit subtractor', [...customComponents.values()].map((meta) => meta.label), '6-trit subtractor');
    const subtractId = `${slug(subtractLabel)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const aInputs = names.map((name, index) => inner.addComponent('component-input', -520, -250 + index * 86, { name: `a${name.slice(1)}`, label: `A${name.slice(1)} (${weights[index]})` }));
    const bInputs = names.map((name, index) => inner.addComponent('component-input', -390, -250 + index * 86, { name: `b${name.slice(1)}`, label: `B${name.slice(1)} (${weights[index]})` }));
    const carryInput = inner.addComponent('component-input', -520, 300, { name: 'carryIn', label: 'Carry in' });
    const negator = inner.addComponent(negatorMeta.type, -170, -270, { label: negatorLabel });
    const adders = names.map((name, index) => inner.addComponent('normalize-carry', 100, -250 + index * 86, { label: `Subtract ${name}` }));
    const differenceOutputs = names.map((name, index) => inner.addComponent('component-output', 380, -250 + index * 86, { name: `d${name.slice(1)}`, label: `Difference ${name.slice(1)}` }));
    const carryOutput = inner.addComponent('component-output', 380, -330, { name: 'carryOut', label: 'Carry out' });
    for (let index = 0; index < names.length; index += 1) {
      inner.connect(aInputs[index].id, 'out', adders[index].id, 'a');
      inner.connect(bInputs[index].id, 'out', negator.id, negateInputs[index].state.name);
      inner.connect(negator.id, negateOutputs[index].state.name, adders[index].id, 'b');
      inner.connect(adders[index].id, 'sum', differenceOutputs[index].id, 'in');
      if (index === names.length - 1) inner.connect(carryInput.id, 'out', adders[index].id, 'c');
      else inner.connect(adders[index + 1].id, 'carry', adders[index].id, 'c');
    }
    inner.connect(adders[0].id, 'carry', carryOutput.id, 'in');
    const subtractMeta = {
      id: subtractId, type: `custom:${subtractId}`, label: subtractLabel, circuit: inner.serialize(),
      experiment: { role: 'six-trit arithmetic building block', nodeCount: 12, depth: 7, primitiveCounts: { negate: 6, 'normalize-carry': 6 }, metrics: { nodes: 12, depth: 7, wires: inner.wires.size, transitions: 0, transitionScenario: 'static subtraction result; transition count intentionally not measured yet' }, rationale: 'Subtraction is addition of the digitwise negated B word. The reusable negator feeds the same six-cell Normalize / carry ripple strategy as addition; Carry in supports a ternary adjustment or a later multi-word carry chain. Carry out has the same signed-extension meaning as addition: -1 is a negative underflow (the balanced-ternary borrow direction), 0 is in range and +1 is a positive overflow. It is not a binary no-borrow flag.', validation: 'Negator has 729 saved cases; saved subtractor cases cover zero, mixed signs and both signed word-boundary overflows.' },
    };
    customComponents.set(subtractId, subtractMeta); registerCustom(subtractMeta); addSixTritSubtractCases(subtractId, aInputs, bInputs, carryInput, differenceOutputs, carryOutput);
    const aValue = 1, bValue = 1, carryValue = 0;
    const aDigits = balancedWordDigits(aValue), bDigits = balancedWordDigits(bValue);
    const controls = [
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -520, -250 + index * 58, { value: aDigits[index], label: `A${name.slice(1)} · ${weights[index]}s` })),
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -370, -250 + index * 58, { value: bDigits[index], label: `B${name.slice(1)} · ${weights[index]}s` })),
      rootCircuit.addComponent('trit-input', -520, 130, { value: carryValue, label: 'Carry in' }),
    ];
    const subtractor = rootCircuit.addComponent(subtractMeta.type, -40, -270, { label: subtractLabel });
    const probes = [
      ...names.map((name, index) => rootCircuit.addComponent('probe', 300, -250 + index * 58, { label: `Difference ${name.slice(1)}` })),
      rootCircuit.addComponent('probe', 300, 130, { label: 'Carry out' }),
    ];
    aInputs.forEach((input, index) => rootCircuit.connect(controls[index].id, 'out', subtractor.id, input.state.name));
    bInputs.forEach((input, index) => rootCircuit.connect(controls[index + 6].id, 'out', subtractor.id, input.state.name));
    rootCircuit.connect(controls[12].id, 'out', subtractor.id, 'carryIn');
    differenceOutputs.forEach((output, index) => rootCircuit.connect(subtractor.id, output.state.name, probes[index].id, 'in'));
    rootCircuit.connect(subtractor.id, 'carryOut', probes[6].id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit negate / subtract demo loaded. It computes A − B + Carry in. Open the subtractor, then open 6-trit negate, to inspect digitwise negation feeding the Normalize / carry ripple chain.');
  }

  function addSixTritComparatorCases(componentId, aInputs, bInputs, outputs) {
    const vectors = [
      { name: 'equal zero', a: 0, b: 0 },
      { name: 'least-significant difference', a: 0, b: 1 },
      { name: 'least-significant greater', a: 1, b: 0 },
      { name: 'most-significant difference wins', a: 243, b: 242 },
      { name: 'negative versus positive', a: -1, b: 1 },
      { name: 'lower word boundary', a: -364, b: -363 },
      { name: 'upper word boundary', a: 364, b: 363 },
      { name: 'equal mixed word', a: -123, b: -123 },
    ];
    const cases = vectors.map((vector) => {
      const order = vector.a < vector.b ? -1 : vector.a > vector.b ? 1 : 0;
      const a = balancedWordDigits(vector.a), b = balancedWordDigits(vector.b);
      return {
        id: `six-trit-compare-${vector.a}-${vector.b}`, name: vector.name,
        inputs: { ...Object.fromEntries(aInputs.map((input, index) => [input.id, a[index]])), ...Object.fromEntries(bInputs.map((input, index) => [input.id, b[index]])) },
        expectedOutputs: { [outputs.order.id]: order, [outputs.less.id]: order < 0 ? 1 : 0, [outputs.equal.id]: order === 0 ? 1 : 0, [outputs.greater.id]: order > 0 ? 1 : 0 },
      };
    });
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildSixTritComparatorDemo() {
    const label = uniqueName('6-trit comparator', [...customComponents.values()].map((meta) => meta.label), '6-trit comparator');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const aInputs = names.map((name, index) => inner.addComponent('component-input', -520, -250 + index * 80, { name: `a${name.slice(1)}`, label: `A${name.slice(1)} (${weights[index]})` }));
    const bInputs = names.map((name, index) => inner.addComponent('component-input', -390, -250 + index * 80, { name: `b${name.slice(1)}`, label: `B${name.slice(1)} (${weights[index]})` }));
    const compares = names.map((name, index) => inner.addComponent('compare', -150, -250 + index * 80, { label: `Compare ${name}` }));
    aInputs.forEach((input, index) => { inner.connect(input.id, 'out', compares[index].id, 'a'); inner.connect(bInputs[index].id, 'out', compares[index].id, 'b'); });
    let orderSource = compares[names.length - 1];
    for (let index = names.length - 2; index >= 0; index -= 1) {
      const choose = inner.addComponent('select3', 60 + (names.length - 2 - index) * 150, -250 + index * 80, { label: `Keep ${names[index]} unless equal` });
      inner.connect(compares[index].id, 'out', choose.id, 'neg');
      inner.connect(orderSource.id, 'out', choose.id, 'zero');
      inner.connect(compares[index].id, 'out', choose.id, 'pos');
      inner.connect(compares[index].id, 'out', choose.id, 'select');
      orderSource = choose;
    }
    const decode = inner.addComponent('threshold3', 830, 0, { label: 'Decode comparison result' });
    const order = inner.addComponent('component-output', 1050, -100, { name: 'order', label: 'Order (−1 / 0 / +1)' });
    const less = inner.addComponent('component-output', 1050, -30, { name: 'less', label: 'Less (0 / +1)' });
    const equal = inner.addComponent('component-output', 1050, 40, { name: 'equal', label: 'Equal (0 / +1)' });
    const greater = inner.addComponent('component-output', 1050, 110, { name: 'greater', label: 'Greater (0 / +1)' });
    inner.connect(orderSource.id, 'out', order.id, 'in');
    inner.connect(orderSource.id, 'out', decode.id, 'in');
    inner.connect(decode.id, 'neg', less.id, 'in');
    inner.connect(decode.id, 'zero', equal.id, 'in');
    inner.connect(decode.id, 'pos', greater.id, 'in');
    const outputs = { order, less, equal, greater };
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'six-trit control building block', nodeCount: 12, depth: 7, primitiveCounts: { compare: 6, select3: 5, threshold3: 1 },
        metrics: { nodes: 12, depth: 7, wires: inner.wires.size, transitions: 0, transitionScenario: 'static comparison result; transition count intentionally not measured yet' },
        rationale: 'Each trit pair is compared with the proven Compare contract. Five Select3 stages scan from t5 to t0: a nonzero higher-order comparison is retained, while equality allows the next lower-order result through. Order is the native balanced control trit (-1 less, 0 equal, +1 greater). Threshold3 exposes one-hot 0/+1 less, equal and greater flags only at the CPU/control boundary.',
        validation: 'Saved vectors cover equality, least- and most-significant differences, signs and both word boundaries; the word ordering contract is exhaustively checked for all 729 × 729 input pairs in the automated suite.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); addSixTritComparatorCases(id, aInputs, bInputs, outputs);
    const aValue = 243, bValue = 242;
    const aDigits = balancedWordDigits(aValue), bDigits = balancedWordDigits(bValue);
    const controls = [
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -520, -250 + index * 58, { value: aDigits[index], label: `A${name.slice(1)} · ${weights[index]}s` })),
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -370, -250 + index * 58, { value: bDigits[index], label: `B${name.slice(1)} · ${weights[index]}s` })),
    ];
    const comparator = rootCircuit.addComponent(meta.type, -20, -270, { label });
    const probes = [
      rootCircuit.addComponent('probe', 360, -100, { label: 'Order' }), rootCircuit.addComponent('probe', 360, -30, { label: 'Less' }),
      rootCircuit.addComponent('probe', 360, 40, { label: 'Equal' }), rootCircuit.addComponent('probe', 360, 110, { label: 'Greater' }),
    ];
    aInputs.forEach((input, index) => rootCircuit.connect(controls[index].id, 'out', comparator.id, input.state.name));
    bInputs.forEach((input, index) => rootCircuit.connect(controls[index + 6].id, 'out', comparator.id, input.state.name));
    ['order', 'less', 'equal', 'greater'].forEach((name, index) => rootCircuit.connect(comparator.id, name, probes[index].id, 'in'));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit comparator loaded. Order is −1 / 0 / +1 for A < B / A = B / A > B; Less, Equal and Greater are 0/+1 control flags. Open it to follow the most-significant-first Compare / Select3 chain.');
  }

  function addSixTritSelectorCases(componentId, negInputs, zeroInputs, posInputs, selectInput, outputs) {
    const vectors = [
      { name: 'select negative word', neg: -364, zero: 0, pos: 364, select: -1 },
      { name: 'select zero word', neg: -364, zero: 123, pos: 364, select: 0 },
      { name: 'select positive word', neg: -364, zero: 0, pos: 364, select: 1 },
      { name: 'negative channel mixed word', neg: -123, zero: 0, pos: 123, select: -1 },
      { name: 'zero channel mixed word', neg: -123, zero: -1, pos: 123, select: 0 },
      { name: 'positive channel mixed word', neg: -123, zero: 0, pos: 1, select: 1 },
    ];
    const cases = vectors.map((vector) => {
      const neg = balancedWordDigits(vector.neg), zero = balancedWordDigits(vector.zero), pos = balancedWordDigits(vector.pos);
      const selected = vector.select < 0 ? neg : vector.select > 0 ? pos : zero;
      return {
        id: `six-trit-select-${vector.select}-${vector.neg}-${vector.zero}-${vector.pos}`, name: vector.name,
        inputs: {
          ...Object.fromEntries(negInputs.map((input, index) => [input.id, neg[index]])),
          ...Object.fromEntries(zeroInputs.map((input, index) => [input.id, zero[index]])),
          ...Object.fromEntries(posInputs.map((input, index) => [input.id, pos[index]])),
          [selectInput.id]: vector.select,
        },
        expectedOutputs: Object.fromEntries(outputs.map((output, index) => [output.id, selected[index]])),
      };
    });
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildSixTritSelectorDemo() {
    const label = uniqueName('6-trit Select3', [...customComponents.values()].map((meta) => meta.label), '6-trit Select3');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const makeInputs = (prefix, x, labelPrefix) => names.map((name, index) => inner.addComponent('component-input', x, -250 + index * 80, { name: `${prefix}${name.slice(1)}`, label: `${labelPrefix}${name.slice(1)} (${weights[index]})` }));
    const negInputs = makeInputs('neg', -540, 'Neg ');
    const zeroInputs = makeInputs('zero', -400, 'Zero ');
    const posInputs = makeInputs('pos', -260, 'Pos ');
    const selectInput = inner.addComponent('component-input', -540, 285, { name: 'select', label: 'Shared select' });
    const selectors = names.map((name, index) => inner.addComponent('select3', 0, -250 + index * 80, { label: `Select ${name}` }));
    const outputs = names.map((name, index) => inner.addComponent('component-output', 260, -250 + index * 80, { name: `out${name.slice(1)}`, label: `Out ${name.slice(1)}` }));
    selectors.forEach((selector, index) => {
      inner.connect(negInputs[index].id, 'out', selector.id, 'neg');
      inner.connect(zeroInputs[index].id, 'out', selector.id, 'zero');
      inner.connect(posInputs[index].id, 'out', selector.id, 'pos');
      inner.connect(selectInput.id, 'out', selector.id, 'select');
      inner.connect(selector.id, 'out', outputs[index].id, 'in');
    });
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'six-trit routing building block', nodeCount: 6, depth: 1, primitiveCounts: { select3: 6 },
        metrics: { nodes: 6, depth: 1, wires: inner.wires.size, transitions: 0, transitionScenario: 'static word selection; transition count intentionally not measured yet' },
        rationale: 'One packed select trit is fanned out to six proven Select3 cells. Each cell chooses the matching lane from the negative, zero or positive word without decoding the control into binary-style lines. An unknown or floating select propagates as unknown on every output lane.',
        validation: 'Saved vectors cover all three paths, mixed words and both word boundaries; the automated suite checks every one of 729 words through each selected path.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); addSixTritSelectorCases(id, negInputs, zeroInputs, posInputs, selectInput, outputs);
    const negValue = -364, zeroValue = 0, posValue = 364, selectValue = 0;
    const negDigits = balancedWordDigits(negValue), zeroDigits = balancedWordDigits(zeroValue), posDigits = balancedWordDigits(posValue);
    const controls = [
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -560, -250 + index * 58, { value: negDigits[index], label: `Neg ${name.slice(1)}` })),
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -430, -250 + index * 58, { value: zeroDigits[index], label: `Zero ${name.slice(1)}` })),
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -300, -250 + index * 58, { value: posDigits[index], label: `Pos ${name.slice(1)}` })),
      rootCircuit.addComponent('trit-input', -560, 130, { value: selectValue, label: 'Shared select' }),
    ];
    const selector = rootCircuit.addComponent(meta.type, 0, -270, { label });
    const probes = names.map((name, index) => rootCircuit.addComponent('probe', 320, -250 + index * 58, { label: `Out ${name.slice(1)}` }));
    negInputs.forEach((input, index) => rootCircuit.connect(controls[index].id, 'out', selector.id, input.state.name));
    zeroInputs.forEach((input, index) => rootCircuit.connect(controls[index + 6].id, 'out', selector.id, input.state.name));
    posInputs.forEach((input, index) => rootCircuit.connect(controls[index + 12].id, 'out', selector.id, input.state.name));
    rootCircuit.connect(controls[18].id, 'out', selector.id, 'select');
    outputs.forEach((output, index) => rootCircuit.connect(selector.id, output.state.name, probes[index].id, 'in'));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit Select3 loaded. Set shared select to −1, 0 or +1 to choose the complete Neg, Zero or Pos word. Open it to inspect the six parallel Select3 cells.');
  }

  function addSixTritRouterCases(componentId, inputs, selectInput, negOutputs, zeroOutputs, posOutputs) {
    const vectors = [
      { name: 'route lower boundary negative', value: -364, select: -1 },
      { name: 'route mixed word zero', value: -123, select: 0 },
      { name: 'route upper boundary positive', value: 364, select: 1 },
      { name: 'route zero negative', value: 0, select: -1 },
      { name: 'route least-significant positive', value: 1, select: 1 },
    ];
    const cases = vectors.map((vector) => {
      const word = balancedWordDigits(vector.value);
      const inactive = balancedWordDigits(0);
      const selected = vector.select < 0 ? negOutputs : vector.select > 0 ? posOutputs : zeroOutputs;
      return {
        id: `six-trit-route-${vector.value}-${vector.select}`, name: vector.name,
        inputs: { ...Object.fromEntries(inputs.map((input, index) => [input.id, word[index]])), [selectInput.id]: vector.select },
        expectedOutputs: {
          ...Object.fromEntries(negOutputs.map((output, index) => [output.id, selected === negOutputs ? word[index] : inactive[index]])),
          ...Object.fromEntries(zeroOutputs.map((output, index) => [output.id, selected === zeroOutputs ? word[index] : inactive[index]])),
          ...Object.fromEntries(posOutputs.map((output, index) => [output.id, selected === posOutputs ? word[index] : inactive[index]])),
        },
      };
    });
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function buildSixTritRouterDemo() {
    const label = uniqueName('6-trit Route3', [...customComponents.values()].map((meta) => meta.label), '6-trit Route3');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const inputs = names.map((name, index) => inner.addComponent('component-input', -420, -250 + index * 80, { name: `in${name.slice(1)}`, label: `In ${name.slice(1)} (${weights[index]})` }));
    const selectInput = inner.addComponent('component-input', -420, 285, { name: 'select', label: 'Shared select' });
    const routers = names.map((name, index) => inner.addComponent('route3', -100, -250 + index * 80, { label: `Route ${name}` }));
    const makeOutputs = (prefix, x, labelPrefix) => names.map((name, index) => inner.addComponent('component-output', x, -250 + index * 80, { name: `${prefix}${name.slice(1)}`, label: `${labelPrefix}${name.slice(1)}` }));
    const negOutputs = makeOutputs('neg', 180, 'Neg ');
    const zeroOutputs = makeOutputs('zero', 340, 'Zero ');
    const posOutputs = makeOutputs('pos', 500, 'Pos ');
    routers.forEach((router, index) => {
      inner.connect(inputs[index].id, 'out', router.id, 'in');
      inner.connect(selectInput.id, 'out', router.id, 'select');
      inner.connect(router.id, 'neg', negOutputs[index].id, 'in');
      inner.connect(router.id, 'zero', zeroOutputs[index].id, 'in');
      inner.connect(router.id, 'pos', posOutputs[index].id, 'in');
    });
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'six-trit routing/read-path building block', nodeCount: 6, depth: 1, primitiveCounts: { route3: 6 },
        metrics: { nodes: 6, depth: 1, wires: inner.wires.size, transitions: 0, transitionScenario: 'static word routing; transition count intentionally not measured yet' },
        rationale: 'One packed select trit fans out to six proven Route3 cells. The selected word path carries all six input trits; both inactive paths are explicitly driven to six logical zeroes rather than floating or retaining a prior read. Unknown or floating select produces unknown output lanes on every path.',
        validation: 'Saved vectors cover each read path, zero, mixed words and both word boundaries; the automated suite checks every one of 729 words through each path and confirms inactive paths are zero.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); addSixTritRouterCases(id, inputs, selectInput, negOutputs, zeroOutputs, posOutputs);
    const initialValue = -123, selectValue = 0;
    const initialDigits = balancedWordDigits(initialValue);
    const controls = [
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -500, -250 + index * 58, { value: initialDigits[index], label: `In ${name.slice(1)}` })),
      rootCircuit.addComponent('trit-input', -500, 130, { value: selectValue, label: 'Shared select' }),
    ];
    const router = rootCircuit.addComponent(meta.type, -100, -270, { label });
    const probes = [
      ...names.map((name, index) => rootCircuit.addComponent('probe', 240, -250 + index * 58, { label: `Neg ${name.slice(1)}` })),
      ...names.map((name, index) => rootCircuit.addComponent('probe', 390, -250 + index * 58, { label: `Zero ${name.slice(1)}` })),
      ...names.map((name, index) => rootCircuit.addComponent('probe', 540, -250 + index * 58, { label: `Pos ${name.slice(1)}` })),
    ];
    inputs.forEach((input, index) => rootCircuit.connect(controls[index].id, 'out', router.id, input.state.name));
    rootCircuit.connect(controls[6].id, 'out', router.id, 'select');
    [...negOutputs, ...zeroOutputs, ...posOutputs].forEach((output, index) => rootCircuit.connect(router.id, output.state.name, probes[index].id, 'in'));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit Route3 loaded. Shared select routes the input word to Neg, Zero or Pos; the two inactive word paths are explicit zeroes. Open it to inspect the six parallel Route3 cells.');
  }

  function addSixTritAluCases(componentId, aInputs, bInputs, operationInput, resultOutputs, extensionOutput) {
    const vectors = [
      { name: 'subtract', a: 123, b: 45, operation: -1 },
      { name: 'pass A ignores B', a: -123, b: 364, operation: 0 },
      { name: 'add', a: 123, b: 45, operation: 1 },
      { name: 'negative overflow', a: -364, b: 1, operation: -1 },
      { name: 'positive overflow', a: 364, b: 1, operation: 1 },
      { name: 'pass lower boundary', a: -364, b: 364, operation: 0 },
      { name: 'pass upper boundary', a: 364, b: -364, operation: 0 },
    ];
    const cases = vectors.map((vector) => {
      const raw = vector.operation < 0 ? vector.a - vector.b : vector.operation > 0 ? vector.a + vector.b : vector.a;
      const extension = vector.operation === 0 ? 0 : raw < -364 ? -1 : raw > 364 ? 1 : 0;
      const result = balancedWordDigits(raw - 729 * extension);
      const a = balancedWordDigits(vector.a), b = balancedWordDigits(vector.b);
      return {
        id: `six-trit-alu-${vector.operation}-${vector.a}-${vector.b}`, name: vector.name,
        inputs: { ...Object.fromEntries(aInputs.map((input, index) => [input.id, a[index]])), ...Object.fromEntries(bInputs.map((input, index) => [input.id, b[index]])), [operationInput.id]: vector.operation },
        expectedOutputs: { ...Object.fromEntries(resultOutputs.map((output, index) => [output.id, result[index]])), [extensionOutput.id]: extension },
      };
    });
    testSuites = testSuites.filter((suite) => suite.componentId !== componentId);
    testSuites.push({ componentId, cases });
  }

  function createSixTritAluCandidate(label, strategy, selectedReference = false) {
    const id = `${slug(label)}-${Date.now().toString(36)}-${strategy}`;
    const inner = new Circuit(registry);
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const aInputs = names.map((name, index) => inner.addComponent('component-input', -600, -250 + index * 80, { name: `a${name.slice(1)}`, label: `A${name.slice(1)} (${weights[index]})` }));
    const bInputs = names.map((name, index) => inner.addComponent('component-input', -470, -250 + index * 80, { name: `b${name.slice(1)}`, label: `B${name.slice(1)} (${weights[index]})` }));
    const operationInput = inner.addComponent('component-input', -600, 285, { name: 'operation', label: 'Op: subtract / pass / add' });
    const resultOutputs = names.map((name, index) => inner.addComponent('component-output', 460, -250 + index * 80, { name: `r${name.slice(1)}`, label: `Result ${name.slice(1)}` }));
    const extensionOutput = inner.addComponent('component-output', 460, 285, { name: 'extension', label: 'Range extension' });
    const zero = inner.addComponent('ternary-reference', -250, 310, { value: 0, label: 'Zero for pass A' });
    const connectRipple = (adders, leftSources, rightSources, sums, extension) => {
      names.forEach((name, index) => {
        inner.connect(leftSources[index].id, leftSources[index].port || 'out', adders[index].id, 'a');
        inner.connect(rightSources[index].id, rightSources[index].port || 'out', adders[index].id, 'b');
        inner.connect(adders[index].id, 'sum', sums[index].id, sums[index].port || 'in');
        if (index === names.length - 1) inner.connect(zero.id, 'out', adders[index].id, 'c');
        else inner.connect(adders[index + 1].id, 'carry', adders[index].id, 'c');
      });
      inner.connect(adders[0].id, 'carry', extension.id, extension.port || 'in');
    };
    let experiment;
    if (strategy === 'controlled-operand') {
      const negates = names.map((name, index) => inner.addComponent('negate', -260, -250 + index * 80, { label: `Negate B${name.slice(1)}` }));
      const operands = names.map((name, index) => inner.addComponent('select3', -40, -250 + index * 80, { label: `Choose B operand ${name.slice(1)}` }));
      const adders = names.map((name, index) => inner.addComponent('normalize-carry', 190, -250 + index * 80, { label: `ALU ${name}` }));
      names.forEach((name, index) => {
        inner.connect(bInputs[index].id, 'out', negates[index].id, 'in');
        inner.connect(negates[index].id, 'out', operands[index].id, 'neg');
        inner.connect(zero.id, 'out', operands[index].id, 'zero');
        inner.connect(bInputs[index].id, 'out', operands[index].id, 'pos');
        inner.connect(operationInput.id, 'out', operands[index].id, 'select');
      });
      connectRipple(adders, aInputs, operands, resultOutputs, extensionOutput);
      experiment = { role: selectedReference ? 'six-trit structural ALU reference' : 'six-trit ALU candidate', nodeCount: 19, depth: 8, primitiveCounts: { 'ternary-reference': 1, negate: 6, select3: 6, 'normalize-carry': 6 }, metrics: { nodes: 19, depth: 8, wires: inner.wires.size, transitions: 0, transitionScenario: 'static ALU result; transition count intentionally not measured yet' }, rationale: selectedReference ? 'The selected opening ALU: Op selects -B, 0 or +B before one shared ripple chain, so it computes A + Op×B. It naturally produces extension 0 for pass-A and uses only one arithmetic chain. Its Negate, Select3 and Normalize/carry components are accelerated equivalents with named structural references available from their Inspector panels.' : 'Candidate A: Op selects -B, 0 or +B before one shared ripple chain, so the ALU computes A + Op×B. It naturally produces extension 0 for pass-A and uses only one arithmetic chain.', validation: 'Saved vectors cover all operations and boundaries; exhaustive word-operation semantics are checked in the automated suite.' };
    } else {
      const negates = names.map((name, index) => inner.addComponent('negate', -260, -250 + index * 80, { label: `Negate B${name.slice(1)}` }));
      const adds = names.map((name, index) => inner.addComponent('normalize-carry', -20, -250 + index * 80, { label: `Add ${name}` }));
      const subtracts = names.map((name, index) => inner.addComponent('normalize-carry', 160, -250 + index * 80, { label: `Subtract ${name}` }));
      const selectors = names.map((name, index) => inner.addComponent('select3', 310, -250 + index * 80, { label: `Choose result ${name.slice(1)}` }));
      const extensionSelector = inner.addComponent('select3', 310, 285, { label: 'Choose extension' });
      names.forEach((name, index) => inner.connect(bInputs[index].id, 'out', negates[index].id, 'in'));
      names.forEach((name, index) => {
        inner.connect(aInputs[index].id, 'out', adds[index].id, 'a'); inner.connect(bInputs[index].id, 'out', adds[index].id, 'b');
        inner.connect(aInputs[index].id, 'out', subtracts[index].id, 'a'); inner.connect(negates[index].id, 'out', subtracts[index].id, 'b');
        if (index === names.length - 1) { inner.connect(zero.id, 'out', adds[index].id, 'c'); inner.connect(zero.id, 'out', subtracts[index].id, 'c'); }
        else { inner.connect(adds[index + 1].id, 'carry', adds[index].id, 'c'); inner.connect(subtracts[index + 1].id, 'carry', subtracts[index].id, 'c'); }
        inner.connect(subtracts[index].id, 'sum', selectors[index].id, 'neg'); inner.connect(aInputs[index].id, 'out', selectors[index].id, 'zero'); inner.connect(adds[index].id, 'sum', selectors[index].id, 'pos'); inner.connect(operationInput.id, 'out', selectors[index].id, 'select'); inner.connect(selectors[index].id, 'out', resultOutputs[index].id, 'in');
      });
      inner.connect(subtracts[0].id, 'carry', extensionSelector.id, 'neg'); inner.connect(zero.id, 'out', extensionSelector.id, 'zero'); inner.connect(adds[0].id, 'carry', extensionSelector.id, 'pos'); inner.connect(operationInput.id, 'out', extensionSelector.id, 'select'); inner.connect(extensionSelector.id, 'out', extensionOutput.id, 'in');
      experiment = { role: 'six-trit ALU candidate', nodeCount: 26, depth: 8, primitiveCounts: { 'ternary-reference': 1, negate: 6, 'normalize-carry': 12, select3: 7 }, metrics: { nodes: 26, depth: 8, wires: inner.wires.size, transitions: 0, transitionScenario: 'static ALU result; transition count intentionally not measured yet' }, rationale: 'Candidate B: calculate add and subtract independently, then select difference, A or sum. It keeps each arithmetic path isolated but duplicates the ripple chain and adds result selectors.', validation: 'Saved vectors cover all operations and boundaries; exhaustive word-operation semantics are checked in the automated suite.' };
    }
    const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment };
    customComponents.set(id, meta); registerCustom(meta); addSixTritAluCases(id, aInputs, bInputs, operationInput, resultOutputs, extensionOutput);
    return { meta, aInputs, bInputs, operationInput, resultOutputs, extensionOutput };
  }

  function buildSixTritAluComparisonDemo() {
    const candidateA = createSixTritAluCandidate('6-trit ALU — controlled operand', 'controlled-operand');
    const candidateB = createSixTritAluCandidate('6-trit ALU — parallel paths', 'parallel-paths');
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const aDigits = balancedWordDigits(123), bDigits = balancedWordDigits(45);
    const controls = [
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -610, -250 + index * 58, { value: aDigits[index], label: `A${name.slice(1)}` })),
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -470, -250 + index * 58, { value: bDigits[index], label: `B${name.slice(1)}` })),
      rootCircuit.addComponent('trit-input', -610, 130, { value: 1, label: 'Op: subtract / pass / add' }),
    ];
    const instances = [rootCircuit.addComponent(candidateA.meta.type, -180, -270, { label: candidateA.meta.label }), rootCircuit.addComponent(candidateB.meta.type, 280, -270, { label: candidateB.meta.label })];
    [candidateA, candidateB].forEach((candidate, candidateIndex) => {
      candidate.aInputs.forEach((input, index) => rootCircuit.connect(controls[index].id, 'out', instances[candidateIndex].id, input.state.name));
      candidate.bInputs.forEach((input, index) => rootCircuit.connect(controls[index + 6].id, 'out', instances[candidateIndex].id, input.state.name));
      rootCircuit.connect(controls[12].id, 'out', instances[candidateIndex].id, candidate.operationInput.state.name);
      candidate.resultOutputs.forEach((output, index) => { const probe = rootCircuit.addComponent('probe', candidateIndex ? 700 : 110, -250 + index * 58, { label: `${candidateIndex ? 'B' : 'A'} result ${index}` }); rootCircuit.connect(instances[candidateIndex].id, output.state.name, probe.id, 'in'); });
      const extension = rootCircuit.addComponent('probe', candidateIndex ? 700 : 110, 130, { label: `${candidateIndex ? 'B' : 'A'} extension` }); rootCircuit.connect(instances[candidateIndex].id, candidate.extensionOutput.state.name, extension.id, 'in');
    });
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit ALU comparison loaded. Candidate A controls B before one ripple (19 nodes); Candidate B computes add/sub in parallel then selects (26 nodes). Both share saved contract vectors. Candidate A is the preferred shape: same depth, fewer nodes and fewer wires.');
  }

  function buildSixTritAluDemo() {
    const alu = createSixTritAluCandidate('6-trit ALU', 'controlled-operand', true);
    const names = ['t5', 't4', 't3', 't2', 't1', 't0'];
    const weights = [243, 81, 27, 9, 3, 1];
    const aValue = 123, bValue = 45, operation = 1;
    const aDigits = balancedWordDigits(aValue), bDigits = balancedWordDigits(bValue);
    const controls = [
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -520, -250 + index * 58, { value: aDigits[index], label: `A${name.slice(1)} · ${weights[index]}s` })),
      ...names.map((name, index) => rootCircuit.addComponent('trit-input', -370, -250 + index * 58, { value: bDigits[index], label: `B${name.slice(1)} · ${weights[index]}s` })),
      rootCircuit.addComponent('trit-input', -520, 130, { value: operation, label: 'Op: subtract / pass / add' }),
    ];
    const instance = rootCircuit.addComponent(alu.meta.type, -20, -270, { label: alu.meta.label });
    const probes = [
      ...names.map((name, index) => rootCircuit.addComponent('probe', 300, -250 + index * 58, { label: `Result ${name.slice(1)}` })),
      rootCircuit.addComponent('probe', 300, 130, { label: 'Range extension' }),
    ];
    alu.aInputs.forEach((input, index) => rootCircuit.connect(controls[index].id, 'out', instance.id, input.state.name));
    alu.bInputs.forEach((input, index) => rootCircuit.connect(controls[index + 6].id, 'out', instance.id, input.state.name));
    rootCircuit.connect(controls[12].id, 'out', instance.id, alu.operationInput.state.name);
    alu.resultOutputs.forEach((output, index) => rootCircuit.connect(instance.id, output.state.name, probes[index].id, 'in'));
    rootCircuit.connect(instance.id, alu.extensionOutput.state.name, probes[6].id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('6-trit ALU loaded. Op −1 computes A − B, 0 passes A, and +1 computes A + B. Open it to inspect controlled B feeding one Normalize/carry ripple; open those accelerated blocks again to reach their named structural references.');
  }

  function buildSevenSegmentDemo() {
    const display = rootCircuit.addComponent('seven-segment-display', 40, -10, { label: '7-segment output' });
    const pattern = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 0, sign: 0 };
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'sign'];
    names.forEach((name, index) => {
      const input = rootCircuit.addComponent('trit-input', -330, -155 + index * 55, { value: pattern[name], label: name === 'sign' ? 'Sign' : name.toUpperCase() });
      rootCircuit.connect(input.id, 'out', display.id, name);
    });
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('7-segment display loaded. Each A–G/Sign input uses 0 for off and +1 for on. Select an input to change it quickly in the Inspector.');
  }

  function buildOneTritDisplayDemo() {
    // The display boundary is deliberately two-state, but the decoder itself is
    // ternary: Threshold3 splits the input into -1 / 0 / +1 rails.
    const label = uniqueName('1-trit signed display decoder', [...customComponents.values()].map((meta) => meta.label), '1-trit signed display decoder');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const input = inner.addComponent('component-input', -330, 0, { name: 'in' });
    const detector = inner.addComponent('threshold3', -130, 0, { label: 'Input detector' });
    const known = inner.addComponent('max', 45, -45, { label: 'Known: -1 OR 0' });
    const knownAll = inner.addComponent('max', 190, -45, { label: 'Known: valid trit' });
    const off = inner.addComponent('min', 45, 95, { label: 'Off: -1 AND 0' });
    const display = inner.addComponent('component-seven-segment-display', 400, 0, { label: 'Signed digit display' });
    inner.connect(input.id, 'out', detector.id, 'in');
    inner.connect(detector.id, 'neg', known.id, 'a');
    inner.connect(detector.id, 'zero', known.id, 'b');
    inner.connect(known.id, 'out', knownAll.id, 'a');
    inner.connect(detector.id, 'pos', knownAll.id, 'b');
    inner.connect(detector.id, 'neg', off.id, 'a');
    inner.connect(detector.id, 'zero', off.id, 'b');
    // -1 and +1 both show the digit 1; only -1 activates the sign segment.
    ['b', 'c'].forEach((port) => inner.connect(knownAll.id, 'out', display.id, port));
    ['a', 'd', 'e', 'f'].forEach((port) => inner.connect(detector.id, 'zero', display.id, port));
    inner.connect(off.id, 'out', display.id, 'g');
    inner.connect(detector.id, 'neg', display.id, 'sign');
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'gate-level display experiment', nodeCount: 4, depth: 3, primitiveCounts: { threshold3: 1, min: 1, max: 2 },
        metrics: { nodes: 4, depth: 3, wires: inner.wires.size, transitions: 0, transitionScenario: 'static decode; dynamic transition count intentionally not measured yet' },
        rationale: 'Threshold3 turns the input into one-hot rails. The zero rail forms 0, MAX combines the three valid rails for the two segments in 1, and MIN creates the always-off middle segment.',
        validation: 'Exhaustive 3/3 inputs: -1 displays -1, 0 displays 0, and +1 displays +1.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta);
    const control = rootCircuit.addComponent('trit-input', -310, 0, { value: 0, label: 'Input trit' });
    const decoder = rootCircuit.addComponent(meta.type, 0, -105, { label });
    rootCircuit.connect(control.id, 'out', decoder.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('1-trit display decoder loaded. Change Input trit: -1 shows -1, 0 shows 0 and +1 shows +1. Open internals to inspect Threshold3, MIN and MAX.');
  }

  function buildThreeTritDisplayDemo() {
    // Fixed-range decoder for -9…+9. Every match is built from three one-hot
    // detector rails, then segments are ORed together with MAX gates.
    const label = uniqueName('3-trit signed display decoder', [...customComponents.values()].map((meta) => meta.label), '3-trit signed display decoder');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const inputNames = ['t9', 't3', 't1'];
    const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -620, (index - 1) * 90, { name }));
    const detectors = inputNames.map((name, index) => {
      const detector = inner.addComponent('threshold3', -410, (index - 1) * 90, { label: `${name} detector` });
      inner.connect(inputs[index].id, 'out', detector.id, 'in');
      return detector;
    });
    const display = inner.addComponent('component-seven-segment-display', 430, 0, { label: 'Decimal display' });
    const counts = { threshold3: 3, min: 0, max: 0 };
    const rail = (digit, position) => digit < 0 ? 'neg' : digit > 0 ? 'pos' : 'zero';
    const balancedDigits = (value) => {
      const digits = [];
      let remaining = value;
      for (let index = 0; index < 3; index++) {
        const remainder = ((remaining % 3) + 3) % 3;
        const digit = remainder === 2 ? -1 : remainder;
        digits.unshift(digit);
        remaining = (remaining - digit) / 3;
      }
      return digits;
    };
    const terms = new Map();
    for (let value = -9; value <= 9; value++) {
      const digits = balancedDigits(value);
      const first = inner.addComponent('min', -170, value * 20, { label: `match ${value}` }); counts.min++;
      const second = inner.addComponent('min', 20, value * 20, { label: `match ${value}` }); counts.min++;
      inner.connect(detectors[0].id, rail(digits[0], 0), first.id, 'a');
      inner.connect(detectors[1].id, rail(digits[1], 1), first.id, 'b');
      inner.connect(first.id, 'out', second.id, 'a');
      inner.connect(detectors[2].id, rail(digits[2], 2), second.id, 'b');
      terms.set(value, second);
    }
    const segments = {
      0: ['a', 'b', 'c', 'd', 'e', 'f'], 1: ['b', 'c'], 2: ['a', 'b', 'd', 'e', 'g'],
      3: ['a', 'b', 'c', 'd', 'g'], 4: ['b', 'c', 'f', 'g'], 5: ['a', 'c', 'd', 'f', 'g'],
      6: ['a', 'c', 'd', 'e', 'f', 'g'], 7: ['a', 'b', 'c'], 8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 9: ['a', 'b', 'c', 'd', 'f', 'g'],
    };
    const orTerms = (name, values) => {
      let current = terms.get(values[0]);
      for (let index = 1; index < values.length; index++) {
        const gate = inner.addComponent('max', 170 + index * 45, values[0] * 8 + name.charCodeAt(0), { label: `${name} OR` }); counts.max++;
        inner.connect(current.id, 'out', gate.id, 'a'); inner.connect(terms.get(values[index]).id, 'out', gate.id, 'b'); current = gate;
      }
      return current;
    };
    for (const segment of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const values = [];
      for (let value = -9; value <= 9; value++) if (segments[Math.abs(value)].includes(segment)) values.push(value);
      const source = orTerms(segment, values); inner.connect(source.id, 'out', display.id, segment);
    }
    const sign = orTerms('sign', [-9, -8, -7, -6, -5, -4, -3, -2, -1]);
    inner.connect(sign.id, 'out', display.id, 'sign');
    const nodeCount = counts.threshold3 + counts.min + counts.max;
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'gate-level display experiment', nodeCount, depth: 19, primitiveCounts: counts,
        metrics: { nodes: nodeCount, depth: 19, wires: inner.wires.size, transitions: 0, transitionScenario: 'static decode; dynamic transition count intentionally not measured yet' },
        rationale: 'Threshold3 creates one-hot rails for each balanced trit. Two MIN gates form each exact three-trit match; MAX trees combine matching values into A–G and Sign.',
        validation: 'Covers all 27 input words: -9…+9 render decimal digits; -13…-10 and +10…+13 remain blank.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta);
    const controls = [
      rootCircuit.addComponent('trit-input', -420, -85, { value: 1, label: '9s trit' }),
      rootCircuit.addComponent('trit-input', -420, 0, { value: 0, label: '3s trit' }),
      rootCircuit.addComponent('trit-input', -420, 85, { value: 0, label: '1s trit' }),
    ];
    const decoder = rootCircuit.addComponent(meta.type, 0, -105, { label });
    controls.forEach((control, index) => rootCircuit.connect(control.id, 'out', decoder.id, inputNames[index]));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus(`3-trit display decoder loaded (${nodeCount} gate nodes). Change the 9s, 3s and 1s trits; it displays -9…+9 and blanks the remaining eight codes. Open internals to inspect the gate network.`);
  }

  function buildStructuralStorageDemo(loadDemo = true) {
    // These are real custom components: select one in the root circuit and use
    // “Open internals” to descend from register → latch → device cells.
    const add = (labelBase, experiment, inputNames, outputNames, wire) => {
      const label = uniqueName(labelBase, [...customComponents.values()].map((meta) => meta.label), labelBase);
      const id = `${slug(label)}-${Date.now().toString(36)}`;
      const inner = new Circuit(registry);
      const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -380, (index - (inputNames.length - 1) / 2) * 76, { name }));
      const outputs = outputNames.map((name, index) => inner.addComponent('component-output', 380, (index - (outputNames.length - 1) / 2) * 76, { name }));
      wire(inner, inputs, outputs);
      const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment };
      customComponents.set(id, meta); registerCustom(meta);
      return meta;
    };
    const metric = (nodes, depth, wires, transitions) => ({ nodes, depth, wires, transitions, transitionScenario: 'one known data write from a settled idle state' });
    const latchSequences = [{ name: 'reset, write, hold', steps: [
      { inputs: { d: 1, enable: 0, reset: 1 } },
      { inputs: { d: -1, enable: 1, reset: 0 } },
      { inputs: { d: 1, enable: 0, reset: 0 } },
    ] }];
    const registerSequences = [{ name: 'reset and rising-edge write', steps: [
      { inputs: { d: 1, load: 0, clock: 0, reset: 1 } },
      { inputs: { d: 1, load: 0, clock: 1, reset: 1 } },
      { inputs: { d: -1, load: 1, clock: 0, reset: 0 } },
      { inputs: { d: -1, load: 1, clock: 1, reset: 0 } },
      { inputs: { d: 1, load: 0, clock: 0, reset: 0 } },
      { inputs: { d: 1, load: 0, clock: 1, reset: 0 } },
    ] }];
    const directLatch = add('Latch — functional reference', {
      role: 'reference', nodeCount: 1, depth: 1, primitiveCounts: { latch3: 1 }, metrics: metric(1, 1, 4, 2),
      rationale: 'The existing latch is the compact behavioral reference: D is visible while enable is +1 and retained otherwise.', validation: 'Manual contract: transparent at enable +1; holds at 0/-1; reset restores 0.',
    }, ['d', 'enable', 'reset'], ['q'], (inner, inputs, outputs) => {
      const latch = inner.addComponent('latch3', 0, 0);
      ['d', 'enable', 'reset'].forEach((port, index) => inner.connect(inputs[index].id, 'out', latch.id, port));
      inner.connect(latch.id, 'q', outputs[0].id, 'in');
    });
    const structuralLatch = add('Latch — structural pass cell', {
      role: 'structural candidate', equivalence: { directType: 'latch3', sequences: latchSequences }, nodeCount: 4, depth: 4, primitiveCounts: { restore3: 2, pass3: 1, 'storage-node3': 1 }, metrics: metric(4, 4, 8, 5),
      rationale: 'Restores D, passes it only while enable is +1, then commits it in an explicit storage node before a final restored Q.', validation: 'Manual contract matches the functional latch for known D/enable/reset values.',
    }, ['d', 'enable', 'reset'], ['q'], (inner, inputs, outputs) => {
      const inputRestorer = inner.addComponent('restore3', -150, -20, { label: 'Restore D' });
      const pass = inner.addComponent('pass3', 20, -20, { label: 'Enable pass' });
      const storage = inner.addComponent('storage-node3', 180, -20, { label: 'State boundary' });
      const outputRestorer = inner.addComponent('restore3', 300, -20, { label: 'Restore Q' });
      inner.connect(inputs[0].id, 'out', inputRestorer.id, 'in');
      inner.connect(inputRestorer.id, 'out', pass.id, 'in'); inner.connect(inputs[1].id, 'out', pass.id, 'gate');
      inner.connect(pass.id, 'out', storage.id, 'drive'); inner.connect(inputs[1].id, 'out', storage.id, 'write'); inner.connect(inputs[2].id, 'out', storage.id, 'reset');
      inner.connect(storage.id, 'q', outputRestorer.id, 'in'); inner.connect(outputRestorer.id, 'out', outputs[0].id, 'in');
    });
    const directRegister = add('Register — functional reference', {
      role: 'reference', nodeCount: 1, depth: 1, primitiveCounts: { register3: 1 }, metrics: metric(1, 1, 5, 2),
      rationale: 'The behavioral register is the reference D flip-flop: it samples D on a 0 → +1 clock edge when load is +1.', validation: 'Manual contract: capture only on rising edge; synchronous reset restores 0.',
    }, ['d', 'load', 'clock', 'reset'], ['q'], (inner, inputs, outputs) => {
      const register = inner.addComponent('register3', 0, 0);
      ['d', 'load', 'clock', 'reset'].forEach((port, index) => inner.connect(inputs[index].id, 'out', register.id, port));
      inner.connect(register.id, 'q', outputs[0].id, 'in');
    });
    const structuralRegister = add('Register — two structural latches', {
      role: 'structural candidate', equivalence: { directType: 'register3', sequences: registerSequences }, nodeCount: 11, depth: 8, primitiveCounts: { 'clock-phase3': 1, min: 2, restore3: 4, pass3: 2, 'storage-node3': 2 }, metrics: metric(11, 8, 29, 13),
      rationale: 'A master latch is open at clock 0 (and only when load is +1); a slave latch is open at clock +1. A second MIN gates reset with clock-high, preserving the direct register’s synchronous reset contract.', validation: 'Saved reset/write sequence compares the structural and direct register on every step.',
    }, ['d', 'load', 'clock', 'reset'], ['q'], (inner, inputs, outputs) => {
      const phase = inner.addComponent('clock-phase3', -160, 100, { label: 'CLK low phase' });
      const masterEnable = inner.addComponent('min', -10, 50, { label: 'LOAD ∧ CLK-low' });
      const resetEnable = inner.addComponent('min', -10, 155, { label: 'RESET ∧ CLK-high' });
      const master = inner.addComponent(structuralLatch.type, 150, -65, { label: 'Master latch' });
      const slave = inner.addComponent(structuralLatch.type, 150, 100, { label: 'Slave latch' });
      inner.connect(inputs[2].id, 'out', phase.id, 'clock');
      inner.connect(inputs[1].id, 'out', masterEnable.id, 'a'); inner.connect(phase.id, 'out', masterEnable.id, 'b');
      inner.connect(inputs[3].id, 'out', resetEnable.id, 'a'); inner.connect(inputs[2].id, 'out', resetEnable.id, 'b');
      inner.connect(inputs[0].id, 'out', master.id, 'd'); inner.connect(masterEnable.id, 'out', master.id, 'enable'); inner.connect(resetEnable.id, 'out', master.id, 'reset');
      inner.connect(master.id, 'q', slave.id, 'd'); inner.connect(inputs[2].id, 'out', slave.id, 'enable'); inner.connect(resetEnable.id, 'out', slave.id, 'reset');
      inner.connect(slave.id, 'q', outputs[0].id, 'in');
    });
    const references = {
      'structural-latch-v1': structuralLatch,
      'structural-register-v1': structuralRegister,
    };
    Object.entries(references).forEach(([name, meta]) => structuralReferences.set(name, meta));
    Object.values(references).forEach(verifyStructuralReference);
    if (!loadDemo) return references;
    rootCircuit.clear();
    const latchD = rootCircuit.addComponent('trit-input', -500, -220, { value: 1, label: 'Latch D' });
    const latchEnable = rootCircuit.addComponent('trit-input', -500, -145, { value: 1, label: 'Latch enable' });
    const latchReset = rootCircuit.addComponent('trit-input', -500, -70, { value: 0, label: 'Latch reset' });
    const registerD = rootCircuit.addComponent('trit-input', -500, 60, { value: 1, label: 'Register D' });
    const registerLoad = rootCircuit.addComponent('trit-input', -500, 125, { value: 1, label: 'Register LOAD' });
    const registerClock = rootCircuit.addComponent('trit-input', -500, 190, { value: 0, label: 'Register CLK' });
    const registerReset = rootCircuit.addComponent('trit-input', -500, 255, { value: 0, label: 'Register reset' });
    const latchReference = rootCircuit.addComponent(directLatch.type, -100, -145, { label: directLatch.label });
    const latchStructural = rootCircuit.addComponent(structuralLatch.type, 180, -145, { label: structuralLatch.label });
    const registerReference = rootCircuit.addComponent(directRegister.type, -100, 155, { label: directRegister.label });
    const registerStructural = rootCircuit.addComponent(structuralRegister.type, 180, 155, { label: structuralRegister.label });
    const latchReferenceQ = rootCircuit.addComponent('probe', 470, -185, { label: 'Reference latch Q' });
    const latchStructuralQ = rootCircuit.addComponent('probe', 470, -105, { label: 'Structural latch Q' });
    const registerReferenceQ = rootCircuit.addComponent('probe', 470, 115, { label: 'Reference register Q' });
    const registerStructuralQ = rootCircuit.addComponent('probe', 470, 195, { label: 'Structural register Q' });
    for (const target of [latchReference, latchStructural]) {
      rootCircuit.connect(latchD.id, 'out', target.id, 'd'); rootCircuit.connect(latchEnable.id, 'out', target.id, 'enable'); rootCircuit.connect(latchReset.id, 'out', target.id, 'reset');
    }
    for (const target of [registerReference, registerStructural]) {
      rootCircuit.connect(registerD.id, 'out', target.id, 'd'); rootCircuit.connect(registerLoad.id, 'out', target.id, 'load'); rootCircuit.connect(registerClock.id, 'out', target.id, 'clock'); rootCircuit.connect(registerReset.id, 'out', target.id, 'reset');
    }
    rootCircuit.connect(latchReference.id, 'q', latchReferenceQ.id, 'in'); rootCircuit.connect(latchStructural.id, 'q', latchStructuralQ.id, 'in');
    rootCircuit.connect(registerReference.id, 'q', registerReferenceQ.id, 'in'); rootCircuit.connect(registerStructural.id, 'q', registerStructuralQ.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Structural storage comparison loaded. Open a structural register, then a latch, to inspect its restorer, pass switch and storage-node cells. Inspector metrics compare nodes, depth, wires and canonical transitions.');
  }

  function buildStructuralRegisterBankDemo(loadDemo = true) {
    const storageReferences = buildStructuralStorageDemo(false);
    const routingReferences = buildStructuralRoutingDemo(false);
    const label = uniqueName('Register bank — structural 3×1', [...customComponents.values()].map((meta) => meta.label), 'Register bank — structural 3×1');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const inputs = ['d', 'address', 'action', 'clock', 'reset'].map((name, index) => inner.addComponent('component-input', -500, (index - 2) * 78, { name }));
    const output = inner.addComponent('component-output', 500, 0, { name: 'out' });
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    const decode = inner.addComponent(routingReferences['structural-control3-v1'].type, -280, 0, { label: 'Decode address' });
    const writePasses = ['neg', 'zero', 'pos'].map((name, index) => inner.addComponent('pass3', -70, (index - 1) * 110, { label: name + ' write enable' }));
    const registers = ['−1 register', '0 register', '+1 register'].map((name, index) => inner.addComponent(storageReferences['structural-register-v1'].type, 140, (index - 1) * 110, { label: name }));
    const readSelect = inner.addComponent(routingReferences['structural-select3-v1'].type, 340, -35, { label: 'Select addressed register' });
    const readPass = inner.addComponent('pass3', 350, 90, { label: 'Read-only output pass' });
    const outputRestorer = inner.addComponent('restore3', 500, 90, { label: 'Restore readable output' });
    inner.connect(byName.address.id, 'out', decode.id, 'control');
    ['neg', 'zero', 'pos'].forEach((port, index) => {
      inner.connect(decode.id, port, writePasses[index].id, 'in');
      inner.connect(byName.action.id, 'out', writePasses[index].id, 'gate');
      inner.connect(writePasses[index].id, 'out', registers[index].id, 'load');
      inner.connect(byName.d.id, 'out', registers[index].id, 'd');
      inner.connect(byName.clock.id, 'out', registers[index].id, 'clock');
      inner.connect(byName.reset.id, 'out', registers[index].id, 'reset');
      inner.connect(registers[index].id, 'q', readSelect.id, port);
    });
    inner.connect(byName.address.id, 'out', readSelect.id, 'select');
    inner.connect(readSelect.id, 'out', readPass.id, 'in');
    // A negative action is read. Control3's negative rail is a driven +1 only then.
    const readDecode = inner.addComponent(routingReferences['structural-control3-v1'].type, 130, 220, { label: 'Decode read action' });
    inner.connect(byName.action.id, 'out', readDecode.id, 'control');
    inner.connect(readDecode.id, 'neg', readPass.id, 'gate');
    inner.connect(readPass.id, 'out', outputRestorer.id, 'in');
    inner.connect(outputRestorer.id, 'out', output.id, 'in');
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'structural reference', equivalence: { directType: 'register-bank3', sequences: [{ name: 'reset, addressed write and read', steps: [
          { inputs: { d: 0, address: 0, action: 1, clock: 0, reset: 1 } },
          { inputs: { d: 0, address: 0, action: 1, clock: 1, reset: 1 } },
          { inputs: { d: 1, address: -1, action: 1, clock: 0, reset: 0 } },
          { inputs: { d: 1, address: -1, action: 1, clock: 1, reset: 0 } },
          { inputs: { d: 0, address: -1, action: -1, clock: 0, reset: 0 } },
          { inputs: { d: 0, address: -1, action: -1, clock: 1, reset: 0 } },
        ] }] }, nodeCount: 1, depth: 1,
        primitiveCounts: { [routingReferences['structural-control3-v1'].type]: 2, pass3: 4, restore3: 1, [storageReferences['structural-register-v1'].type]: 3, [routingReferences['structural-select3-v1'].type]: 1 },
        rationale: 'Control3 decodes the balanced address; each write enable is an explicit action-gated pass path into one structural register. A structural Select3 reads the addressed Q, and a separately decoded read action gates the public output.',
        validation: 'Structural reference for the register-bank public contract; sequence equivalence cases are the next 14A.3 task.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta);
    const references = { 'structural-register-bank3-v1': meta };
    Object.entries(references).forEach(([name, definition]) => structuralReferences.set(name, definition));
    Object.values(references).forEach(verifyStructuralReference);
    if (!loadDemo) return references;
    rootCircuit.clear();
    rootCircuit.addComponent(meta.type, 0, 0, { label });
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Structural 3×1 register bank loaded. Open it to inspect address decode, write paths, registers and Select3 read path.');
    return references;
  }

  function buildStructuralWordRegisterBankDemo(loadDemo = true) {
    const lane = buildStructuralRegisterBankDemo(false)['structural-register-bank3-v1'];
    const label = uniqueName('6-trit register bank — structural', [...customComponents.values()].map((meta) => meta.label), '6-trit register bank — structural');
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const names = [...lanes.map((laneName) => `dataIn${laneName}`), 'address', 'action', 'clock', 'reset'];
    const inputs = names.map((name, index) => inner.addComponent('component-input', -460, (index - 5) * 55, { name }));
    const outputs = lanes.map((laneName, index) => inner.addComponent('component-output', 420, (index - 2.5) * 65, { name: `dataOut${laneName}` }));
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    const banks = lanes.map((laneName, index) => inner.addComponent(lane.type, 0, (index - 2.5) * 65, { label: `Register lane ${laneName}` }));
    banks.forEach((bank, index) => {
      const laneName = lanes[index];
      inner.connect(byName[`dataIn${laneName}`].id, 'out', bank.id, 'd');
      ['address', 'action', 'clock', 'reset'].forEach((name) => inner.connect(byName[name].id, 'out', bank.id, name));
      inner.connect(bank.id, 'out', outputs[index].id, 'in');
    });
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'structural reference', equivalence: { directType: 'register-bank3x6', sequences: [] }, nodeCount: 6, depth: 1,
        primitiveCounts: { [lane.type]: 6 }, metrics: { nodes: 6, depth: 1, wires: inner.wires.size, transitions: 0, transitionScenario: 'one addressed word write from reset' },
        rationale: 'Six aligned structural three-register banks share address, packed action, clock and reset. One selected register receives all six data lanes on the same edge, so a tryte cannot become a mixture of old and new lanes.',
        validation: 'The direct register-bank contract exhaustively verifies all 729 trytes at every register address; the structural reference retains the same public port and edge semantics.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); structuralReferences.set('structural-register-bank3x6-v1', meta);
    if (!loadDemo) return { 'structural-register-bank3x6-v1': meta };
    rootCircuit.clear(); rootCircuit.addComponent(meta.type, 0, 0, { label }); renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Structural 6-trit register bank loaded. Open it to inspect the six aligned structural register-bank lanes.');
    return { 'structural-register-bank3x6-v1': meta };
  }

  function buildStructuralRegisterFileDemo(loadDemo = true) {
    const storageReferences = buildStructuralStorageDemo(false);
    const routingReferences = buildStructuralRoutingDemo(false);
    const registerType = storageReferences['structural-register-v1'].type;
    const controlType = routingReferences['structural-control3-v1'].type;
    const selectType = routingReferences['structural-select3-v1'].type;
    const label = uniqueName('6-trit dual-read register file — structural', [...customComponents.values()].map((meta) => meta.label), '6-trit dual-read register file — structural');
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const lanes = ['5', '4', '3', '2', '1', '0'], branches = ['neg', 'zero', 'pos'];
    const inputNames = [...lanes.map((lane) => `dataIn${lane}`), 'readAAddress', 'readBAddress', 'writeAddress', 'writeAction', 'clock', 'reset'];
    const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -650, (index - 5.5) * 46, { name }));
    const outputs = [...lanes.map((lane, index) => inner.addComponent('component-output', 590, (index - 5.5) * 50, { name: `readA${lane}` })), ...lanes.map((lane, index) => inner.addComponent('component-output', 590, (index + 0.5) * 50, { name: `readB${lane}` }))];
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    const decode = inner.addComponent(controlType, -410, 30, { label: 'Decode write address' });
    const writePasses = branches.map((branch, index) => inner.addComponent('pass3', -220, (index - 1) * 80, { label: `${branch} write enable` }));
    inner.connect(byName.writeAddress.id, 'out', decode.id, 'control');
    branches.forEach((branch, index) => { inner.connect(decode.id, branch, writePasses[index].id, 'in'); inner.connect(byName.writeAction.id, 'out', writePasses[index].id, 'gate'); });
    lanes.forEach((lane, laneIndex) => {
      const registers = branches.map((branch, index) => inner.addComponent(registerType, 20, laneIndex * 260 + (index - 1) * 75 - 625, { label: `${branch} register lane ${lane}` }));
      const readA = inner.addComponent(selectType, 290, laneIndex * 50 - 275, { label: `Read A lane ${lane}` });
      const readB = inner.addComponent(selectType, 290, laneIndex * 50 + 45, { label: `Read B lane ${lane}` });
      registers.forEach((register, index) => {
        inner.connect(byName[`dataIn${lane}`].id, 'out', register.id, 'd');
        inner.connect(writePasses[index].id, 'out', register.id, 'load');
        inner.connect(byName.clock.id, 'out', register.id, 'clock'); inner.connect(byName.reset.id, 'out', register.id, 'reset');
        inner.connect(register.id, 'q', readA.id, branches[index]); inner.connect(register.id, 'q', readB.id, branches[index]);
      });
      inner.connect(byName.readAAddress.id, 'out', readA.id, 'select'); inner.connect(byName.readBAddress.id, 'out', readB.id, 'select');
      inner.connect(readA.id, 'out', outputs[laneIndex].id, 'in'); inner.connect(readB.id, 'out', outputs[laneIndex + 6].id, 'in');
    });
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'structural reference', equivalence: { directType: 'register-file3x6', sequences: [] }, nodeCount: 33, depth: 4,
        primitiveCounts: { [registerType]: 18, [controlType]: 1, pass3: 3, [selectType]: 12 }, metrics: { nodes: 33, depth: 4, wires: inner.wires.size, transitions: 0, transitionScenario: 'one write with two addressed reads' },
        rationale: 'Eighteen structural registers form three six-trit words. One packed write action is decoded only for the write address; two independent structural Select3 paths expose operands A and B without duplicating state.',
        validation: 'The direct register-file contract verifies every word write and independent read addresses. The structural form has the same reset and shared-edge semantics.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); structuralReferences.set('structural-register-file3x6-v1', meta);
    if (!loadDemo) return { 'structural-register-file3x6-v1': meta };
    rootCircuit.clear(); rootCircuit.addComponent(meta.type, 0, 0, { label }); renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Structural dual-read 6-trit register file loaded. Open it to inspect the shared write decoder and separate A/B Select3 read paths.');
    return { 'structural-register-file3x6-v1': meta };
  }

  function buildStructuralInstructionRegisterDemo(loadDemo = true) {
    const registerType = buildStructuralStorageDemo(false)['structural-register-v1'].type;
    const label = uniqueName('6-trit instruction register — structural', [...customComponents.values()].map((meta) => meta.label), '6-trit instruction register — structural');
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const inputs = [...lanes.map((lane) => `instruction${lane}`), 'load', 'clock', 'reset'].map((name, index) => inner.addComponent('component-input', -420, (index - 4.5) * 60, { name }));
    const outputs = lanes.map((lane, index) => inner.addComponent('component-output', 360, (index - 2.5) * 70, { name: `instruction${lane}` }));
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    lanes.forEach((lane, index) => {
      const register = inner.addComponent(registerType, 0, (index - 2.5) * 70, { label: `Instruction lane ${lane}` });
      inner.connect(byName[`instruction${lane}`].id, 'out', register.id, 'd'); inner.connect(byName.load.id, 'out', register.id, 'load'); inner.connect(byName.clock.id, 'out', register.id, 'clock'); inner.connect(byName.reset.id, 'out', register.id, 'reset'); inner.connect(register.id, 'q', outputs[index].id, 'in');
    });
    const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment: { role: 'structural reference', equivalence: { directType: 'instruction-register6', sequences: [] }, nodeCount: 6, depth: 1, primitiveCounts: { [registerType]: 6 }, metrics: { nodes: 6, depth: 1, wires: inner.wires.size, transitions: 0, transitionScenario: 'one instruction fetch edge' }, rationale: 'Six structural registers capture one complete instruction only when fetch-load is +1 on the shared edge.', validation: 'The instruction-register contract covers load, hold, reset and invalid inputs.' } };
    customComponents.set(id, meta); registerCustom(meta); structuralReferences.set('structural-instruction-register6-v1', meta);
    if (!loadDemo) return { 'structural-instruction-register6-v1': meta };
    rootCircuit.clear(); rootCircuit.addComponent(meta.type, 0, 0, { label }); renderer.select(null); renderLibrary(); updateStats(); resetHistory(); return { 'structural-instruction-register6-v1': meta };
  }

  function buildStructuralProgramCounterDemo(loadDemo = true) {
    const storageReferences = buildStructuralStorageDemo(false);
    const routingReferences = buildStructuralRoutingDemo(false);
    const registerType = storageReferences['structural-register-v1'].type;
    const adjustType = routingReferences['structural-adjust3-v1'].type;
    const label = uniqueName('6-trit program counter — structural', [...customComponents.values()].map((meta) => meta.label), '6-trit program counter — structural');
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const inputs = ['control', ...lanes.map((lane) => `loadData${lane}`), 'load', 'clock', 'reset'].map((name, index) => inner.addComponent('component-input', -500, (index - 4.5) * 58, { name }));
    const outputs = lanes.map((lane, index) => inner.addComponent('component-output', 470, (index - 2.5) * 68, { name: `pc${lane}` }));
    const extension = inner.addComponent('component-output', 470, 250, { name: 'extension' });
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    const load = inner.addComponent('ternary-reference', -310, 255, { value: 1, label: 'Always load on PC edge' });
    const zero = inner.addComponent('ternary-reference', 260, 300, { value: 0, label: 'Zero extension after jump' });
    const registers = lanes.map((lane, index) => inner.addComponent(registerType, 120, (index - 2.5) * 68, { label: `PC register ${lane}` }));
    const adjusts = lanes.map((lane, index) => inner.addComponent(adjustType, -90, (index - 2.5) * 68, { label: `Adjust PC lane ${lane}` }));
    const nextSelectors = lanes.map((lane, index) => inner.addComponent('select3', 15, (index - 2.5) * 68, { label: `Choose PC lane ${lane}` }));
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
      inner.connect(registers[index].id, 'q', adjusts[index].id, 'value');
      if (index === lanes.length - 1) inner.connect(byName.control.id, 'out', adjusts[index].id, 'control');
      else inner.connect(adjusts[index + 1].id, 'carry', adjusts[index].id, 'control');
      inner.connect(adjusts[index].id, 'next', nextSelectors[index].id, 'neg'); inner.connect(adjusts[index].id, 'next', nextSelectors[index].id, 'zero');
      inner.connect(byName[`loadData${lanes[index]}`].id, 'out', nextSelectors[index].id, 'pos'); inner.connect(byName.load.id, 'out', nextSelectors[index].id, 'select');
      inner.connect(nextSelectors[index].id, 'out', registers[index].id, 'd');
      inner.connect(load.id, 'out', registers[index].id, 'load');
      inner.connect(byName.clock.id, 'out', registers[index].id, 'clock');
      inner.connect(byName.reset.id, 'out', registers[index].id, 'reset');
      inner.connect(registers[index].id, 'q', outputs[index].id, 'in');
    }
    const extensionSelect = inner.addComponent('select3', 280, 245, { label: 'Choose jump extension' });
    inner.connect(adjusts[0].id, 'carry', extensionSelect.id, 'neg'); inner.connect(adjusts[0].id, 'carry', extensionSelect.id, 'zero'); inner.connect(zero.id, 'out', extensionSelect.id, 'pos'); inner.connect(byName.load.id, 'out', extensionSelect.id, 'select'); inner.connect(extensionSelect.id, 'out', extension.id, 'in');
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'structural reference', equivalence: { directType: 'program-counter6', sequences: [] }, nodeCount: 21, depth: 8,
        primitiveCounts: { [registerType]: 6, [adjustType]: 6, select3: 7, 'ternary-reference': 2 }, metrics: { nodes: 21, depth: 8, wires: inner.wires.size, transitions: 0, transitionScenario: 'one PC increment and one PC load from reset' },
        rationale: 'The least-significant lane receives the packed decrement/hold/increment control. Each Adjust3 carry becomes the next lane control; a six-lane Select3 boundary replaces that next value with LoadData only when PC load is +1, then the registers capture together on the shared edge.',
        validation: 'The direct PC contract covers all 729 current values, all three controls, canonical wrap, PC load and synchronous reset; this reference preserves that port and state-boundary structure.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); structuralReferences.set('structural-program-counter6-v1', meta);
    if (!loadDemo) return { 'structural-program-counter6-v1': meta };
    rootCircuit.clear(); rootCircuit.addComponent(meta.type, 0, 0, { label }); renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Structural 6-trit program counter loaded. Open it to follow the carry chain from PC t0 toward PC t5 and the six shared-edge registers.');
    return { 'structural-program-counter6-v1': meta };
  }

  function buildStructuralMemoryDemo(loadDemo = true) {
    const bank = buildStructuralRegisterBankDemo(false)['structural-register-bank3-v1'];
    const label = uniqueName('Memory 3×1 — structural', [...customComponents.values()].map((meta) => meta.label), 'Memory 3×1 — structural');
    const id = `${slug(label)}-${Date.now().toString(36)}`;
    const inner = new Circuit(registry);
    const inputs = ['dataIn', 'address', 'action', 'clock', 'reset'].map((name, index) => inner.addComponent('component-input', -380, (index - 2) * 78, { name }));
    const output = inner.addComponent('component-output', 340, 0, { name: 'dataOut' });
    const fabric = inner.addComponent(bank.type, 0, 0, { label: 'Three addressed structural cells' });
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    inner.connect(byName.dataIn.id, 'out', fabric.id, 'd');
    ['address', 'action', 'clock', 'reset'].forEach((name) => inner.connect(byName[name].id, 'out', fabric.id, name));
    inner.connect(fabric.id, 'out', output.id, 'in');
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'structural reference', equivalence: { directType: 'memory3x1', sequences: [{ name: 'reset, write all addresses, read', steps: [
          { inputs: { dataIn: 0, address: 0, action: 1, clock: 0, reset: 1 } },
          { inputs: { dataIn: 0, address: 0, action: 1, clock: 1, reset: 1 } },
          { inputs: { dataIn: -1, address: -1, action: 1, clock: 0, reset: 0 } },
          { inputs: { dataIn: -1, address: -1, action: 1, clock: 1, reset: 0 } },
          { inputs: { dataIn: 1, address: 1, action: 1, clock: 0, reset: 0 } },
          { inputs: { dataIn: 1, address: 1, action: 1, clock: 1, reset: 0 } },
          { inputs: { dataIn: -1, address: -1, action: -1, clock: 0, reset: 0 } },
        ] }] }, nodeCount: 1, depth: 1,
        primitiveCounts: { [bank.type]: 1 },
        rationale: 'Memory 3×1 is an explicit public memory port wrapped around the opening structural three-register fabric. Open the fabric to inspect address decode, action-gated writes, all three registers and the Select3 read path.',
        validation: 'All address/action/reset sequences are covered by the Memory 3×1 contract suite.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta);
    const references = { 'structural-memory3x1-v1': meta };
    Object.entries(references).forEach(([name, definition]) => structuralReferences.set(name, definition));
    Object.values(references).forEach(verifyStructuralReference);
    if (!loadDemo) return references;
    rootCircuit.clear(); rootCircuit.addComponent(meta.type, 0, 0, { label });
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Structural Memory 3×1 loaded. Open internals to inspect the three registers, decoder, write paths and Select3 read path.');
    return references;
  }

  function buildStructuralMemoryWordDemo(loadDemo = true) {
    const lane = buildStructuralMemoryDemo(false)['structural-memory3x1-v1'];
    const label = uniqueName('Memory 3×6 — structural', [...customComponents.values()].map((meta) => meta.label), 'Memory 3×6 — structural');
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const names = [...['5', '4', '3', '2', '1', '0'].map((n) => `dataIn${n}`), 'address', 'action', 'clock', 'reset'];
    const inputs = names.map((name, index) => inner.addComponent('component-input', -460, (index - 5) * 55, { name }));
    const outputs = ['5', '4', '3', '2', '1', '0'].map((n, index) => inner.addComponent('component-output', 420, (index - 2.5) * 65, { name: `dataOut${n}` }));
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    const memories = ['5', '4', '3', '2', '1', '0'].map((n, index) => inner.addComponent(lane.type, 0, (index - 2.5) * 65, { label: `Memory lane ${n}` }));
    memories.forEach((memory, index) => { const n = ['5', '4', '3', '2', '1', '0'][index]; inner.connect(byName[`dataIn${n}`].id, 'out', memory.id, 'dataIn'); ['address', 'action', 'clock', 'reset'].forEach((name) => inner.connect(byName[name].id, 'out', memory.id, name)); inner.connect(memory.id, 'dataOut', outputs[index].id, 'in'); });
    const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment: { role: 'structural reference', equivalence: { directType: 'memory3x6', sequences: [] }, nodeCount: 6, depth: 1, primitiveCounts: { [lane.type]: 6 }, rationale: 'Six aligned structural Memory 3×1 lanes share one address, action, clock and reset. Each lane receives the same edge, so a word write is atomic at the public boundary.', validation: 'The direct Memory 3×6 contract exhaustively checks all 729 words at all three addresses.' } };
    customComponents.set(id, meta); registerCustom(meta); structuralReferences.set('structural-memory3x6-v1', meta);
    if (!loadDemo) return { 'structural-memory3x6-v1': meta };
    rootCircuit.clear(); rootCircuit.addComponent(meta.type, 0, 0, { label }); renderer.select(null); renderLibrary(); updateStats(); resetHistory(); return { 'structural-memory3x6-v1': meta };
  }

  // A scaled bank has three smaller banks. Its most-significant address trit
  // routes the packed action to exactly one child and selects that child's word
  // readback; lower address trits stay in their original order. Reset is
  // broadcast so every location is initialized even when address is invalid.
  function buildStructuralScaledMemoryDemo(locations, loadDemo = true) {
    const configurations = {
      9: { childLocations: 3, childReference: 'structural-memory3x6-v1', addressWidth: 2, childAddressNames: ['address'] },
      27: { childLocations: 9, childReference: 'structural-memory9x6-v1', addressWidth: 3, childAddressNames: ['address1', 'address0'] },
      81: { childLocations: 27, childReference: 'structural-memory27x6-v1', addressWidth: 4, childAddressNames: ['address2', 'address1', 'address0'] },
    };
    const config = configurations[locations];
    if (!config) throw new Error(`No scaled-memory hierarchy is defined for ${locations} locations.`);
    let child = structuralReferences.get(config.childReference);
    if (!child || !customComponents.has(child.id)) child = config.childLocations === 3
      ? buildStructuralMemoryWordDemo(false)['structural-memory3x6-v1']
      : buildStructuralScaledMemoryDemo(config.childLocations, false)[config.childReference];
    const label = uniqueName(`Memory ${locations}×6 — structural`, [...customComponents.values()].map((meta) => meta.label), `Memory ${locations}×6 — structural`);
    const id = `${slug(label)}-${Date.now().toString(36)}`, inner = new Circuit(registry);
    const addressNames = Array.from({ length: config.addressWidth }, (_, index) => `address${config.addressWidth - 1 - index}`);
    const lanes = ['5', '4', '3', '2', '1', '0'];
    const inputNames = [...lanes.map((n) => `dataIn${n}`), ...addressNames, 'action', 'clock', 'reset'];
    const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -560, (index - (inputNames.length - 1) / 2) * 48, { name }));
    const outputs = lanes.map((n, index) => inner.addComponent('component-output', 500, (index - 2.5) * 64, { name: `dataOut${n}` }));
    const byName = Object.fromEntries(inputs.map((input) => [input.state.name, input]));
    const router = inner.addComponent('route3', -235, 0, { label: 'Select addressed bank' });
    const branches = ['neg', 'zero', 'pos'];
    const banks = branches.map((branch, index) => inner.addComponent(child.type, 0, (index - 1) * 210, { label: `${branch} address bank` }));
    inner.connect(byName.action.id, 'out', router.id, 'in');
    inner.connect(byName[addressNames[0]].id, 'out', router.id, 'select');
    banks.forEach((bank, index) => {
      lanes.forEach((lane) => inner.connect(byName[`dataIn${lane}`].id, 'out', bank.id, `dataIn${lane}`));
      addressNames.slice(1).forEach((name, addressIndex) => inner.connect(byName[name].id, 'out', bank.id, config.childAddressNames[addressIndex]));
      inner.connect(router.id, branches[index], bank.id, 'action');
      inner.connect(byName.clock.id, 'out', bank.id, 'clock');
      inner.connect(byName.reset.id, 'out', bank.id, 'reset');
    });
    lanes.forEach((lane, index) => {
      const select = inner.addComponent('select3', 280, (index - 2.5) * 64, { label: `Read lane ${lane}` });
      banks.forEach((bank, bankIndex) => inner.connect(bank.id, `dataOut${lane}`, select.id, branches[bankIndex]));
      inner.connect(byName[addressNames[0]].id, 'out', select.id, 'select');
      inner.connect(select.id, 'out', outputs[index].id, 'in');
    });
    const childMetrics = child.experiment?.metrics || { nodes: child.experiment?.nodeCount || 1, depth: child.experiment?.depth || 1 };
    const baseInputs = (top, action, clock, reset, value = 0) => ({ ...Object.fromEntries(lanes.map((lane, index) => [`dataIn${lane}`, (value + index) % 3 - 1])), ...Object.fromEntries(addressNames.map((name, index) => [name, index === 0 ? top : 0])), action, clock, reset });
    const sequence = [
      { inputs: baseInputs(0, 0, 0, 1) }, { inputs: baseInputs(0, 0, 1, 1) },
      ...[-1, 0, 1].flatMap((top, index) => [{ inputs: baseInputs(top, 1, 0, 0, index) }, { inputs: baseInputs(top, 1, 1, 0, index) }, { inputs: baseInputs(top, -1, 0, 0, index) }]),
    ];
    const meta = {
      id, type: `custom:${id}`, label, circuit: inner.serialize(),
      experiment: {
        role: 'structural reference', equivalence: { directType: `memory${locations}x6`, sequences: [{ name: 'reset, write each top-level bank, then read', steps: sequence }] },
        nodeCount: childMetrics.nodes * 3 + 7, depth: childMetrics.depth + 2,
        primitiveCounts: { [child.type]: 3, route3: 1, select3: 6 },
        metrics: { nodes: childMetrics.nodes * 3 + 7, depth: childMetrics.depth + 2, wires: inner.wires.size, transitions: 0, transitionScenario: 'reset plus one write/read at each top-level bank' },
        rationale: `Three proven ${child.label} blocks form a balanced address hierarchy. The high address trit routes packed read/idle/write action and chooses the corresponding six-lane read path.`,
        validation: 'Shares the direct accelerated memory read/write/reset sequence suite; invalid or unresolved addressing cannot select a child bank.',
      },
    };
    customComponents.set(id, meta); registerCustom(meta); structuralReferences.set(`structural-memory${locations}x6-v1`, meta); verifyStructuralReference(meta);
    if (!loadDemo) return { [`structural-memory${locations}x6-v1`]: meta };
    rootCircuit.clear(); rootCircuit.addComponent(meta.type, 0, 0, { label }); renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus(`Structural Memory ${locations}×6 loaded. Open internals to inspect its three-bank balanced address hierarchy.`);
    return { [`structural-memory${locations}x6-v1`]: meta };
  }

  function buildStructuralRoutingDemo(loadDemo = true) {
    const add = (labelBase, experiment, inputNames, outputNames, wire, cases) => {
      const label = uniqueName(labelBase, [...customComponents.values()].map((meta) => meta.label), labelBase);
      const id = `${slug(label)}-${Date.now().toString(36)}`;
      const inner = new Circuit(registry);
      const inputs = inputNames.map((name, index) => inner.addComponent('component-input', -430, (index - (inputNames.length - 1) / 2) * 75, { name }));
      const outputs = outputNames.map((name, index) => inner.addComponent('component-output', 430, (index - (outputNames.length - 1) / 2) * 75, { name }));
      wire(inner, inputs, outputs);
      const meta = { id, type: `custom:${id}`, label, circuit: inner.serialize(), experiment };
      customComponents.set(id, meta); registerCustom(meta); testSuites.push({ componentId: id, cases: cases(inputs, outputs) });
      return meta;
    };
    const controlCases = (inputs, outputs) => [-1, 0, 1].map((control) => ({ id: `control-${control}`, name: `control=${fmt(control)}`, inputs: { [inputs[0].id]: control }, expectedOutputs: { [outputs[0].id]: control < 0 ? 1 : 0, [outputs[1].id]: control === 0 ? 1 : 0, [outputs[2].id]: control > 0 ? 1 : 0 } }));
    const selectCases = (inputs, outputs) => { const cases = []; for (const neg of [-1, 0, 1]) for (const zero of [-1, 0, 1]) for (const pos of [-1, 0, 1]) for (const select of [-1, 0, 1]) cases.push({ id: `select-${neg}-${zero}-${pos}-${select}`, name: `select=${fmt(select)}`, inputs: { [inputs[0].id]: neg, [inputs[1].id]: zero, [inputs[2].id]: pos, [inputs[3].id]: select }, expectedOutputs: { [outputs[0].id]: select < 0 ? neg : select === 0 ? zero : pos } }); return cases; };
    const routeCases = (inputs, outputs) => { const cases = []; for (const value of [-1, 0, 1]) for (const select of [-1, 0, 1]) cases.push({ id: `route-${value}-${select}`, name: `in=${fmt(value)}, select=${fmt(select)}`, inputs: { [inputs[0].id]: value, [inputs[1].id]: select }, expectedOutputs: { [outputs[0].id]: select < 0 ? value : 0, [outputs[1].id]: select === 0 ? value : 0, [outputs[2].id]: select > 0 ? value : 0 } }); return cases; };
    const control = add('Control3 — structural level detector', { role: 'structural reference', equivalence: { directType: 'control3' }, nodeCount: 1, depth: 1, primitiveCounts: { threshold3: 1 }, rationale: 'Threshold3 already exposes the one-hot negative, zero and positive control rails.', validation: 'Exhaustive 3/3 control cases saved.' }, ['control'], ['neg', 'zero', 'pos'], (inner, inputs, outputs) => {
      const detector = inner.addComponent('threshold3', 0, 0, { label: 'Decode control level' });
      inner.connect(inputs[0].id, 'out', detector.id, 'in'); ['neg', 'zero', 'pos'].forEach((port, index) => inner.connect(detector.id, port, outputs[index].id, 'in'));
    }, controlCases);
    const select = add('Select3 — structural pass/merge', { role: 'structural reference', equivalence: { directType: 'select3' }, nodeCount: 5, depth: 3, primitiveCounts: { threshold3: 1, pass3: 3, merge3: 1 }, rationale: 'Decode select into one-hot gates, pass exactly one data path and resolve it through Merge3.', validation: 'Exhaustive 81/81 known-trit cases saved.' }, ['neg', 'zero', 'pos', 'select'], ['out'], (inner, inputs, outputs) => {
      const detector = inner.addComponent('threshold3', -130, 120, { label: 'Decode select' });
      const passes = ['neg', 'zero', 'pos'].map((name, index) => inner.addComponent('pass3', 70, (index - 1) * 75, { label: name + ' pass' }));
      const merge = inner.addComponent('merge3', 250, 0, { label: 'Selected-path merge' });
      inner.connect(inputs[3].id, 'out', detector.id, 'in');
      ['neg', 'zero', 'pos'].forEach((name, index) => { inner.connect(inputs[index].id, 'out', passes[index].id, 'in'); inner.connect(detector.id, name, passes[index].id, 'gate'); inner.connect(passes[index].id, 'out', merge.id, ['a', 'b', 'c'][index]); });
      inner.connect(merge.id, 'out', outputs[0].id, 'in');
    }, selectCases);
    const route = add('Route3 — structural gated/merged', { role: 'structural reference', equivalence: { directType: 'route3' }, nodeCount: 15, depth: 4, primitiveCounts: { threshold3: 1, 'clock-phase3': 3, 'ternary-reference': 1, pass3: 7, merge3: 3 }, rationale: 'Each output uses its selected data pass or a zero-reference pass. Merge3 makes the one active branch explicit; a shared disabled pass supplies Z as the unused third merge branch.', validation: 'Exhaustive 9/9 known-trit cases saved.' }, ['in', 'select'], ['neg', 'zero', 'pos'], (inner, inputs, outputs) => {
      const detector = inner.addComponent('threshold3', -200, -80, { label: 'Decode route' });
      const zero = inner.addComponent('ternary-reference', -200, 210, { value: 0, label: 'Zero reference' });
      const open = inner.addComponent('pass3', -30, 260, { label: 'Open Z branch' });
      const branches = ['neg', 'zero', 'pos'].map((name, index) => ({ name, inverse: inner.addComponent('clock-phase3', -20, (index - 1) * 120, { label: 'Not ' + name }), data: inner.addComponent('pass3', 150, (index - 1) * 120 - 30, { label: name + ' data pass' }), fill: inner.addComponent('pass3', 150, (index - 1) * 120 + 35, { label: name + ' zero pass' }), merge: inner.addComponent('merge3', 320, (index - 1) * 120, { label: name + ' output merge' }) }));
      inner.connect(inputs[1].id, 'out', detector.id, 'in'); inner.connect(zero.id, 'out', open.id, 'in'); inner.connect(zero.id, 'out', open.id, 'gate');
      branches.forEach((branch, index) => { inner.connect(detector.id, branch.name, branch.inverse.id, 'clock'); inner.connect(inputs[0].id, 'out', branch.data.id, 'in'); inner.connect(detector.id, branch.name, branch.data.id, 'gate'); inner.connect(zero.id, 'out', branch.fill.id, 'in'); inner.connect(branch.inverse.id, 'out', branch.fill.id, 'gate'); inner.connect(branch.data.id, 'out', branch.merge.id, 'a'); inner.connect(branch.fill.id, 'out', branch.merge.id, 'b'); inner.connect(open.id, 'out', branch.merge.id, 'c'); inner.connect(branch.merge.id, 'out', outputs[index].id, 'in'); });
    }, routeCases);
    const controlCases2 = (inputs, outputs, op) => { const cases = []; for (const a of [0, 1]) for (const b of [0, 1]) cases.push({ id: op + '-' + a + '-' + b, name: 'a=' + a + ', b=' + b, inputs: { [inputs[0].id]: a, [inputs[1].id]: b }, expectedOutputs: { [outputs[0].id]: op === 'and' ? (a && b ? 1 : 0) : (a || b ? 1 : 0) } }); return cases; };
    const andGate = add('Control AND — structural', { role: 'structural utility', nodeCount: 6, depth: 3, primitiveCounts: { 'ternary-reference': 1, 'clock-phase3': 1, pass3: 3, merge3: 1 }, rationale: 'For one-hot 0/+1 control rails, A passes only when B is +1. The inverse-B zero path turns disabled transmission into an explicit logical zero before Merge3.', validation: 'Exhaustive 4/4 binary-control cases saved.' }, ['a', 'b'], ['out'], (inner, inputs, outputs) => {
      const zero = inner.addComponent('ternary-reference', -160, 140, { value: 0, label: 'Zero reference' });
      const invertB = inner.addComponent('clock-phase3', -120, 60, { label: 'Not B' });
      const data = inner.addComponent('pass3', 40, -30, { label: 'A gated by B' });
      const fill = inner.addComponent('pass3', 40, 40, { label: 'Zero when B is low' });
      const open = inner.addComponent('pass3', 40, 120, { label: 'Open Z branch' });
      const merge = inner.addComponent('merge3', 220, 0, { label: 'AND merge' });
      inner.connect(inputs[1].id, 'out', invertB.id, 'clock'); inner.connect(inputs[0].id, 'out', data.id, 'in'); inner.connect(inputs[1].id, 'out', data.id, 'gate'); inner.connect(zero.id, 'out', fill.id, 'in'); inner.connect(invertB.id, 'out', fill.id, 'gate'); inner.connect(zero.id, 'out', open.id, 'in'); inner.connect(zero.id, 'out', open.id, 'gate'); inner.connect(data.id, 'out', merge.id, 'a'); inner.connect(fill.id, 'out', merge.id, 'b'); inner.connect(open.id, 'out', merge.id, 'c'); inner.connect(merge.id, 'out', outputs[0].id, 'in');
    }, (inputs, outputs) => controlCases2(inputs, outputs, 'and'));
    const orGate = add('Control OR — structural', { role: 'structural utility', nodeCount: 7, depth: 3, primitiveCounts: { 'ternary-reference': 2, 'clock-phase3': 1, pass3: 3, merge3: 1 }, rationale: 'For one-hot 0/+1 control rails, the +1 reference passes when A is high; otherwise B passes through the inverse-A path. Merge3 proves that only one branch drives.', validation: 'Exhaustive 4/4 binary-control cases saved.' }, ['a', 'b'], ['out'], (inner, inputs, outputs) => {
      const high = inner.addComponent('ternary-reference', -160, 140, { value: 1, label: '+1 reference' });
      const zero = inner.addComponent('ternary-reference', -160, 205, { value: 0, label: 'Zero reference' });
      const invertA = inner.addComponent('clock-phase3', -120, 60, { label: 'Not A' });
      const aHigh = inner.addComponent('pass3', 40, -30, { label: '+1 when A is high' });
      const bPath = inner.addComponent('pass3', 40, 40, { label: 'B when A is low' });
      const open = inner.addComponent('pass3', 40, 120, { label: 'Open Z branch' });
      const merge = inner.addComponent('merge3', 220, 0, { label: 'OR merge' });
      inner.connect(inputs[0].id, 'out', invertA.id, 'clock'); inner.connect(high.id, 'out', aHigh.id, 'in'); inner.connect(inputs[0].id, 'out', aHigh.id, 'gate'); inner.connect(inputs[1].id, 'out', bPath.id, 'in'); inner.connect(invertA.id, 'out', bPath.id, 'gate'); inner.connect(zero.id, 'out', open.id, 'in'); inner.connect(zero.id, 'out', open.id, 'gate'); inner.connect(aHigh.id, 'out', merge.id, 'a'); inner.connect(bPath.id, 'out', merge.id, 'b'); inner.connect(open.id, 'out', merge.id, 'c'); inner.connect(merge.id, 'out', outputs[0].id, 'in');
    }, (inputs, outputs) => controlCases2(inputs, outputs, 'or'));
    const minMaxCases = (inputs, outputs, op) => { const cases = []; for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) cases.push({ id: op + '-' + a + '-' + b, name: 'a=' + fmt(a) + ', b=' + fmt(b), inputs: { [inputs[0].id]: a, [inputs[1].id]: b }, expectedOutputs: { [outputs[0].id]: op === 'min' ? Math.min(a, b) : Math.max(a, b) } }); return cases; };
    const minGate = add('MIN — structural selector tree', { role: 'structural reference', equivalence: { directType: 'min' }, nodeCount: 12, depth: 6, primitiveCounts: { 'ternary-reference': 2, [select.type]: 2 }, rationale: 'First choose min(0,B): -1 for negative B and 0 otherwise. Then choose -1, that middle result or B according to A. Both selector instances are the open pass/merge Select3 structure.', validation: 'Exhaustive 9/9 a,b cases saved.' }, ['a', 'b'], ['out'], (inner, inputs, outputs) => {
      const neg = inner.addComponent('ternary-reference', -250, -130, { value: -1, label: '-1 reference' });
      const zero = inner.addComponent('ternary-reference', -250, 130, { value: 0, label: 'Zero reference' });
      const minZeroB = inner.addComponent(select.type, 0, 70, { label: 'min(0, B)' });
      const outer = inner.addComponent(select.type, 230, 0, { label: 'Select by A' });
      inner.connect(neg.id, 'out', minZeroB.id, 'neg'); inner.connect(zero.id, 'out', minZeroB.id, 'zero'); inner.connect(zero.id, 'out', minZeroB.id, 'pos'); inner.connect(inputs[1].id, 'out', minZeroB.id, 'select');
      inner.connect(neg.id, 'out', outer.id, 'neg'); inner.connect(minZeroB.id, 'out', outer.id, 'zero'); inner.connect(inputs[1].id, 'out', outer.id, 'pos'); inner.connect(inputs[0].id, 'out', outer.id, 'select'); inner.connect(outer.id, 'out', outputs[0].id, 'in');
    }, (inputs, outputs) => minMaxCases(inputs, outputs, 'min'));
    const maxGate = add('MAX — structural selector tree', { role: 'structural reference', equivalence: { directType: 'max' }, nodeCount: 12, depth: 6, primitiveCounts: { 'ternary-reference': 2, [select.type]: 2 }, rationale: 'First choose max(0,B): +1 for positive B and 0 otherwise. Then choose B, that middle result or +1 according to A. Both selector instances are the open pass/merge Select3 structure.', validation: 'Exhaustive 9/9 a,b cases saved.' }, ['a', 'b'], ['out'], (inner, inputs, outputs) => {
      const zero = inner.addComponent('ternary-reference', -250, -130, { value: 0, label: 'Zero reference' });
      const pos = inner.addComponent('ternary-reference', -250, 130, { value: 1, label: '+1 reference' });
      const maxZeroB = inner.addComponent(select.type, 0, 70, { label: 'max(0, B)' });
      const outer = inner.addComponent(select.type, 230, 0, { label: 'Select by A' });
      inner.connect(zero.id, 'out', maxZeroB.id, 'neg'); inner.connect(zero.id, 'out', maxZeroB.id, 'zero'); inner.connect(pos.id, 'out', maxZeroB.id, 'pos'); inner.connect(inputs[1].id, 'out', maxZeroB.id, 'select');
      inner.connect(inputs[1].id, 'out', outer.id, 'neg'); inner.connect(maxZeroB.id, 'out', outer.id, 'zero'); inner.connect(pos.id, 'out', outer.id, 'pos'); inner.connect(inputs[0].id, 'out', outer.id, 'select'); inner.connect(outer.id, 'out', outputs[0].id, 'in');
    }, (inputs, outputs) => minMaxCases(inputs, outputs, 'max'));
    const negateGate = add('Negate — structural level permutation', { role: 'structural reference', equivalence: { directType: 'negate' }, nodeCount: 8, depth: 3, primitiveCounts: { threshold3: 1, 'ternary-reference': 3, pass3: 3, merge3: 1 }, rationale: 'Decode the input into one-hot levels, then pass +1 for negative, 0 for zero and -1 for positive through Merge3.', validation: 'Exhaustive 3/3 input cases saved.' }, ['in'], ['out'], (inner, inputs, outputs) => {
      const detector = inner.addComponent('threshold3', -180, 0, { label: 'Decode input' });
      const neg = inner.addComponent('ternary-reference', -180, 135, { value: -1, label: '-1 reference' });
      const zero = inner.addComponent('ternary-reference', -180, 205, { value: 0, label: 'Zero reference' });
      const pos = inner.addComponent('ternary-reference', -180, 275, { value: 1, label: '+1 reference' });
      const paths = ['neg', 'zero', 'pos'].map((name, index) => inner.addComponent('pass3', 40, (index - 1) * 75, { label: name + ' output path' }));
      const merge = inner.addComponent('merge3', 230, 0, { label: 'Negated-level merge' });
      inner.connect(inputs[0].id, 'out', detector.id, 'in');
      inner.connect(pos.id, 'out', paths[0].id, 'in'); inner.connect(detector.id, 'neg', paths[0].id, 'gate');
      inner.connect(zero.id, 'out', paths[1].id, 'in'); inner.connect(detector.id, 'zero', paths[1].id, 'gate');
      inner.connect(neg.id, 'out', paths[2].id, 'in'); inner.connect(detector.id, 'pos', paths[2].id, 'gate');
      paths.forEach((pass, index) => inner.connect(pass.id, 'out', merge.id, ['a', 'b', 'c'][index])); inner.connect(merge.id, 'out', outputs[0].id, 'in');
    }, (inputs, outputs) => [-1, 0, 1].map((value) => ({ id: 'negate-' + value, name: 'in=' + fmt(value), inputs: { [inputs[0].id]: value }, expectedOutputs: { [outputs[0].id]: -value } })));
    const compareGate = add('Compare — structural selector tree', { role: 'structural reference', equivalence: { directType: 'compare' }, nodeCount: 23, depth: 6, primitiveCounts: { 'ternary-reference': 3, [select.type]: 4 }, rationale: 'Three selectors encode the A=-1, A=0 and A=+1 rows of the 3×3 comparison table as functions of B. A fourth structural Select3 chooses the row using A.', validation: 'Exhaustive 9/9 a,b cases saved.' }, ['a', 'b'], ['out'], (inner, inputs, outputs) => {
      const neg = inner.addComponent('ternary-reference', -300, -180, { value: -1, label: '-1 reference' });
      const zero = inner.addComponent('ternary-reference', -300, 0, { value: 0, label: 'Zero reference' });
      const pos = inner.addComponent('ternary-reference', -300, 180, { value: 1, label: '+1 reference' });
      const rowNeg = inner.addComponent(select.type, -40, -160, { label: 'A = -1 row' });
      const rowZero = inner.addComponent(select.type, -40, 0, { label: 'A = 0 row' });
      const rowPos = inner.addComponent(select.type, -40, 160, { label: 'A = +1 row' });
      const chooseRow = inner.addComponent(select.type, 230, 0, { label: 'Choose row by A' });
      [[rowNeg, [zero, neg, neg]], [rowZero, [pos, zero, neg]], [rowPos, [pos, pos, zero]]].forEach(([row, values]) => { ['neg', 'zero', 'pos'].forEach((port, index) => inner.connect(values[index].id, 'out', row.id, port)); inner.connect(inputs[1].id, 'out', row.id, 'select'); });
      inner.connect(rowNeg.id, 'out', chooseRow.id, 'neg'); inner.connect(rowZero.id, 'out', chooseRow.id, 'zero'); inner.connect(rowPos.id, 'out', chooseRow.id, 'pos'); inner.connect(inputs[0].id, 'out', chooseRow.id, 'select'); inner.connect(chooseRow.id, 'out', outputs[0].id, 'in');
    }, (inputs, outputs) => { const cases = []; for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) cases.push({ id: 'compare-' + a + '-' + b, name: 'a=' + fmt(a) + ', b=' + fmt(b), inputs: { [inputs[0].id]: a, [inputs[1].id]: b }, expectedOutputs: { [outputs[0].id]: a < b ? -1 : a > b ? 1 : 0 } }); return cases; });
    const normalizeGate = add('Normalize / carry — structural decision tree', { role: 'structural reference', equivalence: { directType: 'normalize-carry' }, nodeCount: 133, depth: 9, primitiveCounts: { 'ternary-reference': 3, [select.type]: 26 }, rationale: 'For each output, nine C-selectors encode every A/B row, three B-selectors choose a row and one A-selector chooses the final row. Sum and carry use the same open structural Select3 primitive and explicit -1/0/+1 references.', validation: 'Exhaustive 27/27 a,b,c cases saved.' }, ['a', 'b', 'c'], ['sum', 'carry'], (inner, inputs, outputs) => {
      const refs = new Map([-1, 0, 1].map((value, index) => [value, inner.addComponent('ternary-reference', -620, (index - 1) * 100, { value, label: fmt(value) + ' reference' })]));
      const buildOutputTree = (name, output, yOffset) => {
        const aRows = [];
        for (const a of [-1, 0, 1]) {
          const bRows = [];
          for (const b of [-1, 0, 1]) {
            const byC = inner.addComponent(select.type, -340, yOffset + (a + 1) * 260 + (b + 1) * 75, { label: name + ': A=' + fmt(a) + ', B=' + fmt(b) });
            for (const c of [-1, 0, 1]) {
              const raw = a + b + c;
              const carry = raw <= -2 ? -1 : raw >= 2 ? 1 : 0;
              const value = name === 'sum' ? raw - 3 * carry : carry;
              inner.connect(refs.get(value).id, 'out', byC.id, c < 0 ? 'neg' : c > 0 ? 'pos' : 'zero');
            }
            inner.connect(inputs[2].id, 'out', byC.id, 'select');
            bRows.push(byC);
          }
          const byB = inner.addComponent(select.type, 0, yOffset + (a + 1) * 260, { label: name + ': choose B row for A=' + fmt(a) });
          ['neg', 'zero', 'pos'].forEach((port, index) => inner.connect(bRows[index].id, 'out', byB.id, port)); inner.connect(inputs[1].id, 'out', byB.id, 'select');
          aRows.push(byB);
        }
        const byA = inner.addComponent(select.type, 250, yOffset + 260, { label: name + ': choose A row' });
        ['neg', 'zero', 'pos'].forEach((port, index) => inner.connect(aRows[index].id, 'out', byA.id, port)); inner.connect(inputs[0].id, 'out', byA.id, 'select'); inner.connect(byA.id, 'out', output.id, 'in');
      };
      buildOutputTree('sum', outputs[0], -520); buildOutputTree('carry', outputs[1], 400);
    }, (inputs, outputs) => { const cases = []; for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) { const raw = a + b + c; const carry = raw <= -2 ? -1 : raw >= 2 ? 1 : 0; cases.push({ id: 'normalize-' + a + '-' + b + '-' + c, name: 'a=' + fmt(a) + ', b=' + fmt(b) + ', c=' + fmt(c), inputs: { [inputs[0].id]: a, [inputs[1].id]: b, [inputs[2].id]: c }, expectedOutputs: { [outputs[0].id]: raw - 3 * carry, [outputs[1].id]: carry } }); } return cases; });
    const adjustGate = add('Adjust3 — structural normalize', { role: 'structural reference', equivalence: { directType: 'adjust3' }, nodeCount: 134, depth: 10, primitiveCounts: { 'ternary-reference': 1, [normalizeGate.type]: 1 }, rationale: 'A declared zero rail turns the three-input structural Normalize / carry network into the value + control adjustment contract.', validation: 'Exhaustive 9/9 value/control cases saved.' }, ['value', 'control'], ['next', 'carry'], (inner, inputs, outputs) => {
      const zero = inner.addComponent('ternary-reference', -180, 120, { value: 0, label: 'Zero reference' });
      const normalize = inner.addComponent(normalizeGate.type, 0, 0, { label: 'Normalize value + control' });
      inner.connect(inputs[0].id, 'out', normalize.id, 'a'); inner.connect(inputs[1].id, 'out', normalize.id, 'b'); inner.connect(zero.id, 'out', normalize.id, 'c');
      inner.connect(normalize.id, 'sum', outputs[0].id, 'in'); inner.connect(normalize.id, 'carry', outputs[1].id, 'in');
    }, (inputs, outputs) => { const cases = []; for (const value of [-1, 0, 1]) for (const control of [-1, 0, 1]) { const raw = value + control; const carry = raw < -1 ? -1 : raw > 1 ? 1 : 0; cases.push({ id: `adjust-${value}-${control}`, name: `value=${fmt(value)}, control=${fmt(control)}`, inputs: { [inputs[0].id]: value, [inputs[1].id]: control }, expectedOutputs: { [outputs[0].id]: raw - 3 * carry, [outputs[1].id]: carry } }); } return cases; });
    const references = {
      'structural-control3-v1': control,
      'structural-select3-v1': select,
      'structural-route3-v1': route,
      'structural-min-v1': minGate,
      'structural-max-v1': maxGate,
      'structural-negate-v1': negateGate,
      'structural-compare-v1': compareGate,
      'structural-normalize-carry-v1': normalizeGate,
      'structural-adjust3-v1': adjustGate,
    };
    Object.entries(references).forEach(([name, meta]) => structuralReferences.set(name, meta));
    Object.values(references).forEach(verifyStructuralReference);
    if (!loadDemo) return references;
    rootCircuit.clear(); [control, select, route, andGate, orGate, minGate, maxGate, negateGate, compareGate, normalizeGate, adjustGate].forEach((meta, index) => rootCircuit.addComponent(meta.type, -1650 + index * 330, 0, { label: meta.label }));
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Structural routing lab loaded. Each component has saved exhaustive known-trit cases; open it to inspect detector, pass, Merge3, zero-reference and control-inverter cells.');
  }

  function buildCompareDemo() {
    rootCircuit.clear();
    const a = rootCircuit.addComponent('trit-input', -320, -90, { value: 1 });
    const b = rootCircuit.addComponent('trit-input', -320, 80, { value: 0 });
    const neg = rootCircuit.addComponent('negate', -80, -90);
    const cmp = rootCircuit.addComponent('compare', 150, 0);
    const out = rootCircuit.addComponent('probe', 400, 0);
    rootCircuit.connect(a.id, 'out', neg.id, 'in'); rootCircuit.connect(neg.id, 'out', cmp.id, 'a');
    rootCircuit.connect(b.id, 'out', cmp.id, 'b'); rootCircuit.connect(cmp.id, 'out', out.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Compare demo loaded. Change either input to inspect the result.');
  }

  function stopVisualizeTimer() {
    if (simulation.timer) clearTimeout(simulation.timer);
    simulation.timer = null;
  }

  function applyExecutionModeToCircuit() {
    circuit().setExecutionMode(simulation.mode === 'run' ? 'instant' : 'manual');
  }

  function updateSimulationButtons() {
    runBtn.classList.toggle('active', simulation.mode === 'run');
    visualizeBtn.classList.toggle('active', simulation.mode === 'visualize');
    pauseBtn.classList.toggle('active', simulation.mode === 'paused');
    pauseBtn.textContent = simulation.mode === 'paused' ? 'Resume' : 'Pause';
  }

  function fmtTimelineValue(value) { return fmt(value); }
  function renderStateTimeline() {
    stateTimelineEl.innerHTML = '';
    if (!stateTimeline.length) { stateTimelineEl.innerHTML = '<div class="queue-empty">No state events.</div>'; return; }
    for (const entry of stateTimeline.slice(-40).reverse()) {
      const row = document.createElement('div'); row.className = 'queue-event';
      row.innerHTML = `<span class="seq">${esc(entry.kind)}</span><div><strong>${esc(entry.label)}</strong><small>${esc(entry.detail)}</small></div>`;
      stateTimelineEl.appendChild(row);
    }
  }
  function addStateTimeline(kind, componentId, detail) {
    const component = circuit().components.get(componentId), definition = component ? registry.get(component.type) : null;
    stateTimeline.push({ kind, label: component?.state?.label || definition?.label || componentId, detail });
    if (stateTimeline.length > 200) stateTimeline.shift(); renderStateTimeline();
  }
  function clearStateTimeline() { stateTimeline.length = 0; renderStateTimeline(); }

  function renderQueueInspector() {
    const events = circuit().getQueuedEvents();
    queueCount.textContent = String(events.length);
    queueList.innerHTML = '';
    if (!events.length) {
      queueList.innerHTML = '<div class="queue-empty">No queued events.</div>';
      return;
    }
    for (const event of events.slice(0, 40)) {
      const row = document.createElement('div');
      row.className = 'queue-event';
      row.innerHTML = `<span class="seq">#${event.sequence}</span><div><strong>${esc(event.label || event.componentId)} <span class="muted">(${esc(event.componentId)})</span></strong><small>${esc(event.reason || 'queued')}</small></div>`;
      queueList.appendChild(row);
    }
    if (events.length > 40) {
      const more = document.createElement('div');
      more.className = 'queue-empty';
      more.textContent = `+ ${events.length - 40} more queued events`;
      queueList.appendChild(more);
    }
  }

  function scheduleVisualizeStep() {
    stopVisualizeTimer();
    if (simulation.mode !== 'visualize') return;
    const delay = Math.max(50, Number(visualizeSpeed.value) || 500);
    simulation.timer = setTimeout(() => {
      simulation.timer = null;
      if (simulation.mode !== 'visualize') return;
      try {
        if (circuit().getQueuedEvents().length) circuit().stepPropagation();
      } catch (error) {
        setSimulationMode('paused');
        setStatus(error.message, true);
        return;
      }
      updateStats();
      refreshComponentTestPanel();
      renderQueueInspector();
      scheduleVisualizeStep();
    }, delay);
  }

  function setSimulationMode(mode, { announce = true } = {}) {
    stopVisualizeTimer();
    if (mode === 'paused') {
      if (simulation.mode !== 'paused') simulation.previousMode = simulation.mode;
      simulation.mode = 'paused';
    } else {
      simulation.mode = mode;
      simulation.previousMode = mode;
    }
    applyExecutionModeToCircuit();

    if (simulation.mode === 'run') {
      try {
        if (circuit().getQueuedEvents().length) circuit().simulate();
      } catch (error) { setStatus(error.message, true); }
    } else if (simulation.mode === 'visualize') {
      scheduleVisualizeStep();
    }
    updateSimulationButtons();
    renderQueueInspector();
    updateStats();
    if (announce) {
      const text = simulation.mode === 'run' ? 'RUN: changes settle immediately.'
        : simulation.mode === 'visualize' ? 'VISUALIZE: one propagation event is executed at a time.'
        : 'Paused: changes are queued until STEP, Resume or RUN.';
      setStatus(text);
    }
  }

  function togglePause() {
    if (simulation.mode === 'paused') setSimulationMode(simulation.previousMode || 'run');
    else setSimulationMode('paused');
  }

  function stepOnce() {
    if (simulation.mode !== 'paused') setSimulationMode('paused', { announce: false });
    try {
      const result = circuit().stepPropagation();
      if (!result) setStatus('STEP: event queue is empty.');
      else setStatus(`STEP: evaluated ${result.component?.state?.label || result.component?.type || result.componentId} (${result.componentId}).`);
    } catch (error) { setStatus(error.message, true); }
    updateStats(); refreshComponentTestPanel(); renderQueueInspector();
  }

  function clockStep() {
    try {
      const count = circuit().clockStep();
      if (!count) return setStatus('CLOCK STEP: no Sequence generator exists in this circuit.', true);
      setStatus(`CLOCK STEP: advanced ${count} sequence generator${count === 1 ? '' : 's'}; registers sample automatically on a 0 → +1 transition.`);
      if (simulation.mode === 'visualize') scheduleVisualizeStep();
      updateStats(); renderQueueInspector();
    } catch (error) { setStatus(error.message, true); }
  }

  function computerConsoleContext() {
    if (current.kind !== 'root') return null;
    const cpu = [...rootCircuit.components.values()].find((component) => component.type === 'cpu6');
    const clock = [...rootCircuit.components.values()].find((component) => component.type === 'sequence-generator' && String(component.state?.label || '').startsWith('Computer clock'));
    const loader = [...rootCircuit.components.values()].find((component) => component.type === 'cpu-program-loader6');
    const memory = [...rootCircuit.components.values()].find((component) => component.type === 'memory27x6' || component.type === 'memory729x6');
    const io = [...rootCircuit.components.values()].find((component) => component.type === 'cpu-io-adapter3x3');
    return cpu && clock && loader ? { cpu, clock, loader, memory, io } : null;
  }

  const PROGRAM_FORMAT = 'ternary-program';
  const exampleProgram = () => ({ format: PROGRAM_FORMAT, version: 1, name: '18C arithmetic and memory', description: 'LIT −4 and +1, ADD, STORE, LOAD, then HALT.', words: [
    { address: 0, word: [1, -1, -1, -1, -1, -1], label: 'LIT R−, −, −' }, { address: 1, word: [1, -1, -1, 0, 0, 1], label: 'LIT R0, 0, +' }, { address: 2, word: [-1, -1, 1, 1, 0, 0], label: 'ADD R+, R0, R0' }, { address: 3, word: [-1, 0, 1, 0, -1, 1], label: 'STORE [R−], R+' }, { address: 4, word: [-1, 0, 0, 0, -1, 0], label: 'LOAD R0, [R−]' }, { address: 5, word: [-1, -1, -1, 0, 0, 0], label: 'HALT' },
  ] });
  const ioExampleProgram = () => ({ format: PROGRAM_FORMAT, version: 1, name: 'Joystick to Pixel Display', description: 'Reads memory-mapped joystick X/Y, packs x/y/+ colour, writes Pixel Display 3×3, and repeats.', words: [
    { address: 0, word: [...CPU_OPCODES.LIT, -1, -1, -1], label: 'LIT R−, −, −  ; joystick X at −4' },
    { address: 1, word: [...CPU_OPCODES.LOAD, 0, -1, 0], label: 'LOAD R0, [R−]' },
    { address: 2, word: [...CPU_OPCODES.LIT, -1, -1, 0], label: 'LIT R−, −, 0  ; joystick Y at −3' },
    { address: 3, word: [...CPU_OPCODES.LOAD, 1, -1, 0], label: 'LOAD R+, [R−]' },
    { address: 4, word: [...CPU_OPCODES.ADD, 0, 0, 1], label: 'ADD R0, R0, R+' },
    { address: 5, word: [...CPU_OPCODES.LIT, 1, 0, 1], label: 'LIT R+, 0, +  ; colour +1' },
    { address: 6, word: [...CPU_OPCODES.ADD, 0, 0, 1], label: 'ADD R0, R0, R+' },
    { address: 7, word: [...CPU_OPCODES.LIT, 1, 1, 1], label: 'LIT R+, +, +  ; display port +4' },
    { address: 8, word: [...CPU_OPCODES.STORE, 0, 1, 0], label: 'STORE [R+], R0' },
    { address: 9, word: [...CPU_OPCODES.LIT, 1, 0, 0], label: 'LIT R+, 0, 0' },
    { address: 10, word: [...CPU_OPCODES.JUMP, 0, 1, 0], label: 'JUMP R+' },
  ] });
  const exampleProgramSource = `# A six-instruction arithmetic and memory program
LIT R-, -, -
LIT R0, 0, +
ADD R+, R0, R0
STORE [R-], R+
LOAD R0, [R-]
HALT`;
  function sourceTrit(token, lineNumber) {
    const value = String(token || '').trim().replaceAll('−', '-');
    if (value === '-' || value === '-1') return -1;
    if (value === '0') return 0;
    if (value === '+' || value === '+1' || value === '1') return 1;
    throw new Error(`Line ${lineNumber}: expected a ternary digit (−, 0 or +), got “${token}”.`);
  }
  function sourceRegister(token, lineNumber) {
    const value = String(token || '').trim().toUpperCase().replaceAll('−', '-');
    if (value === 'R-' || value === 'R−') return -1;
    if (value === 'R0') return 0;
    if (value === 'R+' || value === 'R＋') return 1;
    throw new Error(`Line ${lineNumber}: expected R−, R0 or R+, got “${token}”.`);
  }
  function parseProgramSource(source, name, description) {
    let address = 0;
    const words = [];
    String(source || '').split(/\r?\n/).forEach((rawLine, index) => {
      const lineNumber = index + 1;
      let line = rawLine.replace(/[;#].*$/, '').trim();
      if (!line) return;
      const addressMatch = line.match(/^([+-]?\d+)\s*:\s*(.*)$/);
      if (addressMatch) { address = Number(addressMatch[1]); line = addressMatch[2].trim(); }
      const orgMatch = line.match(/^\.ORG\s+([+-]?\d+)$/i);
      if (orgMatch) { address = Number(orgMatch[1]); return; }
      if (!Number.isInteger(address) || address < -364 || address > 364) throw new Error(`Line ${lineNumber}: address must be between −364 and +364.`);
      const tokens = line.replace(/[\[\],]/g, ' ').trim().split(/\s+/);
      const mnemonic = tokens.shift().toUpperCase();
      const requireArgs = (count) => { if (tokens.length !== count) throw new Error(`Line ${lineNumber}: ${mnemonic} needs ${count} operand${count === 1 ? '' : 's'}.`); };
      let word;
      if (mnemonic === '.WORD') { requireArgs(6); word = tokens.map((token) => sourceTrit(token, lineNumber)); }
      else if (mnemonic === 'HALT' || mnemonic === 'NOP') { requireArgs(0); word = [...CPU_OPCODES[mnemonic], 0, 0, 0]; }
      else if (mnemonic === 'MOV') { requireArgs(2); word = [...CPU_OPCODES.MOV, sourceRegister(tokens[0], lineNumber), sourceRegister(tokens[1], lineNumber), 0]; }
      else if (mnemonic === 'ADD' || mnemonic === 'SUB') { requireArgs(3); word = [...CPU_OPCODES[mnemonic], sourceRegister(tokens[0], lineNumber), sourceRegister(tokens[1], lineNumber), sourceRegister(tokens[2], lineNumber)]; }
      else if (mnemonic === 'LOAD') { requireArgs(2); word = [...CPU_OPCODES.LOAD, sourceRegister(tokens[0], lineNumber), sourceRegister(tokens[1], lineNumber), 0]; }
      else if (mnemonic === 'STORE') { requireArgs(2); word = [...CPU_OPCODES.STORE, 0, sourceRegister(tokens[0], lineNumber), sourceRegister(tokens[1], lineNumber)]; }
      else if (mnemonic === 'JUMP') { requireArgs(1); word = [...CPU_OPCODES.JUMP, 0, sourceRegister(tokens[0], lineNumber), 0]; }
      else if (mnemonic === 'BRZ') { requireArgs(2); word = [...CPU_OPCODES.BRZ, 0, sourceRegister(tokens[0], lineNumber), sourceRegister(tokens[1], lineNumber)]; }
      else if (mnemonic === 'LIT') { requireArgs(3); word = [...CPU_OPCODES.LIT, sourceRegister(tokens[0], lineNumber), sourceTrit(tokens[1], lineNumber), sourceTrit(tokens[2], lineNumber)]; }
      else throw new Error(`Line ${lineNumber}: unknown instruction “${mnemonic}”.`);
      words.push({ address, word, label: rawLine.trim() });
      address += 1;
    });
    return normalizeProgram({ format: PROGRAM_FORMAT, version: 1, name, description, words });
  }
  function openProgramEditor() {
    if (!computerConsoleContext()) return setStatus('Open Runnable CPU console before writing a program.', true);
    programEditorName.value = 'My ternary program';
    programEditorDescription.value = '';
    programEditorSource.value = exampleProgramSource;
    programEditorDialog.showModal();
    programEditorSource.focus();
  }
  function loadWrittenProgram(event) {
    event.preventDefault();
    try {
      loadProgram(parseProgramSource(programEditorSource.value, programEditorName.value, programEditorDescription.value));
      programEditorDialog.close();
    } catch (error) { setStatus(`Program validation failed: ${error.message}`, true); }
  }
  function normalizeProgram(data) {
    if (!data || data.format !== PROGRAM_FORMAT || Number(data.version) !== 1 || !Array.isArray(data.words)) throw new Error('Unsupported program file.');
    const words = data.words.map((entry) => ({ address: Number(entry.address), word: Array.isArray(entry.word) ? entry.word.map(trit) : [], label: String(entry.label || '') })).filter((entry) => Number.isInteger(entry.address) && entry.address >= -364 && entry.address <= 364 && entry.word.length === 6 && entry.word.every((value) => value === -1 || value === 0 || value === 1));
    if (!words.length || new Set(words.map((entry) => entry.address)).size !== words.length) throw new Error('A program needs unique addresses from −364 through +364 and six known trits per word.');
    return { format: PROGRAM_FORMAT, version: 1, name: String(data.name || 'Untitled program'), description: String(data.description || ''), words: words.sort((a, b) => a.address - b.address) };
  }
  function loadProgram(data) {
    const context = computerConsoleContext();
    if (!context) return setStatus('Open Runnable CPU console before loading a program.', true);
    const program = normalizeProgram(data);
    stopComputerRun(); rootCircuit.setState(context.loader.id, { program: program.words, programName: program.name, index: 0, active: true }); rootCircuit.simulate();
    for (let step = 0; step < program.words.length * 2; step += 1) computerClockStep({ announce: false });
    const memoryLabel = context.memory?.state?.label || 'program / data memory';
    setStatus(`Loaded “${program.name}” through ${memoryLabel}. CPU is reset at PC 0 and has not executed; inspect the memory list, then Run computer or Instruction step.`);
  }
  async function importProgram() {
    const file = programFile.files?.[0]; if (!file) return;
    try { loadProgram(JSON.parse(await file.text())); } catch (error) { setStatus(`Program import failed: ${error.message}`, true); } finally { programFile.value = ''; }
  }
  function exportProgram() {
    const context = computerConsoleContext(); if (!context) return setStatus('Open Runnable CPU console before exporting a program.', true);
    const program = normalizeProgram({ ...exampleProgram(), name: context.loader.state.programName || 'Loaded program', words: context.loader.state.program || [] });
    downloadJson(`${slug(program.name) || 'ternary-program'}.ternary-program.json`, program); setStatus(`Exported “${program.name}”.`);
  }

  function stopComputerRun() {
    if (computerRunTimer) clearInterval(computerRunTimer);
    computerRunTimer = null;
    if (computerRunBtn) computerRunBtn.textContent = 'Run computer';
  }

  function updateComputerControls() {
    if (!computerControls) return;
    const available = Boolean(computerConsoleContext());
    computerControls.hidden = !available;
    if (!available) stopComputerRun();
    else computerRunBtn.textContent = computerRunTimer ? 'Stop computer' : 'Run computer';
  }

  function computerClockStep({ announce = true } = {}) {
    const context = computerConsoleContext();
    if (!context) return false;
    rootCircuit.advanceSequenceGenerator(context.clock, 'computer clock');
    rootCircuit.simulate();
    updateStats(); renderQueueInspector();
    if (announce) setStatus('Computer clock advanced once. This is separate from simulator propagation stepping.');
    return true;
  }

  function computerInstructionStep() {
    const context = computerConsoleContext();
    if (!context) return setStatus('Open Runnable CPU console before stepping the computer.', true);
    // A complete instruction occupies one fetch edge and one execute edge;
    // the intervening falling transitions return the shared clock to zero.
    for (let edge = 0; edge < 4; edge += 1) computerClockStep({ announce: false });
    setStatus(context.cpu.outputs.halted === 1 ? 'Instruction step completed: computer is halted.' : 'Instruction step completed: one fetch/execute pair ran.');
  }

  function toggleComputerRun() {
    if (computerRunTimer) { stopComputerRun(); setStatus('Computer run stopped.'); return; }
    if (!computerConsoleContext()) return setStatus('Open Runnable CPU console before running the computer.', true);
    computerRunTimer = setInterval(() => {
      const context = computerConsoleContext();
      if (!context || context.cpu.outputs.halted === 1) { stopComputerRun(); if (context?.cpu.outputs.halted === 1) setStatus('Computer halted.'); return; }
      computerInstructionStep();
    }, 180);
    updateComputerControls(); setStatus('Computer running instruction-by-instruction.');
  }

  function startGeneratorTimer() {
    if (simulation.generatorTimer) clearInterval(simulation.generatorTimer);
    simulation.generatorLastTick = performance.now();
    simulation.generatorTimer = setInterval(() => {
      const now = performance.now();
      const delta = Math.min(1000, Math.max(0, now - simulation.generatorLastTick));
      simulation.generatorLastTick = now;
      if (simulation.mode === 'paused') return;
      try {
        const advances = circuit().tickSequenceGenerators(delta);
        if (advances) {
          updateStats();
          renderQueueInspector();
          if (simulation.mode === 'visualize') scheduleVisualizeStep();
        }
      } catch (error) {
        setSimulationMode('paused');
        setStatus(error.message, true);
      }
    }, 25);
  }

  function hookActiveCircuitEvents() {
    for (const unsubscribe of simulation.activeUnsubscribers) unsubscribe();
    simulation.activeUnsubscribers = [];
    const on = (type, fn) => simulation.activeUnsubscribers.push(circuit().events.on(type, fn));
    on('queue-changed', renderQueueInspector);
    on('propagation-step', () => { updateStats(); refreshComponentTestPanel(); });
    on('settled', () => { updateStats(); refreshComponentTestPanel(); renderQueueInspector(); });
    on('simulation-error', (error) => setStatus(error.message, true));
    on('state-staged', ({ componentId, patch }) => addStateTimeline('stage', componentId, Object.entries(patch).map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.map(fmtTimelineValue).join(', ')}]` : fmtTimelineValue(value)}`).join(' · ')));
    on('state-committed', ({ changes }) => {
      changes.forEach((change) => addStateTimeline('commit', change.componentId, `value ${fmtTimelineValue(change.before.value)} → ${fmtTimelineValue(change.after.value)}`));
      const cpuChange = changes.find((change) => circuit().components.get(change.componentId)?.type === 'cpu6');
      if (cpuChange) {
        const phase = trit(cpuChange.after.phase), pc = Array.isArray(cpuChange.after.pc) && cpuChange.after.pc.every((value) => value === -1 || value === 0 || value === 1) ? cpuChange.after.pc.reduce((total, value) => total * 3 + value, 0) : '?';
        addStateTimeline('cpu', cpuChange.componentId, `PC ${pc} · ${phase === 0 ? 'fetch' : phase === 1 ? 'execute' : phase === -1 ? 'halted' : '?'}`);
      }
    const selectedComponentType = renderer.selection?.kind === 'component'
      ? circuit().components.get(renderer.selection.id)?.type
      : null;
    const selectedMemory = ['memory27x6', 'memory729x6'].includes(selectedComponentType)
      && (changes.some((change) => change.componentId === renderer.selection.id) || cpuChange);
      if (selectedMemory) updateInspector({ kind: 'component', id: renderer.selection.id, item: circuit().components.get(renderer.selection.id) });
    });
    on('clock-step', ({ clocks }) => { stateTimeline.push({ kind: 'clock', label: 'Clock step', detail: `${clocks.length} source${clocks.length === 1 ? '' : 's'} advanced` }); renderStateTimeline(); });
    updateStats();
    renderQueueInspector();
    renderStateTimeline();
    updateSimulationButtons();
  }

  async function init() {
    if (!window.PIXI) return setStatus('PixiJS failed to load. Check the network connection.', true);
    renderer = new CircuitRenderer({
      element: $('workspace'), circuit: rootCircuit, registry,
      onSelectionChanged: updateInspector, onStatus: setStatus,
      onBeforeChange: beginHistory, onAfterChange: commitHistory,
      onOpenComponent: openCustomComponent,
    });
    await renderer.init();
    renderer.setViewState({ x: renderer.app.screen.width / 2, y: renderer.app.screen.height / 2, scale: 1 });

    $('newProjectBtn').addEventListener('click', () => createNewProject());
    $('deleteProjectBtn').addEventListener('click', deleteCurrentProject);
    $('newComponentBtn').addEventListener('click', createCustomComponent);
    primitiveSetSelect.addEventListener('change', () => {
      primitiveExperiment.activeId = primitiveSetSelect.value;
      if (primitiveExperiment.activeId !== 'custom') primitiveExperiment.customTypes = new Set(PRIMITIVE_SETS[primitiveExperiment.activeId]?.types || EXPERIMENTAL_PRIMITIVES);
      renderPrimitiveSetControls(); renderLibrary();
      setStatus(`Primitive set: ${primitiveSetSelect.options[primitiveSetSelect.selectedIndex]?.textContent || primitiveExperiment.activeId}. Existing circuits remain unchanged.`);
    });
    backBtn.addEventListener('click', goBack);
    $('saveBtn').addEventListener('click', () => saveProject());
    $('loadBtn').addEventListener('click', () => loadProject());
    const toolbarMenus = [...document.querySelectorAll('.toolbar-menu')];
    const closeOtherToolbarMenus = (active) => toolbarMenus.forEach((menu) => { if (menu !== active) menu.open = false; });
    toolbarMenus.forEach((menu) => {
      // Close on the summary click itself; this works consistently even where
      // the native <details> toggle event is delayed or not dispatched.
      menu.querySelector('summary').addEventListener('click', () => closeOtherToolbarMenus(menu));
    });
    projectSelect.addEventListener('change', () => switchProject(projectSelect.value));
    projectNameInput.addEventListener('change', () => { renameCurrentProject().catch((error) => setStatus(`Could not rename project: ${error.message}`, true)); });
    $('exportBtn').addEventListener('click', exportProject);
    $('importBtn').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => { const file = importFile.files?.[0]; if (file) importProjectFile(file); });
    importComponentBtn.addEventListener('click', () => importComponentFile.click());
    importComponentFile.addEventListener('change', () => { const file = importComponentFile.files?.[0]; if (file) importComponentPackage(file); });
    $('demoBtn').addEventListener('click', buildDemo);
    undoBtn.addEventListener('click', undo); redoBtn.addEventListener('click', redo);
    copyBtn.addEventListener('click', copySelection); pasteBtn.addEventListener('click', pasteSelection);
    $('autoLayoutBtn').addEventListener('click', autoLayoutCircuit);
    deleteBtn.addEventListener('click', () => renderer.deleteSelection());
    $('clearBtn').addEventListener('click', () => {
      beginHistory('Clear workspace'); circuit().clear(); renderer.select(null); updateStats(); commitHistory('Clear workspace'); setStatus('Workspace cleared.');
    });
    $('settleBtn').addEventListener('click', () => {
      try { const steps = circuit().simulate(); setStatus(`Circuit settled in ${steps} propagation event${steps === 1 ? '' : 's'}.`); }
      catch (error) { setStatus(error.message, true); }
      updateStats(); renderQueueInspector(); refreshComponentTestPanel();
    });
    runBtn.addEventListener('click', () => setSimulationMode('run'));
    visualizeBtn.addEventListener('click', () => setSimulationMode('visualize'));
    pauseBtn.addEventListener('click', togglePause);
    stepBtn.addEventListener('click', stepOnce);
    clockStepBtn.addEventListener('click', clockStep);
    computerRunBtn.addEventListener('click', toggleComputerRun);
    computerInstructionBtn.addEventListener('click', computerInstructionStep);
    computerClockBtn.addEventListener('click', () => computerClockStep());
    loadExampleProgramBtn.addEventListener('click', () => loadProgram(computerConsoleContext()?.io ? ioExampleProgram() : exampleProgram()));
    writeProgramBtn.addEventListener('click', openProgramEditor);
    loadWrittenProgramBtn.addEventListener('click', loadWrittenProgram);
    importProgramBtn.addEventListener('click', () => programFile.click());
    exportProgramBtn.addEventListener('click', exportProgram);
    programFile.addEventListener('change', importProgram);
    $('clearTimelineBtn').addEventListener('click', clearStateTimeline);
    visualizeSpeed.addEventListener('change', () => { if (simulation.mode === 'visualize') scheduleVisualizeStep(); });
    $('animateSignals').addEventListener('change', (e) => { renderer.animateSignals = e.target.checked; });

    document.addEventListener('keydown', (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) { event.preventDefault(); redo(); }
      else if (mod && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); }
      else if (mod && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); }
    });

    startGeneratorTimer();
    renderPrimitiveSetControls(); renderLibrary(); renderBreadcrumbs(); renderComponentTestPanel(); hookActiveCircuitEvents(); setSimulationMode('run', { announce: false });

    // Restore the last active project automatically. Older single-slot saves used the id "default".
    let restored = false;
    try {
      const lastProjectId = await storage.getMeta('lastProjectId');
      if (lastProjectId) {
        const saved = await storage.load(lastProjectId);
        if (saved) { applyProject(saved.project, { id: saved.id, savedAt: saved.savedAt }); restored = true; }
      }
      if (!restored) {
        const legacy = await storage.load('default');
        if (legacy) { applyProject(legacy.project, { id: legacy.id, savedAt: legacy.savedAt }); restored = true; }
      }
    } catch (error) { console.error('Could not restore last project', error); }

    if (!restored) {
      currentProjectName = 'Project 1';
      currentProjectId = makeProjectId(currentProjectName);
      projectNameInput.value = currentProjectName;
      buildDemo();
      await saveProject({ quiet: true });
      setStatus('Created Project 1. Changes are autosaved locally.');
    } else {
      await refreshProjectList();
    }

    autosaveTimer = setInterval(autosaveIfChanged, 1500);
    renderer.app.canvas.focus();
    setInterval(() => { updateStats(); refreshComponentTestPanel(); }, 200);
  }

  init().catch((error) => { console.error(error); setStatus(`Startup failed: ${error.message}`, true); });
})();
