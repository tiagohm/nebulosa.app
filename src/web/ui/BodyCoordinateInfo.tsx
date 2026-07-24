import { formatDistance, tw } from '@shared/util'
import { formatALT, formatAZ, formatDEC, formatHMS, formatRA, toDeg } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { ComponentProps } from 'react'
import type { BodyPosition } from 'src/types/atlas'
import type { CoordinateInfo, CoordinateType } from 'src/types/mount'

export interface BodyCoordinateInfoProps extends ComponentProps<'div'> {
	readonly position: CoordinateInfo | BodyPosition
	readonly hideLst?: boolean
	readonly hideMeridianTimeIn?: boolean
	readonly hidePierSide?: boolean
	readonly hideConstellation?: boolean
	readonly hideDistance?: boolean
	readonly hideMagnitude?: boolean
	readonly hideIlluminated?: boolean
	readonly hideElongation?: boolean
	readonly hideEquatorialJ2000?: boolean
	readonly hideEquatorial?: boolean
	readonly hideHorizontal?: boolean
	readonly hideEcliptic?: boolean
	readonly hideGalactic?: boolean
}

const COORDINATE_TYPES = ['equatorialJ2000', 'equatorial', 'horizontal', 'ecliptic', 'galactic'] as const satisfies readonly CoordinateType[]

const COORDINATE_LABELS = {
	equatorial: 'RA/DEC',
	equatorialJ2000: 'RA/DEC (J2000)',
	horizontal: 'AZ/ALT',
	ecliptic: 'ECL LON/LAT',
	galactic: 'GAL LON/LAT',
} as const satisfies Record<CoordinateType, string>

export function BodyCoordinateInfo({ position, hideEquatorialJ2000, hideEquatorial, hideEcliptic, hideHorizontal, hideGalactic, hideConstellation, hideLst, hideMeridianTimeIn, hidePierSide, hideDistance, hideMagnitude, hideIlluminated, hideElongation, className, ...props }: BodyCoordinateInfoProps) {
	function isCoordinateTypeVisible(type: CoordinateType) {
		if (type === 'equatorialJ2000') return !hideEquatorialJ2000
		else if (type === 'equatorial') return !hideEquatorial
		else if (type === 'ecliptic') return !hideEcliptic
		else if (type === 'galactic') return !hideGalactic
		else if (type === 'horizontal') return !hideHorizontal
		return false
	}

	return (
		<div {...props} className={tw('grid w-full grid-cols-20 gap-2', className)}>
			<div className="col-span-12 flex flex-col justify-start gap-0">
				{COORDINATE_TYPES.map((type) => {
					if (!isCoordinateTypeVisible(type)) return null
					const [x, y] = position[type]
					return <Coordinate key={type} type={type} x={x} y={y} />
				})}
				<div className="flex items-center gap-2">
					{!hideDistance && 'distance' in position && <Extra className="flex-1" label="DIST" value={position.distance ? formatDistance(position.distance) : '--'} />}
					{!hideMagnitude && 'magnitude' in position && <Extra className="flex-1" label="MAG" value={position.magnitude && position.magnitude <= 30 ? position.magnitude : '--'} />}
				</div>
			</div>
			<div className="col-span-8 flex flex-col justify-start gap-0">
				{!hideConstellation && <Extra label="CONST" value={position.constellation} />}
				{!hideLst && <Extra label="LST" value={formatHMS(position.lst, true)} />}
				{!hideMeridianTimeIn && <Extra label="MERIDIAN IN" value={formatSeconds(position.meridianTimeIn)} />}
				{!hidePierSide && <Extra label="PIER SIDE" value={position.pierSide} />}
				{!hideIlluminated && 'illuminated' in position && <Extra label="ILLUM (%)" value={position.illuminated.toFixed(2)} />}
				{!hideElongation && 'elongation' in position && <Extra label="ELON (°)" value={toDeg(position.elongation).toFixed(2)} />}
			</div>
		</div>
	)
}

interface CoordinateProps {
	readonly type: CoordinateType
	readonly x: Angle
	readonly y: Angle
}

function Coordinate({ type, x, y }: CoordinateProps) {
	return (
		<div className="grid grid-cols-12 items-center text-sm leading-3">
			<span className="col-span-5 text-xs font-bold">{COORDINATE_LABELS[type]}:</span>
			<span className="col-span-3 text-end whitespace-nowrap tabular-nums">{formatCoordinateLongitude(type, x)}</span>
			<span className="col-span-4 text-end whitespace-nowrap tabular-nums">{formatCoordinateLatitude(type, y)}</span>
		</div>
	)
}

function formatCoordinateLongitude(type: CoordinateType, angle: Angle) {
	return type === 'equatorial' || type === 'equatorialJ2000' ? formatRA(angle, true) : formatAZ(angle, true)
}

function formatCoordinateLatitude(type: CoordinateType, angle: Angle) {
	return type === 'horizontal' ? formatALT(angle, true) : formatDEC(angle, true)
}

function formatSeconds(seconds: number) {
	const total = Math.round(seconds / 60) // minutos
	const h = Math.floor(total / 60)
	const m = total % 60
	return `${h.toFixed(0).padStart(2, '0')}:${m.toFixed(0).padStart(2, '0')}`
}

interface ExtraProps extends ComponentProps<'div'> {
	readonly label: string
	readonly value: string | number
}

function Extra({ label, value, className, ...props }: ExtraProps) {
	return (
		<div {...props} className={tw('flex flex-row items-center justify-between text-sm leading-3', className)}>
			<span className="text-xs font-bold">{label}:</span>
			<span className="whitespace-nowrap tabular-nums">{value}</span>
		</div>
	)
}
