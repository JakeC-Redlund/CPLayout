/** Detach plain JSON data without executing accessors or serialization hooks. */
export function snapshotJsonValue(value: unknown, path = "draft", ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new Error(`${path}: Expected finite, serializable JSON data.`);
  if (ancestors.has(value)) throw new Error(`${path}: Cyclic data is not serializable.`);
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path}: Expected a plain JSON object.`);
  }
  for (let inherited = prototype; inherited !== null; inherited = Object.getPrototypeOf(inherited)) {
    if (Object.getOwnPropertyDescriptor(inherited, "toJSON")) throw new Error(`${path}: Inherited JSON hooks are not supported.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new Error(`${path}: Symbol properties are not serializable.`);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (isArray && key === "length") continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${path}.${key}: Expected an enumerable JSON data property; accessors are not supported.`);
  }
  if (isArray) {
    const length: number = descriptors.length.value;
    if (Object.keys(descriptors).length !== length + 1) throw new Error(`${path}: Expected a dense JSON array without extra properties.`);
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(descriptors, index)) throw new Error(`${path}: Sparse arrays are not supported.`);
    }
  }
  ancestors.add(value);
  try {
    if (isArray) {
      const snapshot: unknown[] = [];
      for (let index = 0; index < descriptors.length.value; index += 1) {
        snapshot.push(snapshotJsonValue(descriptors[index].value, `${path}.${index}`, ancestors));
      }
      return snapshot;
    }
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [
      key, descriptor.value === undefined ? undefined : snapshotJsonValue(descriptor.value, `${path}.${key}`, ancestors),
    ]));
  } finally {
    ancestors.delete(value);
  }
}
