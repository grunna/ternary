(function () {
  'use strict';

  const { Circuit, registry, makeCustomDefinition, boundaryPorts, slug, clone, normalizeSequence } = window.TernaryCore;
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

  const UTILITY_PRIMITIVES = ['trit-input', 'sequence-generator', 'probe'];
  const EXPERIMENTAL_PRIMITIVES = ['negate', 'compare', 'select3', 'min', 'max', 'normalize-carry'];
  const PRIMITIVE_SETS = {
    all: { label: 'All candidates', description: 'Expose every current ternary primitive candidate.', types: [...EXPERIMENTAL_PRIMITIVES], metadata: { purpose: 'exploration', logicalCostModel: 'sum primitive node costs', physicalCostModel: 'per-primitive metadata; unknown values remain unmodeled' } },
    minmax: { label: 'MIN / MAX', description: 'Explore symmetric MIN, MAX and negate logic, with normalize/carry for arithmetic experiments.', types: ['negate', 'min', 'max', 'normalize-carry'], metadata: { purpose: 'min/max ternary logic', logicalCostModel: 'sum primitive node costs', physicalCostModel: 'unmodeled until hardware implementation is chosen' } },
    selector: { label: 'Compare / Select', description: 'Explore compare and native three-way routing as the main ternary building blocks.', types: ['negate', 'compare', 'select3', 'normalize-carry'], metadata: { purpose: 'comparison/routing architecture', logicalCostModel: 'sum primitive node costs', physicalCostModel: 'unmodeled until hardware implementation is chosen' } },
    arithmetic: { label: 'Arithmetic core', description: 'Small set focused on balanced-ternary arithmetic experiments.', types: ['negate', 'compare', 'normalize-carry'], metadata: { purpose: 'arithmetic', logicalCostModel: 'sum primitive node costs', physicalCostModel: 'unmodeled until hardware implementation is chosen' } },
  };
  const primitiveExperiment = { activeId: 'all', customTypes: new Set(EXPERIMENTAL_PRIMITIVES) };

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
  const visualizeSpeed = $('visualizeSpeed');
  const queueCount = $('queueCount');
  const queueList = $('queueList');
  const primitiveSetSelect = $('primitiveSetSelect');
  const primitiveSetDescription = $('primitiveSetDescription');
  const primitiveSetChecks = $('primitiveSetChecks');
  const primitiveSetCost = $('primitiveSetCost');

  function circuit() { return current.circuit; }
  function fmt(value) { value = Number(value) || 0; return value > 0 ? '+1' : String(value); }
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
  function commitHistory(label) {
    if (history.restoring || !history.pending) return;
    const after = snapshotString();
    const entry = history.pending; history.pending = null;
    if (entry.before === after) return;
    history.undo.push({ label: label || entry.label, before: entry.before, after });
    if (history.undo.length > 100) history.undo.shift();
    history.redo.length = 0; updateHistoryButtons();
  }
  function restoreSnapshot(serialized) {
    history.restoring = true;
    try { circuit().load(JSON.parse(serialized)); renderer.select(null); updateStats(); }
    finally { history.restoring = false; history.pending = null; }
  }
  function undo() { const e = history.undo.pop(); if (!e) return; restoreSnapshot(e.before); history.redo.push(e); updateHistoryButtons(); setStatus(`Undo: ${e.label}.`); }
  function redo() { const e = history.redo.pop(); if (!e) return; restoreSnapshot(e.after); history.undo.push(e); updateHistoryButtons(); setStatus(`Redo: ${e.label}.`); }

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
        <div class="selection-actions"><button id="inspectorDeleteBtn" type="button">Delete selected blocks</button></div>`;
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

    if (def.boundary) {
      extra += `<label class="editor-field">External port name<input id="boundaryName" type="text" value="${esc(component.state.name || '')}" /></label>
        <div class="selection-actions"><button id="renameBoundaryBtn" type="button">Rename port</button></div>`;
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
    const physicalCost = def.cost?.physical || {};
    extra += `<div class="cost-note"><strong>Primitive metadata</strong><br>Logical: ${Number(logicalCost.nodes) || 0} node unit · ${Number(logicalCost.depth) || 0} depth unit<br>Physical: ${esc(physicalCost.model || 'unmodeled')}${physicalCost.transistorEstimate == null ? ' · transistor estimate TBD' : ` · ~${physicalCost.transistorEstimate} transistors`}</div>`;

    extra += `<details class="layout-editor">
      <summary>Layout</summary>
      <div class="field-grid"><label class="editor-field">X<input id="layoutX" type="number" step="20" value="${Math.round(component.x)}" /></label><label class="editor-field">Y<input id="layoutY" type="number" step="20" value="${Math.round(component.y)}" /></label></div>
      <label class="editor-field">Width<input id="layoutWidth" type="number" min="120" max="320" step="10" value="${width}" /></label>
      <label class="editor-field">Port spacing<input id="layoutSpacing" type="number" min="18" max="60" step="2" value="${portSpacing}" /></label>
      <label class="editor-field">Inputs<select id="layoutInputSide"><option value="left"${inputSide === 'left' ? ' selected' : ''}>Left</option><option value="right"${inputSide === 'right' ? ' selected' : ''}>Right</option></select></label>
      <label class="editor-field">Outputs<select id="layoutOutputSide"><option value="right"${outputSide === 'right' ? ' selected' : ''}>Right</option><option value="left"${outputSide === 'left' ? ' selected' : ''}>Left</option></select></label>
      <div class="selection-actions"><button id="applyLayoutBtn" type="button">Apply layout</button></div>
    </details>`;

    if (def.custom) extra += `<div class="selection-actions"><button id="openComponentBtn" class="primary-action" type="button">Open internals</button></div>`;
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
    if (def.boundary) $('renameBoundaryBtn').addEventListener('click', () => {
      const name = $('boundaryName').value.trim();
      if (!name) return setStatus('Port name cannot be empty.', true);
      beginHistory('Rename component port');
      circuit().setState(component.id, { name });
      commitHistory('Rename component port');
      updateInspector({ ...selection, item: circuit().components.get(component.id) });
      renderComponentTestPanel();
      setStatus(`Port renamed to ${name}. Save/back will update the reusable component interface.`);
    });
  }

  function addLibraryButton(container, type, title, subtitle, custom = false, candidate = false) {
    const button = document.createElement('button');
    button.className = `component-button${custom ? ' custom' : ''}`;
    button.type = 'button';
    button.dataset.type = type;
    button.innerHTML = `<strong>${title}${candidate ? '<em class="candidate-badge">CANDIDATE</em>' : ''}</strong><span>${subtitle}</span>`;
    button.addEventListener('click', () => {
      renderer.addAtViewportCenter(type);
      updateStats();
      setStatus(`Added ${registry.get(type).label}.`);
      renderer.app.canvas.focus();
    });
    container.appendChild(button);
  }

  function componentTestBoundaries() {
    if (current.kind !== 'custom') return { inputs: [], outputs: [] };
    try { return boundaryPorts(circuit().serialize()); }
    catch (_) { return { inputs: [], outputs: [] }; }
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
        const value = Number(component?.state?.value) || 0;
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
        const value = Number(component?.state?.value) || 0;
        row.innerHTML = `<span class="component-test-name">${output.name}</span><span class="component-test-value" data-output-id="${output.componentId}">${fmt(value)}</span>`;
        group.appendChild(row);
      }
      componentTestPanel.appendChild(group);
    }
  }

  function refreshComponentTestPanel() {
    if (current.kind !== 'custom' || componentTestSection.hidden) return;
    const boundaries = componentTestBoundaries();
    let structuralMismatch = false;
    for (const input of boundaries.inputs) {
      const component = circuit().components.get(input.componentId);
      const value = Number(component?.state?.value) || 0;
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
      el.textContent = fmt(Number(component?.state?.value) || 0);
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
      negate: 'x → -x',
      compare: 'A<B / = / >',
      select3: 'native 3-way route',
      min: 'MIN(A, B)',
      max: 'MAX(A, B)',
      'normalize-carry': 'A+B+C → Sum + 3×Carry',
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
    const modeled = defs.filter((def) => def.cost?.physical?.model && def.cost.physical.model !== 'unmodeled').length;
    primitiveSetCost.innerHTML = `<strong>Set metadata</strong><br>${esc(set.metadata?.purpose || 'experiment')} · ${defs.length} candidates · base logical node cost ${nodeCost}<br>Physical models: ${modeled}/${defs.length} modeled`;
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
    }

    customList.innerHTML = '';
    let shown = 0;
    for (const meta of customComponents.values()) {
      if (current.kind === 'custom' && meta.id === current.customId) continue; // prevent direct self recursion
      const def = registry.get(meta.type);
      addLibraryButton(customList, meta.type, meta.label, `${def.inputs.length} in · ${def.outputs.length} out`, true);
      shown++;
    }
    customEmpty.hidden = shown > 0;
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

  function saveCurrentCustomDefinition() {
    if (current.kind !== 'custom') return true;
    const meta = customComponents.get(current.customId);
    if (!meta) return true;
    const data = circuit().serialize();
    try {
      const boundaries = boundaryPorts(data);
      if (!boundaries.inputs.length && !boundaries.outputs.length) throw new Error('A reusable component needs at least one Component Input or Component Output.');
      meta.circuit = clone(data);
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
    const label = window.prompt('Name the reusable component:', 'My Component');
    if (!label?.trim()) return;
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
    setStatus(`Editing reusable component “${meta.label}”. Connect Component Input/Output blocks to define its interface.`);
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

  function projectSnapshot() {
    saveCurrentCustomDefinition();
    return {
      appVersion: 5,
      primitiveExperiment: { activeId: primitiveExperiment.activeId, customTypes: [...primitiveExperiment.customTypes] },
      rootCircuit: rootCircuit.serialize(),
      customComponents: [...customComponents.values()].map(clone),
      view: current.kind === 'root' ? renderer.getViewState() : null,
    };
  }

  async function saveProject() {
    try { await storage.save('default', projectSnapshot()); setStatus('Project and reusable component library saved in IndexedDB.'); }
    catch (error) { setStatus(`Save failed: ${error.message}`, true); }
  }

  function clearCustomRegistry() {
    for (const meta of customComponents.values()) registry.remove(meta.type);
    customComponents.clear();
  }

  async function loadProject() {
    try {
      const saved = await storage.load('default');
      if (!saved) return setStatus('No saved project found.', true);
      navigation.length = 0;
      clearCustomRegistry();
      const project = saved.project;
      for (const meta of project.customComponents || []) { customComponents.set(meta.id, clone(meta)); }
      for (const meta of customComponents.values()) registerCustom(meta);
      const savedExperiment = project.primitiveExperiment || {};
      primitiveExperiment.activeId = savedExperiment.activeId === 'custom' || PRIMITIVE_SETS[savedExperiment.activeId] ? (savedExperiment.activeId || 'all') : 'all';
      primitiveExperiment.customTypes = new Set((savedExperiment.customTypes || EXPERIMENTAL_PRIMITIVES).filter((type) => EXPERIMENTAL_PRIMITIVES.includes(type)));
      renderPrimitiveSetControls(); renderLibrary();
      rootCircuit = new Circuit(registry);
      rootCircuit.load(project.rootCircuit || project.circuit);
      switchContext({ kind: 'root', label: 'Project', circuit: rootCircuit, customId: null }, project.view);
      setStatus(`Loaded project saved ${new Date(saved.savedAt).toLocaleString()}.`);
    } catch (error) { setStatus(`Load failed: ${error.message}`, true); }
  }

  function buildDemo() {
    if (current.kind !== 'root') return setStatus('Return to Project before loading the demo.', true);
    rootCircuit.clear();
    const a = rootCircuit.addComponent('trit-input', -320, -90, { value: 1 });
    const b = rootCircuit.addComponent('trit-input', -320, 80, { value: 0 });
    const neg = rootCircuit.addComponent('negate', -80, -90);
    const cmp = rootCircuit.addComponent('compare', 150, 0);
    const out = rootCircuit.addComponent('probe', 400, 0);
    rootCircuit.connect(a.id, 'out', neg.id, 'in'); rootCircuit.connect(neg.id, 'out', cmp.id, 'a');
    rootCircuit.connect(b.id, 'out', cmp.id, 'b'); rootCircuit.connect(cmp.id, 'out', out.id, 'in');
    renderer.select(null); updateStats(); resetHistory();
    setStatus('Demo loaded. Click an output, then press an input; drag/drop also works.');
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
      setStatus(`CLOCK STEP: advanced ${count} sequence generator${count === 1 ? '' : 's'}.`);
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
    updateStats();
    renderQueueInspector();
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

    $('newComponentBtn').addEventListener('click', createCustomComponent);
    primitiveSetSelect.addEventListener('change', () => {
      primitiveExperiment.activeId = primitiveSetSelect.value;
      if (primitiveExperiment.activeId !== 'custom') primitiveExperiment.customTypes = new Set(PRIMITIVE_SETS[primitiveExperiment.activeId]?.types || EXPERIMENTAL_PRIMITIVES);
      renderPrimitiveSetControls(); renderLibrary();
      setStatus(`Primitive set: ${primitiveSetSelect.options[primitiveSetSelect.selectedIndex]?.textContent || primitiveExperiment.activeId}. Existing circuits remain unchanged.`);
    });
    backBtn.addEventListener('click', goBack);
    $('saveBtn').addEventListener('click', saveProject);
    $('loadBtn').addEventListener('click', loadProject);
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
    renderPrimitiveSetControls(); renderLibrary(); renderBreadcrumbs(); renderComponentTestPanel(); hookActiveCircuitEvents(); setSimulationMode('run', { announce: false }); buildDemo(); renderer.app.canvas.focus();
    setInterval(() => { updateStats(); refreshComponentTestPanel(); }, 200);
  }

  init().catch((error) => { console.error(error); setStatus(`Startup failed: ${error.message}`, true); });
})();
