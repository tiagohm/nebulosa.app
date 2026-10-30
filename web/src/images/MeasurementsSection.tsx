import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { ReactNode } from 'react'
import { Actions, ConfirmButton, Notice } from '../equipment-control/parts'
import { type CoordinateStyle, formatAngularSize, formatDeclinationAs, formatPixel, formatPositionAngle, formatRightAscensionAs, formatSignedAngle, MISSING } from '../platesolving/coordinates'
import { type AstrometricMarker, type AstrometrySelection, circleValues, distanceValues, type Measurement, rectangleValues } from '../platesolving/measurement'
import { skyAt, wcsFrame } from '../platesolving/wcs'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { TextInput } from '../ui/TextInput'
import { pixelAt } from '../viewer/transform'
import { clearAstrometryItems, editAstrometryItem, type ImageAstrometryState, imagesState, removeAstrometryItem, selectAstrometryItem } from './images'
import { openInSky } from './skyHandoff'

// Measurements and Markers sections of the Plate Solver panel: the measurements and markers of the document with their
// values from the selected solution, the details of the selected one, and renaming, hiding, deleting, and clearing
// them. Selecting in a list selects in the viewer and back. Values are computed again from the solution shown, so
// choosing another solution changes them; without one they are unavailable. Items are drawn with the measure modes of
// the viewer toolbar or the context menu of the image.

// Names of the kinds of measurement.
const KIND_LABELS: Readonly<Record<Measurement['kind'], string>> = { distance: 'Distance', rectangle: 'Rectangle', circle: 'Circle' }

export interface AstrometrySectionProps {
	// Key of the document.
	readonly documentKey: string
	// Selected solution of its image; absent when it has none.
	readonly solution?: PlateSolution
	// Size of its image, in pixels.
	readonly image?: { readonly width: number; readonly height: number }
	// Measurements, markers, and selection of the document.
	readonly astrometry: ImageAstrometryState
	// How coordinates are written.
	readonly style: CoordinateStyle
}

// Measurements of a document.
export function MeasurementsSection({ documentKey, solution, astrometry, style }: AstrometrySectionProps) {
	const { measurements, selected } = astrometry
	const current = selected?.kind === 'measurement' ? measurements.find((m) => m.id === selected.id) : undefined

	return (
		<CollapsibleSection id="images.plate-solver.measurements" title="Measurements" summary={measurements.length > 0 ? String(measurements.length) : undefined}>
			{!solution && <Notice>Measurements need a solution of this image: solve it, or choose the solution of its header.</Notice>}
			<List emptyText="No measurement. Choose Distance, Rectangle, or Circle in the viewer toolbar, then drag or click twice on the image." className="max-h-60 overflow-y-auto">
				{measurements.map((measurement, index) => (
					<ListItem
						key={measurement.id}
						title={nameOf(measurement, index)}
						description={solution ? summaryOf(solution, measurement) : MISSING}
						meta={measurement.visible ? undefined : 'Hidden'}
						selected={measurement.id === current?.id}
						onClick={() => selectAstrometryItem(imagesState, documentKey, { kind: 'measurement', id: measurement.id })}
					/>
				))}
			</List>
			{current && (
				<ItemDetails documentKey={documentKey} item={{ kind: 'measurement', id: current.id }} label={current.label} placeholder={nameOf({ ...current, label: undefined }, measurements.indexOf(current))} visible={current.visible}>
					{solution ? <MeasurementValues solution={solution} measurement={current} style={style} /> : <Notice>No solution.</Notice>}
				</ItemDetails>
			)}
			{measurements.length > 0 && (
				<Actions>
					<ConfirmButton title="Clear measurements?" message="Every measurement of this image is removed." confirmLabel="Clear" onConfirm={() => clearAstrometryItems(imagesState, documentKey, 'measurement')}>
						Clear All
					</ConfirmButton>
				</Actions>
			)}
		</CollapsibleSection>
	)
}

// Markers of a document.
export function MarkersSection({ documentKey, solution, image, astrometry, style }: AstrometrySectionProps) {
	const { markers, selected } = astrometry
	const current = selected?.kind === 'marker' ? markers.find((m) => m.id === selected.id) : undefined
	const position = (marker: AstrometricMarker) => (solution ? skyAt(solution, marker.point) : undefined)

	return (
		<CollapsibleSection id="images.plate-solver.markers" title="Markers" summary={markers.length > 0 ? String(markers.length) : undefined}>
			<List emptyText="No marker. Choose Marker in the viewer toolbar, then click on the image." className="max-h-60 overflow-y-auto">
				{markers.map((marker, index) => {
					const sky = position(marker)

					return (
						<ListItem
							key={marker.id}
							title={markerName(marker, index)}
							description={sky ? `${formatRightAscensionAs(sky[0], style)} ${formatDeclinationAs(sky[1], style)}` : MISSING}
							meta={marker.visible ? undefined : 'Hidden'}
							selected={marker.id === current?.id}
							onClick={() => selectAstrometryItem(imagesState, documentKey, { kind: 'marker', id: marker.id })}
						/>
					)
				})}
			</List>
			{current && (
				<ItemDetails documentKey={documentKey} item={{ kind: 'marker', id: current.id }} label={current.label} placeholder={markerName({ ...current, label: undefined }, markers.indexOf(current))} visible={current.visible}>
					<MarkerValues solution={solution} marker={current} image={image} style={style} name={markerName(current, markers.indexOf(current))} />
				</ItemDetails>
			)}
			{markers.length > 0 && (
				<Actions>
					<ConfirmButton title="Clear markers?" message="Every marker of this image is removed." confirmLabel="Clear" onConfirm={() => clearAstrometryItems(imagesState, documentKey, 'marker')}>
						Clear All
					</ConfirmButton>
				</Actions>
			)}
		</CollapsibleSection>
	)
}

interface ItemDetailsProps {
	// Key of the document.
	readonly documentKey: string
	// Item shown.
	readonly item: AstrometrySelection
	// Its name given by the operator.
	readonly label?: string
	// Its default name.
	readonly placeholder: string
	// Whether it is drawn.
	readonly visible: boolean
	// Its values.
	readonly children: ReactNode
}

// Name, values, visibility, and deletion of the selected item.
function ItemDetails({ documentKey, item, label, placeholder, visible, children }: ItemDetailsProps) {
	return (
		<div className="flex flex-col gap-2 border-t border-line-100 pt-2">
			<TextInput label="Name" value={label ?? ''} placeholder={placeholder} onChange={(event) => editAstrometryItem(imagesState, documentKey, item, { label: event.currentTarget.value })} />
			{children}
			<Actions>
				<Button variant="secondary" onClick={() => editAstrometryItem(imagesState, documentKey, item, { visible: !visible })}>
					{visible ? 'Hide' : 'Show'}
				</Button>
				<Button variant="secondary" onClick={() => removeAstrometryItem(imagesState, documentKey, item)}>
					Delete
				</Button>
			</Actions>
		</div>
	)
}

interface MeasurementValuesProps {
	// Selected solution of the image.
	readonly solution: PlateSolution
	// Measurement shown.
	readonly measurement: Measurement
	// How coordinates are written.
	readonly style: CoordinateStyle
}

// Values of a measurement and how they are defined. Position angles are from north through east.
function MeasurementValues({ solution, measurement, style }: MeasurementValuesProps) {
	if (measurement.kind === 'rectangle') {
		const { pixels, sides, centerLines, diagonals } = rectangleValues(solution, measurement)

		return (
			<>
				<Property label="Width (centre line)">{centerLines ? formatAngularSize(centerLines.width) : MISSING}</Property>
				<Property label="Height (centre line)">{centerLines ? formatAngularSize(centerLines.height) : MISSING}</Property>
				<Property label="Top · bottom">{sides ? `${formatAngularSize(sides.top)} · ${formatAngularSize(sides.bottom)}` : MISSING}</Property>
				<Property label="Left · right">{sides ? `${formatAngularSize(sides.left)} · ${formatAngularSize(sides.right)}` : MISSING}</Property>
				<Property label="Diagonals">{diagonals ? `${formatAngularSize(diagonals[0])} · ${formatAngularSize(diagonals[1])}` : MISSING}</Property>
				<Property label="Size">{`${pixels.width.toFixed(1)} × ${pixels.height.toFixed(1)} px`}</Property>
				{!sides && <Notice>A corner of this rectangle cannot be located with the solution shown.</Notice>}
				<Notice>The rectangle follows the rows and columns of the image, not right ascension and declination; its sides are measured along great circles between its corners.</Notice>
			</>
		)
	}

	if (measurement.kind === 'circle') {
		const { pixels, center, radius } = circleValues(solution, measurement)
		const frame = wcsFrame(solution)

		return (
			<>
				<Property label="Radius">{radius === undefined ? MISSING : formatAngularSize(radius)}</Property>
				<Property label="Diameter">{radius === undefined ? MISSING : formatAngularSize(2 * radius)}</Property>
				<Property label={`Centre (${frame})`}>{center ? `${formatRightAscensionAs(center[0], style)} ${formatDeclinationAs(center[1], style)}` : MISSING}</Property>
				<Property label="Radius to the rim point">{`${pixels.toFixed(1)} px`}</Property>
				{radius === undefined && <Notice>The centre or rim of this circle cannot be located with the solution shown.</Notice>}
				<Notice>A circle of constant angular radius on the sky; drawn through the WCS, it may look elliptical.</Notice>
			</>
		)
	}

	const { pixels, offset } = distanceValues(solution, measurement)

	return (
		<>
			<Property label="Separation">{offset ? formatAngularSize(offset.separation) : MISSING}</Property>
			<Property label="Position angle">{formatPositionAngle(offset?.positionAngle)}</Property>
			<Property label="ΔRA">{offset ? formatSignedAngle(offset.rightAscension) : MISSING}</Property>
			<Property label="ΔDec">{offset ? formatSignedAngle(offset.declination) : MISSING}</Property>
			<Property label="East offset">{offset?.east === undefined ? MISSING : formatSignedAngle(offset.east)}</Property>
			<Property label="North offset">{offset?.north === undefined ? MISSING : formatSignedAngle(offset.north)}</Property>
			<Property label="Length">{`${pixels.toFixed(1)} px`}</Property>
			{!offset && <Notice>An end of this distance cannot be located with the solution shown.</Notice>}
			<Notice>ΔRA is a difference of right ascension, not an angle on the sky; east and north are the offsets of the end on the plane tangent at the start.</Notice>
		</>
	)
}

interface MarkerValuesProps {
	// Selected solution of the image.
	readonly solution?: PlateSolution
	// Marker shown.
	readonly marker: AstrometricMarker
	// Size of the image, in pixels.
	readonly image?: { readonly width: number; readonly height: number }
	// How coordinates are written.
	readonly style: CoordinateStyle
	// Name of the marker.
	readonly name: string
}

// Sky position and pixel of a marker, and its link to the Sky map.
function MarkerValues({ solution, marker, image, style, name }: MarkerValuesProps) {
	const sky = solution && skyAt(solution, marker.point)
	const frame = solution ? ` (${wcsFrame(solution)})` : ''
	const pixel = image && pixelAt(image, marker.point)

	return (
		<>
			<Property label={`RA${frame}`}>{sky ? formatRightAscensionAs(sky[0], style) : MISSING}</Property>
			<Property label={`Dec${frame}`}>{sky ? formatDeclinationAs(sky[1], style) : MISSING}</Property>
			<Property label="Pixel (x, y from 0)">{pixel ? formatPixel(pixel) : MISSING}</Property>
			<Actions>
				<Button variant="secondary" disabled={!sky} title={sky ? undefined : 'The solution cannot locate this marker.'} onClick={() => sky && openInSky(sky, name)}>
					Open in Sky
				</Button>
			</Actions>
		</>
	)
}

// Returns the name of a measurement: its label, or its kind and number.
function nameOf(measurement: Measurement, index: number): string {
	return measurement.label ?? `${KIND_LABELS[measurement.kind]} ${index + 1}`
}

// Returns the name of a marker: its label, or M and its number.
function markerName(marker: AstrometricMarker, index: number): string {
	return marker.label ?? `M${index + 1}`
}

// Returns the value of a measurement shown in its list.
function summaryOf(solution: PlateSolution, measurement: Measurement): string {
	if (measurement.kind === 'rectangle') {
		const { centerLines } = rectangleValues(solution, measurement)
		return centerLines ? `${formatAngularSize(centerLines.width)} × ${formatAngularSize(centerLines.height)}` : MISSING
	}

	if (measurement.kind === 'circle') {
		const { radius } = circleValues(solution, measurement)
		return radius === undefined ? MISSING : `r ${formatAngularSize(radius)}`
	}

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
