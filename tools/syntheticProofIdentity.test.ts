import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { withSyntheticProofIdentity } from "./syntheticProofIdentity";

test("proof export and service share a private temporary seed and restore all state after failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cplayout-proof-identity-"));
  const environment: NodeJS.ProcessEnv = {};
  try {
    await assert.rejects(withSyntheticProofIdentity(directory, async () => {
      const path = environment.CPLAYOUT_TEST_SIGNING_SEED!;
      const bytes = Buffer.from(await readFile(path, "utf8"), "hex");
      assert.equal(bytes.length, 32);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      assert.equal(environment.EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY, Buffer.from(ed25519.getPublicKey(bytes)).toString("hex"));
      throw new Error("Observed export failure");
    }, environment), /Observed export failure/);
    assert.deepEqual(environment, {});
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a supplied mismatched deployment pin refuses proof before any application work", async () => {
  const environment = { CPLAYOUT_TEST_SIGNING_SEED: "01".repeat(32), EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY: "02".repeat(32) };
  let ran = false;
  await assert.rejects(withSyntheticProofIdentity("unused", async () => { ran = true; }, environment), /must match/);
  assert.equal(ran, false);
  assert.equal(environment.CPLAYOUT_TEST_SIGNING_SEED, "01".repeat(32));
  assert.equal(environment.EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY, "02".repeat(32));
});
