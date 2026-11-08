// Exports of the tools: a text offered as a file download, and the quoting of a CSV field (RFC 4180).

// Quotes a CSV field when it holds a separator, a quote, or a line break (RFC 4180).
export function csvField(text: string) {
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

// Offers a text as a file download named `name`, with its characters other than letters, digits, dots, and dashes
// replaced by underscores.
export function downloadText(text: string, name: string, type: string) {
	const url = URL.createObjectURL(new Blob([text], { type }))
	const link = document.createElement('a')
	link.href = url
	link.download = name.replaceAll(/[^\w.-]+/g, '_')
	link.click()
	URL.revokeObjectURL(url)
}
