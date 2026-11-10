// Exercise the real sales RPC and metadata migration against disposable SQL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PGLITE_MODULE || '../tmp/competition-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const { PGlite } = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const db = new PGlite();
const store = '00000000-0000-4000-8000-000000000001';
try {
    await db.exec(`create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function private.can_manage_sales(p_store uuid) returns boolean language sql stable as $$select p_store::text=current_setting('qa.store_id',true)$$;
      create function private.sales_hour_map_is_valid(jsonb,boolean) returns boolean language sql immutable as $$select true$$;
      create function private.sales_hour_from_key(text) returns smallint language sql immutable as $$select $1::smallint$$;
      create function private.sales_hour_map_total(jsonb) returns numeric language sql immutable as $$select coalesce(sum((channel.value::text)::numeric),0) from jsonb_each($1) hour cross join lateral jsonb_each(hour.value) channel$$;
      create function private.sales_hour_map_rounded_total(jsonb) returns numeric language sql immutable as $$select round(private.sales_hour_map_total($1),2)$$;
      create table stores(id uuid primary key);
      create table sales_daily_history(store_id uuid, sales_date date, sales_amount numeric(14,2), transactions integer,
        hourly_data jsonb,hourly_transactions jsonb,suggestive_products jsonb,source_data jsonb,updated_at timestamptz,
        primary key(store_id,sales_date));
      insert into stores values('${store}');
      select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',false);
      select set_config('qa.store_id','${store}',false);`);
    await db.exec(await readFile('supabase/migrations/20260911150241_persist_suggestive_products_atomically.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/20261019200244_sales_business_day_metadata.sql', 'utf8'));
    const save = days => db.query('select public.save_sales_history_batch($1,$2)', [store, JSON.stringify(days)]);
    const business = { date: '2026-10-12', totalSales: 100, totalTxs: 1,
        hourlyData: { 0: { 'SALÓN': 100 } }, hourlyTxs: { 0: { 'SALÓN': 1 } },
        businessDateVersion: 1, salesDayBasis: 'business-06:00',
        productSalesRecorded: true, productRevenueRecorded: true,
        productSales: [{ name: 'NOMBRE EXACTO DEL REPORTE', hour: 0, channel: 'SERV. AUTO', quantity: 3, revenue: 29.9 }] };
    const legacy = { date: '2026-10-13', totalSales: 200, totalTxs: 1,
        hourlyData: { 12: { 'SALÓN': 200 } }, hourlyTxs: { 12: { 'SALÓN': 1 } } };
    await save([business, legacy]);
    let rows = (await db.query('select * from sales_daily_history order by sales_date')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].source_data.businessDateVersion, 1);
    assert.equal(rows[0].source_data.salesDayBasis, 'business-06:00');
    assert.equal(rows[0].source_data.hourlyData[0]['SALÓN'], 100);
    assert.equal(rows[0].source_data.productSalesRecorded, true);
    assert.equal(rows[0].source_data.productRevenueRecorded, true);
    assert.deepEqual(rows[0].source_data.productSales, business.productSales);
    assert.equal(rows[1].source_data.salesDayBasis, 'unknown');
    // Reimport replaces the same business date, preserving other saved dates.
    await save([business]);
    assert.equal((await db.query('select count(*)::int as count from sales_daily_history')).rows[0].count, 2);
    await assert.rejects(save([{ ...business, businessDateVersion: 2 }]), /Unsupported sales business-date/);
    await assert.rejects(save([{ ...business, salesDayBasis: 'calendar' }]), /Unsupported sales business-date/);
    for (const invalid of [
        { productSalesRecorded: 'true' }, { productSales: {} },
        { productRevenueRecorded: 'true' },
        { productSales: [{ name: 'PRODUCTO', hour: 0, channel: 'SALÓN', quantity: 3 }] },
        { productSales: [{ name: 'PRODUCTO', hour: 0, channel: 'SALÓN', quantity: 3, revenue: '29.9' }] },
        { productSales: [{ name: 'PRODUCTO', hour: 0, channel: 'SALÓN', quantity: 3, revenue: -1 }] },
        { productSales: [{ name: '', hour: 0, channel: 'SALÓN', quantity: 3 }] },
        { productSales: [{ name: 'PRODUCTO', hour: 24, channel: 'SALÓN', quantity: 3 }] },
        { productSales: [{ name: 'PRODUCTO', hour: 0, channel: 'SALÓN', quantity: -1 }] },
        { productSales: [{ name: 'PRODUCTO', hour: '0', channel: 'SALÓN', quantity: 3 }] },
        { productSales: [{ name: 'PRODUCTO', hour: 0, channel: 'SALÓN', quantity: '3' }] },
    ]) await assert.rejects(save([{ ...business, ...invalid }]), /productSales|productRevenue|exact product|verified product/i);
    rows = (await db.query('select * from sales_daily_history order by sales_date')).rows;
    assert.equal(rows[0].source_data.businessDateVersion, 1);
    assert.equal(Number(rows[1].sales_amount), 200);
    await save([{ ...business, productSalesRecorded: false }]);
    const revenueWithoutQuantities = (await db.query('select source_data from sales_daily_history where sales_date=$1', ['2026-10-12'])).rows[0].source_data;
    assert.equal(revenueWithoutQuantities.productSalesRecorded, false);
    assert.equal(revenueWithoutQuantities.productRevenueRecorded, true);
    const { productSales, productSalesRecorded, productRevenueRecorded, ...olderClient } = business;
    await save([olderClient]);
    const legacyUpdate = (await db.query('select source_data from sales_daily_history where sales_date=$1', ['2026-10-12'])).rows[0].source_data;
    assert.equal(legacyUpdate.productSalesRecorded, false, 'An older importer cannot leave stale verified product counts behind');
    assert.equal(legacyUpdate.productRevenueRecorded, false);
    assert.deepEqual(legacyUpdate.productSales, []);
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(save([business]), /Authentication required/);
    assert.equal((await db.query("select prosecdef from pg_proc where oid='public.save_sales_history_batch(uuid,jsonb)'::regprocedure")).rows[0].prosecdef, false);
    console.log('PASS: real sales RPC preserves 06:00 and exact product detail, clears stale counts for older clients, validates data and retains invoker/auth guard');
} finally {
    await db.close();
}
