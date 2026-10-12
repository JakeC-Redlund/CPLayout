import React, { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { createCatalogId } from "@cplayout/project-store";
import { DesignDraftInputs } from "../components/DesignDraftInputs";
import { FieldDesignInputs } from "../components/FieldDesignInputs";
import { InputRetentionAdmissionProvider } from "../inputRetention";
import type { useWorkspaceController } from "./useWorkspaceController";
import { WorkspaceLateralInputs } from "./WorkspaceLateralInputs";
import { captureWorkspaceOperationOwner, isWorkspaceOperationCurrent } from "./workspacePresentation";

/** One retained information owner; measured coordinates stay under Survey controls. */
export function SurveyKnownInformationPanel({ controller }: { controller: ReturnType<typeof useWorkspaceController> }) {
  const editable = controller.state.editable;
  const owner = captureWorkspaceOperationOwner(controller.state.presentation, "interaction");
  const current = () => controller.isActive() && controller.canEditField() && controller.stateRef.current.presentation.mode === "survey"
    && isWorkspaceOperationCurrent(controller.stateRef.current.presentation, owner);
  const changed = () => { if (current()) controller.noteUserIntent(); };
  const machinePending = useRef(false), lateralPending = useRef(false);
  const visibleMode = controller.state.presentation.mode === "survey";
  useEffect(() => () => {
    // The parent conditionally mounts this owner in Survey. An unmount never
    // renders visibleMode=false, so retire its registration in cleanup too.
    machinePending.current = false; lateralPending.current = false;
    controller.setPendingInteractionInput("survey-known-information", false);
  }, [controller.state.presentation.documentGeneration, controller.setPendingInteractionInput]);
  useEffect(() => {
    if (!visibleMode) {
      machinePending.current = false; lateralPending.current = false;
      // Literal inputs remain in the shared store. This registration belongs
      // to the Survey subtree and must not outlive its rendered input owner.
      controller.setPendingInteractionInput("survey-known-information", false);
    }
  }, [visibleMode, controller.state.presentation.documentGeneration, controller.setPendingInteractionInput]);
  const pending = (value: boolean) => { if (current()) { machinePending.current = value; controller.setPendingInteractionInput("survey-known-information", value || lateralPending.current); } };
  const linearPending = (value: boolean) => { if (current()) { lateralPending.current = value; controller.setPendingInteractionInput("survey-known-information", value || machinePending.current); } };
  if (!visibleMode) return null;
  return <View testID="survey-known-information-panel"><Text>Known field and machine information</Text>
    <Text>Enter supplied machine values. Collected coordinates and receiver observations remain unchanged.</Text>
    <InputRetentionAdmissionProvider isCurrent={current}>
      {editable?.kind === "draft" ? <DesignDraftInputs editor={editable.editor} surveyInformationOnly disabled={!current()}
        onAction={action => { if (current()) controller.dispatchSurveyInformation({ kind: "draft", action }); }} onPendingChange={pending} onRawInputChange={changed} />
        : editable?.kind === "field" ? <><FieldDesignInputs editor={editable.editor} createMachineId={() => createCatalogId("machine")} disabled={!current()} recordedPivotOnly
          onAction={action => current() && action.type !== "load_field" && controller.dispatchSurveyInformation({ kind: "field", action })}
          onRenameField={name => current() && controller.dispatchSurveyInformation({ kind: "field", action: { type: "rename", name } })}
          onPendingChange={pending} onRawInputChange={changed}
          advisoryPanels={{ layoutSearch: null, lateralReview: null, machineClearance: null }} />
          <WorkspaceLateralInputs editor={editable.editor} sourceGeneration={controller.state.presentation.documentGeneration} disabled={!current()} savedPathOnly createMachineId={() => createCatalogId("linear")}
            onAction={action => current() && action.type !== "load_field" && controller.dispatchSurveyInformation({ kind: "field", action })}
            onPendingChange={linearPending} onRawInputChange={changed} /></> : <Text>Open the original Survey work or its prepared field to enter known information.</Text>}
    </InputRetentionAdmissionProvider>
  </View>;
}
