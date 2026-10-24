import type { PlateSolveHints, PlateSolveRequest, PlateSolverProvider, PlateSolveStrategy, ResolvedPlateSolveHints } from 'api'
import { arcsec, deg, parseAngle, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Notice } from '../equipment-control/parts'
import { externalToolsState } from '../settings/externaltools'
import { summaryOf } from '../settings/ExternalToolStatus'
import { navigate, routeState } from '../shell/route'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { PROVIDER_LABELS, PROVIDER_TOOLS, PROVIDERS } from './platesolving'

// Controls of a plate solving request of the Plate Solver tool of the Images workspace: the solver with its availability in External Tools, the strategy, the hints, and the
// advanced settings the chosen solver takes. They edit a request through onChange and solve nothing. Hints left empty
// are taken from the image on the server; the values the image offers are shown as placeholders when known. Right
// ascension is typed in hours and declination in degrees (sexagesimal or decimal), the radius in degrees and the scale
// in arcseconds per pixel; the request holds radians.

export interface PlateSolveControlsProps {
	// Request edited.
	readonly request: PlateSolveRequest
	// Called with the edited request.
	readonly onChange: (request: PlateSolveRequest) => void
	// Hints the image offers, shown as placeholders.
	readonly offered?: ResolvedPlateSolveHints
	// Whether the controls are locked, such as during a capture.
	readonly disabled?: boolean
}

// Display names of the strategies.
const STRATEGY_LABELS: Readonly<Record<PlateSolveStrategy, string>> = { assisted: 'Assisted', blind: 'Blind' }

// Strategies, in selector order.
const STRATEGIES: readonly PlateSolveStrategy[] = ['assisted', 'blind']

// Whether the External Tools entry of a solver is configured (nova: signed in), from the server's settings.
export function useSolverConfigured(provider: PlateSolverProvider): boolean {
	const { tools } = useSnapshot(externalToolsState)
	return tools.find((tool) => tool.id === PROVIDER_TOOLS[provider])?.status === 'configured'
}

// Choice of the solver, with its availability.
export function SolverControls({ request, onChange, disabled }: PlateSolveControlsProps) {
	return (
		<>
			<Select options={PROVIDERS} value={request.provider} format={(provider) => PROVIDER_LABELS[provider]} disabled={disabled} onChange={(provider) => onChange({ ...request, provider })} />
			<SolverAvailability provider={request.provider} />
			{request.provider === 'nova' && <Notice>This provider uploads the scientific image to an external service.</Notice>}
		</>
	)
}

// Whether a solver can be used, as the server's External Tools settings report it, with a link to them.
function SolverAvailability({ provider }: { readonly provider: PlateSolverProvider }) {
	const { tools } = useSnapshot(externalToolsState)
	const tool = tools.find((t) => t.id === PROVIDER_TOOLS[provider])
	const summary = tool && summaryOf(tool)

	return (
		<div className="flex flex-col gap-1">
			<p className="m-0 text-xs leading-4 text-ink-300">
				{tool?.name ?? PROVIDER_LABELS[provider]}: <span className={summary?.className}>{tool?.session && tool.status !== 'configured' ? 'Not Signed In' : (summary?.label ?? 'Loading…')}</span>
				{tool?.lastCheck && tool.lastCheck.status !== 'available' && ` — ${tool.lastCheck.message}`}
			</p>
			<Button variant="ghost" className="self-start px-1" onClick={() => navigate(routeState, { workspace: 'settings', tool: PROVIDER_TOOLS[provider] })}>
				Settings → External Tools → {tool?.name ?? PROVIDER_LABELS[provider]}
			</Button>
		</div>
	)
}

// Choice of the strategy.
export function StrategyControls({ request, onChange, disabled }: PlateSolveControlsProps) {
	return (
		<>
			<SegmentedControl options={STRATEGIES} value={request.strategy} format={(strategy) => STRATEGY_LABELS[strategy]} disabled={disabled} onChange={(strategy) => onChange({ ...request, strategy })} />
			<Notice>{request.strategy === 'assisted' ? 'Searches around the position of the hints or of the image header.' : 'Searches the whole sky; a known image scale is still used. Success depends on the index files or the star database of the solver.'}</Notice>
		</>
	)
}

// Hints of the request: the position (assisted only), the search radius, and the image scale.
export function HintControls({ request, onChange, offered, disabled }: PlateSolveControlsProps) {
	const hints = request.hints ?? {}
	const edit = (patch: Partial<PlateSolveHints>) => onChange({ ...request, hints: withoutEmpty({ ...hints, ...patch }) })
	const offeredScale = offered?.scale && `${toArcsec(offered.scale.value).toFixed(3)} (${offered.scale.source})`

	return (
		<>
			{request.strategy === 'assisted' && (
				<>
					<AngleField label="Approximate RA" hour value={hints.rightAscension} placeholder={offered?.rightAscension && formatRightAscension(offered.rightAscension.value)} disabled={disabled} onChange={(rightAscension) => edit({ rightAscension })} />
					<AngleField label="Approximate Dec" value={hints.declination} placeholder={offered?.declination && formatDeclination(offered.declination.value)} disabled={disabled} onChange={(declination) => edit({ declination })} />
					<NumberInput label="Search Radius" suffix="°" min={0} max={180} step={0.5} value={hints.radius === undefined ? 0 : toDeg(hints.radius)} disabled={disabled} onChange={(degrees) => edit({ radius: degrees > 0 ? deg(degrees) : undefined })} />
				</>
			)}
			<NumberInput label="Pixel Scale" suffix="″/px" min={0} step={0.01} value={hints.scale === undefined ? 0 : toArcsec(hints.scale)} disabled={disabled} onChange={(seconds) => edit({ scale: seconds > 0 ? arcsec(seconds) : undefined })} />
			<Notice>
				Empty fields and 0 are taken from the image: {offered?.rightAscension ? `the header pointing (${offered.rightAscension.source})` : 'no pointing'}, {offeredScale ? `a scale of ${offeredScale} ″/px` : 'no scale'}. A position without a radius is searched within 10°.
			</Notice>
		</>
	)
}

// Advanced settings the chosen solver takes: downsampling, and the scale tolerance of nova.
export function AdvancedControls({ request, onChange, disabled }: PlateSolveControlsProps) {
	return (
		<>
			<NumberInput label="Downsample" min={0} max={16} step={1} value={request.downsample ?? 0} disabled={disabled} onChange={(downsample) => onChange({ ...request, downsample: downsample > 0 ? Math.trunc(downsample) : undefined })} />
			{request.provider === 'nova' && <NumberInput label="Scale Tolerance" suffix="%" min={1} max={90} step={1} value={(request.scaleTolerance ?? 0.2) * 100} disabled={disabled} onChange={(percent) => onChange({ ...request, scaleTolerance: percent / 100 })} />}
			<Notice>Downsample 0 lets the solver choose. The solution is always given for the full-size image.</Notice>
		</>
	)
}

interface AngleFieldProps {
	// Label of the field.
	readonly label: string
	// Whether the angle is typed in hours.
	readonly hour?: boolean
	// Angle, radians; absent when empty.
	readonly value?: number
	// Text shown while empty.
	readonly placeholder?: string
	// Whether the field is locked.
	readonly disabled?: boolean
	// Called with the parsed angle, radians, or undefined when emptied.
	readonly onChange: (value: number | undefined) => void
}

// Text field of an angle, parsed when it loses the focus; an unreadable text is kept and reported.
function AngleField({ label, hour = false, value, placeholder, disabled, onChange }: AngleFieldProps) {
	const [text, setText] = useState(() => formatHint(value, hour))
	const [invalid, setInvalid] = useState(false)

	// Follows a value changed elsewhere, such as a reset of the request.
	useEffect(() => {
		setText(formatHint(value, hour))
		setInvalid(false)
	}, [value, hour])

	function commit() {
		if (!text.trim()) {
			setInvalid(false)
			onChange(undefined)
			return
		}

		const angle = parseAngle(text, hour ? true : undefined)
		const valid = angle !== undefined && Number.isFinite(angle) && (hour || Math.abs(angle) <= Math.PI / 2)
		setInvalid(!valid)
		if (valid) onChange(angle)
	}

	return (
		<>
			<TextInput label={label} placeholder={placeholder ?? (hour ? 'From the header, such as 10h 44m 03s' : 'From the header, such as -59° 41′')} spellCheck={false} autoComplete="off" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} />
			{invalid && <Notice error>Unreadable {hour ? 'right ascension' : 'declination'}.</Notice>}
		</>
	)
}

// Formats an angle hint for its field: hours for a right ascension, degrees otherwise; empty when absent.
function formatHint(angle: number | undefined, hour: boolean) {
	return angle === undefined ? '' : hour ? formatRightAscension(angle) : formatDeclination(angle)
}

// Returns hints without the absent ones.
function withoutEmpty(hints: PlateSolveHints): PlateSolveHints {
	return Object.fromEntries(Object.entries(hints).filter(([, value]) => value !== undefined))
}
