import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";

const requireCurrent = createRequire(resolve(process.cwd(), "package.json"));
const { renderToStaticMarkup } = requireCurrent("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }, original = loader._load;

// This controlled host verifies close/focus ownership and nested event policy.
// Actual focus, natural Tab and Escape are independently asserted by GIS browser proof.
function fixture(sheetMode = false) {
  const controls = new Map<string, Record<string, unknown>>(), refs: { current: unknown }[] = [];
  let cursor = 0, closeCalls = 0, focusCalls = 0, selected = 0, pendingEffect: (() => void) | null = null;
  const react = { ...React, useRef(value: unknown) { return refs[cursor++] ?? (refs[cursor - 1] = { current: value }); },
    useLayoutEffect(action: () => void) { pendingEffect = action; } };
  const host = (tag: string) => (props: Record<string, unknown>) => {
    if (typeof props.testID === "string") controls.set(props.testID, props);
    if (props.ref) (props.ref as { current: unknown }).current = { focus() { focusCalls++; } };
    return React.createElement(tag, null, props.children as React.ReactNode);
  };
  const path = resolve(__dirname, "CommandSurface.tsx"); delete requireCurrent.cache[path];
  let component: typeof import("./CommandSurface");
  try {
    loader._load = function(request, parent, isMain) {
      if (request === "react") return react;
      if (request === "react-native") return { View: host("div"), Text: host("span"), Pressable: host("button"), ScrollView: host("section"),
        Modal: (props: Record<string, unknown>) => { controls.set("modal", props); return React.createElement("div", null, props.children as React.ReactNode); },
        Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value }, useWindowDimensions: () => ({ width: 1366, height: 900 }) };
      return original.call(this, request, parent, isMain);
    };
    component = requireCurrent(path);
  } finally { loader._load = original; }
  return { controls,
    render(open: boolean) {
      cursor = 0; controls.clear();
      renderToStaticMarkup(React.createElement(component.CommandMenu, { menu: { id: "gis-test", label: "File", items: [{ id: "action", label: "Synthetic command", testID: "action", onPress() { selected++; } }] },
        open, onOpen() {}, onClose() { closeCalls++; }, sheetMode, sheetHeight: 500, sheetWidth: 390, sheetMaxHeight: 430, sheetScrollMaxHeight: 344 }));
      if (pendingEffect) { const effect: () => void = pendingEffect; pendingEffect = null; effect(); }
    },
    get closeCalls() { return closeCalls; }, get focusCalls() { return focusCalls; }, get selected() { return selected; },
  };
}
function key(value = "Escape", defaultPrevented = false) { let prevented = 0, stopped = 0; return {
  event: { key: value, defaultPrevented, preventDefault() { prevented++; }, stopPropagation() { stopped++; } },
  get prevented() { return prevented; }, get stopped() { return stopped; },
}; }

test("desktop Escape closes its menu and returns focus once after close; nested Escape remains owned by its child", () => {
  const f = fixture(); f.render(true);
  const dispatch = f.controls.get("command-menu-gis-test-owner")!.onKeyDown as (event: unknown) => void;
  const nested = key("Escape", true); dispatch(nested.event); assert.equal(f.closeCalls, 0); assert.equal(nested.prevented, 0);
  dispatch(key("ArrowDown").event); assert.equal(f.closeCalls, 0);
  const escape = key(); dispatch(escape.event); assert.equal(f.closeCalls, 1); assert.equal(escape.prevented, 1); assert.equal(escape.stopped, 1); assert.equal(f.focusCalls, 0);
  f.render(false); assert.equal(f.focusCalls, 1); f.render(false); assert.equal(f.focusCalls, 1);
});

test("compact dismissal restores the trigger while command selection preserves the destination's focus ownership", () => {
  for (const id of ["command-menu-gis-test-close", "command-menu-gis-test-backdrop", "modal"]) {
    const f = fixture(true); f.render(true);
    (f.controls.get(id)![id === "modal" ? "onRequestClose" : "onPress"] as () => void)();
    assert.equal(f.closeCalls, 1); f.render(false); assert.equal(f.focusCalls, 1); assert.equal(f.selected, 0);
  }
  const f = fixture(); f.render(true); (f.controls.get("action")!.onPress as () => void)();
  assert.equal(f.closeCalls, 1); assert.equal(f.selected, 1); f.render(false); assert.equal(f.focusCalls, 0);
});
