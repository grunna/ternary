(function () {
  'use strict';

  const { Circuit, registry, makeCustomDefinition, boundaryPorts, slug, clone, normalizeSequence, trit } = window.TernaryCore;
  const { ProjectStorage } = window.TernaryStorage;
  const { CircuitRenderer } = window.TernaryRenderer;

  const storage = new ProjectStorage();
  const customComponents = new Map();
  const navigation = [];
  let rootCircuit = new Circuit(registry);
  let current = { kind: 'root', label: 'Project', circuit: rootCircuit, customId: null };
  let renderer;
  let clipboard = null;

  const simulation = { mode: 'run', previousMode: 'run', timer: null, generatorTimer: null, generatorLastTick: performance.now(), activeUnsubscribers: [] };

  const UTILITY_PRIMITIVES = ['trit-input', 'sequence-generator', 'latch3', 'register3', 'register-bank3', 'seven-segment-display', 'probe'];
  const EXPERIMENTAL_PRIMITIVES = ['negate', 'compare', 'select3', 'route3', 'adjust3', 'control3', 'threshold3', 'restore3', 'pass3', 'storage-node3', 'clock-phase3', 'min', 'max', 'normalize-carry'];
  const PRIMITIVE_SETS = {
    all: { label: 'All candidates', description: 'Expose every current ternary primitive candidate.', types: [...EXPERIMENTAL_PRIMITIVES], metadata: { purpose: 'exploration', logicalCostModel: 'sum primitive node costs' } },
    minmax: { label: 'MIN / MAX', description: 'Explore symmetric MIN, MAX and negate logic, with normalize/carry for arithmetic experiments.', types: ['negate', 'min', 'max', 'normalize-carry'], metadata: { purpose: 'min/max ternary logic', logicalCostModel: 'sum primitive node costs' } },
    selector: { label: 'Compare / Select', description: 'Explore compare and native three-way routing as the main ternary building blocks.', types: ['negate', 'compare', 'select3', 'route3', 'adjust3', 'control3', 'threshold3', 'restore3', 'pass3', 'storage-node3', 'clock-phase3', 'normalize-carry'], metadata: { purpose: 'comparison/routing architecture', logicalCostModel: 'sum primitive node costs' } },
    arithmetic: { label: 'Arithmetic core', description: 'Small set focused on balanced-ternary arithmetic experiments.', types: ['negate', 'compare', 'adjust3', 'normalize-carry'], metadata: { purpose: 'arithmetic', logicalCostModel: 'sum primitive node costs' } },
  };
  const primitiveExperiment = { activeId: 'all', customTypes: new Set(EXPERIMENTAL_PRIMITIVES) };
  const PROJECT_FORMAT_VERSION = 6;
  let currentProjectId = null;
  let currentProjectName = 'Project 1';
  let testSuites = [];
  let componentTestDraftExpected = {};
  let componentTestDraftComponentId = null;
  let lastSavedSnapshot = '';
  let autosaveTimer = null;
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
  const importFile = $('importFile');

  function circuit() { return current.circuit; }
  function fmt(value) { value = trit(value); return value === null ? '?' : value === 'Z' ? 'Z' : value > 0 ? '+1' : String(value); }
  function esc(value) { return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function setStatus(message, error = false) { statusEl.textContent = message; statusEl.classList.toggle('error', Boolean(error)); }

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

    if (component.type === 'trit-input') {
      const currentValue = trit(component.state.value);
      extra += `<div class="cost-note trit-value-editor"><strong>Input value</strong><div class="selection-actions trit-choice" role="group" aria-label="Set trit input value"><button type="button" data-trit-value="-1"${currentValue === -1 ? ' class="active"' : ''}>−1</button><button type="button" data-trit-value="0"${currentValue === 0 ? ' class="active"' : ''}>0</button><button type="button" data-trit-value="1"${currentValue === 1 ? ' class="active"' : ''}>+1</button></div></div>`;
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

    const logicalCost = def.cost?.logical || {};
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
        extra += `<div class="cost-note"><strong>Experiment details</strong><br>${esc(experiment.role || 'candidate')} · ${experiment.nodeCount} primitive nodes · critical depth ${experiment.depth}${metricLine}<br>Primitive set: ${esc(primitives)}<br>${esc(experiment.rationale)}<br>${experiment.setName ? `<br>Experiment set: ${esc(experiment.setName)}` : ''}<br>Validation: ${esc(experiment.validation || 'not recorded')}</div>`;
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

    if (component.type === 'trit-input') {
      inspectorEl.querySelectorAll('[data-trit-value]').forEach((button) => button.addEventListener('click', () => {
        const value = Number(button.dataset.tritValue);
        if (trit(component.state.value) === value) return;
        beginHistory('Set trit input');
        circuit().setState(component.id, { value });
        commitHistory('Set trit input');
        renderer.rebuild();
        renderer.selectComponent(component.id);
        setStatus(`Trit input set to ${fmt(value)}.`);
      }));
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
    controls.append(name, save, runSaved, exhaustive);
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

  function renderComponentTestPanel() {
    componentTestSection.hidden = current.kind !== 'custom';
    componentTestPanel.innerHTML = '';
    if (current.kind !== 'custom') return;
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
      const group = document.createElement('div');
      group.className = 'component-test-group';
      group.innerHTML = '<h3>Inputs</h3>';
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
        group.appendChild(row);
      }
      componentTestPanel.appendChild(group);
    }

    if (boundaries.outputs.length) {
      const group = document.createElement('div');
      group.className = 'component-test-group';
      group.innerHTML = '<h3>Outputs</h3>';
      for (const output of boundaries.outputs) {
        const row = document.createElement('div');
        row.className = 'component-test-row';
        const component = circuit().components.get(output.componentId);
        const value = trit(component?.state?.value);
        row.innerHTML = `<span class="component-test-name">${output.name}</span><span class="component-test-value" data-output-id="${output.componentId}">${fmt(value)}</span>`;
        group.appendChild(row);
      }
      componentTestPanel.appendChild(group);

      const expected = document.createElement('div');
      expected.className = 'component-test-group component-test-expected';
      expected.innerHTML = '<h3>Expected outputs for next saved case</h3>';
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
        expected.appendChild(row);
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
      'trit-input': '-1 / 0 / +1',
      'sequence-generator': 'clock / ternary / custom sequence',
      latch3: 'transparent ternary storage while enable = +1',
      register3: 'D flip-flop: LOAD on clock 0 → +1',
      'register-bank3': 'three trit registers with ternary read / idle / write',
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
      'storage-node3': 'ideal gated ternary storage node',
      'seven-segment-display': '8 inputs: A–G + sign; 0 = off, +1 = on',
      probe: 'read a trit',
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
    const types = [...UTILITY_PRIMITIVES, ...activePrimitiveTypes()];
    for (const type of types) {
      const def = registry.get(type);
      addLibraryButton(primitiveList, type, def.label, primitiveSubtitle(type), false, Boolean(def.candidate));
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
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-custom-component';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove reusable component ${meta.label}`);
    remove.addEventListener('click', () => removeCustomComponent(meta.id));
    actions.append(open, remove);
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
      if (!boundaries.inputs.length && !boundaries.outputs.length) throw new Error('A reusable component needs at least one Component Input or Component Output.');
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
    resetHistory(); updateStats(); renderLibrary(); renderBreadcrumbs(); renderComponentTestPanel(); hookActiveCircuitEvents();
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
  }

  async function saveProject({ quiet = false } = {}) {
    try {
      if (!currentProjectId) currentProjectId = makeProjectId(currentProjectName);
      currentProjectName = sanitizeProjectName(projectNameInput.value || currentProjectName);
      projectNameInput.value = currentProjectName;
      const snapshot = projectSnapshot();
      snapshot.projectId = currentProjectId;
      snapshot.projectName = currentProjectName;
      const serialized = JSON.stringify(snapshot);
      await storage.save(currentProjectId, snapshot);
      await storage.setMeta('lastProjectId', currentProjectId);
      lastSavedSnapshot = serialized;
      await refreshProjectList();
      if (!quiet) setStatus(`Saved “${currentProjectName}” to IndexedDB.`);
    } catch (error) { setStatus(`Save failed: ${error.message}`, true); }
  }

  function clearCustomRegistry() {
    for (const meta of customComponents.values()) registry.remove(meta.type);
    customComponents.clear();
  }

  function applyProject(project, { id = null, savedAt = null } = {}) {
    project = migrateProject(project);
    const incomingComponents = new Map((project.customComponents || []).map((meta) => [meta.id, clone(meta)]));
    const cycle = customRecursionPath(null, null, incomingComponents);
    if (cycle) throw new Error(`Custom component recursion is not allowed: ${recursionMessage(cycle, incomingComponents)}.`);
    navigation.length = 0;
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
    setStatus(savedAt ? `Loaded “${currentProjectName}” saved ${new Date(savedAt).toLocaleString()}.` : `Loaded “${currentProjectName}”.`);
  }

  async function loadProject(id = null) {
    try {
      const targetId = id || projectSelect.value || currentProjectId || 'default';
      const saved = await storage.load(targetId);
      if (!saved) return setStatus('No saved project found.', true);
      applyProject(saved.project, { id: saved.id, savedAt: saved.savedAt });
    } catch (error) { setStatus(`Load failed: ${error.message}`, true); }
  }

  async function createNewProject() {
    await saveProject({ quiet: true });
    navigation.length = 0;
    clearCustomRegistry();
    rootCircuit = new Circuit(registry);
    currentProjectName = 'New project';
    currentProjectId = makeProjectId(currentProjectName);
    projectNameInput.value = currentProjectName;
    testSuites = [];
    primitiveExperiment.activeId = 'all';
    primitiveExperiment.customTypes = new Set(EXPERIMENTAL_PRIMITIVES);
    renderPrimitiveSetControls(); renderLibrary();
    switchContext({ kind: 'root', label: 'Project', circuit: rootCircuit, customId: null });
    resetHistory();
    lastSavedSnapshot = '';
    await saveProject({ quiet: true });
    setStatus('Created a new project. Rename it in the project-name field; changes autosave.');
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
      imported.projectName = sanitizeProjectName(imported.projectName || file.name.replace(/\.ternary\.json$|\.json$/i, '') || 'Imported project');
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
      currentProjectName = sanitizeProjectName(projectNameInput.value || currentProjectName);
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
    if ($('demoSelect').value === 'device-cells') return buildDeviceCellsDemo();
    if ($('demoSelect').value === 'seven-segment') return buildSevenSegmentDemo();
    if ($('demoSelect').value === 'structural-storage') return buildStructuralStorageDemo();
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
    rootCircuit.connect(signal.id, 'out', restorer.id, 'in'); rootCircuit.connect(restorer.id, 'out', detector.id, 'in');
    rootCircuit.connect(restorer.id, 'out', pass.id, 'in'); rootCircuit.connect(switchGate.id, 'out', pass.id, 'gate'); rootCircuit.connect(pass.id, 'out', passProbe.id, 'in');
    rootCircuit.connect(restorer.id, 'out', storage.id, 'drive'); rootCircuit.connect(write.id, 'out', storage.id, 'write'); rootCircuit.connect(reset.id, 'out', storage.id, 'reset'); rootCircuit.connect(storage.id, 'q', nodeProbe.id, 'in');
    rootCircuit.connect(detector.id, 'neg', negProbe.id, 'in'); rootCircuit.connect(detector.id, 'zero', zeroProbe.id, 'in'); rootCircuit.connect(detector.id, 'pos', posProbe.id, 'in');
    renderer.select(null); renderLibrary(); updateStats(); resetHistory();
    setStatus('Device cell demo loaded. Inspect ideal level detection/restoration, pass switching and gated storage before choosing a transistor technology.');
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

  function buildStructuralStorageDemo() {
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
    const directLatch = add('Latch — functional reference', {
      role: 'reference', nodeCount: 1, depth: 1, primitiveCounts: { latch3: 1 }, metrics: metric(1, 1, 4, 2),
      rationale: 'The existing latch is the compact behavioral reference: D is visible while enable is +1 and retained otherwise.', validation: 'Manual contract: transparent at enable +1; holds at 0/-1; reset restores 0.',
    }, ['d', 'enable', 'reset'], ['q'], (inner, inputs, outputs) => {
      const latch = inner.addComponent('latch3', 0, 0);
      ['d', 'enable', 'reset'].forEach((port, index) => inner.connect(inputs[index].id, 'out', latch.id, port));
      inner.connect(latch.id, 'q', outputs[0].id, 'in');
    });
    const structuralLatch = add('Latch — structural pass cell', {
      role: 'structural candidate', nodeCount: 4, depth: 4, primitiveCounts: { restore3: 2, pass3: 1, 'storage-node3': 1 }, metrics: metric(4, 4, 8, 5),
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
      role: 'structural candidate', nodeCount: 10, depth: 8, primitiveCounts: { 'clock-phase3': 1, min: 1, restore3: 4, pass3: 2, 'storage-node3': 2 }, metrics: metric(10, 8, 26, 12),
      rationale: 'A master latch is open at clock 0 (and only when load is +1); a slave latch is open at clock +1. The two transparent phases form an edge-triggered register.', validation: 'Manual contract: data changes during high clock do not reach Q; a 0 → +1 edge transfers the master value.',
    }, ['d', 'load', 'clock', 'reset'], ['q'], (inner, inputs, outputs) => {
      const phase = inner.addComponent('clock-phase3', -160, 100, { label: 'CLK low phase' });
      const masterEnable = inner.addComponent('min', -10, 50, { label: 'LOAD ∧ CLK-low' });
      const master = inner.addComponent(structuralLatch.type, 150, -65, { label: 'Master latch' });
      const slave = inner.addComponent(structuralLatch.type, 150, 100, { label: 'Slave latch' });
      inner.connect(inputs[2].id, 'out', phase.id, 'clock');
      inner.connect(inputs[1].id, 'out', masterEnable.id, 'a'); inner.connect(phase.id, 'out', masterEnable.id, 'b');
      inner.connect(inputs[0].id, 'out', master.id, 'd'); inner.connect(masterEnable.id, 'out', master.id, 'enable'); inner.connect(inputs[3].id, 'out', master.id, 'reset');
      inner.connect(master.id, 'q', slave.id, 'd'); inner.connect(inputs[2].id, 'out', slave.id, 'enable'); inner.connect(inputs[3].id, 'out', slave.id, 'reset');
      inner.connect(slave.id, 'q', outputs[0].id, 'in');
    });
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
    on('state-committed', ({ changes }) => changes.forEach((change) => addStateTimeline('commit', change.componentId, `value ${fmtTimelineValue(change.before.value)} → ${fmtTimelineValue(change.after.value)}`)));
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

    $('newProjectBtn').addEventListener('click', createNewProject);
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
    projectSelect.addEventListener('change', () => loadProject(projectSelect.value));
    projectNameInput.addEventListener('change', () => { currentProjectName = sanitizeProjectName(projectNameInput.value); projectNameInput.value = currentProjectName; autosaveIfChanged(); });
    $('exportBtn').addEventListener('click', exportProject);
    $('importBtn').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => { const file = importFile.files?.[0]; if (file) importProjectFile(file); });
    $('demoBtn').addEventListener('click', buildDemo);
    undoBtn.addEventListener('click', undo); redoBtn.addEventListener('click', redo);
    copyBtn.addEventListener('click', copySelection); pasteBtn.addEventListener('click', pasteSelection);
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
