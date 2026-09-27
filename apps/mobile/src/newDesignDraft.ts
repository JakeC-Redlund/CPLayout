import { DESIGN_DRAFT_DOCUMENT_VERSION, defaultProjectSettings, parseDesignDraftDocument, type DesignDraft, type PivotProject } from "@cplayout/core";

export function newDesignDraft(id: string, name: string, unitSystem: PivotProject["unitSystem"]): DesignDraft {
  const settings = defaultProjectSettings();
  settings.unitSystem = unitSystem;
  return parseDesignDraftDocument({ documentVersion: DESIGN_DRAFT_DOCUMENT_VERSION, draft: {
    id, name, unitSystem, settings, projectCrs: null, fieldBoundary: [],
    pivotCenter: null, waterSource: null, powerSource: null, machine: {},
    obstacles: [], surveyPoints: [], mapFeatures: [], mapPackages: [],
  } });
}
