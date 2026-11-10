// Reproduce the last isolated release, then optionally overlay only staff permissions UI.
// Default: verify baseline. --overlay: apply reviewed source, without publishing.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, cp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'tmp/projection-store-production');
const destination = join(root, 'tmp/staff-permissions-production');
const evidence = join(root, 'output/staff-permissions-qa');
const manifestPath = join(evidence, 'production-source.json');
const origin = 'https://lc-scheduler.web.app';
const expectedAsset = '/assets/index-CUfR8ox3.js';
const expectedSha256 = '03863731209b89d952703f140b04b62a680ebd86261c2dcd2a98d078abfffca2';
const overlay = [
  'src/components/AdminDashboard.jsx',
  'src/components/SuperAdminDashboard.jsx',
  'src/services/staffAccountAdmin.js',
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
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--overlay'), 'Usage: node scripts/prepare-staff-permissions-production.mjs [--overlay]');

async function sourceHashes(directory) {
  const hashes = {};
  async function visit(path) {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
    } else {
      hashes[relative(directory, path)] = hash(await readFile(path));
    }
  }
  for (const entry of entries) await visit(join(directory, entry));
  return hashes;
}

async function verifyLive() {
  // urllib uses the inherited HTTPS proxy and CA trust. No credentials involved.
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
  assert.equal(live.sha256, expectedSha256, 'Published module SHA differs from verified projection-store release');
  return live;
}

async function retainVerifiedAssets() {
  const release = await readJson(join(root, 'output/projection-store-qa/release-verification.json'));
  assert.equal(release.status, 'PASS');
  const retained = new Map();
  for (const asset of release.assets) {
    assert.match(asset.path, /^(?:\/assets\/[^/]+|\/vite\.svg)$/);
    assert.match(asset.sha256, /^[0-9a-f]{64}$/);
    const from = join(source, 'build', asset.path.slice(1));
    const content = await readFile(from);
    assert.equal(hash(content), asset.sha256, `Prior public asset mismatch: ${asset.path}`);
    const target = join(destination, 'build', asset.path.slice(1));
    await mkdir(dirname(target), { recursive: true });
    try {
      const existing = await readFile(target);
      assert.equal(hash(existing), asset.sha256, `Refusing asset overwrite: ${asset.path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await copyFile(from, target);
    }
    retained.set(asset.path, { path: asset.path, sha256: asset.sha256 });
  }
  return [...retained.values()];
}

await mkdir(evidence, { recursive: true });
if (args[0] === '--overlay') {
  const manifest = await readJson(manifestPath);
  assert.equal(manifest.status, 'BASELINE_VERIFIED', 'Prepare a clean verified baseline before applying the overlay');
  assert.equal(manifest.destination, destination);
  manifest.live = await verifyLive();
  assert.deepEqual(await sourceHashes(destination), manifest.baselineSourceFiles, 'Prepared baseline was modified');
  const changed = [];
  for (const path of overlay) {
    const contents = await readFile(join(root, path));
    await writeFile(join(destination, path), contents);
    changed.push({ path, sha256: hash(contents) });
  }
  const after = await sourceHashes(destination);
  const actualChanges = Object.keys(after).filter(path => after[path] !== manifest.baselineSourceFiles[path]);
  assert.ok(actualChanges.every(path => overlay.includes(path)), 'Unrelated source changed');
  assert.ok(actualChanges.length > 0, 'Staff permissions source is unchanged; no fix was overlaid');
  const protectedFiles = [
    'src/components/ScheduleHeatmapMatrix.jsx',
    'src/components/AvailableHeatmapMatrix.jsx',
    'src/components/WeeklyScheduleEditor.jsx',
    'src/components/ScheduleProjectionDashboard.jsx',
    'src/components/ScheduleProjectionPage.jsx',
  ];
  for (const path of protectedFiles) {
    assert.equal(after[path], manifest.baselineSourceFiles[path], `Protected component changed: ${path}`);
  }
  Object.assign(manifest, {
    status: 'STAFF_PERMISSIONS_SOURCE_PREPARED', overlay: changed, actualChanges,
    heatmapsScheduleEditorAndProjectionUnchanged: true,
    finalBuildPerformed: false, published: false,
  });
  await writeJson(manifestPath, manifest);
  console.log(JSON.stringify({ status: manifest.status, destination, actualChanges, published: false }, null, 2));
} else {
  await assert.rejects(access(destination), 'Refusing to overwrite an existing isolated release directory');
  const release = await readJson(join(root, 'output/projection-store-qa/release-verification.json'));
  assert.equal(release.status, 'PASS');
  assert.equal(release.main, expectedAsset);
  const live = await verifyLive();
  await mkdir(destination, { mode: 0o700 });
  for (const entry of entries) {
    await mkdir(dirname(join(destination, entry)), { recursive: true });
    await cp(join(source, entry), join(destination, entry), { recursive: true });
  }
  // Build-only configuration stays in the private temporary tree, never output/.
  await copyFile(join(source, '.env'), join(destination, '.env'));
  await chmod(join(destination, '.env'), 0o600);
  await symlink(join(root, 'node_modules'), join(destination, 'node_modules'), 'dir');
  const baselineSourceFiles = await sourceHashes(destination);
  const manifest = {
    status: 'BASELINE_PREPARING', source, destination, live, expectedAsset, expectedSha256,
    baselineSourceFiles, overlayAllowed: overlay, secretsWrittenToEvidence: false,
    pendingSalesChangesIncluded: false, published: false,
  };
  await writeJson(manifestPath, manifest);
  try {
    await execFile('npm', ['run', 'build'], { cwd: destination, maxBuffer: 16 * 1024 * 1024 });
    const html = await readFile(join(destination, 'build/index.html'), 'utf8');
    const actualAsset = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/)?.[1];
    assert.equal(actualAsset, expectedAsset, 'Isolated source does not reproduce the published bundle filename');
    const actualSha256 = hash(await readFile(join(destination, 'build', actualAsset.slice(1))));
    assert.equal(actualSha256, expectedSha256, 'Isolated source does not reproduce the published bundle content');
    const retainedAssets = await retainVerifiedAssets();
    Object.assign(manifest, {
      status: 'BASELINE_VERIFIED', actualAsset, actualSha256,
      retainedAssets, baselineMatchesProduction: true, overlayApplied: false,
    });
    await writeJson(manifestPath, manifest);
    console.log(JSON.stringify({ status: manifest.status, destination, actualAsset, actualSha256,
      retainedAssets: retainedAssets.length, overlayApplied: false, published: false }, null, 2));
  } catch (error) {
    manifest.status = 'BASELINE_FAILED';
    manifest.error = error.message;
    await writeJson(manifestPath, manifest);
    throw error;
  }
}
