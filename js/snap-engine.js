/**
 * snap-engine.js
 * Motor de Raycasting, Snapping a esquinas, bordes y caras, y colocación por Polilínea o Individual.
 */

import { createBlockMesh, getBlockDefinition } from './block-catalog.js';

export class SnapEngine {
    constructor(scene, camera, renderer, ifcLoader) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.ifcLoader = ifcLoader;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.activeBlockDef = null;
        this.ghostMesh = null;
        this.isPlacing = false;

        // Modo de colocación: 'polyline' (trazar polilínea y generar paneles a lo largo) o 'single' (panel por panel)
        this.placementMode = 'polyline';

        // Estado de la polilínea activa
        this.polylinePoints = [];   // Array de { point: THREE.Vector3, normal: THREE.Vector3 }
        this.currentHoverSnap = null;
        this.polylinePreviewGroup = new THREE.Group();
        this.polylinePreviewGroup.name = 'Polyline_Preview_Group';
        this.scene.add(this.polylinePreviewGroup);

        // Línea visual de la polilínea trazada
        this.polylineLineGroup = new THREE.Group();
        this.polylineLineGroup.name = 'Polyline_Line_Visual';
        this.scene.add(this.polylineLineGroup);

        // Inversión manual del lado exterior de la polilínea (tecla F)
        this.flipSide = false;
        // Incluir panel extra al final si sobra tramo (tecla C)
        this.fillRemainder = false;

        // Rotaciones en 3 dimensiones en incrementos de 90° (0, PI/2, PI, 3PI/2)
        this.rotZ = 0; // Tecla R
        this.rotX = 0; // Tecla E
        this.rotY = 0; // Tecla T

        this.snapToGrid = true;
        this.gridSize = 0.05; // 50 mm

        // Snap magnético a bordes y esquinas de la estructura
        this.snapToEdges = true;

        this.placedBlocks = []; // Lista de grupos de bloques colocados en la escena
        this.selectedBlock = null;

        // Plano de suelo virtual (Y=0)
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        // Modo revestimiento exterior: fuerza que los paneles crezcan hacia afuera de la casa
        this.exteriorMode = false;
        // Máximo desplazamiento permitido para apoyar en la cara exterior del perfil (m)
        this.maxProfileDepth = 0.12;

        // Flecha guía que indica hacia dónde crecerá el panel
        this.directionArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.35, 0x2ed573, 0.08, 0.05
        );
        this.directionArrow.visible = false;
        this.scene.add(this.directionArrow);

        // Callbacks
        this.onBlockPlacedCallback = null;
        this.onBlockSelectedCallback = null;
        this.onBlocksChangedCallback = null;
        this.onPolylineStateChange = null;

        this._initEvents();
    }

    _initEvents() {
        const dom = this.renderer.domElement;

        dom.addEventListener('pointermove', (e) => this._onPointerMove(e));
        dom.addEventListener('pointerdown', (e) => this._onPointerDown(e));
        dom.addEventListener('dblclick', (e) => {
            if (this.isPlacing && this.placementMode === 'polyline' && this.polylinePoints.length >= 2) {
                e.preventDefault();
                this.finishPolyline();
            }
        });

        // Teclas rápidas
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            if (e.key === 'r' || e.key === 'R') {
                this.rotateActiveBlock('Z');
            } else if (e.key === 'e' || e.key === 'E') {
                this.rotateActiveBlock('X');
            } else if (e.key === 't' || e.key === 'T') {
                this.rotateActiveBlock('Y');
            } else if (e.key === 'f' || e.key === 'F') {
                if (this.isPlacing && this.placementMode === 'polyline') {
                    this.flipSide = !this.flipSide;
                    this._rebuildPolylinePreview();
                }
            } else if (e.key === 'c' || e.key === 'C') {
                if (this.isPlacing && this.placementMode === 'polyline') {
                    this.fillRemainder = !this.fillRemainder;
                    this._rebuildPolylinePreview();
                }
            } else if (e.key === 'Enter') {
                if (this.isPlacing && this.placementMode === 'polyline' && this.polylinePoints.length >= 1) {
                    e.preventDefault();
                    this.finishPolyline();
                }
            } else if (e.key === 'Backspace') {
                if (this.isPlacing && this.placementMode === 'polyline' && this.polylinePoints.length > 0) {
                    e.preventDefault();
                    this.undoLastPolylinePoint();
                } else {
                    this.deleteSelectedBlock();
                }
            } else if (e.key === 'Delete') {
                this.deleteSelectedBlock();
            } else if (e.key === 'Escape') {
                if (this.isPlacing && this.placementMode === 'polyline' && this.polylinePoints.length > 0) {
                    this._clearPolylineState();
                } else {
                    this.cancelPlacing();
                }
            }
        });
    }

    /**
     * Extrae y almacena en caché los bordes y esquinas reales de una malla en coordenadas del mundo.
     */
    _getMeshEdgeData(mesh) {
        if (!mesh || !mesh.geometry) return null;
        mesh.updateMatrixWorld();

        const mElements = mesh.matrixWorld.elements;
        const matrixKey = `${mElements[12].toFixed(3)}_${mElements[13].toFixed(3)}_${mElements[14].toFixed(3)}_${mElements[0].toFixed(2)}`;

        if (mesh.userData._edgeCache && mesh.userData._edgeCacheKey === matrixKey) {
            return mesh.userData._edgeCache;
        }

        const edgesGeom = new THREE.EdgesGeometry(mesh.geometry, 15);
        const posAttr = edgesGeom.attributes.position;
        if (!posAttr) return null;

        const count = posAttr.count;
        const worldSegments = new Float32Array(count * 3);
        const cornerMap = new Map();
        const corners = [];
        const v = new THREE.Vector3();

        for (let i = 0; i < count; i++) {
            v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
            const idx = i * 3;
            worldSegments[idx] = v.x;
            worldSegments[idx + 1] = v.y;
            worldSegments[idx + 2] = v.z;

            const key = `${Math.round(v.x * 1000)}_${Math.round(v.y * 1000)}_${Math.round(v.z * 1000)}`;
            if (!cornerMap.has(key)) {
                const c = v.clone();
                cornerMap.set(key, c);
                corners.push(c);
            }
        }

        edgesGeom.dispose();

        const cache = { worldSegments, corners };
        mesh.userData._edgeCache = cache;
        mesh.userData._edgeCacheKey = matrixKey;
        return cache;
    }

    /**
     * Busca si hay una esquina o borde cercano al punto de intersección.
     * @returns {{ point: THREE.Vector3, snapType: 'corner'|'edge' } | null}
     */
    _findClosestEdgeOrCorner(mesh, hitPoint, radius) {
        const data = this._getMeshEdgeData(mesh);
        if (!data) return null;

        const radiusSq = radius * radius;

        // 1. Prioridad a las esquinas (vértices)
        let bestCorner = null;
        let bestCornerDistSq = radiusSq;
        for (let i = 0; i < data.corners.length; i++) {
            const c = data.corners[i];
            const dSq = hitPoint.distanceToSquared(c);
            if (dSq < bestCornerDistSq) {
                bestCornerDistSq = dSq;
                bestCorner = c;
            }
        }
        if (bestCorner) {
            return { point: bestCorner.clone(), snapType: 'corner' };
        }

        // 2. Búsqueda del punto más cercano sobre los segmentos de borde
        const segs = data.worldSegments;
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const ap = new THREE.Vector3();
        const closest = new THREE.Vector3();

        let bestEdgePoint = null;
        let bestEdgeDistSq = radiusSq;

        for (let i = 0; i < segs.length; i += 6) {
            a.set(segs[i], segs[i + 1], segs[i + 2]);
            b.set(segs[i + 3], segs[i + 4], segs[i + 5]);
            ab.subVectors(b, a);
            const lenSq = ab.lengthSq();
            if (lenSq < 1e-8) continue;

            ap.subVectors(hitPoint, a);
            let t = ap.dot(ab) / lenSq;
            t = Math.max(0, Math.min(1, t));
            closest.copy(a).addScaledVector(ab, t);

            const dSq = hitPoint.distanceToSquared(closest);
            if (dSq < bestEdgeDistSq) {
                bestEdgeDistSq = dSq;
                bestEdgePoint = closest.clone();
            }
        }

        if (bestEdgePoint) {
            return { point: bestEdgePoint, snapType: 'edge' };
        }

        return null;
    }

    /**
     * Obtiene el punto 3D con snap (esquina, borde, cara o suelo) para cualquier herramienta (bloques o medición).
     */
    getSnapPointFromEvent(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const ifcMeshes = this.ifcLoader.getCollidableMeshes();
        const blockMeshes = [];
        this.placedBlocks.forEach(g => {
            g.traverse(child => {
                if (child.isMesh && (!child.userData || !child.userData.isWatermark)) {
                    blockMeshes.push(child);
                }
            });
        });

        const targets = [...ifcMeshes, ...blockMeshes];
        const hits = targets.length > 0 ? this.raycaster.intersectObjects(targets, false) : [];

        if (hits.length > 0) {
            const hit = hits[0];
            const face = hit.face;
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            const worldNormal = face
                ? face.normal.clone().applyMatrix3(normalMatrix).normalize()
                : new THREE.Vector3(0, 0, 1);

            if (worldNormal.dot(this.raycaster.ray.direction) > 0) worldNormal.negate();

            if (this.exteriorMode && Math.abs(worldNormal.y) < 0.7) {
                const center = new THREE.Vector3();
                this.ifcLoader.getBounds().getCenter(center);
                const outward = hit.point.clone().sub(center);
                outward.y = 0;
                if (worldNormal.dot(outward) < 0) worldNormal.negate();
            }

            const camDist = this.camera.position.distanceTo(hit.point);
            const snapRadius = Math.max(0.03, Math.min(camDist * 0.025, 0.14));

            if (this.snapToEdges) {
                const edgeSnap = this._findClosestEdgeOrCorner(hit.object, hit.point, snapRadius);
                if (edgeSnap) {
                    return {
                        point: edgeSnap.point,
                        normal: worldNormal,
                        hitObject: hit.object,
                        snapType: edgeSnap.snapType
                    };
                }
            }

            // Si no hubo snap a borde/esquina, proyectar a la cara exterior del perfil y aplicar grilla en el plano
            let basePoint = hit.point.clone();
            let normalDist = basePoint.dot(worldNormal);

            if (hit.object.userData && hit.object.userData.isIfcElement) {
                const box = new THREE.Box3().setFromObject(hit.object);
                let maxDist = -Infinity;
                for (let i = 0; i < 8; i++) {
                    const corner = new THREE.Vector3(
                        i & 1 ? box.max.x : box.min.x,
                        i & 2 ? box.max.y : box.min.y,
                        i & 4 ? box.max.z : box.min.z
                    );
                    maxDist = Math.max(maxDist, corner.dot(worldNormal));
                }
                const extra = maxDist - normalDist;
                if (extra > 0 && extra <= this.maxProfileDepth) normalDist = maxDist;
            }

            normalDist += 0.0005;
            let inPlane = basePoint.clone().addScaledVector(worldNormal, -basePoint.dot(worldNormal));

            if (this.snapToGrid && this.gridSize > 0) {
                inPlane.set(
                    Math.round(inPlane.x / this.gridSize) * this.gridSize,
                    Math.round(inPlane.y / this.gridSize) * this.gridSize,
                    Math.round(inPlane.z / this.gridSize) * this.gridSize
                );
                inPlane.addScaledVector(worldNormal, -inPlane.dot(worldNormal));
            }

            const finalPoint = inPlane.addScaledVector(worldNormal, normalDist);
            return {
                point: finalPoint,
                normal: worldNormal,
                hitObject: hit.object,
                snapType: 'face'
            };
        }

        const groundHit = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.groundPlane, groundHit)) {
            if (this.snapToGrid && this.gridSize > 0) {
                groundHit.x = Math.round(groundHit.x / this.gridSize) * this.gridSize;
                groundHit.z = Math.round(groundHit.z / this.gridSize) * this.gridSize;
            }
            groundHit.y = 0;
            return {
                point: groundHit,
                normal: new THREE.Vector3(0, 1, 0),
                hitObject: null,
                snapType: 'ground'
            };
        }

        return null;
    }

    /**
     * Inicia el modo de colocación para un tipo de bloque del catálogo.
     * @param {string} blockId ID del bloque
     */
    startPlacing(blockId) {
        const def = getBlockDefinition(blockId);
        if (!def) {
            console.warn(`[SnapEngine] Bloque no encontrado: ${blockId}`);
            return;
        }

        this.cancelPlacing();

        this.activeBlockDef = def;
        this.isPlacing = true;
        this.rotZ = 0;
        this.rotX = 0;
        this.rotY = 0;
        this.flipSide = false;

        // Crear malla fantasma semitransparente con punto pivote verde
        this.ghostMesh = createBlockMesh(def, true);
        this.ghostMesh.visible = false;
        this.scene.add(this.ghostMesh);

        if (this.onPolylineStateChange) {
            this.onPolylineStateChange(this.isPlacing, this.polylinePoints.length);
        }

        console.log(`[SnapEngine] Modo colocación (${this.placementMode}) activo para: ${def.name}`);
    }

    /**
     * Limpia únicamente los puntos en curso de la polilínea manteniendo el bloque activo.
     */
    _clearPolylineState() {
        this.polylinePoints = [];
        this.currentHoverSnap = null;
        while (this.polylinePreviewGroup.children.length > 0) {
            this.polylinePreviewGroup.remove(this.polylinePreviewGroup.children[0]);
        }
        while (this.polylineLineGroup.children.length > 0) {
            this.polylineLineGroup.remove(this.polylineLineGroup.children[0]);
        }
        if (this.onPolylineStateChange) {
            this.onPolylineStateChange(this.isPlacing, 0);
        }
    }

    /**
     * Deshace el último vértice de la polilínea en curso.
     */
    undoLastPolylinePoint() {
        if (this.polylinePoints.length > 0) {
            this.polylinePoints.pop();
            this._rebuildPolylinePreview();
            if (this.onPolylineStateChange) {
                this.onPolylineStateChange(this.isPlacing, this.polylinePoints.length);
            }
        }
    }

    /**
     * Cancela el modo de colocación actual.
     */
    cancelPlacing() {
        this._clearPolylineState();
        if (this.ghostMesh) {
            this.scene.remove(this.ghostMesh);
            this.ghostMesh = null;
        }
        this.isPlacing = false;
        this.activeBlockDef = null;
        if (this.directionArrow) this.directionArrow.visible = false;
        // Restaurar estado visual en catálogo
        document.querySelectorAll('.catalog-card').forEach(c => c.classList.remove('active-placing'));
        if (this.onPolylineStateChange) {
            this.onPolylineStateChange(false, 0);
        }
    }

    /**
     * Rota el bloque activo o seleccionado en incrementos de 90° en el eje indicado ('Z', 'X', 'Y').
     * @param {'Z'|'X'|'Y'} axis
     */
    rotateActiveBlock(axis = 'Z') {
        const halfPi = Math.PI / 2;

        if (this.isPlacing && this.ghostMesh) {
            if (axis === 'Z') {
                this.rotZ = (this.rotZ + halfPi) % (Math.PI * 2);
                this.ghostMesh.rotateZ(halfPi);
            } else if (axis === 'X') {
                this.rotX = (this.rotX + halfPi) % (Math.PI * 2);
                this.ghostMesh.rotateX(halfPi);
            } else if (axis === 'Y') {
                this.rotY = (this.rotY + halfPi) % (Math.PI * 2);
                this.ghostMesh.rotateY(halfPi);
            }
            if (this.placementMode === 'polyline' && this.polylinePoints.length > 0) {
                this._rebuildPolylinePreview();
            }
        } else if (this.selectedBlock) {
            if (axis === 'Z') this.selectedBlock.rotateZ(halfPi);
            else if (axis === 'X') this.selectedBlock.rotateX(halfPi);
            else if (axis === 'Y') this.selectedBlock.rotateY(halfPi);

            if (this.onBlocksChangedCallback) this.onBlocksChangedCallback(this.placedBlocks);
        }
    }

    /**
     * Calcula las transformaciones (posición y quaternion) de todos los paneles a lo largo de los tramos de la polilínea.
     */
    _computePolylinePlacements(nodes) {
        if (!this.activeBlockDef || nodes.length < 2) return { transforms: [], totalLenM: 0, remainderMm: 0 };

        // Si el bloque está rotado 90° o 270° en Z, el paso horizontal es su altura (ej. Tophat horizontal de 6000mm)
        const isRotated90 = Math.abs(Math.sin(this.rotZ)) > 0.7;
        const stepM = (isRotated90 ? (this.activeBlockDef.h || 2400) : (this.activeBlockDef.w || 600)) * 0.001;

        const transforms = [];
        let totalLenM = 0;
        let lastRemainderMm = 0;

        for (let s = 0; s < nodes.length - 1; s++) {
            const nA = nodes[s];
            const nB = nodes[s + 1];

            // Proyección horizontal del tramo para mantener los paneles perfectamente a plomo vertical
            const delta = new THREE.Vector3().subVectors(nB.point, nA.point);
            const horizDelta = new THREE.Vector3(delta.x, 0, delta.z);
            const segLen = horizDelta.length();

            if (segLen < 0.02) continue;
            totalLenM += segLen;

            const u = horizDelta.clone().normalize(); // Dirección de avance A -> B
            const up = new THREE.Vector3(0, 1, 0);

            // Normal perpendicular horizontal al tramo
            let outward = new THREE.Vector3().crossVectors(u, up).normalize();

            // Orientar hacia la normal detectada en el muro (o hacia la cámara)
            const refNormal = nA.normal && Math.abs(nA.normal.y) < 0.8 ? nA.normal : this.camera.position.clone().sub(nA.point);
            if (outward.dot(refNormal) < 0) {
                outward.negate();
            }
            if (this.flipSide) {
                outward.negate();
            }

            // Cantidad de paneles en este tramo
            let count = Math.floor((segLen + 0.005) / stepM);
            const remM = segLen - count * stepM;
            lastRemainderMm = Math.round(remM * 1000);

            if (this.fillRemainder && remM > 0.02) {
                count += 1;
            }

            // Construir cuaternión base del tramo:
            // En createBlockMesh: X va de [-width, 0], Y va de [0, height], Z va de [0, thickness].
            // Para que Z apunte en dirección `outward` y Y apunte hacia `up` (sistema dextrógiro X = Y x Z):
            const xAxis = new THREE.Vector3().crossVectors(up, outward).normalize();
            const basisMatrix = new THREE.Matrix4().makeBasis(xAxis, up, outward);
            const baseQuat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

            // Si xAxis apunta en la misma dirección que `u` (+u), el panel i (cuyo X local va de -W a 0)
            // debe tener su origen X=0 en (i + 1) * stepM para cubrir [i*stepM, (i+1)*stepM].
            // Si xAxis apunta en dirección -u, su origen X=0 se ubica en i * stepM.
            const xAlignedWithU = xAxis.dot(u) > 0;

            for (let i = 0; i < count; i++) {
                const distAlong = (xAlignedWithU && !isRotated90) ? (i + 1) * stepM : i * stepM;
                const pos = new THREE.Vector3(
                    nA.point.x + u.x * distAlong,
                    nA.point.y,
                    nA.point.z + u.z * distAlong
                ).addScaledVector(outward, 0.0005);

                const q = baseQuat.clone();
                if (this.rotZ !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.rotZ));
                if (this.rotX !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.rotX));
                if (this.rotY !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY));

                transforms.push({ position: pos, quaternion: q, outward });
            }
        }

        return { transforms, totalLenM, remainderMm: lastRemainderMm };
    }

    /**
     * Reconstruye la previsualización 3D de los bloques a lo largo de la polilínea activa.
     */
    _rebuildPolylinePreview() {
        while (this.polylinePreviewGroup.children.length > 0) {
            this.polylinePreviewGroup.remove(this.polylinePreviewGroup.children[0]);
        }
        while (this.polylineLineGroup.children.length > 0) {
            this.polylineLineGroup.remove(this.polylineLineGroup.children[0]);
        }

        const nodes = [...this.polylinePoints];
        if (this.currentHoverSnap) {
            nodes.push(this.currentHoverSnap);
        }

        if (nodes.length === 0) {
            return;
        }

        // Dibujar vértices y línea guía de la polilínea
        const dotGeom = new THREE.SphereGeometry(0.025, 12, 12);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x00d2d3, depthTest: false });
        const linePts = [];

        nodes.forEach((n) => {
            const dot = new THREE.Mesh(dotGeom, dotMat);
            dot.position.copy(n.point);
            dot.renderOrder = 996;
            this.polylineLineGroup.add(dot);
            linePts.push(n.point.clone());
        });

        if (linePts.length >= 2) {
            const lineGeom = new THREE.BufferGeometry().setFromPoints(linePts);
            const lineMat = new THREE.LineBasicMaterial({ color: 0x00d2d3, linewidth: 2, depthTest: false });
            const line = new THREE.Line(lineGeom, lineMat);
            line.renderOrder = 995;
            this.polylineLineGroup.add(line);
        }

        if (nodes.length < 2) {
            return;
        }

        const { transforms } = this._computePolylinePlacements(nodes);

        transforms.forEach(tr => {
            const ghost = createBlockMesh(this.activeBlockDef, true);
            ghost.position.copy(tr.position);
            ghost.quaternion.copy(tr.quaternion);
            this.polylinePreviewGroup.add(ghost);
        });
    }

    /**
     * Confirma y materializa todos los paneles de la polilínea activa en la escena.
     */
    finishPolyline() {
        if (!this.activeBlockDef || this.polylinePoints.length < 2) {
            this._clearPolylineState();
            return;
        }

        const { transforms } = this._computePolylinePlacements(this.polylinePoints);
        let lastCreated = null;

        transforms.forEach(tr => {
            const newBlock = createBlockMesh(this.activeBlockDef, false);
            newBlock.position.copy(tr.position);
            newBlock.quaternion.copy(tr.quaternion);
            this.scene.add(newBlock);
            this.placedBlocks.push(newBlock);
            lastCreated = newBlock;
        });

        console.log(`[SnapEngine] Polilínea completada: ${transforms.length} bloques creados.`);

        this._clearPolylineState();

        if (lastCreated) {
            if (this.onBlockPlacedCallback) {
                this.onBlockPlacedCallback(lastCreated, this.placedBlocks);
            }
            if (this.onBlocksChangedCallback) {
                this.onBlocksChangedCallback(this.placedBlocks);
            }
            this.selectBlock(lastCreated);
        }
    }

    _onPointerMove(e) {
        const snap = this.getSnapPointFromEvent(e);

        if (!this.isPlacing || !this.ghostMesh) return;

        if (!snap) {
            this.ghostMesh.visible = false;
            this.directionArrow.visible = false;
            return;
        }

        this.currentHoverSnap = snap;

        // Actualizar color del punto pivote según el tipo de snap (Esquina=Rojo, Borde=Cian, Cara=Verde)
        const pivotDot = this.ghostMesh.children[2];
        if (pivotDot && pivotDot.material) {
            if (snap.snapType === 'corner') {
                pivotDot.material.color.setHex(0xff4757);
                pivotDot.scale.setScalar(1.35);
            } else if (snap.snapType === 'edge') {
                pivotDot.material.color.setHex(0x00d2d3);
                pivotDot.scale.setScalar(1.2);
            } else {
                pivotDot.material.color.setHex(0x2ed573);
                pivotDot.scale.setScalar(1.0);
            }
        }

        // Si estamos en modo polilínea y ya hay al menos un punto inicial marcado, mostrar la fila de paneles
        if (this.placementMode === 'polyline' && this.polylinePoints.length > 0) {
            this.ghostMesh.visible = false;
            this.directionArrow.visible = false;
            this._rebuildPolylinePreview();
            return;
        }

        // Mostrar bloque fantasma individual en el cursor (antes del 1er clic de la polilínea o en modo individual)
        this.ghostMesh.position.copy(snap.point);

        if (snap.snapType === 'ground') {
            this.ghostMesh.rotation.set(this.rotX, this.rotY, this.rotZ);
            this.directionArrow.visible = false;
        } else {
            const defaultZ = new THREE.Vector3(0, 0, 1);
            const quat = new THREE.Quaternion().setFromUnitVectors(defaultZ, snap.normal);
            this.ghostMesh.quaternion.copy(quat);

            if (this.rotZ !== 0) this.ghostMesh.rotateZ(this.rotZ);
            if (this.rotX !== 0) this.ghostMesh.rotateX(this.rotX);
            if (this.rotY !== 0) this.ghostMesh.rotateY(this.rotY);

            this.directionArrow.position.copy(snap.point);
            this.directionArrow.setDirection(snap.normal);
            this.directionArrow.visible = true;
        }

        this.ghostMesh.visible = true;
    }

    _onPointerDown(e) {
        // Clic derecho mientras se traza polilínea = confirmar polilínea
        if (e.button === 2 && this.isPlacing && this.placementMode === 'polyline' && this.polylinePoints.length >= 2) {
            e.preventDefault();
            this.finishPolyline();
            return;
        }

        if (e.button !== 0) return;

        if (this.isPlacing) {
            const snap = this.getSnapPointFromEvent(e);
            if (!snap) return;

            if (this.placementMode === 'polyline') {
                this.polylinePoints.push({
                    point: snap.point.clone(),
                    normal: snap.normal.clone()
                });
                this._rebuildPolylinePreview();
                if (this.onPolylineStateChange) {
                    this.onPolylineStateChange(this.isPlacing, this.polylinePoints.length);
                }
                e.stopPropagation();
                return;
            }

            if (this.ghostMesh && this.ghostMesh.visible) {
                this._confirmPlacement();
                e.stopPropagation();
                return;
            }
        }

        this._handleSelection();
    }

    _confirmPlacement() {
        const newBlock = createBlockMesh(this.activeBlockDef, false);
        newBlock.position.copy(this.ghostMesh.position);
        newBlock.quaternion.copy(this.ghostMesh.quaternion);

        this.scene.add(newBlock);
        this.placedBlocks.push(newBlock);

        console.log(`[SnapEngine] Bloque colocado: ${this.activeBlockDef.name} en (${newBlock.position.x.toFixed(2)}, ${newBlock.position.y.toFixed(2)}, ${newBlock.position.z.toFixed(2)})`);

        if (this.onBlockPlacedCallback) {
            this.onBlockPlacedCallback(newBlock, this.placedBlocks);
        }
        if (this.onBlocksChangedCallback) {
            this.onBlocksChangedCallback(this.placedBlocks);
        }

        this.selectBlock(newBlock);
    }

    _handleSelection() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const blockMeshes = [];
        const meshToGroup = new Map();

        this.placedBlocks.forEach(group => {
            group.traverse(child => {
                if (child.isMesh) {
                    blockMeshes.push(child);
                    meshToGroup.set(child, group);
                }
            });
        });

        const hits = this.raycaster.intersectObjects(blockMeshes, false);
        if (hits.length > 0) {
            const hitGroup = meshToGroup.get(hits[0].object);
            this.selectBlock(hitGroup);
        } else {
            this.selectBlock(null);
        }
    }

    selectBlock(blockGroup) {
        if (this.selectedBlock && this.selectedBlock !== blockGroup) {
            this._setHighlight(this.selectedBlock, false);
        }

        this.selectedBlock = blockGroup;

        if (this.selectedBlock) {
            this._setHighlight(this.selectedBlock, true);
        }

        if (this.onBlockSelectedCallback) {
            this.onBlockSelectedCallback(this.selectedBlock);
        }
    }

    _setHighlight(group, isHighlighted) {
        group.traverse(child => {
            if (child.isMesh && child.material && (!child.userData || !child.userData.isWatermark)) {
                if (isHighlighted) {
                    child.material.emissive = new THREE.Color(0x0984e3);
                    child.material.emissiveIntensity = 0.35;
                } else {
                    child.material.emissive = new THREE.Color(0x000000);
                    child.material.emissiveIntensity = 0;
                }
            }
        });
    }

    /**
     * Reemplaza un bloque colocado por otro tipo del catálogo, conservando
     * el punto de inserción (extremo inferior derecho) y la orientación.
     * @param {THREE.Group} oldBlock
     * @param {string} newBlockId
     * @returns {THREE.Group|null}
     */
    replaceBlock(oldBlock, newBlockId) {
        const def = getBlockDefinition(newBlockId);
        const idx = this.placedBlocks.indexOf(oldBlock);
        if (!def || idx === -1) return null;

        const newBlock = createBlockMesh(def, false);
        newBlock.position.copy(oldBlock.position);
        newBlock.quaternion.copy(oldBlock.quaternion);

        this.scene.remove(oldBlock);
        this.scene.add(newBlock);
        this.placedBlocks[idx] = newBlock;

        this.selectedBlock = null;
        this.selectBlock(newBlock);

        if (this.onBlocksChangedCallback) {
            this.onBlocksChangedCallback(this.placedBlocks);
        }
        console.log(`[SnapEngine] Bloque reemplazado por: ${def.name}`);
        return newBlock;
    }

    deleteSelectedBlock() {
        if (!this.selectedBlock) return;

        const idx = this.placedBlocks.indexOf(this.selectedBlock);
        if (idx !== -1) {
            this.scene.remove(this.selectedBlock);
            this.placedBlocks.splice(idx, 1);
            this.selectBlock(null);

            if (this.onBlocksChangedCallback) {
                this.onBlocksChangedCallback(this.placedBlocks);
            }
            console.log('[SnapEngine] Bloque eliminado.');
        }
    }

    clearAllBlocks() {
        this._clearPolylineState();
        this.placedBlocks.forEach(b => this.scene.remove(b));
        this.placedBlocks = [];
        this.selectBlock(null);
        if (this.onBlocksChangedCallback) {
            this.onBlocksChangedCallback(this.placedBlocks);
        }
    }

    getPlacedBlocks() {
        return this.placedBlocks;
    }

    /**
     * Mantiene la etiqueta flotante de la polilínea sincronizada al mover la cámara.
     */
    updateOverlayPositions() {
        // Sin etiquetas flotantes en polilínea
    }
}
