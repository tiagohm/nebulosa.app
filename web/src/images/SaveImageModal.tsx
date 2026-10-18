import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../files/files'
import { activeProfile, profileState } from '../profile/profile'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { formatOfFileName, type ImageDocument, imagesState, saveImage } from './images'

// Save As of an image document to a file of the server: a file chooser in save mode, whose file name
// extension picks the format (XISF for .xisf, FITS otherwise, .fits added when there is none), then a
// confirmation before replacing an existing file. The dialog stays open with the failure when the save
// fails, so it can be retried; it reports success only once the server confirms the write.

// Returns the file name a document is saved as by default: the file it was saved to, or its name with
// a FITS extension.
function defaultFileName(document: ImageDocument): string {
	if (document.savedPath) return document.savedPath.split(/[\\/]/).at(-1) ?? document.savedPath
	return /\.(fits?|fts|xisf)$/i.test(document.name) ? document.name : `${document.name}.fits`
}

// Returns the folder of a server path, or undefined when it has none.
function directoryOf(path: string | undefined): string | undefined {
	if (path === undefined) return undefined
	const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
	return index > 0 ? path.slice(0, index) : undefined
}

export interface SaveImageModalProps {
	// Document to save; the modal is hidden when absent.
	readonly document?: ImageDocument
	// Hides the modal without saving.
	readonly onClose: () => void
	// Called once the document is saved.
	readonly onSaved: () => void
}

// Save As dialog of a document.
export function SaveImageModal({ document, onClose, onSaved }: SaveImageModalProps) {
	const profiles = useSnapshot(profileState)
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string>()
	// Path waiting for the confirmation to replace the existing file there.
	const [replacing, setReplacing] = useState<string>()

	// Saves the document to path, replacing an existing file only with overwrite.
	async function save(path: string, overwrite: boolean) {
		if (!document) return
		const target = /\.(fits?|fts|xisf)$/i.test(path) ? path : `${path}.fits`
		setBusy(true)
		setMessage(undefined)
		const outcome = await saveImage(imagesState, document.key, target, formatOfFileName(target), overwrite)
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
				title={document ? `Save ${document.name}` : 'Save Image'}
				defaultName={document ? defaultFileName(document) : ''}
				initialPath={directoryOf(document?.savedPath) ?? activeProfile(profiles).settings.lastImageDirectory}
				extensions={IMAGE_EXTENSIONS}
				busy={busy}
				message={message}
				onClose={close}
				onChoose={(path) => void save(path, false)}
			/>
			<Modal open={!!replacing} onClose={() => setReplacing(undefined)} title="Replace file?" className="max-w-md">
				<p className="m-0 text-[13px] break-all">{replacing} already exists. Replacing it overwrites its contents.</p>
				<div className="mt-5 flex justify-end gap-2">
					<Button size="sm" variant="secondary" onClick={() => setReplacing(undefined)}>
						Cancel
					</Button>
					<Button
						size="sm"
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
