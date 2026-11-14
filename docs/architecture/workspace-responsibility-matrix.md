# Workspace Responsibility Matrix

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Each feature has exactly one place in the UI.
Workspaces share services, not interfaces.

- **Images**
    - Responsibility: Documents, image work, and the camera operations of camera tabs
    - Features: Image Tools: Image Inspector, Plate Solving, Star Detection, Star Profile Inspector, Streak Detection, Annotation, Image Processing.
      Camera Operations: Camera Acquisition (labeled Acquisition), Live Stacking, Auto Focus, Mount Nudge, Guiding, DARV, TPPA, iPolar, Pointing Model Builder, Target Centering, Flat Wizard, Dark Library Wizard
    - Registry: `IMAGE_TOOL_DEFINITIONS` (`web/src/images/tools.ts`)
- **Sky**
    - Responsibility: Exploration, planning, contextual mount control
    - Features: Planetarium, search, time bar (toggled from the toolbar, view state of the tab), mount center and follow;
      panel views Object Inspector (with slew; the Sun, the Moon, artificial satellites, and the mount marker have their own views: the Sun, Moon, Satellite, and Mount Inspectors), Observer, Display (layers), Framing (FOV)
    - Registry: `SkyPanelView` (`web/src/sky/sky.ts`), panels in `SkyWorkspace.tsx`
- **Tools**
    - Responsibility: Standalone utilities, no camera or document needed
    - Features: Calculator, Astronomical Time Converter, Solar Eclipse Map, Lunar Eclipse Map, Close Approaches, Orbital Mechanics Explorer, Astro Weather, Meridian Flip, Observing Planner, Jupiter Observing Planner, Saturn Observing Planner, Planetary Events, Meteor Showers, Artificial Satellites, Calibration Library, Image Stacking, Mount Remote Control, Mount Pointing Model, Observatory Cameras, SPICE Kernel Library;
      Alpaca Server planned
    - Registry: `TOOL_DEFINITIONS` (`web/src/tools/tools.ts`), `/tools/<id>`
- **Sequencer**
    - Responsibility: Configuring and observing server-run automation
    - Features: Planned
    - Registry: a future entry in `WORKSPACE_IDS`
- **Equipment Control (Management page)**
    - Responsibility: Manual control of every device of the profile's connection
    - Features: Camera (identity and cooling), mount, guide output, focuser, filter wheel, rotator, cover, flat panel, dew heater, dome; INDI properties of every device the INDI server reports, managed or not, and the messages its drivers sent
    - Registry: `CONTROLS` (`web/src/equipment-control/DeviceDetail.tsx`), `/equipment[/<device id>[/indi|/messages]]`
- **Settings (top bar gear button)**
    - Responsibility: Settings of the server instance and of the active profile
    - Features: Sections chosen by a header selector: External Tools (server), Observing Sites (server), Equipment Catalog (server), Date & Time (profile), Status Bar (profile)
    - Registry: `SETTINGS_SECTION_IDS`, `/settings/<section>`, `/settings/external-tools[/<tool id>]` (`web/src/settings/`)
- **About (rail footer button)**
    - Responsibility: Identity of the running distribution
    - Features: Logo, version, build commits and time, server runtime and platform, Copy Version Info;
      author, license, repositories, and the credits of the external services, data, published models and methods, and programs in use (`CREDIT_GROUPS` of `web/src/about/about.ts`), shown even when the server cannot be reached
    - Registry: `/about` (`web/src/about/`)

Connections, Equipment Setup, and profiles are modals of the shell (`ConnectionModal`, `EquipmentModal`, `ProfileModal`), not routes.
The URL path is the source of truth for navigation (`web/src/shell/route.ts`): `/images`, `/sky`, `/tools[/<tool>]` (`/tools/solar-eclipse-map/<eclipse id>` and `/tools/lunar-eclipse-map/<eclipse id>` for one eclipse, `/tools/calibration-library/<group id>` for one group, `/tools/image-stacking/<project id>` for one project, `/tools/artificial-satellites/<NORAD id>` for one satellite; an unknown tool opens the catalog), `/equipment[/<device>[/indi|/messages]]`, `/settings/<section>` (`/settings/external-tools[/<tool>]`, `/settings/observing-sites[/<site>]`, `/settings/date-time`; an unknown section opens the first), `/about`;
any other path opens Images, and the URL is rewritten to the canonical path of the route (`watchHistory`).

An image tool declares its `outputs` (`ImageOperationOutput`): `display` (a new rendering of the document), `derived` (a new temporary document), or `analysis` (data and overlays that leave the pixels untouched);
the first is its default, and it names the panel's main action (Apply to View, Run Pipeline, Run Analysis).
Camera operations have no outputs: their frames reach the tab as the camera's latest frame.

Rules:

- A registry entry without an implementation is **planned**: listed with its reason, never selectable or openable.
  Placeholder panels are not created.
- Selecting a mode, tool, tab, or profile never starts, stops, or redirects an operation.
- There is no Capture workspace: acquisition and the assisted operations of equipment are camera operations of the Images camera tabs; `/capture` is an unknown path.
- The bottom area of a camera tab (`CameraBottom` of `web/src/images/ImagesWorkspace.tsx`) shows the capture frames carousel and, once its camera has the session, a switch to the Focus Curve of Auto Focus (`FocusCurve`), the Guiding Graph, or the Pointing Map of a mount pointing session (`PointingMapView`): a choice per tab, in memory, that never changes the frame selected.
  Each view belongs to its session and keeps updating whatever frame or tool is shown; one whose session is gone shows the carousel.
- Auto Focus is a camera operation of a camera tab too (`web/src/images/AutoFocusTool.tsx`, over `AutoFocusSections`).
  It focuses the tab's camera with the focuser its context associates (`NO_FOCUSER` explains the Main Camera rule and offers Equipment Setup otherwise; `autoFocusBlocker` judges a start), with the exposure time of its own form (`ExposureTimeInput`, shared with Camera Acquisition and the other camera operations that take one) and the camera settings of Camera Acquisition, shown under the exposure time in the Acquisition section (`CameraAcquisitionSection`), those of the session while it runs.
  The form's "Return to the start position when stopped" (on by default) sets `restoreOnStop`, and the session state shows the progress of the frame being exposed (`FrameProgress`).
  Its frames are shown by the tab's Latest, with the markers of the tab's own star overlay; no viewer of its own.
- Mount Nudge is a camera operation of a camera tab too (`web/src/images/MountNudgeTool.tsx`, over `MountNudgeSections`): it moves the mount the tab's context associates (the setup's `MOUNT`), named with the camera in its Equipment section, and offers Equipment Setup when none is assigned.
  Directions are the mount's axes, never the image's.
  A press is released on pointer up, cancel, or lost capture, window blur, a hidden page, a change of the mount followed (a profile switch, `watchNudgeMount`), and the panel's unmount;
  the contextual panel is keyed by the tab, so switching tool or camera tab unmounts it.
  The toolbar of a camera tab toggles the central reticle over its frames (`viewer/Reticle`), a presentation choice per tab kept in memory; nudging needs no new exposure.
  Equipment Control opens it for the setup's mount on the Main Camera's tab, or the first camera tab of the connection (`connectionCameraTab`), and is disabled when the connection has no camera tab.
- TPPA is a camera operation of a camera tab too (`web/src/images/TppaTool.tsx`, over `TppaSections` of `web/src/camera/TppaPanel.tsx`, store `web/src/camera/tppa.ts`).
  It aligns with the tab's camera and the setup's `MOUNT`;
  a mount the TPPA can never use (alt-az, no west-east motion or abort, no slew-rate preset: `tppaMountSupport`) is `unsupported` and offers Equipment Setup, and `tppaBlocker` judges a start (mount state known, a preset the mount announces, a site, unparked, tracking or able to switch tracking, the plate solver configured).
  The form (direction, slew rate, rotation, settle and refinement delays, plate solver, and the "Stop the tracking when the session ends" checkbox, on by default, `stopTracking`) is the camera's and shows the values applied while a session runs, its exposure time included;
  the camera settings are the camera's shared block, shown as for Auto Focus.
  The session state shows the progress of the frame being exposed (`FrameProgress`; a refinement frame once the driver reports it) and whether the tracking the session started was stopped or left on.
  Its frames are shown by the tab's Latest with the correction guide (`web/src/camera/TppaOverlay.tsx`) over the frame the latest estimate was solved on; the Image Inspector names the step of a TPPA frame (pose, rejected candidate, refinement).
- iPolar is a camera operation of a camera tab too (`web/src/images/IPolarTool.tsx`, over `IPolarSections` of `web/src/camera/IPolarPanel.tsx`, store `web/src/camera/ipolar.ts`).
  It aligns with the tab's camera; the setup's `MOUNT` is used when ready and needed only for the automatic rotation, where a mount it can never turn (`ipolarMountSupport`) is `unsupported` and offers Equipment Setup.
  `ipolarBlocker` judges a start: a manual one needs the camera, the active observing site, and the plate solver, and is blocked by the mount only while another operation holds it; an automatic one also needs the mount ready, a preset it announces, and unparked, and a notice beside Start asks the operator to check the mount is clear to turn.
  The form (mode, direction, slew rate, rotation, settle and refinement delays, target error, refraction, and the Dark section: a master dark of the Calibration Library to pin and what a frame it does not fit does) is the camera's and shows the values applied while a session runs; the site is shown read-only from the profile.
  The Dark section lists the masters of the library (`loadLiveMasters`), marks those of another exposure, never picks one, and while a session runs shows how the dark went for its latest frame.
  The controls follow the session: Rotation Done while it waits for a manual rotation, Start, Resume, or Pause Refinement, Finish once calibrated, and Stop; the polar error shows the signed on-sky components, marks a measurement a later frame left stale, and shows the convergence streak.
  Its frames are shown by the tab's Latest with the axis and pole markers (`web/src/camera/IPolarOverlay.tsx`) over the frame the latest measurement belongs to, dimmed when stale; the Image Inspector names the step of an iPolar frame (reference pose, second pose, rejected candidate, refinement).
- DARV is a camera operation of a camera tab too (`web/src/images/DarvTool.tsx`, over `DarvSections` of `web/src/camera/DarvPanel.tsx`, store `web/src/camera/darv.ts`).
  It measures with the tab's camera and the setup's `MOUNT`;
  a mount DARV can never use (alt-az, no west-east motion or abort, no slew-rate preset: `darvMountSupport`) is `unsupported` and offers Equipment Setup, and `darvBlocker` judges a start (mount state known, a preset the mount announces, unparked, tracking or able to switch tracking; no site or plate solver is needed).
  The form (axis, direction of the first motion, slew rate, leg duration) is the camera's and shows the values applied while a measurement runs;
  the exposure is derived from the leg duration (`darvExposureTime`) and only shown, and the camera settings come from the shared block, whose exposure time is never sent nor changed.
  While a measurement runs the panel shows its step among the phases and a bar of the exposure elapsed, from the `exposureStartedAt` the server records (`darvProgress`); the analysis, of unknown length, pulses.
  The panel repeats the measurement in the open session while its mount is the setup's, compares the drift only with the previous measurement of equal settings, and finishes the session.
  Its frames are shown by the tab's Latest with the paired trails (`web/src/camera/DarvOverlay.tsx`) over the frame they were found on; the Image Inspector names the measurement and its result.
- Flat Wizard is a camera operation of a camera tab too (`web/src/images/FlatWizardTool.tsx`, over `FlatWizardSections` of `web/src/camera/FlatWizardPanel.tsx`, store `web/src/camera/flatwizard.ts`).
  It acquires with the tab's camera and, when the camera is the Main Camera of the setup, the setup's `FILTER_WHEEL`, `FLAT_PANEL`, and `COVER` (`CameraOperationContext.wheel`, `flatPanel`, and `cover`);
  an unassigned wheel or panel makes that step manual and an unassigned cover is left as it is, while an assigned one that cannot be used blocks the start (`flatWizardBlocker`) instead of falling back to a manual step, and any other camera uses neither.
  The form (filter groups with filter slot, frame count, exposure bounds, DN target, and panel brightness; directory, effective clipping level, proposed at `DEFAULT_FLAT_WIZARD_EFFECTIVE_CLIP` because a sensor can top out under the 65535 DN of the file, settle time, trial and rejection limits) is the camera's and shows the values applied while a session runs;
  the camera settings come from the shared block, whose exposure time is never sent nor changed (`flatWizardRequest`).
  The panel shows the phase, the progress of the frame being exposed (`FrameProgress` of `web/src/camera/FrameProgress.tsx`, shared by the camera operations that expose frames), the filter in progress, the exposure being tried or chosen, the levels in DN of the latest frame, and, while the session waits for the operator, the instruction and the Continue button that confirms that step's id;
  nothing else confirms a step.
  Stop cancels the session.
  Results list each group's saved and discarded frames, exposure, stability, failure, and a light left on.
  Its frames are shown by the tab's Latest, and the Image Inspector names the origin Flat Wizard.
- Guiding is a camera operation of a camera tab too (`web/src/images/GuidingTool.tsx`, over `GuidingSections` of `web/src/camera/GuidingPanel.tsx`, store `web/src/camera/guiding.ts`).
  It guides with the tab's camera and the setup's `GUIDE_OUTPUT`, which only the `GUIDE_CAMERA` has (`CameraOperationContext.guideOutput`; any other camera is told so and offered Equipment Setup), snooping the setup's devices like a capture and detecting the stars with the detector of the profile's Star Detection and its settings, as Auto Focus does (not its acceptance criteria: the tracker filters the stars, from 5 sigma by default);
  a detector set to ASTAP while ASTAP is not configured blocks the start (`guidingBlocker`).
  A busy guide output does not block looping.
  The panel edits the camera's guiding form, shows the camera settings of Camera Acquisition its guide frames take under the guide exposure in the Acquisition section (`CameraAcquisitionSection`, the profile's, since a session keeps no copy to show), shows the progress of the guide exposure as the other camera operations do (`FrameProgress`), the Star Profile of the guide star (`web/src/camera/GuidingStarProfile.tsx`), the session (state, lock, calibration rates and angles, RMS in pixels and arcseconds when the guide focal length is known, the outcome of the latest command, the failure), and offers the commands of the current state.
  The guide focal length is the effective focal length (focal length times reducer or Barlow) of the profile's Guide Telescope in Equipment Setup (`ProfileSettings.guideTelescope`, `guideFocalLength`), sent as the session optics when set;
  the panel shows it, or offers Equipment Setup while it is not set.
  Calculate sets the calibration step from the guide focal length, the camera's pixel size and binning, the output's RA guide rate, and the mount's declination, for 25 px of travel in 12 RA steps as the PHD2 calculator (`guidingCalibrationPulse`);
  while it cannot, the panel names each missing input and where it comes from, or says the RA motion vanishes (`guidingCalibrationBlocker`).
  The Session section shows the step and a bar per leg of a running calibration (`web/src/camera/GuidingCalibrationProgress.tsx`).
  The viewer draws the guider overlay (`GuidingOverlay` of `web/src/camera/GuidingOverlay.tsx`: accepted and rejected stars, search square, lock cross, measurement) only over the session's newest previewed frame, and while the Guiding tool is selected and the guide output is not held, a click on that frame selects the star nearest it (`/target`, in 0-based pixel centres).
  The Guiding Graph of the tab's bottom area (`web/src/camera/GuidingGraphs.tsx`) draws the history or the target of the guide errors (see [Guiding Contract](guiding.md)).
- Dark Library Wizard is a camera operation of a camera tab too (`web/src/images/DarkLibraryWizardTool.tsx`, over `DarkLibraryWizardSections` of `web/src/camera/DarkLibraryWizardPanel.tsx`, store `web/src/camera/darklibrarywizard.ts`).
  It uses the tab's camera and, when the camera is the Main Camera of the setup, the setup's `FILTER_WHEEL`, `FLAT_PANEL`, and `COVER`;
  an option whose device is not assigned cannot be selected, a selected device that cannot be used blocks the start (`darkLibraryWizardBlocker`) instead of falling back to a manual step, and a device nothing selected never blocks it.
  Its sections are Equipment, Capture Plan, Light Protection, Thermal Control, Output & Quality, Session, and Controls.
  The Capture Plan starts with its Frame Type, Dark or Dark-Flat (the `purpose` of the plan), which Prepare Matching Dark Flats of the Flat Wizard sets too.
  The rows of the plan are the form: a group is added, moved, removed, or duplicated right below itself (`duplicateDarkGroup`), and a copy blocks the start until one of its settings changes, since a repeated group is refused.
  Each exposure is typed in the unit of `ExposureTimeInput`, and the estimates of frames, exposure, and disk space are labelled as estimates.
  Gain, offset, binning, subframe, and readout mode come from Camera Acquisition (`darkLibraryWizardCapture`, fitted as a capture is), and only the exposure, target temperature, and frame count are the group's;
  nothing in Camera Acquisition is changed.
  The disk space follows those fitted settings (`darkLibraryWizardEstimate`).
  Start asks for no confirmation: above it, a warning (`darkLibraryWizardWarning`) names what no device verifies, and starting is the operator's assertion of it (see [Dark Library Wizard Contract](dark-library-wizard.md)).
  Every start makes a new plan; plans are never listed, completed, or reused in the tab.
- Live Stacking is a camera operation of a camera tab too (`web/src/images/LiveStackingTool.tsx`, over `LiveStackingSections` of `web/src/camera/LiveStackingPanel.tsx`, store `web/src/camera/livestacking.ts`).
  It never takes a frame: it integrates the frames Camera Acquisition takes with the tab's camera, whichever tab or output mode, so it needs no equipment and holds no device, and its panel only links to Acquisition.
  Its sections are the session (Start, Pause, Resume, Stop, Abort, New Field, Reset after a confirmation, Close, the frame counts, the capture it follows, and the memory), the masters chosen per exact filter name, each filter a collapsible section that can be removed (filters chosen among the slot names of the connected filter wheel of the Main Camera, or None, the filter of frames without one, when there is no connected wheel; masters from the Calibration Library lists, never chosen for the operator, and only flats without a filter offered for None) with what to do with other filters, the recipe (locked while a session runs), what the tab shows (Latest frame, one stack chosen among the stacks of every field, or a color composition of the mono stacks of one field by the presets of Image Stacking or a custom mix of weights and gains, saved as a linear color FITS).
  A stack shown is saved from the Save control of the viewer toolbar, and the Image Inspector describes the stacks of the snapshot shown (filter and field, frames and total exposure, acquisition settings, masters, sensor temperatures).
  The recipe and masters are the `liveStacking` form of the camera in the profile.
- Camera Acquisition is the camera operation of a camera tab (`web/src/images/CameraAcquisitionTool.tsx`): the acquisition panel of the tab's camera (`CameraAcquisitionSections`), its availability judged on the camera itself (`deviceAvailability`).
  Its Dithering section (`web/src/camera/DitheringSection.tsx`) turns the dithering of the fixed and loop LIGHT captures of the Main Camera on and sets its cadence and method: Guided, through the guiding session of the setup's GUIDE_CAMERA with the amount, RA only, and settle of that camera's Guiding form, shown read-only;
  or Mount, moving the setup's MOUNT by guide pulses through the setup's GUIDE_OUTPUT or a small GoTo, with its amount in arcseconds, pattern, RA only, and mechanical settle, and under Advanced the guide pulse directions and limit of the mount.
  Start is refused with the reason while the chosen method cannot dither (no guiding session guiding, no mount or guide output assigned);
  the capture request carries the frozen dither (`captureDither` of `web/src/camera/capture.ts`), and a running capture shows the dither of its request, never the form.
  Another camera never dithers.
  The status shows Dithering or Settling and the dithers done, and the status bar shows Dithering on the main camera chip.
  The toolbar of a camera tab shows the state of its camera's capture (phase, time left, frame count, file state of the latest frame, or why it failed) whatever tool is selected; switching tool, frame, or tab never stops a capture.
- The devices a camera operation uses are named as links to their page in Equipment Control (`DeviceLink` of `web/src/equipment-control/DeviceLink.tsx`, route `/equipment/<device id>`): the camera in the camera settings of Camera Acquisition (`CameraSettings` of `web/src/camera/ExposureSettings.tsx`), and every device of the Equipment section of the other camera operations;
  Mount Remote Control, Mount Pointing Model, and the status bar details link their devices the same way.
- An Images tool is an image tool or a camera operation (`category` of `IMAGE_TOOL_DEFINITIONS`), chosen in the tool bar of the header (`ImageToolBar` of `web/src/images/ImageToolBar.tsx`, the tools of `imageToolsFor`): a button with the tool's icon each, the camera operations after a divider, the selected one pressed.
  When the header has no room for every button, the trailing ones move to a list under its heading opened by a More Tools button at the end of the bar (`fitImageToolBar`, refitted whenever the bar's width changes), and the selected tool always keeps its button.
  Camera operations are listed only on a camera tab: the tool bar of a file or derived document shows only the image tools.
  Its equipment is the `CameraOperationContext` of the tab (`web/src/images/cameracontext.ts`): the physical camera of the tab;
  the `FOCUSER` of the active setup only when the camera is its `MAIN_CAMERA` (the setup has flat roles and no optical train, so no other camera has a focuser);
  the `MOUNT` of the active setup for every camera of the watched connection;
  the `GUIDE_OUTPUT` of the active setup only when the camera is its `GUIDE_CAMERA` (`CameraOperationContext.guideOutput`), so no other camera guides;
  the `FILTER_WHEEL`, `FLAT_PANEL`, and `COVER` only for the `MAIN_CAMERA` (`wheel`, `flatPanel`, `cover`);
  and the setup's snooped devices for the Main Camera, the mount alone for the Guide Camera, and none for a camera without a role.
  A missing assignment is reported by the operation's panel, never replaced by another connected device.
- The display settings of a document are changed from the viewer toolbar, whatever tool is selected (`web/src/images/DisplayToolbar.tsx`, over `Popover` of `web/src/ui/Popover.tsx`);
  the Image Inspector only shows the parameters of the current rendering.
  Debayer, Stretch, Brightness & Contrast, and Color each open a popup, one at a time, and Invert is a toggle.
  Debayer (enabled and pattern) and Invert apply as soon as they change;
  Stretch, Brightness & Contrast, and Color edit a draft started from the applied settings each time their popup opens, applied by their Apply to View and discarded when the popup closes, and their Reset Parameters restores the neutral values (`ORIGINAL_DISPLAY_SETTINGS`) in the draft without applying them.
  Each apply sends only its own settings as a patch, so a toggle during a rendering builds on it (`applyDisplay` of `web/src/images/images.ts`).
  An auto stretch is the toolkit's `autoStf` with the preset chosen in the Stretch popup (Low, Medium, High, Moon, or Planet; Medium is the default, the plain adaptive display function), linked or per channel.
  Presets always sample the whole image, without a region or mask, so Moon and Planet assume a target filling most of the frame.
  Debayer is disabled for an image that is not a CFA mosaic (mono with a BAYERPAT, `isMosaic`), Color for a grayscale rendering, and every control until the document is first rendered.
  The settings applied are saved in the profile (see [Persistence and State](persistence-and-state.md)): a new file or derived document starts with the global ones and a camera tab with those of its camera (`initialDisplaySettings`), or with the image's defaults when none were saved.
  Images derived by a pipeline get the global settings as they are, even when a step already stretched them.
- Saving and downloading are a control of the viewer toolbar, for every document (file, derived, or camera tab), whatever tool is selected (`web/src/images/SaveImagePopover.tsx`); no panel saves or downloads.
  Its popup chooses the format: FITS or XISF, the pixels the server holds in memory encoded in the scale of their source with the header (`ImageStore.encode`), or JPEG, the rendering the viewer shows (the original one during Show Original, the applied one otherwise: `shownDisplaySettings`), encoded by the worker exactly as a rendering with those settings but outside the render queue, so no rendering supersedes it.
  Save to Server opens the file explorer in save mode listing the files of the format (`SaveImageModal.tsx`, the name by `saveFileName`), starting in the folder the profile saved to last (`ProfileSettings.lastSaveDirectory`, changed only by a write the server confirmed and apart from `lastImageDirectory`, where Open Image starts), then the folder of the document, then `lastImageDirectory`, and posts `/api/images/:id/save` (`settings` for JPEG, 422 when they cannot be applied);
  an existing file is replaced only after a confirmation, and never the file of an open document.
  Download has the browser save `/api/images/:id/file` (FITS or XISF, named after the document with the format's extension instead of its own) or the object URL of the JPEG shown.
  Both write a copy: the tab keeps its name and source, and only a derived document whose pixels (FITS or XISF) were written to a server file stops being unsaved and shows that file's folder; a JPEG never saves it.
