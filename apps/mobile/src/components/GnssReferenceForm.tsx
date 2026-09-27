import { ChevronDown, ChevronRight, Circle, CircleDot } from "lucide-react-native";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export type GnssReferenceFormValue = {
  receiverModel: string;
  receiverFirmware: string;
  realization: string;
  coordinateEpochUtc: string;
  verticalDatum: string;
  geoidModel: string;
  antennaModel: string;
  reportedPoint: string;
  targetPoint: string;
  antennaHeightMeters: string;
  antennaReference: "" | "arp" | "phase_center" | "pole_tip" | "tilt_compensated";
  offsetTreatment: "" | "none_reported_point" | "receiver_applied";
};

export const EMPTY_GNSS_REFERENCE_FORM: GnssReferenceFormValue = {
  receiverModel: "",
  receiverFirmware: "",
  realization: "",
  coordinateEpochUtc: "",
  verticalDatum: "",
  geoidModel: "",
  antennaModel: "",
  reportedPoint: "",
  targetPoint: "",
  antennaHeightMeters: "",
  antennaReference: "",
  offsetTreatment: "",
};

interface GnssReferenceFormProps {
  value: GnssReferenceFormValue;
  onChange: (value: GnssReferenceFormValue) => void;
  disabled: boolean;
  valid: boolean;
  errors?: Partial<Record<keyof GnssReferenceFormValue, string>>;
}

const TEXT_FIELDS = [
  { field: "receiverModel", label: "Receiver model" },
  { field: "receiverFirmware", label: "Receiver firmware" },
  { field: "realization", label: "Frame realization" },
  { field: "coordinateEpochUtc", label: "Coordinate epoch UTC" },
  { field: "verticalDatum", label: "Vertical datum" },
  { field: "geoidModel", label: "Geoid model" },
  { field: "antennaModel", label: "Antenna model" },
  { field: "reportedPoint", label: "Reported point" },
  { field: "targetPoint", label: "Target point" },
  { field: "antennaHeightMeters", label: "Antenna height metres" },
] as const;

const ANTENNA_REFERENCES = [
  { value: "arp", label: "ARP" },
  { value: "phase_center", label: "Phase center" },
  { value: "pole_tip", label: "Pole tip" },
  { value: "tilt_compensated", label: "Tilt compensated" },
] as const;

const OFFSET_TREATMENTS = [
  { value: "none_reported_point", label: "Reported point only" },
  { value: "receiver_applied", label: "Receiver-applied offsets" },
] as const;

export function GnssReferenceForm({ value, onChange, disabled, valid, errors = {} }: GnssReferenceFormProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const status = valid ? "Declared, unverified" : "Incomplete";

  function updateField<K extends keyof GnssReferenceFormValue>(field: K, next: GnssReferenceFormValue[K]): void {
    if (!disabled) onChange({ ...value, [field]: next });
  }

  return (
    <View style={styles.form} testID="gnss-reference-form">
      <Pressable
        accessibilityLabel="Receiver reference declaration"
        accessibilityRole="button"
        aria-expanded={expanded}
        accessibilityState={{ expanded }}
        accessibilityValue={{ text: status }}
        onPress={() => setExpanded((current) => !current)}
        style={styles.toggle}
        testID="gnss-reference-toggle"
      >
        {expanded ? <ChevronDown size={18} color="#254234" /> : <ChevronRight size={18} color="#254234" />}
        <View style={styles.heading}>
          <Text style={styles.title}>Receiver reference declaration</Text>
          <Text style={styles.status}>{status}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.body} testID="gnss-reference-body">
          <Text style={styles.label}>Projection frame: WGS84</Text>
          <View style={styles.fields}>
            {TEXT_FIELDS.map(({ field, label }) => (
              <View key={field} style={styles.field}>
                <Text style={styles.label}>{label}</Text>
                <TextInput
                  accessibilityLabel={label}
                  accessibilityState={{ disabled }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!disabled}
                  onChangeText={(next) => updateField(field, next)}
                  style={[styles.input, disabled && styles.disabled]}
                  testID={`gnss-reference-${field}`}
                  value={value[field]}
                />
                {value[field] !== "" && errors[field] ? <Text style={styles.error}>{errors[field]}</Text> : null}
              </View>
            ))}
          </View>
          <View style={styles.group}>
            <Text style={styles.label}>Antenna reference</Text>
            <View accessibilityLabel="Antenna reference" accessibilityRole="radiogroup" style={styles.options}>
              {ANTENNA_REFERENCES.map((option) => (
                <ReferenceRadio
                  key={option.value}
                  checked={value.antennaReference === option.value}
                  disabled={disabled}
                  label={option.label}
                  onPress={() => updateField("antennaReference", option.value)}
                  testID={`gnss-reference-antenna-${option.value}`}
                />
              ))}
            </View>
          </View>
          <View style={styles.group}>
            <Text style={styles.label}>Offset treatment</Text>
            <View accessibilityLabel="Offset treatment" accessibilityRole="radiogroup" style={styles.options}>
              {OFFSET_TREATMENTS.map((option) => (
                <ReferenceRadio
                  key={option.value}
                  checked={value.offsetTreatment === option.value}
                  disabled={disabled}
                  label={option.label}
                  onPress={() => updateField("offsetTreatment", option.value)}
                  testID={`gnss-reference-offset-${option.value}`}
                />
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ReferenceRadio({ checked, disabled, label, onPress, testID }: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      aria-checked={checked}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, disabled && styles.disabled]}
      testID={testID}
    >
      {checked ? <CircleDot size={18} color="#254234" /> : <Circle size={18} color="#607067" />}
      <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: {
    borderTopColor: "#dce3da",
    borderTopWidth: 1,
    minWidth: 0,
    width: "100%",
  },
  toggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingVertical: 8,
  },
  heading: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: "#26392f",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
  },
  status: {
    color: "#405448",
    fontSize: 12,
    letterSpacing: 0,
  },
  body: {
    gap: 10,
    minWidth: 0,
    paddingBottom: 8,
  },
  fields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  field: {
    flexBasis: 180,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    gap: 4,
  },
  label: {
    color: "#405448",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 6,
    borderWidth: 1,
    color: "#1d2c22",
    fontSize: 14,
    letterSpacing: 0,
    minHeight: 44,
    minWidth: 0,
    width: "100%",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  group: {
    gap: 4,
    minWidth: 0,
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 2,
  },
  option: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    minWidth: 0,
    maxWidth: "100%",
    paddingVertical: 6,
  },
  optionLabel: {
    color: "#314339",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
  },
  disabled: {
    opacity: 0.5,
  },
  error: { color: "#8b1e18", fontSize: 12, lineHeight: 17 },
});
