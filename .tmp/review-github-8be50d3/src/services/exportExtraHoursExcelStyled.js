// exportExtraHoursExcelStyled.js – una descarga por cada 7 registros (bloques separados)
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

export async function exportExtraHoursExcelStyled(colab, toast) {
    try {
        let response;
        let errorMsg = '';

        try {
            response = await fetch("/templates/Plantilla_Horas_Extras.xlsx");
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        } catch (err) {
            errorMsg += `Intento 1 fallido: ${err.message}. `;
            try {
                response = await fetch("/templates/Plantilla_Horas_Extras");
                if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            } catch (err2) {
                errorMsg += `Intento 2 fallido: ${err2.message}. `;
                try {
                    response = await fetch("/templates/plantilla_horas_extras.xlsx");
                    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
                } catch (err3) {
                    errorMsg += `Intento 3 fallido: ${err3.message}. `;
                    throw new Error(`No se pudo cargar la plantilla. ${errorMsg}`);
                }
            }
        }

        const bufferData = await response.arrayBuffer();

        const {
            registros = [],
            name = "",
            lastName = "",
            dni = "",
            storeName = "",
            sucursal = "",
        } = colab;

        const nombreTienda = storeName || sucursal || "";
        const now = new Date();
        const mesActual = now.toLocaleString("es-PE", { month: "long" });
        const fechaHoy = now.toLocaleDateString('es-PE').replace(/\//g, '.');

        const MAX_REGISTROS_POR_HOJA = 7;
        const totalHojas = Math.ceil(registros.length / MAX_REGISTROS_POR_HOJA);

        if (totalHojas > 10) throw new Error("Demasiados registros. Se permite un máximo de 70 horas extras por exportación.");

        const llenarHoja = (sheet, registrosHoja, hojaNum, totalHojas) => {
            for (let i = 0; i < MAX_REGISTROS_POR_HOJA; i++) {
                const row = sheet.getRow(18 + i);
                row.values = [];
                row.commit();
            }

            sheet.getCell('D10').value = `${name} ${lastName}`;
            sheet.getCell('D11').value = dni;
            sheet.getCell('D12').value = mesActual;
            sheet.getCell('D13').value = nombreTienda;
            if (totalHojas > 1) sheet.getCell('G8').value = `Hoja ${hojaNum + 1} de ${totalHojas}`;

            let totalHoras = 0;
            for (let i = 0; i < registrosHoja.length && i < MAX_REGISTROS_POR_HOJA; i++) {
                const r = registrosHoja[i];
                const row = sheet.getRow(18 + i);
                let duracionHoras = 0;
                if (typeof r.duracion === 'string') {
                    if (r.duracion.includes('h')) {
                        const [h, m] = r.duracion.replace('m', '').split('h').map(s => parseInt(s) || 0);
                        duracionHoras = h + m / 60;
                    } else if (r.duracion.includes(':')) {
                        const [h, m] = r.duracion.split(':').map(Number);
                        duracionHoras = h + m / 60;
                    } else if (!isNaN(Number(r.duracion))) {
                        duracionHoras = parseFloat(r.duracion);
                    }
                } else if (typeof r.duracion === 'number') {
                    duracionHoras = r.duracion;
                }
                totalHoras += duracionHoras;
                row.getCell('C').value = r.fecha;
                row.getCell('D').value = r.actividad || "";
                row.getCell('F').value = r.inicio || "";
                row.getCell('G').value = r.fin || "";
                row.getCell('H').value = duracionHoras.toFixed(2);
                row.commit();
            }

            sheet.getCell('F25').value = "TOTAL:";
            sheet.getCell('F25').font = { bold: true };
            sheet.getCell('F25').alignment = { horizontal: 'right' };
            sheet.getCell('H25').value = totalHoras.toFixed(2);
            sheet.getCell('H25').numFmt = '0.00';
        };

        // Una descarga por bloque
        for (let i = 0; i < totalHojas; i++) {
            const nuevoWorkbook = new ExcelJS.Workbook();
            await nuevoWorkbook.xlsx.load(bufferData);

            const sheet = nuevoWorkbook.getWorksheet(1);

            sheet.model.merges = [...(sheet.model.merges || [])];
            sheet.columns = sheet.columns.map(col => ({ ...col }));

            sheet.eachRow({ includeEmpty: true }, (row, rowIndex) => {
                const tempRow = sheet.getRow(rowIndex);
                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    tempRow.getCell(colNumber).value = cell.value;
                    tempRow.getCell(colNumber).style = cell.style;
                });
                tempRow.height = row.height;
                tempRow.commit();
            });

            const startIdx = i * MAX_REGISTROS_POR_HOJA;
            const endIdx = Math.min(startIdx + MAX_REGISTROS_POR_HOJA, registros.length);
            llenarHoja(sheet, registros.slice(startIdx, endIdx), i, totalHojas);

            const buffer = await nuevoWorkbook.xlsx.writeBuffer();
            const nombreArchivo = `${name}_${lastName}_horas_extras_bloque${i + 1}_${fechaHoy}.xlsx`;
            saveAs(new Blob([buffer]), nombreArchivo);
        }

        return true;
    } catch (err) {
        console.error('Error al exportar Excel:', err);
        toast.error(`Error en exportación: ${err.message}`);
        return false;
    }
}