# UI and Layout Contracts

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The rules a new screen or a layout proposal follows, so it fits the existing shell without new layout systems.

Shell (`web/src/shell/ApplicationShell.tsx`), always mounted while navigating:

- **Top bar** (`web/src/layout/TopBar.tsx`, `h-14`, 49 px): logo, the Management menu (Connections, Equipment Setup, Equipment Control), then the observing site menu (`ObservingSiteMenu`: a pin with the active profile's site, or Set Location, listing every saved site to select in one click, No Active Site, and Manage Sites; the name hidden below `sm`; choosing changes the profile only, never a device), the connection indicator, the notification bell (the unread count of the active profile's connection and the notification panel; see [Notifications Contract](notifications.md)), the gear button of the Settings page (highlighted while it is shown), and the profile menu.
- **Navigation rail** (`NavigationRail.tsx`, `w-16`, 56 px): one button per entry of `WORKSPACES`, in a region that scrolls when the window is short, and the About page button anchored below it, never scrolled out of view;
  pages opened from Management or the top bar are not listed.
- **Workspace or page**: the component of the route; only it is swapped on navigation.
- **Status bar** (`StatusBar.tsx`, `h-7`, 24.5 px, selectors and items in `web/src/shell/statusbar/`): everything the active profile has, in as little room as it can.
  The tab's link to the application server is a server icon, green while the event socket is open (`notificationsState.server`) and red otherwise, with the link and the selected connection in its title (the top bar shows and manages the connection).
  Then a chip per assigned role whose device is present and reported connected (none for an unassigned or disconnected device, or a role the profile hides), in the order main camera, filter wheel, focuser, rotator, mount, guide camera, dome, cover, flat panel, each an icon and the readings the profile asks of it (`STATUS_CHIP_FIELDS`, by default its status and main measurement), its name and full reading in its title, opening its exact device in Equipment Control (`roleChip`).
  The status says what the device is doing: the camera's capture phase, or Exposing for an exposure of any other tool (`exposing` of its state);
  the mount's motion (Parking, Homing, Slewing, Moving), or parked, tracking, or idle;
  Moving for a focuser, rotator, cover, or dome, whose status also says when it parks or homes;
  Changing for a wheel;
  the guide camera's running session (dither, settle, the RMS of the latest guide steps in arcseconds only when the session knows the pixel scale and in guide pixels otherwise, never an earlier RMS outside guiding, or the guider state);
  the cover open or closed;
  the flat panel's light on or off.
  The measurements are the sensor temperature in °C only when the driver reports a finite one and the cooler power of a camera, the mount's equatorial coordinates of date, the wheel's filter name at its 0-based slot, or the 1-based slot number, the focuser's position in steps and temperature, the rotator's mechanical angle in degrees (not a sky position angle), the dome's shutter and azimuth, and the flat panel's brightness.
  The right group holds every running operation that holds a device of the active profile's server connection (never another connection's, and `guideOutput.guiding` only through the `camera.guiding` of its session, by exact operation id), each as its icon, name, and progress followed by its Abort when it can be interrupted (`barOperations`): a capture shows the frames taken of those requested and the completed percentage, counting the frame in flight by its exposure (`capturePercent`), or the frames taken and the percentage of the current exposure for a loop, or Stopping, and any other operation the steps it reports.
  Then come the count of failures of that connection's devices (connect and driver failures of `deviceState.errors` and refused commands of `controlRuntime.errors`, each only while its store tracks that connection, listed in its title) and the details button.
  Before the failures, the Meridian Flip Monitor of the profile's mount shows while it is enabled (`MeridianFlipItem`, `data-fixed`): its icon and status (`meridianFlipStatusText`: the headline of `meridianFlipHeadline`, with `T−m:ss` to or `T+m:ss` since the transit while it monitors a current forecast, interpolated from the server's sample), the step of a running flip of the Meridian Flip Executor instead, and `· Armed` while a flip is armed or scheduled, in the tone of the headline (a warning or a danger only for a flip candidate in or past the window), opening the tool;
  it never shows for another mount, and it commands nothing.
  The operations are fitted first, then the chips in the room left, each by the priorities of `fitOperations` and `fitItems` (`web/src/shell/statusbar/selectors.ts`), again whenever the bar or an item changes size;
  what is left out is counted on the details button (`+N`, or an info icon).
  The server link, the Meridian Flip Monitor, the failures, the details button, and the first operation are never left out.
  An Abort is offered only while the event socket is online, and it sends the one command that interrupts that operation (`operationInterruption`, see [Operation Lifecycle Rules](operation-lifecycle-rules.md)): the `/stop` of its mount, focuser, rotator, dome, cover, or guide output, while the control store mirrors its connection and the driver reports it connected and able to abort;
  the abort of a capture, or its stop after the exposure on a camera that cannot abort;
  and the stop of the session of Guiding, Auto Focus, TPPA, iPolar, DARV, Flat Wizard, Dark Library Wizard, Target Centering, or the Pointing Model Builder and its verification, found by exact operation id, which ends that session keeping what it did.
  A filter wheel change and an INDI property write have none.
  A motion of the profile's mount that no operation holds, reported by the driver as a goto, a manual axis motion, parking, or homing, shows as an operation of its own with its Abort.
  The click decides again from the live stores (`abortOperation`, `abortProfileMount`), so a profile, connection, or role switch after the render sends nothing;
  it interrupts that operation and nothing else, and shows a refused command as a device failure.
  While the socket is offline the operations shown are the last known, dimmed, without an Abort.
  The details button opens a panel above itself (`StatusDetailsPanel.tsx`, fixed in the viewport like the notification panel, closing on a press outside, Escape, a resize, or after opening something) with the server link and the selected connection, every role with its device link and status or full reading, the sessions with Open in Images while their camera tab is open, the enabled Meridian Flip Monitor of the mount with its status and Open tool, every other running operation with its devices, elapsed time (a timer of the open panel only), and reported progress, an Abort on each session and operation that has one, and the device failures.
  Closing the panel or navigating from it never stops a session or an operation; only an Abort does.
  The right group also shows the real-time clock of the profile, always the real current time, never the Sky simulation clock (`web/src/shell/statusbar/astronomicalclock.ts`): one or two readings of LAST, LMST, JD(UTC), MJD(UTC), UTC, or local time, chosen in Settings → Status Bar;
  the local time reads in the profile's display zone (Settings → Date & Time), and without an observing site JD(UTC) stands for a primary sidereal reading and a secondary one is left out.
  The clock is opportunistic (`fitClocks`): it changes nothing of how the chips and the operations are fitted, shows only while none of them is left out, and is never counted on the details button.
  The server samples the time (`POST /api/astronomical-time/reference`, the same conversion path as `/convert`) on mount, on a new place of the active site, every 60 s, when the page is shown again, when the socket comes back, and when the wall and monotonic clocks of the tab disagree by 2 s, as after a sleep;
  between samples the readings move on by the monotonic time elapsed at the rate the server gives, which is the only sidereal arithmetic of the web, and a hidden page asks for nothing.
  A sidereal reading computed with UT1 taken as UTC starts with `~`, a reading 5 minutes old is dimmed and says so in its title, and from 30 minutes it shows `--`.
  A chip's title holds the full readout, and its click opens the Astronomical Time Converter on the real current time at the active site, whatever instant the tool held, and nothing else;
  the details panel has an Astronomical Time section with the same data and the same action.
  It is the only global status surface.
- **Modals**: Connections, Equipment Setup, and Profiles, over native `<dialog>` (`web/src/ui/Modal.tsx`).

Workspace frame (`WorkspaceLayout.tsx`), used by every workspace and every tool view:

- From top to bottom: optional `tabs` spanning the workspace (the Images document and camera tabs), a header at least 42 px tall (`min-h-12`) with the title, `context` controls, `actions`, and the panel toggle, whose actions wrap to a line of their own when they do not fit beside the title (the header then grows instead of clipping them), then the content beside the contextual panel. With `contextFill` the context controls take all the room the title and the actions leave on the line (the Images tool bar, which fits itself to it), so they never push the actions to a line of their own.
  The content fills the remaining space and scrolls itself.
- The contextual panel (`ContextualPanel.tsx`) is the right-hand column of the current context: 280 px (`w-80`; 308 px, `w-88`, from `xl`), docked from Tailwind's `lg` breakpoint (`WIDE_SCREEN`, 64rem, 1024 px), its visibility a per-workspace preference of the profile;
  below `lg` it is a drawer over the content that starts closed, is never persisted, and closes with Escape or a click outside.
  A workspace whose own controls show the panel (the Sky toolbar's Framing, Display, and Location) holds this visibility with `useWorkspacePanel` and passes it as `panelState`, so a control that needs the panel opens it in either form.
  The workspace frame clips the closed drawer (`overflow: clip`) rather than hiding it, so no focus or scroll into view inside it can shift the workspace sideways.
  It holds no operational state, so collapsing or replacing it never stops what its controls started.
- Collapsible panel sections (`CollapsibleSection` of `web/src/shell/`): the heading is the toggle, with a one-line summary beside it while collapsed.
  Important sections start expanded, advanced or secondary ones collapsed (`defaultOpen`);
  a section the operator toggled keeps its state, keyed by its namespaced id (`sky.*`, `images.<tool>.*`), across selections, documents, camera tabs, and tool switches, and across reloads and tabs of the browser (`collapsibleSections` of `web/src/shell/collapsible.ts`, kept in browser storage by `web/src/profile/view.ts`).
  Every section of the Images tools, image tools and camera operations alike, is one, and a panel never nests a disclosure inside a section: an advanced group is a collapsed section of its own (for example Advanced Settings, Solver Details, Template Tags, or the Camera settings of Acquisition).
  The panels of the Jupiter and Saturn Observing Planners are collapsible sections too (`jupiter.*`, `saturn.*`): the event kinds and the moons start expanded;
  View, the Great Red Spot, and Ephemeris start collapsed with their orientation, model quality, or source as summary.
  Like Planetary Events, Meteor Showers, Astro Weather, and the Observing Planner, they have no Location or Time Zone section: they observe from the active site.
  The panel of Planetary Events follows them (`planetaryEvents.*`): Range, Planets, and Events (with the appulse threshold) start expanded, and Visibility, and Ephemeris and Definitions start collapsed.
  The panel of Meteor Showers follows them too (`meteorShowers.*`): Search and Filters and Observing Night start expanded, and Modelled Rates starts collapsed.
- Label and value rows (`DataRow` of `web/src/ui/DataRow.tsx`, grouped by `DataList`): every datum shown as a label and its value, in the contextual panels, the inspectors, Equipment Control, and the tool results, is one.
  Label and value share a line while both fit; a value that does not fit goes below its label, aligned to the end, and a label or value wider than the panel wraps instead of being cut.
  A value takes a tone (plain, success, or danger), never a layout of its own.
  Lists of another shape stay their own: the FITS header keywords, the filename template tags, and the metric tiles of the pointing diagnostics.
- The sections of the Sky Object Inspector, every object's and the Sun's and the Moon's, are collapsible sections, except the Object section, which holds the name, the type, the designations, the magnitude (the catalog's for a catalog object, the position's otherwise), and the actions: Show Framing, and Slew to Object (with Stop while slewing) only while the profile's mount is connected (`ObjectActions`);
  Position and Visibility start expanded and the others collapsed.
- One panel content at a time: Images shows the panel of the selected tool, Sky the selected panel view.
  Pages (Equipment Control, Settings) use a sidebar list and a detail area instead of a contextual panel.

Visual language (`web/src/index.css`, Tailwind 4 `@theme`):

- Dark theme only (`color-scheme: dark`), one font for all text: JetBrains Mono (`font-mono`).
- The root font is 14 px, so a rem is 14 px and a Tailwind spacing step (0.25rem) is 3.5 px: `h-12` is 42 px, `w-80` 280 px.
  Media queries ignore the root font and take the browser's 16 px rem, so the breakpoints keep Tailwind's widths (`lg` 1024 px, `xl` 1280 px).
  The radii are set in pixels and do not scale.
- Colour tokens, used as Tailwind utilities (`bg-base-100`, `text-ink-200`, `border-line-100`, …): surfaces `base-000` (darkest: rail, bars, panels, viewers) to `base-300` (hover);
  borders `line-100`, `line-200`;
  text `ink-100` (primary), `ink-200` (secondary), `ink-300` (muted);
  `accent`, `accent-hover`, `accent-subtle` (selected backgrounds), `on-accent`;
  `danger`, `success`, `warning`, `info`.
  A new colour is added as a token, never as a literal in a component.
- Radii `rounded-sm` (6 px), `rounded-md` (10 px), `rounded-lg` (16 px), `rounded-xl` (24 px).
  Panel headings are small uppercase `ink-200` text; dense panels use `text-xs`.
- Transitions honour `motion-reduce:transition-none`; focus is shown with an `accent` outline on `focus-visible`.

Components:

- Shared primitives live in `web/src/ui/`: `Button`, `IconButton` (icon only, its label is the tooltip; `pressed` for toggles), `Checkbox`, `RadioGroup`, `SegmentedControl` (two to five short options), `Select` (themed listbox), `TextInput`, `NumberInput`, `Field` (shared control look and unit suffixes such as `mm` or `°`), `Slider` (label, typed value, and track), `List`, `Pager` (previous and next page of a paged list), `Modal` (with `ModalActions`, the row of its closing buttons), `ConfirmButton` (a command run only once a dialog confirms it), `NavigationMenu`, `Popover` (a toolbar button's floating panel of controls), `ContextMenu` (actions at a point, such as a right click on an image), `StatusBadge` (a state in words with a tone), `DataRow` and `DataList`, `Notice` (the muted line of explanation under a control or a section, or an error in the danger colour), `SectionHeading` (the small uppercase heading of a group), `Actions` (the wrapping row of a section's command buttons), `Table` (the data tables of the tools: a bordered frame that scrolls under a sticky header, columns of text or of numbers aligned to the end, and rows that select what they show), `ProgressBar` (the thin bar of a running exposure, delay, measurement, or calibration step, pulsing while the share done is unknown), `WorldMap` (the basemap of the eclipse and satellite maps, see [World Map Contract](world-map.md)), and `Icon` (the one icon set, 24×24 line paths, device types keyed by type).
  A new screen composes these; a new primitive is added there only when two features need it.
- Feature components are colocated with their feature (for example `web/src/camera/ExposureSettings.tsx`, or `EquipmentSetupButton` of `web/src/equipment/`, the offer of a panel that needs equipment); variants use `tv`, merging uses `cn`.
- Values are written by the semantic formatters of `web/src/format.ts`, one per quantity (listed in its module description), each taking the value in its computational unit and returning text only.
  Instants in an IANA zone have one format per use there too: `formatDate` and `formatDateTime` for tables, logs, and exports, `formatClockTime` for a time of day, `formatLocalTime` for a time of day that adds the date on another day than a reference, and `formatLongDateTime`.
  Every `Intl.DateTimeFormat` of the web, those that read wall-clock fields and zone offsets in `web/src/location/zone.ts` included, comes from the one cache of `dateTimeFormat`, by locale and options;
  no screen formats an instant with the browser's locale.
  The few times with no display zone of their own (calibration masters, plate-solving jobs) read in the browser's zone; `MISSING` ("—") is the one text of an absent value, and a value that is not finite is shown as it, never as NaN.
  Sky coordinates are written by `web/src/sky/format.ts` (with the apparent diameters and fields of view of the Sky, in arcminutes as catalogs give them, distances, and magnitudes) and, in the profile's coordinate format, by `web/src/platesolving/coordinates.ts` (with position angles and pixel scales).
  A unit or a number of decimals is chosen after rounding, so a boundary value carries (59.999″ reads 1.00′, and a right ascension or position angle that rounds to a full turn reads 0), while a declination keeps its sign when it rounds to zero.
- Every pixel image is shown by `ImageViewer` (`web/src/viewer/`) with overlays in image coordinates (see [Overlay Contracts](overlay.md)); the star map is the canvas renderer of `web/src/sky/celestial/`, and the orbits of the Orbital Mechanics Explorer the depth-sorted 2D canvas renderer of `web/src/tools/orbitalmechanics/scene.ts` (see [Orbital Mechanics Explorer Contract](orbital-mechanics-explorer.md)).

Behaviour every screen keeps:

- Status is always text, colour only reinforces it; absence is shown as absence, never as 0.
- Values shown are those the server reports; inputs hold pending values until an explicit action (Apply, Save, Start, Solve Image, …).
- Unavailable actions stay visible and disabled with the reason as their tooltip (`Not available yet.`, the busy or missing device); a panel that needs equipment says what to set up and offers Equipment Setup.
- Lists, table rows that select, rails, tabs, and carousels move with the arrow keys, Home, and End (`moveIndex` in `web/src/ui/navigation.ts`) and select with Enter or Space.
  Native elements, `title`, and visually hidden text name controls; `aria-*` attributes are not used (`AGENTS.md`).
- Layouts work from phone width up: secondary text hides with `max-sm:`, the panel becomes a drawer, toolbars wrap (the Sky search takes a line of its own, with the buttons below it), and nothing scrolls the page horizontally.
