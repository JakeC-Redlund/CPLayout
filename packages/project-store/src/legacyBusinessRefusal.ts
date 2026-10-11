/** Only audited local preconditions may use this marker; never wrap database calls. */
export class LegacyBusinessRefusal extends Error {
    readonly name = 'LegacyBusinessRefusal';
}
export function legacyBusinessValidation<Value>(validate: () => Value): Value {
    try {
        return validate();
    }
    catch (cause) {
        throw new LegacyBusinessRefusal(cause instanceof Error ? cause.message : 'Invalid legacy operation input', { cause });
    }
}
