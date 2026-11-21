---
name: Nebulosa
description: A warm, dark, monospace observatory console for a night of astronomical imaging.
colors:
    base-000: '#141413'
    base-100: '#1f1e1d'
    base-200: '#262624'
    base-300: '#30302e'
    line-100: '#3d3d3a'
    line-200: '#6b6a64'
    ink-100: '#faf9f5'
    ink-200: '#c2c0b6'
    ink-300: '#9c9a92'
    accent: '#d97757'
    accent-hover: '#e3896b'
    accent-subtle: '#3a2620'
    on-accent: '#141413'
    danger: '#e5675e'
    success: '#6cc28a'
    warning: '#e9a13b'
    info: '#6ba6e8'
    scrim: '#0a0a09'
    map-horizon: 'oklch(0.6 0.08 40)'
    map-equator: 'oklch(0.6 0.08 250)'
    map-ecliptic: 'oklch(0.6 0.08 325)'
    map-meridian: 'oklch(0.6 0.08 145)'
    map-deep-sky: 'oklch(0.6 0.08 100)'
    map-sun: 'oklch(0.8 0.14 95)'
    map-moon: 'oklch(0.65 0.12 245)'
    map-planet: 'oklch(0.6 0.14 310)'
    map-asteroid: 'oklch(0.6 0.14 20)'
    map-comet: 'oklch(0.6 0.14 160)'
    map-radiant: 'oklch(0.6 0.08 360)'
typography:
    headline:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '17.5px'
        fontWeight: 600
        lineHeight: '24.5px'
        letterSpacing: '-0.01em'
    readout:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '26.25px'
        fontWeight: 600
        lineHeight: '31.5px'
        letterSpacing: '-0.01em'
        fontFeature: 'tnum'
    wordmark:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '15.75px'
        fontWeight: 600
        lineHeight: '28px'
    title:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '12.25px'
        fontWeight: 600
        lineHeight: '17.5px'
    body:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '14px'
        fontWeight: 400
        lineHeight: '21px'
    body-dense:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '12.25px'
        fontWeight: 400
        lineHeight: '17.5px'
        fontFeature: 'tnum'
    label:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '10.5px'
        fontWeight: 500
        lineHeight: '14px'
        letterSpacing: '0.08em'
    caption:
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: '10.5px'
        fontWeight: 400
        lineHeight: '14px'
rounded:
    sm: '6px'
    md: '10px'
    lg: '16px'
    xl: '24px'
    full: '9999px'
spacing:
    xs: '3.5px'
    sm: '7px'
    md: '10.5px'
    lg: '14px'
    xl: '21px'
components:
    button-primary:
        backgroundColor: '{colors.accent}'
        textColor: '{colors.on-accent}'
        typography: '{typography.body-dense}'
        rounded: '{rounded.md}'
        padding: '7px 14px'
    button-primary-hover:
        backgroundColor: '{colors.accent-hover}'
    button-secondary:
        backgroundColor: 'transparent'
        textColor: '{colors.ink-100}'
        typography: '{typography.body-dense}'
        rounded: '{rounded.md}'
        padding: '7px 14px'
    button-secondary-hover:
        backgroundColor: '{colors.base-300}'
    button-ghost:
        backgroundColor: 'transparent'
        textColor: '{colors.accent}'
        rounded: '{rounded.md}'
        padding: '7px 14px'
    button-ghost-hover:
        backgroundColor: '{colors.accent-subtle}'
    button-disabled:
        backgroundColor: '{colors.base-300}'
        textColor: '{colors.ink-300}'
    icon-button:
        backgroundColor: 'transparent'
        textColor: '{colors.ink-200}'
        rounded: '{rounded.sm}'
        size: '28px'
    icon-button-pressed:
        backgroundColor: '{colors.accent-subtle}'
        textColor: '{colors.accent}'
    input:
        backgroundColor: '{colors.base-200}'
        textColor: '{colors.ink-100}'
        typography: '{typography.body-dense}'
        rounded: '{rounded.sm}'
        padding: '7px 10.5px'
        height: '33.25px'
    segmented-option-selected:
        backgroundColor: '{colors.accent-subtle}'
        textColor: '{colors.accent}'
    status-badge:
        backgroundColor: 'transparent'
        typography: '{typography.caption}'
        rounded: '{rounded.full}'
        padding: '0 8.75px'
        height: '21px'
    tool-card:
        backgroundColor: '{colors.base-000}'
        rounded: '{rounded.md}'
        padding: '10.5px'
    popover:
        backgroundColor: '{colors.base-200}'
        rounded: '{rounded.md}'
        padding: '10.5px'
    modal:
        backgroundColor: '{colors.base-200}'
        textColor: '{colors.ink-200}'
        rounded: '{rounded.xl}'
        padding: '21px'
    top-bar:
        backgroundColor: '{colors.base-000}'
        height: '49px'
    navigation-rail:
        backgroundColor: '{colors.base-000}'
        width: '56px'
    status-bar:
        backgroundColor: '{colors.base-000}'
        typography: '{typography.caption}'
        height: '24.5px'
    contextual-panel:
        backgroundColor: '{colors.base-000}'
        width: '280px'
---

# Design System: Nebulosa

## Overview

**Creative North Star: "The Observatory Console"**

Nebulosa looks like the control desk of a small observatory at night: a dense, calm surface of warm near-black panels, monospace readouts, and one ember glow that marks what is live or chosen. It is built for an operator in the dark, often across the room or on a phone, so the interface never competes with the sky. Chrome stays quiet; readings, status words, and the image or star map in the middle carry the screen.

Density is high and deliberate. The root type size is 14 px, dense panels run at 12.25 px and 10.5 px, and the frame (top bar, navigation rail, status bar, contextual panel) is fixed so the eye always knows where status, navigation, and controls live. Depth comes from small tonal steps between warm darks and from one-pixel lines, not from shadows, gradients, or glow.

The system rejects four looks outright: the neon sci-fi HUD (glowing cyan or purple, scanlines, space-game chrome), any light or bright theme, glossy consumer SaaS (gradients, big shadowed rounded cards, marketing flourishes inside the app), and the default cool blue-gray dark palette.

**Key Characteristics:**

- Dark only, warm neutrals, one ember accent.
- One typeface for everything: JetBrains Mono, tabular figures for values.
- Flat, tonally layered surfaces divided by one-pixel lines.
- Small uppercase tracked labels head every group.
- Status is always written in words; colour only reinforces it.
- A fixed console frame around one swappable workspace.

## Colors

A warm, low-light palette: near-black surfaces with a faint olive warmth, cream ink, and a single clay-orange accent, with four star-named signal colours used only for state.

### Primary

- **Ember Clay** (`accent`): the one accent. Primary buttons, the selected option of a segmented control, the selected row, list item, or menu entry, the pressed icon button, the active navigation marker, the focus outline, running progress, and the active status dot. Nothing else.
- **Ember Clay Bright** (`accent-hover`): the hover state of a primary button, and only that.
- **Ember Wash** (`accent-subtle`): the background of selected things (selected segment, selected table row, pressed icon button, ghost button hover), always paired with Ember Clay text.
- **On Ember** (`on-accent`): text on an Ember Clay fill; the same value as Deep Night.

### Neutral

- **Deep Night** (`base-000`): the darkest surface. Top bar, navigation rail, status bar, contextual panel, tool cards, image and sky viewers.
- **Nightfall** (`base-100`): the page and workspace background, workspace headers, and sticky table headers.
- **Twilight Ash** (`base-200`): raised surfaces and fields. Inputs, selects, unselected segments, modals, popovers, menus, table row hover.
- **Horizon Haze** (`base-300`): hover fill of buttons, icon buttons, and menu rows; the disabled fill.
- **Faint Meridian** (`line-100`): dividers, panel and section separators, card, table, popover, and modal borders.
- **Graticule** (`line-200`): borders of interactive controls (inputs, secondary buttons, segments).
- **Starlight Cream** (`ink-100`): primary text, values, titles.
- **Moonlight** (`ink-200`): secondary text, panel body copy, panel headings, idle icons.
- **Zodiacal Gray** (`ink-300`): muted text. Labels of data rows, notes, placeholders, disabled text, section headings, unit suffixes.
- **Night Veil** (`scrim`): the backdrop behind floating layers, never a surface. Always used translucent: 72 % behind a modal, 60 % behind the contextual panel drawer.

### Signal

- **Aurora Green** (`success`): connected, completed, available, a good reading.
- **Arcturus Amber** (`warning`): attention needed but nothing failed; a flip window approaching.
- **Antares Red** (`danger`): failure, refusal, a destructive confirmation, an out-of-range reading.
- **Vega Blue** (`info`): neutral information in notifications.

### Star Map

The Sky's star map is drawn on a canvas in the same palette, read from the tokens (`web/src/sky/palette.ts`): stars keep their B−V colours; names are Zodiacal Gray; the grid and constellation lines and boundaries are faint Graticule; the field of view is Starlight Cream, the footprint and mark sent from an image dashed Moonlight; the selection reticle is Ember Clay and nothing else on the map is; the connected mount is Aurora Green. Kinds of objects and reference lines are told apart by muted `map-*` hues that never glow: the reference lines, deep-sky objects, and meteor radiants at the lowest chroma (horizon umber, celestial equator slate, ecliptic mauve, local meridian sage, deep-sky objects olive, meteor radiants dusty rose), and the bodies of the Solar System a step more saturated so they read as points against them (planets violet, asteroids brick, comets jade, the Moon steel blue, and the Sun pale gold, the one lighter hue). The Display panel shows each hue beside its layer, so it is the map's legend. Framings draw in six `frame-*` hues of the same low chroma a step lighter (rust, ochre, sage, gray-teal, slate, rose), each kept by its framing from creation, and the Equipment Setup's in Starlight Cream. Labels are JetBrains Mono. The eclipse maps follow the same rule on the world map: the Moon's shadow on a solar map (the central line, the limits of the central eclipse, and the umbral global points) and the region where the Moon is up on a lunar map are drawn in the Moon's steel blue, the partial limits and sunrise/sunset curves in the neutrals, and only the chosen place and the chosen point are Ember Clay; the Sun of a solar Local View is a dim pale gold, never Starlight Cream. The Orbital Mechanics Explorer's 3D scene keeps the rule too: its orbits draw in six `orbit-*` hues of the framings' low chroma with no red or clay among them, the axes in Graticule told apart by their letters, the grid in Faint Meridian, and the selected orbit by a heavier stroke in its own hue; Ember Clay marks only its row in the orbit list.

### Named Rules

**The One Ember Rule.** Ember Clay marks what is chosen, focused, running, or the one primary action. It is never decoration, never a background block, never a second brand colour. If two things on a screen glow, one of them is wrong.

**The Warm Dark Rule.** Every neutral is warm. A new colour enters as a token in `web/src/index.css`, never as a literal in a component, and never as a cool blue-gray.

**The Words First Rule.** A signal colour never carries a state alone: the state is a word (Connected, Slewing, Failed) and the colour only tints it.

## Typography

**Body Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas, monospace), variable weight 100–800, bundled with the app (Latin, Latin Extended, Greek).

**Character:** One monospace voice for labels, values, prose, and headings alike. It reads as instrument output: aligned digits, exact units, no typographic ornament.

The root font is 14 px, so every rem-based size is a multiple of 14 px (Tailwind `text-sm` is 12.25 px, `text-xs` 10.5 px).

### Hierarchy

- **Readout** (600, 26.25 px, 31.5 px line, −0.01em, tabular figures): the one live reading of a tool meant to be read from across the room or on a phone at arm's length, such as the time to the meridian transit of the Meridian Flip tool. At most one per screen, in Starlight Cream, never Ember.
- **Headline** (600, 17.5 px, 24.5 px line, −0.01em): modal titles only.
- **Wordmark** (600, 15.75 px, 28 px line): the "Nebulosa" name beside the logo in the top bar, hidden on phones.
- **Title** (600, 12.25 px, 17.5 px line): workspace and tool titles in the header, tool card names, page titles.
- **Body** (400, 14 px, 21 px line): the page default; modal copy and list item names.
- **Body Dense** (400, 12.25 px, 17.5 px line, tabular figures): the working size. Controls, buttons, data rows, panel content, menus.
- **Label** (500, 10.5 px, 14 px line, 0.08em tracking, uppercase): section headings, field labels, panel titles, status pills on tool cards.
- **Caption** (400, 10.5 px, 14 px line): notes under a control, the status bar, table cells, badges.

### Named Rules

**The One Voice Rule.** JetBrains Mono is the only typeface. Hierarchy comes from size, weight, case, and the three ink tones, never from a second family.

**The Aligned Digits Rule.** Every value that can change or be compared (coordinates, temperatures, counts, times, table numbers) uses tabular figures and is right-aligned against its label.

## Layout

The application is a fixed console frame around one workspace. From top to bottom: the top bar (49 px), then the navigation rail (56 px wide) beside the workspace, then the status bar (24.5 px, 35 px below 640 px). Only the workspace swaps on navigation.

Each workspace has a header at least 42 px tall (title, context controls, actions, panel toggle; actions wrap to their own line rather than clip), its content, which scrolls itself, and the contextual panel on the right: 280 px, 308 px from 1280 px, docked from 1024 px and a drawer over the content below it, or, for a live view its controls change, a flat sheet taking the lower half under that content. Pages (Equipment Control, Settings) use a sidebar list and a detail area instead.

Spacing follows Tailwind's 0.25 rem step, which is 3.5 px here. The working rhythm is 3.5 / 7 / 10.5 / 14 / 21 px: 7 px between controls in a group, 10.5 px inside cards and popovers, 14 px gutter of bars and panel sections, 21 px inside modals. Grids of cards use `repeat(auto-fill, minmax(224px, 1fr))` with 7 px gaps.

Layouts work from phone width up: secondary text hides below 640 px, the panel becomes a drawer, toolbars wrap, modals dock to the bottom edge, and nothing scrolls the page horizontally. Breakpoints keep Tailwind's 16 px-rem widths (640, 1024, 1280 px) even though the root font is 14 px.

**The Fixed Frame Rule.** Status lives in the status bar, navigation in the rail, context in the right panel. A new screen fills the workspace slot and never invents a second frame, toolbar zone, or status surface.

## Elevation & Depth

The resting interface is flat. Depth is tonal: Deep Night frames and viewers, Nightfall workspace, Twilight Ash fields and raised layers, Horizon Haze for hover, each step separated by a one-pixel Faint Meridian line. Shadows exist only on layers that float over content.

### Shadow Vocabulary

- **Float** (`box-shadow: 0 12px 32px rgb(0 0 0 / 0.45)`): popovers, select listboxes, context menus, search results, notification panel.
- **Dialog** (`box-shadow: 0 24px 64px rgb(0 0 0 / 0.55)`): modals, over Night Veil at 72 % (`bg-scrim/72`) with a light backdrop blur.
- **Drawer** (`box-shadow: -16px 0 48px rgb(0 0 0 / 0.45)`): the contextual panel as a drawer below 1024 px, over Night Veil at 60 % (`bg-scrim/60`).

### Named Rules

**The Flat Desk Rule.** Anything that sits in the layout is flat. A shadow means "this is floating above the desk and will go away"; cards, panels, and sections never get one.

## Shapes

Corners are small and consistent: 6 px on controls (inputs, icon buttons, segments, menu rows), 10 px on buttons, cards, tables, and popovers, 24 px only on modals, and full pills for status badges, progress tracks, and dots. Borders are always one pixel. The one figurative geometry is the line icon set: 24 × 24 paths stroked at 1.5 px with round caps and joins, filled only for a pressed favourite.

## Components

Quiet and exact: controls step back so readings lead.

### Buttons

- **Shape:** gently rounded (10 px), one-pixel border, 12.25 px medium text, 7 × 14 px padding; a smaller 6 px, 3.5 × 10.5 px size exists but is used only when a layout truly needs it.
- **Primary:** Ember Clay fill, On Ember text. One per group at most.
- **Secondary:** transparent with a Graticule border and Starlight Cream text; hover fills Horizon Haze and lightens the border to Zodiacal Gray.
- **Ghost:** Ember Clay text with no border; hover fills Ember Wash.
- **Danger:** Antares Red fill, On Ember text; only the confirming button of a destructive confirmation (`ConfirmButton` with `destructive`).
- **Disabled:** Horizon Haze fill, Zodiacal Gray text, no border, `not-allowed` cursor, and the reason in the tooltip. Unavailable actions stay visible.
- **Focus:** a 2 px Ember Clay outline offset by 2 px on `:focus-visible`, for every interactive element.

### Icon Buttons

28 px square, 6 px corners, a 17.5 px line icon in Moonlight. Hover fills Horizon Haze and turns the icon Starlight Cream; pressed (a toggle) is Ember Wash with an Ember Clay icon. The label is the tooltip and visually hidden text.

### Inputs / Fields

- **Style:** Twilight Ash fill, Graticule border, 6 px corners, 33.25 px tall, 12.25 px text, Zodiacal Gray placeholder; units (`mm`, `°`, `s`) sit inside the field at the right edge in caption size.
- **Label:** above the control, in the uppercase Label style in Moonlight.
- **Focus:** the border turns Ember Clay with a 2 px Ember Clay outline inset by 1 px.
- **Disabled:** Horizon Haze fill, Faint Meridian border, Zodiacal Gray text.
- **Segmented control:** joined segments sharing borders; the selected one is Ember Wash with an Ember Clay border and text.
- **Select:** the same field with a drawn chevron that turns Ember Clay when open; its listbox is a Float layer with section labels and a check mark for the selected entry.

### Status Badges

A pill 21 px tall with a one-pixel border tinted by its tone at 50–60 % opacity, caption text, and a 5.25 px dot: muted (dashed border, no dot), neutral, active (Ember Clay, pulsing dot), success, warning, danger. The word is always present.

### Cards / Containers

- **Tool card:** Deep Night fill, Faint Meridian border lightening to Graticule on hover, 10 px corners, 10.5 px padding, a 31.5 px Twilight Ash icon tile, a semibold title, a caption description, and an uppercase availability pill.
- **Panel sections:** no box at all; sections are separated by Faint Meridian lines with 14 × 10.5 px padding.
- **Modal:** Twilight Ash, Faint Meridian border, 24 px corners, Dialog shadow, 21 px padding, closing buttons in a wrapping row at the bottom right.

### Toasts

Floating notices stacked above the status bar at the bottom right, beside the docked contextual panel: Twilight Ash, Float shadow, 10 px corners, and a one-pixel border, Faint Meridian for a success and the tone at 50 % for a warning or an error, never a thicker edge. The severity leads as an uppercase Label word in its tone, with a count when notifications that read the same merge, then a semibold title and a Moonlight caption message, both wrapping. A toast that opens its context is one button with the row hover and a Zodiacal Gray "View" cue, so a routine success never shows Ember. They fade in over 150 ms, and the close button reads "Hide".

### Notification Panel

The bell's Float panel reads like a toast stack you can scroll: rows share the toasts' anatomy (severity Label first, ×N for merged notifications, a Starlight Cream "New" Label while unread, the Zodiacal Gray "View" cue only on rows that open their context) and end with the time of day and the age in a Zodiacal Gray caption. Unread warnings and errors lead under a "Needs you" section label, and the header says in words what needs the operator. The bell's badge takes the signal colour of the most pressing unread severity, never Ember, and its header actions are secondary buttons in a footer, the dismissal confirmed as destructive.

### Navigation

- **Top bar:** Deep Night, logo and wordmark, the Management menu, then the observing site, connection indicator, notifications, settings, and profile on the right.
- **Navigation rail:** Deep Night, one stacked icon and caption per workspace in Zodiacal Gray, Horizon Haze on hover; the active one is Ember Wash with an Ember Clay icon, a semibold caption, and a 3.5 px Ember Clay bar on its left edge. The About button is anchored at the bottom.
- **Status bar:** Deep Night, caption text in Moonlight, 24.5 px tall and 35 px below 640 px so a thumb can press it, every control pressed across its full height. Device chips and running operations are fitted to the room available, overflow counted on a details button. A chip's reading stays Moonlight while it is merely present; Aurora Green is kept for a good state (Tracking, Guiding) and Antares Red for a device of the setup that is not connected, which always says so in words.

### Collapsible Section and Data Rows (signature)

The contextual panel is a stack of collapsible sections: the heading is the toggle, an uppercase Label with a chevron that turns a quarter when open, and a one-line summary on the right while collapsed. Inside, every datum is a data row: the label in Zodiacal Gray on the left and the value in Starlight Cream with tabular figures pushed to the right, wrapping below the label when they do not fit. This pairing is the console's readout and the most repeated pattern in the app.

## Do's and Don'ts

### Do:

- **Do** use the colour tokens (`base-000`…`base-300`, `line-100`/`line-200`, `ink-100`…`ink-300`, `accent`, the four signals) and add a new token in `web/src/index.css` before using a new colour.
- **Do** keep Ember Clay to selection, focus, running state, and one primary action per group.
- **Do** write every state as a word and every quantity with its unit, with colour only reinforcing it.
- **Do** show every datum as a data row: muted label left, tabular value right.
- **Do** head every group with the uppercase 10.5 px Label (0.08em tracking).
- **Do** use 6 px corners on controls, 10 px on buttons and cards, 24 px only on modals.
- **Do** keep transitions at 150 ms on colour and honour `motion-reduce`.
- **Do** compose new screens from the primitives in `web/src/ui/` and the shell frame.

### Don't:

- **Don't** add a light theme, white panels, or large bright fills; the interface is used in the dark.
- **Don't** drift toward a neon sci-fi HUD: no glowing cyan or purple, scanlines, or space-game chrome.
- **Don't** bring in glossy consumer SaaS styling: no gradients, no big rounded cards with drop shadows, no marketing flourishes inside the app.
- **Don't** use cool blue-gray darks; every neutral stays warm.
- **Don't** put a shadow on anything that sits in the layout; shadows are only for floating layers.
- **Don't** add a second typeface.
- **Don't** let colour carry a state alone.
- **Don't** add a status surface, toolbar zone, or frame outside the fixed shell.
