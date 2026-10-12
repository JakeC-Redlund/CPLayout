# Customer, project and field workflow

Sign in to CPLayout with your assigned account, choose a customer, then choose its project and field. Customers form the top-level folders, including customers that do not yet have projects. Project and field names remain under their actual customer; matching names in different customers do not mean the same work. Use the customer actions to add a customer or update its details. Selecting a folder browses its contents; use the explicit Open action to begin work. Save or preserve unfinished work before changing its context.

Each field organizes its machine designs, map designs and field Surveys. An official precision Layout map belongs to the Survey used to create it. These folders organize saved work; they do not move files on your device or make new copies of a design. Machine and map designs may contain planned information. Their presence alone does not mean that a field was surveyed or that a layout is ready for marking.

## Design

A new project starts in Design. Enter the field information you already know, then use the map's drawing tools to outline a field boundary and add relevant lines or points. Design is manual and needs no GPS connection. Save unfinished work and return to it later; a saved draft does not imply a completed field plan. Use supported machine choices for pivot, corner or linear equipment where their actual editor is available.

Design is optional. You may continue to Survey directly when you intend to collect the field information on site. A manually drawn map alone cannot qualify a project for Layout.

## Survey

Open the intended customer/project/field in Survey and connect your receiver through a supported connection. Inspect its connection and position status. Live collection requires a fresh RTK Fixed position and the correct coordinate reference. A receiver status label does not independently establish measured accuracy.

Collect and save the required field information. A field Survey identifies its saved review and the included collections of observations. Survey completion must match the current saved field and source revision before an official Layout map can use it. Preserve collected observations when editing the design; changed relevant source information requires Survey qualification to be checked again. Connection failures, stale positions and mismatched field references must block collection with an actionable explanation.

You can prepare the saved draft directly as a field in Survey, without completing a planning Project or running a Design calculation. Set the actual coordinate system and save a boundary with at least three positions. Enter supplied machine values under Known field and machine information; measured coordinates remain attached to their collected observations. Unknown water and power locations may stay blank. If no machine information is supplied, prepare the field first and add equipment later using its actual recorded pivot or saved linear path. Partially supplied machine information must pass its displayed checks; it remains in the original work if preparation is refused.

Preparation preserves the original draft and Survey lineage. Review the fresh prepared field and its saved Survey before using Layout; preparation does not inherit completion or create a qualified target. For linear equipment, choose the actual saved two-point path and enter the supplied configuration. Its endpoints and original collection/path identities stay distinct from subsequent marking observations.

## Layout

Open the intended field Survey and its matching Layout work. Start a current RTK Layout with a fresh RTK Fixed lock from the connected, owned receiver and the correct saved coordinates. Recording a live mark and finalizing its official map each require their own fresh lock; a previously saved Fixed observation cannot replace the current receiver check. Stored maps can be viewed or exported offline within your access permissions.

Use the frozen saved machine targets to locate and mark their positions with precision GPS. Corner and linear marking applies only where the saved machine target and connection are supported. The live position and marking observations are separate from the target: collecting a mark does not move the saved machine design. Change the design through Design and requalify its Survey before replacing a Layout target. Planned or manually drawn geometry remains identified as planned or manually drawn, even when you later connect an RTK Fixed receiver.

Mark every frozen target with its entered positive distance tolerance before finalizing. The latest recorded station for each target must be within that tolerance. The official map identifies those actual measured stations and their retained observations; the planned targets remain unchanged. Finalized and imported reference maps are saved history, rather than sessions for adding new marks. Copying a Layout creates a reference plan without recorded marks or inherited official status.

Keep the original official map available through its saved field for viewing or export. A dedicated saved-map import can retain it as reference history only in its original field; it keeps the exact original target, Survey links and observations and does not inherit official finalization. Import into a different field is refused. A complete saved-workspace restore containing this map is also refused because it cannot establish the original workspace and account ownership. Keep the original file and use the existing saved map or its supported reference import.

Older retained Layout maps may have no current matching Survey qualification. They remain historical maps for viewing or export and must not be presented as qualified official maps. A retained record whose customer, project or field is unavailable must say so; do not place it under a guessed parent.

For retained Survey history whose original parent is unavailable, use View retained field survey to inspect its saved information and Export original field survey to save its original source package. These actions preserve the original information and do not create replacement folders.

## Save, recover and return

Save records applied work. A separate recovery checkpoint preserves unfinished local inputs; Restore does not silently save a project or reconnect a receiver. When a conflict or storage failure appears, retain the current work and reconcile the saved source before retrying. Reopening, copying, importing and exporting must retain the intended customer, field and design identity.

On a configured host, authenticated online manual Save can use the service directly. Automatic unfinished-edit recovery, offline field changes and live GPS collection need that host's separately supported atomic storage capability. Follow the displayed capability message and save or discard unfinished entries before leaving when automatic recovery is unavailable. Native device qualification remains separate from this source-level distinction.

The current native SQLite workspace adapter supports its older workspace format and refuses the newer Survey/RTK Layout workflow versions. Use a qualified host for those operations; a stored map or successful online manual Save does not establish native live-capture or Layout support.

## Current capability qualification

This guide describes the customer-first hierarchy, manual Design, saved Survey, RTK Layout and preservation contract. [Current status](development-status.md) records the exact integrated edition, implementation checks, browser results and remaining acceptance. Earlier browser proof does not establish availability in a later edition.

Account sign-in requires the configured service; a local profile is not an authenticated account. Device connections and measured field accuracy have separate qualification requirements. The previous published checkpoint's selected browser results do not complete those gates. Check [current status](development-status.md) for the integrated edition and remaining acceptance.

The person operating the service should follow the [service setup and operation guide](service-operation-guide.md). A source implementation or successful local test does not mean a deployed service is available.
