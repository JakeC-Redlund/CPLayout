import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertBrowserProofInventory, buildBrowserProofInventory, BROWSER_PROOF_INVENTORY_PATH, type BrowserProofInventory } from "./browserProofRegistry";

export function runBrowserProofInventory(args: readonly string[], root = process.cwd()): void {
  let write = false, discoveryPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--write" && !write) write = true;
    else if (args[i] === "--discovery" && discoveryPath === null && args[i + 1] && !args[i + 1].startsWith("--")) discoveryPath = args[++i];
    else throw new Error(`Unknown or incomplete browser inventory argument: ${args[i]}`);
  }
  if (write && !discoveryPath) throw new Error("--write requires an explicitly supplied complete --discovery JSON; no browser/build is invoked.");
  const discovery = discoveryPath ? JSON.parse(readFileSync(resolve(root, discoveryPath), "utf8")) : undefined;
  const destination = resolve(root, BROWSER_PROOF_INVENTORY_PATH);
  const inventory = write ? buildBrowserProofInventory(root, discovery) : JSON.parse(readFileSync(destination, "utf8")) as BrowserProofInventory;
  assertBrowserProofInventory(root, inventory, discovery);
  if (write) writeFileSync(destination, JSON.stringify(inventory, null, 2) + "\n");
  console.log(`Browser inventory ${write ? "written" : "verified"}: ${inventory.counts.currentExecutions} current, ${inventory.counts.deferredExecutions} deferred, ${inventory.counts.allExecutions} total; no execution claim.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runBrowserProofInventory(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
