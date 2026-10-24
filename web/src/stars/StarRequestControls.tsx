import type { StarDetectionRequest } from 'api'
import { useSnapshot } from 'valtio'
import { Notice } from '../equipment-control/parts'
import { externalToolsState } from '../settings/externaltools'
import { summaryOf } from '../settings/ExternalToolStatus'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { BUILTIN_STAR_LIMIT, DEFAULT_APERTURE_RADIUS, PROVIDER_LABELS, PROVIDERS, withAcceptance, withDetectorSettings, withProvider } from './stars'

// Controls of the star detection request of the profile, edited in the Star Detection tool of the Images workspace
// and used by Auto Focus too: the detector with the availability of ASTAP, the settings the selected detector really
// has, and the acceptance criteria. They edit a request through onChange and run
// nothing; ASTAP's executable and timeout stay in Settings → External Tools, which they link to.

export interface StarRequestControlsProps {
	// Request edited.
	readonly request: StarDetectionRequest
	// Called with the edited request.
	readonly onChange: (request: StarDetectionRequest) => void
	// Whether the controls are locked, such as during a capture.
	readonly disabled?: boolean
}

// Choice of the detector, with the availability of ASTAP when it is chosen.
export function DetectorControls({ request, onChange, disabled }: StarRequestControlsProps) {
	return (
		<>
			<SegmentedControl options={PROVIDERS} value={request.detector.provider} format={(provider) => PROVIDER_LABELS[provider]} disabled={disabled} onChange={(provider) => onChange(withProvider(request, provider))} />
			{request.detector.provider === 'astap' && <AstapAvailability />}
		</>
	)
}

// Whether the server's ASTAP is configured, from the External Tools settings.
export function useAstapConfigured(): boolean {
	const { tools } = useSnapshot(externalToolsState)
	return tools.find((tool) => tool.id === 'astap')?.status === 'configured'
}

// Whether ASTAP can be used, as the server's External Tools settings report it, with a link to them.
function AstapAvailability() {
	const { tools } = useSnapshot(externalToolsState)
	const astap = tools.find((tool) => tool.id === 'astap')
	const summary = astap && summaryOf(astap)

	return (
		<div className="flex flex-col gap-1">
			<p className="m-0 text-xs leading-4 text-ink-300">
				ASTAP: <span className={summary?.className}>{summary?.label ?? 'Loading…'}</span>
				{astap?.lastCheck && astap.lastCheck.status !== 'available' && ` — ${astap.lastCheck.message}`}
			</p>
			<Button variant="ghost" className="self-start px-1" onClick={() => navigate(routeState, { workspace: 'settings', tool: 'astap' })}>
				Settings → External Tools → ASTAP
			</Button>
		</div>
	)
}

// Settings of the selected detector.
export function DetectorSettingsControls({ request, onChange, disabled }: StarRequestControlsProps) {
	const { detector } = request
	const edit = (patch: Parameters<typeof withDetectorSettings>[1]) => onChange(withDetectorSettings(request, patch))

	return detector.provider === 'builtin' ? (
		<>
			<NumberInput label="Max stars" value={detector.maxStars} min={1} max={BUILTIN_STAR_LIMIT} disabled={disabled} onChange={(maxStars) => edit({ maxStars })} />
			<NumberInput label="Min SNR" value={detector.minSNR} min={0} step={0.5} disabled={disabled} onChange={(minSNR) => edit({ minSNR })} />
			<NumberInput label="Search region" value={detector.searchRegion} min={0} max={500} suffix="px" disabled={disabled} onChange={(searchRegion) => edit({ searchRegion })} />
			<Notice>Search region removes pairs of similar stars closer than it; 0 keeps every star.</Notice>
			<NumberInput label="Aperture radius" value={detector.maximumRadius ?? DEFAULT_APERTURE_RADIUS} min={4} max={256} suffix="px" disabled={disabled} onChange={(maximumRadius) => edit({ maximumRadius })} />
			<Notice>Largest aperture the HFD of a star is measured in; it must hold the most defocused stars, such as the ends of an Auto Focus curve.</Notice>
		</>
	) : (
		<>
			<NumberInput label="Max stars" value={detector.maxStars} min={0} max={100000} disabled={disabled} onChange={(maxStars) => edit({ maxStars })} />
			<NumberInput label="Min SNR" value={detector.minSNR} min={0} max={1000} disabled={disabled} onChange={(minSNR) => edit({ minSNR })} />
			<Notice>Max stars 0 keeps every star ASTAP extracts.</Notice>
		</>
	)
}

// Criteria of the stars entering the aggregate HFD.
export function AcceptanceControls({ request, onChange, disabled }: StarRequestControlsProps) {
	const { acceptance } = request
	const edit = (patch: Parameters<typeof withAcceptance>[1]) => onChange(withAcceptance(request, patch))

	return (
		<>
			<NumberInput label="Min SNR" value={acceptance.minSNR} min={0} step={0.5} disabled={disabled} onChange={(minSNR) => edit({ minSNR })} />
			<NumberInput label="Min HFD" value={acceptance.minHfd} min={0} step={0.1} suffix="px" disabled={disabled} onChange={(minHfd) => edit({ minHfd })} />
			<NumberInput label="Max HFD" value={acceptance.maxHfd} min={0} step={0.1} suffix="px" disabled={disabled} onChange={(maxHfd) => edit({ maxHfd })} />
			<NumberInput label="Edge margin" value={acceptance.edgeMargin} min={0} suffix="px" disabled={disabled} onChange={(edgeMargin) => edit({ edgeMargin })} />
			<Notice>Max HFD 0 sets no upper limit. Saturation is not checked.</Notice>
		</>
	)
}
