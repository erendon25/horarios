// Reproduce live Hosting, then overlay only the approved Focus, coverage lookup, and operational HH changes.
// Both modes build in a private temporary tree. This helper never publishes.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, cp, lstat, mkdir, open, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'tmp/approved-shift-modal-production');
const destination = join(root, 'tmp/focus-coverage-production');
const evidence = join(root, 'output/focus-coverage-production-qa');
const manifestPath = join(evidence, 'production-source.json');
const previousReleasePath = join(root, 'output/approved-shift-modal-qa/release-verification.json');
const origin = 'https://lc-scheduler.web.app';
const expectedAsset = '/assets/index-ABqRtTA0.js';
const expectedSha256 = 'af0b0286e158a45eadd724be7a2ae31268a65c222b0dcd6613efaf2d54d938e2';
const overlay = [
  'src/components/WeeklyScheduleEditor.jsx',
  'src/components/ScheduleHeatmapMatrix.jsx',
  'src/components/ScheduleFocusToolbar.jsx',
  'src/components/ScheduleFocusStaffPanel.jsx',
  'src/components/ScheduleFocusShiftEditor.jsx',
  'src/components/HeatmapCoverageCandidatesDialog.jsx',
  'src/services/heatmapCoverageCandidates.js',
  'src/services/heatmapModel.js',
  'src/components/ScheduleProjectionDashboard.jsx',
  'src/services/projectionVhl.js',
  'src/services/projectionLabor.js',
];
const entries = [
  'src', 'public', 'package.json', 'package-lock.json', 'index.html',
  'vite.config.js', 'tailwind.config.js', 'postcss.config.js',
  'firebase.json', '.firebaserc', 'scripts/verify-env.mjs',
];
const hash = value => createHash('sha256').update(value).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--overlay'),
  'Usage: node scripts/prepare-focus-coverage-production.mjs [--overlay]');

async function sourceHashes(directory) {
  const hashes = {};
  async function visit(path) {
    const info = await lstat(path);
    assert.ok(!info.isSymbolicLink(), `Unexpected source symlink: ${relative(directory, path)}`);
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
    } else {
      assert.ok(info.isFile(), `Unexpected source entry: ${relative(directory, path)}`);
      hashes[relative(directory, path)] = hash(await readFile(path));
    }
  }
  for (const entry of entries) await visit(join(directory, entry));
  return hashes;
}

async function verifyLive() {
  // Public read only, with inherited proxy/CA configuration and no credentials.
  const program = `import hashlib, json, re, urllib.request
origin = ${JSON.stringify(origin)}
expected = ${JSON.stringify(expectedAsset)}
def fetch(path):
 request = urllib.request.Request(origin + path, headers={'Cache-Control':'no-cache'})
 with urllib.request.urlopen(request, timeout=45) as response:
  assert response.geturl().startswith(origin + '/'), 'Unexpected redirect'
  return response.read(), response.headers.get('Content-Type','')
html, _ = fetch('/admin')
match = re.search(rb'<script\\b[^>]*\\bsrc=[\"\\\']([^\"\\\']+)[\"\\\']', html)
assert match, 'No production module found'
asset = match.group(1).decode()
assert asset == expected, 'Published release changed: ' + asset
body, mime = fetch(asset)
assert 'javascript' in mime, 'Invalid production JavaScript MIME'
print(json.dumps({'asset':asset,'sha256':hashlib.sha256(body).hexdigest(),'mime':mime}))
`;
  const { stdout } = await execFile('python3', ['-c', program], { cwd: root, maxBuffer: 4096 });
  const live = JSON.parse(stdout);
  assert.equal(live.sha256, expectedSha256, 'Live bundle differs from the verified approved-shift-modal release');
  return live;
}

async function verifiedPreviousRelease() {
  const release = await readJson(previousReleasePath);
  assert.equal(release.status, 'PASS');
  assert.equal(release.main, expectedAsset);
  assert.equal(release.assets.length, 126, 'Unexpected prior public asset count');
  assert.equal(new Set(release.assets.map(asset => asset.path)).size, 126);
  return release;
}

async function retainVerifiedAssets() {
  const release = await verifiedPreviousRelease();
  const retained = [];
  for (const asset of release.assets) {
    assert.match(asset.path, /^(?:\/(?:assets|images|templates)\/[^/]+|\/vite\.svg)$/);
    assert.match(asset.sha256, /^[0-9a-f]{64}$/);
    const from = join(source, 'build', asset.path.slice(1));
    const content = await readFile(from);
    assert.equal(hash(content), asset.sha256, `Prior public asset mismatch: ${asset.path}`);
    const target = join(destination, 'build', asset.path.slice(1));
    await mkdir(dirname(target), { recursive: true });
    try {
      assert.equal(hash(await readFile(target)), asset.sha256, `Refusing asset overwrite: ${asset.path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await copyFile(from, target);
    }
    retained.push({ path: asset.path, sha256: asset.sha256, bytes: content.length });
  }
  return retained;
}

async function copyPrivateBuildEnvironment() {
  const from = await open(join(source, '.env'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assert.ok((await from.stat()).isFile(), 'Expected a regular private build environment');
    const to = await open(join(destination, '.env'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await to.writeFile(await from.readFile()); } finally { await to.close(); }
  } finally { await from.close(); }
  await chmod(join(destination, '.env'), 0o600);
  assert.equal((await lstat(join(destination, '.env'))).mode & 0o777, 0o600);
}

async function buildIsolated() {
  await execFile('npm', ['run', 'build'], { cwd: destination, maxBuffer: 16 * 1024 * 1024 });
  const html = await readFile(join(destination, 'build/index.html'), 'utf8');
  const main = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/)?.[1];
  assert.match(main || '', /^\/assets\/index-[^/]+\.js$/);
  return { main, sha256: hash(await readFile(join(destination, 'build', main.slice(1)))), htmlSha256: hash(html) };
}

async function publicBuildAssets() {
  const assets = [];
  const directory = join(destination, 'build');
  async function visit(path) {
    const info = await lstat(path);
    assert.ok(!info.isSymbolicLink(), 'Build assets must be regular files');
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
    } else {
      const assetPath = '/' + relative(directory, path);
      // Hosting ignores its own configuration filename; fetching this path
      // reaches the SPA rewrite rather than a verifiable public asset.
      if (assetPath === '/index.html' || assetPath === '/firebase.json') return;
      assert.ok(!/(?:^|\/)\.(?:env|git)/.test(assetPath), 'Private data in public build');
      const content = await readFile(path);
      assets.push({ path: assetPath, sha256: hash(content), bytes: content.length });
    }
  }
  await visit(directory);
  return assets;
}

const rootBuildBefore = hash(await readFile(join(root, 'build/index.html')));
await mkdir(evidence, { recursive: true });
if (args.length) {
  const manifest = await readJson(manifestPath);
  assert.equal(manifest.status, 'BASELINE_VERIFIED', 'Create a verified baseline before overlay');
  assert.equal(manifest.destination, destination);
  manifest.live = await verifyLive();
  assert.deepEqual(await sourceHashes(destination), manifest.baselineSourceFiles, 'Prepared baseline was modified');
  const copied = [];
  for (const path of overlay) {
    const content = await readFile(join(root, path));
    assert.ok(!/qa-admin|qa-store|BUK_QA_|bukQaWrites|__weeklyFocusPreview|\/qa-document|\/qa-events|\/qa-collection|schedule-focus-qa-fixture/.test(content.toString('utf8')),
      `Preview transport or fixture leaked into product source: ${path}`);
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await writeFile(join(destination, path), content);
    copied.push({ path, sha256: hash(content) });
  }
  const after = await sourceHashes(destination);
  const actualChanges = Object.keys(after).filter(path => after[path] !== manifest.baselineSourceFiles[path]);
  assert.ok(actualChanges.length > 0);
  assert.ok(actualChanges.every(path => overlay.includes(path)), 'Unrelated source changed');
  const protectedSourceFiles = Object.fromEntries(Object.entries(manifest.baselineSourceFiles).filter(([path]) => !overlay.includes(path)));
  for (const [path, digest] of Object.entries(protectedSourceFiles)) assert.equal(after[path], digest, `Protected source changed: ${path}`);
  const build = await buildIsolated();
  assert.notEqual(build.main, expectedAsset, 'Focus/coverage changes did not create a new main module');
  const retainedAssets = await retainVerifiedAssets();
  assert.deepEqual(await sourceHashes(destination), after, 'Build modified frontend source');
  assert.equal(hash(await readFile(join(root, 'build/index.html'))), rootBuildBefore, 'Root build was modified');
  Object.assign(manifest, { status: 'FOCUS_COVERAGE_BUILD_PREPARED', overlay: copied, actualChanges,
    overlayAllowed: overlay, requestAuthBukPoliciesAndUnrelatedSalesSourcesUnchanged: true,
    previewTransportsAndFixturesExcluded: true,
    protectedSourceFiles, protectedSourcesUnchanged: true, retainedAssets,
    build, finalBuildPerformed: true, rootBuildIndexUnchanged: true,
    rootBuildIndexSha256: rootBuildBefore, backendAppliedByHelper: false, published: false });
  await writeJson(manifestPath, manifest);
  const assets = await publicBuildAssets();
  await writeJson(join(evidence, 'production-build.json'), { status: 'BUILD_VERIFIED', destination, ...build,
    retainedAssetsVerified: retainedAssets.length, assetsVerified: assets.length, assets,
    hostingIgnoredFiles: ['/firebase.json'],
    overlay: copied, actualChanges, protectedSourcesUnchanged: true, pendingSalesChangesIncluded: false,
    rootBuildIndexUnchanged: true, published: false });
  console.log(JSON.stringify({ status: manifest.status, destination, ...build, actualChanges,
    retainedAssets: retainedAssets.length, publicAssets: assets.length, protectedSourcesUnchanged: true, published: false }, null, 2));
} else {
  await assert.rejects(access(destination), 'Refusing to overwrite an existing isolated release');
  await verifiedPreviousRelease();
  const live = await verifyLive();
  await mkdir(destination, { mode: 0o700 });
  for (const entry of entries) {
    await mkdir(dirname(join(destination, entry)), { recursive: true });
    await cp(join(source, entry), join(destination, entry), { recursive: true });
  }
  await copyPrivateBuildEnvironment();
  await symlink(join(root, 'node_modules'), join(destination, 'node_modules'), 'dir');
  const baselineSourceFiles = await sourceHashes(destination);
  const manifest = { status: 'BASELINE_PREPARING', source, destination, live, expectedAsset, expectedSha256,
    baselineSourceFiles, overlayAllowed: overlay, secretsWrittenToEvidence: false,
    pendingSalesChangesIncluded: false, backendAppliedByHelper: false, published: false };
  await writeJson(manifestPath, manifest);
  try {
    const build = await buildIsolated();
    assert.equal(build.main, expectedAsset, 'Baseline filename does not reproduce live Hosting');
    assert.equal(build.sha256, expectedSha256, 'Baseline content does not reproduce live Hosting');
    const retainedAssets = await retainVerifiedAssets();
    assert.equal(hash(await readFile(join(root, 'build/index.html'))), rootBuildBefore, 'Root build was modified');
    Object.assign(manifest, { status: 'BASELINE_VERIFIED', build, retainedAssets,
      baselineMatchesProduction: true, overlayApplied: false, rootBuildIndexUnchanged: true,
      rootBuildIndexSha256: rootBuildBefore });
    await writeJson(manifestPath, manifest);
    console.log(JSON.stringify({ status: manifest.status, destination, ...build,
      retainedAssets: retainedAssets.length, overlayApplied: false, published: false }, null, 2));
  } catch (error) {
    manifest.status = 'BASELINE_FAILED'; manifest.error = error.message;
    await writeJson(manifestPath, manifest); throw error;
  }
}
