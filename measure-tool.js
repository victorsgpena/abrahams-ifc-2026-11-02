/**
 * measure-tool.js
 * Herramienta interactiva de medición 3D punto a punto con snap a esquinas, bordes y caras.
 */

export class MeasureTool {
    constructor(scene, camera, renderer, snapEngine, container) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.snapEngine = snapEngine;
        this.container = container;

        this.active = false;
        this.startPoint = null;
        this.currentHoverPoint = null;
        this.currentSnapType = null;

        this.measurements = []; // Array de { id, p1, p2, distM, group, labelEl }

        // Contenedor HTML para etiquetas 2D superpuestas
        this.labelsContainer = document.createElement('div');
        this.labelsContainer.className = 'measure-labels-layer';
        this.container.appendChild(this.labelsContainer);

        // Marcador de cursor de medición
        const markerGeom = new THREE.SphereGeometry(0.022, 14, 14);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffa502, depthTest: false });
        this.cursorMarker = new THREE.Mesh(markerGeom, markerMat);
        this.cursorMarker.renderOrder = 999;
        this.cursorMarker.visible = false;
        this.scene.add(this.cursorMarker);

        // Línea temporal en vivo mientras se mide
        const tempGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const tempMat = new THREE.LineBasicMaterial({ color: 0xffa502, linewidth: 2, depthTest: false });
        this.tempLine = new THREE.Line(tempGeom, tempMat);
        this.tempLine.renderOrder = 998;
        this.tempLine.visible = false;
        this.scene.add(this.tempLine);

        // Etiqueta flotante temporal en vivo
        this.liveLabel = document.createElement('div');
        this.liveLabel.className = 'measure-label measure-label-live';
        this.liveLabel.style.display = 'none';
        this.labelsContainer.appendChild(this.liveLabel);

        this.onStateChange = null;

        this._initEvents();
    }

    _initEvents() {
        const dom = this.renderer.domElement;

        dom.addEventListener('pointermove', (e) => {
            if (!this.active) return;
            this._onPointerMove(e);
        });

        dom.addEventListener('pointerdown', (e) => {
            if (!this.active || e.button !== 0) return;
            this._onPointerDown(e);
        }, true); // Captura antes de selección de bloques

        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            if (e.key === 'm' || e.key === 'M') {
                this.toggle();
            } else if (e.key === 'Escape' && this.active) {
                if (this.startPoint) {
                    // Cancelar medición en curso
                    this.startPoint = null;
                    this.tempLine.visible = false;
                    this.liveLabel.style.display = 'none';
                } else {
                    this.setActive(false);
                }
            }
        });
    }

    toggle() {
        this.setActive(!this.active);
    }

    setActive(state) {
        this.active = state;
        if (this.active) {
            // Salir del modo colocación de bloques si estaba activo
            this.snapEngine.cancelPlacing();
            this.renderer.domElement.style.cursor = 'crosshair';
        } else {
            this.startPoint = null;
            this.cursorMarker.visible = false;
            this.tempLine.visible = false;
            this.liveLabel.style.display = 'none';
            this.renderer.domElement.style.cursor = 'default';
        }
        if (this.onStateChange) this.onStateChange(this.active);
    }

    _onPointerMove(e) {
        const snapResult = this.snapEngine.getSnapPointFromEvent(e);
        if (!snapResult) {
            this.cursorMarker.visible = false;
            this.tempLine.visible = false;
            this.liveLabel.style.display = 'none';
            this.currentHoverPoint = null;
            return;
        }

        this.currentHoverPoint = snapResult.point;
        this.currentSnapType = snapResult.snapType; // 'corner' | 'edge' | 'face' | 'ground'

        // Escalar el marcador ligeramente según la distancia a la cámara para visibilidad constante
        const camDist = this.camera.position.distanceTo(snapResult.point);
        const scale = Math.max(0.4, Math.min(camDist * 0.12, 3.0));
        this.cursorMarker.scale.setScalar(scale);
        this.cursorMarker.position.copy(snapResult.point);

        // Color según tipo de snap: Esquina = Rosa/Magenta, Borde = Cian, Cara = Naranja
        if (snapResult.snapType === 'corner') {
            this.cursorMarker.material.color.setHex(0xff4757);
        } else if (snapResult.snapType === 'edge') {
            this.cursorMarker.material.color.setHex(0x00d2d3);
        } else {
            this.cursorMarker.material.color.setHex(0xffa502);
        }
        this.cursorMarker.visible = true;

        if (this.startPoint) {
            const positions = this.tempLine.geometry.attributes.position.array;
            positions[0] = this.startPoint.x;
            positions[1] = this.startPoint.y;
            positions[2] = this.startPoint.z;
            positions[3] = snapResult.point.x;
            positions[4] = snapResult.point.y;
            positions[5] = snapResult.point.z;
            this.tempLine.geometry.attributes.position.needsUpdate = true;
            this.tempLine.geometry.computeBoundingSphere();
            this.tempLine.visible = true;

            const distM = this.startPoint.distanceTo(snapResult.point);
            const distMm = Math.round(distM * 1000);
            const dx = Math.round(Math.abs(snapResult.point.x - this.startPoint.x) * 1000);
            const dy = Math.round(Math.abs(snapResult.point.y - this.startPoint.y) * 1000);
            const dz = Math.round(Math.abs(snapResult.point.z - this.startPoint.z) * 1000);

            const mid = this.startPoint.clone().add(snapResult.point).multiplyScalar(0.5);
            const screen = this._toScreenPosition(mid);
            if (screen.visible) {
                const snapBadge = snapResult.snapType === 'corner' ? 'Corner' : (snapResult.snapType === 'edge' ? 'Edge' : 'Face');
                this.liveLabel.innerHTML = `
                    <div class="m-main">${distMm} mm <small>(${distM.toFixed(3)} m)</small></div>
                    <div class="m-sub">ΔX: ${dx} | ΔY: ${dy} | ΔZ: ${dz} mm • <span>${snapBadge}</span></div>
                `;
                this.liveLabel.style.left = `${screen.x}px`;
                this.liveLabel.style.top = `${screen.y}px`;
                this.liveLabel.style.display = 'block';
            } else {
                this.liveLabel.style.display = 'none';
            }
        }
    }

    _onPointerDown(e) {
        if (!this.currentHoverPoint) return;
        e.stopPropagation();

        if (!this.startPoint) {
            this.startPoint = this.currentHoverPoint.clone();
        } else {
            const endPoint = this.currentHoverPoint.clone();
            if (this.startPoint.distanceTo(endPoint) > 0.001) {
                this._createMeasurement(this.startPoint, endPoint);
            }
            this.startPoint = null;
            this.tempLine.visible = false;
            this.liveLabel.style.display = 'none';
        }
    }

    _createMeasurement(p1, p2) {
        const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const group = new THREE.Group();

        // Puntos extremos
        const dotGeom = new THREE.SphereGeometry(0.018, 12, 12);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffa502, depthTest: false });
        const d1 = new THREE.Mesh(dotGeom, dotMat);
        const d2 = new THREE.Mesh(dotGeom, dotMat);
        d1.position.copy(p1);
        d2.position.copy(p2);
        d1.renderOrder = 995;
        d2.renderOrder = 995;
        group.add(d1, d2);

        // Línea de cota
        const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffa502, linewidth: 2, depthTest: false });
        const line = new THREE.Line(lineGeom, lineMat);
        line.renderOrder = 994;
        group.add(line);

        this.scene.add(group);

        const distM = p1.distanceTo(p2);
        const distMm = Math.round(distM * 1000);

        const labelEl = document.createElement('div');
        labelEl.className = 'measure-label';
        labelEl.innerHTML = `
            <span>📏 <b>${distMm} mm</b> <small>(${distM.toFixed(3)} m)</small></span>
            <button class="measure-del-btn" title="Delete this measurement">×</button>
        `;

        labelEl.querySelector('.measure-del-btn').addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.removeMeasurement(id);
        });

        this.labelsContainer.appendChild(labelEl);

        this.measurements.push({
            id,
            p1: p1.clone(),
            p2: p2.clone(),
            distM,
            group,
            labelEl
        });

        this.updateLabels();
    }

    removeMeasurement(id) {
        const idx = this.measurements.findIndex(m => m.id === id);
        if (idx === -1) return;
        const m = this.measurements[idx];
        this.scene.remove(m.group);
        if (m.labelEl && m.labelEl.parentNode) {
            m.labelEl.parentNode.removeChild(m.labelEl);
        }
        this.measurements.splice(idx, 1);
    }

    clearAll() {
        this.measurements.forEach(m => {
            this.scene.remove(m.group);
            if (m.labelEl && m.labelEl.parentNode) {
                m.labelEl.parentNode.removeChild(m.labelEl);
            }
        });
        this.measurements = [];
        this.startPoint = null;
        this.tempLine.visible = false;
        this.liveLabel.style.display = 'none';
    }

    updateLabels() {
        for (const m of this.measurements) {
            const mid = m.p1.clone().add(m.p2).multiplyScalar(0.5);
            const screen = this._toScreenPosition(mid);
            if (screen.visible) {
                m.labelEl.style.left = `${screen.x}px`;
                m.labelEl.style.top = `${screen.y}px`;
                m.labelEl.style.display = 'inline-flex';
            } else {
                m.labelEl.style.display = 'none';
            }
        }
    }

    _toScreenPosition(worldVec) {
        const v = worldVec.clone().project(this.camera);
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = (v.x * 0.5 + 0.5) * rect.width;
        const y = (-(v.y * 0.5) + 0.5) * rect.height;
        return {
            x,
            y,
            visible: v.z >= -1 && v.z <= 1
        };
    }
}
