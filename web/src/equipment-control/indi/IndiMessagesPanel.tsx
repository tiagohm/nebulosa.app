import { useLayoutEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { copyText } from '../../clipboard'
import { formatDateTime } from '../../format'
import { useActiveSite, useDisplayZone } from '../../location/useLocation'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { TextInput } from '../../ui/TextInput'
import { indiMessagesView, messagesText, searchMessages } from './messages'
import { useWatchedIndiDevices } from './useIndi'
import { useIndiMessages } from './useIndiMessages'

// Messages view of one physical device of an INDI connection in Equipment Control: the messages its driver sent
// while the connection is open, oldest first, each with the instant it was received in the display zone (the
// driver's own timestamp, as sent, in its tooltip), searchable, and copied as plain text. The list follows the
// latest message until the user scrolls away from its end, and again once they scroll back or check Follow latest.
// The text is shown as sent, never interpreted. Showing the view subscribes to the device's messages, and leaving
// it unsubscribes; neither connects, disconnects, nor stops anything.

export interface IndiMessagesPanelProps {
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
	// Name of the device, for the copied text.
	readonly name: string
}

// Distance from the end of the list within which it counts as at the end, in CSS pixels.
const END_TOLERANCE = 8

// Outcome of the latest copy.
type CopyResult = 'copied' | 'failed'

// Messages of a device.
export function IndiMessagesPanel({ connectionId, hardwareId, name }: IndiMessagesPanelProps) {
	const devices = useWatchedIndiDevices()
	const present = devices.some((device) => device.connectionId === connectionId && device.hardwareId === hardwareId)
	useIndiMessages(connectionId, hardwareId, present)

	const view = useSnapshot(indiMessagesView)
	const { zone } = useDisplayZone(useActiveSite())
	const [query, setQuery] = useState('')
	const [follow, setFollow] = useState(true)
	const [copy, setCopy] = useState<CopyResult>()
	const list = useRef<HTMLOListElement>(null)
	const shown = searchMessages(view.messages, query)

	useLayoutEffect(() => {
		const element = list.current
		if (follow && element) element.scrollTop = element.scrollHeight
	}, [follow, shown])

	function scrolled() {
		const element = list.current
		if (element) setFollow(element.scrollHeight - element.scrollTop - element.clientHeight <= END_TOLERANCE)
	}

	async function copyShown() {
		setCopy((await copyText(messagesText(shown, name, zone))) ? 'copied' : 'failed')
	}

	if (!present) return <Message>The INDI server no longer reports this device.</Message>
	if (view.status === 'refused') return <Message error>{view.error ?? 'The messages of this device cannot be shown.'}</Message>
	if (view.messages.length === 0) return <Message>{view.status === 'loading' || view.status === 'idle' ? 'Loading the messages…' : 'No messages received for this device.'}</Message>

	return (
		<div className="flex flex-col">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 px-4 py-3">
				<TextInput className="min-w-48 flex-1" placeholder="Search messages" value={query} onChange={(event) => setQuery(event.target.value)} />
				<span className="text-xs text-ink-300">
					{shown.length} of {view.messages.length} {view.messages.length === 1 ? 'message' : 'messages'}
				</span>
				<Checkbox label="Follow latest" checked={follow} onChange={setFollow} />
				<Button variant="secondary" disabled={shown.length === 0} onClick={() => void copyShown()}>
					Copy
				</Button>
				{copy === 'copied' && <span className="text-xs text-success">Copied.</span>}
				{copy === 'failed' && <span className="text-xs text-danger">Could not copy to the clipboard.</span>}
			</div>
			{view.status === 'disconnected' && <Message>The server cannot be reached; these are the messages received before.</Message>}
			{view.messages[0].sequence > 1 && <Message>Older messages of this device are no longer kept.</Message>}
			{shown.length === 0 ? (
				<Message>No message matches the search.</Message>
			) : (
				<ol ref={list} onScroll={scrolled} className="m-0 flex max-h-[60vh] list-none flex-col gap-1 overflow-y-auto border-b border-line-100 px-4 py-3 text-xs">
					{shown.map((message) => (
						<li key={message.id} className="flex flex-wrap gap-x-3">
							<span className="font-mono text-ink-300 tabular-nums" title={message.timestamp === undefined ? undefined : `Driver timestamp: ${message.timestamp}`}>
								{formatDateTime(message.receivedAt, zone)}
							</span>
							<span className="min-w-0 flex-1 whitespace-pre-wrap text-ink-100 wrap-break-word">
								{message.text}
								{message.truncated && <span className="text-ink-300"> (truncated)</span>}
							</span>
						</li>
					))}
				</ol>
			)}
		</div>
	)
}

// One line explaining what the view shows instead of messages, or above them.
function Message({ error = false, children }: { readonly error?: boolean; readonly children: string }) {
	return (
		<div className="px-4 py-3">
			<Notice error={error}>{children}</Notice>
		</div>
	)
}
