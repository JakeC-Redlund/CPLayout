import { z } from "zod";
import { parseStrictJson } from "./strictJson";
import type { PreparedUpgrade } from "./upgradeCoordinator";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const preparedSchema = z.object({
    format: z.literal("cplayout-prepared-upgrade-v1"),
    attemptId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    sourceIdentity: z.string().min(1).max(4096),
    fromVersion: z.number().int().nonnegative().safe(),
    toVersion: z.number().int().positive().safe(),
    planSha256: digest,
    backup: z.object({ identity: z.string().min(1).max(4096), sha256: digest }).strict(),
}).strict().refine(value => value.fromVersion < value.toVersion, "Invalid version interval.")
    .refine(value => value.backup.identity !== value.sourceIdentity, "Backup and source must differ.");
// Parsing is not filesystem authority: the host must bind both identities to owned paths.
export function parsePreparedUpgrade(text: string): PreparedUpgrade {
    if (text.length > 16384)
        throw new Error("Prepared manifest exceeds the character limit.");
    return preparedSchema.parse(parseStrictJson(text));
}
