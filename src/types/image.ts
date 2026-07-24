import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { finiteNumber } from 'src/types/util'

export function screenDeltaInImage(screenX: number, screenY: number, scale: number, angle: number): Point {
	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
	const radians = finiteNumber(angle, 0) * (-Math.PI / 180)
	const x = finiteNumber(screenX, 0) / safeScale
	const y = finiteNumber(screenY, 0) / safeScale
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)

	return { x: x * cos - y * sin, y: x * sin + y * cos }
}
