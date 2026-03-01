import { type Angle, formatAZ, formatDEC, formatHMS, formatRA, toDeg } from 'nebulosa/src/angle'
import type React from 'react'
import { Activity } from 'react'
import type { BodyPosition, CoordinateInfo } from 'src/shared/types'
import { formatDistance, tw } from '@/shared/util'

export type CoordinateType = 'equatorial' | 'equatorialJ2000' | 'horizontal' | 'ecliptic' | 'galactic'

export interface BodyCoordinateInfoProps {
	readonly position: CoordinateInfo | BodyPosition
	readonly hide?: readonly (keyof BodyPosition)[]
}

export function BodyCoordinateInfo({ position, hide }: BodyCoordinateInfoProps) {
	return (
		<div className='w-full grid grid-cols-20 gap-2'>
			<div className='col-span-12 flex flex-col gap-0 justify-start'>
				<Coordinate isVisible={!hide?.length || !hide.includes('equatorialJ2000')} type='equatorialJ2000' x={position.equatorialJ2000[0]} y={position.equatorialJ2000[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('equatorial')} type='equatorial' x={position.equatorial[0]} y={position.equatorial[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('horizontal')} type='horizontal' x={position.horizontal[0]} y={position.horizontal[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('ecliptic')} type='ecliptic' x={position.ecliptic[0]} y={position.ecliptic[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('galactic')} type='galactic' x={position.galactic[0]} y={position.galactic[1]} />
				<div className='grid grid-cols-2 items-center gap-2'>{'distance' in position && <Extra className='col-span-1' isVisible={!hide?.length || !hide.includes('distance')} label='DIST' value={formatDistance(position.distance)} />}</div>
			</div>
			<div className='col-span-8 flex flex-col justify-start gap-0'>
				<Extra isVisible={!hide?.length || !hide.includes('constellation')} label='CONST' value={position.constellation} />
				<Extra isVisible={!hide?.length || !hide.includes('lst')} label='LST' value={formatHMS(position.lst, true)} />
				<Extra isVisible={!hide?.length || !hide.includes('meridianIn')} label='MERIDIAN IN' value={formatHMS(position.meridianIn, true)} />
				<Extra isVisible={!hide?.length || !hide.includes('pierSide')} label='PIER SIDE' value={position.pierSide} />
				{'illuminated' in position && <Extra className='col-span-5' isVisible={!hide?.length || !hide.includes('illuminated')} label='ILLUM (%)' value={position.illuminated.toFixed(2)} />}
				{'elongation' in position && <Extra className='col-span-1' isVisible={!hide?.length || !hide.includes('elongation')} label='ELON (°)' value={toDeg(position.elongation).toFixed(2)} />}
			</div>
		</div>
	)
}

interface CoordinateProps {
	readonly type: CoordinateType
	readonly x: Angle
	readonly y: Angle
	readonly isVisible?: boolean
}

function Coordinate({ type, x, y, isVisible = true }: CoordinateProps) {
	return (
		<Activity mode={isVisible ? 'visible' : 'hidden'}>
			<div className='grid grid-cols-12 items-center text-sm leading-3'>
				<span className='col-span-5 font-bold text-xs'>{type === 'equatorial' ? 'RA/DEC' : type === 'equatorialJ2000' ? 'RA/DEC (J2000)' : type === 'horizontal' ? 'AZ/ALT' : type === 'ecliptic' ? 'ECL LON/LAT' : 'GAL LON/LAT'}:</span>
				<span className='col-span-3 text-end'>{type === 'equatorial' || type === 'equatorialJ2000' ? formatRA(x, true) : formatAZ(x, true)}</span>
				<span className='col-span-4 text-end'>{formatDEC(y, true)}</span>
			</div>
		</Activity>
	)
}

interface ExtraProps extends React.ComponentProps<'div'> {
	readonly label: string
	readonly value: string | number
	readonly isVisible?: boolean
}

function Extra({ label, value, className, isVisible = true, ...props }: ExtraProps) {
	return (
		<Activity mode={isVisible ? 'visible' : 'hidden'}>
			<div {...props} className={tw(className, 'flex flex-row items-center justify-between text-sm leading-3')}>
				<span className='font-bold text-xs'>{label}:</span>
				<span>{value}</span>
			</div>
		</Activity>
	)
}
