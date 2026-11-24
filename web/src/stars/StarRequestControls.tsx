import type { StarDetectionRequest, StarDetectorProvider } from 'api'
import { useSnapshot } from 'valtio'
import { externalToolsState } from '../settings/externaltools'
import { summaryOf } from '../settings/ExternalToolStatus'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { NEBULOSA_STAR_LIMIT, DEFAULT_APERTURE_RADIUS, PROVIDER_LABELS, PROVIDERS, withAcceptance, withDetectorSettings } from './stars'

// Controls of the star detection request of the profile, edited in the Star Detection tool of the Images workspace
// and used by Auto Focus and Guiding too: the detector with the availability of ASTAP, the settings the selected
// detector really has, and the acceptance criteria, with the one-line summaries their collapsed sections show. They
// edit a request through onChange, or choose a detector through onProvider, and run nothing; ASTAP's executable and
// timeout stay in Settings → External Tools, which they link to.

export interface StarRequestControlsProps {
	// Request edited.
	readonly request: StarDetectionRequest
	// Called with the edited request.
	readonly onChange: (request: StarDetectionRequest) => void
	// Whether the controls are locked, such as during a capture.
	readonly disabled?: boolean
}

export interface DetectorControlsProps {
	// Request whose detector is shown.
	readonly request: StarDetectionRequest
	// Called with the detector chosen, which brings back the settings it had.
	readonly onProvider: (provider: StarDetectorProvider) => void
	// Whether the choice is locked.
	readonly disabled?: boolean
}

// Choice of the detector, with the availability of ASTAP when it is chosen.
export function DetectorControls({ request, onProvider, disabled }: DetectorControlsProps) {
	return (
		<>
			<SegmentedControl options={PROVIDERS} value={request.detector.provider} format={(provider) => PROVIDER_LABELS[provider]} disabled={disabled} onChange={onProvider} />
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
			<Notice>
				ASTAP:{' '}
				<span className={summary?.className} title={summary?.hint}>
					{summary?.label ?? 'Loading…'}
				</span>
				{astap?.lastCheck && astap.lastCheck.code !== 'ok' && ` — ${astap.lastCheck.message}`}
			</Notice>
			<AstapSettingsButton />
		</div>
	)
}

// Opens the ASTAP page of Settings → External Tools, where its executable and timeout are set.
export function AstapSettingsButton() {
	return (
		<Button variant="secondary" className="self-start" title="Settings → External Tools → ASTAP" onClick={() => navigate(routeState, { workspace: 'settings', tool: 'astap' })}>
			ASTAP Settings
		</Button>
	)
}

// Settings of the selected detector.
export function DetectorSettingsControls({ request, onChange, disabled }: StarRequestControlsProps) {
	const { detector } = request
	const edit = (patch: Parameters<typeof withDetectorSettings>[1]) => onChange(withDetectorSettings(request, patch))

	return detector.provider === 'nebulosa' ? (
		<>
			<NumberInput label="Max stars" value={detector.maxStars} min={1} max={NEBULOSA_STAR_LIMIT} disabled={disabled} onChange={(maxStars) => edit({ maxStars })} />
			<NumberInput label="Detect above SNR" value={detector.minSNR} min={0} step={0.5} disabled={disabled} onChange={(minSNR) => edit({ minSNR })} />
			<NumberInput label="Search region" value={detector.searchRegion} min={0} max={500} suffix="px" disabled={disabled} onChange={(searchRegion) => edit({ searchRegion })} />
			<Notice>Search region removes pairs of similar stars closer than it; 0 keeps every star.</Notice>
			<NumberInput label="Aperture radius" value={detector.maximumRadius ?? DEFAULT_APERTURE_RADIUS} min={4} max={256} suffix="px" disabled={disabled} onChange={(maximumRadius) => edit({ maximumRadius })} />
			<Notice>Largest aperture the HFD of a star is measured in; it must hold the most defocused stars, such as the ends of an Auto Focus curve.</Notice>
		</>
	) : (
		<>
			<NumberInput label="Max stars" value={detector.maxStars} min={0} max={100000} disabled={disabled} onChange={(maxStars) => edit({ maxStars })} />
			<NumberInput label="Detect above SNR" value={detector.minSNR} min={0} max={1000} disabled={disabled} onChange={(minSNR) => edit({ minSNR })} />
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
			<NumberInput label="Accept above SNR" value={acceptance.minSNR} min={0} step={0.5} disabled={disabled} onChange={(minSNR) => edit({ minSNR })} />
			<NumberInput label="Min HFD" value={acceptance.minHfd} min={0} step={0.1} suffix="px" disabled={disabled} onChange={(minHfd) => edit({ minHfd })} />
			<NumberInput label="Max HFD" value={acceptance.maxHfd} min={0} step={0.1} suffix="px" disabled={disabled} onChange={(maxHfd) => edit({ maxHfd })} />
			<NumberInput label="Edge margin" value={acceptance.edgeMargin} min={0} suffix="px" disabled={disabled} onChange={(edgeMargin) => edit({ edgeMargin })} />
			{acceptance.maxHfd > 0 && acceptance.maxHfd < acceptance.minHfd && <Notice warning>Max HFD is below Min HFD, so no star can be accepted.</Notice>}
			<Notice>Max HFD 0 sets no upper limit. Saturation is not checked.</Notice>
		</>
	)
}

// Returns the summary of the settings of the selected detector: how many stars it keeps and the SNR it detects above,
// such as "500 stars · SNR ≥ 5"; a maximum of 0 (ASTAP) keeps every star.
export function detectionSummary({ detector }: StarDetectionRequest): string {
	const stars = detector.maxStars > 0 ? `${detector.maxStars} stars` : 'Every star'
	return detector.minSNR > 0 ? `${stars} · SNR ≥ ${detector.minSNR}` : stars
}

// Returns the summary of the acceptance criteria, naming only those that reject a star, such as "SNR ≥ 5 · HFD 1–4 px
// · Edge 10 px", or "Every star" when none does.
export function acceptanceSummary({ acceptance }: StarDetectionRequest): string {
	const parts: string[] = []
	if (acceptance.minSNR > 0) parts.push(`SNR ≥ ${acceptance.minSNR}`)
	if (acceptance.maxHfd > 0) parts.push(`HFD ${acceptance.minHfd}–${acceptance.maxHfd} px`)
	else if (acceptance.minHfd > 0) parts.push(`HFD ≥ ${acceptance.minHfd} px`)
	if (acceptance.edgeMargin > 0) parts.push(`Edge ${acceptance.edgeMargin} px`)
	return parts.length > 0 ? parts.join(' · ') : 'Every star'
}

// Returns the summary of the whole request: the detector, then the summary of its settings.
export function settingsSummary(request: StarDetectionRequest): string {
	return `${PROVIDER_LABELS[request.detector.provider]} · ${detectionSummary(request)}`
}
