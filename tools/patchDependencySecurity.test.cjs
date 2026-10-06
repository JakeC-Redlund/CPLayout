'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { patchDependencySecurity, verifyDependencySecurity, checkAuditDependencyNodes } = require('./patchDependencySecurity.cjs');
const repo = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t, { realSources = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cplayout-dependency-guard-impl-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  };
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const manifests = [];
  for (const [name, version] of [['braces', '3.0.3'], ['node-forge', '1.4.0'], ['sprintf-js', '1.0.3']]) {
    const stem = `patches/${name}+${version}`, packageRoot = 'node_modules/' + name;
    let manifest;
    if (realSources) {
      manifest = JSON.parse(fs.readFileSync(path.join(repo, stem + '.json')));
      fs.cpSync(path.join(repo, packageRoot), path.join(root, packageRoot), { recursive: true });
      for (const ext of ['.patch', '.json']) write(stem + ext, fs.readFileSync(path.join(repo, stem + ext)));
      // Tests can run before or after postinstall. Reconstruct the exact original
      // files independently from the patch when the installed tree is patched.
      const patch = read(stem + '.patch');
      const sections = patch.split(/(?=^--- )/m).filter(Boolean);
      for (const spec of manifest.files) {
        const file = path.join(root, spec.target);
        if (spec.original === null) { if (fs.existsSync(file)) fs.unlinkSync(file); continue; }
        const bytes = fs.readFileSync(file);
        if (hash(bytes) === spec.original) continue;
        assert.equal(hash(bytes), spec.patched, 'installed source must match reviewed source');
        const section = sections.find(value => value.startsWith('--- a/' + spec.target + '\n'));
        const lines = section.trimEnd().split('\n');
        const source = bytes.toString().split('\n'); source.pop();
        const original = []; let cursor = 0;
        for (let i = 2; i < lines.length;) {
          const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(lines[i++]);
          assert.ok(match);
          const offset = Number(match[1]) - 1;
          original.push(...source.slice(cursor, offset)); cursor = offset;
          while (i < lines.length && !lines[i].startsWith('@@ ')) {
            const operation = lines[i][0], text = lines[i++].slice(1);
            if (operation !== '-') { assert.equal(source[cursor++], text); }
            if (operation !== '+') original.push(text);
          }
        }
        original.push(...source.slice(cursor));
        const restored = original.join('\n') + '\n';
        assert.equal(hash(restored), spec.original); write(spec.target, restored);
      }
    } else {
      const pkg = JSON.stringify({ name, version, main: 'index.js' });
      write(packageRoot + '/package.json', pkg); write(packageRoot + '/index.js', 'module.exports = {};\n');
      const target = packageRoot + '/guard.txt', added = packageRoot + '/added.txt';
      write(target, 'original\n');
      const patch = `--- a/${target}\n+++ b/${target}\n@@ -1 +1 @@\n-original\n+patched\n--- /dev/null\n+++ b/${added}\n@@ -0,0 +1 @@\n+added\n`;
      manifest = { schemaVersion: 1, name, version, packageRoot,
        consumers: ['node_modules/consumer-' + name], patchSha256: hash(patch),
        pins: { 'package.json': hash(pkg), 'index.js': hash('module.exports = {};\n') },
        files: [{ target, original: hash('original\n'), patched: hash('patched\n') }, { target: added, original: null, patched: hash('added\n') }] };
      write(stem + '.patch', patch); write(stem + '.json', JSON.stringify(manifest));
    }
    for (const consumer of manifest.consumers) {
      if (realSources && name === 'sprintf-js') {
        fs.cpSync(path.join(repo, consumer), path.join(root, consumer), { recursive: true });
        continue;
      }
      write(consumer + '/package.json', JSON.stringify({ name: consumer.split('/').slice(-1)[0], version: '1.0.0', dependencies: { [name]: version } }));
    }
    manifests.push(manifest);
  }
  if (realSources) for (const name of ['fill-range', 'to-regex-range', 'is-number']) {
    fs.cpSync(path.join(repo, 'node_modules', name), path.join(root, 'node_modules', name), { recursive: true });
  }
  const lock = { lockfileVersion: 3, packages: {} };
  for (const manifest of manifests) {
    lock.packages[manifest.packageRoot] = { version: manifest.version };
    for (const consumer of manifest.consumers) lock.packages[consumer] = { version: JSON.parse(read(consumer + '/package.json')).version };
  }
  write('package-lock.json', JSON.stringify(lock));
  return { root, write, read, manifests, lock };
}
function editManifest(f, index, update) {
  const manifest = f.manifests[index]; update(manifest);
  f.write(`patches/${manifest.name}+${manifest.version}.json`, JSON.stringify(manifest));
}
function assertUnchanged(f) {
  for (const manifest of f.manifests) for (const spec of manifest.files) {
    const file = path.join(f.root, spec.target);
    assert.equal(fs.existsSync(file) ? hash(fs.readFileSync(file)) : null, spec.original);
  }
}
test('exact patches install together, verify independently and are idempotent', t => {
  const f = fixture(t);
  assert.equal(patchDependencySecurity(f.root), 'installed');
  assert.equal(patchDependencySecurity(f.root), 'already-installed');
  assert.equal(verifyDependencySecurity(f.root), 'already-installed');
  for (const manifest of f.manifests) for (const spec of manifest.files) assert.equal(hash(f.read(spec.target)), spec.patched);
});
test('check-only refuses clean unpatched sources and does not write', t => {
  const f = fixture(t); assert.throws(() => verifyDependencySecurity(f.root), /not installed/); assertUnchanged(f);
});
test('a baseline change in the second package prevents writes to every package', t => {
  const f = fixture(t); f.write(f.manifests[1].files[0].target, 'unreviewed\n');
  assert.throws(() => patchDependencySecurity(f.root), /baseline changed/);
  assert.equal(f.read(f.manifests[0].files[0].target), 'original\n');
});
test('partial installation within and across packages refuses repair', t => {
  for (const crossPackage of [false, true]) {
    const f = fixture(t);
    for (const spec of (crossPackage ? f.manifests[0].files : [f.manifests[0].files[1]])) f.write(spec.target, spec.original === null ? 'added\n' : 'patched\n');
    assert.throws(() => patchDependencySecurity(f.root), /partially patched/);
    assert.equal(f.read(f.manifests[1].files[0].target), 'original\n');
  }
});
test('two installed guards and an original third guard still refuse mixed-state repair', t => {
  const f = fixture(t);
  for (const manifest of f.manifests.slice(0, 2)) for (const spec of manifest.files) {
    f.write(spec.target, spec.original === null ? 'added\n' : 'patched\n');
  }
  assert.throws(() => patchDependencySecurity(f.root), /partially patched/);
  assert.throws(() => verifyDependencySecurity(f.root), /partially patched/);
  assert.equal(f.read(f.manifests[2].files[0].target), 'original\n');
});

test('sprintf package copies, metadata pins, consumers and postinstall source changes fail closed', t => {
  for (const kind of ['copy', 'version', 'pin', 'consumer', 'resolution', 'tamper']) {
    const f = fixture(t);
    if (kind === 'copy') f.write('apps/mobile/node_modules/sprintf-js/package.json', JSON.stringify({ name: 'sprintf-js', version: '1.0.3' }));
    if (kind === 'version') f.write('node_modules/sprintf-js/package.json', JSON.stringify({ name: 'sprintf-js', version: '1.1.3', main: 'index.js' }));
    if (kind === 'pin') f.write('node_modules/sprintf-js/index.js', 'unreviewed\n');
    if (kind === 'consumer') f.write('node_modules/consumer-sprintf-js/package.json', JSON.stringify({ name: 'consumer-sprintf-js', version: '1.0.0' }));
    if (kind === 'resolution') {
      f.write('node_modules/consumer-sprintf-js/node_modules/sprintf-js/package.json', JSON.stringify({ name: 'different-name', version: '1.0.3', main: 'index.js' }));
      f.write('node_modules/consumer-sprintf-js/node_modules/sprintf-js/index.js', 'module.exports = {};\n');
    }
    if (kind === 'tamper') {
      patchDependencySecurity(f.root);
      f.write(f.manifests[2].files[0].target, 'tampered\n');
      assert.throws(() => verifyDependencySecurity(f.root), /baseline changed|partially patched/);
    } else {
      assert.throws(() => patchDependencySecurity(f.root));
      assertUnchanged(f);
    }
  }
});
test('changed versions, missing packages and changed pinned entrypoints fail closed', t => {
  for (const kind of ['version', 'missing', 'pin']) {
    const f = fixture(t);
    if (kind === 'version') f.write('node_modules/node-forge/package.json', JSON.stringify({ name: 'node-forge', version: '1.4.1' }));
    if (kind === 'missing') fs.rmSync(path.join(f.root, 'node_modules/node-forge'), { recursive: true });
    if (kind === 'pin') f.write('node_modules/node-forge/index.js', 'changed\n');
    assert.throws(() => patchDependencySecurity(f.root));
    assert.equal(f.read(f.manifests[0].files[0].target), 'original\n');
  }
});
test('changed patch bytes and invalid patched output prevent all mutation', t => {
  for (const kind of ['digest', 'context', 'output']) {
    const f = fixture(t); const manifest = f.manifests[1], stem = 'patches/node-forge+1.4.0';
    if (kind === 'digest') f.write(stem + '.patch', 'tampered\n');
    if (kind === 'context') {
      const invalid = f.read(stem + '.patch').replace('-original\n', '-different\n');
      f.write(stem + '.patch', invalid); editManifest(f, 1, value => value.patchSha256 = hash(invalid));
    }
    if (kind === 'output') editManifest(f, 1, value => value.files[0].patched = hash('wrong\n'));
    assert.throws(() => patchDependencySecurity(f.root), /digest mismatch|context mismatch/); assertUnchanged(f);
  }
});
test('unexpected nested, aliased, or workspace copies cannot bypass the guard', t => {
  for (const location of ['node_modules/consumer-braces/node_modules/braces', 'node_modules/alias', 'apps/mobile/node_modules/braces']) {
    const f = fixture(t); f.write(location + '/package.json', JSON.stringify({ name: 'braces', version: '3.0.3' }));
    assert.throws(() => patchDependencySecurity(f.root), /unexpected installed copies/); assertUnchanged(f);
  }
});
test('missing and changed required consumers fail closed', t => {
  for (const changed of [false, true]) {
    const f = fixture(t);
    if (changed) f.write('node_modules/consumer-braces/package.json', JSON.stringify({ name: 'consumer-braces', version: '1.0.0' }));
    else fs.rmSync(path.join(f.root, 'node_modules/consumer-braces'), { recursive: true });
    assert.throws(() => patchDependencySecurity(f.root), /required consumer/); assertUnchanged(f);
  }
});
test('all declared consumers must resolve the guarded package and its main entry', t => {
  const f = fixture(t);
  f.write('packages/example/package.json', JSON.stringify({ name: 'example', dependencies: { braces: '3.0.3' } }));
  f.write('packages/example/node_modules/braces/package.json', JSON.stringify({ name: 'different-name', version: '3.0.3', main: 'different.js' }));
  f.write('packages/example/node_modules/braces/different.js', 'module.exports = {};\n');
  assert.throws(() => patchDependencySecurity(f.root), /consumer resolves an unguarded dependency/); assertUnchanged(f);
});
test('symlink files, directories, packages and manifests are refused', t => {
  for (const kind of ['file', 'directory', 'package', 'manifest']) {
    const f = fixture(t); const relative = kind === 'manifest' ? 'patches/braces+3.0.3.json' : kind === 'file' ? f.manifests[0].files[0].target : kind === 'package' ? 'node_modules/braces' : 'patches';
    const target = path.join(f.root, relative), moved = target + '-original';
    fs.renameSync(target, moved); fs.symlinkSync(moved, target);
    assert.throws(() => patchDependencySecurity(f.root), /symlink path refused|unexpected installed copies/);
    assert.equal(f.read(f.manifests[1].files[0].target), 'original\n');
  }
});
test('path traversal and patch/manifest target mismatch are rejected', t => {
  for (const kind of ['traversal', 'target', 'missing']) {
    const f = fixture(t);
    editManifest(f, 0, value => {
      if (kind === 'traversal') value.files[0].target = 'node_modules/braces/../../outside';
      if (kind === 'target') value.files[0].target = 'node_modules/braces/different.txt';
      if (kind === 'missing') value.files.pop();
    });
    assert.throws(() => patchDependencySecurity(f.root)); assert.equal(f.read('node_modules/node-forge/guard.txt'), 'original\n');
  }
});
test('post-install source tamper and added-file removal fail verification', t => {
  for (const kind of ['source', 'added', 'pin']) {
    const f = fixture(t); patchDependencySecurity(f.root);
    if (kind === 'source') f.write(f.manifests[1].files[0].target, 'tampered\n');
    if (kind === 'added') fs.unlinkSync(path.join(f.root, f.manifests[0].files[1].target));
    if (kind === 'pin') f.write('node_modules/braces/index.js', 'tampered\n');
    assert.throws(() => verifyDependencySecurity(f.root), /baseline changed|partially patched/);
  }
});
test('handled rename failure rolls back every package without staging residue', t => {
  const f = fixture(t); const rename = fs.renameSync; let calls = 0;
  fs.renameSync = (...args) => { if (++calls === 4) throw new Error('synthetic rename failure'); return rename(...args); };
  try { assert.throws(() => patchDependencySecurity(f.root), /synthetic rename failure/); } finally { fs.renameSync = rename; }
  assertUnchanged(f);
  for (const name of ['braces', 'node-forge', 'sprintf-js']) assert.ok(fs.readdirSync(path.join(f.root, 'node_modules', name)).every(file => !file.includes('.cplayout-')));
});
test('audit evidence verifies every leaf and parent node against installed metadata and lock', t => {
  const f = fixture(t); patchDependencySecurity(f.root);
  const report = { vulnerabilities: {
    braces: { name: 'braces', nodes: ['node_modules/braces'] },
    'consumer-braces': { name: 'consumer-braces', nodes: ['node_modules/consumer-braces'] },
    'node-forge': { name: 'node-forge', nodes: ['node_modules/node-forge'] },
    'sprintf-js': { name: 'sprintf-js', nodes: ['node_modules/sprintf-js'] }
  } };
  const evidence = checkAuditDependencyNodes(f.root, report);
  assert.equal(evidence.patches, 'already-installed'); assert.equal(evidence.nodes.length, 4);
  assert.deepEqual(evidence.nodes.find(node => node.name === 'braces'), { path: 'node_modules/braces', name: 'braces', version: '3.0.3', patched: true });
  assert.equal(evidence.nodes.find(node => node.name === 'consumer-braces').patched, false);
  f.lock.packages['node_modules/consumer-braces'].version = '9.0.0'; f.write('package-lock.json', JSON.stringify(f.lock));
  assert.throws(() => checkAuditDependencyNodes(f.root, report), /identity\/version mismatch/);
});
test('audit malformed nodes and identity changes are refused independently', t => {
  const f = fixture(t); patchDependencySecurity(f.root);
  for (const node of ['../node_modules/braces', '/node_modules/braces', 'node_modules\\braces', 'node_modules/missing', 'node_modules/consumer-braces']) {
    assert.throws(() => checkAuditDependencyNodes(f.root, { vulnerabilities: { braces: { name: 'braces', nodes: [node] } } }));
  }
  assert.throws(() => checkAuditDependencyNodes(f.root, { vulnerabilities: { braces: { name: 'wrong', nodes: ['node_modules/braces'] } } }));
});

function sprintfModule(source) {
  return vm.runInNewContext(source + '\nexports;', { exports: {} });
}
test('reviewed sprintf sources preserve omitted and every legal numeric precision', t => {
  const f = fixture(t, { realSources: true });
  const before = sprintfModule(f.read('node_modules/sprintf-js/src/sprintf.js'));
  patchDependencySecurity(f.root);
  const after = sprintfModule(f.read('node_modules/sprintf-js/src/sprintf.js'));
  for (const type of ['e', 'f', 'g']) {
    for (const value of [0, 1.234567, -123.456, Infinity, NaN]) {
      assert.equal(after.sprintf('%' + type, value), before.sprintf('%' + type, value));
      for (let precision = type === 'g' ? 1 : 0; precision <= 100; precision++) {
        const format = '%+.' + precision + type;
        assert.equal(after.sprintf(format, value), before.sprintf(format, value), format);
      }
    }
  }
  for (const args of [
    ['literal %%'], ['%s %d %i', 'hello', 42, -7], ['%b %c %o %u %x %X', 5, 65, 9, -1, 255, 255],
    ['%+08.2f|%-8.2f|%\'_8s', 1.25, -1.25, 'x'], ['%.3s|%2$s %1$s', 'abcdef', 'second'],
    ['%(users[0].name)s', { users: [{ name: 'Dolly' }] }], ['%j', { value: [1, 2] }], ['%s', () => 'ordinary']
  ]) assert.equal(after.sprintf(...args), before.sprintf(...args));
  assert.equal(after.sprintf('%.2f', 1.25), '1.25');
  assert.equal(verifyDependencySecurity(f.root), 'already-installed');
  const proof = checkAuditDependencyNodes(f.root, { vulnerabilities: {
    'sprintf-js': { name: 'sprintf-js', nodes: ['node_modules/sprintf-js'] },
    argparse: { name: 'argparse', nodes: ['node_modules/argparse'] }
  } });
  assert.deepEqual(proof.nodes.find(node => node.name === 'sprintf-js'), { path: 'node_modules/sprintf-js', name: 'sprintf-js', version: '1.0.3', patched: true });
  assert.equal(proof.nodes.find(node => node.name === 'argparse').version, '1.0.10');
});

test('sprintf precision boundaries clamp without a replacement throw or argument/AST/cache mutation', t => {
  const f = fixture(t, { realSources: true });
  const before = sprintfModule(f.read('node_modules/sprintf-js/src/sprintf.js'));
  for (const format of ['%.101e', '%.101f', '%.101g', '%.0g']) {
    assert.throws(() => before.sprintf(format, 1.25), error => error.name === 'RangeError');
  }
  patchDependencySecurity(f.root);
  const { sprintf, vsprintf } = sprintfModule(f.read('node_modules/sprintf-js/src/sprintf.js'));
  const value = 1.25;
  const expected = { e: value.toExponential(100), f: value.toFixed(100), g: value.toPrecision(100) };
  for (const type of ['e', 'f', 'g']) for (const precision of ['101', '9'.repeat(400)]) {
    const format = '%.' + precision + type;
    const tree = sprintf.parse(format);
    const snapshot = JSON.stringify(tree);
    const argv = Object.freeze([format, value]);
    Object.freeze(tree[0]); Object.freeze(tree);
    assert.equal(sprintf.format(tree, argv), expected[type]);
    assert.equal(JSON.stringify(tree), snapshot);
    assert.equal(sprintf(format, value), expected[type]);
    const cached = sprintf.cache[format], cacheSnapshot = JSON.stringify(cached);
    assert.equal(sprintf(format, value), expected[type]);
    assert.equal(sprintf.cache[format], cached);
    assert.equal(JSON.stringify(cached), cacheSnapshot);
    const vector = Object.freeze([value]);
    assert.equal(vsprintf(format, vector), expected[type]);
    assert.deepEqual(vector, [value]);
  }
  assert.equal(sprintf('%.0g', value), value.toPrecision(1));
  for (const type of ['e', 'f', 'g']) for (const precision of [101, Number.MAX_VALUE, Infinity, -Infinity, -1, 0, NaN]) {
    const tree = sprintf.parse('%.1' + type);
    tree[0][7] = precision;
    const match = { ...tree[0] };
    Object.freeze(tree[0]); Object.freeze(tree);
    const argv = Object.freeze(['unused', value]);
    const bounded = precision > 100 ? 100 : type === 'g' ? 1 : 0;
    const formatted = type === 'e' ? value.toExponential(bounded) : type === 'f' ? value.toFixed(bounded) : value.toPrecision(bounded);
    assert.equal(sprintf.format(tree, argv), formatted);
    assert.deepEqual({ ...tree[0] }, match);
    assert.deepEqual(argv, ['unused', value]);
  }
});

test('argparse usage, text and action help preserve before/after sprintf consumer behavior', t => {
  const f = fixture(t, { realSources: true });
  for (const name of ['argparse', 'sprintf-js']) {
    fs.cpSync(path.join(f.root, 'node_modules', name), path.join(f.root, 'baseline/node_modules', name), { recursive: true });
  }
  const baseline = require(path.join(f.root, 'baseline/node_modules/argparse'));
  patchDependencySecurity(f.root);
  const guarded = require(path.join(f.root, 'node_modules/argparse'));
  function outputs(argparse) {
    const parser = new argparse.ArgumentParser({ prog: 'cplayout', usage: '%(prog)s [options]', description: '%(prog)s offline CLI', epilog: 'End %(prog)s', addHelp: false, debug: true });
    parser.addArgument(['--mode'], { defaultValue: 'safe', choices: ['safe', 'fast'], help: '%(prog)s %(dest)s %(defaultValue)s (%(choices)s)' });
    return { usage: parser.formatUsage(), help: parser.formatHelp(), args: JSON.stringify(parser.parseArgs(['--mode', 'fast'])) };
  }
  assert.deepEqual(outputs(guarded), outputs(baseline));
  assert.match(outputs(guarded).help, /cplayout offline CLI/);
  assert.match(outputs(guarded).help, /mode safe \(safe, fast\)/);
  assert.equal(patchDependencySecurity(f.root), 'already-installed');
});

test('reviewed braces sources preserve ordinary behavior and reject excess combined nesting', t => {
  const f = fixture(t, { realSources: true }); patchDependencySecurity(f.root);
  const braces = require(path.join(f.root, 'node_modules/braces'));
  for (const [pattern, expected] of [
    ['file-{a,b}.txt', ['file-a.txt', 'file-b.txt']], ['{1..3}', ['1','2','3']],
    ['{01..03}', ['01','02','03']], ['{a,b}{1,2}', ['a1','a2','b1','b2']],
    ['{a,{b,c}}', ['a','b','c']], ['\\{a,b\\}', ['{a,b}']],
    ['${value}', ['${value}']], ['[a{b,c}]', ['[a{b,c}]']], ['"{a,b}"', ['{a,b}']],
    ['(a{b,c})', ['(ab)','(ac)']], ['{a,b', ['{a,b']], ['literal', ['literal']]
  ]) assert.deepEqual(braces.expand(pattern), expected, pattern);
  const atLimit = '{'.repeat(50) + '('.repeat(50) + 'x' + ')'.repeat(50) + '}'.repeat(50);
  assert.doesNotThrow(() => braces.parse(atLimit));
  assert.doesNotThrow(() => braces.compile(braces.parse(atLimit)));
  assert.doesNotThrow(() => braces.stringify(braces.parse(atLimit)));
  assert.doesNotThrow(() => braces.expand(atLimit));
  for (const count of [101, 500]) {
    const inputs = ['{'.repeat(count) + 'x' + '}'.repeat(count), '('.repeat(count) + 'x' + ')'.repeat(count), '{('.repeat(count) + 'x' + ')}'.repeat(count), '{'.repeat(count)];
    for (const input of inputs) for (const method of ['parse','compile','expand','stringify']) assert.throws(() => braces[method](input), error => error instanceof SyntaxError && /nesting depth/.test(error.message));
  }
  assert.throws(() => braces.expand('{1..2000}'), /range limit/);
});
test('every braces AST walker rejects excessive depth, child cycles and parent cycles', t => {
  const f = fixture(t, { realSources: true }); patchDependencySecurity(f.root);
  const braces = require(path.join(f.root, 'node_modules/braces'));
  for (const method of ['compile','expand','stringify']) {
    let deep = { type: 'text', value: 'x' };
    for (let i=0;i<102;i++) deep = { type: 'root', nodes: [deep] };
    assert.throws(() => braces[method](deep), error => error instanceof SyntaxError && /depth/.test(error.message));
    const childCycle = { type: 'root', nodes: [] }; childCycle.nodes.push(childCycle);
    assert.throws(() => braces[method](childCycle), /Cyclic brace AST/);
    const parentCycle = { type: 'root', nodes: [] }; parentCycle.parent = parentCycle;
    assert.throws(() => braces[method](parentCycle), /Cyclic brace AST parent/);
    const a = { type: 'text', value: 'a' }, b = { type: 'text', value: 'b' }; a.parent=b; b.parent=a;
    assert.throws(() => braces[method]({ type: 'root', nodes: [a] }), /Cyclic brace AST parent/);
    assert.throws(() => braces[method]({ type: 'root', nodes: [null] }), /Invalid brace AST/);
    assert.throws(() => braces[method]({ type: 'text', value: [] }), /Invalid brace AST value/);
  }
});

// Pure ASN.1 schema tests use the actual guarded condition with the original
// validator. No RSA encoded blocks, signatures or cryptographic attack probes.
function forgeSchema(f) {
  const forge = require(path.join(f.root, 'node_modules/node-forge'));
  const source = f.read('node_modules/node-forge/lib/rsa.js');
  const start = source.indexOf('var digestInfoValidator = {');
  const end = source.indexOf('\n};', start) + 3;
  const validator = vm.runInNewContext(source.slice(start, end) + '\ndigestInfoValidator;', { asn1: forge.asn1 });
  const conditionStart = source.indexOf('if(!asn1.validate(obj, digestInfoValidator, capture, errors) ||');
  const conditionEnd = source.indexOf(' {', conditionStart);
  assert.ok(conditionStart > 0 && conditionEnd > conditionStart);
  const condition = source.slice(conditionStart + 3, conditionEnd - 1);
  const rejected = new Function('asn1','digestInfoValidator','obj','capture','errors', 'return ' + condition + ';');
  const asn1 = forge.asn1;
  const make = (type, value, constructed=false) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  const oid = () => make(asn1.Type.OID, asn1.oidToDer(forge.oids.sha256).getBytes());
  const info = children => make(asn1.Type.SEQUENCE, [make(asn1.Type.SEQUENCE, children, true), make(asn1.Type.OCTETSTRING, 'ordinary-digest')], true);
  const fullStart = source.indexOf('          // validate DigestInfo structure and element count');
  const fullEnd = source.indexOf('          // compare the given digest', fullStart);
  const validate = new Function('asn1', 'digestInfoValidator', 'forge', 'obj', source.slice(fullStart, fullEnd) + 'return true;');
  return { forge, asn1, make, oid, info, rejected: obj => rejected(asn1, validator, obj, {}, []),
    validate: obj => validate(asn1, validator, forge, obj) };
}
test('forge schema requires exact OID/optional empty primitive NULL structure', t => {
  const f = fixture(t, { realSources: true }); patchDependencySecurity(f.root);
  const { asn1, make, oid, info, rejected } = forgeSchema(f);
  assert.equal(rejected(info([oid()])), false);
  assert.equal(rejected(info([oid(), make(asn1.Type.NULL, '')])), false);
  for (const children of [
    [], [oid(), make(asn1.Type.OCTETSTRING, '')], [oid(), make(asn1.Type.NULL, 'nonempty')],
    [oid(), make(asn1.Type.NULL, '', true)], [oid(), make(asn1.Type.NULL, ''), make(asn1.Type.NULL, '')],
    [oid(), make(asn1.Type.OCTETSTRING, ''), make(asn1.Type.NULL, '')]
  ]) assert.equal(rejected(info(children)), true);
  const extraOuter = info([oid()]); extraOuter.value.push(make(asn1.Type.NULL, ''));
  assert.equal(rejected(extraOuter), true);
});
test('forge pure schema retains SHA optional NULL and MD5 required NULL rules', t => {
  const f = fixture(t, { realSources: true }); patchDependencySecurity(f.root);
  const { forge, asn1, make, oid, info, validate } = forgeSchema(f);
  assert.equal(validate(info([oid()])), true);
  assert.equal(validate(info([oid(), make(asn1.Type.NULL, '')])), true);
  const md5Oid = () => make(asn1.Type.OID, asn1.oidToDer(forge.oids.md5).getBytes());
  assert.equal(validate(info([md5Oid(), make(asn1.Type.NULL, '')])), true);
  assert.throws(() => validate(info([md5Oid()])), /Missing algorithm identifier NULL parameters/);
  assert.throws(() => validate(info([oid(), make(asn1.Type.NULL, 'nonempty')])), /DigestInfo/);
});
test('forge preserves normal Node PKCS1 and PSS signature interoperability', t => {
  const f = fixture(t, { realSources: true }); patchDependencySecurity(f.root);
  const forge = require(path.join(f.root, 'node_modules/node-forge'));
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001,
    privateKeyEncoding: { type:'pkcs8', format:'pem' }, publicKeyEncoding: { type:'spki', format:'pem' } });
  const privateKey = forge.pki.privateKeyFromPem(keys.privateKey), publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  const message = 'CPLayout dependency guard ordinary compatibility';
  for (const algorithm of ['sha1','sha256','sha384','sha512','md5']) {
    const md = forge.md[algorithm].create(); md.update(message, 'utf8');
    const signature = privateKey.sign(md);
    assert.equal(crypto.verify(algorithm, Buffer.from(message), keys.publicKey, Buffer.from(signature, 'binary')), true);
    const nodeSignature = crypto.sign(algorithm, Buffer.from(message), keys.privateKey);
    const digest = forge.md[algorithm].create(); digest.update(message, 'utf8');
    assert.equal(publicKey.verify(digest.digest().getBytes(), nodeSignature.toString('binary')), true);
  }
  const pss = () => forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength:32 });
  const md = forge.md.sha256.create(); md.update(message, 'utf8');
  const signature = privateKey.sign(md, pss());
  assert.equal(crypto.verify('sha256', Buffer.from(message), { key:keys.publicKey, padding:crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength:32 }, Buffer.from(signature, 'binary')), true);
  const nodeSignature = crypto.sign('sha256', Buffer.from(message), { key:keys.privateKey, padding:crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength:32 });
  const digest = forge.md.sha256.create(); digest.update(message, 'utf8');
  assert.equal(publicKey.verify(digest.digest().getBytes(), nodeSignature.toString('binary'), pss()), true);
});
