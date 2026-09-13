import { addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";

let protocolRegistered = false;
let protocol: Protocol | null = null;

export function registerPmtilesProtocolOnce(): void {
  if (protocolRegistered) return;
  protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}
