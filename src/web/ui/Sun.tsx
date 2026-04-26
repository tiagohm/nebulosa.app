import { memo, useEffect, useRef } from 'react'
import { SOLAR_IMAGE_SOURCE_URLS, type SolarImageSource } from 'src/shared/types'
import sunWebp from '@/assets/sun.webp'
import { API_URL } from '@/shared/api'
import { Link } from './Link'
import { SolarImageSourceSelect } from './SolarImageSourceSelect'

export interface SunProps {
	readonly source: SolarImageSource
	readonly onSourceChange: (source: SolarImageSource) => void
}

// NOTE: The contrast filter is used to make the image's background color from 0 to 10 (#101010)
// The formula of "b" parameter of linear transformation for contrast filter is (128 - color) / 128 => (128 - 10) / 128 = 0.921875

export const Sun = memo(({ source, onSourceChange }: SunProps) => {
	const imgRef = useRef<HTMLImageElement | undefined>(null)

	function update() {
		imgRef.current!.src = `${API_URL}/atlas/sun/image?source=${source}`
	}

	function assignRef(ref?: HTMLImageElement | null) {
		if (ref) {
			ref.addEventListener('error', handleOnError)
		} else {
			imgRef.current?.removeEventListener('error', handleOnError)
		}

		imgRef.current = ref
	}

	useEffect(() => {
		const timer = setInterval(update, 1000 * 60 * 15) // 15 min

		return () => {
			clearInterval(timer)
		}
	}, [source])

	function handleOnError(event: ErrorEvent) {
		const target = event.target as HTMLImageElement
		target.removeEventListener('error', handleOnError) // Prevents looping
		target.src = sunWebp
	}

	return (
		<div className="flex min-w-20 flex-col items-center justify-center gap-1">
			<SolarImageSourceSelect fullWidth onValueChange={onSourceChange} value={source} />
			<img className="h-auto w-full max-w-54 contrast-[0.921875] select-none" draggable={false} ref={assignRef} src={`${API_URL}/atlas/sun/image?source=${source}`} />
			<Link href={SOLAR_IMAGE_SOURCE_URLS[source].replace('256', '1024')} label="NASA/SDO" />
		</div>
	)
})
