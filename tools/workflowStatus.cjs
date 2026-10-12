'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STATUSES = new Set(['pending', 'in_progress', 'source_implemented', 'verified', 'blocked', 'historical']);
const CLAIMS = new Set(['source', 'browser', 'native_device', 'field', 'hook', 'publication']);
const AUTHORITY_REFERENCES = new Set(['docs/workflow-registry.json', 'docs/development-status.md', 'docs/checkpoints/2026-10-11-unified-workspace-pause.md']);
const SOURCE_ROOTS = ['apps', 'packages', 'tools', 'tests', 'fixtures', 'patches', '.github', '.codex', '.agents'];
const IMPLEMENTATION_ROOTS = new Set(['apps', 'packages', 'tools', 'tests', 'fixtures', 'patches']);
const CONTEXT_MAP_SOURCE = '.codex/hooks/cplayout_context_map.json';
const VALIDATOR_DOCUMENTATION_INPUTS = ['docs/agent-context-map.md', 'docs/agent-governance-summary.md', 'docs/examples/cplayout-managed-requirements.toml'];
const OMIT_SOURCE_DIRS = new Set(['node_modules', 'dist', 'build', '.gradle', '.expo', '.git', '.local', '.cplayout-local', '.cache', '.venv', 'reports', '__pycache__', 'playwright-results', 'playwright-html', 'credentials', 'secrets', 'sessions']);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const privateSource = relative => relative.split('/').some(part => OMIT_SOURCE_DIRS.has(part) ||
  /^(?:\.env(?:\..*)?|\.npmrc|credentials\.(?:json|ya?ml|toml)|auth\.json|id_rsa|id_ed25519|signing\.seed|local\.properties)$/i.test(part) ||
  /\.(?:keystore|jks|p12|pfx|key|pem)$/i.test(part));
const generatedDependencySource = relative => relative === 'apps/mobile/public/maplibre' || relative.startsWith('apps/mobile/public/maplibre/');

function relativeFile(root, relative) {
  assert(nonempty(relative) && !path.isAbsolute(relative) && !relative.includes('\\') &&
    path.posix.normalize(relative) === relative && !relative.split('/').some(part => part === '..' || part === '.' || !part),
  'Invalid repository-relative path: ' + relative);
  const resolved = path.resolve(root, relative);
  assert(resolved.startsWith(path.resolve(root) + path.sep), 'Path escapes the repository');
  return resolved;
}

function regularPublicSource(root, relative) {
  const file = relativeFile(root, relative);
  assert(!privateSource(relative), 'Private/credential material cannot be a canonical source input');
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    assert(!fs.lstatSync(current).isSymbolicLink(), 'Whole-workflow implementation contains an unresolved source symlink; qualify its source ownership separately');
  }
  assert(fs.lstatSync(file).isFile(), 'Canonical source input is not a regular file');
  return file;
}

function contextDocumentationInputs(root) {
  const context = JSON.parse(fs.readFileSync(regularPublicSource(root, CONTEXT_MAP_SOURCE), 'utf8'));
  assert(context.sourceHashes && typeof context.sourceHashes === 'object' && !Array.isArray(context.sourceHashes), 'Context source hash inputs are missing or invalid');
  const documents = [];
  for (const [relative, sourceHash] of Object.entries(context.sourceHashes)) {
    relativeFile(root, relative);
    assert(hash(sourceHash) && !privateSource(relative) && !generatedDependencySource(relative) &&
      !AUTHORITY_REFERENCES.has(relative) && relative !== CONTEXT_MAP_SOURCE && !relative.startsWith('docs/evidence/'),
    'Context source hash input is outside the public implementation scope');
    if (relative.startsWith('docs/')) documents.push(relative);
    else assert(SOURCE_ROOTS.some(scope => relative.startsWith(scope + '/')) ||
      /^(?:package(?:-lock)?\.json|AGENTS\.md)$/.test(relative), 'Context source hash input is outside the declared implementation roots');
  }
  return [...new Set([...documents, ...VALIDATOR_DOCUMENTATION_INPUTS])];
}

function wholeImplementationPaths(registry, root) {
  const files = new Set();
  function visit(directory) {
    const directoryStat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!directoryStat) return;
    const directoryRelative = path.relative(root, directory).split(path.sep).join('/');
    if (directoryStat.isSymbolicLink()) {
      assert(!IMPLEMENTATION_ROOTS.has(directoryRelative), 'Whole-workflow implementation contains an unresolved source symlink; qualify its source ownership separately');
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (privateSource(relative)) continue;
      if (generatedDependencySource(relative)) continue;
      if (OMIT_SOURCE_DIRS.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) continue;
      if (entry.isDirectory()) { if (!OMIT_SOURCE_DIRS.has(entry.name)) visit(full); }
      else if (entry.isFile() && !privateSource(relative)) files.add(relative);
      else if (entry.isSymbolicLink() && IMPLEMENTATION_ROOTS.has(relative.split('/')[0])) assert(false, 'Whole-workflow implementation contains an unresolved source symlink; qualify its source ownership separately');
      // Symlinks and private stores are not hydrated to manufacture source proof.
    }
  }
  for (const directory of SOURCE_ROOTS) visit(path.join(root, directory));
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isFile() &&
    /^(?:package(?:-lock)?\.json|tsconfig(?:\.[a-zA-Z0-9_-]+)*\.json|(?:babel|metro|vite|vitest|jest|webpack|rollup|eslint|prettier|playwright)\.config\.[a-zA-Z0-9.]+|\.nvmrc|\.gitignore|\.gitattributes|AGENTS\.md)$/.test(entry.name)) files.add(entry.name);
  for (const requirement of registry.requirements) for (const relative of requirement.verificationSourcePaths ?? requirement.sourcePaths) if (!AUTHORITY_REFERENCES.has(relative)) {
    assert(!privateSource(relative) && !generatedDependencySource(relative), 'Private/credential or generated dependency material cannot be a required canonical implementation source'); files.add(relative);
  }
  for (const relative of contextDocumentationInputs(root)) { regularPublicSource(root, relative); files.add(relative); }
  return [...files].sort();
}

function evidenceCurrency(registry, root) {
  const result = new Map();
  for (const evidence of registry.evidence) {
    if (evidence.edition === 'historical') { result.set(evidence.id, { status: 'historical', changedPaths: [] }); continue; }
    if (evidence.edition !== 'candidate' || !nonempty(evidence.sourceManifest) || !Array.isArray(evidence.sourceScope) || !evidence.sourceScope.length) {
      result.set(evidence.id, { status: 'unknown', changedPaths: [], reason: 'missing scoped source reference' }); continue;
    }
    try {
      assert(evidence.sourceManifest.startsWith('docs/evidence/') && evidence.sourceManifest.endsWith('.json'), 'source manifest is outside the public evidence scope');
      const manifestFile = relativeFile(root, evidence.sourceManifest), base = fs.realpathSync(root);
      assert(fs.realpathSync(manifestFile).startsWith(base + path.sep), 'source manifest resolves outside the checkout');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')), hashes = manifest.sourceHashes;
      assert(hashes && typeof hashes === 'object' && !Array.isArray(hashes), 'source manifest has no hashes');
      const scope = evidence.sourceScope;
      assert(scope.every(nonempty) && new Set(scope).size === scope.length && Object.keys(hashes).length === scope.length && scope.every(relative => Object.hasOwn(hashes, relative)), 'source manifest does not match its declared scope');
      assert(scope.every(relative => hash(hashes[relative])), 'source manifest has invalid hashes');
      const fingerprint = digest(JSON.stringify(Object.fromEntries(Object.keys(hashes).sort().map(relative => [relative, hashes[relative]]))));
      assert(fingerprint === evidence.sourceFingerprint && manifest.sourceFingerprint === fingerprint, 'source fingerprint does not match its hash manifest');
      const changedPaths = [];
      for (const relative of [...scope].sort()) {
        // Evidence hashing never hydrates secret stores or files outside this checkout.
        assert(!privateSource(relative), 'private/credential source is outside the evidence scope');
        const file = relativeFile(root, relative);
        assert(fs.statSync(file).isFile() && fs.realpathSync(file).startsWith(base + path.sep), 'source resolves outside the checkout');
        if (digest(fs.readFileSync(file)) !== hashes[relative]) changedPaths.push(relative);
      }
      result.set(evidence.id, { status: changedPaths.length ? 'stale' : 'current', changedPaths });
    } catch { result.set(evidence.id, { status: 'unknown', changedPaths: [], reason: 'source reference unavailable, invalid or outside its declared scope' }); }
  }
  return result;
}

function validateRegistry(registry, root) {
  assert(registry && registry.schemaVersion === 1, 'Unsupported workflow registry');
  assert(nonempty(registry.objective) && /^\d{4}-\d{2}-\d{2}$/.test(registry.reviewedOn), 'Missing objective or review date');
  assert(registry.authority?.withdrawnInstructionsActive === false, 'Withdrawn instructions cannot become active authority');
  assert(registry.authority?.decisions === 'delegated_independent_review', 'Decision authority must remain explicit');
  assert(registry.authority?.humanAcceptance === 'not_established', 'Delegated review cannot claim human acceptance');
  assert(Array.isArray(registry.evidence) && Array.isArray(registry.requirements) && Array.isArray(registry.phases), 'Missing workflow collections');
  const evidence = new Map();
  for (const item of registry.evidence) {
    assert(nonempty(item.id) && !evidence.has(item.id), 'Duplicate or invalid evidence ID');
    assert(CLAIMS.has(item.claimClass) && ['pass', 'fail', 'unknown', 'partial'].includes(item.result), 'Invalid evidence claim or result');
    assert(nonempty(item.reference) && nonempty(item.observedOn) && nonempty(item.boundary), 'Evidence lacks provenance or boundary');
    assert(typeof item.commit === 'string' && /^[a-f0-9]{40}$/.test(item.commit), 'Evidence lacks exact source commit');
    if (item.sourceFingerprint !== undefined) assert(hash(item.sourceFingerprint), 'Invalid evidence source fingerprint');
    if (item.requirementIds !== undefined) assert(Array.isArray(item.requirementIds) && item.requirementIds.every(nonempty) && new Set(item.requirementIds).size === item.requirementIds.length, 'Invalid evidence requirement qualification');
    evidence.set(item.id, item);
  }
  const phaseIds = new Set();
  for (const phase of registry.phases) {
    assert(nonempty(phase.id) && !phaseIds.has(phase.id) && STATUSES.has(phase.status) && nonempty(phase.title), 'Invalid or duplicate phase');
    phaseIds.add(phase.id);
  }
  const requirementIds = new Set();
  const currency = evidenceCurrency(registry, root);
  for (const item of registry.requirements) {
    assert(nonempty(item.id) && !requirementIds.has(item.id), 'Duplicate or invalid requirement ID');
    requirementIds.add(item.id);
    assert(phaseIds.has(item.phase) && STATUSES.has(item.status), 'Invalid requirement phase or status');
    assert(nonempty(item.title) && nonempty(item.owner) && nonempty(item.acceptance) && nonempty(item.nextAction), 'Requirement lacks owner, acceptance or next action');
    assert(Array.isArray(item.sourcePaths) && item.sourcePaths.length > 0 && Array.isArray(item.evidenceIds), 'Missing requirement source or evidence references');
    for (const relative of item.sourcePaths) assert(fs.statSync(relativeFile(root, relative)).isFile(), 'Missing requirement source: ' + relative);
    const references = item.authorityReferencePaths ?? [];
    assert(Array.isArray(references) && new Set(references).size === references.length && references.every(relative => item.sourcePaths.includes(relative) && AUTHORITY_REFERENCES.has(relative)), 'Invalid authority-only source reference');
    if (item.verificationSourcePaths !== undefined) assert(Array.isArray(item.verificationSourcePaths) && item.verificationSourcePaths.length > 0 &&
      new Set(item.verificationSourcePaths).size === item.verificationSourcePaths.length && item.verificationSourcePaths.every(relative => item.sourcePaths.includes(relative) && !references.includes(relative)) &&
      item.sourcePaths.filter(relative => !references.includes(relative)).every(relative => item.verificationSourcePaths.includes(relative)), 'Invalid requirement verification source scope: implementation sources cannot be omitted');
    if (references.length) assert(item.verificationSourcePaths !== undefined, 'Authority references require explicit implementation verification sources');
    if (item.verificationCoverage !== undefined) assert(item.verificationCoverage === 'whole_candidate_implementation', 'Unsupported requirement verification coverage');
    assert(item.evidenceIds.every(id => evidence.has(id)), 'Unknown requirement evidence ID');
    assert(Array.isArray(item.dependsOn), 'Missing requirement dependency list');
    if (item.status === 'verified') {
      assert(CLAIMS.has(item.requiredClaimClass), 'Verified requirement lacks a claim class');
      assert(item.evidenceIds.some(id => evidence.get(id).result === 'pass' && evidence.get(id).claimClass === item.requiredClaimClass),
        'Verified requirement has no matching passing evidence');
      assert(item.evidenceIds.some(id => evidence.get(id).result === 'pass' && evidence.get(id).claimClass === item.requiredClaimClass && currency.get(id)?.status === 'current'),
        'Verified requirement has no matching current scoped source evidence');
      const qualified = item.evidenceIds.map(id => evidence.get(id)).filter(proof => proof.result === 'pass' && proof.claimClass === item.requiredClaimClass &&
        currency.get(proof.id)?.status === 'current' && proof.requirementIds?.includes(item.id));
      assert(qualified.length > 0 && (item.verificationSourcePaths ?? item.sourcePaths).every(relative => qualified.some(proof => proof.sourceScope.includes(relative))),
        'Verified requirement lacks explicitly qualified evidence covering its verification source scope');
      if (item.verificationCoverage === 'whole_candidate_implementation') assert(wholeImplementationPaths(registry, root).every(relative => qualified.some(proof => proof.sourceScope.includes(relative))),
        'Whole-workflow verification lacks current evidence covering the complete implementation source scope');
    }
  }
  for (const item of registry.requirements) assert(item.dependsOn.every(id => requirementIds.has(id) && id !== item.id), 'Unknown or self dependency');
  for (const proof of registry.evidence) assert(proof.requirementIds === undefined || proof.requirementIds.every(id => requirementIds.has(id)), 'Evidence qualifies an unknown requirement');
  const visiting = new Set(), visited = new Set();
  const byId = new Map(registry.requirements.map(item => [item.id, item]));
  function visit(id) {
    assert(!visiting.has(id), 'Requirement dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id).dependsOn.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  requirementIds.forEach(visit);
  const historical = registry.historicalStatus;
  assert(historical && hash(historical.sha256), 'Missing preserved historical status hash');
  const historicalBytes = fs.readFileSync(relativeFile(root, historical.path));
  assert(digest(historicalBytes) === historical.sha256, 'Historical status bytes changed');
  const debt = registry.browserDebt;
  assert(Number.isSafeInteger(debt?.deferredCases) && debt.deferredCases >= 0 && debt.originalDeferredCases === 960 && Array.isArray(debt.migrations), 'Deferred browser obligations lack their preserved inventory');
  const migrated = new Set();
  for (const migration of debt.migrations) {
    assert(nonempty(migration.caseId) && !migrated.has(migration.caseId), 'Duplicate or missing migrated browser case');
    const proof = evidence.get(migration.evidenceId);
    assert(proof?.claimClass === 'browser' && proof.result === 'pass' && Array.isArray(proof.caseIds) && proof.caseIds.includes(migration.caseId), 'A migrated browser case needs passing browser evidence naming that exact case');
    assert(currency.get(proof.id)?.status === 'current', 'A migrated browser case needs current scoped source evidence');
    migrated.add(migration.caseId);
  }
  assert(debt.deferredCases + migrated.size === debt.originalDeferredCases, 'Deferred browser obligations cannot disappear without migration evidence');
  assert(registry.browserDebt.contractsRetired === false && registry.cleanup?.qualifiedDeletionTargets === 0, 'No retirement or deletion qualification is recorded');
  assert(['unknown', 'verified'].includes(registry.hooks?.execution) && registry.hooks?.stopContinuation === 'disabled', 'Unsupported hook execution or continuation claim');
  if (registry.hooks.execution === 'verified') assert(registry.evidence.some(item => item.claimClass === 'hook' && item.result === 'pass' && item.method === 'runtime_event'), 'Unsupported hook execution claim without actual runtime event evidence');
  return registry;
}

const safe = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
function renderStatus(registry, currency = new Map()) {
  const lines = [
    '# Development Status', '',
    'Generated from [workflow-registry.json](workflow-registry.json) by `node tools/workflowStatus.cjs --write`. Edit the registry; do not hand-edit this projection.', '',
    `Reviewed ${registry.reviewedOn}. ${registry.objective}`, '',
    'The current user request resumes bounded improvement work and delegates decisions to independent source-backed review. Preceding AGENTS instructions remain withdrawn. Delegated acceptance and human acceptance are separate; human acceptance has not been established.', '',
    '## Verified baseline and current candidate', '',
    `Baseline commit: \`${registry.baseline.commit}\`. Publication: ${registry.baseline.publication}.`, '',
    registry.baseline.verification, '',
    `Current candidate: ${registry.candidate.status}. ${registry.candidate.boundary}`, '',
    `Dependency observation: ${registry.dependencyHealth.summary}`, '',
    `Deferred browser obligations: ${registry.browserDebt.deferredCases}; their semantic contracts remain required. Hook execution: ${registry.hooks.execution}; Stop continuation: ${registry.hooks.stopContinuation}.`, '',
    '## Master phases and modules', '',
    '| Phase | Status | Outcome |', '| --- | --- | --- |'
  ];
  for (const phase of registry.phases) lines.push(`| ${safe(phase.id)} | ${safe(phase.status)} | ${safe(phase.title)} |`);
  lines.push('', '| Requirement | Status | Owner | Next action |', '| --- | --- | --- | --- |');
  for (const item of registry.requirements) lines.push(`| ${safe(item.id)}: ${safe(item.title)} | ${safe(item.status)} | ${safe(item.owner)} | ${safe(item.nextAction)} |`);
  if (registry.reviewRounds) {
    lines.push('', '## Independent review and unresolved defects', '',
      `Accepted consecutive final reviews: ${registry.reviewRounds.acceptedConsecutiveFinalReviews}/${registry.reviewRounds.requiredConsecutivePassingFinalReviews}. Initial review: ${safe(registry.reviewRounds.initialReviewResult)}. ${safe(registry.reviewRounds.boundary)}`, '',
      '| Finding | Severity / status | Requirements | Required recheck |', '| --- | --- | --- | --- |');
    for (const finding of registry.reviewFindings ?? []) lines.push(`| ${safe(finding.id)}: ${safe(finding.description)} | ${safe(finding.severity)} / ${safe(finding.status)} | ${safe(finding.requirements.join(', '))} | ${safe(finding.verificationRequired)} |`);
  }
  if (registry.browserDebt.inventory) {
    const inventory = registry.browserDebt.inventory;
    lines.push('', `Browser inventory accounting: ${inventory.counts.files} suites; ${inventory.counts.uniqueCases} unique cases; ${inventory.counts.currentExecutions} current-scope executions; ${inventory.counts.deferredExecutions} deferred; ${inventory.counts.allExecutions} total. ${safe(inventory.qualification)} Runtime acceptance: ${safe(inventory.runtimeAcceptance)}.`);
  }
  lines.push('', '## Source currency of recorded evidence', '',
    '| Evidence | Recorded result | Edition / source currency | Drift or missing proof |', '| --- | --- | --- | --- |');
  for (const item of registry.evidence) {
    const state = currency.get(item.id) ?? { status: 'unknown', changedPaths: [], reason: 'source reference not evaluated' };
    lines.push(`| ${safe(item.id)} (${safe(item.claimClass)}) | ${safe(item.result)} | ${safe(state.status)} | ${safe(state.changedPaths.length ? state.changedPaths.join(', ') : state.reason ?? item.boundary)} |`);
  }
  lines.push('', '## Evidence and history', '',
    'Requirement acceptance, dependencies, exact evidence classes and source identities live in the registry. A passing subset never completes the entire workflow. Publication is separate from source, browser, native/device, field and hook qualification.', '',
    `The complete preceding status file is retained byte-for-byte in [the historical archive](${registry.historicalStatus.path.replace(/^docs\//, '')}); SHA-256 \`${registry.historicalStatus.sha256}\`.`, '',
    'Use the [master contract](unified-workspace-refocus-2026-10-10.md), [operator guide](operator-workflow-guide.md), [skill inventory](skill-capability-inventory.md) and [retirement manifest](workflow-retirement-manifest.json) for the selected task. Historical records are retrieved for a specific question, not loaded as current instructions.', '');
  return lines.join('\n');
}

function run(root, write) {
  const registry = validateRegistry(JSON.parse(fs.readFileSync(path.join(root, 'docs/workflow-registry.json'), 'utf8')), root);
  const target = path.join(root, 'docs/development-status.md');
  const output = renderStatus(registry, evidenceCurrency(registry, root));
  if (write) fs.writeFileSync(target, output);
  else assert(fs.readFileSync(target, 'utf8') === output, 'Development status is stale; run node tools/workflowStatus.cjs --write');
  return `${registry.requirements.length} requirements; ${registry.evidence.length} source-bound evidence records; historical bytes preserved`;
}

module.exports = { validateRegistry, renderStatus, run, digest, evidenceCurrency, wholeImplementationPaths };
if (require.main === module) {
  try {
    assert(process.argv.length === 3 && ['--write', '--check'].includes(process.argv[2]), 'Usage: node tools/workflowStatus.cjs --write|--check');
    console.log(run(path.resolve(__dirname, '..'), process.argv[2] === '--write'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
