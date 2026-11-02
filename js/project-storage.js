/**
 * project-storage.js
 * Serialización y recuperación del estado del proyecto en formato JSON.
 */

import { getBlockDefinition, createBlockMesh } from './block-catalog.js';

export class ProjectStorage {
    /**
     * Exporta el estado actual de los bloques y el modelo a un archivo JSON.
     * @param {Array<THREE.Group>} placedBlocks
     * @param {string} ifcFileName Nombre del archivo IFC asociado
     * @param {string} projectName Nombre del proyecto
     */
    static exportProject(placedBlocks, ifcFileName = 'Modelo.ifc', projectName = 'Proyecto_Steel_Hebel') {
        const blocksData = placedBlocks.map((group, index) => {
            const ud = group.userData || {};
            return {
                id: index + 1,
                blockId: ud.blockId,
                name: ud.name,
                category: ud.category,
                dimensions: {
                    thicknessMm: ud.thicknessMm,
                    widthMm: ud.widthMm,
                    heightMm: ud.heightMm
                },
                position: {
                    x: Number(group.position.x.toFixed(4)),
                    y: Number(group.position.y.toFixed(4)),
                    z: Number(group.position.z.toFixed(4))
                },
                quaternion: {
                    x: Number(group.quaternion.x.toFixed(4)),
                    y: Number(group.quaternion.y.toFixed(4)),
                    z: Number(group.quaternion.z.toFixed(4)),
                    w: Number(group.quaternion.w.toFixed(4))
                },
                metrics: {
                    areaM2: Number(ud.areaM2 || 0),
                    lengthM: Number(ud.lengthM || 0),
                    weightKg: Number(ud.weightKg || 0)
                }
            };
        });

        const projectPayload = {
            format: 'IFC_HEBEL_BIM_PROJECT',
            version: '1.0',
            projectName: projectName,
            savedAt: new Date().toISOString(),
            ifcReferenceFile: ifcFileName,
            stats: {
                totalBlocks: blocksData.length,
                totalAreaM2: Number(blocksData.reduce((acc, b) => acc + (b.metrics.areaM2 || 0), 0).toFixed(2)),
                totalTophatM: Number(blocksData.filter(b => b.category.includes('Tophat')).reduce((acc, b) => acc + (b.metrics.lengthM || 0), 0).toFixed(2))
            },
            blocks: blocksData
        };

        const jsonString = JSON.stringify(projectPayload, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`[ProjectStorage] Proyecto exportado: ${blocksData.length} bloques guardados.`);
    }

    /**
     * Carga y reconstruye los bloques desde un archivo JSON.
     * @param {string|Object} jsonData Contenido JSON
     * @param {THREE.Scene} scene
     * @param {SnapEngine} snapEngine
     * @returns {Object} Metadata del proyecto restaurado
     */
    static importProject(jsonData, scene, snapEngine) {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

        if (!data || !Array.isArray(data.blocks)) {
            throw new Error('Invalid JSON project file format.');
        }

        // Limpiar bloques existentes
        snapEngine.clearAllBlocks();

        let restoredCount = 0;

        data.blocks.forEach(item => {
            const def = getBlockDefinition(item.blockId);
            if (!def) {
                console.warn(`[ProjectStorage] Definición no encontrada para bloque ID: ${item.blockId}`);
                return;
            }

            const mesh = createBlockMesh(def, false);
            mesh.position.set(item.position.x, item.position.y, item.position.z);
            mesh.quaternion.set(item.quaternion.x, item.quaternion.y, item.quaternion.z, item.quaternion.w);

            scene.add(mesh);
            snapEngine.placedBlocks.push(mesh);
            restoredCount++;
        });

        if (snapEngine.onBlocksChangedCallback) {
            snapEngine.onBlocksChangedCallback(snapEngine.placedBlocks);
        }

        console.log(`[ProjectStorage] Proyecto restaurado con éxito: ${restoredCount} bloques reconstruidos.`);
        return data;
    }
}
