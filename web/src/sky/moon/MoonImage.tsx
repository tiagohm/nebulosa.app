import { useState } from 'react'
import { useSnapshot } from 'valtio'
import moon2k from '../../../assets/moon/moon.2k.jpg'
import { Note } from '../InspectorParts'
import { almanacCurrent, MOON_IMAGE_CREDIT, MOON_PHASE_NAMES, moonOrientationCaption, moonState } from './moon'
import { MoonCanvas } from './MoonCanvas'
import { MoonImageModal } from './MoonImageModal'

// Moon drawing of the Moon Inspector, right under the Moon's name: the NASA color map on a sphere lit by the Sun and
// turned as the observer sees it at the instant the Sky shows (or from the Earth's center without an observer), the
// phase name and illuminated fraction of that drawing, how it is oriented, and a larger view on a click. While the
// almanac of a newer instant loads, the last drawing stays faded; a failure of the almanac only says so here.

// Moon drawing of the Moon Inspector; time is the instant the Sky shows and observer the place it is seen from.
export function MoonImage({ time, observer }: { readonly time?: number; readonly observer?: { readonly latitude: number; readonly longitude: number; readonly elevation: number } }) {
	const state = useSnapshot(moonState)
	const { almanac, up } = state
	const [open, setOpen] = useState(false)
	const shown = almanac.value
	const current = time !== undefined && almanacCurrent(moonState, time, observer)

	return (
		<div className="flex flex-col gap-2">
			{shown ? (
				<button type="button" onClick={() => setOpen(true)} title="Show a larger image" className="block cursor-zoom-in rounded-sm border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
					<MoonCanvas appearance={shown.appearance} up={up} texture={moon2k} faded={!current} className="h-60 w-full" />
				</button>
			) : (
				<div className="flex h-60 items-center justify-center rounded-sm bg-base-000 px-4 text-center text-xs text-ink-300">{almanac.error ? 'The Moon cannot be drawn.' : 'Drawing the Moon…'}</div>
			)}
			{shown && (
				<>
					<p className="m-0 text-center text-ink-100">
						{MOON_PHASE_NAMES[shown.appearance.phase]} · {(shown.appearance.illuminatedFraction * 100).toFixed(1)}% illuminated
					</p>
					<Note>
						{moonOrientationCaption(shown, up)}. {MOON_IMAGE_CREDIT}
					</Note>
				</>
			)}
			{almanac.error && <Note danger>Almanac unavailable: {almanac.error}</Note>}
			{shown && <MoonImageModal open={open} onClose={() => setOpen(false)} almanac={shown} />}
		</div>
	)
}
