import type { SaveFormat } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { activeProfile, profileState } from '../profile/profile'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { documentPath, type ImageDocument, imagesState, SAVE_EXTENSIONS, saveFileName, saveImage } from './images'

// Save of a copy of an image document to a file of the server in a format chosen beforehand: a file chooser in save
// mode listing the files of that format, whose chosen name gets the format's extension unless it already has one of
// it, then a confirmation before replacing an existing file. The dialog stays open with the failure when the save
// fails, so it can be retried; it reports success only once the server confirms the write.

// Returns the folder of a server path, or undefined when it has none.
function directoryOf(path: string | undefined): string | undefined {
	if (path === undefined) return undefined
	const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
	return index > 0 ? path.slice(0, index) : undefined
}

// Labels of the save formats, in the dialog title.
const FORMAT_LABELS: Readonly<Record<SaveFormat, string>> = { fits: 'FITS', xisf: 'XISF', jpeg: 'JPEG' }

export interface SaveImageModalProps {
	// Document to save; the modal is hidden when absent.
	readonly document?: ImageDocument
	// Format of the file written.
	readonly format: SaveFormat
	// Hides the modal without saving.
	readonly onClose: () => void
	// Called once the document is saved.
	readonly onSaved: () => void
}

// Save dialog of a document.
export function SaveImageModal({ document, format, onClose, onSaved }: SaveImageModalProps) {
	const profiles = useSnapshot(profileState)
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string>()
	// Path waiting for the confirmation to replace the existing file there.
	const [replacing, setReplacing] = useState<string>()

	// Saves the document to path, replacing an existing file only with overwrite.
	async function save(path: string, overwrite: boolean) {
		if (!document) return
		const target = saveFileName(path, format)
		setBusy(true)
		setMessage(undefined)
		const outcome = await saveImage(imagesState, document.key, target, format, overwrite)
		setBusy(false)

		if (outcome.status === 'exists') setReplacing(target)
		else if (outcome.status === 'failed') setMessage(outcome.error)
		else onSaved()
	}

	function close() {
		setMessage(undefined)
		setReplacing(undefined)
		onClose()
	}

	return (
		<>
			<FileExplorerModal
				open={!!document && !replacing}
				mode="save"
				title={document ? `Save ${document.name} as ${FORMAT_LABELS[format]}` : 'Save Image'}
				defaultName={document ? saveFileName(document.name, format) : ''}
				initialPath={directoryOf(document && documentPath(document)) ?? activeProfile(profiles).settings.lastImageDirectory}
				extensions={SAVE_EXTENSIONS[format]}
				busy={busy}
				message={message}
				onClose={close}
				onChoose={(path) => void save(path, false)}
			/>
			<Modal open={!!replacing} onClose={() => setReplacing(undefined)} title="Replace file?" className="max-w-md">
				<p className="m-0 text-[13px] break-all">{replacing} already exists. Replacing it overwrites its contents.</p>
				<div className="mt-5 flex justify-end gap-2">
					<Button variant="secondary" onClick={() => setReplacing(undefined)}>
						Cancel
					</Button>
					<Button
						disabled={busy}
						onClick={() => {
							const path = replacing
							setReplacing(undefined)
							if (path) void save(path, true)
						}}
					>
						Replace
					</Button>
				</div>
			</Modal>
		</>
	)
}
