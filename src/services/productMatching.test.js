import test from 'node:test';
import assert from 'node:assert/strict';
import { importSalesRows, normalizeSalesBusinessDates } from './salesImport.js';
import { mapSalesHistoryRow, salesHistoryDayPayload } from '../lib/supabase/salesHistoryCompat.js';
import { countExactReportedProduct, hasExactReportedProduct, getReportedProductNames } from './productMatching.js';

const row = (id, name, quantity, channel = 'EN LOCAL') => ({ Pedido: `p${id}`, Documento: `B1-${id}`,
    FechaPedido: '2026-10-18 10:00:00', EstadoPedido: 'FACTURADO', EstadoItem: 'Pagado',
    Item: 1, Producto: name, Cantidad: quantity, CANAL: channel, Total: 29.9 * (quantity || 1) });

test('verifica el nombre literal del reporte y mantiene distintos los cuatro canales', () => {
    const day = importSalesRows([
        row(1, 'LTO BORDE QUESO PEPPE', 2),
        row(2, 'LTO BORDE QUESO PEPPE', 3, 'DRIVE THRU'),
        row(3, 'LTO BORDE QUESO PEPPE', 4, 'SERV. FILA'),
        row(4, 'LTO BORDE QUESO PEPPE', 5, 'SERV. AUTO'),
        row(5, 'LTO BORDE QUESO PEPPE', 10, 'DELIVERY'),
        row(6, 'LTO BORDE QUESO PEPPE EXTRA', 8),
        row(7, 'Lto Borde Queso Peppe', 9),
    ]).days.get('2026-10-18');
    assert.equal(day.productSalesRecorded, true);
    assert.equal(countExactReportedProduct(day, 'LTO BORDE QUESO PEPPE'), 14);
    assert.equal(countExactReportedProduct(day, 'LTO BORDE QUESO PEPPE', ['SERV. AUTO']), 5);
    assert.equal(countExactReportedProduct(day, 'LTO BORDE QUESO PEPPE', ['DRIVE THRU']), 3);
    assert.equal(countExactReportedProduct(day, 'LTO BORDE QUESO PEPPE', ['MÓDULO']), 4);
    assert.equal(countExactReportedProduct(day, 'LTO BORDE QUESO PEPPE EXTRA'), 8);
    assert.equal(countExactReportedProduct(day, 'Lto Borde Queso Peppe'), 9);
    assert.equal(countExactReportedProduct(day, 'Borde de queso'), 0);
    assert.deepEqual(getReportedProductNames([day]), ['Lto Borde Queso Peppe', 'LTO BORDE QUESO PEPPE', 'LTO BORDE QUESO PEPPE EXTRA'].sort((a,b)=>a.localeCompare(b,'es')));
});

test('distingue cero verificado de un reporte antiguo o incompleto sin cantidades', () => {
    const complete = importSalesRows([row(1, 'OTRO PRODUCTO', 2)]).days.get('2026-10-18');
    assert.equal(hasExactReportedProduct(complete, 'PRODUCTO ELEGIDO'), true);
    assert.equal(countExactReportedProduct(complete, 'PRODUCTO ELEGIDO'), 0);
    const incomplete = importSalesRows([row(1, 'PRODUCTO ELEGIDO', '')]).days.get('2026-10-18');
    assert.equal(incomplete.productSalesRecorded, false);
    assert.equal(countExactReportedProduct(incomplete, 'PRODUCTO ELEGIDO'), null);
    assert.equal(countExactReportedProduct({ suggestiveProducts: { cheeseBorder: { 10: { SALÓN: 999 } } } }, 'Borde de queso'), null);
});

test('guardar y recargar conserva nombres exactos, cantidades y canales para verificar', () => {
    const day = importSalesRows([row(1, '  PROMO ÁREA #1  ', 2, 'SERV. AUTO')]).days.get('2026-10-18');
    const payload = salesHistoryDayPayload('2026-10-18', day);
    const reloaded = mapSalesHistoryRow({ sales_date: payload.date, source_data: payload });
    assert.equal(countExactReportedProduct(reloaded, 'PROMO ÁREA #1', ['SERV. AUTO']), 2);
    assert.equal(countExactReportedProduct(reloaded, 'PROMO AREA #1', ['SERV. AUTO']), 0);
    assert.equal(countExactReportedProduct(reloaded, 'PROMO ÁREA #1', ['DRIVE THRU']), 0);
    assert.equal(countExactReportedProduct(mapSalesHistoryRow({ source_data: {} }), 'PROMO ÁREA #1'), null);
});

test('la madrugada y una conversión explícita trasladan también los productos exactos una sola vez', () => {
    const day = importSalesRows([{ ...row(1, 'PRODUCTO EXACTO', 2), FechaPedido: '2026-10-19 01:00:00' }]).days.get('2026-10-18');
    assert.equal(countExactReportedProduct(day, 'PRODUCTO EXACTO'), 2);
    const calendar = { '2026-10-19': { ...day, salesDayBasis: 'calendar', businessDateVersion: 0 } };
    const normalized = normalizeSalesBusinessDates(calendar);
    assert.equal(countExactReportedProduct(normalized.get('2026-10-18'), 'PRODUCTO EXACTO'), 2);
    assert.deepEqual(normalizeSalesBusinessDates(normalized), normalized);
    assert.equal(calendar['2026-10-19'].productSales[0].hour, 1);
});
