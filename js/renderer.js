(function (global) {
  'use strict';

  const { trit } = global.TernaryCore;

  const COLORS = {
    background: 0x0f1318,
    gridMinor: 0x1a222b,
    gridMajor: 0x26313d,
    node: 0x202832,
    nodeBorder: 0x3a4755,
    nodeSelected: 0x5ea8ff,
    wireSelected: 0xffd166,
    text: 0xecf3f8,
    muted: 0x92a1ad,
    neg: 0xf07178,
    zero: 0x8a97a3,
    pos: 0x52c7a5,
    port: 0xcbd5de,
    unknown: 0x8e6aaf,
  };

  function signalColor(value) {
    value = trit(value);
    return value === null ? COLORS.unknown : value < 0 ? COLORS.neg : value > 0 ? COLORS.pos : COLORS.zero;
  }

  function signalText(value) {
    value = trit(value);
    return value === null ? '?' : value > 0 ? '+1' : String(value);
  }

  class CircuitRenderer {
    constructor({ element, circuit, registry, onSelectionChanged, onStatus, onBeforeChange, onAfterChange, onOpenComponent }) {
      this.element = element;
      this.circuit = circuit;
      this.registry = registry;
      this.onSelectionChanged = onSelectionChanged || (() => {});
      this.onStatus = onStatus || (() => {});
      this.onBeforeChange = onBeforeChange || (() => {});
      this.onAfterChange = onAfterChange || (() => {});
      this.onOpenComponent = onOpenComponent || (() => {});

      this.app = null;
      this.world = null;
      this.gridLayer = null;
      this.wireLayer = null;
      this.nodeLayer = null;
      this.animationLayer = null;
      this.overlayLayer = null;
      this.nodeViews = new Map();
      this.wireViews = new Map();
      this.selection = null; // { kind: 'component'|'components'|'wire', id/ids }
      this.selectedId = null; // Backwards-compatible: selected component id only.
      this.selectedComponentIds = new Set();
      this.boxSelection = null;
      this.selectionBoxGraphic = null;
      this.pendingWire = null; // { componentId, port, originalWireId? }
      this.previewWire = null;
      this.dragState = null;
      this.panState = null;
      this.componentDragChanged = false;
      this.pulses = [];
      this.animateSignals = true;
      this.resizeObserver = null;
      this.unsubscribe = [];
    }

    async init() {
      this.app = new PIXI.Application();
      await this.app.init({
        background: COLORS.background,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        width: Math.max(1, this.element.clientWidth),
        height: Math.max(1, this.element.clientHeight),
      });
      this.app.canvas.tabIndex = 0;
      this.element.appendChild(this.app.canvas);

      this.world = new PIXI.Container();
      this.gridLayer = new PIXI.Container();
      this.wireLayer = new PIXI.Container();
      this.nodeLayer = new PIXI.Container();
      this.animationLayer = new PIXI.Container();
      this.overlayLayer = new PIXI.Container();
      this.world.addChild(this.gridLayer, this.wireLayer, this.nodeLayer, this.animationLayer, this.overlayLayer);
      this.app.stage.addChild(this.world);

      this.drawGrid();
      this.setupStageEvents();
      this.setupCircuitEvents();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.element);
      this.resize();

      this.app.ticker.add((ticker) => this.updatePulses(ticker.deltaMS));
      this.rebuild();
      return this;
    }

    destroy() {
      this.unsubscribe.forEach((fn) => fn());
      this.resizeObserver?.disconnect();
      this.app?.destroy(true);
    }

    resize() {
      if (!this.app) return;
      const width = Math.max(1, this.element.clientWidth);
      const height = Math.max(1, this.element.clientHeight);
      this.app.renderer.resize(width, height);
      this.app.stage.hitArea = new PIXI.Rectangle(0, 0, width, height);
    }

    drawGrid() {
      this.gridLayer.removeChildren();
      const g = new PIXI.Graphics();
      const size = 5000;
      const minor = 40;
      const majorEvery = 5;
      for (let x = -size; x <= size; x += minor) {
        const major = Math.round(x / minor) % majorEvery === 0;
        g.moveTo(x, -size).lineTo(x, size).stroke({ color: major ? COLORS.gridMajor : COLORS.gridMinor, width: 1 });
      }
      for (let y = -size; y <= size; y += minor) {
        const major = Math.round(y / minor) % majorEvery === 0;
        g.moveTo(-size, y).lineTo(size, y).stroke({ color: major ? COLORS.gridMajor : COLORS.gridMinor, width: 1 });
      }
      this.gridLayer.addChild(g);
    }

    setupStageEvents() {
      const stage = this.app.stage;
      stage.eventMode = 'static';
      stage.hitArea = new PIXI.Rectangle(0, 0, this.app.screen.width, this.app.screen.height);

      stage.on('pointerdown', (e) => {
        this.app.canvas.focus();
        if (e.target !== stage) return;
        if (this.pendingWire) {
          this.cancelPendingWire();
          return;
        }

        if (e.shiftKey) {
          const p = this.world.toLocal(e.global);
          this.boxSelection = { startX: p.x, startY: p.y, endX: p.x, endY: p.y };
          if (!this.selectionBoxGraphic) {
            this.selectionBoxGraphic = new PIXI.Graphics();
            this.overlayLayer.addChild(this.selectionBoxGraphic);
          }
          this.drawSelectionBox();
          return;
        }

        this.select(null);
        this.panState = {
          pointerId: e.pointerId,
          startX: e.global.x,
          startY: e.global.y,
          worldX: this.world.x,
          worldY: this.world.y,
        };
      });

      stage.on('pointermove', (e) => {
        if (this.dragState) {
          const p = this.world.toLocal(e.global);
          const x = this.snap(p.x - this.dragState.offsetX);
          const y = this.snap(p.y - this.dragState.offsetY);
          const dx = x - this.dragState.anchorStartX;
          const dy = y - this.dragState.anchorStartY;
          if (dx !== this.dragState.lastDx || dy !== this.dragState.lastDy) {
            this.componentDragChanged = true;
            this.dragState.lastDx = dx;
            this.dragState.lastDy = dy;
            for (const [id, pos] of this.dragState.positions.entries()) {
              this.circuit.moveComponent(id, this.snap(pos.x + dx), this.snap(pos.y + dy));
            }
          }
          return;
        }
        if (this.boxSelection) {
          const p = this.world.toLocal(e.global);
          this.boxSelection.endX = p.x;
          this.boxSelection.endY = p.y;
          this.drawSelectionBox();
          return;
        }
        if (this.panState) {
          this.world.x = this.panState.worldX + e.global.x - this.panState.startX;
          this.world.y = this.panState.worldY + e.global.y - this.panState.startY;
          return;
        }
        if (this.pendingWire) this.drawPreviewWire(e.global);
      });

      const endPointer = (e) => {
        if (this.pendingWire && e?.global) {
          const target = this.findInputAtGlobal(e.global);
          if (target) {
            const origin = this.pendingWire.originInput;
            const isOrigin = origin && origin.componentId === target.componentId && origin.port === target.port;
            if (!isOrigin) this.finishWire(target.componentId, target.port);
          }
        }
        if (this.boxSelection) this.finishBoxSelection();
        if (this.dragState && this.componentDragChanged) this.onAfterChange('Move components');
        this.dragState = null;
        this.componentDragChanged = false;
        this.panState = null;
      };
      stage.on('pointerup', endPointer);
      stage.on('pointerupoutside', endPointer);

      this.app.canvas.addEventListener('pointerdown', (event) => {
        if (!this.pendingWire) return;
        const rect = this.app.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const global = new PIXI.Point(
          (event.clientX - rect.left) * (this.app.screen.width / rect.width),
          (event.clientY - rect.top) * (this.app.screen.height / rect.height),
        );
        const target = this.findInputAtGlobal(global);
        if (!target) return;
        const origin = this.pendingWire.originInput;
        const isOrigin = origin && origin.componentId === target.componentId && origin.port === target.port;
        if (!isOrigin) this.finishWire(target.componentId, target.port);
      });

      this.app.canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        const rect = this.app.canvas.getBoundingClientRect();
        const mouse = new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top);
        const before = this.world.toLocal(mouse);
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        const nextScale = Math.max(0.25, Math.min(2.5, this.world.scale.x * factor));
        this.world.scale.set(nextScale);
        const afterGlobal = this.world.toGlobal(before);
        this.world.x += mouse.x - afterGlobal.x;
        this.world.y += mouse.y - afterGlobal.y;
      }, { passive: false });

      this.app.canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (this.selection) {
            event.preventDefault();
            this.deleteSelection();
          }
        }
        if (event.key === 'Escape') {
          this.cancelPendingWire();
          this.boxSelection = null;
          this.selectionBoxGraphic?.clear();
        }
      });
    }

    drawSelectionBox() {
      if (!this.boxSelection || !this.selectionBoxGraphic) return;
      const x = Math.min(this.boxSelection.startX, this.boxSelection.endX);
      const y = Math.min(this.boxSelection.startY, this.boxSelection.endY);
      const w = Math.abs(this.boxSelection.endX - this.boxSelection.startX);
      const h = Math.abs(this.boxSelection.endY - this.boxSelection.startY);
      this.selectionBoxGraphic.clear()
        .rect(x, y, w, h)
        .fill({ color: COLORS.nodeSelected, alpha: 0.08 })
        .stroke({ color: COLORS.nodeSelected, width: 1.5, alpha: 0.9 });
    }

    finishBoxSelection() {
      if (!this.boxSelection) return;
      const x1 = Math.min(this.boxSelection.startX, this.boxSelection.endX);
      const y1 = Math.min(this.boxSelection.startY, this.boxSelection.endY);
      const x2 = Math.max(this.boxSelection.startX, this.boxSelection.endX);
      const y2 = Math.max(this.boxSelection.startY, this.boxSelection.endY);
      const ids = [];
      for (const [id, view] of this.nodeViews.entries()) {
        const left = view.container.x;
        const top = view.container.y;
        const right = left + view.width;
        const bottom = top + view.height;
        if (right >= x1 && left <= x2 && bottom >= y1 && top <= y2) ids.push(id);
      }
      this.boxSelection = null;
      this.selectionBoxGraphic?.clear();
      this.setSelectedComponents(ids);
      this.onStatus(ids.length ? `${ids.length} component${ids.length === 1 ? '' : 's'} selected.` : 'Nothing selected.');
    }

    setupCircuitEvents() {
      const on = (type, fn) => this.unsubscribe.push(this.circuit.events.on(type, fn));
      on('component-added', (component) => this.addComponentView(component));
      on('component-removed', (component) => {
        if (this.selectedComponentIds.has(component.id)) {
          this.selectedComponentIds.delete(component.id);
          this.syncComponentSelection();
        }
        this.removeComponentView(component.id);
      });
      on('component-moved', (component) => {
        const view = this.nodeViews.get(component.id);
        if (view) view.container.position.set(component.x, component.y);
        this.redrawConnectedWires(component.id);
      });
      on('component-state', (component) => this.refreshComponentView(component.id));
      on('component-evaluated', (component) => this.refreshComponentView(component.id));
      on('wire-added', () => this.rebuildWires());
      on('wire-updated', (wire) => this.refreshWire(wire.id));
      on('wire-removed', (wire) => {
        if (this.selection?.kind === 'wire' && this.selection.id === wire.id) this.select(null);
        this.rebuildWires();
      });
      on('wire-signal', ({ wire, value }) => {
        this.refreshWire(wire.id);
        if (this.animateSignals) this.spawnPulse(wire.id, value);
      });
      on('loaded', () => this.rebuild());
      on('cleared', () => {
        this.select(null);
        this.rebuild();
      });
    }

    rebuild() {
      this.nodeLayer?.removeChildren();
      this.wireLayer?.removeChildren();
      this.animationLayer?.removeChildren();
      this.nodeViews.clear();
      this.wireViews.clear();
      this.pulses = [];
      for (const component of this.circuit.components.values()) this.addComponentView(component);
      this.rebuildWires();
      if (this.selection) {
        const exists = this.selection.kind === 'wire'
          ? this.circuit.wires.has(this.selection.id)
          : [...this.selectedComponentIds].every((id) => this.circuit.components.has(id));
        if (!exists) this.select(null);
      }
    }

    addComponentView(component) {
      if (!this.nodeLayer || this.nodeViews.has(component.id)) return;
      const definition = this.registry.get(component.type);
      const layout = component.state.layout || {};
      const defaultWidth = component.type === 'select3' ? 170 : 150;
      const width = Math.max(120, Math.min(320, Number(layout.width) || defaultWidth));
      const portSpacing = Math.max(18, Math.min(60, Number(layout.portSpacing) || 24));
      const inputSide = layout.inputSide === 'right' ? 'right' : 'left';
      const outputSide = layout.outputSide === 'left' ? 'left' : 'right';
      const rows = Math.max(definition.inputs.length, definition.outputs.length, 1);
      const height = Math.max(78, 48 + rows * portSpacing);
      const container = new PIXI.Container();
      container.position.set(component.x, component.y);
      container.eventMode = 'static';
      container.cursor = 'grab';

      const body = new PIXI.Graphics();
      container.addChild(body);

      const title = new PIXI.Text({
        text: component.state.label || definition.label,
        style: { fill: COLORS.text, fontSize: 14, fontWeight: '600' },
      });
      title.position.set(12, 10);
      container.addChild(title);

      const valueText = new PIXI.Text({
        text: '',
        style: { fill: COLORS.muted, fontSize: 12, fontFamily: 'monospace' },
      });
      valueText.position.set(12, 32);
      container.addChild(valueText);

      const ports = new Map();
      const makePort = (kind, name, index, total) => {
        const y = 55 + index * portSpacing + (rows - total) * (portSpacing / 2);
        const side = kind === 'input' ? inputSide : outputSide;
        const x = side === 'left' ? 0 : width;
        const port = new PIXI.Container();
        port.position.set(x, y);
        port.eventMode = 'static';
        port.cursor = 'crosshair';
        port.hitArea = new PIXI.Circle(0, 0, 15);

        const circle = new PIXI.Graphics().circle(0, 0, 7).fill(COLORS.port).stroke({ color: 0x10151a, width: 2 });
        circle.eventMode = 'none';
        port.addChild(circle);
        const label = new PIXI.Text({
          text: name,
          style: { fill: COLORS.muted, fontSize: 10 },
        });
        label.eventMode = 'none';
        if (side === 'left') {
          label.position.set(10, -7);
        } else {
          label.anchor.set(1, 0);
          label.position.set(-10, -7);
        }
        port.addChild(label);

        if (kind === 'output') {
          port.on('pointerdown', (e) => {
            e.stopPropagation();
            this.app.canvas.focus();
            this.startWire(component.id, name);
            this.drawPreviewWire(e.global);
          });
        } else {
          // Click-to-click must complete on pointerdown. Waiting for pointertap/up
          // is unreliable when Pixi's pointer capture belongs to the output port.
          // Drag-to-connect still completes geometrically in the stage pointerup.
          port.on('pointerdown', (e) => {
            e.stopPropagation();
            this.app.canvas.focus();
            if (this.pendingWire) {
              const origin = this.pendingWire.originInput;
              const isOrigin = origin && origin.componentId === component.id && origin.port === name;
              if (!isOrigin) this.finishWire(component.id, name);
              return;
            }

            const existing = this.findIncomingWire(component.id, name);
            if (existing) {
              this.startWire(existing.from.componentId, existing.from.port, existing.id, { componentId: component.id, port: name });
              this.drawPreviewWire(e.global);
              this.onStatus(`Rewiring ${existing.id} … choose a new input.`);
            }
          });
        }

        port._circle = circle;
        container.addChild(port);
        ports.set(`${kind}:${name}`, port);
      };
      definition.inputs.forEach((name, i) => makePort('input', name, i, definition.inputs.length));
      definition.outputs.forEach((name, i) => makePort('output', name, i, definition.outputs.length));

      let valueButton = null;
      if (component.type === 'trit-input' || component.type === 'component-input') {
        valueButton = new PIXI.Container();
        valueButton.position.set(width - 43, 14);
        valueButton.eventMode = 'static';
        valueButton.cursor = 'pointer';
        valueButton.hitArea = new PIXI.Rectangle(0, 0, 30, 28);
        const bg = new PIXI.Graphics();
        const text = new PIXI.Text({ text: '0', style: { fill: COLORS.text, fontSize: 16, fontWeight: '700' } });
        text.anchor.set(0.5);
        text.position.set(15, 14);
        valueButton.addChild(bg, text);
        valueButton.on('pointerdown', (e) => {
          e.stopPropagation();
          this.app.canvas.focus();
          this.onBeforeChange(component.type === 'component-input' ? 'Change component test input' : 'Change trit');
          if (component.type === 'component-input') {
            const current = trit(component.state.value);
            const next = current < 0 ? 0 : current === 0 ? 1 : -1;
            this.circuit.setState(component.id, { value: next });
          } else {
            this.circuit.cycleTritInput(component.id);
          }
          this.onAfterChange(component.type === 'component-input' ? 'Change component test input' : 'Change trit');
        });
        container.addChild(valueButton);
        valueButton._bg = bg;
        valueButton._text = text;
      }

      container.on('pointerdown', (e) => {
        e.stopPropagation();
        this.app.canvas.focus();
        if (e.shiftKey) {
          this.toggleComponentSelection(component.id);
          return;
        }
        if (!this.selectedComponentIds.has(component.id)) this.selectComponent(component.id);
        this.onBeforeChange('Move components');
        this.componentDragChanged = false;
        const p = this.world.toLocal(e.global);
        const positions = new Map();
        for (const id of this.selectedComponentIds) {
          const item = this.circuit.components.get(id);
          if (item) positions.set(id, { x: item.x, y: item.y });
        }
        if (!positions.size) positions.set(component.id, { x: component.x, y: component.y });
        this.dragState = {
          id: component.id,
          pointerId: e.pointerId,
          offsetX: p.x - container.x,
          offsetY: p.y - container.y,
          anchorStartX: container.x,
          anchorStartY: container.y,
          lastDx: 0,
          lastDy: 0,
          positions,
        };
        container.cursor = 'grabbing';
      });
      container.on('pointerup', () => { container.cursor = 'grab'; });
      container.on('pointerupoutside', () => { container.cursor = 'grab'; });

      this.nodeLayer.addChild(container);
      this.nodeViews.set(component.id, { container, body, title, valueText, valueButton, ports, width, height });
      this.drawNode(component.id);
      this.refreshComponentView(component.id);
    }

    removeComponentView(id) {
      const view = this.nodeViews.get(id);
      if (view) view.container.destroy({ children: true });
      this.nodeViews.delete(id);
      this.rebuildWires();
    }

    drawNode(id) {
      const view = this.nodeViews.get(id);
      if (!view) return;
      const selected = this.selectedComponentIds.has(id);
      view.body.clear()
        .roundRect(0, 0, view.width, view.height, 10)
        .fill(COLORS.node)
        .stroke({ color: selected ? COLORS.nodeSelected : COLORS.nodeBorder, width: selected ? 2.5 : 1.5 });
    }

    refreshComponentView(id) {
      const component = this.circuit.components.get(id);
      const view = this.nodeViews.get(id);
      if (!component || !view) return;
      view.title.text = component.state.label || this.registry.get(component.type).label;

      if (component.type === 'trit-input') {
        const value = trit(component.state.value);
        view.valueText.text = 'source';
        view.valueButton._text.text = signalText(value);
        view.valueButton._bg.clear().roundRect(0, 0, 30, 28, 7).fill(signalColor(value));
      } else if (component.type === 'probe') {
        const value = trit(component.state.value);
        view.valueText.text = `value = ${signalText(value)}`;
        view.valueText.style.fill = signalColor(value);
      } else if (component.type === 'component-input' || component.type === 'component-output') {
        const value = trit(component.type === 'component-input' ? component.state.value : component.inputs.in);
        view.valueText.text = `${component.state.name || (component.type === 'component-input' ? 'in' : 'out')} = ${signalText(value)}`;
        view.valueText.style.fill = signalColor(value);
        if (component.type === 'component-input' && view.valueButton) {
          view.valueButton._text.text = signalText(value);
          view.valueButton._bg.clear().roundRect(0, 0, 30, 28, 7).fill(signalColor(value));
        }
      } else {
        const outs = Object.entries(component.outputs);
        view.valueText.text = outs.length ? outs.map(([k, v]) => `${k}:${signalText(v)}`).join('  ') : '';
      }
    }

    rebuildWires() {
      this.wireLayer.removeChildren();
      this.wireViews.clear();
      for (const wire of this.circuit.wires.values()) {
        const container = new PIXI.Container();
        const g = new PIXI.Graphics();
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.on('pointerdown', (e) => {
          e.stopPropagation();
          this.app.canvas.focus();
          this.selectWire(wire.id);
        });
        const label = new PIXI.Text({
          text: '',
          style: { fill: COLORS.text, fontSize: 11, fontFamily: 'monospace' },
        });
        label.anchor.set(0.5);
        label.eventMode = 'none';
        container.addChild(g, label);
        this.wireLayer.addChild(container);
        this.wireViews.set(wire.id, { container, g, label });
        this.refreshWire(wire.id);
      }
    }

    redrawConnectedWires(componentId) {
      for (const wire of this.circuit.wires.values()) {
        if (wire.from.componentId === componentId || wire.to.componentId === componentId) this.refreshWire(wire.id);
      }
    }

    portPosition(componentId, kind, portName) {
      const view = this.nodeViews.get(componentId);
      const port = view?.ports.get(`${kind}:${portName}`);
      if (!view || !port) return null;
      return { x: view.container.x + port.x, y: view.container.y + port.y };
    }

    wireGeometry(wire) {
      const start = this.portPosition(wire.from.componentId, 'output', wire.from.port);
      const end = this.portPosition(wire.to.componentId, 'input', wire.to.port);
      if (!start || !end) return null;
      const dx = Math.max(55, Math.abs(end.x - start.x) * 0.45);
      return {
        start,
        cp1: { x: start.x + dx, y: start.y },
        cp2: { x: end.x - dx, y: end.y },
        end,
      };
    }

    refreshWire(id) {
      const wire = this.circuit.wires.get(id);
      const view = this.wireViews.get(id);
      if (!wire || !view) return;
      const geo = this.wireGeometry(wire);
      if (!geo) return;
      const selected = this.selection?.kind === 'wire' && this.selection.id === id;
      const g = view.g;
      g.clear();
      g.moveTo(geo.start.x, geo.start.y)
        .bezierCurveTo(geo.cp1.x, geo.cp1.y, geo.cp2.x, geo.cp2.y, geo.end.x, geo.end.y)
        .stroke({ color: selected ? COLORS.wireSelected : 0xffffff, width: selected ? 13 : 11, alpha: selected ? 0.28 : 0.002 });
      g.moveTo(geo.start.x, geo.start.y)
        .bezierCurveTo(geo.cp1.x, geo.cp1.y, geo.cp2.x, geo.cp2.y, geo.end.x, geo.end.y)
        .stroke({ color: selected ? COLORS.wireSelected : signalColor(wire.value), width: selected ? 4 : 3 });

      view.label.text = wire.label || '';
      view.label.visible = Boolean(wire.label);
      if (wire.label) {
        const p = this.cubicPoint(geo, 0.5);
        view.label.position.set(p.x, p.y - 10);
      }
    }

    findIncomingWire(componentId, port) {
      for (const wire of this.circuit.wires.values()) {
        if (wire.to.componentId === componentId && wire.to.port === port) return wire;
      }
      return null;
    }

    findInputAtGlobal(globalPoint) {
      if (!globalPoint) return null;
      const local = this.world.toLocal(globalPoint);
      // Ports have a 15px visual hit area. Convert that to world coordinates
      // so dropping feels the same at every zoom level, and make it slightly
      // forgiving for drag-and-drop.
      const radius = 22 / Math.max(0.25, this.world.scale.x || 1);
      let best = null;
      let bestDistance = Infinity;

      for (const component of this.circuit.components.values()) {
        const definition = this.registry.get(component.type);
        for (const portName of definition.inputs) {
          const p = this.portPosition(component.id, 'input', portName);
          if (!p) continue;
          const dx = local.x - p.x;
          const dy = local.y - p.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= radius && distance < bestDistance) {
            bestDistance = distance;
            best = { componentId: component.id, port: portName };
          }
        }
      }
      return best;
    }

    startWire(componentId, port, originalWireId = null, originInput = null) {
      this.pendingWire = { componentId, port, originalWireId, originInput };
      if (!this.previewWire) {
        this.previewWire = new PIXI.Graphics();
        this.overlayLayer.addChild(this.previewWire);
      }
      this.highlightInputPorts(true);
      this.onStatus(originalWireId
        ? `Rewiring ${originalWireId} … choose an input.`
        : `Connecting ${componentId}.${port} … choose an input.`);
    }

    finishWire(componentId, port) {
      if (!this.pendingWire) return;
      const pending = this.pendingWire;
      try {
        this.onBeforeChange(pending.originalWireId ? 'Move connection' : 'Create connection');
        // For rewire, keep the original alive until a valid new target is chosen.
        // This means Escape/background cancel leaves the old circuit untouched.
        if (pending.originalWireId) this.circuit.disconnect(pending.originalWireId);
        this.circuit.connect(pending.componentId, pending.port, componentId, port);
        this.onStatus(pending.originalWireId ? 'Connection moved.' : 'Connected.');
        this.onAfterChange(pending.originalWireId ? 'Move connection' : 'Create connection');
      } catch (error) {
        this.onStatus(error.message, true);
      } finally {
        this.cancelPendingWire(false);
      }
    }

    cancelPendingWire(showStatus = true) {
      this.pendingWire = null;
      this.previewWire?.clear();
      this.highlightInputPorts(false);
      if (showStatus) this.onStatus('Ready');
    }

    drawPreviewWire(globalPoint) {
      if (!this.pendingWire || !this.previewWire) return;
      const start = this.portPosition(this.pendingWire.componentId, 'output', this.pendingWire.port);
      if (!start) return;
      const end = this.world.toLocal(globalPoint);
      const dx = Math.max(55, Math.abs(end.x - start.x) * 0.45);
      this.previewWire.clear()
        .moveTo(start.x, start.y)
        .bezierCurveTo(start.x + dx, start.y, end.x - dx, end.y, end.x, end.y)
        .stroke({ color: COLORS.nodeSelected, width: 2.5, alpha: 0.9 });
    }

    highlightInputPorts(active) {
      for (const [componentId, view] of this.nodeViews.entries()) {
        const definition = this.registry.get(this.circuit.components.get(componentId)?.type);
        if (!definition) continue;
        for (const portName of definition.inputs) {
          const port = view.ports.get(`input:${portName}`);
          const circle = port?._circle;
          if (!circle) continue;
          circle.clear().circle(0, 0, active ? 9 : 7)
            .fill(active ? COLORS.pos : COLORS.port)
            .stroke({ color: active ? 0xffffff : 0x10151a, width: active ? 2.5 : 2 });
        }
      }
    }

    spawnPulse(wireId, value) {
      const wire = this.circuit.wires.get(wireId);
      const geo = wire ? this.wireGeometry(wire) : null;
      if (!geo) return;
      const dot = new PIXI.Graphics().circle(0, 0, 5).fill(signalColor(value));
      this.animationLayer.addChild(dot);
      this.pulses.push({ dot, geo, t: 0, duration: 420 });
    }

    updatePulses(deltaMS) {
      for (let i = this.pulses.length - 1; i >= 0; i--) {
        const pulse = this.pulses[i];
        pulse.t += deltaMS / pulse.duration;
        if (pulse.t >= 1) {
          pulse.dot.destroy();
          this.pulses.splice(i, 1);
          continue;
        }
        const p = this.cubicPoint(pulse.geo, pulse.t);
        pulse.dot.position.set(p.x, p.y);
      }
    }

    cubicPoint(geo, t) {
      const mt = 1 - t;
      const x = mt ** 3 * geo.start.x + 3 * mt ** 2 * t * geo.cp1.x + 3 * mt * t ** 2 * geo.cp2.x + t ** 3 * geo.end.x;
      const y = mt ** 3 * geo.start.y + 3 * mt ** 2 * t * geo.cp1.y + 3 * mt * t ** 2 * geo.cp2.y + t ** 3 * geo.end.y;
      return { x, y };
    }

    setCircuit(circuit) {
      if (this.circuit === circuit) return;
      this.unsubscribe.forEach((fn) => fn());
      this.unsubscribe = [];
      this.cancelPendingWire(false);
      this.selection = null;
      this.selectedId = null;
      this.selectedComponentIds.clear();
      this.circuit = circuit;
      this.setupCircuitEvents();
      this.rebuild();
      this.onSelectionChanged(null);
    }

    select(selection) {
      const oldWire = this.selection?.kind === 'wire' ? this.selection.id : null;
      const oldComponents = new Set(this.selectedComponentIds);

      this.selection = selection;
      this.selectedComponentIds.clear();
      if (selection?.kind === 'component') this.selectedComponentIds.add(selection.id);
      if (selection?.kind === 'components') selection.ids.forEach((id) => this.selectedComponentIds.add(id));
      this.selectedId = this.selectedComponentIds.size === 1 ? [...this.selectedComponentIds][0] : null;

      for (const id of oldComponents) this.drawNode(id);
      for (const id of this.selectedComponentIds) this.drawNode(id);
      if (oldWire) this.refreshWire(oldWire);
      if (selection?.kind === 'wire') this.refreshWire(selection.id);

      this.emitSelectionChanged();
    }

    emitSelectionChanged() {
      if (this.selection?.kind === 'wire') {
        const item = this.circuit.wires.get(this.selection.id) || null;
        this.onSelectionChanged(item ? { kind: 'wire', id: this.selection.id, item } : null);
        return;
      }
      const ids = [...this.selectedComponentIds].filter((id) => this.circuit.components.has(id));
      if (!ids.length) {
        this.selection = null;
        this.onSelectionChanged(null);
      } else if (ids.length === 1) {
        this.selection = { kind: 'component', id: ids[0] };
        this.onSelectionChanged({ kind: 'component', id: ids[0], item: this.circuit.components.get(ids[0]) });
      } else {
        this.selection = { kind: 'components', ids };
        this.onSelectionChanged({ kind: 'components', ids, items: ids.map((id) => this.circuit.components.get(id)).filter(Boolean) });
      }
    }

    syncComponentSelection() {
      const ids = [...this.selectedComponentIds].filter((id) => this.circuit.components.has(id));
      const old = new Set(this.selectedComponentIds);
      this.selectedComponentIds = new Set(ids);
      for (const id of old) this.drawNode(id);
      for (const id of this.selectedComponentIds) this.drawNode(id);
      this.emitSelectionChanged();
    }

    setSelectedComponents(ids) {
      const old = new Set(this.selectedComponentIds);
      const oldWire = this.selection?.kind === 'wire' ? this.selection.id : null;
      this.selectedComponentIds = new Set((ids || []).filter((id) => this.circuit.components.has(id)));
      this.selection = null;
      if (oldWire) this.refreshWire(oldWire);
      for (const id of old) this.drawNode(id);
      for (const id of this.selectedComponentIds) this.drawNode(id);
      this.emitSelectionChanged();
    }

    toggleComponentSelection(id) {
      const ids = new Set(this.selectedComponentIds);
      if (ids.has(id)) ids.delete(id); else ids.add(id);
      this.setSelectedComponents([...ids]);
    }

    getSelectedComponentIds() {
      return [...this.selectedComponentIds];
    }

    selectComponent(id, additive = false) {
      if (!id) return this.select(null);
      if (additive) this.toggleComponentSelection(id);
      else this.setSelectedComponents([id]);
    }

    selectWire(id) {
      this.select(id ? { kind: 'wire', id } : null);
    }

    deleteSelection() {
      if (!this.selection) return false;
      if (this.selection.kind === 'wire') {
        const id = this.selection.id;
        this.onBeforeChange('Delete connection');
        this.circuit.disconnect(id);
        this.select(null);
        this.onStatus('Connection deleted.');
        this.onAfterChange('Delete connection');
        return true;
      }

      const ids = this.getSelectedComponentIds();
      if (!ids.length) return false;
      this.onBeforeChange(ids.length > 1 ? 'Delete components' : 'Delete component');
      ids.forEach((id) => this.circuit.removeComponent(id));
      this.select(null);
      this.onStatus(`${ids.length} component${ids.length === 1 ? '' : 's'} deleted.`);
      this.onAfterChange(ids.length > 1 ? 'Delete components' : 'Delete component');
      return true;
    }

    snap(value) {
      const grid = 20;
      return Math.round(value / grid) * grid;
    }

    addAtViewportCenter(type, state = undefined) {
      this.onBeforeChange('Add component');
      const globalCenter = new PIXI.Point(this.app.screen.width / 2, this.app.screen.height / 2);
      const p = this.world.toLocal(globalCenter);
      const component = this.circuit.addComponent(type, this.snap(p.x - 75), this.snap(p.y - 40), state);
      this.selectComponent(component.id);
      this.onAfterChange('Add component');
      return component;
    }

    getViewState() {
      return { x: this.world.x, y: this.world.y, scale: this.world.scale.x };
    }

    setViewState(state) {
      if (!state) return;
      this.world.position.set(Number(state.x) || 0, Number(state.y) || 0);
      const scale = Math.max(0.25, Math.min(2.5, Number(state.scale) || 1));
      this.world.scale.set(scale);
    }
  }

  global.TernaryRenderer = { CircuitRenderer, signalColor, COLORS };
})(window);
