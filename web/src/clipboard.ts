// Copying text to the clipboard from any page of the app. The asynchronous Clipboard API exists only in a secure
// context (HTTPS or localhost), and the app is usually opened over plain HTTP on the local network, so a copy falls back
// to selecting the text in a hidden text area and asking the browser to copy the selection, which works there in
// response to a user action. Callers say when neither works.

// Browser services a copy uses, replaced in tests.
export interface ClipboardIo {
	// Writes text with the Clipboard API; absent outside a secure context.
	readonly writeText?: (text: string) => Promise<void>
	// Copies text through a selection; returns whether the browser copied it.
	readonly copySelection: (text: string) => boolean
}

// Browser implementation of ClipboardIo.
export const browserClipboard: ClipboardIo = {
	get writeText() {
		// The clipboard is missing outside a secure context, such as the server opened over plain HTTP on the LAN.
		return typeof navigator !== 'undefined' && navigator.clipboard ? (text: string) => navigator.clipboard.writeText(text) : undefined
	},
	copySelection: (text) => {
		const area = document.createElement('textarea')
		area.value = text
		area.readOnly = true
		area.style.position = 'fixed'
		area.style.opacity = '0'
		area.style.pointerEvents = 'none'
		document.body.append(area)
		area.select()

		try {
			// Deprecated, but the only way to copy in an insecure context; the Clipboard API is used whenever it exists.
			// oxlint-disable-next-line typescript/no-deprecated
			return document.execCommand('copy')
		} finally {
			area.remove()
		}
	},
}

// Copies text to the clipboard: with the Clipboard API when the context allows it, otherwise or when it fails through a
// selection. Resolves to whether the text was copied; never rejects.
export async function copyText(text: string, io: ClipboardIo = browserClipboard): Promise<boolean> {
	const { writeText } = io

	if (writeText) {
		try {
			await writeText(text)
			return true
		} catch {
			// Refused (no permission, document not focused): the selection may still work.
		}
	}

	try {
		return io.copySelection(text)
	} catch {
		return false
	}
}
