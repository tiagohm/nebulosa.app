import type { PlateSolveHints, PlateSolveRequest, PlateSolveStrategy, ResolvedPlateSolveHints } from 'api'
import { arcsec, deg, parseAngle, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatFixed } from '../format'
import { externalToolsState } from '../settings/externaltools'
import { summaryOf } from '../settings/ExternalToolStatus'
import { navigate, routeState } from '../shell/route'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { LinkButton } from '../ui/LinkButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { TextInput } from '../ui/TextInput'
import { formatPixelScale } from './coordinates'
import { STRATEGY_LABELS } from './platesolving'

// Controls of a plate solving request of the Plate Solver tool of the Images workspace: the state of the solver in
// External Tools, the strategy, the hints, and the scale tolerance, with the one-line summary of each a collapsed section
// shows. They edit a request through onChange and solve nothing. Hints left empty
// are taken from the image on the server; the values the image offers are shown as placeholders when known. A position
// is used only when both of its coordinates are typed. Right ascension is typed in hours and declination in degrees
// (sexagesimal or decimal), the radius in degrees and the scale in arcseconds per pixel; the request holds radians.

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

// Scale tolerance of the solver when the request leaves it out, as a fraction of the pixel scale.
const DEFAULT_SCALE_TOLERANCE = 0.2

// External Tools entry of the solver, for its state and its settings link.
const SOLVER_TOOL = 'nebulosa'

// Strategies, in selector order.
const STRATEGIES: readonly PlateSolveStrategy[] = ['assisted', 'blind']

// Returns the state of the solver as External Tools shows it ("Available", "No Indexes"), or Loading… before the
// settings arrive.
export function useSolverState(): string {
	const { tools } = useSnapshot(externalToolsState)
	const tool = tools.find((t) => t.id === SOLVER_TOOL)
	return tool ? summaryOf(tool).label : 'Loading…'
}

// State of the solver, as the server's External Tools settings report it for its index files, with a link to them.
export function SolverAvailability() {
	const { tools } = useSnapshot(externalToolsState)
	const tool = tools.find((t) => t.id === SOLVER_TOOL)
	const summary = tool && summaryOf(tool)

	return (
		<Notice>
			{tool?.name ?? 'Nebulosa'}:{' '}
			<span className={summary?.className} title={summary?.hint}>
				{summary?.label ?? 'Loading…'}
			</span>
			{tool?.lastCheck && tool.lastCheck.code !== 'ok' && ` — ${tool.lastCheck.message}`}.{' '}
			<LinkButton title="Settings → External Tools" onClick={() => navigate(routeState, { workspace: 'settings', tool: SOLVER_TOOL })}>
				Open its settings
			</LinkButton>
		</Notice>
	)
}

// Choice of the strategy.
export function StrategyControls({ request, onChange, disabled }: PlateSolveControlsProps) {
	return (
		<>
			<SegmentedControl options={STRATEGIES} value={request.strategy} format={(strategy) => STRATEGY_LABELS[strategy]} disabled={disabled} onChange={(strategy) => onChange({ ...request, strategy })} />
			<Notice>{request.strategy === 'assisted' ? 'Searches around the position of the hints or of the image header.' : 'Searches the whole sky; a known image scale is still used. Success depends on the index files of the solver.'}</Notice>
		</>
	)
}

// Returns the one-line summary of the hints of a request: what it gives ("Position · 2.0° · 1.230″/px"), or that they
// all come from the image.
export function hintsSummary({ strategy, hints = {} }: Pick<PlateSolveRequest, 'strategy' | 'hints'>): string {
	const assisted = strategy === 'assisted'
	const parts = [assisted && hints.rightAscension !== undefined && hints.declination !== undefined ? 'Position' : undefined, assisted && hints.radius !== undefined ? `${formatFixed(toDeg(hints.radius), 1)}°` : undefined, hints.scale === undefined ? undefined : formatPixelScale(hints.scale)].filter(
		(part) => part !== undefined,
	)
	return parts.length > 0 ? parts.join(' · ') : 'From the image'
}

// Returns the one-line summary of the advanced settings of a request: its scale tolerance.
export function advancedSummary({ scaleTolerance }: Pick<PlateSolveRequest, 'scaleTolerance'>): string {
	return `Tolerance ${Math.round((scaleTolerance ?? DEFAULT_SCALE_TOLERANCE) * 100)} %`
}

// Hints of the request: the position (assisted only), the search radius, and the image scale.
export function HintControls({ request, onChange, offered, disabled }: PlateSolveControlsProps) {
	const hints = request.hints ?? {}
	const edit = (patch: Partial<PlateSolveHints>) => onChange({ ...request, hints: withoutEmpty({ ...hints, ...patch }) })
	const offeredScale = offered?.scale && `${formatPixelScale(offered.scale.value)} (${offered.scale.source})`
	// Only one coordinate of the position typed, which the server ignores.
	const half = (hints.rightAscension === undefined) !== (hints.declination === undefined)

	return (
		<>
			{request.strategy === 'assisted' && (
				<>
					<AngleField label="Approximate RA" hour value={hints.rightAscension} placeholder={offered?.rightAscension && formatRightAscension(offered.rightAscension.value)} disabled={disabled} onChange={(rightAscension) => edit({ rightAscension })} />
					<AngleField label="Approximate Dec" value={hints.declination} placeholder={offered?.declination && formatDeclination(offered.declination.value)} disabled={disabled} onChange={(declination) => edit({ declination })} />
					{half && <Notice warning>Type both RA and Dec: with only one, {offered?.rightAscension ? 'the header pointing is searched' : 'the whole sky is searched'}.</Notice>}
					<NumberInput label="Search Radius" suffix="°" min={0} max={180} step={0.5} value={hints.radius === undefined ? 0 : toDeg(hints.radius)} disabled={disabled} onChange={(degrees) => edit({ radius: degrees > 0 ? deg(degrees) : undefined })} />
				</>
			)}
			<NumberInput label="Pixel Scale" suffix="″/px" min={0} step={0.01} value={hints.scale === undefined ? 0 : toArcsec(hints.scale)} disabled={disabled} onChange={(seconds) => edit({ scale: seconds > 0 ? arcsec(seconds) : undefined })} />
			{request.strategy === 'assisted' ? (
				<Notice>
					RA and Dec are used together. Empty fields and 0 are taken from the image: {offered?.rightAscension ? `the header pointing (${offered.rightAscension.source})` : 'no pointing'}, {offeredScale ? `a scale of ${offeredScale}` : 'no scale'}. A search radius of 0 searches within 10°.
				</Notice>
			) : (
				<Notice>A pixel scale of 0 is taken from the image: {offeredScale ? `a scale of ${offeredScale}` : 'no scale'}.</Notice>
			)}
		</>
	)
}

// Advanced settings of a request: the scale tolerance.
export function AdvancedControls({ request, onChange, disabled }: PlateSolveControlsProps) {
	return (
		<>
			<NumberInput label="Scale Tolerance" suffix="%" min={1} max={90} step={1} value={(request.scaleTolerance ?? DEFAULT_SCALE_TOLERANCE) * 100} disabled={disabled} onChange={(percent) => onChange({ ...request, scaleTolerance: percent / 100 })} />
			<Notice>The scale is searched within the tolerance around the pixel scale, when one is known.</Notice>
		</>
	)
}

export interface AngleFieldProps {
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

// Text field of an angle, parsed when it loses the focus; an unreadable text is kept and reported. Used by the solve
// hints and by the manual target of Target Offset.
export function AngleField({ label, hour = false, value, placeholder, disabled, onChange }: AngleFieldProps) {
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
			<TextInput label={label} placeholder={placeholder ?? (hour ? 'From the header, such as 10h 44m 03s' : 'From the header, such as -59° 41′')} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} />
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
