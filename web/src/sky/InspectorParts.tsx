import type { SkyPosition } from 'api'
import type { ReactNode } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
import { formatDeclination, formatDegrees, formatLocalTime, formatMagnitude, formatRightAscension, formatSolarSystemDistance } from './format'
import type { SkySelection } from './sky'

// Parts shared by the Object Inspector and the Sun Inspector: a labeled datum, a muted note, and the collapsible
// Position section with its provider and instant.

// Description of each fallback reason.
const FALLBACK_REASONS = { timeout: 'Horizons did not answer in time', network: 'Horizons cannot be reached', breakerOpen: 'Horizons failed repeatedly and is paused' } as const

// Label and value of one datum.
export function Datum({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-[13px] wrap-break-word text-ink-100">{children}</span>
		</div>
	)
}

// Muted note under a section.
export function Note({ children, danger }: { readonly children: ReactNode; readonly danger?: boolean }) {
	return <p className={danger ? 'm-0 text-xs leading-4 text-danger' : 'm-0 text-xs leading-4 text-ink-300'}>{children}</p>
}

// Rows of the apparent coordinates of the selection, with their provider and instant; `children` adds rows before
// the note.
function PositionData({ selection, timeZone, children }: { readonly selection: SkySelection; readonly timeZone?: string; readonly children?: ReactNode }) {
	const { position, positionError, loading } = selection

	return (
		<>
			{position ? (
				<>
					<Datum label="Constellation">{position.constellationName ?? position.constellation}</Datum>
					<Datum label="RA (of date)">{formatRightAscension(position.rightAscension)}</Datum>
					<Datum label="Dec (of date)">{formatDeclination(position.declination)}</Datum>
					{selection.ref.kind !== 'catalog' && (
						<>
							<Datum label="RA (J2000)">{formatRightAscension(position.rightAscensionJ2000)}</Datum>
							<Datum label="Dec (J2000)">{formatDeclination(position.declinationJ2000)}</Datum>
						</>
					)}
					{position.distance !== undefined && <Datum label="Distance">{formatSolarSystemDistance(position.distance)}</Datum>}
					{position.magnitude !== undefined && selection.ref.kind !== 'catalog' && <Datum label="Magnitude">{formatMagnitude(position.magnitude)}</Datum>}
					{position.illuminated !== undefined && selection.ref.kind !== 'catalog' && <Datum label="Illuminated">{(position.illuminated * 100).toFixed(1)}%</Datum>}
					{position.elongation !== undefined && !(selection.ref.kind === 'body' && selection.ref.code === '10') && selection.ref.kind !== 'catalog' && <Datum label="Solar elongation">{formatDegrees(position.elongation)}</Datum>}
					{children}
					<Note>{positionNote(position, selection.ref.kind === 'constellation', timeZone)}</Note>
				</>
			) : (
				!positionError && <p className="m-0 text-ink-300">{loading ? 'Computing the position…' : 'No position.'}</p>
			)}
			{positionError && <Note danger>Ephemeris unavailable: {positionError}</Note>}
		</>
	)
}

// Apparent coordinates of the selection, with their provider and instant; `children` adds rows before the note.
export function PositionSection({ selection, timeZone, children }: { readonly selection: SkySelection; readonly timeZone?: string; readonly children?: ReactNode }) {
	return (
		<CollapsibleSection id="position" title="Position" summary={selection.position && (selection.position.constellationName ?? selection.position.constellation)}>
			<PositionData selection={selection} timeZone={timeZone}>
				{children}
			</PositionData>
		</CollapsibleSection>
	)
}

// Describes how and when a position was computed; a constellation is located at its label, a fixed J2000
// point near its center. Times are shown in a time zone, or in the browser's when absent.
function positionNote(position: SkyPosition, constellation: boolean, timeZone?: string) {
	const source = position.source === 'horizons' ? 'JPL Horizons' : position.fallbackReason ? `local model (${FALLBACK_REASONS[position.fallbackReason]})` : 'local model'
	const place = `Apparent ${position.center} place at ${formatLocalTime(position.time, Date.now(), undefined, timeZone)}, from ${source}.`
	return constellation ? `${place} The position is the constellation label, a fixed J2000 point near its center.` : place
}
