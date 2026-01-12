import { type Angle, formatAZ, formatDEC, formatHMS, formatRA } from 'nebulosa/src/angle'
import { Activity, memo } from 'react'
import type { BodyPosition, CoordinateInfo } from 'src/shared/types'

export type CoordinateType = 'equatorial' | 'equatorialJ2000' | 'horizontal' | 'ecliptic' | 'galactic'

export interface BodyCoordinateInfoProps {
	readonly position: CoordinateInfo | BodyPosition
	readonly hide?: readonly (CoordinateType | 'constellation' | 'lst' | 'meridianIn' | 'pierSide')[]
}

export const BodyCoordinateInfo = memo(({ position, hide }: BodyCoordinateInfoProps) => {
	return (
		<div className='w-full grid grid-cols-20 gap-2'>
			<div className='col-span-11 flex flex-col gap-0 justify-center'>
				<Coordinate isVisible={!hide?.length || !hide.includes('equatorialJ2000')} type='equatorialJ2000' x={position.equatorialJ2000[0]} y={position.equatorialJ2000[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('equatorial')} type='equatorial' x={position.equatorial[0]} y={position.equatorial[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('horizontal')} type='horizontal' x={position.horizontal[0]} y={position.horizontal[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('ecliptic')} type='ecliptic' x={position.ecliptic[0]} y={position.ecliptic[1]} />
				<Coordinate isVisible={!hide?.length || !hide.includes('galactic')} type='galactic' x={position.galactic[0]} y={position.galactic[1]} />
			</div>
			<div className='col-span-9 text-sm flex flex-col justify-end gap-0'>
				<Extra isVisible={!hide?.length || !hide.includes('constellation')} label='CONST' value={position.constellation} />
				<Extra isVisible={!hide?.length || !hide.includes('lst')} label='LST' value={formatHMS(position.lst, true)} />
				<Extra isVisible={!hide?.length || !hide.includes('meridianIn')} label='MERIDIAN IN' value={formatHMS(position.meridianIn, true)} />
				<Extra isVisible={!hide?.length || !hide.includes('pierSide')} label='PIER SIDE' value={position.pierSide} />
			</div>
		</div>
	)
})

interface CoordinateProps {
	readonly type: CoordinateType
	readonly x: Angle
	readonly y: Angle
	readonly isVisible?: boolean
}

const Coordinate = memo(({ type, x, y, isVisible = true }: CoordinateProps) => {
	return (
		<Activity mode={isVisible ? 'visible' : 'hidden'}>
			<div className='grid grid-cols-12 items-center text-sm leading-3'>
				<span className='col-span-4 font-bold text-xs'>{type === 'equatorial' ? 'RA/DEC' : type === 'equatorialJ2000' ? 'RA/DEC (J2000)' : type === 'horizontal' ? 'AZ/ALT' : type === 'ecliptic' ? 'ECL LON/LAT' : 'GAL LON/LAT'}:</span>
				<span className='col-span-4 text-end'>{type === 'equatorial' || type === 'equatorialJ2000' ? formatRA(x, true) : formatAZ(x, true)}</span>
				<span className='col-span-4 text-end'>{formatDEC(y, true)}</span>
			</div>
		</Activity>
	)
})

interface ExtraProps {
	readonly label: string
	readonly value: string | number
	readonly isVisible?: boolean
}

const Extra = memo(({ label, value, isVisible = true }: ExtraProps) => {
	return (
		<Activity mode={isVisible ? 'visible' : 'hidden'}>
			<div className='flex flex-row items-center justify-between'>
				<span className='font-bold'>{label}:</span>
				<span>{value}</span>
			</div>
		</Activity>
	)
})
