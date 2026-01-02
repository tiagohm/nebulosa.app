import { memo, useEffect, useRef } from 'react'
import { SOLAR_IMAGE_SOURCE_URLS, type SolarImageSource } from 'src/shared/types'
import sunWebp from '@/assets/sun.webp'
import { API_URL } from '@/shared/api'
import { PoweredBy } from './PoweredBy'
import { SolarImageSourceDropdown } from './SolarImageSourceDropdown'

export interface SunProps {
	readonly source: SolarImageSource
	readonly onSourceChange: (source: SolarImageSource) => void
}

// NOTE: The contrast filter is used to make the image's background color from 0 to 24 (#181818)
// The formula of "b" parameter of linear transformation for contrast filter is (128 - color) / 128 => (128 - 24) / 128 = 0.8125

export const Sun = memo(({ source, onSourceChange }: SunProps) => {
	const imgRef = useRef<HTMLImageElement>(null)

	useEffect(() => {
		const timer = setInterval(
			() => {
				imgRef.current!.src = `${API_URL}/atlas/sun/image?source=${source}`
			},
			1000 * 60 * 15,
		) // 15 min

		return () => {
			clearInterval(timer)
		}
	}, [source])

	function handleOnError(event: React.SyntheticEvent<HTMLImageElement, Event>) {
		const target = event.target as HTMLImageElement
		target.onerror = null // Prevents looping
		target.src = sunWebp
	}

	return (
		<span className='relative min-w-20'>
			<SolarImageSourceDropdown className='absolute left-1 right-1 top-1' onValueChange={onSourceChange} value={source} />
			<img className='pt-8 select-none max-w-54 w-full h-auto contrast-[0.8125]' draggable={false} onError={handleOnError} ref={imgRef} src={`${API_URL}/atlas/sun/image?source=${source}`} />
			<PoweredBy className='absolute' href={SOLAR_IMAGE_SOURCE_URLS[source].replace('256', '1024')} label='NASA/SDO' />
		</span>
	)
})
