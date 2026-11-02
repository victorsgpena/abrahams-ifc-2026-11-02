/**
 * bom-exporter.js
 * Generación de cómputo métrico (Bill of Materials - BOM) y exportación a Excel (.xlsx) y reporte PDF imprimible.
 */

export class BomExporter {
    /**
     * Calcula el resumen estadístico de materiales a partir de los bloques colocados.
     * @param {Array<THREE.Group>} placedBlocks
     * @returns {Object} { summaryRows: Array, totalStats: Object }
     */
    static calculateBom(placedBlocks) {
        const itemMap = new Map();
        let grandTotalUnits = 0;
        let grandTotalArea = 0;
        let grandTotalLength = 0;
        let grandTotalWeight = 0;

        placedBlocks.forEach(group => {
            const ud = group.userData || {};
            const key = ud.blockId || 'unknown';

            if (!itemMap.has(key)) {
                itemMap.set(key, {
                    blockId: key,
                    name: ud.name || 'Component',
                    category: ud.category || 'Misc',
                    thicknessMm: ud.thicknessMm || 0,
                    widthMm: ud.widthMm || 0,
                    heightMm: ud.heightMm || 0,
                    count: 0,
                    totalAreaM2: 0,
                    totalLengthM: 0,
                    totalWeightKg: 0
                });
            }

            const item = itemMap.get(key);
            item.count += 1;
            item.totalAreaM2 += Number(ud.areaM2 || 0);
            item.totalLengthM += Number(ud.lengthM || 0);
            item.totalWeightKg += Number(ud.weightKg || 0);

            grandTotalUnits += 1;
            grandTotalArea += Number(ud.areaM2 || 0);
            grandTotalLength += Number(ud.lengthM || 0);
            grandTotalWeight += Number(ud.weightKg || 0);
        });

        const summaryRows = Array.from(itemMap.values()).map(r => ({
            ...r,
            totalAreaM2: Number(r.totalAreaM2.toFixed(2)),
            totalLengthM: Number(r.totalLengthM.toFixed(2)),
            totalWeightKg: Number(r.totalWeightKg.toFixed(1))
        }));

        // Ordenar por categoría y luego nombre
        summaryRows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

        return {
            summaryRows,
            totalStats: {
                totalUnits: grandTotalUnits,
                totalAreaM2: Number(grandTotalArea.toFixed(2)),
                totalLengthM: Number(grandTotalLength.toFixed(2)),
                totalWeightKg: Number(grandTotalWeight.toFixed(1))
            }
        };
    }

    /**
     * Exporta el desglose completo de materiales a un archivo Excel (.xlsx) usando SheetJS.
     * @param {Array<THREE.Group>} placedBlocks
     * @param {string} projectName
     * @param {string} ifcFileName
     */
    static exportToExcel(placedBlocks, projectName = 'Steel_Hebel_Project', ifcFileName = 'Model.ifc') {
        if (!window.XLSX) {
            alert('Error: XLSX library not available.');
            return;
        }

        const { summaryRows, totalStats } = this.calculateBom(placedBlocks);

        // 1. Summary Sheet (BOM)
        const summaryData = [
            ['BILL OF MATERIALS & QUANTITY TAKEOFF REPORT (BOM)'],
            ['Project:', projectName],
            ['Base IFC Model:', ifcFileName],
            ['Generated At:', new Date().toLocaleString()],
            [],
            ['Category', 'Component Description', 'Thickness (mm)', 'Width (mm)', 'Length/Height (mm)', 'Quantity (Units)', 'Total Area (m²)', 'Total Length (m)', 'Est. Weight (kg)']
        ];

        summaryRows.forEach(row => {
            summaryData.push([
                row.category,
                row.name,
                row.thicknessMm,
                row.widthMm,
                row.heightMm,
                row.count,
                row.totalAreaM2 > 0 ? row.totalAreaM2 : '-',
                row.totalLengthM > 0 ? row.totalLengthM : '-',
                row.totalWeightKg
            ]);
        });

        summaryData.push([]);
        summaryData.push([
            'GRAND TOTALS',
            '',
            '',
            '',
            '',
            totalStats.totalUnits,
            totalStats.totalAreaM2,
            totalStats.totalLengthM,
            totalStats.totalWeightKg
        ]);

        const wb = window.XLSX.utils.book_new();
        const wsSummary = window.XLSX.utils.aoa_to_sheet(summaryData);

        wsSummary['!cols'] = [
            { wch: 22 },
            { wch: 38 },
            { wch: 16 },
            { wch: 14 },
            { wch: 18 },
            { wch: 16 },
            { wch: 16 },
            { wch: 18 },
            { wch: 18 }
        ];

        window.XLSX.utils.book_append_sheet(wb, wsSummary, 'BOM Summary');

        // 2. Individual Pieces Detail Sheet
        const detailData = [
            ['ID', 'Category', 'Description', 'Pos X (m)', 'Pos Y (m)', 'Pos Z (m)', 'Area (m²)', 'Length (m)']
        ];

        placedBlocks.forEach((group, idx) => {
            const ud = group.userData || {};
            detailData.push([
                idx + 1,
                ud.category || '',
                ud.name || '',
                Number(group.position.x.toFixed(3)),
                Number(group.position.y.toFixed(3)),
                Number(group.position.z.toFixed(3)),
                ud.areaM2 || '-',
                ud.lengthM || '-'
            ]);
        });

        const wsDetail = window.XLSX.utils.aoa_to_sheet(detailData);
        wsDetail['!cols'] = [
            { wch: 8 },
            { wch: 22 },
            { wch: 36 },
            { wch: 16 },
            { wch: 16 },
            { wch: 16 },
            { wch: 12 },
            { wch: 12 }
        ];

        window.XLSX.utils.book_append_sheet(wb, wsDetail, 'Itemized List');

        const fileName = `${projectName}_BOM_${Date.now()}.xlsx`;
        window.XLSX.writeFile(wb, fileName);
        console.log(`[BomExporter] Excel generated successfully: ${fileName}`);
    }

    /**
     * Muestra la vista de impresión / PDF en el navegador.
     */
    static printReport(placedBlocks, projectName, ifcFileName) {
        window.print();
    }
}
