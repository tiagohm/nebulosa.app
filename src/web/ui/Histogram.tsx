import { memo, useEffect, useRef } from 'react'
import type { ImageHistogram } from 'src/shared/types'

export interface HistogramProps extends React.HTMLAttributes<HTMLCanvasElement> {
	readonly histogram: readonly ImageHistogram[]
}

function draw(ctx: CanvasRenderingContext2D, histogram: ImageHistogram, maxCount: number, color: string | CanvasGradient | CanvasPattern) {
	const { data } = histogram
	const { width, height } = ctx.canvas
	const n = data.length

	if (n) {
		const stepX = width / n
		const stepY = height / maxCount

		ctx.fillStyle = color

		for (let i = 0, x = -0.5; i < n; i++, x += stepX) {
			const value = data[i]
			value > 0 && ctx.fillRect(x, height - 0.5 - value * stepY, 1, 1)
		}
	}
}

export const Histogram = memo(({ histogram, ...props }: HistogramProps) => {
	const canvas = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		if (canvas.current) {
			const { width, height } = canvas.current
			const ctx = canvas.current.getContext('2d')
			const [red, green, blue] = histogram

			if (ctx) {
				ctx.clearRect(0, 0, width, height)

				const maxCount = Math.max(red?.count[1] ?? 0, green?.count[1] ?? 0, blue?.count[1] ?? 0)

				red && draw(ctx, red, maxCount, histogram.length === 1 ? 'gray' : 'red')
				green && draw(ctx, green, maxCount, 'green')
				blue && draw(ctx, blue, maxCount, 'blue')
			}
		}
	}, [canvas, histogram])

	return <canvas ref={canvas} {...props} />
})
