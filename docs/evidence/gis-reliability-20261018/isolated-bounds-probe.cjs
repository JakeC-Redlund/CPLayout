#!/usr/bin/env node
'use strict';

// Private, isolated adapter/library qualification. It deliberately does not load
// the CPLayout App or qualify portable app:// packages, native files or a device.
// Run only after the coordinator has frozen source and taken browser/server custody.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createReadStream, readFileSync, realpathSync, existsSync } = require('node:fs');
const { mkdir, mkdtemp, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const { dirname, join, resolve } = require('node:path');
const { platform, release, arch } = require('node:os');

const sha256 = value => createHash('sha256').update(value).digest('hex');
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function argumentsForProbe(argv) {
  const result = { workspace: '/mnt/h/CPLayout', output: null };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--workspace', '--output'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('Usage: node maplibre-bounds-probe.cjs [--workspace /absolute/source] [--output /new/report-directory]');
    }
    result[key.slice(2)] = resolve(value);
  }
  return result;
}
function varint(value) {
  const bytes = [];
  while (value > 127) { bytes.push((value & 127) | 128); value >>>= 7; }
  bytes.push(value); return Buffer.from(bytes);
}
function pbfNumber(field, value) { return Buffer.concat([varint(field * 8), varint(value)]); }
function pbfBytes(field, value) { return Buffer.concat([varint(field * 8 + 2), varint(value.length), value]); }
function zigzag(value) { return value >= 0 ? value * 2 : -value * 2 - 1; }
function syntheticVectorTile() {
  const layer = (name, vertical) => {
    const geometry = vertical ? [9, zigzag(2048), zigzag(256), 10, zigzag(0), zigzag(3584)]
      : [9, zigzag(256), zigzag(2048), 10, zigzag(3584), zigzag(0)];
    const feature = Buffer.concat([pbfNumber(1, 1), pbfNumber(3, 2), pbfBytes(4, Buffer.concat(geometry.map(varint)))]);
    return pbfBytes(3, Buffer.concat([pbfNumber(15, 2), pbfBytes(1, Buffer.from(name)), pbfBytes(2, feature), pbfNumber(5, 4096)]));
  };
  return Buffer.concat([layer('roads', false), layer('borders', true)]);
}
function tileExtent(z, x, y) {
  const n = 2 ** z, latitude = row => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n))) * 180 / Math.PI;
  assert(Number.isInteger(z) && z >= 0 && z <= 22 && Number.isInteger(x) && x >= 0 && x < n && Number.isInteger(y) && y >= 0 && y < n, 'Request must contain canonical XYZ coordinates.');
  return [x / n * 360 - 180, latitude(y + 1), (x + 1) / n * 360 - 180, latitude(y)];
}
function intersects(a, b) { return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3]; }

async function main() {
  const options = argumentsForProbe(process.argv.slice(2));
  const workspace = realpathSync(options.workspace), requireWorkspace = createRequire(join(workspace, 'package.json'));
  // Select the existing task-owned browser installation; never download anything.
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/home/cyber/.cache/cplayout/gis-20261018/browsers';
  require(requireWorkspace.resolve('tsx/cjs'));
  const corePath = relative => join(workspace, 'packages/core/src', relative);
  const adaptersPath = relative => join(workspace, 'packages/map-adapters/src', relative);
  const { toMapLibreTileSourceDescriptor, describeTilePackageReadiness } = require(corePath('mapTilePackages.ts'));
  const { defaultAppSettings } = require(corePath('settings.ts'));
  const { resolveReferenceOverlaySource } = require(corePath('referenceOverlays.ts'));
  const { buildWorkbenchStyle, rasterStyleSourceFromTileDescriptor } = require(adaptersPath('mapWorkbenchStyle.ts'));
  const { buildReferenceOverlayStyleParts } = require(adaptersPath('referenceOverlayStyle.ts'));
  const { encodeRgbaPng, analyzePngPixels } = require(join(workspace, 'tools/pngMetrics.ts'));
  const { chromium } = requireWorkspace('playwright');
  const requireAdapters = createRequire(join(workspace, 'packages/map-adapters/package.json'));
  assert.equal(realpathSync(requireAdapters.resolve('@cplayout/core')), realpathSync(corePath('index.ts')), 'Production builders and direct descriptor must resolve the same Core edition.');
  const maplibreManifestPath = requireAdapters.resolve('maplibre-gl/package.json');
  const maplibreManifest = JSON.parse(readFileSync(maplibreManifestPath, 'utf8'));
  assert.equal(maplibreManifest.version, '6.15.0', 'This packet qualifies the selected 6.15.0 candidate only.');
  const packageDirectory = dirname(maplibreManifestPath);
  const assetPaths = ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css'];
  const assets = Object.fromEntries(assetPaths.map(name => [name, readFileSync(join(packageDirectory, 'dist', name))]));
  assets['LICENSE.txt'] = readFileSync(join(packageDirectory, 'LICENSE.txt'));
  // 6.15 publishes ESM rather than a UMD distribution. Serve the official bytes;
  // no undeclared bundler or modified library is used.
  const umdAvailable = existsSync(join(packageDirectory, 'dist/maplibre-gl.js'));
  const productionFiles = ['packages/core/src/mapTilePackages.ts', 'packages/core/src/settings.ts', 'packages/core/src/types.ts',
    'packages/core/src/referenceOverlays.ts', 'packages/core/src/index.ts', 'packages/map-adapters/src/mapWorkbenchStyle.ts',
    'packages/map-adapters/src/referenceOverlayStyle.ts', 'tools/pngMetrics.ts', 'package-lock.json'];
  const sourceHashes = Object.fromEntries(productionFiles.map(path => [path, sha256(readFileSync(join(workspace, path)))]));
  const executable = chromium.executablePath();
  assert(existsSync(executable), 'The selected Chromium executable must already be installed.');
  const parentOutput = join(dirname(__filename), 'runs');
  await mkdir(parentOutput, { recursive: true });
  const output = options.output || await mkdtemp(join(parentOutput, 'maplibre-bounds-'));
  if (options.output) await mkdir(output, { recursive: false });
  const report = {
    schemaVersion: 'cplayout-isolated-maplibre-bounds-v1', status: 'running', startedAt: new Date().toISOString(),
    classification: 'isolated-actual-browser-adapter-library-qualification', workspace,
    scope: { appNavigation: false, portablePackageResolver: false, nativeFileIntegration: false, nativeDevice: false,
      boundConsumers: ['production raster imagery source', 'production vector reference-overlay source'],
      excluded: ['offline label/font parity', 'current App portable app:// package rendering', 'native rendering', 'field accuracy'] },
    source: { scope: 'Named production descriptor/style helpers and reviewed lock; not the whole App or workspace graph', files: sourceHashes, fingerprint: sha256(JSON.stringify(sourceHashes)), harnessSha256: sha256(readFileSync(__filename)) },
    runtime: { node: process.version, os: { platform: platform(), release: release(), arch: arch() },
      playwright: requireWorkspace('playwright/package.json').version, expectedChromiumMajor: 156,
      launch: { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 }, browserExecutable: executable, browserExecutableSha256: await fileHash(executable), maplibre: maplibreManifest.version,
      distribution: umdAvailable ? 'ESM explicitly selected; UMD also present' : 'official ESM; no UMD distribution present' },
    assets: Object.fromEntries(Object.entries(assets).map(([name, bytes]) => [name, { sha256: sha256(bytes), bytes: bytes.length, requests: 0 }])),
    requests: [], unexpectedNetwork: [], pageErrors: [], mapErrors: [], assertions: [], screenshots: {}, cleanup: {},
  };
  const bounds = [-105.02, 40.635, -104.98, 40.665], center = [-105, 40.65], farCenter = [70, -20];
  const rgba = new Uint8Array(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) rgba.set((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? [30, 70, 110, 255] : [170, 30, 70, 255], (y * 256 + x) * 4);
  const rasterPng = Buffer.from(encodeRgbaPng(256, 256, rgba)), vectorPbf = syntheticVectorTile();
  report.synthetic = { attribution: 'CPLayout generated fixture; no captured imagery', bounds, center, farCenter,
    png: { sha256: sha256(rasterPng), bytes: rasterPng.length }, vector: { sha256: sha256(vectorPbf), bytes: vectorPbf.length, layers: ['roads', 'borders'] } };
  let phase = 'boot', origin = null, productionStyle = null, probeStyle = null, browser = null, context = null, page = null;
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url, origin || 'http://127.0.0.1');
      const send = (status, contentType, body) => { response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' }); response.end(body); };
      if (request.method !== 'GET' || url.search || url.username || url.password) { report.unexpectedNetwork.push({ phase, url: url.href, method: request.method }); return send(404, 'text/plain', 'Unsupported probe request'); }
      if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', htmlPage());
      if (url.pathname === '/style.json') return send(200, 'application/json', JSON.stringify(probeStyle));
      if (url.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
      const asset = /^\/assets\/([^/]+)$/.exec(url.pathname)?.[1];
      if (asset && assets[asset]) { report.assets[asset].requests++; return send(200, asset.endsWith('.css') ? 'text/css' : asset.endsWith('.mjs') ? 'text/javascript' : 'text/plain', assets[asset]); }
      const tile = /^\/(raster|vector)\/(\d+)\/(\d+)\/(\d+)\.(png|pbf)$/.exec(url.pathname);
      if (tile && ((tile[1] === 'raster' && tile[5] === 'png') || (tile[1] === 'vector' && tile[5] === 'pbf'))) {
        const z = +tile[2], x = +tile[3], y = +tile[4], extent = tileExtent(z, x, y);
        report.requests.push({ phase, source: tile[1], z, x, y, url: url.href, extent, intersectsAdmittedBounds: intersects(extent, bounds) });
        return send(200, tile[1] === 'raster' ? 'image/png' : 'application/vnd.mapbox-vector-tile', tile[1] === 'raster' ? rasterPng : vectorPbf);
      }
      report.unexpectedNetwork.push({ phase, url: url.href }); send(404, 'text/plain', 'Unknown probe resource');
    } catch (error) { report.unexpectedNetwork.push({ phase, error: String(error) }); response.writeHead(500); response.end(); }
  });
  function htmlPage() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Isolated CPLayout bounds qualification</title><link rel="stylesheet" href="/assets/maplibre-gl.css"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#map{width:900px;height:620px}</style></head><body><div id="map"></div><script type="module">
      import * as maplibre from '/assets/maplibre-gl.mjs';
      const failures = [];
      maplibre.setWorkerUrl('/assets/maplibre-gl-worker.mjs');
      maplibre.setWorkerCount(1);
      const style = await fetch('/style.json').then(response => response.json());
      const map = new maplibre.Map({container:'map',style,center:${JSON.stringify(center)},zoom:14,renderWorldCopies:false,fadeDuration:0,attributionControl:{compact:false},interactive:false});
      map.on('error', event => failures.push(event.error?.message || String(event.error)));
      async function settle() {
        await new Promise((resolve,reject) => {
          const timer = setTimeout(() => {map.off('idle',done);reject(new Error('Actual MapLibre did not settle'));},20000);
          function done(){if(map.loaded() && !map.isMoving() && map.areTilesLoaded()){clearTimeout(timer);map.off('idle',done);requestAnimationFrame(()=>requestAnimationFrame(resolve));}}
          map.on('idle',done);done();map.triggerRepaint();
        });
      }
      window.boundsProbe = {map,failures,settle,version:maplibre.getVersion(),ready:false};
      try {await settle();window.boundsProbe.ready=true;} catch(error){window.boundsProbe.bootError=error.message;}
    </script></body></html>`;
  }
  const check = (label, condition) => { assert(condition, label); report.assertions.push(label); };
  const state = () => page.evaluate(() => ({ version: window.boundsProbe.version, center: window.boundsProbe.map.getCenter().toArray(), zoom: window.boundsProbe.map.getZoom(),
    bounds: window.boundsProbe.map.getBounds().toArray(), sources: window.boundsProbe.map.getStyle().sources, failures: [...window.boundsProbe.failures] }));
  const screenshot = async name => {
    const box = await page.locator('#map').boundingBox();
    assert(box); const bytes = await page.screenshot({ clip: { x: box.x + box.width / 2 - 40, y: box.y + box.height / 2 - 40, width: 80, height: 80 }, animations: 'disabled', scale: 'css' });
    await writeFile(join(output, `${name}.png`), bytes);
    const result = { path: `${name}.png`, sha256: sha256(bytes), metrics: analyzePngPixels(bytes) }; report.screenshots[name] = result; return result;
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    report.server = { origin, host: '127.0.0.1', port: server.address().port, harnessPid: process.pid };
    const rasterManifest = { id: 'isolated-raster-bounds', name: 'Synthetic raster bounds', packageType: 'raster_tiles', tileContentType: 'raster', uri: `${origin}/raster/`,
      minZoom: 12, maxZoom: 16, tileScheme: 'xyz', boundsWgs84: { minLongitude: bounds[0], minLatitude: bounds[1], maxLongitude: bounds[2], maxLatitude: bounds[3] },
      tileUrlTemplates: [`${origin}/raster/{z}/{x}/{y}.png`], installStatus: 'available', attribution: 'CPLayout Synthetic raster tiles', licenseText: 'Generated synthetic test pixels; offline copying permitted.', importedAt: '2026-10-18T12:00:00.000Z',
      imageryProvenance: { providerId: 'cplayout-generated-fixture', providerName: 'CPLayout generated raster', accessedAt: '2026-10-18T12:00:00.000Z', attribution: 'CPLayout Synthetic raster tiles', licenseText: 'Generated synthetic test pixels; offline copying permitted.', offlineCopyAllowed: true, keyedService: false } };
    const vectorManifest = { ...rasterManifest, id: 'isolated-vector-bounds', name: 'Synthetic vector bounds', tileContentType: 'vector', uri: `${origin}/vector/`, tileUrlTemplates: [`${origin}/vector/{z}/{x}/{y}.pbf`], attribution: 'CPLayout Synthetic vector tiles',
      vectorOverlay: { schema: 'cplayout_reference_v1', sourceLayers: { roads: 'roads', roadLabels: 'road_labels', borders: 'borders', places: 'places' } } };
    const rasterDescriptor = toMapLibreTileSourceDescriptor(rasterManifest), vectorDescriptor = toMapLibreTileSourceDescriptor(vectorManifest);
    assert(rasterDescriptor && vectorDescriptor); assert.deepEqual(rasterDescriptor.bounds, bounds); assert.deepEqual(vectorDescriptor.bounds, bounds);
    assert.equal(describeTilePackageReadiness(rasterManifest, 'web_maplibre_gl_js').canRender, true);
    const settings = defaultAppSettings(), preferences = { ...settings.referenceOverlay, mode: 'manual', sourcePackageId: vectorManifest.id, labels: false };
    const reference = resolveReferenceOverlaySource({ mapPackages: [vectorManifest], preferences, target: 'web_maplibre_gl_js' });
    assert(reference.canRender);
    const vectorParts = buildReferenceOverlayStyleParts(reference, preferences);
    productionStyle = buildWorkbenchStyle(rasterStyleSourceFromTileDescriptor(rasterDescriptor), { type: 'FeatureCollection', features: [] }, reference, preferences);
    assert.deepEqual(vectorParts.sources['reference-overlay'].bounds, bounds); assert.deepEqual(productionStyle.sources.imagery.bounds, bounds);
    assert.deepEqual(productionStyle.sources['reference-overlay'].bounds, bounds);
    // The packet qualifies source bounds and tile requests. Omit symbol layers
    // explicitly to keep the separately gated glyph/font contract out of this probe.
    probeStyle = { ...productionStyle, layers: productionStyle.layers.filter(layer => layer.type !== 'symbol') };
    report.sources = { manifests: { raster: rasterManifest, vector: vectorManifest }, descriptors: { raster: rasterDescriptor, vector: vectorDescriptor },
      productionStyleSha256: sha256(JSON.stringify(productionStyle)), probeStyleSha256: sha256(JSON.stringify(probeStyle)),
      omittedSymbolLayers: productionStyle.layers.filter(layer => layer.type === 'symbol').map(layer => layer.id) };
    await writeFile(join(output, 'production-style.json'), JSON.stringify(productionStyle, null, 2));
    await writeFile(join(output, 'executed-style.json'), JSON.stringify(probeStyle, null, 2));
    browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    report.runtime.browserVersion = browser.version();
    check('Actual Chromium major is 156', /^156\./.test(browser.version()));
    context = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'en-US', timezoneId: 'America/Denver', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`)) return route.continue();
      report.unexpectedNetwork.push({ phase, url, blocked: true }); return route.abort('blockedbyclient');
    });
    page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    phase = 'bounded-inside'; await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.boundsProbe?.ready || window.boundsProbe?.bootError, null, { timeout: 30000 });
    const bootError = await page.evaluate(() => window.boundsProbe.bootError || null); assert.equal(bootError, null);
    const inside = await state(); report.inside = inside;
    check('Actual browser loads selected MapLibre 6.15.0 ESM', inside.version === '6.15.0');
    assert.deepEqual(inside.sources.imagery.bounds, bounds); assert.deepEqual(inside.sources['reference-overlay'].bounds, bounds);
    check('Actual raster and vector style sources retain exact finite production bounds', true);
    for (const source of ['raster', 'vector']) check(`Actual bounded inside view requests ${source} tiles`, report.requests.some(request => request.phase === phase && request.source === source));
    check('Every bounded inside raster/vector request intersects admitted geographic bounds', report.requests.filter(request => request.phase === phase).every(request => request.intersectsAdmittedBounds));
    check('Actual locally served MapLibre worker was requested', report.assets['maplibre-gl-worker.mjs'].requests > 0);
    const credits = await page.locator('.maplibregl-ctrl-attrib-inner').innerText(); report.credits = credits;
    check('Actual MapLibre attribution names synthetic raster and vector sources', credits.includes('Synthetic raster tiles') && credits.includes('Synthetic vector tiles'));
    const painted = await screenshot('bounded-inside-painted');
    await page.evaluate(async () => { window.boundsProbe.map.setLayoutProperty('imagery', 'visibility', 'none'); await window.boundsProbe.settle(); });
    const hidden = await screenshot('bounded-inside-imagery-hidden');
    check('Actual raster pixels paint the center region: hiding only imagery changes mean grayscale by more than 15', Math.abs(painted.metrics.grayMean - hidden.metrics.grayMean) > 15);
    await page.evaluate(async () => { window.boundsProbe.map.setLayoutProperty('imagery', 'visibility', 'visible'); await window.boundsProbe.settle(); });
    phase = 'bounded-outside'; await page.evaluate(async far => { window.boundsProbe.map.jumpTo({ center: far, zoom: 14 }); await window.boundsProbe.settle(); }, farCenter);
    report.outside = await state(); await screenshot('bounded-outside');
    check('Actual far camera does not intersect admitted bounds', !intersects([report.outside.bounds[0][0], report.outside.bounds[0][1], report.outside.bounds[1][0], report.outside.bounds[1][1]], bounds));
    check('Far camera issues zero raster/vector requests with production bounds', report.requests.filter(request => request.phase === phase).length === 0);
    // Positive counterprobe: the same working transport and far view must issue
    // out-of-extent requests when bounds are deliberately omitted on this private page.
    phase = 'unbounded-counterprobe';
    const unbounded = structuredClone(probeStyle); delete unbounded.sources.imagery.bounds; delete unbounded.sources['reference-overlay'].bounds;
    await page.evaluate(async style => { window.boundsProbe.map.setStyle(style, { diff: false }); await window.boundsProbe.settle(); }, unbounded);
    report.unboundedCounterprobe = await state();
    for (const source of ['raster', 'vector']) check(`Unbounded positive counterprobe requests far ${source} tiles`, report.requests.some(request => request.phase === phase && request.source === source && !request.intersectsAdmittedBounds));
    check('Counterprobe far requests are outside admitted bounds', report.requests.filter(request => request.phase === phase).every(request => !request.intersectsAdmittedBounds));
    await screenshot('unbounded-counterprobe');
    report.mapErrors = await page.evaluate(() => [...window.boundsProbe.failures]);
    check('No actual MapLibre source/style/worker error occurred', report.mapErrors.length === 0);
    check('No page execution error occurred', report.pageErrors.length === 0);
    check('No external or unknown network resource was requested', report.unexpectedNetwork.length === 0);
    const after = Object.fromEntries(productionFiles.map(path => [path, sha256(readFileSync(join(workspace, path)))]));
    assert.deepEqual(after, sourceHashes); check('Production source and lock bytes stayed frozen throughout actual browser execution', true);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { message: error.message, stack: error.stack };
    if (page && !page.isClosed()) { try { report.mapErrors = await page.evaluate(() => window.boundsProbe?.failures || []); await page.screenshot({ path: join(output, 'failure.png') }); } catch {} }
  } finally {
    if (page) { try { await page.evaluate(() => window.boundsProbe?.map.remove()); } catch (error) { report.cleanup.mapRemovalError = String(error); } }
    if (context) { try { await context.close(); report.cleanup.contextClosed = true; } catch (error) { report.cleanup.contextCloseError = String(error); } }
    if (browser) { try { await browser.close(); report.cleanup.browserDisconnected = !browser.isConnected(); } catch (error) { report.cleanup.browserCloseError = String(error); } }
    if (server.listening) { server.closeIdleConnections(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    report.cleanup.serverListening = server.listening;
    report.completedAt = new Date().toISOString();
    if (Object.keys(report.cleanup).some(key => /Error$/.test(key)) || report.cleanup.serverListening || browser && report.cleanup.browserDisconnected !== true) report.status = 'failed';
    await writeFile(join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, output, assertions: report.assertions.length, requests: report.requests.length, evidenceSha256: sha256(readFileSync(join(output, 'evidence.json'))) }));
  }
  if (report.status !== 'passed') process.exitCode = 1;
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
