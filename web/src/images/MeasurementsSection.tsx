import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { ReactNode } from 'react'
import { Actions, ConfirmButton, Notice } from '../equipment-control/parts'
import { formatAngularSize, formatPositionAngle, formatSignedAngle, MISSING } from '../platesolving/coordinates'
import { distanceValues, type Measurement } from '../platesolving/measurement'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { TextInput } from '../ui/TextInput'
import { clearMeasurements, editMeasurement, type ImageAstrometryState, imagesState, removeMeasurement, selectAstrometryItem } from './images'

// Measurements section of the Plate Solver panel: the measurements of the document with their values from the selected
// solution, the details of the selected one, and renaming, hiding, deleting, and clearing them. Selecting in the list
// selects in the viewer and back. Values are computed again from the solution shown, so choosing another solution
// changes them; without one they are unavailable. Measurements are drawn with the measure modes of the viewer toolbar.

// Names of the kinds of measurement.
const KIND_LABELS: Readonly<Record<Measurement['kind'], string>> = { distance: 'Distance' }

export interface MeasurementsSectionProps {
	// Key of the document.
	readonly documentKey: string
	// Selected solution of its image; absent when it has none.
	readonly solution?: PlateSolution
	// Measurements of the document and their selection.
	readonly astrometry: ImageAstrometryState
}

// Measurements of a document.
export function MeasurementsSection({ documentKey, solution, astrometry }: MeasurementsSectionProps) {
	const { measurements, selected } = astrometry
	const current = measurements.find((m) => m.id === selected?.id)

	return (
		<CollapsibleSection id="images.plate-solver.measurements" title="Measurements" summary={measurements.length > 0 ? String(measurements.length) : undefined}>
			{!solution && <Notice>Measurements need a solution of this image: solve it, or choose the solution of its header.</Notice>}
			<List emptyText="No measurement. Choose Distance in the viewer toolbar, then drag or click twice on the image." className="max-h-60 overflow-y-auto">
				{measurements.map((measurement, index) => (
					<ListItem
						key={measurement.id}
						title={nameOf(measurement, index)}
						description={solution ? summaryOf(solution, measurement) : MISSING}
						meta={measurement.visible ? undefined : 'Hidden'}
						selected={measurement.id === selected?.id}
						onClick={() => selectAstrometryItem(imagesState, documentKey, { kind: 'measurement', id: measurement.id })}
					/>
				))}
			</List>
			{current && <Details documentKey={documentKey} solution={solution} measurement={current} index={measurements.indexOf(current)} />}
			{measurements.length > 0 && (
				<Actions>
					<ConfirmButton title="Clear measurements?" message="Every measurement of this image is removed." confirmLabel="Clear" onConfirm={() => clearMeasurements(imagesState, documentKey)}>
						Clear All
					</ConfirmButton>
				</Actions>
			)}
		</CollapsibleSection>
	)
}

interface DetailsProps {
	// Key of the document.
	readonly documentKey: string
	// Selected solution of its image.
	readonly solution?: PlateSolution
	// Measurement shown.
	readonly measurement: Measurement
	// Its position in the list, for its default name.
	readonly index: number
}

// Values of the selected measurement, and its name, visibility, and deletion. The position angle is from north
// through east; east and north are the standard coordinates of the end on the plane tangent at the start.
function Details({ documentKey, solution, measurement, index }: DetailsProps) {
	const values = solution && distanceValues(solution, measurement)
	const offset = values?.offset

	return (
		<div className="flex flex-col gap-2 border-t border-line-100 pt-2">
			<TextInput label="Name" value={measurement.label ?? ''} placeholder={nameOf({ ...measurement, label: undefined }, index)} onChange={(event) => editMeasurement(imagesState, documentKey, measurement.id, { label: event.currentTarget.value })} />
			<Property label="Separation">{offset ? formatAngularSize(offset.separation) : MISSING}</Property>
			<Property label="Position angle">{formatPositionAngle(offset?.positionAngle)}</Property>
			<Property label="ΔRA">{offset ? formatSignedAngle(offset.rightAscension) : MISSING}</Property>
			<Property label="ΔDec">{offset ? formatSignedAngle(offset.declination) : MISSING}</Property>
			<Property label="East offset">{offset?.east === undefined ? MISSING : formatSignedAngle(offset.east)}</Property>
			<Property label="North offset">{offset?.north === undefined ? MISSING : formatSignedAngle(offset.north)}</Property>
			<Property label="Length">{values ? `${values.pixels.toFixed(1)} px` : MISSING}</Property>
			{solution && !offset && <Notice>An end of this measurement cannot be located with the solution shown.</Notice>}
			<Actions>
				<Button variant="secondary" onClick={() => editMeasurement(imagesState, documentKey, measurement.id, { visible: !measurement.visible })}>
					{measurement.visible ? 'Hide' : 'Show'}
				</Button>
				<Button variant="secondary" onClick={() => removeMeasurement(imagesState, documentKey, measurement.id)}>
					Delete
				</Button>
			</Actions>
			<Notice>ΔRA is a difference of right ascension, not an angle on the sky. Decimals are a display choice, not an accuracy.</Notice>
		</div>
	)
}

// Returns the name of a measurement: its label, or its kind and number.
function nameOf(measurement: Measurement, index: number): string {
	return measurement.label ?? `${KIND_LABELS[measurement.kind]} ${index + 1}`
}

// Returns the value of a measurement shown in the list.
function summaryOf(solution: PlateSolution, measurement: Measurement): string {
	const { offset } = distanceValues(solution, measurement)
	return offset ? `${formatAngularSize(offset.separation)} · PA ${formatPositionAngle(offset.positionAngle)}` : MISSING
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
