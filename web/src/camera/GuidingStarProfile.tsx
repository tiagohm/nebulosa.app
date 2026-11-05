import type { GuidingStarProfile } from 'api'
import { Notice } from '../equipment-control/parts'
import { formatPixelLength, formatDegrees, MISSING } from '../format'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { FLAG_LABELS, formatNumber } from '../stars/starprofile.format'
import { consecutiveOffsets } from '../stars/starprofile.plot'
import { StarProfilePlot } from '../stars/StarProfilePlot'
import { DataList, DataRow } from '../ui/DataRow'

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
			<DataList>
				<DataRow label="Frame">{`#${star.frameId}`}</DataRow>
				<DataRow label="Position (px)">{`${star.x.toFixed(1)}, ${star.y.toFixed(1)}`}</DataRow>
				<DataRow label="Valid">
					<span className={star.valid ? 'text-success' : 'text-danger'}>{star.valid ? 'Yes' : 'No'}</span>
				</DataRow>
				<DataRow label="Quality">{star.quality.toFixed(2)}</DataRow>
				<DataRow label="SNR">{formatNumber(star.snr, 1)}</DataRow>
				<DataRow label="Flux">{formatIntensity(star.flux, star.adu)}</DataRow>
				<DataRow label="Peak">{formatIntensity(star.peak, star.adu)}</DataRow>
				<DataRow label="Background">{formatIntensity(star.background, star.adu)}</DataRow>
				<DataRow label="Noise (σ)">{formatIntensity(star.deviation, star.adu)}</DataRow>
				<DataRow label="HFD">{formatPixelLength(star.hfd, pixelScale)}</DataRow>
				<DataRow label="FWHM">{formatPixelLength(star.fwhm, pixelScale)}</DataRow>
				<DataRow label="FWHM Major / Minor">{star.major === undefined || star.minor === undefined ? MISSING : `${star.major.toFixed(2)} / ${star.minor.toFixed(2)} px`}</DataRow>
				<DataRow label="Eccentricity">{formatNumber(star.eccentricity, 3)}</DataRow>
				<DataRow label="Elongation">{formatNumber(star.elongation, 3)}</DataRow>
				<DataRow label="Orientation">{star.theta === undefined ? MISSING : formatDegrees(star.theta, 1)}</DataRow>
				<DataRow label="Model">{star.model === 'moffat' ? 'Moffat' : 'Moments'}</DataRow>
			</DataList>
			{star.flags.length > 0 && <Notice>{star.flags.map((flag) => FLAG_LABELS[flag]).join(', ')}.</Notice>}
			{stale && <Notice>The latest frame was not measured; this is the star of frame #{star.frameId}.</Notice>}
		</CollapsibleSection>
	)
}

// Formats an optional intensity given in normalized samples: whole ADU when adu (ADU per normalized unit) is above 1,
// else the normalized value.
function formatIntensity(value: number | undefined, adu: number) {
	if (value === undefined) return MISSING
	return adu > 1 ? `${Math.round(value * adu)} ADU` : value.toFixed(4)
}
