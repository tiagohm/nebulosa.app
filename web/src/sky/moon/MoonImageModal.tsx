import type { MoonAlmanacResponse } from 'api'
import { useSnapshot } from 'valtio'
import moon4k from '../../../assets/moon/moon.4k.jpg'
import { Modal } from '../../ui/Modal'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { MOON_IMAGE_CREDIT, MOON_PHASE_NAMES, moonOrientationCaption, moonState, setMoonViewUp } from './moon'
import type { MoonViewUp } from './moon.geometry'
import { MoonCanvas } from './MoonCanvas'

// Larger view of the Moon Inspector's drawing: the same appearance on the 4096×2048 color map, with the choice of
// zenith or celestial north up when there is an observer. The orientation is a presentation choice: it never changes
// the observer or the instant.

// Names of the orientations.
const UP_NAMES: Readonly<Record<MoonViewUp, string>> = { zenith: 'Zenith up', north: 'North up' }

// Larger view of the Moon.
export function MoonImageModal({ open, onClose, almanac }: { readonly open: boolean; readonly onClose: () => void; readonly almanac: MoonAlmanacResponse }) {
	const { up } = useSnapshot(moonState)
	const { appearance } = almanac

	return (
		<Modal open={open} onClose={onClose} title="The Moon" fit className="max-w-[min(100%,72rem)]">
			<div className="flex min-h-0 flex-1 flex-col gap-3">
				{appearance.parallacticAngle !== undefined && <SegmentedControl options={['zenith', 'north'] as const} value={up} format={(e) => UP_NAMES[e]} onChange={(e) => setMoonViewUp(moonState, e)} className="max-w-xs" />}
				{open && <MoonCanvas appearance={appearance} up={up} texture={moon4k} className="h-[min(70vh,48rem)] min-h-64 w-full" />}
				<p className="m-0 text-xs leading-4 text-ink-300">
					{MOON_PHASE_NAMES[appearance.phase]} · {(appearance.illuminatedFraction * 100).toFixed(1)}% illuminated · {moonOrientationCaption(almanac, up)}. {MOON_IMAGE_CREDIT}
				</p>
			</div>
		</Modal>
	)
}
