# CPLayout Visual Review Questionnaire

Template only: no figures captured and no answers supplied. Before presenting a
review packet, replace this status and all bracketed fields with actual evidence.
Remove questions for uncaptured states; never invent a screenshot or answer.
Replace every uppercase image path below with a real relative PNG path, verify
it renders inline, and complete the figure-specific callout descriptions before
presenting the questionnaire. A table of image links alone is not sufficient.

Packet: [date / workflow / iteration]
Scope: [single task, e.g. Polygon field-boundary capture]
Live Windows Edge URL: [verified repo-launcher URL]
Build/source snapshot: [HEAD plus dirty-source and served-export hashes]
Edge / Windows / viewport / zoom / scaling: [observed values]
Input / renderer / fixture: [observed values]
Human review status: pending

## Figures

| Figure | Workflow checkpoint | Original | Annotated | Callouts |
| --- | --- | --- | --- | --- |
| Fig. 1 | [Before drawing: on-map toolbar] | [actual link] | [actual link] | [1A, 1B] |
| Fig. 2 | [Tool selected: submenu open] | [actual link] | [actual link] | [2A, 2B] |
| Fig. 3 | [Partial drawing or correction] | [actual link] | [actual link] | [3A, 3B] |
| Fig. 4 | [Result, rejection or saved/reopened state] | [actual link] | [actual link] | [4A, 4B] |

## Fig. 1: Drawing Toolbar

![Fig. 1: annotated drawing toolbar with observation callouts](ANNOTATED_FIG_01_PATH)

[Unmodified Fig. 1](ORIGINAL_FIG_01_PATH)

- 1A: [Exact control/region; observed size or legibility issue; DOM/CV evidence or uncertainty; relates to Question 1.]
- 1B: [Exact overlapping/obscured region or confirmed clear spacing; why it matters; relates to Question 5.]

## Fig. 2: Tool Menu

![Fig. 2: annotated tool menu with observation callouts](ANNOTATED_FIG_02_PATH)

[Unmodified Fig. 2](ORIGINAL_FIG_02_PATH)

- 2A: [Specific label/icon; agent observation and corroborating evidence; relates to Question 2.]
- 2B: [Specific active/disabled/menu state; observation and uncertainty; relates to Question 2.]

## Fig. 3: Drawing Or Correction

![Fig. 3: annotated drawing state with observation callouts](ANNOTATED_FIG_03_PATH)

[Unmodified Fig. 3](ORIGINAL_FIG_03_PATH)

- 3A: [Selected geometry/vertex or unfinished segment; observation; relates to Question 3.]
- 3B: [Finish/undo/cancel control or status; observation; relates to Questions 3 and 6.]

## Fig. 4: Outcome

![Fig. 4: annotated outcome with observation callouts](ANNOTATED_FIG_04_PATH)

[Unmodified Fig. 4](ORIGINAL_FIG_04_PATH)

- 4A: [Actual result, rejection or save indication; observation and state evidence; relates to Question 4.]
- 4B: [Specific recovery or next-action control; observation; relates to Questions 6 and 7.]

For each figure, replace example callouts with actual observations. The marks
must point to the identified elements without covering them. Include a labeled
detail crop when the full figure cannot show the issue legibly, preserving the
full screenshot and recording the crop rectangle. Remove unused callouts.

## Your Review

Select one letter for each multiple-choice question. Add any explanation in the
answer field. Example: `1. c; Explanation: ...`. Questions 6 and 7 accept essay
answers. Questions must refer to what the actual linked figure shows.

1. In Fig. 1, the drawing-tool icons are:

   a.) Too big
   b.) Too small
   c.) Ideally sized
   d.) None of the above (explain)

   Answer:
   Explanation:

2. In Fig. 2, the tool names and submenu choices are:

   a.) Clear without explanation
   b.) Mostly clear, with one confusing choice
   c.) Difficult to understand
   d.) None of the above (explain)

   Answer:
   Confusing label or preferred wording:

3. In Fig. 3, the selected tool, current geometry and next action are:

   a.) All clear
   b.) Tool is clear, geometry or next action is unclear
   c.) Geometry is clear, tool or next action is unclear
   d.) None of the above (explain)

   Answer:
   Explanation:

4. In Fig. 4, the result appears to be:

   a.) Still being drawn
   b.) Applied to the design but not yet saved
   c.) Saved and available after reopening
   d.) Unclear or none of the above (explain)

   Answer:
   Which visible cue led to your answer?

5. Across Figs. 1-4, the controls leave:

   a.) Enough usable map space
   b.) Too little map space
   c.) Enough space, but controls cover important geometry or status
   d.) None of the above (explain)

   Answer:
   Affected figure/callout:

6. Describe how you would perform this task in the field. Where does the shown
   workflow differ from what you expect? Reference figure/callout numbers.

   Answer:

7. What is the single most important change for the next iteration, and why?
   Include any problems with gloves, sunlight, mouse/touch, or screen size.

   Answer:

8. For this specific workflow and iteration, your decision is:

   a.) Accept as shown
   b.) Accept after the changes listed below
   c.) Rework and present another review packet
   d.) Not ready to decide or another response (explain)

   Answer:
   Required changes:

## Agent Findings And Follow-up

Keep this separate from human answers. Do not fill answers on the user's behalf.

| Figure/callout | Observed issue and DOM/OCR/CV evidence | Severity/uncertainty | Proposed change | Human response reference | Decision and retest |
| --- | --- | --- | --- | --- | --- |
| [ID] | [observed, not inferred approval] | [value] | [proposal] | [question number] | [pending] |

Next packet: [workflow / unchanged checkpoints / new source snapshot]
Owned Edge/server cleanup or intentional live-review retention: [observed status]
