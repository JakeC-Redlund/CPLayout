import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessStaticExport, staticHealthResponse } from "./serveStaticWeb";

const root = mkdtempSync(join(tmpdir(), "cplayout-static-health-"));
try {
  assert.deepEqual(assessStaticExport(root), { ok: false, missing: ["index.html"] });
  assert.equal(staticHealthResponse(root).statusCode, 503);
  writeFileSync(join(root, "index.html"), '<link href="/_expo/app.css"><script src="/_expo/app.js"></script>');
  assert.deepEqual(assessStaticExport(root), {
    ok: false,
    missing: ["/_expo/app.css", "/_expo/app.js"],
  });
  mkdirSync(join(root, "_expo"));
  writeFileSync(join(root, "_expo/app.css"), "body {}");
  assert.deepEqual(assessStaticExport(root), { ok: false, missing: ["/_expo/app.js"] });
  writeFileSync(join(root, "_expo/app.js"), "void 0;");
  assert.deepEqual(assessStaticExport(root), { ok: true, missing: [] });
  assert.equal(staticHealthResponse(root).statusCode, 200);
  writeFileSync(join(root, "_expo/app.css"), "body { background: url('./missing.png'); }");
  assert.deepEqual(assessStaticExport(root), { ok: false, missing: ["/_expo/missing.png"] });
  writeFileSync(join(root, "_expo/missing.png"), "image");
  assert.equal(staticHealthResponse(root).statusCode, 200);
  console.log("static web health tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
