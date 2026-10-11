import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { type ReceiverSessionOwner } from "../gnss/receiverSessionOwner";
import { useWorkspaceRecoveryParticipant, type WorkspaceRecoveryParticipants } from "../workspace/workspaceRecoveryParticipants";

export interface ReceiverConnectionPanelProps { owner: ReceiverSessionOwner; projectCrs: string | null; onUserIntent?: () => void; recoveryParticipants?: WorkspaceRecoveryParticipants }
export function ReceiverConnectionPanel({ owner, projectCrs, onUserIntent, recoveryParticipants }: ReceiverConnectionPanelProps): React.JSX.Element {
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const form = state.connectionForm;
  // Opening settings never connects; later connection loss never changes focus or disclosure state.
  const [settingsOpen, setSettingsOpen] = useState(() => state.phase !== "connected");
  const settingsRef = useRef(settingsOpen); settingsRef.current = settingsOpen;
  const panelEpoch = useRef(0), renderedEpoch = panelEpoch.current;
  const fields = useRef(new Map<string, React.ElementRef<typeof TextInput>>());
  function canEdit() { return panelEpoch.current === renderedEpoch && recoveryParticipants?.canEdit() !== false; }
  useWorkspaceRecoveryParticipant(recoveryParticipants, "receiver", {
    capture: () => ({ ...owner.connectionForm, settingsOpen: settingsRef.current }),
    stage(value, target) {
      const epoch = panelEpoch.current, originalForm = owner.connectionForm;
      if (owner.getSnapshot().phase !== "idle") throw new Error("Disconnect the receiver before restoring connection inputs.");
      return { isCurrent: () => panelEpoch.current === epoch && owner.connectionForm === originalForm && owner.getSnapshot().phase === "idle",
        consume(delivery) {
          if (!delivery.isCurrent() || delivery.target !== target || owner.getSnapshot().phase !== "idle") throw new Error("The receiver recovery owner is no longer idle.");
          pendingFocus.current?.stopTracking(); pendingFocus.current = null; panelEpoch.current++;
          const { settingsOpen, ...form } = value;
          if (!owner.updateConnectionForm(form)) throw new Error("Receiver inputs could not be restored while disconnected.");
          settingsRef.current = settingsOpen; setSettingsOpen(settingsOpen);
        } };
    },
  });
  const connectionActionRef = useRef<React.ElementRef<typeof View>>(null);
  const pendingFocus = useRef<{ owner: ReceiverSessionOwner; element: HTMLElement; cancelled: boolean; stopTracking(): void } | null>(null);
  const [, updateAge] = useState(0);
  const disabled = state.phase !== "idle" || recoveryParticipants?.canEdit() === false;
  const gate = owner.collectionGate(projectCrs ?? "");
  const observation = state.observation;
  useEffect(() => { const timer = setInterval(() => updateAge(value => value + 1), 200); return () => clearInterval(timer); }, []);
  useEffect(() => () => {
    pendingFocus.current?.stopTracking();
    pendingFocus.current = null;
  }, [owner]);
  // Disabling the web button during cleanup blurs it. Restore its initiating
  // focus only after the enabled settled phase commits, never over a new focus.
  useEffect(() => {
    const attempt = pendingFocus.current;
    if (!attempt || (state.phase !== "cleanup_failed" && state.phase !== "idle")) return;
    pendingFocus.current = null;
    attempt.stopTracking();
    const element = attempt.element;
    const actionDocument = element.ownerDocument;
    if (attempt.cancelled || attempt.owner !== owner || (connectionActionRef.current as unknown) !== element
      || !element.isConnected || !element.getClientRects().length || !actionDocument.hasFocus()
      || (actionDocument.activeElement !== element && actionDocument.activeElement !== actionDocument.body)) return;
    element.focus({ preventScroll: true });
  });
  function update(values: Partial<typeof form>) {
    if (!canEdit() || owner.getSnapshot().phase !== "idle") return;
    onUserIntent?.(); if (owner.updateConnectionForm(values)) recoveryParticipants?.notifyChanged();
  }
  function fieldProps(key: string) {
    const address = `receiver/${key}`;
    return { inputRef: (node: React.ElementRef<typeof TextInput> | null) => { if (node) fields.current.set(address, node); else fields.current.delete(address); },
      onFocus: () => { if (canEdit()) recoveryParticipants?.recordFocus(address); },
      onSelection: (selection: { start: number; end: number }) => { if (canEdit()) recoveryParticipants?.recordFocus(address, selection); } };
  }
  useEffect(() => {
    if (recoveryParticipants?.canEdit() === false || !settingsOpen) return;
    const focus = recoveryParticipants?.getFocus();
    if (!focus || !focus.key.startsWith("receiver/")) return;
    const node = fields.current.get(focus.key) as unknown as HTMLInputElement | undefined;
    if (!node || Platform.OS !== "web" || !node.isConnected || node.disabled || !node.getClientRects().length) return;
    node.focus({ preventScroll: true });
    if (focus.selection) node.setSelectionRange(Math.min(focus.selection.start, node.value.length), Math.min(focus.selection.end, node.value.length));
  }, [recoveryParticipants?.canEdit(), settingsOpen, form]);
  async function connect() {
    if (!canEdit()) return;
    onUserIntent?.();
    try { await owner.connectFromForm(); } catch { /* The owner publishes errors to every receiver view. */ }
  }
  async function disconnect() {
    if (!canEdit()) return;
    onUserIntent?.();
    pendingFocus.current?.stopTracking();
    pendingFocus.current = null;
    const element = Platform.OS === "web" ? connectionActionRef.current as unknown as HTMLElement | null : null;
    if (element?.isConnected && element.ownerDocument.activeElement === element) {
      const actionDocument = element.ownerDocument;
      const attempt = { owner, element, cancelled: false, stopTracking() {
        actionDocument.removeEventListener("focusin", cancelForNewFocus, true);
        actionDocument.removeEventListener("pointerdown", cancelForNewFocus, true);
        actionDocument.defaultView?.removeEventListener("blur", cancelForWindowBlur);
      } };
      function cancelForNewFocus(event: Event) {
        if (event.target !== attempt.element && !(event.target instanceof Node && attempt.element.contains(event.target))) attempt.cancelled = true;
      }
      function cancelForWindowBlur() { attempt.cancelled = true; }
      actionDocument.addEventListener("focusin", cancelForNewFocus, true);
      actionDocument.addEventListener("pointerdown", cancelForNewFocus, true);
      actionDocument.defaultView?.addEventListener("blur", cancelForWindowBlur);
      pendingFocus.current = attempt;
    }
    try { await owner.disconnect(); } catch { /* Cleanup status belongs to the shared owner. */ }
  }
  return <View style={styles.panel}>
    <View style={styles.row}>
      <Text style={styles.title}>Receiver</Text>
      <Pressable accessibilityRole="button" disabled={recoveryParticipants?.canEdit() === false} accessibilityState={{ expanded: settingsOpen }} aria-expanded={settingsOpen} onPress={() => {
        if (!canEdit()) return; onUserIntent?.(); recoveryParticipants?.notifyChanged(); setSettingsOpen(value => !value);
      }} style={styles.button} testID="receiver-settings-toggle">
        <Text style={styles.buttonText}>{settingsOpen ? "Hide receiver settings" : state.phase === "idle" ? "Reconnect receiver — settings" : "Receiver settings"}</Text>
      </Pressable>
    </View>
    <Text testID="receiver-collection-readiness" accessibilityLiveRegion="polite" style={[styles.help, { color: gate.accepted ? "#205d35" : "#8b3b21" }]}>{gate.accepted ? "Receiver position available" : projectCrs === null ? "Choose a field coordinate system before collecting. You can connect the receiver now." : gate.reason}</Text>
    <View style={styles.row}>
      <Pressable ref={connectionActionRef} accessibilityRole="button" accessibilityState={{ disabled: state.phase === "opening" || state.phase === "closing" || recoveryParticipants?.canEdit() === false }} disabled={state.phase === "opening" || state.phase === "closing" || recoveryParticipants?.canEdit() === false} onPress={() => { void (state.phase !== "idle" ? disconnect() : connect()); }} style={styles.button}>
        <Text style={styles.buttonText}>{state.phase === "opening" ? "Connecting…" : state.phase === "closing" ? "Disconnecting…" : disabled ? "Disconnect receiver" : "Connect receiver"}</Text>
      </Pressable>
      <Text style={styles.help}>Connection: {state.phase}</Text>
    </View>
    <Text testID="receiver-status" accessibilityLiveRegion="polite" style={styles.help}>{state.error ?? state.status}</Text>
    {settingsOpen && <View style={styles.settings} testID="receiver-settings">
    <View style={styles.row}>
      {([{ method: "usb", label: "COM / USB" }, { method: "bluetooth_spp", label: "Bluetooth serial" }, { method: "network", label: "Wi-Fi / network" }] as const).map(option =>
        <Pressable key={option.method} accessibilityRole="button" accessibilityState={{ selected: form.method === option.method, disabled }} {...(Platform.OS === "web" ? { "aria-pressed": form.method === option.method } : {})} disabled={disabled} onPress={() => update({ method: option.method })} style={[styles.button, form.method === option.method && styles.selected]}><Text style={styles.buttonText}>{option.label}</Text></Pressable>)}
    </View>
    {form.method === "network" ? <>
      <View style={styles.row}>{(["tcp", "udp"] as const).map(protocol => <Pressable accessibilityRole="button" accessibilityState={{ selected: form.protocol === protocol, disabled }} {...(Platform.OS === "web" ? { "aria-pressed": form.protocol === protocol } : {})} key={protocol} disabled={disabled} onPress={() => update({ protocol })} style={[styles.button, form.protocol === protocol && styles.selected]}><Text>{protocol === "tcp" ? "TCP client" : "UDP receive"}</Text></Pressable>)}</View>
      <View style={styles.row}>
        <Input {...fieldProps("address")} label={form.protocol === "tcp" ? "Receiver IP address" : "Local listening IP address"} value={form.address} onChangeText={address => update({ address })} disabled={disabled} />
        <Input {...fieldProps("port")} label="Network port" value={form.port} onChangeText={port => update({ port })} disabled={disabled} />
        {form.protocol === "udp" ? <Input {...fieldProps("sourceAddress")} label="Source IP filter (optional)" value={form.sourceAddress} onChangeText={sourceAddress => update({ sourceAddress })} disabled={disabled} /> : null}
      </View>
      <Text style={styles.help}>{form.protocol === "tcp" ? "Connect to the receiver's NMEA TCP stream." : "Listen for NMEA UDP at this computer's selected address and port. Use 0.0.0.0 to listen on all local IPv4 interfaces. The first permitted sender owns this connection; disconnect to change receivers."}</Text>
    </> : <>
      <Input {...fieldProps("baudRate")} label="Baud rate" value={form.baudRate} onChangeText={baudRate => update({ baudRate })} disabled={disabled} />
      <Text style={styles.help}>{form.method === "bluetooth_spp" ? "Pair the receiver in Windows first, then choose its serial port. Bluetooth BLE is not supported here." : "Choose the receiver's COM or USB serial port when connecting."} 115200 is an editable connection default.</Text>
    </>}
    <View style={styles.row}>
      <Text style={styles.metric}>Data: {state.phase === "connected" && gate.ageMs !== null && gate.ageMs > 2000 ? "stale" : state.incomingData}</Text>
      <Text style={styles.metric}>Fix: {state.receiverQuality?.fixType === "rtk_fixed" ? "RTK Fixed — receiver reported" : state.receiverQuality?.fixType?.replaceAll("_", " ") ?? "unknown"}</Text>
      <Text style={styles.metric}>Age: {gate.ageMs === null ? "unknown" : `${(gate.ageMs / 1000).toFixed(1)} s`}</Text>
      <Text style={styles.metric}>Sentence: {state.sentenceIdentifier ?? "unknown"}</Text>
      <Text style={styles.metric}>Position: {observation ? `${observation.sample.latitude!.toFixed(7)}, ${observation.sample.longitude!.toFixed(7)}` : "unknown"}</Text>
    </View>
    </View>}
    <Text style={styles.help}>Fixed status is reported by the receiver. Measured field accuracy remains unverified. Height, correction age and reference declarations are supplementary information.</Text>
  </View>;
}
function Input({ label, value, onChangeText, disabled, inputRef, onFocus, onSelection }: { label: string; value: string; onChangeText: (value: string) => void; disabled: boolean;
  inputRef?: (node: React.ElementRef<typeof TextInput> | null) => void; onFocus?: () => void; onSelection?: (selection: { start: number; end: number }) => void }) {
  return <View style={styles.inputGroup}><Text style={styles.help}>{label}</Text><TextInput ref={inputRef} accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} value={value} editable={!disabled} onChangeText={onChangeText}
    onFocus={onFocus} onSelectionChange={event => onSelection?.(event.nativeEvent.selection)} style={styles.input} /></View>;
}
const styles = StyleSheet.create({ settings: { gap: 10 }, panel: { gap: 10, borderWidth: 1, borderColor: "#d1dacd", borderRadius: 8, padding: 12 }, title: { fontSize: 16, fontWeight: "700", color: "#254234" }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }, button: { borderWidth: 1, borderColor: "#b8c8b4", borderRadius: 6, padding: 10, minHeight: 42, backgroundColor: "#f4f7f0" }, selected: { backgroundColor: "#dbe9d5", borderColor: "#45673c" }, buttonText: { fontWeight: "700", color: "#254234" }, help: { fontSize: 12, color: "#48574a", lineHeight: 18 }, inputGroup: { gap: 4, minWidth: 140, flexShrink: 1 }, input: { borderWidth: 1, borderColor: "#b8c8b4", borderRadius: 6, padding: 9, minHeight: 42, backgroundColor: "#fff" }, metric: { fontSize: 12, padding: 5, color: "#254234" } });
