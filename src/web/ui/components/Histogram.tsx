import { memo, useEffect, useRef, useState } from 'react'
import type { ImageHistogram } from 'src/shared/types'
import { assignRef } from '@/shared/util'

const CHANNEL_COLORS = ['rgba(255,82,82,0.72)', 'rgba(34,197,94,0.72)', 'rgba(96,165,250,0.72)'] as const
const MONO_COLOR = 'rgba(209,213,219,0.82)'

interface HistogramCanvasSize {
	readonly width: number
	readonly height: number
}

export interface HistogramProps extends Omit<React.ComponentPropsWithRef<'canvas'>, 'children'> {
	readonly histogram: readonly ImageHistogram[]
}

// Reads the displayed canvas size so the backing bitmap can match CSS layout.
function measureCanvas(canvas: HTMLCanvasElement): HistogramCanvasSize {
	const rect = canvas.getBoundingClientRect()

	return {
		width: Math.max(0, Math.round(rect.width || canvas.width)),
		height: Math.max(0, Math.round(rect.height || canvas.height)),
	}
}

// Returns the maximum bin count, falling back to the raw data if metadata is empty.
function maxHistogramCount(histograms: readonly ImageHistogram[]) {
	let maxCount = 0

	for (const histogram of histograms) {
		const count = histogram.count[1]
		if (Number.isFinite(count) && count > maxCount) maxCount = count
	}

	if (maxCount > 0) return maxCount

	for (const histogram of histograms) {
		for (const value of histogram.data) {
			if (Number.isFinite(value) && value > maxCount) maxCount = value
		}
	}

	return maxCount
}

// Draws a vertical bar for a normalized histogram bucket.
function drawBar(ctx: CanvasRenderingContext2D, x: number, width: number, value: number, maxCount: number) {
	const { height } = ctx.canvas
	const barHeight = Math.max(1, Math.ceil((Math.min(value, maxCount) / maxCount) * height))

	ctx.fillRect(x, height - barHeight, width, barHeight)
}

// Draws one channel by aggregating bins into visible canvas columns.
function drawChannel(ctx: CanvasRenderingContext2D, histogram: ImageHistogram, maxCount: number, color: string) {
	const { data } = histogram
	const { width } = ctx.canvas
	const binCount = data.length

	if (binCount === 0 || width === 0 || maxCount <= 0) return

	ctx.fillStyle = color

	if (binCount <= width) {
		for (let i = 0; i < binCount; i++) {
			const value = data[i]
			if (!Number.isFinite(value) || value <= 0) continue

			const x = Math.floor((i * width) / binCount)
			const nextX = Math.max(x + 1, Math.floor(((i + 1) * width) / binCount))
			drawBar(ctx, x, nextX - x, value, maxCount)
		}

		return
	}

	for (let x = 0; x < width; x++) {
		const start = Math.floor((x * binCount) / width)
		const end = Math.min(binCount, Math.floor(((x + 1) * binCount) / width))
		let value = 0

		for (let i = start; i < end; i++) {
			const nextValue = data[i]
			if (Number.isFinite(nextValue) && nextValue > value) value = nextValue
		}

		if (value > 0) drawBar(ctx, x, 1, value, maxCount)
	}
}

// Clears and redraws every visible histogram channel on the canvas.
function draw(ctx: CanvasRenderingContext2D, histograms: readonly ImageHistogram[]) {
	const { width, height } = ctx.canvas

	ctx.clearRect(0, 0, width, height)

	if (width === 0 || height === 0 || histograms.length === 0) return

	const maxCount = maxHistogramCount(histograms)
	const isMono = histograms.length === 1

	for (let i = 0; i < Math.min(histograms.length, CHANNEL_COLORS.length); i++) {
		const histogram = histograms[i]
		drawChannel(ctx, histogram, maxCount, isMono ? MONO_COLOR : CHANNEL_COLORS[i])
	}
}

export const Histogram = memo(({ histogram, ref, ...props }: HistogramProps) => {
	const canvas = useRef<HTMLCanvasElement>(null)
	const [canvasSize, setCanvasSize] = useState<HistogramCanvasSize>({ height: 0, width: 0 })

	useEffect(() => {
		const canvasElement = canvas.current
		if (canvasElement === null) return
		const observedCanvas = canvasElement

		// Tracks CSS size changes so redraws use the current displayed dimensions.
		function updateCanvasSize() {
			setCanvasSize((previous) => {
				const next = measureCanvas(observedCanvas)
				return previous.width === next.width && previous.height === next.height ? previous : next
			})
		}

		updateCanvasSize()

		const observer = new ResizeObserver(updateCanvasSize)
		observer.observe(observedCanvas)
		window.addEventListener('resize', updateCanvasSize)

		return () => {
			observer.disconnect()
			window.removeEventListener('resize', updateCanvasSize)
		}
	}, [])

	useEffect(() => {
		const canvasElement = canvas.current
		if (canvasElement === null) return

		const size = canvasSize.width > 0 && canvasSize.height > 0 ? canvasSize : measureCanvas(canvasElement)
		if (size.width === 0 || size.height === 0) return

		if (canvasElement.width !== size.width) canvasElement.width = size.width
		if (canvasElement.height !== size.height) canvasElement.height = size.height

		const ctx = canvasElement.getContext('2d')
		if (ctx === null) return

		draw(ctx, histogram)
	}, [canvasSize, histogram])

	// Stores the canvas element while preserving an optional caller ref.
	function handleCanvasRef(element: HTMLCanvasElement | null) {
		canvas.current = element
		assignRef(ref, element)
	}

	return <canvas ref={handleCanvasRef} {...props} />
})
