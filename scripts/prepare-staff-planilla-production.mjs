// Reconstruct the deployed frontend before overlaying the staff-import feature.
// This does not publish, authenticate, run migrations, or build the final release.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'tmp/staff-planilla-production');
const evidence = join(root, 'output/staff-planilla-qa');
const expectedAsset = '/assets/index-BWcnu6Yd.js';
const expectedSha256 = '91dc9c022b67257028c48da3dc2780d7b6e37d921d1d09bb4eeeac0a19d5b450';
const hash = value => createHash('sha256').update(value).digest('hex');
const git = async args => (await execFile('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout;
const gitFile = (ref, file) => git(['show', `${ref}:${file}`]);
const baseRef = (await git(['rev-parse', '47f0482^{commit}'])).trim();
const deployedOverlayRef = (await git(['rev-parse', '5f11c2b^{commit}'])).trim();
const featureRef = (await git(['rev-parse', 'HEAD^{commit}'])).trim();
const deployedOverlay = [
  'src/App.jsx',
  'src/components/AdminAccountsPanel.jsx',
  'src/components/SuperAdminDashboard.jsx',
  'src/components/AdminDashboard.jsx',
  'src/components/Login.jsx',
  'src/components/Register.jsx',
  'src/components/PrivateRoute.jsx',
  'src/components/RequireAdmin.jsx',
  'src/contexts/AuthContext.jsx',
  'src/services/staffAccountAdmin.js',
  'src/lib/supabase/invokeAuthenticatedFunction.js',
  'src/lib/supabase/firestoreCompat.js',
];
const featureOverlay = [
  'src/components/AdminDashboard.jsx',
  'src/components/StaffPlanillaImport.jsx',
  'src/services/staffPlanillaImport.js',
  'src/services/staffPlanillaImportClient.js',
];
await assert.rejects(access(destination), 'Refusing to overwrite an existing release directory');
await mkdir(join(root, 'tmp'), { recursive: true });
await mkdir(destination);
await mkdir(evidence, { recursive: true });
const manifest = {
  status: 'PREPARING', destination, baseRef, deployedOverlayRef, featureRef,
  expectedAsset, expectedSha256, deployedOverlay, featureOverlay,
  sourceFiles: {}, environmentCopiedWithoutLogging: true, dependenciesSymlinked: true,
  pendingSalesChangesIncluded: false, finalFeatureBuildPerformed: false,
};
const recordSource = async file => { manifest.sourceFiles[file] = hash(await readFile(join(destination, file))); };
try {
  const archive = join(destination, 'source.tar');
  await execFile('git', ['archive', '--format=tar', `--output=${archive}`, baseRef], { cwd: root });
  await execFile('tar', ['-xf', archive, '-C', destination], { cwd: root });
  await unlink(archive);
  await copyFile(join(root, '.env'), join(destination, '.env'));
  await chmod(join(destination, '.env'), 0o600);
  await symlink(join(root, 'node_modules'), join(destination, 'node_modules'), 'dir');
  for (const file of deployedOverlay) {
    await writeFile(join(destination, file), await gitFile(deployedOverlayRef, file));
    await recordSource(file);
  }

  // These are exactly the three replacements in prepare-sales-channel-hotfix.
  // The pending SalesAnalysis/SalesConfig/SuggestiveSales implementations in
  // the working branch are never copied into this production source tree.
  const salesFile = 'src/components/SalesAnalysis.jsx';
  let sales = (await readFile(join(destination, salesFile), 'utf8')).replace(/\r\n/g, '\n');
  const replaceOnce = (before, after) => {
    assert.equal(sales.split(before).length, 2, `Unexpected deployed SalesAnalysis source: ${before.slice(0, 65)}`);
    sales = sales.replace(before, after);
  };
  replaceOnce(`if (dayData.hourlyData) {
                            Object.entries(dayData.hourlyData).forEach(([hourStr, canalData]) => {`, `if (dayData.hourlyData || dayData.hourlyTxs) {
                            const hours = new Set([
                                ...Object.keys(dayData.hourlyData || {}),
                                ...Object.keys(dayData.hourlyTxs || {}),
                            ]);
                            hours.forEach((hourStr) => {
                                const canalData = dayData.hourlyData?.[hourStr] || {};`);
  replaceOnce(`Object.entries(canalData).forEach(([canal, val]) => {`, `const channels = new Set([...Object.keys(canalData), ...Object.keys(dayData.hourlyTxs?.[hourStr] || {})]);
                                channels.forEach((canal) => {
                                    const val = Number(canalData[canal]) || 0;
                                    ['canalesHoras', 'canalesHorasTxs', 'canalesDias', 'canalesDiasTxs', 'canalesHorasPorFecha', 'canalesHorasTxsPorFecha'].forEach((key) => {
                                        agg[key][canal] ||= {};
                                    });`);
  replaceOnce(`const txsVal = dayData.hourlyTxs?.[hourStr]?.[canal] || 0;`, `const txsVal = Number(dayData.hourlyTxs?.[hourStr]?.[canal]) || 0;`);
  await writeFile(join(destination, salesFile), sales);
  await recordSource(salesFile);

  // Fail closed if the baseline cannot reproduce the already deployed bundle.
  const build = await execFile('npm', ['run', 'build'], { cwd: destination, maxBuffer: 16 * 1024 * 1024 });
  await writeFile(join(evidence, 'production-baseline-build.stdout.log'), build.stdout);
  await writeFile(join(evidence, 'production-baseline-build.stderr.log'), build.stderr);
  const html = await readFile(join(destination, 'build/index.html'), 'utf8');
  const actualAsset = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/)?.[1];
  assert.ok(actualAsset?.startsWith('/assets/'), 'Baseline build did not expose an asset script');
  const actualSha256 = hash(await readFile(join(destination, 'build', actualAsset.slice(1))));
  Object.assign(manifest, { actualAsset, actualSha256, baselineMatchesProduction: actualSha256 === expectedSha256 && actualAsset === expectedAsset });
  await writeFile(join(evidence, 'production-baseline-index.html'), html);
  if (!manifest.baselineMatchesProduction) {
    manifest.status = 'BASELINE_MISMATCH';
    await writeFile(join(evidence, 'production-baseline.json'), JSON.stringify(manifest, null, 2) + '\n');
    throw new Error(`Baseline differs from live: ${actualAsset} SHA256=${actualSha256}. Feature overlay was not applied.`);
  }
  manifest.status = 'BASELINE_VERIFIED';
  await writeFile(join(evidence, 'production-baseline.json'), JSON.stringify(manifest, null, 2) + '\n');

  // The dashboard integration must be exactly the import and the component tag.
  const deployedDashboard = (await gitFile(deployedOverlayRef, featureOverlay[0])).replace(/\r\n/g, '\n');
  const featureDashboard = (await gitFile(featureRef, featureOverlay[0])).replace(/\r\n/g, '\n');
  const importLine = "import StaffPlanillaImport from './StaffPlanillaImport';\n";
  const componentLine = '                            <StaffPlanillaImport storeId={userData?.storeId} storeName={storeName} staff={staff} onImported={fetchAllStaffProfiles} />\n';
  assert.equal(featureDashboard.split(importLine).length, 2, 'Unexpected staff import dashboard declaration');
  assert.equal(featureDashboard.split(componentLine).length, 2, 'Unexpected staff import dashboard integration');
  assert.equal(featureDashboard.replace(importLine, '').replace(componentLine, ''), deployedDashboard,
    'Refusing unrelated dashboard changes in the feature overlay');
  const overlayFiles = [];
  for (const file of featureOverlay) {
    const contents = await gitFile(featureRef, file);
    await writeFile(join(destination, file), contents);
    overlayFiles.push({ path: file, sha256: hash(contents) });
  }
  const prepared = { status: 'FEATURE_SOURCE_PREPARED', destination, baselineVerified: true,
    baseRef, deployedOverlayRef, featureRef, featureOverlay: overlayFiles,
    preservedBaselineAsset: actualAsset, preservedBaselineSha256: actualSha256,
    finalBuildPerformed: false, nextStep: 'Preserve prior Hosting assets, then build and verify this isolated release before publishing.' };
  await writeFile(join(evidence, 'production-feature-overlay.json'), JSON.stringify(prepared, null, 2) + '\n');
  console.log(JSON.stringify(prepared, null, 2));
} catch (error) {
  if (error.stdout) await writeFile(join(evidence, 'production-baseline-build.stdout.log'), error.stdout);
  if (error.stderr) await writeFile(join(evidence, 'production-baseline-build.stderr.log'), error.stderr);
  if (manifest.status !== 'BASELINE_MISMATCH') {
    manifest.status = 'PREPARATION_FAILED'; manifest.error = error.message;
    await writeFile(join(evidence, 'production-baseline.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  throw error;
}
