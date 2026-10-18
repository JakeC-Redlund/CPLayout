'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateRegistry, renderStatus, run, digest, evidenceCurrency, wholeImplementationPaths } = require('./workflowStatus.cjs');
const root = path.resolve(__dirname, '..');
const original = () => JSON.parse(fs.readFileSync(path.join(root, 'docs/workflow-registry.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cplayout-workflow-registry-'));
  try {
    const registry = original();
    // Placeholder fixture sources do not inherit the checkout's verified proofs.
    // Each case explicitly qualifies only the requirement it is exercising.
    for (const item of registry.requirements) {
      if (item.status === 'verified') item.status = 'source_implemented';
    }
    for (const relative of new Set(registry.requirements.flatMap(item => item.sourcePaths))) {
      fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true });
      fs.writeFileSync(path.join(temp, relative), 'fixture source\n');
    }
    fs.mkdirSync(path.dirname(path.join(temp, registry.historicalStatus.path)), { recursive: true });
    fs.copyFileSync(path.join(root, registry.historicalStatus.path), path.join(temp, registry.historicalStatus.path));
    fs.writeFileSync(path.join(temp, 'docs/workflow-registry.json'), JSON.stringify(registry));
    fs.mkdirSync(path.join(temp, '.codex/hooks'), { recursive: true });
    fs.writeFileSync(path.join(temp, '.codex/hooks/cplayout_context_map.json'), JSON.stringify({ sourceHashes: {} }));
    for (const relative of ['docs/agent-context-map.md', 'docs/agent-governance-summary.md', 'docs/examples/cplayout-managed-requirements.toml']) {
      fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true });
      fs.writeFileSync(path.join(temp, relative), 'owned synthetic validator input\n');
    }
    validateRegistry(registry, temp);
    return fn(registry, temp);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test('current registry retains source, browser and publication evidence as separate claims', () => {
  const registry = validateRegistry(original(), root);
  assert.equal(registry.authority.humanAcceptance, 'not_established');
  assert.equal(registry.browserDebt.deferredCases, 960);
  assert.equal(registry.evidence.find(item => item.id === 'E-CANONICAL-SECURITY-GAP').result, 'fail');
  assert.deepEqual(new Set(registry.evidence.map(item => item.claimClass)), new Set(['source', 'browser', 'publication', 'hook']));
});

test('source success cannot promote browser or native qualification', () => fixture((registry, temp) => {
  const item = registry.requirements[0];
  item.status = 'verified'; item.requiredClaimClass = 'browser'; item.evidenceIds = ['E-BASELINE-SOURCE'];
  assert.throws(() => validateRegistry(registry, temp), /matching passing evidence/);
  item.requiredClaimClass = 'native_device';
  assert.throws(() => validateRegistry(registry, temp), /matching passing evidence/);
}));

test('a failed result cannot be relabeled verified through an evidence reference', () => fixture((registry, temp) => {
  const item = registry.requirements[0];
  item.status = 'verified'; item.requiredClaimClass = 'source'; item.evidenceIds = ['E-CANONICAL-SECURITY-GAP'];
  assert.throws(() => validateRegistry(registry, temp), /matching passing evidence/);
}));

test('withdrawn instructions and fabricated human acceptance fail closed', () => fixture((registry, temp) => {
  const withdrawn = copy(registry); withdrawn.authority.withdrawnInstructionsActive = true;
  assert.throws(() => validateRegistry(withdrawn, temp), /Withdrawn instructions/);
  registry.authority.humanAcceptance = 'accepted';
  assert.throws(() => validateRegistry(registry, temp), /human acceptance/);
}));

test('missing evidence IDs and dependency cycles cannot enter the tracker', () => fixture((registry, temp) => {
  const missing = copy(registry); missing.requirements[0].evidenceIds = ['invented'];
  assert.throws(() => validateRegistry(missing, temp), /Unknown requirement evidence/);
  registry.requirements[0].dependsOn = [registry.requirements[1].id];
  registry.requirements[1].dependsOn = [registry.requirements[0].id];
  assert.throws(() => validateRegistry(registry, temp), /dependency cycle/);
}));

test('historical bytes and required source paths are protected', () => fixture((registry, temp) => {
  const escape = copy(registry); escape.requirements[0].sourcePaths = ['../outside'];
  assert.throws(() => validateRegistry(escape, temp), /Invalid repository-relative/);
  fs.appendFileSync(path.join(temp, registry.historicalStatus.path), '\nchanged');
  assert.throws(() => validateRegistry(registry, temp), /Historical status bytes changed/);
}));

test('unaccounted deferred contracts and unsupported hook claims are rejected', () => fixture((registry, temp) => {
  const debt = copy(registry); debt.browserDebt.deferredCases = 0;
  assert.throws(() => validateRegistry(debt, temp), /Deferred browser obligations/);
  registry.hooks.execution = 'verified';
  assert.throws(() => validateRegistry(registry, temp), /Unsupported hook execution/);
}));

test('future browser migration can reduce debt only with unique source-bound passing browser records', () => fixture((registry, temp) => {
  registry.browserDebt.deferredCases = 959;
  registry.browserDebt.migrations = [{ caseId: 'existing-contract::desktop', evidenceId: 'E-BASELINE-SOURCE' }];
  assert.throws(() => validateRegistry(registry, temp), /passing browser evidence/);
  registry.evidence.push({ ...registry.evidence.find(item => item.id === 'E-BASELINE-BROWSER'), id: 'E-MIGRATED-CASE',
    caseIds: ['existing-contract::desktop'], reference: 'synthetic source-bound migrated-case report' });
  registry.browserDebt.migrations[0].evidenceId = 'E-MIGRATED-CASE';
  assert.throws(() => validateRegistry(registry, temp), /current scoped source evidence/);
  const { evidence } = scopedEvidence(registry, temp);
  Object.assign(registry.evidence.find(item => item.id === 'E-MIGRATED-CASE'), { edition: 'candidate', sourceManifest: evidence.sourceManifest,
    sourceScope: evidence.sourceScope, sourceFingerprint: evidence.sourceFingerprint });
  assert.equal(validateRegistry(registry, temp), registry);
  registry.browserDebt.migrations.push({ ...registry.browserDebt.migrations[0] });
  assert.throws(() => validateRegistry(registry, temp), /Duplicate.*migrated browser case/);
}));

test('status generation is deterministic and check detects hand-edited projection', () => fixture((registry, temp) => {
  assert.equal(renderStatus(registry), renderStatus(copy(registry)));
  run(temp, true);
  assert.match(run(temp, false), /requirements/);
  fs.appendFileSync(path.join(temp, 'docs/development-status.md'), '\nmanual drift');
  assert.throws(() => run(temp, false), /status is stale/);
}));

function scopedEvidence(registry, temp) {
  const relative = registry.requirements[0].sourcePaths[0];
  const scope = registry.requirements[0].verificationSourcePaths ?? registry.requirements[0].sourcePaths;
  const sourceHashes = Object.fromEntries([...scope].sort().map(file => [file, digest(fs.readFileSync(path.join(temp, file)))]));
  const sourceFingerprint = digest(JSON.stringify(sourceHashes));
  const sourceManifest = 'docs/evidence/current-scope.json';
  fs.mkdirSync(path.join(temp, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(temp, sourceManifest), JSON.stringify({ sourceHashes, sourceFingerprint }));
  const evidence = { ...registry.evidence.find(item => item.claimClass === 'source' && item.result === 'pass'),
    id: 'E-CURRENT-SCOPE', edition: 'candidate', sourceManifest, sourceScope: [...scope], sourceFingerprint, requirementIds: [registry.requirements[0].id] };
  registry.evidence.push(evidence);
  return { relative, evidence };
}
test('candidate evidence becomes stale on its own source change and cannot promote a verified requirement', () => fixture((registry, temp) => {
  const { relative, evidence } = scopedEvidence(registry, temp);
  const item = registry.requirements[0]; item.status = 'verified'; item.requiredClaimClass = 'source'; item.evidenceIds = [evidence.id];
  assert.equal(evidenceCurrency(registry, temp).get(evidence.id).status, 'current');
  validateRegistry(registry, temp);
  fs.appendFileSync(path.join(temp, relative), 'changed input\n');
  assert.deepEqual(evidenceCurrency(registry, temp).get(evidence.id), { status: 'stale', changedPaths: [relative] });
  assert.throws(() => validateRegistry(registry, temp), /matching current scoped source evidence/);
}));
test('unrelated source changes preserve scoped proof while historical success cannot become current acceptance', () => fixture((registry, temp) => {
  const { evidence } = scopedEvidence(registry, temp);
  const unrelated = registry.requirements[1].sourcePaths[0]; fs.appendFileSync(path.join(temp, unrelated), 'unrelated input\n');
  assert.equal(evidenceCurrency(registry, temp).get(evidence.id).status, 'current');
  const item = registry.requirements[0]; item.status = 'verified'; item.requiredClaimClass = 'source'; item.evidenceIds = ['E-BASELINE-SOURCE'];
  assert.equal(evidenceCurrency(registry, temp).get('E-BASELINE-SOURCE').status, 'historical');
  assert.throws(() => validateRegistry(registry, temp), /matching current scoped source evidence/);
}));
test('a current scoped pass cannot qualify another module or an uncovered source', () => fixture((registry, temp) => {
  const { evidence } = scopedEvidence(registry, temp);
  const item = registry.requirements[0]; item.status = 'verified'; item.requiredClaimClass = 'source'; item.evidenceIds = [evidence.id];
  evidence.requirementIds = [registry.requirements[1].id];
  assert.throws(() => validateRegistry(registry, temp), /explicitly qualified evidence/);
  evidence.requirementIds = [item.id]; item.verificationSourcePaths = [...item.sourcePaths];
  assert.throws(() => validateRegistry(registry, temp), /verification source scope/);
  item.verificationSourcePaths = item.sourcePaths.filter(relative => !(item.authorityReferencePaths ?? []).includes(relative));
  validateRegistry(registry, temp);
  evidence.requirementIds = ['invented-module']; item.status = 'source_implemented';
  assert.throws(() => validateRegistry(registry, temp), /unknown requirement/);
}));
test('tracker authority changes preserve current implementation evidence while real proof criteria changes make it stale', () => fixture((registry, temp) => {
  const { evidence } = scopedEvidence(registry, temp), item = registry.requirements[0];
  item.status = 'verified'; item.requiredClaimClass = 'source'; item.evidenceIds = [evidence.id];
  assert(!evidence.sourceScope.includes('docs/workflow-registry.json'));
  fs.appendFileSync(path.join(temp, 'docs/workflow-registry.json'), '\nnew authority-only status receipt\n');
  assert.equal(evidenceCurrency(registry, temp).get(evidence.id).status, 'current');
  validateRegistry(registry, temp);
  fs.appendFileSync(path.join(temp, 'docs/workflow-acceptance-protocol.md'), 'changed acceptance criteria\n');
  assert.equal(evidenceCurrency(registry, temp).get(evidence.id).status, 'stale');
  assert.throws(() => validateRegistry(registry, temp), /matching current scoped source evidence/);
}));
test('implementation cannot become an authority reference or disappear from its declared verification scope', () => fixture((registry, temp) => {
  const item = registry.requirements[0];
  item.authorityReferencePaths.push('tools/workflowStatus.cjs');
  assert.throws(() => validateRegistry(registry, temp), /authority-only source reference/);
  item.authorityReferencePaths.pop();
  item.verificationSourcePaths = item.verificationSourcePaths.filter(relative => relative !== 'tools/workflowStatus.cjs');
  assert.throws(() => validateRegistry(registry, temp), /implementation sources cannot be omitted/);
}));
test('whole-workflow verification requires implementation beyond its proof-criteria anchors and excludes reference self-hashes', () => fixture((registry, temp) => {
  const item = registry.requirements.find(requirement => requirement.id === 'QA-01');
  const scope = item.verificationSourcePaths, sourceHashes = Object.fromEntries([...scope].sort().map(file => [file, digest(fs.readFileSync(path.join(temp, file)))]));
  const sourceManifest = 'docs/evidence/whole-scope.json'; fs.mkdirSync(path.dirname(path.join(temp, sourceManifest)), { recursive: true });
  const sourceFingerprint = digest(JSON.stringify(sourceHashes)); fs.writeFileSync(path.join(temp, sourceManifest), JSON.stringify({ sourceHashes, sourceFingerprint }));
  const evidence = { ...registry.evidence.find(proof => proof.claimClass === 'source' && proof.result === 'pass'), id: 'E-WHOLE', edition: 'candidate',
    sourceScope: [...scope], sourceManifest, sourceFingerprint, requirementIds: [item.id] };
  registry.evidence.push(evidence); item.status = 'verified'; item.requiredClaimClass = 'source'; item.evidenceIds = [evidence.id];
  assert(!wholeImplementationPaths(registry, temp).includes('docs/workflow-registry.json'));
  assert.throws(() => validateRegistry(registry, temp), /complete implementation source scope/);
  const all = wholeImplementationPaths(registry, temp), allHashes = Object.fromEntries(all.map(file => [file, digest(fs.readFileSync(path.join(temp, file)))]));
  evidence.sourceScope = all; evidence.sourceFingerprint = digest(JSON.stringify(allHashes));
  fs.writeFileSync(path.join(temp, sourceManifest), JSON.stringify({ sourceHashes: allHashes, sourceFingerprint: evidence.sourceFingerprint }));
  validateRegistry(registry, temp);
  fs.mkdirSync(path.join(temp, 'apps/mobile/src/new-runtime'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'apps/mobile/src/new-runtime/route.ts'), 'new actual route source\n');
  assert.throws(() => validateRegistry(registry, temp), /complete implementation source scope/);
  fs.unlinkSync(path.join(temp, 'apps/mobile/src/new-runtime/route.ts'));
  for (const relative of ['tsconfig.tools.json', 'tsconfig.new-build.json', 'vite.config.ts', '.gitignore', '.gitattributes', 'tests/fixtures/new.csv', 'tests/fixtures/new.kml', 'tests/fixtures/new.zip', 'fixtures/new.json', 'fixtures/new.bin', 'patches/dependency.patch', 'patches/dependency.json', 'apps/mobile/android/gradle/wrapper/gradle-wrapper.properties']) {
    fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true }); fs.writeFileSync(path.join(temp, relative), 'new owned synthetic build/fixture input\n');
    assert(wholeImplementationPaths(registry, temp).includes(relative), relative);
    assert.throws(() => validateRegistry(registry, temp), /complete implementation source scope/, relative);
    fs.unlinkSync(path.join(temp, relative));
  }
  const selectedDoc = 'docs/new-selected-contract.md', contextPath = '.codex/hooks/cplayout_context_map.json';
  fs.writeFileSync(path.join(temp, selectedDoc), 'new selected public contract\n');
  fs.writeFileSync(path.join(temp, contextPath), JSON.stringify({ sourceHashes: { [selectedDoc]: digest(fs.readFileSync(path.join(temp, selectedDoc))) } }));
  // Refreshing the context file hash alone still cannot cover the newly selected input.
  allHashes[contextPath] = digest(fs.readFileSync(path.join(temp, contextPath)));
  evidence.sourceFingerprint = digest(JSON.stringify(Object.fromEntries(Object.keys(allHashes).sort().map(relative => [relative, allHashes[relative]]))));
  fs.writeFileSync(path.join(temp, sourceManifest), JSON.stringify({ sourceHashes: allHashes, sourceFingerprint: evidence.sourceFingerprint }));
  assert.equal(evidenceCurrency(registry, temp).get(evidence.id).status, 'current');
  assert(wholeImplementationPaths(registry, temp).includes(selectedDoc));
  assert.throws(() => validateRegistry(registry, temp), /complete implementation source scope/);
}));
test('all regular fixture/native inputs are covered while credential stores remain outside the public census without reads', () => fixture((registry, temp) => {
  const included = ['apps/mobile/android/gradlew', 'apps/mobile/android/app/proguard-rules.pro', 'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar', 'tools/vendor/example.whl', 'tests/fixtures/opaque-format.new', 'fixtures/arbitrary.bin', 'fixtures/real-pivot/manifest.json', 'patches/dependency.patch', 'patches/dependency.json'];
  const excluded = ['apps/mobile/android/app/debug.keystore', 'apps/mobile/android/local.properties', '.codex/auth.json', '.codex/sessions/session.json', 'tools/.env.local', 'tools/credentials/secret.json', 'tools/.cplayout-local/signing.seed', 'fixtures/.env', 'fixtures/credentials.json', 'fixtures/secrets/source.bin', 'patches/credentials.json', 'patches/.env.local', 'patches/secrets/signing.seed'];
  for (const relative of [...included, ...excluded]) { fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true }); fs.writeFileSync(path.join(temp, relative), 'owned synthetic census marker\n'); }
  let protectedReads = 0; const read = fs.readFileSync;
  try {
    fs.readFileSync = function(file, ...args) { if (excluded.some(relative => String(file) === path.join(temp, relative))) protectedReads++; return read.call(fs, file, ...args); };
    const census = wholeImplementationPaths(registry, temp);
    for (const relative of included) assert(census.includes(relative), relative);
    for (const relative of excluded) assert(!census.includes(relative), relative);
    assert.equal(protectedReads, 0);
  } finally { fs.readFileSync = read; }
}));
test('clean-clone census parity excludes generated dependencies and compiler caches while retaining canonical inputs', () => fixture((registry, temp) => {
  const baseline = wholeImplementationPaths(registry, temp);
  const generated = ['LICENSE.txt', 'manifest.json', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs'];
  const directory = path.join(temp, 'apps/mobile/public/maplibre/6.14.0'); fs.mkdirSync(directory, { recursive: true });
  for (const name of generated) fs.writeFileSync(path.join(directory, name), 'owned synthetic generated asset\n');
  assert.deepEqual(wholeImplementationPaths(registry, temp), baseline);
  fs.rmSync(path.join(temp, 'apps/mobile/public/maplibre'), { recursive: true });
  assert.deepEqual(wholeImplementationPaths(registry, temp), baseline);
  for (const relative of ['apps/mobile/android/app/.cxx/Debug/compiler.cpp', 'tools/local-ml-companion/.pytest_cache/v/cache/nodeids']) {
    fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true });
    fs.writeFileSync(path.join(temp, relative), 'generated cache; not a canonical input\n');
  }
  assert.deepEqual(wholeImplementationPaths(registry, temp), baseline);
  const canonical = ['tools/vendor/toolkit.whl', 'apps/mobile/public/advisory-overlay-notices.txt', 'tests/fixtures/new.kml', 'apps/mobile/android/gradlew', 'apps/mobile/android/app/proguard-rules.pro'];
  for (const relative of canonical) { fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true }); fs.writeFileSync(path.join(temp, relative), 'owned canonical source input\n'); }
  const current = wholeImplementationPaths(registry, temp);
  for (const relative of canonical) assert(current.includes(relative), relative);
  assert.equal(current.length, baseline.length + canonical.length);
}));
test('whole-workflow source census refuses unresolved implementation symlinks without hydrating their target', () => fixture((registry, temp) => {
  const target = path.join(temp, 'outside-owned-source.js'); fs.writeFileSync(target, 'owned synthetic outside source scope\n');
  fs.symlinkSync(target, path.join(temp, 'apps/mobile/src/external.ts'));
  let targetReads = 0; const read = fs.readFileSync;
  try {
    fs.readFileSync = function(file, ...args) { if (String(file) === target) targetReads++; return read.call(fs, file, ...args); };
    assert.throws(() => wholeImplementationPaths(registry, temp), /unresolved source symlink/);
    fs.unlinkSync(path.join(temp, 'apps/mobile/src/external.ts'));
    fs.mkdirSync(path.join(temp, 'patches'), { recursive: true }); fs.symlinkSync(target, path.join(temp, 'patches/external.patch'));
    assert.throws(() => wholeImplementationPaths(registry, temp), /unresolved source symlink/);
    fs.unlinkSync(path.join(temp, 'patches/external.patch'));
    fs.mkdirSync(path.join(temp, 'fixtures'), { recursive: true }); fs.symlinkSync(target, path.join(temp, 'fixtures/external.bin'));
    assert.throws(() => wholeImplementationPaths(registry, temp), /unresolved source symlink/);
    fs.unlinkSync(path.join(temp, 'fixtures/external.bin')); fs.rmdirSync(path.join(temp, 'fixtures'));
    fs.symlinkSync(path.join(temp, 'missing-fixture-source'), path.join(temp, 'fixtures'));
    assert.throws(() => wholeImplementationPaths(registry, temp), /unresolved source symlink/);
    assert.equal(targetReads, 0);
  } finally { fs.readFileSync = read; }
}));

test('context-selected public documents and actual validator inputs join the census without harvesting unrelated evidence', () => fixture((registry, temp) => {
  const selected = ['docs/new-guide.md', 'docs/nested/new-contract.txt'];
  for (const relative of [...selected, 'docs/unselected-history.md', 'docs/evidence/unselected-receipt.json']) {
    fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true }); fs.writeFileSync(path.join(temp, relative), 'owned synthetic public source\n');
  }
  const sourceHashes = Object.fromEntries(selected.map(relative => [relative, digest(fs.readFileSync(path.join(temp, relative)))]));
  fs.writeFileSync(path.join(temp, '.codex/hooks/cplayout_context_map.json'), JSON.stringify({ sourceHashes }));
  const census = wholeImplementationPaths(registry, temp);
  for (const relative of [...selected, 'docs/agent-context-map.md', 'docs/agent-governance-summary.md', 'docs/examples/cplayout-managed-requirements.toml']) assert(census.includes(relative), relative);
  for (const relative of ['docs/workflow-registry.json', 'docs/development-status.md', 'docs/unselected-history.md', 'docs/evidence/unselected-receipt.json']) assert(!census.includes(relative), relative);
}));

test('context transitive inputs reject private, escaping, external, receipt and circular paths before hydration', () => fixture((registry, temp) => {
  const invalid = ['../outside.md', '/outside.md', 'docs/../outside.md', 'docs\\outside.md', 'docs/.env', 'docs/secrets/input.md', 'docs/workflow-registry.json', 'docs/development-status.md', 'docs/evidence/receipt.json', '.codex/hooks/cplayout_context_map.json', 'outside.md'];
  const contextPath = path.join(temp, '.codex/hooks/cplayout_context_map.json');
  let otherReads = 0; const read = fs.readFileSync;
  try {
    fs.readFileSync = function(file, ...args) { if (String(file) !== contextPath) { otherReads++; throw new Error('unqualified input must not be read'); } return read.call(fs, file, ...args); };
    for (const relative of invalid) {
      fs.writeFileSync(contextPath, JSON.stringify({ sourceHashes: { [relative]: digest('synthetic source') } }));
      assert.throws(() => wholeImplementationPaths(registry, temp), /Invalid repository-relative|outside the public implementation scope|outside the declared implementation roots/, relative);
    }
    assert.equal(otherReads, 0);
  } finally { fs.readFileSync = read; }
}));

test('selected documentation and context map symlinks are refused without reading external targets', () => fixture((registry, temp) => {
  const target = path.join(temp, 'external-document.txt'); fs.writeFileSync(target, 'owned synthetic target\n');
  const contextPath = path.join(temp, '.codex/hooks/cplayout_context_map.json');
  const selected = 'docs/linked-guide.md'; fs.symlinkSync(target, path.join(temp, selected));
  fs.writeFileSync(contextPath, JSON.stringify({ sourceHashes: { [selected]: digest('synthetic selected source') } }));
  let targetReads = 0; const read = fs.readFileSync;
  try {
    fs.readFileSync = function(file, ...args) { if (String(file) === target) targetReads++; return read.call(fs, file, ...args); };
    assert.throws(() => wholeImplementationPaths(registry, temp), /unresolved source symlink/);
    fs.unlinkSync(path.join(temp, selected)); fs.writeFileSync(path.join(temp, selected), 'owned selected source\n');
    fs.unlinkSync(contextPath); fs.symlinkSync(target, contextPath);
    assert.throws(() => wholeImplementationPaths(registry, temp), /unresolved source symlink/);
    assert.equal(targetReads, 0);
  } finally { fs.readFileSync = read; }
}));
test('missing, altered or out-of-scope manifests become unknown without leaking machine paths', () => fixture((registry, temp) => {
  const { evidence } = scopedEvidence(registry, temp);
  fs.unlinkSync(path.join(temp, evidence.sourceManifest));
  const missing = evidenceCurrency(registry, temp).get(evidence.id); assert.equal(missing.status, 'unknown'); assert(!missing.reason.includes(temp));
  evidence.sourceManifest = '../external.json';
  assert.equal(evidenceCurrency(registry, temp).get(evidence.id).status, 'unknown');
  evidence.sourceManifest = 'docs/evidence/current-scope.json'; evidence.sourceScope = ['.env'];
  const sourceHashes = { '.env': digest('synthetic protected-file marker') };
  evidence.sourceFingerprint = digest(JSON.stringify(sourceHashes));
  fs.writeFileSync(path.join(temp, evidence.sourceManifest), JSON.stringify({ sourceHashes, sourceFingerprint: evidence.sourceFingerprint }));
  let protectedReads = 0; const read = fs.readFileSync;
  try {
    fs.readFileSync = function(file, ...args) { if (String(file) === path.join(temp, '.env')) { protectedReads++; throw new Error('protected content must not be read'); } return read.call(fs, file, ...args); };
    assert.equal(evidenceCurrency(registry, temp).get(evidence.id).status, 'unknown');
    assert.equal(protectedReads, 0);
  } finally { fs.readFileSync = read; }
}));

test('dependency automation reports without granting unattended merge or write authority', () => {
  const YAML = require('yaml');
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/dependency-maintenance.yml'), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.on.schedule[0].cron, '17 13 * * *');
  const steps = workflow.jobs.report.steps;
  assert(steps.some(step => step.run === 'node tools/patchDependencySecurity.cjs --check'));
  assert(steps.some(step => step.run === 'npm run audit:verified'));
  assert(steps.filter(step => step.uses).every(step => /^[^@]+@[a-f0-9]{40}$/.test(step.uses)));
  assert(!JSON.stringify(workflow).includes('gh pr merge'));
  const bot = YAML.parse(fs.readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'));
  assert.equal(bot.version, 2);
  assert(bot.updates.every(item => item.schedule.interval === 'weekly'));
  const npm = bot.updates.find(item => item['package-ecosystem'] === 'npm');
  assert.equal(npm.groups['security-fixes']['applies-to'], 'security-updates');
  assert.deepEqual(npm.groups['expo-react-peers']['update-types'], ['minor', 'patch']);
});
