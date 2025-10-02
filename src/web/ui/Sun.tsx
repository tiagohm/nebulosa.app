import { memo } from 'react'
import type { SolarImageSource } from 'src/shared/types'
import sunWebp from '@/assets/sun.webp'
import { API_URL } from '@/shared/api'
import { Credit } from './Credit'
import { SolarImageSourceDropdown } from './SolarImageSourceDropdown'

export interface SunProps {
	readonly source: SolarImageSource
	readonly onSourceChange: (source: SolarImageSource) => void
}

export const Sun = memo(({ source, onSourceChange }: SunProps) => {
	function handleOnError(event: React.SyntheticEvent<HTMLImageElement, Event>) {
		const target = event.target as HTMLImageElement
		target.onerror = null // Prevents looping
		target.src = sunWebp
	}

	return (
		<span className='relative'>
			<SolarImageSourceDropdown className='absolute left-1 right-1 top-1' onValueChange={onSourceChange} value={source} />
			<img className='pt-8 select-none max-w-54 w-full h-auto' draggable={false} onError={handleOnError} src={`${API_URL}/atlas/sun/image?source=${source}`} />
			<Credit href='https://sdo.gsfc.nasa.gov/data/' label='NASA/SDO' />
		</span>
	)
})
