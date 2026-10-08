# Calculation Report

## Inputs And Results

Open Calculate from the map tools. Back returns to the workspace; the fixed
header shows the project's saved or unsaved state. Report values are read-only.
Inputs and explicit action controls are separate from those values.

- **Requested pivots:** the minus/plus controls request one to four preview
  centers using the current machine template. A preview can find fewer separated
  centers than requested. It does not create independently saved machines.
- **Mapped outline results:** these use existing advisory outline evidence.
  They are separate from the generated-center preview. Net coverage removes
  overlap; component areas must not simply be added together. Missing corner
  model evidence is unavailable, not a measured zero.
- **Pivot equipment cost:** choose a price for the current pivot configuration,
  or an explicit estimate using base amount, additional cost per foot of pivot,
  and additional cost per drive tower. The two methods are not added together.
  State the currency and included equipment/work. In the length method, enter
  zero for an unused charge; blank fields do not mean zero. A price for one
  configuration cannot price different spans, end guns or corner equipment.
  These temporary inputs do not include annual ownership or operating costs.
  Well, pump and power supply costs are separate unless explicitly included.
- **Boundary distances:** the switch shows or hides result rows. Minus/plus
  controls change the project's required-clearance setting, so this can make the
  project unsaved. Distances are sampled model results, not continuous safety
  certification.
- **Corner inputs:** last regular drive tower ground speed at 100% timer in
  feet per minute, model, rotation, orientation and the exact
  guidance line must be explicitly supplied. Missing inputs disable corner-path
  calculation. The catalog and selected guidance line retain their qualification
  warnings; selecting them does not verify real equipment capability.

## Save Boundaries

Temporary preview choices and cost/corner inputs survive closing and reopening
Calculate in the current project session. Relevant project changes invalidate
stale results. Reloading a project resets temporary cost and corner inputs,
including reloading the same project. A changed machine requires its price to
be entered again; changing only the pivot location does not change that scope.
These choices are not a substitute for independently persisted machine records.

US-unit input conversion happens at the calculation boundary. Dollars per foot
are converted to dollars per meter, while feet per minute are converted to meters
per minute. Saved projected/local XY and the calculation units are unchanged.

Applying a proposed pivot center requires confirmation. Save Review Zones saves
advisory map features only, not new center-pivot machines. Export Report creates
a review artifact, not a qualified field design. The existing project save state
does not claim RTK lock or surveyed 3D accuracy.

## Verification Scope

See [the Will Rhea improvement record](will-rhea-improvement-loop.md) for the
current visible Windows Edge checks and human questionnaire. Narrow browser
captures are not native phone/device proof. Hardware control, electrical
level-shifting and strictly sub-0.10 m surveyed 3D accuracy remain separate gates.
