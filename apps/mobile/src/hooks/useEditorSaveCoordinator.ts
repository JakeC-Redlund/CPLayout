import { useEffect, useRef, useState } from "react";
import { createEditorSaveCoordinator, type EditorSaveTarget } from "../editorSaveCoordinator";

export function useEditorSaveCoordinator(initialTarget: EditorSaveTarget) {
  const [state] = useState(() => {
    // Keep replayed initialization local: opening a session mutates its coordinator.
    const saveCoordinator = createEditorSaveCoordinator();
    return { saveCoordinator, saveSessionRef: { current: saveCoordinator.open(initialTarget) } };
  });
  const saveOwnerMountedRef = useRef(true);
  useEffect(() => {
    saveOwnerMountedRef.current = true;
    return () => { saveOwnerMountedRef.current = false; };
  }, []);
  return { ...state, saveOwnerMountedRef };
}
