import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import type { ClientRecord } from "@cplayout/project-store";
import type { CatalogFormRawState, CatalogFormRecoveryDelivery, CatalogFormRecoveryHandle } from "./ProjectCatalogDialog";
import type { WorkspaceRecoveryParticipants } from "../workspace/workspaceRecoveryParticipants";

type Props = Record<string, any>;
type Slot = { value: any; deps?: readonly unknown[]; cleanup?: () => void; setup?: () => void | (() => void); layout?: boolean; generation?: number };
let active: Body | null = null;
const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
/** Actual form handlers with keyed body lifetimes, immediate layout commits and
 * deliberately deferred passive effects. This is source-level scheduler proof,
 * not a browser/native renderer or a repository/storage acceptance claim. */
class Body {
  slots: Slot[] = []; cursor = 0; live = true; layouts: (() => void)[] = []; passive: (() => void)[] = [];
  render(component: (props: Props) => React.ReactElement, props: Props) {
    this.cursor = 0; active = this;
    try { return component(props); } finally { active = null; }
  }
  flushLayout() { this.layouts.splice(0).forEach(run => run()); }
  flushPassive() { this.passive.splice(0).forEach(run => run()); }
  unmount() { this.live = false; this.slots.filter(slot => slot.layout).forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); }
  cleanupPassive() { this.passive = []; this.slots.filter(slot => !slot.layout).forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); }
  replayLayout() { this.slots.filter(slot => slot.layout).forEach(slot => { slot.cleanup?.(); const cleanup = slot.setup?.(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; }); }
}
function slot(initial: () => any): Slot { assert(active); const index = active.cursor++; return active.slots[index] ?? (active.slots[index] = { value: initial() }); }
function effect(layout: boolean, setup: () => void | (() => void), dependencies?: readonly unknown[]) {
  assert(active); const body = active, item = slot(() => undefined);
  if (same(item.deps, dependencies)) return;
  item.deps = dependencies; item.layout = layout; item.setup = setup;
  const generation = item.generation = (item.generation ?? 0) + 1;
  (layout ? body.layouts : body.passive).push(() => {
    if (!body.live || item.generation !== generation) return;
    item.cleanup?.(); const cleanup = setup(); item.cleanup = typeof cleanup === "function" ? cleanup : undefined;
  });
}
const hooks = { ...React,
  useState<T>(initial: T | (() => T)) { const item = slot(() => typeof initial === "function" ? (initial as () => T)() : initial);
    return [item.value as T, (value: T | ((old: T) => T)) => { item.value = typeof value === "function" ? (value as (old: T) => T)(item.value) : value; }] as const; },
  useRef<T>(initial: T) { return slot(() => ({ current: initial })).value as { current: T }; },
  useMemo<T>(factory: () => T, dependencies?: readonly unknown[]) { const item = slot(() => undefined); if (!same(item.deps, dependencies)) { item.deps = dependencies; item.value = factory(); } return item.value as T; },
  useEffect: (setup: () => void | (() => void), dependencies?: readonly unknown[]) => effect(false, setup, dependencies),
  useLayoutEffect: (setup: () => void | (() => void), dependencies?: readonly unknown[]) => effect(true, setup, dependencies),
};
const require = createRequire(import.meta.url), loader = require("node:module") as { _load(name: string, parent: unknown, isMain: boolean): unknown }, originalLoad = loader._load;
loader._load = (name, parent, isMain) => {
  if (name === "react") return hooks;
  if (name === "react-native") return { View: "view", Text: "text", TextInput: "input", Pressable: "button", ScrollView: "scroll", Modal: "modal", KeyboardAvoidingView: "keyboard",
    Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value }, useWindowDimensions: () => ({ width: 1200, height: 800 }) };
  if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
  return originalLoad(name, parent, isMain);
};
let forms: typeof import("./ProjectCatalogDialog");
try { forms = require("./ProjectCatalogDialog") as typeof forms; } finally { loader._load = originalLoad; }
const originalFrame = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = () => 0; // Validation scrolling is unrelated host I/O.
test.after(() => { globalThis.requestAnimationFrame = originalFrame; });
function find(tree: React.ReactNode, id: string): React.ReactElement<Props> {
  function visit(node: React.ReactNode): React.ReactElement<Props> | null {
    if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found; } return null; }
    if (!React.isValidElement<Props>(node)) return null;
    return node.props.testID === id ? node : visit(node.props.children);
  }
  const found = visit(tree); assert(found, `Missing actual form field ${id}`); return found;
}
class Form {
  body: Body | null = null; identity: { type: unknown; key: string | null } | null = null; retired: Body[] = []; tree!: React.ReactElement;
  constructor(public wrapper: (props: any) => React.ReactElement, public props: Props) {}
  render() {
    const element = this.wrapper(this.props);
    assert.equal(typeof element.type, "function");
    if (this.identity?.type !== element.type || this.identity?.key !== element.key) {
      if (this.body) { this.body.unmount(); this.retired.push(this.body); }
      this.body = new Body(); this.identity = { type: element.type, key: element.key };
    }
    this.tree = this.body!.render(element.type as (props: Props) => React.ReactElement, element.props as Props);
    this.body!.flushLayout(); return this.tree;
  }
  flushPassive() { this.retired.splice(0).forEach(body => body.cleanupPassive()); this.body?.flushPassive(); }
  dispose() { this.body?.unmount(); this.body?.cleanupPassive(); this.retired.splice(0).forEach(body => body.cleanupPassive()); }
}
const now = "2026-10-11T12:00:00.000Z";
function client(id = "a", first = "Saved first"): ClientRecord {
  return { id, displayName: `Customer ${id}`, sortName: `Customer ${id}`, contactName: "Saved contact", companyName: "Saved company",
    primaryContactFirstName: first, primaryContactMiddleInitial: "", primaryContactLastName: "Saved last", primaryContactSuffix: "",
    email: "", phone: "", location: "", notes: "Saved notes", createdAt: now, updatedAt: now };
}
function item() {
  const created: string[] = [], cancelled: boolean[] = [], handle = { current: null as CatalogFormRecoveryHandle | null };
  const form = new Form(forms.CatalogItemForm, { mode: "fieldMap", defaultName: "Source field", contextPreview: "Actual customer/project/field", modalVisible: true,
    onCreate: (name: string) => { created.push(name); }, onCancel: () => { cancelled.push(true); }, recoveryHandle: handle });
  return { form, created, cancelled, handle };
}
function profile() {
  const saved: unknown[] = [], cancelled: boolean[] = [], handle = { current: null as CatalogFormRecoveryHandle | null };
  const form = new Form(forms.ClientProfileForm, { mode: "edit", initialClient: client(), defaultDisplayName: "Default company", modalVisible: true,
    onSave: (value: unknown) => { saved.push(value); }, onCancel: () => { cancelled.push(true); }, recoveryHandle: handle });
  return { form, saved, cancelled, handle };
}
function itemRaw(): CatalogFormRawState { return { name: " \r\n invalid recovered title  ", fieldName: "raw first field  ", client: null, detailsOpen: false, errors: [], error: "Exact name validation  ", fieldError: "Exact field error", saveError: "Exact saved refusal" }; }
function focusParticipants(key: string) { return { canEdit: () => true, getFocus: () => ({ key, selection: { start: 2, end: 5 } }), notifyChanged() {}, recordFocus() {} } as unknown as WorkspaceRecoveryParticipants; }
function attachFocus(tree: React.ReactNode, id: string, focused: unknown[]) {
  const input = find(tree, id), ref = input.props.ref ?? input.props.inputRef;
  assert(ref); ref.current = { focus: () => focused.push(id), setSelectionRange: (start: number, end: number) => focused.push({ start, end }) };
  return ref;
}

test("early empty item name survives deferred initial effects and validates without invoking Create", () => {
  const h = item(); let tree = h.form.render();
  find(tree, "catalog-dialog-name-input").props.onChangeText("");
  h.form.flushPassive(); tree = h.form.render();
  assert.equal(find(tree, "catalog-dialog-name-input").props.value, ""); assert.equal(h.handle.current!.capture().name, "");
  find(tree, "catalog-dialog-create").props.onPress(); tree = h.form.render();
  assert.equal(find(tree, "catalog-dialog-error").props.children, "Enter a name before creating this item."); assert.deepEqual(h.created, []);
  h.form.flushPassive(); assert.equal(h.handle.current!.capture().name, ""); h.form.dispose();
});

test("early required customer edits and optional raw values survive initial effects without restoring saved defaults", () => {
  const h = profile(); let tree = h.form.render();
  find(tree, "client-profile-first-name-input").props.onChangeText(""); find(tree, "client-profile-last-name-input").props.onChangeText(" \n");
  find(tree, "client-profile-notes-input").props.onChangeText(" raw notes\r\n  "); find(tree, "client-profile-details-toggle").props.onPress();
  h.form.flushPassive(); tree = h.form.render(); find(tree, "client-profile-save").props.onPress(); tree = h.form.render();
  const raw = h.handle.current!.capture(); assert.equal(raw.client!.primaryContactFirstName, ""); assert.equal(raw.client!.primaryContactLastName, " \n");
  assert.equal(raw.client!.notes, " raw notes\r\n  "); assert.equal(raw.detailsOpen, true); assert.deepEqual(h.saved, []);
  assert.equal(find(tree, "client-profile-first-name-input").props.error, "Enter the contact's first name.");
  assert.equal(find(tree, "client-profile-last-name-input").props.error, "Enter the contact's last name."); h.form.dispose();
});

test("real item mode changes remount once, preserve early new-owner input, and mode ABA cannot revive held callbacks", () => {
  const h = item(); let tree = h.form.render(); h.form.flushPassive(); tree = h.form.render();
  const oldInput = find(tree, "catalog-dialog-name-input"), oldCreate = find(tree, "catalog-dialog-create"), oldCancel = find(tree, "catalog-dialog-cancel"), oldHandle = h.handle.current!;
  h.form.props.mode = "design"; h.form.props.defaultName = "New design default"; tree = h.form.render();
  assert.equal(find(tree, "catalog-dialog-name-input").props.value, "New design default");
  assert.throws(() => oldHandle.capture(), /Wait/); assert.equal(oldHandle.isBusy(), true);
  find(tree, "catalog-dialog-name-input").props.onChangeText(" Early new design raw  "); h.form.flushPassive(); tree = h.form.render();
  assert.equal(find(tree, "catalog-dialog-name-input").props.value, " Early new design raw  ");
  h.form.props.mode = "fieldMap"; h.form.props.defaultName = "Fresh field default"; tree = h.form.render();
  oldInput.props.onChangeText("Retired overwrite"); oldCreate.props.onPress(); oldCancel.props.onPress(); tree = h.form.render();
  assert.equal(find(tree, "catalog-dialog-name-input").props.value, "Fresh field default"); assert.deepEqual(h.created, []); assert.deepEqual(h.cancelled, []);
  h.form.flushPassive(); h.form.dispose();
});

test("customer identity and mode alone reset the body; same-ID metadata/default changes preserve raw and retired identity callbacks refuse", () => {
  const h = profile(); let tree = h.form.render(); h.form.flushPassive(); tree = h.form.render();
  const oldInput = find(tree, "client-profile-first-name-input"), oldSave = find(tree, "client-profile-save"), oldCancel = find(tree, "client-profile-cancel");
  oldInput.props.onChangeText(" Unfinished contact  "); h.form.props.initialClient = client("a", "Sibling refreshed default"); h.form.props.defaultDisplayName = "New sibling company";
  tree = h.form.render(); assert.equal(find(tree, "client-profile-first-name-input").props.value, " Unfinished contact  ");
  h.form.props.initialClient = client("b", "Other actual contact"); tree = h.form.render(); assert.equal(find(tree, "client-profile-first-name-input").props.value, "Other actual contact");
  find(tree, "client-profile-first-name-input").props.onChangeText(" Early other contact  "); h.form.flushPassive(); tree = h.form.render();
  assert.equal(find(tree, "client-profile-first-name-input").props.value, " Early other contact  ");
  h.form.props.mode = "create"; tree = h.form.render(); h.form.props.mode = "edit"; h.form.props.initialClient = client("a"); tree = h.form.render();
  oldInput.props.onChangeText("Old identity overwrite"); oldSave.props.onPress(); oldCancel.props.onPress(); tree = h.form.render();
  assert.equal(find(tree, "client-profile-first-name-input").props.value, "Saved first"); assert.deepEqual(h.saved, []); assert.deepEqual(h.cancelled, []); h.form.dispose();
});

test("hiding Modal and changing defaults preserves the same item body, raw/errors and field ref while hidden handlers refuse", () => {
  const h = item(); let tree = h.form.render(); h.form.flushPassive(); tree = h.form.render();
  find(tree, "catalog-dialog-name-input").props.onChangeText(""); tree = h.form.render(); find(tree, "catalog-dialog-create").props.onPress(); tree = h.form.render();
  const body = h.form.body, raw = h.handle.current!.capture(), focused: unknown[] = [], ref = attachFocus(tree, "catalog-dialog-name-input", focused);
  const heldInput = find(tree, "catalog-dialog-name-input"), heldCreate = find(tree, "catalog-dialog-create");
  h.form.props.modalVisible = false; h.form.props.defaultName = "Changed sibling default"; tree = h.form.render();
  heldInput.props.onChangeText("Hidden overwrite"); heldCreate.props.onPress(); h.form.flushPassive(); tree = h.form.render();
  assert.equal(h.form.body, body); assert.deepEqual(h.handle.current!.capture(), raw); assert.deepEqual(h.created, []);
  h.form.props.modalVisible = true; tree = h.form.render(); assert.equal(h.form.body, body); assert.equal(find(tree, "catalog-dialog-name-input").props.ref, ref);
  assert.equal(find(tree, "catalog-dialog-name-input").props.value, ""); assert.equal(find(tree, "catalog-dialog-error").props.children, raw.error); h.form.dispose();
});

test("item recovery waits for actual restored render, retains hidden raw and focus, and survives layout effect replay without reinitializing", () => {
  const h = item(), focused: unknown[] = []; let tree = h.form.render(); h.form.flushPassive(); tree = h.form.render();
  const oldInput = find(tree, "catalog-dialog-name-input"), ref = attachFocus(tree, "catalog-dialog-name-input", focused), raw = itemRaw(); let acknowledgements = 0;
  h.form.props.recoveryParticipants = focusParticipants("catalog/form/name");
  h.form.props.recoveryDelivery = { id: "item-recovery", value: raw, isCurrent: () => true, acknowledge: () => { acknowledgements++; }, reject: (error: Error) => { assert.fail(error.message); } } satisfies CatalogFormRecoveryDelivery;
  tree = h.form.render(); h.form.flushPassive(); assert.equal(acknowledgements, 0);
  oldInput.props.onChangeText("Old render overwrite"); tree = h.form.render(); h.form.flushPassive(); assert.equal(acknowledgements, 1);
  assert.deepEqual(h.handle.current!.capture(), raw); assert.deepEqual(focused, ["catalog-dialog-name-input", { start: 2, end: 5 }]);
  h.form.props.recoveryDelivery = null; h.form.props.modalVisible = false; h.form.props.defaultName = "New metadata default"; tree = h.form.render();
  h.form.body!.replayLayout(); h.form.flushPassive(); tree = h.form.render(); assert.deepEqual(h.handle.current!.capture(), raw);
  h.form.props.modalVisible = true; tree = h.form.render(); assert.equal(find(tree, "catalog-dialog-name-input").props.ref, ref);
  find(tree, "catalog-dialog-name-input").props.onChangeText(" Fresh active raw  "); tree = h.form.render(); assert.equal(find(tree, "catalog-dialog-name-input").props.value, " Fresh active raw  "); h.form.dispose();
});

test("customer recovery keeps required errors/details/caret behind its commit barrier and captures refuse immediately after layout unmount", () => {
  const h = profile(), focused: unknown[] = []; let tree = h.form.render(); h.form.flushPassive(); tree = h.form.render();
  attachFocus(tree, "client-profile-first-name-input", focused); const previousSave = find(tree, "client-profile-save");
  const raw: CatalogFormRawState = { name: "", fieldName: "", client: { companyName: " Raw company  ", primaryContactFirstName: " \n", primaryContactMiddleInitial: " a.. ", primaryContactLastName: "", primaryContactSuffix: "", email: "bad entered email", phone: "", location: "", notes: " Exact\r\nnotes  " },
    detailsOpen: true, errors: [{ field: "primaryContactFirstName", message: "Exact required-name error" }], error: null, fieldError: null, saveError: "Exact saved error" };
  let acknowledgements = 0;
  h.form.props.recoveryParticipants = focusParticipants("catalog/client/primaryContactFirstName");
  h.form.props.recoveryDelivery = { id: "customer-recovery", value: raw, isCurrent: () => true, acknowledge: () => { acknowledgements++; }, reject: (error: Error) => { assert.fail(error.message); } };
  tree = h.form.render(); h.form.flushPassive(); assert.equal(acknowledgements, 0); previousSave.props.onPress(); assert.deepEqual(h.saved, []);
  tree = h.form.render(); h.form.flushPassive(); assert.equal(acknowledgements, 1); assert.deepEqual(h.handle.current!.capture(), raw);
  assert.deepEqual(focused, ["client-profile-first-name-input", { start: 2, end: 2 }]);
  h.form.props.recoveryDelivery = null; h.form.props.modalVisible = false; tree = h.form.render(); h.form.flushPassive(); assert.deepEqual(h.handle.current!.capture(), raw);
  const handle = h.handle.current!; h.form.body!.unmount(); assert.throws(() => handle.capture(), /Wait/); assert.equal(handle.isBusy(), true); h.form.dispose();
});

test("retired recovery delivery rejects without replacing item values or acknowledging", () => {
  const h = item(); let tree = h.form.render(); h.form.flushPassive(); tree = h.form.render(); find(tree, "catalog-dialog-name-input").props.onChangeText(" Current raw  "); tree = h.form.render();
  let acknowledgements = 0; const rejected: Error[] = [];
  h.form.props.recoveryDelivery = { id: "retired-delivery", value: itemRaw(), isCurrent: () => false, acknowledge: () => { acknowledgements++; }, reject: (error: Error) => rejected.push(error) };
  tree = h.form.render(); h.form.flushPassive(); tree = h.form.render();
  assert.equal(acknowledgements, 0); assert.equal(rejected.length, 1); assert.match(rejected[0].message, /retired/);
  assert.equal(find(tree, "catalog-dialog-name-input").props.value, " Current raw  "); h.form.dispose();
});
