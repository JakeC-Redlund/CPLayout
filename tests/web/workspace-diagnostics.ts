import type { Page, TestInfo } from "./authenticated-test";

/** Test-only observation of the rendered controller. No product debug API and no
 * credentials, account metadata, raw values, coordinates or document bytes. */
export async function recordWorkspaceInputFlags(page: Page, info: TestInfo, name: string): Promise<void> {
  const flags = await page.evaluate(() => {
    type Controller = { inputs: { hasDirty(): boolean; entries?: Map<string, { dirty: boolean }> }; pendingInput?(key: string): boolean;
      stateRef?: { current: { presentation: { mode: string; documentGeneration: number; interactionGeneration: number } } } };
    type Fiber = { return?: Fiber | null; memoizedProps?: { controller?: Controller }; alternate?: Fiber | null };
    const element = document.querySelector('[data-testid="unified-workspace"]');
    if (!element) return { available: false, reason: "Rendered workspace is absent." };
    const key = Object.keys(element).find(item => item.startsWith("__reactFiber$"));
    let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
    while (fiber) {
      const controller = fiber.memoizedProps?.controller;
      if (controller?.inputs && typeof controller.inputs.hasDirty === "function") {
        const entries = controller.inputs.entries instanceof Map ? [...controller.inputs.entries].map(([entryKey, entry]) => ({ key: entryKey, dirty: entry.dirty })) : null;
        const keys = ["catalog", "file-dialog", "manual-drawing", "survey-label", "survey-reference", "survey-known-information", "layout-label", "layout-name", "layout-copy-name", "layout-tolerance"];
        return { available: true, hasDirty: controller.inputs.hasDirty(), entries,
          pending: keys.map(entryKey => ({ key: entryKey, dirty: controller.pendingInput?.(entryKey) ?? null })),
          presentation: controller.stateRef?.current.presentation ? { mode: controller.stateRef.current.presentation.mode,
            documentGeneration: controller.stateRef.current.presentation.documentGeneration, interactionGeneration: controller.stateRef.current.presentation.interactionGeneration } : null };
      }
      fiber = fiber.return ?? undefined;
    }
    return { available: false, reason: "Rendered controller fiber is unavailable." };
  });
  await info.attach(`${name}.json`, { body: JSON.stringify(flags), contentType: "application/json" });
}
