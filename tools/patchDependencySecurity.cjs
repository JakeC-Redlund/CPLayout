'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');

const PACKAGES = Object.freeze({ braces: '3.0.3', 'node-forge': '1.4.0', 'sprintf-js': '1.0.3' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error('Dependency security guard: ' + message); };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
    path.posix.normalize(value) !== value || value.split('/').some(part => !part || part === '.' || part === '..') ||
    path.isAbsolute(value)) fail('invalid relative path: ' + value);
  return value;
}
// Check every component, including directories: a regular final file behind a symlink is unsafe too.
function inspectPath(root, relative, { allowMissing = false, directory = false } = {}) {
  relativePath(relative);
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && allowMissing && i === parts.length - 1) return null;
      throw error;
    }
    if (stat.isSymbolicLink()) fail('symlink path refused: ' + relative);
    if (i < parts.length - 1 || directory) {
      if (!stat.isDirectory()) fail('path is not a directory: ' + relative);
    } else if (!stat.isFile()) fail('target is not a regular file: ' + relative);
  }
  return fs.lstatSync(current);
}
function read(root, relative) {
  inspectPath(root, relative);
  return fs.readFileSync(path.join(root, relative));
}
function json(root, relative) { return JSON.parse(read(root, relative).toString('utf8')); }

function loadManifests(root) {
  return Object.entries(PACKAGES).map(([name, version]) => {
    const stem = `patches/${name}+${version}`;
    const manifest = json(root, stem + '.json');
    if (manifest.schemaVersion !== 1 || manifest.name !== name || manifest.version !== version ||
      manifest.packageRoot !== `node_modules/${name}` || !isHash(manifest.patchSha256) ||
      !Array.isArray(manifest.files) || !manifest.files.length ||
      !Array.isArray(manifest.consumers) || !manifest.consumers.length ||
      !manifest.pins || typeof manifest.pins !== 'object' || Array.isArray(manifest.pins)) fail('invalid manifest: ' + name);
    const patchBytes = read(root, stem + '.patch');
    if (digest(patchBytes) !== manifest.patchSha256) fail('patch digest mismatch: ' + name);
    const entries = new Map();
    for (const [file, hash] of Object.entries(manifest.pins)) {
      relativePath(file);
      if (!isHash(hash)) fail('invalid pin: ' + file);
      entries.set(manifest.packageRoot + '/' + file, { original: hash, patched: hash });
    }
    if (!entries.has(manifest.packageRoot + '/package.json')) fail('package metadata pin missing: ' + name);
    for (const file of manifest.files) {
      relativePath(file.target);
      if (!file.target.startsWith(manifest.packageRoot + '/') || entries.has(file.target) ||
        !(file.original === null || isHash(file.original)) || !isHash(file.patched) || file.original === file.patched) {
        fail('invalid or duplicate patch target: ' + file.target);
      }
      entries.set(file.target, { original: file.original, patched: file.patched });
    }
    for (const consumer of manifest.consumers) relativePath(consumer);
    return { ...manifest, entries, patch: patchBytes.toString('utf8') };
  });
}

// Inventory npm's root/nested packages and workspace node_modules. Package symlinks are
// inspected for consumer resolution, never accepted as guarded package copies.
function inventory(root) {
  const packages = new Map();
  const visited = new Set();
  const visitedModules = new Set();
  function packageDir(dir) {
    const file = path.join(dir, 'package.json');
    if (!fs.existsSync(file)) { modules(path.join(dir, 'node_modules')); return; }
    const real = fs.realpathSync(dir);
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    packages.set(path.relative(root, dir).split(path.sep).join('/'), { dir, real, pkg });
    if (visited.has(real)) return;
    visited.add(real);
    modules(path.join(dir, 'node_modules'));
  }
  function modules(dir) {
    if (!fs.existsSync(dir)) return;
    const real = fs.realpathSync(dir);
    if (visitedModules.has(real)) return;
    visitedModules.add(real);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const target = path.join(dir, entry.name);
      if (entry.name.startsWith('@')) {
        for (const child of fs.readdirSync(target)) packageDir(path.join(target, child));
      } else packageDir(target);
    }
  }
  if (fs.existsSync(path.join(root, 'package.json'))) packageDir(root);
  modules(path.join(root, 'node_modules'));
  for (const parent of ['apps', 'packages']) {
    const dir = path.join(root, parent);
    if (fs.existsSync(dir)) for (const child of fs.readdirSync(dir)) packageDir(path.join(dir, child));
  }
  return packages;
}
function verifyPackages(root, manifests) {
  const installed = inventory(root);
  for (const manifest of manifests) {
    const { name, version, packageRoot } = manifest;
    inspectPath(root, packageRoot, { directory: true });
    const pkg = json(root, packageRoot + '/package.json');
    if (pkg.name !== name || pkg.version !== version) fail('package version mismatch: ' + name);
    const copies = [...installed].filter(([, entry]) => entry.pkg.name === name);
    if (copies.length !== 1 || copies[0][0] !== packageRoot) fail('unexpected installed copies: ' + name);
    const expectedPackage = fs.realpathSync(path.join(root, packageRoot, 'package.json'));
    const main = pkg.main || 'index.js';
    relativePath(main);
    const mainPath = packageRoot + '/' + main;
    if (!manifest.entries.has(mainPath)) fail('main entrypoint is not pinned: ' + name);
    inspectPath(root, mainPath);
    const expectedMain = fs.realpathSync(path.join(root, mainPath));
    const required = new Set(manifest.consumers);
    for (const [relative, entry] of installed) {
      const deps = { ...entry.pkg.dependencies, ...entry.pkg.optionalDependencies, ...entry.pkg.devDependencies, ...entry.pkg.peerDependencies };
      if (!Object.hasOwn(deps, name) && !required.has(relative)) continue;
      if (required.has(relative) && !Object.hasOwn(deps, name)) fail('required consumer no longer declares dependency: ' + relative);
      required.delete(relative);
      const resolver = createRequire(path.join(entry.real, 'package.json'));
      let resolvedPackage, resolvedMain;
      try {
        resolvedPackage = fs.realpathSync(resolver.resolve(name + '/package.json'));
        resolvedMain = fs.realpathSync(resolver.resolve(name));
      } catch (error) { fail('consumer cannot resolve ' + name + ': ' + relative + ': ' + error.message); }
      if (resolvedPackage !== expectedPackage || resolvedMain !== expectedMain) fail('consumer resolves an unguarded dependency: ' + relative);
    }
    if (required.size) fail('required consumer missing: ' + [...required].join(', '));
  }
}
function inspectEntries(root, manifests) {
  return manifests.flatMap(manifest => [...manifest.entries].map(([relative, hashes]) => {
    const stat = inspectPath(root, relative, { allowMissing: hashes.original === null });
    const bytes = stat ? fs.readFileSync(path.join(root, relative)) : null;
    return { relative, ...hashes, bytes, actual: bytes === null ? null : digest(bytes), mode: stat?.mode };
  }));
}

// Minimal, exact unified-diff interpreter. No shell, fuzzy matching, or offsets. Each
// changed/added file must appear once and produce the manifest's exact patched hash.
function materialize(manifest, entries) {
  const lines = manifest.patch.split('\n');
  if (lines.pop() !== '') fail('patch must end with newline: ' + manifest.name);
  const expected = new Map(manifest.files.map(file => [file.target, file]));
  const outputs = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('--- ')) fail('invalid patch header: ' + manifest.name);
    const from = lines[i++].slice(4);
    if (!lines[i]?.startsWith('+++ b/')) fail('invalid destination header: ' + manifest.name);
    const target = lines[i++].slice(6);
    const spec = expected.get(target);
    if (!spec || from !== (spec.original === null ? '/dev/null' : 'a/' + target)) fail('unexpected patch target: ' + target);
    expected.delete(target);
    const entry = entries.find(item => item.relative === target);
    const source = entry.bytes === null ? [] : entry.bytes.toString('utf8').split('\n');
    if (entry.bytes !== null && source.pop() !== '') fail('baseline must end with newline: ' + target);
    const output = [];
    let consumed = 0, hunks = 0;
    while (i < lines.length && !lines[i].startsWith('--- ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[i++]);
      if (!match) fail('invalid patch hunk: ' + target);
      const oldStart = Number(match[1]), oldCount = Number(match[2] ?? 1);
      const newStart = Number(match[3]), newCount = Number(match[4] ?? 1);
      const offset = oldCount === 0 ? oldStart : oldStart - 1;
      if (offset < consumed || offset > source.length) fail('invalid hunk offset: ' + target);
      output.push(...source.slice(consumed, offset)); consumed = offset;
      if ((newCount === 0 ? newStart : newStart - 1) !== output.length) fail('invalid output offset: ' + target);
      let oldSeen = 0, newSeen = 0;
      while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('--- ')) {
        const line = lines[i++];
        const operation = line[0], text = line.slice(1);
        if (![' ', '-', '+'].includes(operation)) fail('unsupported patch content: ' + target);
        if (operation !== '+') {
          if (source[consumed++] !== text) fail('patch context mismatch: ' + target);
          oldSeen++;
        }
        if (operation !== '-') { output.push(text); newSeen++; }
      }
      if (oldSeen !== oldCount || newSeen !== newCount) fail('patch hunk length mismatch: ' + target);
      hunks++;
    }
    if (!hunks) fail('patch has no hunks: ' + target);
    output.push(...source.slice(consumed));
    const bytes = Buffer.from(output.join('\n') + '\n');
    if (digest(bytes) !== spec.patched) fail('patched output digest mismatch: ' + target);
    outputs.push({ ...entry, bytes });
  }
  if (expected.size) fail('manifest target missing from patch: ' + manifest.name);
  return outputs;
}
function install(root, outputs, verifyBeforeCommit) {
  const staged = [], replaced = [];
  try {
    for (const output of outputs) {
      const target = path.join(root, output.relative);
      const temporary = target + '.cplayout-stage-' + randomUUID();
      const backup = target + '.cplayout-backup-' + randomUUID();
      const item = { ...output, target, temporary, backup };
      staged.push(item);
      const fd = fs.openSync(temporary, 'wx', (output.mode ?? 0o644) & 0o777);
      try { fs.writeFileSync(fd, output.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (digest(fs.readFileSync(temporary)) !== output.patched) fail('staged hash mismatch: ' + output.relative);
    }
    verifyBeforeCommit();
    for (const item of staged) {
      // Recheck the final target immediately before each rename as well.
      const stat = inspectPath(root, item.relative, { allowMissing: item.original === null });
      if ((stat ? digest(fs.readFileSync(item.target)) : null) !== item.original) fail('baseline drift before commit: ' + item.relative);
      if (item.original !== null) fs.renameSync(item.target, item.backup);
      replaced.push(item);
      fs.renameSync(item.temporary, item.target);
    }
  } catch (error) {
    // Handled write failures roll back. An interrupted process can leave a partial
    // installation; the next invocation refuses it instead of silently repairing.
    for (const item of replaced.reverse()) {
      if (fs.existsSync(item.target)) fs.unlinkSync(item.target);
      if (item.original !== null) fs.renameSync(item.backup, item.target);
    }
    throw error;
  } finally {
    for (const item of staged) if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
  }
  for (const item of staged) if (fs.existsSync(item.backup)) fs.unlinkSync(item.backup);
}
function patchDependencySecurity(root, { checkOnly = false } = {}) {
  root = fs.realpathSync(root);
  const manifests = loadManifests(root);
  verifyPackages(root, manifests);
  const entries = inspectEntries(root, manifests);
  if (entries.every(entry => entry.actual === entry.patched)) return 'already-installed';
  if (!entries.every(entry => entry.actual === entry.original)) fail('baseline changed or partially patched; refusing to overwrite installed files');
  if (checkOnly) fail('patch is not installed; run npm run patch:dependency-security');
  const outputs = manifests.flatMap(manifest => materialize(manifest, entries));
  install(root, outputs, () => {
    // Manifest, consumers, versions, source pins and patch bytes are checked again
    // after staging and before the first installed source is replaced.
    const current = loadManifests(root);
    if (JSON.stringify(current) !== JSON.stringify(manifests)) fail('manifest drift before commit');
    verifyPackages(root, current);
    if (!inspectEntries(root, current).every(entry => entry.actual === entry.original)) fail('baseline drift before commit');
  });
  verifyDependencySecurity(root);
  return 'installed';
}
function verifyDependencySecurity(root) { return patchDependencySecurity(root, { checkOnly: true }); }
function checkAuditDependencyNodes(root, report) {
  root = fs.realpathSync(root);
  const patches = verifyDependencySecurity(root);
  const lock = json(root, 'package-lock.json');
  if (!lock.packages || !report?.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) fail('invalid audit report or package lock');
  const nodes = new Map();
  for (const [key, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (vulnerability.name !== key || !Array.isArray(vulnerability.nodes) || !vulnerability.nodes.length) fail('invalid audit vulnerability: ' + key);
    for (const node of vulnerability.nodes) {
      relativePath(node);
      if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(node)) fail('invalid audit node: ' + node);
      const pkg = json(root, node + '/package.json');
      const locked = lock.packages[node];
      if (pkg.name !== key || typeof pkg.version !== 'string' || !locked || locked.version !== pkg.version) fail('audit node identity/version mismatch: ' + node);
      const patched = Object.hasOwn(PACKAGES, key);
      if (patched && (node !== 'node_modules/' + key || pkg.version !== PACKAGES[key])) fail('audit node lacks source guard: ' + node);
      nodes.set(node, { path: node, name: pkg.name, version: pkg.version, patched });
    }
  }
  return { patches, nodes: [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
module.exports = { patchDependencySecurity, verifyDependencySecurity, checkAuditDependencyNodes };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) fail('unknown option');
  console.log('Dependency security patches: ' + patchDependencySecurity(path.resolve(__dirname, '..'), { checkOnly: args.includes('--check') }));
}
