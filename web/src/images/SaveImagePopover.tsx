import type { SaveFormat } from 'api'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Popover } from '../ui/Popover'
import { SegmentedControl } from '../ui/SegmentedControl'
import { downloadUrl, type ImageDocument, type ImageViewState, saveFileName, shownRendering } from './images'

// Save control of the viewer toolbar, for any document (file, derived, or camera tab): a popup choosing the format,
// FITS or XISF (the pixels in the memory of the server, in the scale of their source) or JPEG (the rendering the
// viewer shows, original or adjusted), then Save to Server, which hands the format to the workspace's save dialog, or
// Download, which the browser saves: FITS and XISF encoded by the server, JPEG the bytes of the rendering shown. Both
// write a copy and leave the document as it is. Disabled until the document is first rendered.

// Save formats, in display order.
const SAVE_FORMATS: readonly SaveFormat[] = ['fits', 'xisf', 'jpeg']

// Labels of the save formats.
const SAVE_FORMAT_LABELS: Readonly<Record<SaveFormat, string>> = { fits: 'FITS', xisf: 'XISF', jpeg: 'JPEG' }

// What a file of each format holds.
const SAVE_FORMAT_HINTS: Readonly<Record<SaveFormat, string>> = {
	fits: 'The image data, in the scale of its source, with its header.',
	xisf: 'The image data, in the scale of its source, with its header.',
	jpeg: 'The view as shown, with its display settings applied.',
}

export interface SaveImagePopoverProps {
	// Document shown.
	readonly document: ImageDocument
	// View state of the document.
	readonly view: ImageViewState
	// Opens the save dialog of the document in a format.
	readonly onSaveToServer: (format: SaveFormat) => void
}

// Save popup of the viewer toolbar.
export function SaveImagePopover({ document, view, onSaveToServer }: SaveImagePopoverProps) {
	const [open, setOpen] = useState(false)
	const [format, setFormat] = useState<SaveFormat>('fits')
	const shown = shownRendering(view)
	const info = document.info

	// Has the browser save a copy of the document in the chosen format.
	function download() {
		if (!info || !shown) return
		const link = window.document.createElement('a')
		link.href = format === 'jpeg' ? shown.url : downloadUrl(info, format)
		// FITS and XISF are named by the server's Content-Disposition.
		link.download = format === 'jpeg' ? saveFileName(document.name, 'jpeg') : ''
		link.click()
		setOpen(false)
	}

	return (
		<Popover icon="save" label="Save" open={open} onOpenChange={setOpen} disabled={!info || !shown}>
			<SegmentedControl label="Format" options={SAVE_FORMATS} value={format} format={(f) => SAVE_FORMAT_LABELS[f]} onChange={setFormat} />
			<p className="m-0 text-xs text-ink-300">{SAVE_FORMAT_HINTS[format]}</p>
			<div className="flex flex-wrap justify-end gap-2">
				<Button variant="secondary" onClick={download}>
					Download
				</Button>
				<Button
					onClick={() => {
						setOpen(false)
						onSaveToServer(format)
					}}
				>
					Save to Server…
				</Button>
			</div>
		</Popover>
	)
}
