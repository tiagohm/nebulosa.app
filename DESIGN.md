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
    axis-1: 'oklch(0.72 0.08 245)'
    axis-2: 'oklch(0.72 0.08 330)'
    channel-red: 'oklch(0.7 0.09 28)'
    channel-green: 'oklch(0.74 0.09 150)'
    channel-blue: 'oklch(0.72 0.085 250)'
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
        size: '33.25px'
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

<!-- impeccable:design-map -->

Name: Nebulosa
Colors: primary: accent #d97757; neutral: base-000 #141413; signal: danger #e5675e; map: map-horizon oklch(0.6 0.08 40); primary: accent-hover #e3896b; primary: accent-subtle #3a2620 (+23 more in the sidecar)
Fonts: JetBrains Mono (headline, readout, wordmark, title, body, body-dense, label, caption)
Spacing: xs 3.5px, sm 7px, md 10.5px, lg 14px, xl 21px
Radius: sm 6px, md 10px, lg 16px, xl 24px, full 9999px
North Star: "The Observatory Console"
Rules:

- The One Ember Rule. Ember Clay marks what is chosen, focused, running, or the one primary action.
- The Warm Dark Rule. Every neutral is warm.
- The Words First Rule. A signal colour never carries a state alone: the state is a word (Connected, Slewing, Failed) and the colour only tints it.
- The One Voice Rule. JetBrains Mono is the only typeface.
- The Aligned Digits Rule. Every value that can change or be compared (coordinates, temperatures, counts, times, table numbers) uses tabular figures and is right-aligned against its label.
- The Fixed Frame Rule. Status lives in the status bar, navigation in the rail, context in the right panel.
- The Flat Desk Rule. Anything that sits in the layout is flat.

Elevation:

- Float: 0 12px 32px rgb(0 0 0 / 0.45)
- Dialog: 0 24px 64px rgb(0 0 0 / 0.55)
- Drawer: -16px 0 48px rgb(0 0 0 / 0.45)

Don't:

- Don't add a light theme, white panels, or large bright fills; the interface is used in the dark.
- Don't drift toward a neon sci-fi HUD: no glowing cyan or purple, scanlines, or space-game chrome.
- Don't bring in glossy consumer SaaS styling: no gradients, no big rounded cards with drop shadows, no marketing flourishes inside the app.
- Don't use cool blue-gray darks; every neutral stays warm.
- Don't put a shadow on anything that sits in the layout; shadows are only for floating layers.
- Don't add a second typeface.
- Don't let colour carry a state alone.
- Don't add a status surface, toolbar zone, or frame outside the fixed shell.

Do:

- Do use the colour tokens (`base-000`…`base-300`, `line-100`/`line-200`, `ink-100`…`ink-300`, `accent`, the four signals) and add a new token in `web/src/index.css` before using a new colour.
- (+7 more)

Map: web/src/sky/palette.ts
Map: web/src/index.css
Map: web/src/ui/
Full: .impeccable/design-full.md (read a section when you need its detail)
