import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";

/** Test-only signing material. The production gateway never imports this module. */
export async function withSyntheticProofIdentity<T>(
  directory: string,
  action: () => Promise<T>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const originalSeed = environment.CPLAYOUT_TEST_SIGNING_SEED;
  const originalPin = environment.EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY;
  let ownedDirectory: string | null = null;
  try {
    let hex: string;
    if (originalSeed) {
      hex = /^[a-f0-9]{64}$/i.test(originalSeed) ? originalSeed : (await readFile(originalSeed, "utf8")).trim();
      if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("The synthetic proof seed must contain exactly 32 bytes.");
    } else {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      ownedDirectory = join(directory, randomUUID());
      await mkdir(ownedDirectory, { mode: 0o700 });
      hex = randomBytes(32).toString("hex");
      const path = join(ownedDirectory, "signing.seed");
      await writeFile(path, hex, { flag: "wx", mode: 0o600 });
      environment.CPLAYOUT_TEST_SIGNING_SEED = path;
    }
    const publicKey = Buffer.from(ed25519.getPublicKey(Buffer.from(hex, "hex"))).toString("hex");
    if (originalPin && originalPin.toLowerCase() !== publicKey) throw new Error("The app's public verification key must match its synthetic proof service.");
    environment.EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY = publicKey;
    return await action();
  } finally {
    if (originalSeed === undefined) delete environment.CPLAYOUT_TEST_SIGNING_SEED; else environment.CPLAYOUT_TEST_SIGNING_SEED = originalSeed;
    if (originalPin === undefined) delete environment.EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY; else environment.EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY = originalPin;
    if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
  }
}
