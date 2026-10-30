import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, Notice } from '../equipment-control/parts'
import { type CoordinateStyle, formatAngularSize, formatDeclinationAs, formatPositionAngle, formatRightAscensionAs, formatSignedAngle, MISSING } from '../platesolving/coordinates'
import { type AstrometricMarker, type AstrometryTarget, catalogTarget, targetOffset, targetPosition } from '../platesolving/measurement'
import { AngleField } from '../platesolving/PlateSolveControls'
import { wcsFrame } from '../platesolving/wcs'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { skyState } from '../sky/sky'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { type ImageAstrometryState, imagesState, setAstrometryTarget } from './images'

// Target Offset section of the Plate Solver panel: the offset of a target from the solved centre of the image shown,
// read only. The target is a marker of the image (located with the selected solution), a position typed in the frame
// of the solution, or the catalog object selected in Sky (its J2000 catalog position at epoch J2000.0, without proper
// motion). Solar-system bodies, minor bodies, constellations, and the mount cannot be targets: their position depends
// on the time and place of the observation, or is not a catalog position. The offset is computed again from whichever
// solution is selected; nothing is sent to a mount and the Sky selection is never changed.

// Sources of a target, in display order.
const SOURCES: readonly AstrometryTarget['source'][] = ['marker', 'manual', 'sky']

// Names of the sources of a target.
const SOURCE_LABELS: Readonly<Record<AstrometryTarget['source'], string>> = { marker: 'Marker', manual: 'Coordinates', sky: 'Sky' }

export interface TargetOffsetSectionProps {
	// Key of the document.
	readonly documentKey: string
	// Selected solution of its image; absent when it has none.
	readonly solution?: PlateSolution
	// Size of its image, in pixels.
	readonly image?: { readonly width: number; readonly height: number }
	// Measurements, markers, selection, and target of the document.
	readonly astrometry: ImageAstrometryState
	// How coordinates are written.
	readonly style: CoordinateStyle
}

// Target Offset of a document.
export function TargetOffsetSection({ documentKey, solution, image, astrometry, style }: TargetOffsetSectionProps) {
	const sky = useSnapshot(skyState)
	const { target, markers } = astrometry
	const [source, setSource] = useState<AstrometryTarget['source']>(target?.source ?? 'marker')
	const position = targetPosition(target, markers, solution)
	const values = solution && image && position && targetOffset(solution, image, position)
	const frame = solution ? wcsFrame(solution) : 'ICRS'
	const choose = (next?: AstrometryTarget) => setAstrometryTarget(imagesState, documentKey, next)
	const manual = target?.source === 'manual' ? target : undefined
	// Coordinates typed for a manual target, kept while only one of them is; the target is set once both are.
	const [typed, setTyped] = useState<{ readonly rightAscension?: number; readonly declination?: number }>(() => manual ?? {})

	function type(patch: { readonly rightAscension?: number; readonly declination?: number }) {
		const next = { ...typed, ...patch }
		setTyped(next)
		choose(next.rightAscension !== undefined && next.declination !== undefined ? { source: 'manual', rightAscension: next.rightAscension, declination: next.declination } : undefined)
	}
	const catalog = catalogTarget(sky.selection)

	return (
		<CollapsibleSection id="images.plate-solver.target-offset" title="Target Offset" summary={values ? formatAngularSize(values.offset.separation) : undefined}>
			<SegmentedControl label="Target" options={SOURCES} value={source} format={(option) => SOURCE_LABELS[option]} onChange={setSource} />
			{source === 'marker' &&
				(markers.length > 0 ? (
					<Select label="Marker" options={['', ...markers.map((marker) => marker.id)]} value={target?.source === 'marker' ? target.markerId : ''} format={(id) => (id ? markerName(markers, id) : 'None')} onChange={(id) => choose(id ? { source: 'marker', markerId: id } : undefined)} />
				) : (
					<Notice>No marker. Place one with the Marker mode or the context menu of the image.</Notice>
				))}
			{source === 'manual' && (
				<>
					<AngleField label={`RA (${frame})`} hour value={typed.rightAscension} placeholder="Such as 10h 45m 03s" onChange={(rightAscension) => type({ rightAscension })} />
					<AngleField label={`Dec (${frame})`} value={typed.declination} placeholder="Such as -59° 41′ 04″" onChange={(declination) => type({ declination })} />
				</>
			)}
			{source === 'sky' && (
				<>
					<Actions>
						<Button variant="secondary" disabled={typeof catalog === 'string'} title={typeof catalog === 'string' ? catalog : undefined} onClick={() => typeof catalog !== 'string' && choose(catalog)}>
							Use Sky Selection
						</Button>
					</Actions>
					{target?.source === 'sky' && <Property label="Object">{target.name}</Property>}
					<Notice>Catalog position at J2000, epoch J2000.0; proper motion is not applied.</Notice>
				</>
			)}
			{target && (
				<div className="flex flex-col gap-2 border-t border-line-100 pt-2">
					<Property label={`Target RA (${frame})`}>{position ? formatRightAscensionAs(position[0], style) : MISSING}</Property>
					<Property label={`Target Dec (${frame})`}>{position ? formatDeclinationAs(position[1], style) : MISSING}</Property>
					<Property label="Separation">{values ? formatAngularSize(values.offset.separation) : MISSING}</Property>
					<Property label="Position angle">{formatPositionAngle(values?.offset.positionAngle)}</Property>
					<Property label="East offset">{values?.offset.east === undefined ? MISSING : formatSignedAngle(values.offset.east)}</Property>
					<Property label="North offset">{values?.offset.north === undefined ? MISSING : formatSignedAngle(values.offset.north)}</Property>
					<Property label="In the image">{values ? (values.pixel ? `x ${values.pixel.x.toFixed(1)} y ${values.pixel.y.toFixed(1)}` : 'Outside the image') : MISSING}</Property>
					{!values && <Notice>{solution ? 'The target or the centre of the image cannot be located with the solution shown.' : 'Target Offset needs a solution of this image.'}</Notice>}
					<Actions>
						<Button variant="secondary" onClick={() => choose(undefined)}>
							Clear Target
						</Button>
					</Actions>
				</div>
			)}
			<Notice>Measured from the solved centre of the image, from north through east; east and north are offsets on the plane tangent at the centre. Read only: nothing is sent to the mount.</Notice>
		</CollapsibleSection>
	)
}

// Returns the name of a marker of a list by id: its label, or M and its number.
function markerName(markers: readonly AstrometricMarker[], id: string): string {
	const index = markers.findIndex((marker) => marker.id === id)
	return markers[index]?.label ?? `M${index + 1}`
}

interface PropertyProps {
	// Property name.
	readonly label: string
	// Property value.
	readonly children: ReactNode
}

// Name and value of a property.
function Property({ label, children }: PropertyProps) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-xs text-ink-300">{label}</span>
			<span className="min-w-0 text-right text-ink-100 tabular-nums">{children}</span>
		</div>
	)
}
