import type { GuidingStarProfile } from 'api'
import type { ReactNode } from 'react'
import { Notice } from '../equipment-control/parts'
import { PanelSection } from '../shell/ContextualPanel'

// Star Profile section of the Guiding panel: the horizontal and vertical cuts through the guide star of the latest
// measured frame, plotted above its half maximum, and every measurement of its profile (position, quality, SNR, flux,
// peak, background and noise, HFD, FWHM and its axes, shape and orientation, the model, and the flags of a degraded
// measurement). Positions and widths are guide-camera pixels, with arcseconds when the pixel scale is known;
// intensities are ADU for an integer frame and normalized samples for a floating one.

// Size of the plot in its own units; it scales to the width of the panel.
const PLOT_WIDTH = 240
const PLOT_HEIGHT = 96

// Inner margin of the plot, in plot units.
const PLOT_MARGIN = 4

// Labels of the flags of a degraded or invalid measurement.
const FLAG_LABELS: Readonly<Record<GuidingStarProfile['flags'][number], string>> = {
	nonFinite: 'Non-finite samples',
	nearBorder: 'Near the border',
	clipped: 'Clipped aperture',
	saturated: 'Saturated',
	lowSignal: 'Low signal',
	invalidBackground: 'Invalid background',
	invalidCentroid: 'Invalid centroid',
	degenerateShape: 'Degenerate shape',
	blended: 'Blended',
	poorFit: 'Poor fit',
}

interface StarProfileSectionProps {
	// Profile of the guide star of the latest measured frame.
	readonly star: GuidingStarProfile
	// Arcseconds per guide-camera pixel; absent while unknown.
	readonly pixelScale?: number
	// Latest frame of the session, to tell a profile of an older frame.
	readonly frameId?: number
}

// Plot and measurements of the guide star.
export function StarProfileSection({ star, pixelScale, frameId }: StarProfileSectionProps) {
	const stale = frameId !== undefined && frameId !== star.frameId

	return (
		<PanelSection title="Star Profile">
			<ProfilePlot star={star} />
			<p className="m-0 flex flex-wrap gap-x-3 text-xs leading-4 text-ink-300">
				<span className="whitespace-nowrap text-accent">— Horizontal</span>
				<span className="whitespace-nowrap text-success">— Vertical</span>
				<span className="whitespace-nowrap">- - Half maximum</span>
			</p>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="Frame">{`#${star.frameId}`}</Row>
				<Row label="Position">{`${star.x.toFixed(2)}, ${star.y.toFixed(2)} px`}</Row>
				<Row label="Valid">
					<span className={star.valid ? 'text-success' : 'text-danger'}>{star.valid ? 'Yes' : 'No'}</span>
				</Row>
				<Row label="Quality">{star.quality.toFixed(2)}</Row>
				<Row label="SNR">{formatNumber(star.snr, 1)}</Row>
				<Row label="Flux">{formatIntensity(star.flux, star.adu)}</Row>
				<Row label="Peak">{formatIntensity(star.peak, star.adu)}</Row>
				<Row label="Background">{formatIntensity(star.background, star.adu)}</Row>
				<Row label="Noise (σ)">{formatIntensity(star.deviation, star.adu)}</Row>
				<Row label="HFD">{formatWidth(star.hfd, pixelScale)}</Row>
				<Row label="FWHM">{formatWidth(star.fwhm, pixelScale)}</Row>
				<Row label="FWHM Major / Minor">{star.major === undefined || star.minor === undefined ? '—' : `${star.major.toFixed(2)} / ${star.minor.toFixed(2)} px`}</Row>
				<Row label="Eccentricity">{formatNumber(star.eccentricity, 3)}</Row>
				<Row label="Elongation">{formatNumber(star.elongation, 3)}</Row>
				<Row label="Orientation">{star.theta === undefined ? '—' : `${((star.theta * 180) / Math.PI).toFixed(1)}°`}</Row>
				<Row label="Model">{star.model === 'moffat' ? 'Moffat' : 'Moments'}</Row>
			</dl>
			{star.flags.length > 0 && <Notice>{star.flags.map((flag) => FLAG_LABELS[flag]).join(', ')}.</Notice>}
			{stale && <Notice>The latest frame was not measured; this is the star of frame #{star.frameId}.</Notice>}
		</PanelSection>
	)
}

// Plot of the two cuts through the star over the same offsets, with its half maximum dashed.
function ProfilePlot({ star }: { readonly star: GuidingStarProfile }) {
	const { horizontal, vertical } = star
	const values = [...horizontal.values, ...vertical.values]
	const top = Math.max(Number.MIN_VALUE, ...values)
	const bottom = Math.min(0, ...values)
	const first = Math.min(horizontal.from, vertical.from)
	const last = Math.max(horizontal.from + horizontal.values.length, vertical.from + vertical.values.length) - 1
	const sx = (offset: number) => PLOT_MARGIN + ((offset - first) / Math.max(1, last - first)) * (PLOT_WIDTH - 2 * PLOT_MARGIN)
	const sy = (value: number) => PLOT_HEIGHT - PLOT_MARGIN - ((value - bottom) / (top - bottom)) * (PLOT_HEIGHT - 2 * PLOT_MARGIN)
	const points = (from: number, samples: readonly number[]) => samples.map((value, index) => `${sx(from + index).toFixed(1)},${sy(value).toFixed(1)}`).join(' ')

	return (
		<svg viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} className="block h-auto w-full rounded-md border border-line-100 bg-base-100">
			<line x1={PLOT_MARGIN} x2={PLOT_WIDTH - PLOT_MARGIN} y1={sy(0)} y2={sy(0)} stroke="var(--color-line-200)" />
			<line x1={sx(0)} x2={sx(0)} y1={PLOT_MARGIN} y2={PLOT_HEIGHT - PLOT_MARGIN} stroke="var(--color-line-100)" />
			<line x1={PLOT_MARGIN} x2={PLOT_WIDTH - PLOT_MARGIN} y1={sy(top / 2)} y2={sy(top / 2)} stroke="var(--color-ink-300)" strokeDasharray="3 3" />
			<polyline points={points(horizontal.from, horizontal.values)} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
			<polyline points={points(vertical.from, vertical.values)} fill="none" stroke="var(--color-success)" strokeWidth={1.5} />
		</svg>
	)
}

// Label and value of a row; a long value wraps instead of being cut.
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="contents">
			<dt className="text-ink-300">{label}</dt>
			<dd className="m-0 min-w-0 text-right tabular-nums">{children}</dd>
		</div>
	)
}

// Formats an optional number with digits decimals, or a dash when it is absent.
function formatNumber(value: number | undefined, digits: number) {
	return value === undefined ? '—' : value.toFixed(digits)
}

// Formats an optional intensity given in normalized samples: whole ADU when adu (ADU per normalized unit) is above 1,
// else the normalized value.
function formatIntensity(value: number | undefined, adu: number) {
	if (value === undefined) return '—'
	return adu > 1 ? `${Math.round(value * adu)} ADU` : value.toFixed(4)
}

// Formats an optional width given in pixels, with its value in arcseconds when the pixel scale (arcsec/px) is known.
function formatWidth(pixels: number | undefined, pixelScale?: number) {
	if (pixels === undefined) return '—'
	return pixelScale === undefined ? `${pixels.toFixed(2)} px` : `${pixels.toFixed(2)} px (${(pixels * pixelScale).toFixed(2)}")`
}
