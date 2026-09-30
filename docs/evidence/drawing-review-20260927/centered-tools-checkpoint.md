# Centered Tools And Review Replacement

2026-09-27. Complexity band: high; selected reasoning effort: high.
Subagent decision: required. Main owned UI, Windows operations and documentation;
bounded read-only review identified layout and lifecycle gaps, and a separate
worker owned only legacy review-server shutdown and its tests. Existing dirty
work was preserved. No commit, push or hardware operation was performed.

## Input And Changes

The completed V01-V04 receipt at revision 25 remains authoritative. This pass
implements centered colored bottom tools, one horizontal geometry-tool row,
grouped colored capture actions and red/amber/green workspace feedback.
Icons and text remain present; color alone is not the status signal.

Independent review found camera/control intersections on short maps and focused
tooltips covering purpose menus. Camera controls now occupy the upper-right
horizontal rail. Bottom details scroll within measured available height;
tooltips are suppressed while the purpose menu is open. Compact inputs can
shrink without crossing the status footer. Drawing/camera tests still verify
unchanged saved geometry after zoom and fit.

## Browser Evidence

Local packet root: `reports/visual-layout-review/20260927-centered-tools-01/`.
Successful mapping run: `edge-retry-06/`. Visible Windows Edge 154.0.4258.37,
desktop 1366 x 900, narrow 390 x 844 and 320 x 720; all six focused checks pass.
The checks cover polygon/line/point capture, save gating, saved geometry,
centered single-row tools, tooltip bounds, menu/camera separation and invalid
input handling. Screenshots and DOM measurements were retained at four workflow
transitions. Agent pixel inspection and local OCR accompanied DOM assertions;
OCR misread some icon-adjacent text and is not wording authority.

`packet/original/` retains unchanged captures; `packet/annotated/` contains
numbered callouts and legends. Capture identity:
`capture-sha256:30ed0dc3c237b75dd03f34ebc5a4f582cd448e9cc0ae36f142c4e0b33190f693`.
The fresh human session is `reports/visual-layout-review/interactive-centered-tools-session/`,
served at `http://127.0.0.1:43071`. W01-W04 start blank, with choices and essays.
App development session: `http://127.0.0.1:8085`; original user map remains on
its original tab. Human responses and acceptance remain pending.

## Cleanup And Process

- Completed V01-V04 answers were archived and byte-compared. Because that old
  session predates evidence identities, no historical fingerprint was invented.
- Exact hub title/URL and live completed answers were matched to the retained
  receipt. UIA controls were archived before closing the hub; inventory retained
  only the original map. Legacy server shutdown subsequently verified process
  exit, listener release and lock removal. Browser and server proof are separate.
- The new questionnaire was tested in a separate synthetic visible Edge session:
  all four figures rendered; disk acknowledgement, reload, offline retry,
  conflicting edits, rescue download, Markdown and actual child-tab closure
  passed. Hub and unrelated test tab survived. The QA browser and server were
  closed; its standalone export verifies with the server stopped.
- Failed attempts remain retained: broad test collection loaded an unrelated
  Windows-incompatible esbuild binary; a title filter was insufficient. Scope
  both file and title. Metro served stale bundles despite fresh source maps;
  freeze edits, verify HTTP readiness and changed rendered styles before capture.
  The verified owned 8085 process group required targeted recovery because the
  launcher could not match its npm wrapper; other listeners were not signalled.
- Skill guidance, review instructions and generated context-map hashes were
  refreshed from these observations. Hooks remain advisory, not runtime proof.

## Validation And Limits

- `npm run validate`: passed, including 346 native-workspace source tests.
- Latest post-layout `npm run typecheck`: passed.
- `npm run test:visual-review`: 96 checks passed after integration.
- `npm run validate:skills`, context-map freshness, `git diff --check`: passed.
- `npm audit`: zero vulnerabilities.
- Full `proof:web` was not run by this pass; only the six scoped visible Edge
  mapping checks and separate questionnaire proof establish browser evidence.

This is the incomplete-design SVG surface, not complete Design/Layout or
MapLibre parity. Post-drawing classification, autosave, boundary-first closure
and durable pause/resume are still not wired into this screen. The 320-pixel
Inputs view is non-overlapping but cramped and needs a dedicated compact-panel
follow-up. Map labels remain visually faint in saved geometry and need review.
No native device, physical receiver/relay or strictly sub-10-cm 3D proof is
established. Resume classification and atomic commit before the full drawing UI.
