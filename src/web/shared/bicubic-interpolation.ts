import type { NumberArray } from 'nebulosa/src/math'

export type Coefficients = [number, number, number, number]

export class BicubicInterpolationBase {
	private readonly buffer: [Coefficients, Coefficients, Coefficients, Coefficients] = [
		[0, 0, 0, 0],
		[0, 0, 0, 0],
		[0, 0, 0, 0],
		[0, 0, 0, 0],
	]

	constructor(
		protected M: NumberArray,
		protected cols: number,
		protected rows: number,
	) {}

	protected initXY(x: number, y: number) {
		const i1 = Math.min(Math.max(0, Math.trunc(y)), this.rows - 1)
		const j1 = Math.min(Math.max(0, Math.trunc(x)), this.cols - 1)

		const j0 = j1 - 1
		const i0 = i1 - 1
		const j2 = j1 + 1
		const i2 = i1 + 1
		const j3 = j1 + 2
		const i3 = i1 + 2

		let fp = i0 * this.cols + j0

		if (i0 < 0) fp += this.cols
		const p0 = this.row(fp, j0, j2, j3, this.buffer[0])

		if (i0 >= 0) fp += this.cols
		const p1 = this.row(fp, j0, j2, j3, this.buffer[1])

		if (i2 < this.rows) fp += this.cols
		const p2 = this.row(fp, j0, j2, j3, this.buffer[2])

		if (i3 < this.rows) fp += this.cols
		const p3 = this.row(fp, j0, j2, j3, this.buffer[3])

		return [i1, j1, p0, p1, p2, p3] as const
	}

	// Fill an existing output buffer (out) with the four sample values for the row
	row(fp: number, j0: number, j2: number, j3: number, out: Coefficients) {
		if (j0 < 0) ++fp
		out[0] = this.M[fp]!

		if (j0 >= 0) ++fp
		out[1] = this.M[fp]!

		if (j2 < this.cols) {
			out[2] = this.M[++fp]!
			if (j3 < this.cols) ++fp
			out[3] = this.M[fp]!
		} else {
			out[2] = this.M[fp]!
			out[3] = this.M[fp - 1]!
		}

		return out
	}
}

export class BicubicSplineInterpolation extends BicubicInterpolationBase {
	private readonly cx: Coefficients = [0, 0, 0, 0]
	private readonly cy: Coefficients = [0, 0, 0, 0]
	private readonly clamp: number

	constructor(M: NumberArray, cols: number, rows: number, clamp?: number) {
		super(M, cols, rows)
		this.clamp = clamp === undefined || clamp < 0 || clamp > 1 ? 0.3 : clamp
	}

	interpolate(x: number, y: number) {
		const [i1, j1, p0, p1, p2, p3] = this.initXY(x, y)

		this.coefficients(x - j1, this.cx)
		const a0 = this.spline(p0, this.cx)
		const a1 = this.spline(p1, this.cx)
		const a2 = this.spline(p2, this.cx)
		const a3 = this.spline(p3, this.cx)

		this.coefficients(y - i1, this.cy)
		const f12 = a1 * this.cy[1] + a2 * this.cy[2]
		const f03 = a0 * this.cy[0] + a3 * this.cy[3]
		return -f03 < f12 * this.clamp ? f12 + f03 : f12 / (this.cy[1] + this.cy[2])
	}

	private coefficients(dx: number, dest: Coefficients) {
		const dx2 = dx * dx
		const dx3 = dx2 * dx
		const dx1p2 = dx / 2
		const dx2p2 = dx2 / 2
		const dx3p2 = dx3 / 2
		const dx22 = dx2 + dx2
		const dx315 = dx3 + dx3p2
		dest[0] = dx2 - dx3p2 - dx1p2
		dest[1] = dx315 - dx22 - dx2p2 + 1
		dest[2] = dx22 - dx315 + dx1p2
		dest[3] = dx3p2 - dx2p2
	}

	private spline(p: Readonly<Coefficients>, C: Readonly<Coefficients>) {
		const f12 = p[1] * C[1] + p[2] * C[2]
		const f03 = p[0] * C[0] + p[3] * C[3]
		return -f03 < f12 * this.clamp ? f12 + f03 : f12 / (C[1] + C[2])
	}
}
