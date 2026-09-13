export function advisoryDemand(input: {
  homeView: boolean;
  view: string;
  modal: string | null;
  sidebar: string;
  sidebarOpen: boolean;
}): { fieldPlan: boolean; renderModel: boolean; multiMachine: boolean; cornerArm: boolean } {
  const map = !input.homeView && input.view === "map";
  const calculate = !input.homeView && input.modal === "calculate";
  const overview = map && input.sidebarOpen && input.sidebar === "overview";
  return {
    fieldPlan: map || calculate,
    renderModel: map || calculate || overview,
    multiMachine: calculate || overview,
    cornerArm: !input.homeView && input.modal === "cornerArm",
  };
}
