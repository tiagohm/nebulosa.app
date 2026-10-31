import type { DisplaySettings, DisplayStretch, ImageInfo, RenderResult, Stretch } from 'api'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { IconButton } from '../ui/IconButton'
import { Popover } from '../ui/Popover'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import { AUTO_STRETCH_PRESETS, type AutoStretchPreset, CFA_PATTERNS, type CfaPatternChoice, DEFAULT_AUTO_STRETCH_PRESET, DISPLAY_RANGES, type DisplaySection, type EnabledScnr, ORIGINAL_DISPLAY_SETTINGS, SCNR_CHANNELS, SCNR_METHODS, sectionPatch, STRETCH_MODES } from './display'
import { applyDisplay, copySettings, currentDisplaySettings, type ImageViewState, imagesState, isMosaic, summaryStretch } from './images'

// Display controls of the viewer toolbar of an image document: Debayer, Stretch, Brightness & Contrast, and Color
// open a popup each, and Invert is a toggle. Debayer and Invert apply as soon as they change; Stretch, Brightness &
// Contrast, and Color edit a draft started from the applied settings each time their popup opens, applied to the view
// only by their Apply to View and discarded when it closes, and Reset Parameters restores the neutral values in the
// draft without applying them. Every apply patches only its own settings (applyDisplay), and the settings applied are
// saved in the profile. Debayer is disabled for an image that is not a CFA mosaic, and Color for a grayscale
// rendering; everything is disabled until the document is first rendered.

// Popup of the toolbar: Debayer, or one of the sections applied with Apply to View.
type DisplayPopup = 'debayer' | DisplaySection

// CFA pattern choices: the image's own pattern, then every known pattern.
const PATTERN_OPTIONS = ['auto', ...CFA_PATTERNS] as const

// Pattern chosen when debayering is enabled for an image without a trusted pattern, shown in the control.
const FALLBACK_PATTERN: CfaPatternChoice = 'RGGB'

// Display names of the stretch modes.
const STRETCH_MODE_LABELS: Readonly<Record<DisplayStretch['mode'], string>> = { auto: 'Auto', manual: 'Manual', linear: 'Linear' }

// Display names of the auto stretch profiles.
const AUTO_STRETCH_PRESET_LABELS: Readonly<Record<AutoStretchPreset, string>> = { low: 'Low', medium: 'Medium', high: 'High', moon: 'Moon', planet: 'Planet' }

// SCNR applied when it is enabled: green cast removal at half strength.
const DEFAULT_SCNR: EnabledScnr = { enabled: true, channel: 'GREEN', amount: 0.5, method: 'AVERAGE_NEUTRAL' }

// Stretch used for a manual stretch when no rendering exists yet: the identity.
const IDENTITY_STRETCH: Stretch = { midtone: 0.5, shadow: 0, highlight: 1 }

export interface DisplayToolbarProps {
	// Key of the document.
	readonly documentKey: string
	// Opened image of the document; absent while it opens or before a camera tab's first frame.
	readonly info?: ImageInfo
	// View state of the document.
	readonly view: ImageViewState
}

// Display controls of a document in the viewer toolbar.
export function DisplayToolbar({ documentKey, info, view }: DisplayToolbarProps) {
	const [popup, setPopup] = useState<DisplayPopup>()
	const applied = view.display.applied
	const rendering = view.rendering?.result
	const ready = info !== undefined && applied !== undefined
	const color = ready && (info.channels === 3 || (info.channels === 1 && applied.debayer.enabled))

	function apply(patch: Partial<DisplaySettings>) {
		void applyDisplay(imagesState, documentKey, patch)
	}

	// Returns the props that make a popover show one popup of the toolbar at a time.
	function popover(id: DisplayPopup) {
		return { open: popup === id, onOpenChange: (open: boolean) => setPopup(open ? id : undefined) }
	}

	return (
		<>
			<Popover icon="debayer" label="Debayer" disabled={!ready || !isMosaic(info)} {...popover('debayer')}>
				{ready && <DebayerControls info={info} applied={applied} onApply={apply} />}
			</Popover>
			<Popover icon="stretch" label="Stretch" disabled={!ready} {...popover('stretch')}>
				{ready && <StretchControls applied={applied} color={color} rendering={rendering} onApply={apply} />}
			</Popover>
			<Popover icon="contrast" label="Brightness & Contrast" disabled={!ready} {...popover('tone')}>
				{ready && <ToneControls applied={applied} onApply={apply} />}
			</Popover>
			<Popover icon="color" label="Color" disabled={!color} {...popover('color')}>
				{ready && <ColorControls applied={applied} onApply={apply} />}
			</Popover>
			<IconButton
				icon="invert"
				label="Invert"
				pressed={applied?.invert === true}
				disabled={!ready}
				onClick={() => {
					const current = currentDisplaySettings(imagesState, documentKey)
					if (current) apply({ invert: !current.invert })
				}}
			/>
		</>
	)
}

interface DebayerControlsProps {
	// Opened image, a CFA mosaic.
	readonly info: ImageInfo
	// Applied display settings.
	readonly applied: DisplaySettings
	// Applies a patch of display settings.
	readonly onApply: (patch: Partial<DisplaySettings>) => void
}

// Debayering of a mosaic, applied as soon as it changes: whether it is debayered, and with which pattern.
function DebayerControls({ info, applied, onApply }: DebayerControlsProps) {
	const { debayer } = applied

	return (
		<>
			<Checkbox label="Enabled" checked={debayer.enabled} onChange={(enabled) => onApply({ debayer: enabled ? { enabled, pattern: info.cfa ? 'auto' : FALLBACK_PATTERN } : { enabled } })} />
			{debayer.enabled && (
				<>
					<Select
						label="Pattern"
						options={PATTERN_OPTIONS}
						value={debayer.pattern}
						format={(p) => (p === 'auto' ? `Auto${info.cfa ? ` (${info.cfa})` : ''}` : p)}
						disabledReason={(p) => (p === 'auto' && !info.cfa ? 'The header has no known CFA pattern.' : undefined)}
						onChange={(pattern) => onApply({ debayer: { enabled: true, pattern } })}
					/>
					{!info.cfa && <p className="m-0 text-xs text-ink-300">The header has no known CFA pattern; check that the chosen one matches the sensor.</p>}
				</>
			)}
		</>
	)
}

interface SectionControlsProps {
	// Applied display settings, which the draft starts from.
	readonly applied: DisplaySettings
	// Applies a patch of display settings.
	readonly onApply: (patch: Partial<DisplaySettings>) => void
}

// Returns the draft of a section popup, started from the applied settings when the popup opens, and a function that
// replaces some of its fields.
function useDraft(applied: DisplaySettings) {
	const [draft, setDraft] = useState(() => copySettings(applied))
	return [draft, (patch: Partial<DisplaySettings>) => setDraft({ ...draft, ...patch })] as const
}

interface SectionActionsProps {
	// Section the popup edits.
	readonly section: DisplaySection
	// Draft of the popup.
	readonly draft: DisplaySettings
	// Replaces fields of the draft.
	readonly edit: (patch: Partial<DisplaySettings>) => void
	// Applies a patch of display settings.
	readonly onApply: (patch: Partial<DisplaySettings>) => void
	// Whether the draft cannot be applied.
	readonly invalid?: boolean
}

// Apply to View, which applies the section of the draft, and Reset Parameters, which restores its neutral values in
// the draft.
function SectionActions({ section, draft, edit, onApply, invalid = false }: SectionActionsProps) {
	return (
		<div className="mt-1 flex flex-wrap gap-2">
			<Button disabled={invalid} onClick={() => onApply(sectionPatch(draft, section))}>
				Apply to View
			</Button>
			<Button variant="secondary" onClick={() => edit(sectionPatch(ORIGINAL_DISPLAY_SETTINGS, section))}>
				Reset Parameters
			</Button>
		</div>
	)
}

interface StretchControlsProps extends SectionControlsProps {
	// Whether the image is rendered in color, which offers unlinked channels.
	readonly color: boolean
	// Parameters of the current rendering, which a manual stretch starts from.
	readonly rendering?: RenderResult
}

// Stretch popup: the mode and, for an auto stretch, its profile and channel linking or, for a manual stretch, its levels.
function StretchControls({ applied, color, rendering, onApply }: StretchControlsProps) {
	const [draft, edit] = useDraft(applied)
	const { stretch } = draft
	const invalid = stretch.mode === 'manual' && stretch.stretch.shadow > stretch.stretch.highlight

	function editLevels(levels: Partial<Stretch>) {
		if (stretch.mode === 'manual') edit({ stretch: { mode: 'manual', stretch: { ...stretch.stretch, ...levels } } })
	}

	function selectMode(mode: DisplayStretch['mode']) {
		if (mode === 'auto') edit({ stretch: { mode, preset: DEFAULT_AUTO_STRETCH_PRESET, linked: true } })
		else if (mode === 'manual') edit({ stretch: { mode, stretch: rendering ? summaryStretch(rendering) : IDENTITY_STRETCH } })
		else edit({ stretch: { mode } })
	}

	return (
		<>
			<Select label="Mode" options={STRETCH_MODES} value={stretch.mode} format={(m) => STRETCH_MODE_LABELS[m]} onChange={selectMode} />
			{stretch.mode === 'auto' && <SegmentedControl label="Preset" className="[&_button]:px-0.5" options={AUTO_STRETCH_PRESETS} value={stretch.preset} format={(p) => AUTO_STRETCH_PRESET_LABELS[p]} onChange={(preset) => edit({ stretch: { ...stretch, preset } })} />}
			{stretch.mode === 'auto' && color && <Checkbox label="Linked channels" checked={stretch.linked} onChange={(linked) => edit({ stretch: { ...stretch, linked } })} />}
			{stretch.mode === 'manual' && (
				<>
					<Slider label="Shadow" {...DISPLAY_RANGES.stretch} value={stretch.stretch.shadow} onChange={(shadow) => editLevels({ shadow })} />
					<Slider label="Midtone" {...DISPLAY_RANGES.stretch} value={stretch.stretch.midtone} onChange={(midtone) => editLevels({ midtone })} />
					<Slider label="Highlight" {...DISPLAY_RANGES.stretch} value={stretch.stretch.highlight} onChange={(highlight) => editLevels({ highlight })} />
					{invalid && <p className="m-0 text-xs text-danger">Shadow must not exceed highlight.</p>}
				</>
			)}
			<SectionActions section="stretch" draft={draft} edit={edit} onApply={onApply} invalid={invalid} />
		</>
	)
}

// Brightness & Contrast popup: brightness, contrast, and gamma.
function ToneControls({ applied, onApply }: SectionControlsProps) {
	const [draft, edit] = useDraft(applied)

	return (
		<>
			<Slider label="Brightness" {...DISPLAY_RANGES.brightness} value={draft.brightness} onChange={(brightness) => edit({ brightness })} />
			<Slider label="Contrast" {...DISPLAY_RANGES.contrast} value={draft.contrast} onChange={(contrast) => edit({ contrast })} />
			<Slider label="Gamma" {...DISPLAY_RANGES.gamma} value={draft.gamma} onChange={(gamma) => edit({ gamma })} />
			<SectionActions section="tone" draft={draft} edit={edit} onApply={onApply} />
		</>
	)
}

// Color popup: saturation and the removal of a color cast (SCNR).
function ColorControls({ applied, onApply }: SectionControlsProps) {
	const [draft, edit] = useDraft(applied)
	const { scnr } = draft

	return (
		<>
			<Slider label="Saturation" {...DISPLAY_RANGES.saturation} value={draft.saturation} onChange={(saturation) => edit({ saturation })} />
			<Checkbox label="Remove color cast (SCNR)" checked={scnr.enabled} onChange={(enabled) => edit({ scnr: enabled ? DEFAULT_SCNR : { enabled } })} />
			{scnr.enabled && <ScnrControls scnr={scnr} onChange={(next) => edit({ scnr: next })} />}
			<SectionActions section="color" draft={draft} edit={edit} onApply={onApply} />
		</>
	)
}

interface ScnrControlsProps {
	// Enabled SCNR settings.
	readonly scnr: EnabledScnr
	// Called with the edited SCNR settings.
	readonly onChange: (scnr: EnabledScnr) => void
}

// Channel, method, and amount of an enabled SCNR.
function ScnrControls({ scnr, onChange }: ScnrControlsProps) {
	return (
		<>
			<Select label="Channel" options={SCNR_CHANNELS} value={scnr.channel} format={(c) => c[0] + c.slice(1).toLowerCase()} onChange={(channel) => onChange({ ...scnr, channel })} />
			<Select label="Protection" options={SCNR_METHODS} value={scnr.method} format={(m) => m.replace('_', ' ').toLowerCase()} onChange={(method) => onChange({ ...scnr, method })} />
			<Slider label="Amount" {...DISPLAY_RANGES.scnrAmount} value={scnr.amount} onChange={(amount) => onChange({ ...scnr, amount })} />
		</>
	)
}
