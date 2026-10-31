import type { StarProfileMeasured } from 'api'
import { useEffect, useRef } from 'react'
import { previewPixels, profileEllipse } from './starprofile'
import type { StarProfileSettings } from './starprofile.settings'

// Preview of a measured star: the samples the server measured around it, never the stretched rendering of the image,
// one square per pixel from the sky at black to its peak at white, whatever its display settings, with the pixel grid,
// its centroid, its half-flux circle, and the ellipse of its FWHM axes drawn over them. It fills the width of its panel.

interface StarPreviewProps {
	// Measured star.
	readonly star: Pick<StarProfileMeasured, 'preview' | 'profile'>
	// What is drawn over the samples.
	readonly settings: Pick<StarProfileSettings, 'grid' | 'ellipse' | 'halfFlux'>
}

// Samples around a star, with its marks.
export function StarPreview({ star, settings }: StarPreviewProps) {
	const { preview, profile } = star
	const { left, top, width, height } = preview
	const canvas = useRef<HTMLCanvasElement>(null)
	const background = profile.background ?? 0
	const peak = profile.peak ?? 0
	const cx = profile.x - left + 0.5
	const cy = profile.y - top + 0.5
	const ellipse = settings.ellipse ? profileEllipse(profile) : undefined

	useEffect(() => {
		canvas.current?.getContext('2d')?.putImageData(new ImageData(previewPixels(preview, background, background + peak), width, height), 0, 0)
	}, [preview, background, peak, width, height])

	return (
		<div className="relative overflow-hidden rounded-md border border-line-100 bg-black">
			<canvas ref={canvas} width={width} height={height} className="block h-auto w-full [image-rendering:pixelated]" />
			<svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 size-full">
				<title>{`${width} × ${height} pixels around the star`}</title>
				{settings.grid && (
					<g stroke="var(--color-line-200)" strokeOpacity={0.35} strokeWidth={1}>
						{Array.from({ length: width - 1 }, (_, i) => (
							<line key={i} x1={i + 1} x2={i + 1} y1={0} y2={height} vectorEffect="non-scaling-stroke" />
						))}
						{Array.from({ length: height - 1 }, (_, i) => (
							<line key={i} x1={0} x2={width} y1={i + 1} y2={i + 1} vectorEffect="non-scaling-stroke" />
						))}
					</g>
				)}
				<g fill="none" stroke="var(--color-accent)" strokeWidth={1.5}>
					<line x1={cx - 1.5} x2={cx + 1.5} y1={cy} y2={cy} vectorEffect="non-scaling-stroke" />
					<line x1={cx} x2={cx} y1={cy - 1.5} y2={cy + 1.5} vectorEffect="non-scaling-stroke" />
					{settings.halfFlux && profile.hfd !== undefined && <circle cx={cx} cy={cy} r={profile.hfd / 2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
					{ellipse && <ellipse cx={cx} cy={cy} rx={ellipse.rx} ry={ellipse.ry} transform={`rotate(${ellipse.rotation} ${cx} ${cy})`} vectorEffect="non-scaling-stroke" />}
				</g>
			</svg>
		</div>
	)
}
