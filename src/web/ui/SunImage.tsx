import sunWebp from '@assets/sun.real.webp'
import { API_URL } from '@shared/api'
import { Link } from '@ui/components/Link'
import { SolarImageSourceSelect } from '@ui/SolarImageSourceSelect'
import { memo, type SyntheticEvent, useEffect, useRef } from 'react'
import { SOLAR_IMAGE_SOURCE_URLS, type SolarImageSource } from 'src/shared/types'

export interface SunProps {
	readonly source: SolarImageSource
	readonly onSourceChange: (source: SolarImageSource) => void
}

// NOTE: The contrast filter is used to make the image's background color from 0 to 10 (#101010)
// The formula of "b" parameter of linear transformation for contrast filter is (128 - color) / 128 => (128 - 14) / 128 = 0.921875

export const SunImage = memo(({ source, onSourceChange }: SunProps) => {
	const imageRef = useRef<HTMLImageElement | null>(null)
	const errorCountRef = useRef(0)
	const errorTimerRef = useRef<number | undefined>(undefined)
	const src = `${API_URL}/atlas/sun/image?source=${source}`

	function refreshImage() {
		imageRef.current!.src = `${src}&refresh=${Date.now()}`
	}

	useEffect(() => {
		const timer = setInterval(refreshImage, 1000 * 60 * 15) // 15 min

		refreshImage()

		return () => {
			clearInterval(timer)
			clearTimeout(errorTimerRef.current)
		}
	}, [source, imageRef.current])

	function handleLoad() {
		errorCountRef.current = 0
	}

	function handleError(event: SyntheticEvent<HTMLImageElement>) {
		const target = event.currentTarget
		if (target.src !== sunWebp) target.src = sunWebp
		errorCountRef.current++
		if (errorCountRef.current > 10) return
		clearTimeout(errorTimerRef.current)
		errorTimerRef.current = window.setTimeout(refreshImage, 1000)
	}

	return (
		<div className="flex min-w-20 flex-col items-center justify-center gap-1">
			<SolarImageSourceSelect fullWidth onValueChange={onSourceChange} value={source} />
			<img ref={imageRef} className="h-auto w-full max-w-54 contrast-[0.875] select-none" draggable={false} onLoad={handleLoad} onError={handleError} src={sunWebp} />
			<Link href={SOLAR_IMAGE_SOURCE_URLS[source].replace('256', '1024')} label="Image source: NASA/SDO" />
		</div>
	)
})
