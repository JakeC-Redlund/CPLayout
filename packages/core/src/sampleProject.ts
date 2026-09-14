import { PivotProject } from "./types";
import { defaultProjectSettings } from "./settings";
import { projectLonLatToXy } from "./coordinates";
import type { XY } from "./types";

const observedAt = "2026-05-19T09:00:00-06:00";
const projectOrigin: XY = { x: 501000, y: 4506200 };

function p(x: number, y: number): XY {
  return { x: projectOrigin.x + x, y: projectOrigin.y + y };
}

export const sampleProject: PivotProject = {
  id: "sample-burgundy-quarter-section",
  name: "North Quarter Concept Layout",
  projectCrs: "EPSG:32613",
  unitSystem: "us_survey_feet",
  settings: defaultProjectSettings(),
  fieldBoundary: [
    p(0, 0),
    p(815, -10),
    p(858, 382),
    p(612, 780),
    p(88, 746),
    p(-32, 348),
  ],
  pivotCenter: p(410, 360),
  waterSource: p(382, 314),
  powerSource: p(118, 690),
  machine: {
    id: "machine-a",
    name: "Four-span concept pivot",
    spanLengthsMeters: [47.2, 47.2, 47.2, 47.2],
    overhangMeters: 18.5,
    endGunThrowMeters: 24,
    towerClearanceBufferMeters: 5,
    machineClearanceBufferMeters: 8,
    sweep: { mode: "full_circle" },
  },
  obstacles: [
    {
      id: "road-west",
      name: "West access road buffer",
      kind: "road",
      polygon: [
        p(94, 118),
        p(134, 118),
        p(134, 724),
        p(94, 724),
      ],
      bufferMeters: 10,
      hardConflict: true,
      noSpray: true,
      confidence: "imagery_digitized",
    },
    {
      id: "building-pad",
      name: "Pump shed and service pad",
      kind: "building",
      polygon: [
        p(542, 258),
        p(606, 258),
        p(606, 322),
        p(542, 322),
      ],
      bufferMeters: 12,
      hardConflict: true,
      noSpray: true,
      confidence: "user_estimated",
    },
  ],
  mapPackages: [],
  surveyPoints: [
    {
      id: "pivot-rtk",
      label: "Pivot center repeated shot",
      role: "pivot_center",
      projected: p(410, 360),
      observedAt,
      source: "external_gnss",
      confidence: "rtk_fixed",
      rtk: {
        fixType: "rtk_fixed",
        satellites: 18,
        hdop: 0.6,
        vdop: 0.9,
        pdop: 1.1,
        correctionAgeSeconds: 1.2,
        horizontalAccuracyMeters: 0.018,
        verticalAccuracyMeters: 0.034,
        baseStationId: "BASE-LOCAL",
        roverId: "ROVER-01",
        nmeaQualityCode: 4,
      },
    },
    {
      id: "road-draft",
      label: "Road digitized from imagery",
      role: "obstacle",
      projected: p(114, 420),
      observedAt,
      source: "manual",
      confidence: "imagery_digitized",
      notes: "Planning-grade until field checked.",
    },
  ],
};

interface SampleVariantInput {
  id: string;
  name: string;
  description: string;
  pivotCenter: XY;
  waterSource: XY;
  powerSource: XY;
  machine: PivotProject["machine"];
  mapFeatures?: PivotProject["mapFeatures"];
}

export interface SampleDesignProject {
  id: string;
  label: string;
  description: string;
  reviewStatus: "needs_review" | "curated";
  project: PivotProject;
}

function copyPoint(point: XY): XY {
  return { x: point.x, y: point.y };
}

function cloneSampleSurveyPoints(pivotCenter: XY): PivotProject["surveyPoints"] {
  return sampleProject.surveyPoints.map((point) => ({
    ...point,
    projected: point.role === "pivot_center" ? copyPoint(pivotCenter) : copyPoint(point.projected),
    rtk: point.rtk ? { ...point.rtk } : undefined,
    wgs84: point.wgs84 ? { ...point.wgs84 } : undefined,
  }));
}

function curatedSampleVariant(input: SampleVariantInput): PivotProject {
  return {
    ...sampleProject,
    id: input.id,
    name: input.name,
    settings: defaultProjectSettings(),
    fieldBoundary: sampleProject.fieldBoundary.map(copyPoint),
    pivotCenter: copyPoint(input.pivotCenter),
    waterSource: copyPoint(input.waterSource),
    powerSource: copyPoint(input.powerSource),
    machine: {
      ...input.machine,
      endGunAngleRanges: input.machine.endGunAngleRanges?.map((range) => ({ ...range })),
      spanLengthsMeters: [...input.machine.spanLengthsMeters],
      sweep: { ...input.machine.sweep },
      cornerArm: input.machine.cornerArm
        ? {
          ...input.machine.cornerArm,
          sourceRefs: input.machine.cornerArm.sourceRefs.map((sourceRef) => ({ ...sourceRef })),
        }
        : undefined,
    },
    obstacles: sampleProject.obstacles.map((obstacle) => ({
      ...obstacle,
      polygon: obstacle.polygon.map(copyPoint),
    })),
    surveyPoints: cloneSampleSurveyPoints(input.pivotCenter),
    mapPackages: [],
    mapFeatures: input.mapFeatures?.map((feature) => ({
      ...feature,
      geometry: feature.geometry.type === "Point"
        ? { type: "Point", point: copyPoint(feature.geometry.point) }
        : feature.geometry.type === "Circle"
          ? { type: "Circle", center: copyPoint(feature.geometry.center), radiusMeters: feature.geometry.radiusMeters }
          : feature.geometry.type === "LineString"
            ? { type: "LineString", vertices: feature.geometry.vertices.map(copyPoint) }
            : { type: "Polygon", vertices: feature.geometry.vertices.map(copyPoint) },
      properties: feature.properties ? { ...feature.properties } : undefined,
    })),
  };
}

export const improvedFullCircleSampleProject = curatedSampleVariant({
  id: "sample-improved-full-circle",
  name: "Improved Full-Circle Conflict Clear",
  description: "A shorter full-circle concept shifted away from the access road and service pad to remove modeled hard conflicts.",
  pivotCenter: p(360, 520),
  waterSource: p(324, 484),
  powerSource: p(142, 668),
  machine: {
    ...sampleProject.machine,
    id: "sample-improved-full-circle-machine",
    name: "Conflict-clear four-span concept pivot",
    endGunAngleRanges: [],
    endGunThrowMeters: 0,
    sweep: { mode: "full_circle" },
  },
});

export const partialSweepNearRoadSampleProject = curatedSampleVariant({
  id: "sample-partial-sweep-road-structure",
  name: "Partial Sweep Near Road And Pad",
  description: "A part-circle concept near the road and pump pad that intentionally keeps warning surfaces visible for operator review.",
  pivotCenter: p(545, 320),
  waterSource: p(503, 282),
  powerSource: p(325, 490),
  machine: {
    ...sampleProject.machine,
    id: "sample-partial-sweep-road-machine",
    name: "Road-adjacent partial-sweep pivot",
    endGunAngleRanges: [],
    endGunThrowMeters: 0,
    sweep: {
      mode: "partial_circle",
      startAngleDegrees: 330,
      stopAngleDegrees: 145,
      direction: "counterclockwise",
    },
  },
});

export const endGunShutoffArcSampleProject = curatedSampleVariant({
  id: "sample-end-gun-shutoff-arc",
  name: "End-Gun Shutoff Arc",
  description: "A full-circle concept with a limited end-gun arc; shed clearance still requires mechanical review.",
  pivotCenter: p(470, 520),
  waterSource: p(428, 482),
  powerSource: p(250, 690),
  machine: {
    ...sampleProject.machine,
    id: "sample-end-gun-shutoff-machine",
    name: "Four-span pivot with end-gun shutoff arc",
    spanLengthsMeters: [45, 45, 45, 45],
    endGunThrowMeters: 26,
    endGunAngleRanges: [
      { startAngleDegrees: 30, stopAngleDegrees: 150, direction: "counterclockwise" },
    ],
    sweep: { mode: "full_circle" },
  },
});

export const advisoryCornerArmSampleProject = curatedSampleVariant({
  id: "sample-advisory-corner-arm-footprint",
  name: "Advisory Corner-Arm Footprint",
  description: "A field-edge concept with an operator/vendor corner-arm footprint recorded as evidence only.",
  pivotCenter: p(430, 570),
  waterSource: p(392, 530),
  powerSource: p(214, 706),
  machine: {
    ...sampleProject.machine,
    id: "sample-corner-arm-machine",
    name: "Corner-arm advisory footprint pivot",
    spanLengthsMeters: [45, 45, 45, 45],
    endGunAngleRanges: [],
    endGunThrowMeters: 0,
    cornerArm: {
      id: "sample-vflex-advisory-corner-arm",
      name: "Sample VFlex advisory corner arm",
      advisoryOnly: true,
      lengthMeters: 91,
      guidanceType: "gps_guidance",
      sequencingType: "electronic",
      orientation: "operator_supplied",
      confidence: "user_estimated",
      operatorConfirmedAt: "2026-06-05T00:00:00.000Z",
      notes: "Sample advisory configuration for UI review only; proprietary kinematics are not modeled.",
      sourceRefs: [
        {
          sourceId: "SRC-VALLEY-VFLEX-CORNER",
          title: "Valley VFlex Corner",
          url: "https://www.valleyirrigation.com/vflex-corner",
          checkedAt: "2026-06-05",
          limit: "Manufacturer public feature/specification reference only; CPLayout does not certify compatibility or kinematics.",
        },
      ],
    },
    sweep: { mode: "full_circle" },
  },
  mapFeatures: [
    {
      id: "sample-corner-arm-footprint",
      name: "Advisory corner-arm footprint",
      kind: "corner_swing_limit",
      geometry: {
        type: "Polygon",
        vertices: [p(612, 598), p(708, 632), p(682, 724), p(596, 706)],
      },
      confidence: "user_estimated",
      notes: "Operator/vendor footprint evidence only; manufacturer kinematics are not modeled.",
      properties: {
        canonicalGeometryMutation: false,
        evidenceOnly: true,
      },
    },
  ],
});

const fullScopeDemoOrigin: XY = { x: 503200, y: 4505200 };

function d(x: number, y: number): XY {
  return { x: fullScopeDemoOrigin.x + x, y: fullScopeDemoOrigin.y + y };
}

export const fullScopeMultiPivotCostDemoProject: PivotProject = {
  id: "sample-full-scope-multi-pivot-cost-demo",
  name: "Full-Scope Multi-Pivot Cost Demo",
  projectCrs: "EPSG:32613",
  unitSystem: "us_survey_feet",
  settings: defaultProjectSettings(),
  fieldBoundary: [
    d(0, 60),
    d(1260, 0),
    d(1380, 390),
    d(1160, 850),
    d(540, 940),
    d(-70, 760),
  ],
  pivotCenter: d(430, 440),
  waterSource: d(180, 398),
  powerSource: d(118, 770),
  machine: {
    id: "sample-full-scope-machine-template",
    name: "Cost comparison full-scope template",
    spanLengthsMeters: [54, 54, 54],
    overhangMeters: 10,
    endGunThrowMeters: 18,
    towerClearanceBufferMeters: 5,
    machineClearanceBufferMeters: 9,
    sweep: { mode: "full_circle" },
  },
  obstacles: [
    {
      id: "sample-demo-equipment-yard",
      name: "Equipment yard hard-blocking review",
      kind: "building",
      polygon: [d(610, 360), d(690, 360), d(700, 438), d(604, 448)],
      bufferMeters: 14,
      hardConflict: true,
      noSpray: true,
      confidence: "user_estimated",
    },
    {
      id: "sample-demo-canal-buffer",
      name: "Canal no-spray crossing review",
      kind: "canal",
      polygon: [d(960, 110), d(1012, 112), d(964, 790), d(918, 784)],
      bufferMeters: 8,
      hardConflict: false,
      noSpray: true,
      confidence: "imagery_digitized",
    },
  ],
  surveyPoints: [
    {
      id: "sample-demo-existing-pivot-evidence",
      label: "Existing pivot evidence",
      role: "pivot_center",
      projected: d(430, 440),
      observedAt,
      source: "manual",
      confidence: "user_estimated",
      notes: "Synthetic demo pivot evidence for advisory comparison only.",
    },
    {
      id: "sample-demo-second-pivot-evidence",
      label: "Bender second pivot evidence at drive tower",
      role: "pivot_center",
      projected: d(500, 430),
      observedAt,
      source: "manual",
      confidence: "user_estimated",
      notes: "Synthetic projected-XY second-pivot evidence for opportunity-envelope demo only.",
    },
  ],
  mapPackages: [],
  mapFeatures: [
    {
      id: "sample-demo-west-planning-boundary",
      name: "West planning boundary",
      kind: "planning_boundary",
      geometry: { type: "Polygon", vertices: [d(10, 80), d(625, 40), d(596, 870), d(-50, 720)] },
      confidence: "user_estimated",
      notes: "Synthetic full-scope planning boundary; advisory review only.",
      properties: { canonicalGeometryMutation: false, evidenceOnly: true },
    },
    {
      id: "sample-demo-east-planning-boundary",
      name: "East planning boundary",
      kind: "planning_boundary",
      geometry: { type: "Polygon", vertices: [d(640, 40), d(1270, 26), d(1320, 430), d(1110, 820), d(610, 876)] },
      confidence: "user_estimated",
      notes: "Synthetic second planning boundary for compiled full-scope review.",
      properties: { canonicalGeometryMutation: false, evidenceOnly: true },
    },
    {
      id: "sample-demo-west-machine-zone",
      name: "West machine zone",
      kind: "machine_zone",
      geometry: { type: "Circle", center: d(290, 390), radiusMeters: 214 },
      confidence: "user_estimated",
      notes: "Synthetic advisory machine-zone review feature.",
      properties: { canonicalGeometryMutation: false, evidenceOnly: true },
    },
    {
      id: "sample-demo-center-machine-zone",
      name: "Center machine zone",
      kind: "machine_zone",
      geometry: { type: "Circle", center: d(720, 720), radiusMeters: 204 },
      confidence: "user_estimated",
      notes: "Synthetic advisory machine-zone review feature.",
      properties: { canonicalGeometryMutation: false, evidenceOnly: true },
    },
    {
      id: "sample-demo-east-machine-zone",
      name: "East machine zone",
      kind: "machine_zone",
      geometry: { type: "Circle", center: d(1220, 540), radiusMeters: 206 },
      confidence: "user_estimated",
      notes: "Synthetic advisory machine-zone review feature.",
      properties: { canonicalGeometryMutation: false, evidenceOnly: true },
    },
    {
      id: "sample-demo-linear-path",
      name: "North lateral path comparison",
      kind: "linear_move_path",
      geometry: { type: "LineString", vertices: [d(170, 735), d(1090, 706)] },
      confidence: "user_estimated",
      notes: "Synthetic projected-XY path for advisory linear/lateral strategy scoring only.",
      properties: { canonicalGeometryMutation: false, evidenceOnly: true },
    },
    {
      id: "sample-demo-measurement-line",
      name: "Existing wheel track measure",
      kind: "measurement_line",
      geometry: { type: "LineString", vertices: [d(430, 440), d(598, 440)] },
      confidence: "user_estimated",
      notes: "Synthetic machine-length evidence line; not a certified survey.",
      properties: { derivedLengthMeters: 168, canonicalGeometryMutation: false, evidenceOnly: true },
    },
    {
      id: "sample-demo-pump",
      name: "Pump station",
      kind: "pump_location",
      geometry: { type: "Point", point: d(180, 398) },
      confidence: "user_estimated",
      notes: "Synthetic utility evidence.",
    },
    {
      id: "sample-demo-well",
      name: "Well source",
      kind: "well_location",
      geometry: { type: "Point", point: d(146, 384) },
      confidence: "user_estimated",
      notes: "Synthetic well evidence for obstacle/utility review.",
    },
    {
      id: "sample-demo-pipeline",
      name: "Underground pipeline",
      kind: "underground_pipeline",
      geometry: { type: "LineString", vertices: [d(146, 384), d(430, 440), d(676, 472), d(1044, 490)] },
      confidence: "user_estimated",
      notes: "Synthetic pipe route evidence; advisory only.",
    },
    {
      id: "sample-demo-wire",
      name: "Underground control wire",
      kind: "underground_wire",
      geometry: { type: "LineString", vertices: [d(118, 770), d(430, 440), d(676, 472)] },
      confidence: "user_estimated",
      notes: "Synthetic wire route evidence; advisory only.",
    },
    {
      id: "sample-demo-power-line",
      name: "Power line",
      kind: "power_line",
      geometry: { type: "LineString", vertices: [d(118, 770), d(1110, 820)] },
      confidence: "user_estimated",
      notes: "Synthetic overhead power evidence; advisory only.",
    },
    {
      id: "sample-demo-power-pole",
      name: "Power pole",
      kind: "power_pole",
      geometry: { type: "Point", point: d(500, 440) },
      confidence: "user_estimated",
      notes: "Synthetic pole evidence.",
    },
  ],
};

const willRheaObservedAt = "2026-06-06T00:00:00.000Z";
const willRheaProjectCrs = "EPSG:32614";
const willRheaSourceFileName = "Will Rhea.kmz";
const willRheaSourcePath = "docs/evidence/client-kmz-advisory/will-rhea/Will Rhea.kmz";
const willRheaSourceKind = "operator_supplied_local_kmz";
const willRheaSourceKmzSha256 = "895e9367fd07c730572618d5ed01b96a66519de725faab082d6f1714ef827401";
const willRheaSourceKmlEntryName = "doc.kml";
const willRheaSourceDocKmlSha256 = "aa2b577569c7bdf52197761bdcfadcc2c8e87afe60294c0151409a785645d97e";
const willRheaMiddlePartCircleKmlSha256 = "4a59a9adfcf94528067bab0163563b31b4f457b21b16ea078e23e1bd371e3c72";
const willRheaSouthEastCircleKmlSha256 = "f9689f517c922aa9edcab9748c6d95bf13048f4382393c5d23514c4218e04a48";

function wr(longitude: number, latitude: number): XY {
  return projectLonLatToXy({ longitude, latitude }, willRheaProjectCrs);
}

function xyDistanceMeters(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function spanSetForRadius(radiusMeters: number): number[] {
  const spanCount = Math.max(1, Math.ceil(radiusMeters / 54));
  const spanLength = Math.round((radiusMeters / spanCount) * 10) / 10;
  const spans = Array.from({ length: spanCount }, () => spanLength);
  spans[spanCount - 1] = Math.round((radiusMeters - spanLength * (spanCount - 1)) * 10) / 10;
  return spans;
}

function willRheaEvidenceProperties(sourcePlacemark: string, extras: Record<string, string | number | boolean | null> = {}): Record<string, string | number | boolean | null> {
  return {
    sourceKind: willRheaSourceKind,
    sourceFileName: willRheaSourceFileName,
    sourcePath: willRheaSourcePath,
    sourceKmzSha256: willRheaSourceKmzSha256,
    sourceKmlEntryName: willRheaSourceKmlEntryName,
    sourceDocKmlSha256: willRheaSourceDocKmlSha256,
    sourcePlacemark,
    canonicalGeometryMutation: false,
    evidenceOnly: true,
    ...extras,
  };
}

const willRheaMiddleBoundary = [
  wr(-97.28372565832038, 42.90112203521912),
  wr(-97.2862454518893, 42.9010278780816),
  wr(-97.2887908719384, 42.90096814284777),
  wr(-97.28876150484578, 42.89839218174122),
  wr(-97.28876293138067, 42.89834712799657),
  wr(-97.28872773453419, 42.89820846081622),
  wr(-97.28842376578737, 42.89818377946268),
  wr(-97.28388495944927, 42.8982043706849),
  wr(-97.28387323674161, 42.89522253500184),
  wr(-97.27789599859895, 42.89543170815415),
  wr(-97.27839707263755, 42.89668505834992),
  wr(-97.27865524622686, 42.89714454967947),
  wr(-97.27910976500326, 42.89769216178609),
  wr(-97.27922653017752, 42.89783875969702),
  wr(-97.27928333047915, 42.89801511761743),
  wr(-97.27952225620592, 42.89815443962794),
  wr(-97.27962594955291, 42.89837563853295),
  wr(-97.27972172894511, 42.89863476983267),
  wr(-97.27976267501315, 42.89874608122614),
  wr(-97.27978932425383, 42.89886869343957),
  wr(-97.280010517598, 42.89931971801695),
  wr(-97.28011644560567, 42.89971818260744),
  wr(-97.28027373414896, 42.90004444913738),
  wr(-97.28040591617304, 42.90033535031048),
  wr(-97.28047666688161, 42.90067462359451),
  wr(-97.28089277693144, 42.90098308921548),
  wr(-97.28097785510678, 42.90122533322885),
];

const willRheaSouthBoundary = [
  wr(-97.28388437532014, 42.89525334942844),
  wr(-97.28380429489741, 42.89089247448032),
  wr(-97.27663164569952, 42.89106532952891),
  wr(-97.27646780945, 42.89124097905972),
  wr(-97.27649191460577, 42.89149607189767),
  wr(-97.27647229171482, 42.89217380143266),
  wr(-97.27652787380126, 42.89367150833588),
  wr(-97.27657931941707, 42.8939118875367),
  wr(-97.27666074478617, 42.8943118503139),
  wr(-97.2771158868576, 42.89515341832646),
  wr(-97.27715617189897, 42.89520478794139),
  wr(-97.27746554623401, 42.89529574543461),
  wr(-97.27762561353225, 42.89530987937744),
  wr(-97.27789599859895, 42.89543170815415),
];

const willRheaFullScopeBoundary = [
  wr(-97.29369262615309, 42.90167661000692),
  wr(-97.29363852869064, 42.9016761929968),
  wr(-97.29363711665349, 42.90171717823377),
  wr(-97.28879322597311, 42.90182383122026),
  wr(-97.28876150484578, 42.89839218174122),
  wr(-97.28876293138067, 42.89834712799657),
  wr(-97.28872773453419, 42.89820846081622),
  wr(-97.28842376578737, 42.89818377946268),
  wr(-97.28388495944927, 42.8982043706849),
  wr(-97.28384055778417, 42.89812087328995),
  wr(-97.28380429489741, 42.89089247448032),
  wr(-97.27663164569952, 42.89106532952891),
  wr(-97.27646780945, 42.89124097905972),
  wr(-97.27649191460577, 42.89149607189767),
  wr(-97.27647229171482, 42.89217380143266),
  wr(-97.27652787380126, 42.89367150833588),
  wr(-97.27657931941707, 42.8939118875367),
  wr(-97.27666074478617, 42.8943118503139),
  wr(-97.2771158868576, 42.89515341832646),
  wr(-97.27715617189897, 42.89520478794139),
  wr(-97.27746554623401, 42.89529574543461),
  wr(-97.27762561353225, 42.89530987937744),
  wr(-97.27789599859895, 42.89543170815415),
  wr(-97.27839707263755, 42.89668505834992),
  wr(-97.27865524622686, 42.89714454967947),
  wr(-97.27910976500326, 42.89769216178609),
  wr(-97.27922653017752, 42.89783875969702),
  wr(-97.27928333047915, 42.89801511761743),
  wr(-97.27952225620592, 42.89815443962794),
  wr(-97.27962594955291, 42.89837563853295),
  wr(-97.27972172894511, 42.89863476983267),
  wr(-97.27976267501315, 42.89874608122614),
  wr(-97.27978932425383, 42.89886869343957),
  wr(-97.280010517598, 42.89931971801695),
  wr(-97.28011644560567, 42.89971818260744),
  wr(-97.28027373414896, 42.90004444913738),
  wr(-97.28040591617304, 42.90033535031048),
  wr(-97.28047666688161, 42.90067462359451),
  wr(-97.28089277693144, 42.90098308921548),
  wr(-97.28096966856215, 42.90129914758626),
  wr(-97.28194271897232, 42.90204565342629),
  wr(-97.28327490123333, 42.90288877730912),
  wr(-97.28433603906792, 42.90348510329863),
  wr(-97.28505436725519, 42.90393116954889),
  wr(-97.28628917986541, 42.90466094711623),
  wr(-97.2873890198224, 42.90544371025065),
  wr(-97.28982153886321, 42.90654394487177),
  wr(-97.29085596905851, 42.90671745496059),
  wr(-97.29223851508645, 42.90700060741206),
  wr(-97.29309439731216, 42.90707490183578),
  wr(-97.29446501889933, 42.9072671764559),
  wr(-97.29513441695509, 42.90734629685587),
  wr(-97.29581164228108, 42.90742238326278),
  wr(-97.29641179828211, 42.90750987121181),
  wr(-97.29718846145255, 42.90755849646914),
  wr(-97.29786740535421, 42.90760060686129),
  wr(-97.29830210478293, 42.9075824935513),
  wr(-97.29818205474636, 42.90105068056278),
  wr(-97.29814763123508, 42.90092818118597),
  wr(-97.29801118020967, 42.90085991315835),
  wr(-97.29370569396534, 42.90093016444332),
];

const willRheaPivotPoint = wr(-97.28375260755031, 42.89522534846535);
const willRheaLrduMeasurementLine = [
  wr(-97.28375170532335, 42.89522705985541),
  wr(-97.27808731710788, 42.89538423309978),
];
const willRheaLastWheelRadiusMeters = Math.round(xyDistanceMeters(willRheaLrduMeasurementLine[0], willRheaLrduMeasurementLine[1]) * 10) / 10;
const willRheaMiddlePartCircleOutline = [
  wr(-97.28378575053564, 42.89539508956296),
  wr(-97.28374984539798, 42.89819547251169),
  wr(-97.28767701354103, 42.89819754700792),
  wr(-97.2876749576654, 42.89824411593769),
  wr(-97.2876601736607, 42.89849243118386),
  wr(-97.28761590260146, 42.89873885758971),
  wr(-97.28754248107262, 42.89898151966763),
  wr(-97.28744046753305, 42.89921857055752),
  wr(-97.28731063807513, 42.89944820608405),
  wr(-97.28715398052717, 42.89966867848983),
  wr(-97.28697168694308, 42.89987830973972),
  wr(-97.2867651445363, 42.90007550429488),
  wr(-97.28653592512687, 42.90025876125951),
  wr(-97.28628577318179, 42.90042668580728),
  wr(-97.28601659253945, 42.90057799980083),
  wr(-97.28573043191938, 42.90071155152305),
  wr(-97.28542946932741, 42.90082632444634),
  wr(-97.2851159954752, 42.90092144497238),
  wr(-97.28479239634026, 42.90099618908411),
  wr(-97.28446113499966, 42.90104998785879),
  wr(-97.28412473287551, 42.90108243180002),
  wr(-97.28378575053567, 42.90109327395603),
  wr(-97.28344676819583, 42.90108243180001),
  wr(-97.28311036607167, 42.90104998785878),
  wr(-97.28277910473105, 42.9009961890841),
  wr(-97.28245550559613, 42.90092144497235),
  wr(-97.28214203174393, 42.90082632444633),
  wr(-97.28184106915197, 42.90071155152305),
  wr(-97.28155490853189, 42.9005779998008),
  wr(-97.28128572788957, 42.90042668580726),
  wr(-97.28103557594447, 42.90025876125949),
  wr(-97.28080635653505, 42.90007550429488),
  wr(-97.28059981412825, 42.89987830973972),
  wr(-97.28041752054416, 42.89966867848985),
  wr(-97.28026086299622, 42.89944820608407),
  wr(-97.2801310335383, 42.89921857055754),
  wr(-97.28002901999872, 42.89898151966764),
  wr(-97.27995559846985, 42.89873885758973),
  wr(-97.27991132741062, 42.89849243118389),
  wr(-97.27989654340593, 42.89824411593773),
  wr(-97.27991135861564, 42.89799580169153),
  wr(-97.27995565993176, 42.89774937825528),
  wr(-97.28002910984998, 42.89750672102626),
  wr(-97.28013114904886, 42.89726967671729),
  wr(-97.28026100065634, 42.89704004930373),
  wr(-97.28041767617113, 42.8968195862965),
  wr(-97.2805999829934, 42.89660996544515),
  wr(-97.28080653350749, 42.89641278197251),
  wr(-97.281035755647, 42.89622953643774),
  wr(-97.28128590486199, 42.8960616233198),
  wr(-97.28155507739703, 42.8959103204088),
  wr(-97.28184122477889, 42.89577677908506),
  wr(-97.28214216940404, 42.89566201556033),
  wr(-97.28245562110666, 42.89556690314728),
  wr(-97.28277919458228, 42.89549216561647),
  wr(-97.2831104275335, 42.89543837169068),
  wr(-97.2834467994008, 42.895405930719),
  wr(-97.28378575053564, 42.89539508956296),
];
const willRheaSouthEastCircleOutline = [
  wr(-97.28017401929031, 42.89101392191814),
  wr(-97.28046924462733, 42.89102317655107),
  wr(-97.2807622458374, 42.89105124671899),
  wr(-97.2810507932658, 42.89109791881643),
  wr(-97.28133269113776, 42.89116283768227),
  wr(-97.28160579426209, 42.89124550930141),
  wr(-97.28186802435076, 42.89134530456289),
  wr(-97.28211738583, 42.8914614640456),
  wr(-97.28235198102317, 42.89159310379542),
  wr(-97.28257002458967, 42.89173922205008),
  wr(-97.28276985711041, 42.89189870686012),
  wr(-97.28294995771613, 42.89207034454856),
  wr(-97.28310895566294, 42.89225282894474),
  wr(-97.28324564076662, 42.89244477132212),
  wr(-97.28335897261618, 42.89264471096455),
  wr(-97.28344808849694, 42.89285112628088),
  wr(-97.28351230996188, 42.89306244638286),
  wr(-97.2835511480019, 42.89327706303899),
  wr(-97.2835643067749, 42.89349334291277),
  wr(-97.28355168586515, 42.89370963999254),
  wr(-97.28351338105588, 42.89392430811851),
  wr(-97.28344968360832, 42.89413571351112),
  wr(-97.28336107805309, 42.89434224720598),
  wr(-97.28324823851008, 42.89454233730026),
  wr(-97.28311202356461, 42.89473446091758),
  wr(-97.28295346973913, 42.89491715580012),
  wr(-97.28277378360914, 42.89508903143975),
  wr(-97.28257433262411, 42.89524877966339),
  wr(-97.28235663470235, 42.89539518459191),
  wr(-97.28212234667961, 42.89552713189661),
  wr(-97.28187325169877, 42.89564361728307),
  wr(-97.28161124563692, 42.89574375413726),
  wr(-97.2813383226732, 42.89582678027597),
  wr(-97.28105656010716, 42.8958920637499),
  wr(-97.28076810254342, 42.89593910765545),
  wr(-97.28047514556324, 42.89596755391803),
  wr(-97.28017991900741, 42.8959771860186),
  wr(-97.27988466999774, 42.89596793064221),
  wr(-97.27959164582711, 42.89593985823635),
  wr(-97.27930307684787, 42.89589318247447),
  wr(-97.27902115948959, 42.89582825862902),
  wr(-97.27874803953553, 42.89574558086641),
  wr(-97.27848579578512, 42.89564577848427),
  wr(-97.27823642422719, 42.89552961112009),
  wr(-97.27800182284466, 42.89539796296742),
  wr(-97.27778377716614, 42.8952518360439),
  wr(-97.27758394667497, 42.89509234256233),
  wr(-97.27740385217867, 42.8949206964632),
  wr(-97.27724486423551, 42.89473820417272),
  wr(-97.2771081927258, 42.89454625465731),
  wr(-97.27699487764741, 42.89434630884997),
  wr(-97.27690578120553, 42.89413988852921),
  wr(-97.27684158125645, 42.89392856473531),
  wr(-97.27680276615555, 42.89371394581195),
  wr(-97.27678963104799, 42.89349766516454),
  wr(-97.27680227563036, 42.89328136882821),
  wr(-97.27684060340019, 42.89306670294017),
  wr(-97.2769043223986, 42.89285530121201),
  wr(-97.27699294744014, 42.89264877249676),
  wr(-97.27710580381289, 42.89244868854593),
  wr(-97.27724203242008, 42.89225657204926),
  wr(-97.27740059632424, 42.89207388504821),
  wr(-97.27758028864359, 42.89190201781141),
  wr(-97.27777974174063, 42.89174227825664),
  wr(-97.27799743763283, 42.89159588199965),
  wr(-97.27823171954614, 42.89146394310563),
  wr(-97.27848080452333, 42.89134746561345),
  wr(-97.27874279699124, 42.8912473358973),
  wr(-97.27901570318376, 42.8911643159235),
  wr(-97.27929744631095, 42.891099037454),
  wr(-97.27958588235882, 42.89105199724037),
  wr(-97.27987881639983, 42.891023553245),
  wr(-97.28017401929031, 42.89101392191814),
];

export const willRheaJasonHarmelinkExampleProject: PivotProject = {
  id: "will-rhea-jason-harmelink-example",
  name: "Will Rhea / Jason Harmelink Example Map",
  projectCrs: willRheaProjectCrs,
  unitSystem: "us_survey_feet",
  settings: defaultProjectSettings(),
  fieldBoundary: willRheaFullScopeBoundary,
  pivotCenter: willRheaPivotPoint,
  waterSource: willRheaPivotPoint,
  powerSource: willRheaPivotPoint,
  machine: {
    id: "will-rhea-lrdu-radius-template",
    name: "LRDU last-wheel radius template",
    spanLengthsMeters: spanSetForRadius(willRheaLastWheelRadiusMeters),
    overhangMeters: 0,
    endGunThrowMeters: 0,
    towerClearanceBufferMeters: 5,
    machineClearanceBufferMeters: 8,
    sweep: { mode: "full_circle" },
  },
  obstacles: [],
  surveyPoints: [
    {
      id: "will-rhea-pivot-point",
      label: "Pivot Point",
      role: "pivot_center",
      projected: willRheaPivotPoint,
      wgs84: { longitude: -97.28375260755031, latitude: 42.89522534846535 },
      observedAt: willRheaObservedAt,
      source: "imported",
      confidence: "imagery_digitized",
      notes: "Operator-supplied local KMZ point evidence; advisory example only.",
    },
  ],
  mapPackages: [],
  mapFeatures: [
    {
      id: "will-rhea-full-scope-field-boundary-evidence",
      name: "Full Scope Field Boundary Evidence",
      kind: "planning_boundary",
      geometry: { type: "Polygon", vertices: willRheaFullScopeBoundary },
      confidence: "imagery_digitized",
      notes: "Parallel evidence feature for the active full-scope field boundary from local KMZ; advisory example only.",
      properties: willRheaEvidenceProperties("Full_Scope_Field Boundary"),
    },
    {
      id: "will-rhea-middle-machine-field-boundary",
      name: "Middle Machine Field Boundary",
      kind: "machine_zone",
      geometry: { type: "Polygon", vertices: willRheaMiddleBoundary },
      confidence: "imagery_digitized",
      notes: "Derived from owner-selected local Will Rhea KMZ evidence placemark; advisory example only.",
      properties: willRheaEvidenceProperties("Middle_Machine_Field_Boundary"),
    },
    {
      id: "will-rhea-south-machine-field-boundary",
      name: "South Machine Field Boundary",
      kind: "machine_zone",
      geometry: { type: "Polygon", vertices: willRheaSouthBoundary },
      confidence: "imagery_digitized",
      notes: "Derived from owner-selected local Will Rhea KMZ evidence placemark; advisory example only.",
      properties: willRheaEvidenceProperties("South_Machine_Field_Boundary"),
    },
    {
      id: "will-rhea-middle-part-circle-preferred-outline",
      name: "Middle Part Circle",
      kind: "machine_zone",
      geometry: { type: "LineString", vertices: willRheaMiddlePartCircleOutline },
      confidence: "imagery_digitized",
      notes: "Owner-selected companion KML preferred middle-machine part-circle outline; advisory rendering evidence only.",
      properties: willRheaEvidenceProperties("Middle Part Circle", {
        advisoryDesignRole: "preferred_machine_outline",
        advisorySweepMode: "partial_circle",
        preferredMachineOutline: true,
        sourceKmlFileName: "Middle Part Circle.kml",
        sourcePath: "docs/evidence/client-kmz-advisory/will-rhea/Middle Part Circle.kml",
        sourceSha256: willRheaMiddlePartCircleKmlSha256,
      }),
    },
    {
      id: "will-rhea-south-east-circle-preferred-outline",
      name: "South East Circle",
      kind: "machine_zone",
      geometry: { type: "LineString", vertices: willRheaSouthEastCircleOutline },
      confidence: "imagery_digitized",
      notes: "Owner-selected companion KML preferred south-east full-circle outline; advisory rendering evidence only.",
      properties: willRheaEvidenceProperties("South East Circle", {
        advisoryDesignRole: "preferred_machine_outline",
        advisorySweepMode: "full_circle",
        preferredMachineOutline: true,
        sourceKmlFileName: "South East Circle.kml",
        sourcePath: "docs/evidence/client-kmz-advisory/will-rhea/South East Circle.kml",
        sourceSha256: willRheaSouthEastCircleKmlSha256,
      }),
    },
    {
      id: "will-rhea-lrdu-distance",
      name: "LRDU Distance",
      kind: "measurement_line",
      geometry: { type: "LineString", vertices: willRheaLrduMeasurementLine },
      confidence: "imagery_digitized",
      notes: "Google Earth length-to-last-wheel evidence from local KMZ; not an overhang/end-boom measurement.",
      properties: willRheaEvidenceProperties("LRDU Distance", { derivedLengthMeters: willRheaLastWheelRadiusMeters }),
    },
  ],
};

export const sampleDesignProjects: SampleDesignProject[] = [
  {
    id: "will-rhea-jason-harmelink-example",
    label: "Will Rhea Example",
    description: "Operator-supplied Jason Harmelink field boundaries, pivot point, and LRDU distance evidence for all development loads.",
    reviewStatus: "needs_review",
    project: willRheaJasonHarmelinkExampleProject,
  },
  {
    id: "sample-baseline-needs-review",
    label: "Needs Review Baseline",
    description: "Existing sample with road and service-pad warnings preserved for comparison.",
    reviewStatus: "needs_review",
    project: sampleProject,
  },
  {
    id: "sample-improved-full-circle",
    label: "Improved Full-Circle",
    description: improvedFullCircleSampleProject.name,
    reviewStatus: "curated",
    project: improvedFullCircleSampleProject,
  },
  {
    id: "sample-partial-sweep-road-structure",
    label: "Partial Sweep Near Road",
    description: partialSweepNearRoadSampleProject.name,
    reviewStatus: "curated",
    project: partialSweepNearRoadSampleProject,
  },
  {
    id: "sample-end-gun-shutoff-arc",
    label: "End-Gun Shutoff Arc",
    description: endGunShutoffArcSampleProject.name,
    reviewStatus: "curated",
    project: endGunShutoffArcSampleProject,
  },
  {
    id: "sample-advisory-corner-arm-footprint",
    label: "Corner-Arm Footprint",
    description: advisoryCornerArmSampleProject.name,
    reviewStatus: "curated",
    project: advisoryCornerArmSampleProject,
  },
  {
    id: "sample-full-scope-multi-pivot-cost-demo",
    label: "Full-Scope Cost Demo",
    description: fullScopeMultiPivotCostDemoProject.name,
    reviewStatus: "curated",
    project: fullScopeMultiPivotCostDemoProject,
  },
];

const publicProofObservedAt = "2026-05-29T00:00:00-06:00";
const publicProofCrs = "EPSG:32613";
const publicProofReference = {
  latitude: 39.899125,
  longitude: -104.070061,
};
const publicProofPivotCenter = {
  latitude: 39.902125,
  longitude: -104.070061,
};
const publicProofCenter = projectLonLatToXy(publicProofPivotCenter, publicProofCrs);
const improvedPublicProofCenter: XY = {
  x: 579493.1558109762,
  y: 4417310.984825163,
};

function offset(center: XY, x: number, y: number): XY {
  return { x: center.x + x, y: center.y + y };
}

function circlePolygon(center: XY, radiusMeters: number, segments = 144): XY[] {
  return Array.from({ length: segments }, (_, index) => {
    const theta = (index / segments) * Math.PI * 2;
    return {
      x: center.x + radiusMeters * Math.cos(theta),
      y: center.y + radiusMeters * Math.sin(theta),
    };
  });
}

function bufferedLinePolygon(start: XY, end: XY, halfWidthMeters: number): XY[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [start, end, end, start];
  const nx = (-dy / length) * halfWidthMeters;
  const ny = (dx / length) * halfWidthMeters;
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

export const publicCenterPivotProofSource = {
  name: "Wikimedia Commons center pivot irrigation in Adams County, Colorado",
  url: "https://commons.wikimedia.org/wiki/File:Center_pivot_irrigation_in_Colorado.JPG",
  author: "Jeffrey Beall",
  license: "CC BY 4.0",
  referenceCoordinate: publicProofReference,
  proofPivotCenter: publicProofPivotCenter,
} as const;

export const realCenterPivotProofProject: PivotProject = {
  id: "public-adams-county-center-pivot-proof",
  name: "Public Adams County Center Pivot Proof",
  projectCrs: publicProofCrs,
  unitSystem: "us_survey_feet",
  settings: defaultProjectSettings(),
  fieldBoundary: [
    offset(publicProofCenter, -430, -414),
    offset(publicProofCenter, 430, -414),
    offset(publicProofCenter, 430, 420),
    offset(publicProofCenter, -430, 420),
  ],
  pivotCenter: publicProofCenter,
  waterSource: offset(publicProofCenter, 58, -330),
  powerSource: offset(publicProofCenter, 238, -324),
  machine: {
    id: "public-proof-seven-tower",
    name: "Seven-tower public proof pivot",
    spanLengthsMeters: [54, 54, 54, 54, 54, 54, 54],
    overhangMeters: 18,
    endGunThrowMeters: 12,
    towerClearanceBufferMeters: 5,
    machineClearanceBufferMeters: 8,
    sweep: { mode: "full_circle" },
  },
  obstacles: [
    {
      id: "diagonal-service-track-no-spray",
      name: "Diagonal service track no-spray",
      kind: "road",
      polygon: bufferedLinePolygon(offset(publicProofCenter, -280, -250), offset(publicProofCenter, 246, 234), 9),
      bufferMeters: 9,
      hardConflict: true,
      noSpray: true,
      confidence: "imagery_digitized",
    },
    {
      id: "south-county-road-setback",
      name: "South county road setback",
      kind: "road",
      polygon: [
        offset(publicProofCenter, -334, -414),
        offset(publicProofCenter, 334, -414),
        offset(publicProofCenter, 334, -368),
        offset(publicProofCenter, -334, -368),
      ],
      bufferMeters: 12,
      hardConflict: true,
      noSpray: true,
      confidence: "imagery_digitized",
    },
  ],
  mapPackages: [],
  mapFeatures: [
    {
      id: "visible-access-lane",
      name: "Visible access lane to pivot",
      kind: "access_lane",
      geometry: {
        type: "LineString",
        vertices: [offset(publicProofCenter, -285, -255), offset(publicProofCenter, 248, 236)],
      },
      confidence: "imagery_digitized",
      notes: "Aligned to the visible diagonal service track in the public proof imagery.",
    },
    {
      id: "power-feed-from-112th",
      name: "Power feed from 112th Avenue",
      kind: "power_line",
      geometry: {
        type: "LineString",
        vertices: [offset(publicProofCenter, 238, -324), offset(publicProofCenter, 0, 0)],
      },
      confidence: "user_estimated",
      notes: "Planning-grade utility route for export proof only.",
    },
  ],
  surveyPoints: [
    {
      id: "public-proof-pivot-center",
      label: "Public proof pivot center",
      role: "pivot_center",
      projected: publicProofCenter,
      wgs84: publicProofPivotCenter,
      observedAt: publicProofObservedAt,
      source: "manual",
      confidence: "imagery_digitized",
      notes: "Calibrated from Google Earth visual proof near the Wikimedia public reference coordinate.",
    },
    {
      id: "wikimedia-reference-coordinate",
      label: "Wikimedia public reference coordinate",
      role: "control",
      projected: projectLonLatToXy(publicProofReference, publicProofCrs),
      wgs84: publicProofReference,
      observedAt: publicProofObservedAt,
      source: "imported",
      confidence: "imagery_digitized",
      notes: "Camera/location coordinate from the public Wikimedia Commons source page; used as a reproducible reference, not as the pivot center.",
    },
  ],
};

export const improvedCenterPivotProofProject: PivotProject = {
  ...realCenterPivotProofProject,
  id: "public-adams-county-center-pivot-improved-proof",
  name: "Public Adams County Improved Pivot Proof",
  pivotCenter: improvedPublicProofCenter,
  obstacles: realCenterPivotProofProject.obstacles.filter((obstacle) => obstacle.id === "south-county-road-setback"),
  mapFeatures: (realCenterPivotProofProject.mapFeatures ?? []).map((feature) => {
    if (feature.id === "power-feed-from-112th" && feature.geometry.type === "LineString") {
      return {
        ...feature,
        geometry: {
          type: "LineString",
          vertices: [realCenterPivotProofProject.powerSource, improvedPublicProofCenter],
        },
      };
    }
    return feature;
  }),
  surveyPoints: realCenterPivotProofProject.surveyPoints.map((point) => {
    if (point.role !== "pivot_center") return point;
    return {
      ...point,
      projected: improvedPublicProofCenter,
      notes: "Improved visual-inspection pivot center for Google Earth companion proof; projected XY remains canonical.",
    };
  }),
};
