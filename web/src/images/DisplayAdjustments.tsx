import type { DisplayScnr, DisplaySettings, DisplayStretch, ImageInfo, Stretch } from 'api'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import { applyDisplay, type DisplayStatus, displayStatus, editDisplay, type ImageViewState, imagesState, resetDisplay, revertDisplay, sameDisplaySettings, summaryStretch } from './images'

// Display Adjustments of the Image Inspector: the controls of a document's display pipeline (debayer,
// stretch, tone, color, invert). Controls only edit the pending settings; nothing renders until Apply
// to View, and the status tells whether the image shows the settings in the controls. Only the
// controls that apply to the image are shown: debayering for a mono image, color for an RGB rendering.

// CFA pattern choices: the image's own pattern, then every known pattern.
const PATTERN_OPTIONS = ['auto', 'RGGB', 'BGGR', 'GBRG', 'GRBG', 'GRGB', 'GBGR', 'RGBG', 'BGRG'] as const

// Pattern chosen when debayering is enabled for an image without a known pattern, shown in the control.
const FALLBACK_PATTERN = 'RGGB'

// Stretch modes, in selector order.
const STRETCH_MODES = ['auto', 'manual', 'linear'] as const satisfies readonly DisplayStretch['mode'][]

// Display names of the stretch modes.
const STRETCH_MODE_LABELS: Readonly<Record<DisplayStretch['mode'], string>> = { auto: 'Auto', manual: 'Manual', linear: 'Linear' }

// SCNR channels, in selector order.
const SCNR_CHANNELS = ['GREEN', 'RED', 'BLUE'] as const

// SCNR protection methods, in selector order.
const SCNR_METHODS = ['AVERAGE_NEUTRAL', 'MAXIMUM_NEUTRAL', 'MINIMUM_NEUTRAL', 'MAXIMUM_MASK', 'ADDITIVE_MASK'] as const

// SCNR applied when it is enabled: green cast removal at half strength.
const DEFAULT_SCNR: Extract<DisplayScnr, { enabled: true }> = { enabled: true, channel: 'GREEN', amount: 0.5, method: 'AVERAGE_NEUTRAL' }

// Stretch used for a manual stretch when no rendering exists yet: the identity.
const IDENTITY_STRETCH: Stretch = { midtone: 0.5, shadow: 0, highlight: 1 }

// Label and color of each display status.
const STATUS: Readonly<Record<DisplayStatus, readonly [label: string, className: string]>> = {
	applied: ['Applied', 'text-success'],
	'not-applied': ['Not Applied', 'text-accent'],
	processing: ['Processing', 'text-ink-200'],
	error: ['Error', 'text-danger'],
}

export interface DisplayAdjustmentsProps {
	// Key of the document.
	readonly documentKey: string
	// Opened image of the document.
	readonly info: ImageInfo
	// View state of the document.
	readonly view: ImageViewState
}

// Display Adjustments section of a document.
export function DisplayAdjustments({ documentKey, info, view }: DisplayAdjustmentsProps) {
	const settings = view.display.pending
	const status = displayStatus(view)
	const [statusLabel, statusClassName] = STATUS[status]
	const mono = info.channels === 1
	const color = info.channels === 3 || (mono && settings.debayer.enabled)
	const invalid = settings.stretch.mode === 'manual' && settings.stretch.stretch.shadow > settings.stretch.stretch.highlight

	function edit(patch: Partial<DisplaySettings>) {
		editDisplay(imagesState, documentKey, { ...settings, ...patch })
	}

	function editStretch(stretch: Partial<Stretch>) {
		if (settings.stretch.mode === 'manual') edit({ stretch: { mode: 'manual', stretch: { ...settings.stretch.stretch, ...stretch } } })
	}

	function selectMode(mode: DisplayStretch['mode']) {
		if (mode === 'auto') edit({ stretch: { mode, linked: true } })
		else if (mode === 'manual') edit({ stretch: { mode, stretch: view.rendering ? summaryStretch(view.rendering.result) : IDENTITY_STRETCH } })
		else edit({ stretch: { mode } })
	}

	return (
		<PanelSection title="Display Adjustments">
			<div className="flex items-center justify-between">
				<span className="text-xs text-ink-300">Status</span>
				<span className={cn('text-xs font-medium', statusClassName)}>{statusLabel}</span>
			</div>
			{status === 'error' && view.error && <p className="m-0 text-xs text-danger">{view.error}</p>}

			{mono && (
				<Group title="Debayer">
					<Checkbox label="Enabled" checked={settings.debayer.enabled} onChange={(enabled) => edit({ debayer: enabled ? { enabled, pattern: info.cfa ? 'auto' : FALLBACK_PATTERN } : { enabled } })} />
					{settings.debayer.enabled && (
						<>
							<Select
								label="Pattern"
								options={PATTERN_OPTIONS}
								value={settings.debayer.pattern}
								format={(p) => (p === 'auto' ? `Auto${info.cfa ? ` (${info.cfa})` : ''}` : p)}
								disabledReason={(p) => (p === 'auto' && !info.cfa ? 'The header has no known CFA pattern.' : undefined)}
								onChange={(pattern) => edit({ debayer: { enabled: true, pattern } })}
							/>
							{!info.cfa && <p className="m-0 text-xs text-ink-300">The header has no known CFA pattern; check that the chosen one matches the sensor.</p>}
						</>
					)}
				</Group>
			)}

			<Group title="Stretch">
				<Select label="Mode" options={STRETCH_MODES} value={settings.stretch.mode} format={(m) => STRETCH_MODE_LABELS[m]} onChange={selectMode} />
				{settings.stretch.mode === 'auto' && color && <Checkbox label="Linked channels" checked={settings.stretch.linked} onChange={(linked) => edit({ stretch: { mode: 'auto', linked } })} />}
				{settings.stretch.mode === 'manual' && (
					<>
						<Slider label="Shadow" min={0} max={1} step={0.0001} value={settings.stretch.stretch.shadow} onChange={(shadow) => editStretch({ shadow })} />
						<Slider label="Midtone" min={0} max={1} step={0.0001} value={settings.stretch.stretch.midtone} onChange={(midtone) => editStretch({ midtone })} />
						<Slider label="Highlight" min={0} max={1} step={0.0001} value={settings.stretch.stretch.highlight} onChange={(highlight) => editStretch({ highlight })} />
						{invalid && <p className="m-0 text-xs text-danger">Shadow must not exceed highlight.</p>}
					</>
				)}
			</Group>

			<Group title="Brightness & Contrast">
				<Slider label="Brightness" min={0} max={3} step={0.01} value={settings.brightness} onChange={(brightness) => edit({ brightness })} />
				<Slider label="Contrast" min={0} max={3} step={0.01} value={settings.contrast} onChange={(contrast) => edit({ contrast })} />
				<Slider label="Gamma" min={0.1} max={5} step={0.01} value={settings.gamma} onChange={(gamma) => edit({ gamma })} />
			</Group>

			{color && (
				<Group title="Color">
					<Slider label="Saturation" min={0} max={3} step={0.01} value={settings.saturation} onChange={(saturation) => edit({ saturation })} />
					<Checkbox label="Remove color cast (SCNR)" checked={settings.scnr.enabled} onChange={(enabled) => edit({ scnr: enabled ? DEFAULT_SCNR : { enabled } })} />
					{settings.scnr.enabled && <ScnrControls scnr={settings.scnr} onChange={(scnr) => edit({ scnr })} />}
				</Group>
			)}

			<Group title="Additional">
				<Checkbox label="Invert" checked={settings.invert} onChange={(invert) => edit({ invert })} />
			</Group>

			<div className="mt-1 flex flex-wrap gap-2">
				<Button size="sm" disabled={status === 'processing' || invalid} onClick={() => void applyDisplay(imagesState, documentKey)}>
					Apply to View
				</Button>
				<Button size="sm" variant="secondary" disabled={!view.display.applied || sameDisplaySettings(settings, view.display.applied)} onClick={() => revertDisplay(imagesState, documentKey)}>
					Revert Changes
				</Button>
				<Button size="sm" variant="secondary" onClick={() => resetDisplay(imagesState, documentKey)}>
					Reset Parameters
				</Button>
			</div>
		</PanelSection>
	)
}

interface GroupProps {
	// Group heading.
	readonly title: string
	// Controls of the group.
	readonly children: ReactNode
}

// Titled group of related controls inside the section.
function Group({ title, children }: GroupProps) {
	return (
		<div className="flex flex-col gap-2 border-t border-line-100 pt-2">
			<h4 className="m-0 text-xs font-medium text-ink-100">{title}</h4>
			{children}
		</div>
	)
}

interface ScnrControlsProps {
	// Enabled SCNR settings.
	readonly scnr: Extract<DisplayScnr, { enabled: true }>
	// Called with the edited SCNR settings.
	readonly onChange: (scnr: Extract<DisplayScnr, { enabled: true }>) => void
}

// Channel, method, and amount of an enabled SCNR.
function ScnrControls({ scnr, onChange }: ScnrControlsProps) {
	return (
		<>
			<Select label="Channel" options={SCNR_CHANNELS} value={scnr.channel} format={(c) => c[0] + c.slice(1).toLowerCase()} onChange={(channel) => onChange({ ...scnr, channel })} />
			<Select label="Protection" options={SCNR_METHODS} value={scnr.method} format={(m) => m.replace('_', ' ').toLowerCase()} onChange={(method) => onChange({ ...scnr, method })} />
			<Slider label="Amount" min={0} max={1} step={0.01} value={scnr.amount} onChange={(amount) => onChange({ ...scnr, amount })} />
		</>
	)
}
