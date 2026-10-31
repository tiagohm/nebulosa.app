import type { GuidingStarProfile } from 'api'
import { Notice } from '../equipment-control/parts'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { FLAG_LABELS, formatNumber, formatWidth } from '../stars/starprofile.format'
import { consecutiveOffsets } from '../stars/starprofile.plot'
import { StarProfilePlot } from '../stars/StarProfilePlot'
import { StarProfileRow as Row } from '../stars/StarProfileRow'

// Star Profile section of the Guiding panel: the horizontal and vertical cuts through the guide star of the latest
// measured frame, plotted above its half maximum, and every measurement of its profile (position, quality, SNR, flux,
// peak, background and noise, HFD, FWHM and its axes, shape and orientation, the model, and the flags of a degraded
// measurement). Positions and widths are guide-camera pixels, with arcseconds when the pixel scale is known;
// intensities are ADU for an integer frame and normalized samples for a floating one.

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
	const { horizontal, vertical } = star

	return (
		<CollapsibleSection id="images.guiding.star-profile" title="Star Profile">
			<StarProfilePlot
				series={[
					{ offsets: consecutiveOffsets(horizontal.from, horizontal.values.length), values: horizontal.values, stroke: 'var(--color-accent)' },
					{ offsets: consecutiveOffsets(vertical.from, vertical.values.length), values: vertical.values, stroke: 'var(--color-success)' },
				]}
			/>
			<p className="m-0 flex flex-wrap gap-x-3 text-xs leading-4 text-ink-300">
				<span className="whitespace-nowrap text-accent">— Horizontal</span>
				<span className="whitespace-nowrap text-success">— Vertical</span>
				<span className="whitespace-nowrap">- - Half maximum</span>
			</p>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="Frame">{`#${star.frameId}`}</Row>
				<Row label="Position (px)">{`${star.x.toFixed(1)}, ${star.y.toFixed(1)}`}</Row>
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
		</CollapsibleSection>
	)
}

// Formats an optional intensity given in normalized samples: whole ADU when adu (ADU per normalized unit) is above 1,
// else the normalized value.
function formatIntensity(value: number | undefined, adu: number) {
	if (value === undefined) return '—'
	return adu > 1 ? `${Math.round(value * adu)} ADU` : value.toFixed(4)
}
