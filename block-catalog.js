/**
 * block-catalog.js
 * Definición del catálogo de bloques paramétricos 3D (Paneles Hebel y Perfiles Tophat).
 * Unidades estándar en milímetros (mm) convertidas a metros (m) para la escena 3D.
 */

export const BLOCK_CATALOG = {
    hebel_75: {
        category: 'Hebel 75mm',
        description: 'Autoclaved Aerated Concrete (AAC) panels for exterior cladding and walls.',
        thickness: 75, // mm
        width: 600,    // mm
        color: 0xdedede,
        edgeColor: 0x4a4a4a,
        items: [
            { id: 'hb-75-2280', name: 'Hebel Panel 75 x 600 x 2280', t: 75, w: 600, h: 2280, weightKg: 72 },
            { id: 'hb-75-2400', name: 'Hebel Panel 75 x 600 x 2400', t: 75, w: 600, h: 2400, weightKg: 76 },
            { id: 'hb-75-2550', name: 'Hebel Panel 75 x 600 x 2550', t: 75, w: 600, h: 2550, weightKg: 80 },
            { id: 'hb-75-2700', name: 'Hebel Panel 75 x 600 x 2700', t: 75, w: 600, h: 2700, weightKg: 85 },
            { id: 'hb-75-2850', name: 'Hebel Panel 75 x 600 x 2850', t: 75, w: 600, h: 2850, weightKg: 90 },
            { id: 'hb-75-3000', name: 'Hebel Panel 75 x 600 x 3000', t: 75, w: 600, h: 3000, weightKg: 95 },
            { id: 'hb-75-3300', name: 'Hebel Panel 75 x 600 x 3300', t: 75, w: 600, h: 3300, weightKg: 104 }
        ]
    },
    hebel_50: {
        category: 'PowerPanel 50mm',
        description: '50mm Hebel panels for lightweight cladding, balconies, and partitions.',
        thickness: 50, // mm
        width: 600,    // mm
        color: 0xd2d7db,
        edgeColor: 0x3d4449,
        items: [
            { id: 'hb-50-1800', name: 'Hebel PowerPanel 50 x 600 x 1800', t: 50, w: 600, h: 1800, weightKg: 38 },
            { id: 'hb-50-2400', name: 'Hebel PowerPanel 50 x 600 x 2400', t: 50, w: 600, h: 2400, weightKg: 50 },
            { id: 'hb-50-2700', name: 'Hebel PowerPanel 50 x 600 x 2700', t: 50, w: 600, h: 2700, weightKg: 57 },
            { id: 'hb-50-3000', name: 'Hebel PowerPanel 50 x 600 x 3000', t: 50, w: 600, h: 3000, weightKg: 63 }
        ]
    },
    tophats: {
        category: 'Tophat Profiles',
        description: 'Galvanized steel top-hat battens for facade fixing and ventilation.',
        thickness: 24, // mm (height/depth)
        width: 40,     // mm (base)
        color: 0x487eb0,
        edgeColor: 0x192a56,
        items: [
            { id: 'th-24-40-6000', name: 'Tophat 24mm x 40mm x 6000mm', t: 24, w: 40, h: 6000, weightKg: 4.8 },
            { id: 'th-24-61-6000', name: 'Tophat 24mm x 61mm x 6000mm', t: 24, w: 61, h: 6000, weightKg: 5.6 },
            { id: 'th-35-50-6000', name: 'Tophat 35mm x 50mm x 6000mm', t: 35, w: 50, h: 6000, weightKg: 6.5 }
        ]
    }
};

/**
 * Busca un bloque en el catálogo por su identificador único.
 */
export function getBlockDefinition(itemId) {
    for (const catKey of Object.keys(BLOCK_CATALOG)) {
        const cat = BLOCK_CATALOG[catKey];
        const item = cat.items.find(i => i.id === itemId);
        if (item) {
            return {
                ...item,
                categoryKey: catKey,
                categoryName: cat.category,
                color: cat.color,
                edgeColor: cat.edgeColor
            };
        }
    }
    return null;
}

// Caché de texturas de marca de agua por texto
const watermarkTextureCache = new Map();

/**
 * Genera o recupera de caché la textura y dimensiones 3D para la marca de agua vertical
 * con altura de letra exacta de 300 mm (0.30 m).
 * @param {string} text Texto de la marca de agua (ej. "75 x 2280")
 * @returns {{ texture: THREE.CanvasTexture, planeLengthM: number, planeCrossM: number }}
 */
function getWatermarkData(text) {
    if (watermarkTextureCache.has(text)) {
        return watermarkTextureCache.get(text);
    }

    const fontPx = 220; // Equivale a 300 mm (0.30 m) de altura de letra en el modelo 3D
    const metersPerPx = 0.30 / fontPx;
    const fontSpec = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = fontSpec;
    const textMetrics = measureCtx.measureText(text);

    const padX = 16;
    const canvasW = Math.ceil(textMetrics.width + padX * 2);
    const canvasH = Math.ceil(fontPx * 1.08);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.font = fontSpec;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Borde sutil claro y relleno tipo marca de agua para que sea legible con el bloque al 50% de transparencia
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.strokeText(text, padX, canvasH / 2);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.fillText(text, padX, canvasH / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const data = {
        texture,
        planeLengthM: canvasW * metersPerPx, // Largo del texto a lo largo de la altura del panel
        planeCrossM: canvasH * metersPerPx   // Alto de la letra (300 mm) a lo ancho del panel
    };

    watermarkTextureCache.set(text, data);
    return data;
}

/**
 * Crea una malla 3D de Three.js para un bloque del catálogo con 50% de transparencia y marca de agua vertical.
 * Las dimensiones se convierten de mm a metros (Three.js estándar: 1 unidad = 1 metro).
 * @param {Object} def Definición del bloque
 * @param {boolean} isGhost Si es true, se renderiza para previsualización durante la colocación.
 * @returns {THREE.Group}
 */
export function createBlockMesh(def, isGhost = false) {
    const scale = 0.001; // mm a metros
    const width = (def.w || 600) * scale;
    const height = (def.h || 2400) * scale;
    const thickness = (def.t || 75) * scale;

    const group = new THREE.Group();
    group.name = `block_${def.id}_${Date.now()}`;

    // Geometría con pivote en el EXTREMO INFERIOR DERECHO:
    // X: [-width, 0]       -> El borde derecho está en X = 0
    // Y: [0, height]       -> La base (extremo inferior) está en Y = 0
    // Z: [0, thickness]    -> La cara de apoyo en la pared está en Z = 0
    const geom = new THREE.BoxGeometry(width, height, thickness);
    geom.translate(-width / 2, height / 2, thickness / 2);

    // Material de cara con 50% de transparencia (opacity: 0.5)
    const mat = new THREE.MeshStandardMaterial({
        color: isGhost ? 0x00a8ff : def.color,
        roughness: 0.85,
        metalness: def.categoryKey === 'tophats' ? 0.6 : 0.05,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = !isGhost;
    group.add(mesh);

    // Bordes para visualizar las juntas de modulación de los paneles
    const edgesGeom = new THREE.EdgesGeometry(geom);
    const edgesMat = new THREE.LineBasicMaterial({
        color: isGhost ? 0x00d2d3 : def.edgeColor,
        linewidth: 2,
        transparent: true,
        opacity: isGhost ? 0.85 : 0.9
    });
    const wireframe = new THREE.LineSegments(edgesGeom, edgesMat);
    group.add(wireframe);

    // Indicador visual del punto de snap (punto inferior derecho) durante la colocación
    if (isGhost) {
        const pivotGeom = new THREE.SphereGeometry(0.02, 12, 12);
        const pivotMat = new THREE.MeshBasicMaterial({ color: 0x2ed573 });
        const pivotMesh = new THREE.Mesh(pivotGeom, pivotMat);
        pivotMesh.position.set(0, 0, 0);
        pivotMesh.userData = { isPivotDot: true };
        group.add(pivotMesh);
    }

    // Marca de agua vertical solo para paneles Hebel (los tophats no llevan texto 3D)
    if (def.categoryKey !== 'tophats') {
        const watermarkText = `${def.t} x ${def.h}`;
        const wmData = getWatermarkData(watermarkText);
        const wmGeom = new THREE.PlaneGeometry(wmData.planeLengthM, wmData.planeCrossM);
        const wmMat = new THREE.MeshBasicMaterial({
            map: wmData.texture,
            transparent: true,
            opacity: isGhost ? 0.65 : 0.85,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        // Sangría pegada al extremo donde inicia la letra (margen de 30 mm)
        const startMargin = 0.03;
        const frontY = Math.min(height / 2, startMargin + wmData.planeLengthM / 2);
        const backY = Math.max(height / 2, height - startMargin - wmData.planeLengthM / 2);
        const frontX = width >= wmData.planeCrossM * 1.5 ? -wmData.planeCrossM / 2 : -width / 2;
        const backX = width >= wmData.planeCrossM * 1.5 ? -width + wmData.planeCrossM / 2 : -width / 2;

        // Cara frontal (Z = thickness + 1mm): inicia pegado al extremo inferior
        const wmFront = new THREE.Mesh(wmGeom, wmMat);
        wmFront.position.set(frontX, frontY, thickness + 0.001);
        wmFront.rotation.z = Math.PI / 2;
        wmFront.userData = { isWatermark: true };
        group.add(wmFront);

        // Cara posterior (Z = -1mm): inicia pegado al extremo opuesto (superior)
        const wmBack = new THREE.Mesh(wmGeom, wmMat);
        wmBack.position.set(backX, backY, -0.001);
        wmBack.rotation.set(0, Math.PI, -Math.PI / 2);
        wmBack.userData = { isWatermark: true };
        group.add(wmBack);
    }

    // Metadatos asociados al objeto 3D
    group.userData = {
        isBimBlock: true,
        blockId: def.id,
        name: def.name,
        category: def.categoryName || def.categoryKey,
        thicknessMm: def.t,
        widthMm: def.w,
        heightMm: def.h,
        weightKg: def.weightKg || 0,
        areaM2: ((def.w * def.h) / 1000000).toFixed(3),
        lengthM: (def.h / 1000).toFixed(2),
        createdTimestamp: Date.now()
    };

    return group;
}
