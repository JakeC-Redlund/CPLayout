import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, readPublicServiceConfig } from "@cplayout/auth-client";
import { TestDatabase } from "../apps/api/src/testDatabase";
import { createProductionGateway, injectProductionPublicConfig, resolveProductionAsset } from "./serveProductionApp";

test("production asset resolution refuses traversal, hidden files, external symlinks and missing bundle paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "cplayout-gateway-"));
  try {
    await mkdir(join(root, "site")); await writeFile(join(root, "site", "index.html"), "<head></head>"); await writeFile(join(root, "outside.txt"), "owned test outside root");
    await symlink(join(root, "outside.txt"), join(root, "site", "escape.txt"));
    for (const path of ["/../outside.txt", "/%2e%2e/outside.txt", "/.env", "/escape.txt", "/_expo/missing.js", "/api/v1/unknown"]) assert.equal(await resolveProductionAsset(join(root, "site"), path), null);
    assert.equal(await resolveProductionAsset(join(root, "site"), "/customers"), join(root, "site", "index.html"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("same-origin gateway serves actual API and trusted public key without a seeded account or signing seed", async () => {
  const root = await mkdtemp(join(tmpdir(), "cplayout-gateway-")), signingKey = randomBytes(32), publicKey = bytesToHex(ed25519.getPublicKey(signingKey));
  let gateway: Awaited<ReturnType<typeof createProductionGateway>> | null = null;
  try {
    await writeFile(join(root, "index.html"), "<!doctype html><html><head><title>CPLayout</title></head><body><script src='/app.js'></script></body></html>"); await writeFile(join(root, "app.js"), "window.fixtureAssetLoaded=true;");
    const database = new TestDatabase(); gateway = await createProductionGateway({ database, signingKey, origin: "http://localhost:19040", secureCookies: false, appDist: root });
    const page = await gateway.inject({ url: "/" }); assert.equal(page.statusCode, 200); assert(page.body.indexOf("__CPLAYOUT_PUBLIC_CONFIG__") < page.body.indexOf("src='/app.js'"));
    assert(page.body.includes(publicKey)); assert.equal(page.body.includes(bytesToHex(signingKey)), false);
    assert.equal((await gateway.inject({ url: "/api/v1/session" })).statusCode, 401); assert.equal(database.state.users.length, 0);
    const asset = await gateway.inject({ url: "/app.js" }); assert.equal(asset.statusCode, 200); assert.match(String(asset.headers["content-type"]), /javascript/); assert.equal(asset.headers["x-content-type-options"], "nosniff");
    assert.equal((await gateway.inject({ url: "/_expo/missing.js" })).statusCode, 404);
    assert.equal(readPublicServiceConfig({ __CPLAYOUT_PUBLIC_CONFIG__: { apiUrl: "", offlinePublicKey: publicKey } })!.offlinePublicKey, publicKey);
    assert.throws(() => injectProductionPublicConfig("<head></head>", "invalid"));
    assert.throws(() => readPublicServiceConfig({ __CPLAYOUT_PUBLIC_CONFIG__: { apiUrl: "http://remote.example", offlinePublicKey: publicKey } }));
  } finally { await gateway?.close(); await rm(root, { recursive: true, force: true }); }
});
