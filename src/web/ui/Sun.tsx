import { memo } from 'react'
import type { SolarImageSource } from 'src/shared/types'
import { URL } from '@/shared/api'
import { SolarImageSourceDropdown } from './SolarImageSourceDropdown'

export interface SunProps {
	readonly source: SolarImageSource
	readonly onSourceChange: (source: SolarImageSource) => void
}

export const Sun = memo(({ source, onSourceChange }: SunProps) => {
	return (
		<span className='relative'>
			<SolarImageSourceDropdown className='absolute left-1 right-1 top-1' onValueChange={onSourceChange} value={source} />
			<img className='pt-8 select-none' draggable={false} src={`${URL}/atlas/sun/image?source=${source}`} width={220} />
		</span>
	)
})
