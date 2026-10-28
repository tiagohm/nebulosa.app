import { cn } from 'cn'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatEclipseTime } from '../../tools/eclipse/eclipse'
import { Modal } from '../../ui/Modal'
import { Select } from '../../ui/Select'
import { Note } from '../InspectorParts'
import { loadSunImage, SUN_IMAGE_CHANNEL_NAMES, SUN_IMAGE_CHANNELS, type SunImage, selectSunImageChannel, sunState } from './sun'

// Latest SDO image of the Sun Inspector, right under the Sun's name: the channel chosen, when SDO updated the file
// and when the server downloaded it (in UTC, never the Sky instant, since the image is a current observation), and
// a larger view on a click. A failure of the image only says so here; the rest of the inspector is unaffected.

// Credit SDO asks for.
const SDO_CREDIT = 'Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams.'

// Says what an image is and when SDO updated it; a stale image says it is the last one downloaded.
function imageCaption(image: SunImage) {
	const updated = image.updatedAt !== undefined ? `updated ${formatEclipseTime(image.updatedAt, 'UTC')}` : 'update time unknown'
	const stale = image.stale ? `. SDO cannot be reached: last image, downloaded ${formatEclipseTime(image.fetchedAt, 'UTC')}` : ''
	return `${SUN_IMAGE_CHANNEL_NAMES[image.channel]} · NASA/SDO, ${updated}${stale}.`
}

// SDO image of the Sun Inspector.
export function SolarImage() {
	const { image, enlarged, channel } = useSnapshot(sunState)
	const [open, setOpen] = useState(false)
	const shown = image.value

	function enlarge() {
		if (!shown) return
		setOpen(true)
		if (enlarged.value?.channel !== shown.channel || enlarged.value.fetchedAt < shown.fetchedAt) void loadSunImage(sunState, 'enlarged', shown.channel)
	}

	return (
		<div className="flex flex-col gap-2">
			{shown ? (
				<button type="button" onClick={enlarge} title="Show a larger image" className="block cursor-zoom-in rounded-sm border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
					<img src={shown.url} alt={`The Sun, ${SUN_IMAGE_CHANNEL_NAMES[shown.channel]}`} className={cn('contrast-[0.84375] mx-auto block h-60 max-w-full object-contain', image.loading && 'opacity-60')} />
				</button>
			) : (
				<div className="flex h-60 items-center justify-center rounded-sm bg-base-000 px-4 text-center text-xs text-ink-300">{image.error ? 'The SDO image is unavailable.' : 'Loading the SDO image…'}</div>
			)}
			<Select label="Channel" options={SUN_IMAGE_CHANNELS} value={channel} format={(e) => SUN_IMAGE_CHANNEL_NAMES[e]} onChange={(e) => void selectSunImageChannel(sunState, e)} />
			{shown && <Note>{imageCaption(shown)}</Note>}
			{image.error && <Note danger>SDO image unavailable: {image.error}</Note>}
			<Modal open={open} onClose={() => setOpen(false)} title={shown ? SUN_IMAGE_CHANNEL_NAMES[shown.channel] : 'The Sun'} fit className="max-w-[min(100%,72rem)]">
				<div className="flex min-h-0 flex-col gap-3">
					{enlarged.value ? (
						<img src={enlarged.value.url} alt={`The Sun, ${SUN_IMAGE_CHANNEL_NAMES[enlarged.value.channel]}`} className="contrast-[0.7] mx-auto block min-h-0 max-w-full flex-1 rounded-sm bg-transparent object-contain" />
					) : (
						<p className="m-0 text-ink-300">{enlarged.error ? `The larger image is unavailable: ${enlarged.error}` : 'Loading the larger image…'}</p>
					)}
					{enlarged.value && <p className="m-0 text-xs leading-4 text-ink-300">{imageCaption(enlarged.value)}</p>}
					<p className="m-0 text-xs leading-4 text-ink-300">{SDO_CREDIT} The image is the latest SDO has, whatever instant the Sky shows.</p>
				</div>
			</Modal>
		</div>
	)
}
