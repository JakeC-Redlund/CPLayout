/** Check field retention without evaluating accessors or serialization hooks. Defaults may add fields. */
export function assertNoStrippedFields(input: unknown, parsed: unknown, message = "Unknown mutation field would be discarded."): void {
  const ancestors = new Set<object>();
  const check = (source: unknown, admitted: unknown): void => {
    if (source === null || typeof source !== "object") return;
    if (ancestors.has(source) || admitted === null || typeof admitted !== "object") throw new Error(message);
    ancestors.add(source);
    for (const key of Reflect.ownKeys(source)) {
      if (Array.isArray(source) && key === "length") continue;
      const field = Object.getOwnPropertyDescriptor(source, key)!;
      const retained = Object.getOwnPropertyDescriptor(admitted, key);
      if (typeof key !== "string" || !field.enumerable || !("value" in field) || !retained || !("value" in retained)) {
        throw new Error(message);
      }
      check(field.value, retained.value);
    }
    ancestors.delete(source);
  };
  check(input, parsed);
}
