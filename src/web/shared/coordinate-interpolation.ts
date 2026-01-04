// https://cdn.astrobin.com/static/astrobin_apps_platesolving/js/CoordinateInterpolation.1733091e5e90.js

import type { NumberArray } from 'nebulosa/src/math'
import { BicubicSplineInterpolation } from './bicubic-interpolation'

export class CoordinateInterpolator {
	private readonly Ia: BicubicSplineInterpolation
	private readonly Id: BicubicSplineInterpolation

	constructor(
		Ma: NumberArray,
		Md: NumberArray,
		private readonly x0: number,
		private readonly y0: number,
		x1: number,
		y1: number,
		private readonly delta: number,
	) {
		x0 = Math.min(x0, x1)
		x1 = Math.max(x0, x1)
		y0 = Math.min(y0, y1)
		y1 = Math.max(y0, y1)

		const w = x1 - x0
		const h = y1 - y0
		const r = 1 + Math.trunc(h / delta) + (h % delta !== 0 ? 1 : 0)
		const c = 1 + Math.trunc(w / delta) + (w % delta !== 0 ? 1 : 0)

		if (r < 2 || c < 2) throw new Error('insufficient interpolation space.')
		if (Ma.length !== r * c || Md.length !== Ma.length) throw new Error('invalid matrix dimensions.')

		this.Ia = new BicubicSplineInterpolation(Ma, c, r)
		this.Id = new BicubicSplineInterpolation(Md, c, r)
	}

	interpolate(x: number, y: number) {
		const fx = (x - this.x0) / this.delta
		const fy = (y - this.y0) / this.delta
		const alpha = this.Ia.interpolate(fx, fy)
		const delta = this.Id.interpolate(fx, fy)
		return [alpha, delta] as const
	}
}
