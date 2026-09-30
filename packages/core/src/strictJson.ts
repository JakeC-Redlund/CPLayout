import { visit } from "jsonc-parser";

/** Reject ambiguity before JSON.parse can discard earlier duplicate members. */
export function parseStrictJson(document: string): unknown {
  const objects: Set<string>[] = [];
  visit(document, {
    onObjectBegin() { objects.push(new Set()); },
    onObjectProperty(key) {
      const keys = objects[objects.length - 1];
      if (keys.has(key)) throw new SyntaxError("Duplicate JSON object member.");
      keys.add(key);
    },
    onObjectEnd() { objects.pop(); },
    onError() { throw new SyntaxError("Invalid JSON document."); },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  return JSON.parse(document);
}
