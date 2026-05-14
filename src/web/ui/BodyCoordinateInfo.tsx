import { type Angle, formatALT, formatAZ, formatDEC, formatHMS, formatRA, toDeg } from 'nebulosa/src/angle'
import { type ComponentProps, memo } from 'react'
import type { BodyPosition, CoordinateInfo, CoordinateType } from 'src/shared/types'
import { formatDistance, tw } from '@/shared/util'

export type BodyCoordinateInfoField = keyof CoordinateInfo | 'distance' | 'illuminated' | 'elongation'

export interface BodyCoordinateInfoProps extends ComponentProps<'div'> {
	readonly position: CoordinateInfo | BodyPosition
	readonly hide?: readonly BodyCoordinateInfoField[]
}

const COORDINATE_TYPES = ['equatorialJ2000', 'equatorial', 'horizontal', 'ecliptic', 'galactic'] as const satisfies readonly CoordinateType[]

const COORDINATE_LABELS = {
	equatorial: 'RA/DEC',
	equatorialJ2000: 'RA/DEC (J2000)',
	horizontal: 'AZ/ALT',
	ecliptic: 'ECL LON/LAT',
	galactic: 'GAL LON/LAT',
} as const satisfies Record<CoordinateType, string>

export const BodyCoordinateInfo = memo(({ position, hide, className, ...props }: BodyCoordinateInfoProps) => {
	const isVisible = (field: BodyCoordinateInfoField) => !hide?.includes(field)

	return (
		<div {...props} className={tw('grid w-full grid-cols-20 gap-2', className)}>
			<div className="col-span-12 flex flex-col justify-start gap-0">
				{COORDINATE_TYPES.map((type) => {
					if (!isVisible(type)) return null
					const [x, y] = position[type]
					return <Coordinate key={type} type={type} x={x} y={y} />
				})}
				<div className="grid grid-cols-2 items-center gap-2">{'distance' in position && isVisible('distance') && <Extra className="col-span-1" label="DIST" value={formatDistance(position.distance)} />}</div>
			</div>
			<div className="col-span-8 flex flex-col justify-start gap-0">
				{isVisible('constellation') && <Extra label="CONST" value={position.constellation} />}
				{isVisible('lst') && <Extra label="LST" value={formatHMS(position.lst, true)} />}
				{isVisible('meridianIn') && <Extra label="MERIDIAN IN" value={formatHMS(position.meridianIn, true)} />}
				{isVisible('pierSide') && <Extra label="PIER SIDE" value={position.pierSide} />}
				{'illuminated' in position && isVisible('illuminated') && <Extra label="ILLUM (%)" value={position.illuminated.toFixed(2)} />}
				{'elongation' in position && isVisible('elongation') && <Extra label="ELON (°)" value={toDeg(position.elongation).toFixed(2)} />}
			</div>
		</div>
	)
})

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
