import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { type ReceiverSessionOwner } from "../gnss/receiverSessionOwner";

export interface ReceiverConnectionPanelProps { owner: ReceiverSessionOwner; projectCrs: string }
export function ReceiverConnectionPanel({ owner, projectCrs }: ReceiverConnectionPanelProps): React.JSX.Element {
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const form = state.connectionForm;
  // Opening settings never connects; later connection loss never changes focus or disclosure state.
  const [settingsOpen, setSettingsOpen] = useState(() => state.phase !== "connected");
  const connectionActionRef = useRef<React.ElementRef<typeof View>>(null);
  const pendingFocus = useRef<{ owner: ReceiverSessionOwner; element: HTMLElement; cancelled: boolean; stopTracking(): void } | null>(null);
  const [, updateAge] = useState(0);
  const disabled = state.phase !== "idle";
  const gate = owner.collectionGate(projectCrs);
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
  function update(values: Partial<typeof form>) { owner.updateConnectionForm(values); }
  async function connect() {
    try { await owner.connectFromForm(); } catch { /* The owner publishes errors to every receiver view. */ }
  }
  async function disconnect() {
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
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: settingsOpen }} aria-expanded={settingsOpen} onPress={() => setSettingsOpen(value => !value)} style={styles.button} testID="receiver-settings-toggle">
        <Text style={styles.buttonText}>{settingsOpen ? "Hide receiver settings" : state.phase === "idle" ? "Reconnect receiver — settings" : "Receiver settings"}</Text>
      </Pressable>
    </View>
    <Text testID="receiver-collection-readiness" accessibilityLiveRegion="polite" style={[styles.help, { color: gate.accepted ? "#205d35" : "#8b3b21" }]}>{gate.accepted ? "Receiver position available" : gate.reason}</Text>
    <View style={styles.row}>
      <Pressable ref={connectionActionRef} accessibilityRole="button" accessibilityState={{ disabled: state.phase === "opening" || state.phase === "closing" }} disabled={state.phase === "opening" || state.phase === "closing"} onPress={() => { void (disabled ? disconnect() : connect()); }} style={styles.button}>
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
        <Input label={form.protocol === "tcp" ? "Receiver IP address" : "Local listening IP address"} value={form.address} onChangeText={address => update({ address })} disabled={disabled} />
        <Input label="Network port" value={form.port} onChangeText={port => update({ port })} disabled={disabled} />
        {form.protocol === "udp" ? <Input label="Source IP filter (optional)" value={form.sourceAddress} onChangeText={sourceAddress => update({ sourceAddress })} disabled={disabled} /> : null}
      </View>
      <Text style={styles.help}>{form.protocol === "tcp" ? "Connect to the receiver's NMEA TCP stream." : "Listen for NMEA UDP at this computer's selected address and port. Use 0.0.0.0 to listen on all local IPv4 interfaces. The first permitted sender owns this connection; disconnect to change receivers."}</Text>
    </> : <>
      <Input label="Baud rate" value={form.baudRate} onChangeText={baudRate => update({ baudRate })} disabled={disabled} />
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
function Input({ label, value, onChangeText, disabled }: { label: string; value: string; onChangeText: (value: string) => void; disabled: boolean }) {
  return <View style={styles.inputGroup}><Text style={styles.help}>{label}</Text><TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} value={value} editable={!disabled} onChangeText={onChangeText} style={styles.input} /></View>;
}
const styles = StyleSheet.create({ settings: { gap: 10 }, panel: { gap: 10, borderWidth: 1, borderColor: "#d1dacd", borderRadius: 8, padding: 12 }, title: { fontSize: 16, fontWeight: "700", color: "#254234" }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }, button: { borderWidth: 1, borderColor: "#b8c8b4", borderRadius: 6, padding: 10, minHeight: 42, backgroundColor: "#f4f7f0" }, selected: { backgroundColor: "#dbe9d5", borderColor: "#45673c" }, buttonText: { fontWeight: "700", color: "#254234" }, help: { fontSize: 12, color: "#48574a", lineHeight: 18 }, inputGroup: { gap: 4, minWidth: 140, flexShrink: 1 }, input: { borderWidth: 1, borderColor: "#b8c8b4", borderRadius: 6, padding: 9, minHeight: 42, backgroundColor: "#fff" }, metric: { fontSize: 12, padding: 5, color: "#254234" } });
