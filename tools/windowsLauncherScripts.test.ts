import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launch = readFileSync("tools/windows/Launch-CPLayoutWeb.ps1", "utf8");
assert.match(launch, /wsl\.exe -d \$Distro --cd \$RepoPath -- bash -l -s --/);
assert.match(launch, /npm run ui:test:start -- --no-open/);
assert.match(launch, /Start-Process \$url/);
assert.match(launch, /http:\/\/127\\\.0\\\.0\\\.1:\\d\+/);
assert.doesNotMatch(launch, /\/mnt\/h\/cplayout/);
assert.match(launch, /CRLF-safe/);

const install = readFileSync("tools/windows/Install-CPLayoutDesktopShortcut.ps1", "utf8");
assert.match(install, /WScript\.Shell/);
assert.match(install, /CPLayout Web Test\.lnk/);
assert.match(install, /Stop CPLayout Web Test\.lnk/);
assert.match(install, /Launch-CPLayoutWeb\.ps1/);
assert.doesNotMatch(install, /\\\\wsl\.localhost\\Ubuntu\\mnt/);
const stop = readFileSync("tools/windows/Stop-CPLayoutWeb.ps1", "utf8");
assert.match(stop, /Mandatory=\$true/);
assert.match(stop, /ui:test:stop -- --mode ui-test --port/);

console.log("Windows launcher script tests passed");
