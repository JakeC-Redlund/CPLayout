# Irrigation Report Language And Units

Status: primary input-form implementation completed and accepted within U01-U05
scope at revision 9; lower generated report labels remain unfinished. See
[current status](development-status.md) and the retained
`.cplayout-local/publication-checkpoint-20260927/reports/us-irrigation-report-20260927/human-completed-r9/` receipt. Findings below
describe the pre-implementation F01-F03 checkpoint, not current behavior.
Source review: 2026-09-27. F01-F03 of the calculation-form review all selected
rework. The completed, verbatim revision-19 receipt is retained under
`.cplayout-local/publication-checkpoint-20260927/reports/report-form-20260927/human-completed-r19/`.

## Received Direction

Use plain language familiar to center-pivot irrigation users, with researched
descriptions of the actual concepts. Use feet, acres and miles on the requested
US-unit interface. Retain canonical projected/local XY and calculation units;
changing a label without converting its value is not an acceptable implementation.

## Verified Sources

- [Valley Precision Corner](https://www.valleyirrigation.com/precision-corner)
  uses corner-system, irrigated-acres, span, guidance and wheel-track terminology.
  It is manufacturer context, not proof that CPLayout implements the product's
  proprietary steering or sprinkler sequencing. The bare-domain fetch failed;
  the www page was successfully opened and reviewed.
- [Nebraska Extension: Center Pivot End Gun Considerations](https://cropwatch.unl.edu/2020/center-pivot-end-gun-considerations/)
  distinguishes pivot lateral, end gun, part-circle operation, throw radius,
  application uniformity and required operating pressure. Its 2020 guidance
  supports terminology, not current equipment prices or CPLayout field accuracy.
- [Alabama Extension: Investment Costs, Three Scenarios](https://www.aces.edu/blog/topics/crop-production/investment-costs-of-center-pivot-irrigation-in-alabama-three-scenarios/)
  separates pivot investment from pumps, supply pipe, electrical supply, wells,
  annual ownership costs and operating costs. Its 2019 examples are not current
  price defaults. Installation is explicitly included in the example pivot price,
  illustrating why quote scope must be recorded before adding separate costs.
- [Nebraska Extension: Agriculture Irrigation Costs App](https://extensionpubs.unl.edu/publication/a10002/agriculture-irrigation-costs-app)
  distinguishes ownership and operating costs, including annual per-acre and
  per-acre-inch measures. A geometric equipment-price estimate must not silently
  acquire these broader meanings.

## Findings Before Implementation

`advisoryPivotPlacement.ts` currently calculates an estimate as fixed amount plus
main-pivot length times price per meter plus span count times price per tower.
`machineRadiusMeters` uses spans plus overhang; it does not include end-gun throw
or corner extension. This is a simple user-supplied equipment-cost formula, not
an industry-standard whole-system budget. The current form does not make this
scope clear. Entering an already complete pivot price together with extra rates
could double count costs. These are source findings, not evidence that a user
actually made that mistake.

The current corner form also hardcodes m/min and metric model dimensions even
when surrounding results use acres and feet. Cost rate conversion is inverse
to distance conversion: dollars per foot must become dollars per meter by
multiplying by feet per meter. Ground speed converts feet/min to meters/min by
dividing by that same factor. Raw partially typed input must keep an explicit
unit basis; preference changes cannot silently reinterpret it.

## Implementation Scope

1. Replace software-oriented report terms with plain irrigation descriptions.
   Proposed labels include "Mapped pivot layouts (estimates)", "Estimated
   irrigated area", "Overlapping irrigated area", "Additional corner-system
   irrigated area", "Proposed pivot locations" and "Field area not covered".
   These are product wording proposals, not quoted manufacturer terminology.
   Keep modeled/surveyed distinctions and count overlap only once in net totals.
2. Make the requested US-unit form use feet, acres, miles where appropriate and
   ft/min for ground speed. Use tested pure conversion helpers at the input/output
   boundary, preserve raw editing text and original canonical geometry, and test
   changing preferences without unit reinterpretation. Do not rescale saved XY.
3. Replace ambiguous cost entry with an explicit pricing basis: a supplied pivot
   price versus an optional length/tower estimate, not both implicitly added.
   Record what the price includes. Do not propagate a quote for one machine to
   a different-size alternative without an explicit estimation model. Keep
   pumps, wells, electricity and annual operating costs separate and unavailable
   unless actually supplied and supported by an implemented model.
4. Remove programmer-facing storage/geometry language from the primary report.
   Retain essential field-safety and estimate limitations in plain language, with
   technical details in documentation. Do not describe a model as qualified simply
   because its inputs are filled in.
5. Add focused conversion, incomplete input, zero/missing, quote-scope and
   alternative-ranking tests before UI wiring. Rerun aggregate validation and
   visible Edge workflows, capture new figures with new question IDs, then present
   the replacement review. Never repurpose F01-F03 or carry forward acceptance.

Likely ownership: pure cost/input helpers under `apps/mobile/src/advisory/`,
corner input helper/component, `FieldPivotPreviewControls.tsx`, the calculation
components in `App.tsx`, and only the geometry cost interfaces required by the
chosen explicit basis. Source and geometry reviewers should independently verify
unit direction, price scope and unchanged canonical data. Native hardware proof,
surveyed 3D accuracy and saved multi-machine activation remain separate open work.
