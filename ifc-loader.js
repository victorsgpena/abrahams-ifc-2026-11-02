/**
 * ifc-loader.js
 * Carga y procesamiento de archivos IFC mediante Web-IFC (WebAssembly)
 * Convierte las mallas IFC a geometrías estándar de Three.js.
 */

import { IfcAPI } from '../lib/web-ifc-api.js';

export class IfcLoaderManager {
    constructor() {
        this.ifcAPI = new IfcAPI();
        this.isInitialized = false;
        this.currentModelID = null;
        this.loadedMeshGroup = null;
        this.collidableMeshes = []; // Mallas para raycasting y snapping
        this.modelBounds = new THREE.Box3();
    }

    /**
     * Inicializa el módulo WebAssembly de Web-IFC.
     */
    async init() {
        if (this.isInitialized) return;
        try {
            // Ruta relativa a web-ifc.wasm
            this.ifcAPI.SetWasmPath('./lib/');
            await this.ifcAPI.Init();
            this.isInitialized = true;
            console.log('[IfcLoader] Web-IFC Wasm inicializado correctamente.');
        } catch (err) {
            console.error('[IfcLoader] Error al inicializar Web-IFC:', err);
            throw err;
        }
    }

    /**
     * Carga un archivo IFC desde un ArrayBuffer.
     * @param {ArrayBuffer} buffer Contenido del archivo .ifc
     * @param {Function} onProgress Callback para actualizar la barra de progreso
     * @returns {Promise<THREE.Group>}
     */
    async loadIfcFromBuffer(buffer, onProgress = null) {
        if (!this.isInitialized) {
            await this.init();
        }

        // Limpiar modelo previo de memoria Web-IFC
        if (this.currentModelID !== null) {
            try {
                this.ifcAPI.CloseModel(this.currentModelID);
            } catch (e) {
                console.warn('[IfcLoader] Error cerrando modelo previo:', e);
            }
            this.currentModelID = null;
        }

        const uint8Array = new Uint8Array(buffer);
        console.log(`[IfcLoader] Abriendo modelo IFC (${(uint8Array.byteLength / 1024 / 1024).toFixed(2)} MB)...`);

        if (onProgress) onProgress(15, 'Parsing IFC schema...');

        // Abrir modelo en Web-IFC
        this.currentModelID = this.ifcAPI.OpenModel(uint8Array, {
            COORDINATE_TO_ORIGIN: true,
            USE_FAST_BOOLS: true
        });

        console.log(`[IfcLoader] Modelo IFC abierto con ID: ${this.currentModelID}`);
        if (onProgress) onProgress(35, 'Generating 3D steel meshes...');

        const modelGroup = new THREE.Group();
        modelGroup.name = 'IFC_Model_Root';
        this.collidableMeshes = [];

        // Material metálico para elementos de Steel Framing
        const steelMaterial = new THREE.MeshStandardMaterial({
            color: 0x95a5a6,
            metalness: 0.8,
            roughness: 0.35,
            side: THREE.DoubleSide
        });

        // Material alternativo para placas o elementos genéricos
        const defaultMaterial = new THREE.MeshStandardMaterial({
            color: 0xbdc3c7,
            metalness: 0.3,
            roughness: 0.6,
            side: THREE.DoubleSide
        });

        let meshCount = 0;

        // Transmisión de geometrías desde Web-IFC a Three.js
        this.ifcAPI.StreamAllMeshes(this.currentModelID, (flatMesh) => {
            const placedGeometries = flatMesh.geometries;
            const geomCount = placedGeometries.size();

            for (let i = 0; i < geomCount; i++) {
                const placedGeom = placedGeometries.get(i);
                const geomData = this.ifcAPI.GetGeometry(this.currentModelID, placedGeom.geometryExpressID);

                const vData = this.ifcAPI.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize());
                const iData = this.ifcAPI.GetIndexArray(geomData.GetIndexData(), geomData.GetIndexDataSize());

                if (!vData || vData.length === 0 || !iData || iData.length === 0) continue;

                // Extraer posiciones y normales (6 floats por vértice: x, y, z, nx, ny, nz)
                const vertexCount = vData.length / 6;
                const positions = new Float32Array(vertexCount * 3);
                const normals = new Float32Array(vertexCount * 3);

                for (let v = 0; v < vertexCount; v++) {
                    const srcIdx = v * 6;
                    const dstIdx = v * 3;
                    positions[dstIdx] = vData[srcIdx];
                    positions[dstIdx + 1] = vData[srcIdx + 1];
                    positions[dstIdx + 2] = vData[srcIdx + 2];

                    normals[dstIdx] = vData[srcIdx + 3];
                    normals[dstIdx + 1] = vData[srcIdx + 4];
                    normals[dstIdx + 2] = vData[srcIdx + 5];
                }

                const bufferGeom = new THREE.BufferGeometry();
                bufferGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                bufferGeom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
                bufferGeom.setIndex(new THREE.BufferAttribute(iData, 1));

                // Color proveniente del IFC si está definido
                let mat = steelMaterial;
                if (placedGeom.color && (placedGeom.color.w > 0)) {
                    mat = new THREE.MeshStandardMaterial({
                        color: new THREE.Color(placedGeom.color.x, placedGeom.color.y, placedGeom.color.z),
                        opacity: placedGeom.color.w,
                        transparent: placedGeom.color.w < 1.0,
                        metalness: 0.5,
                        roughness: 0.45,
                        side: THREE.DoubleSide
                    });
                }

                const mesh = new THREE.Mesh(bufferGeom, mat);
                mesh.name = `ifc_elem_${flatMesh.expressID}_${i}`;

                // Aplicar matriz de transformación espacial del elemento
                const matrix = new THREE.Matrix4().fromArray(placedGeom.flatTransformation);
                mesh.applyMatrix4(matrix);

                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData = {
                    isIfcElement: true,
                    expressID: flatMesh.expressID
                };

                modelGroup.add(mesh);
                this.collidableMeshes.push(mesh);
                meshCount++;
            }
        });

        if (onProgress) onProgress(85, 'Computing bounds and orientation...');

        console.log(`[IfcLoader] Generated ${meshCount} 3D elements from IFC.`);

        this.modelBounds.setFromObject(modelGroup);
        const center = new THREE.Vector3();
        this.modelBounds.getCenter(center);

        modelGroup.position.sub(center);

        this.modelBounds.setFromObject(modelGroup);

        this.loadedMeshGroup = modelGroup;

        if (onProgress) onProgress(100, 'IFC model loaded successfully');
        return modelGroup;
    }

    /**
     * Retorna la lista de mallas del IFC activas para raycasting/snapping.
     */
    getCollidableMeshes() {
        return this.collidableMeshes;
    }

    /**
     * Retorna la caja delimitadora (Box3) del modelo cargado.
     */
    getBounds() {
        return this.modelBounds;
    }
}
