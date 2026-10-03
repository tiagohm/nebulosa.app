import { useStore } from '@hooks/store.hook'
import { statusBarStore } from '@stores/statusbar.store'
import type { StatusBarItem } from '@stores/statusbar.store'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'

export const StatusBar = memo(() => {
	const statusBar = useStore(statusBarStore, [])
	const { length } = useSnapshot(statusBar.state.groups)

	const groups = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const item = statusBar.state.groups[i]
		groups[i] = <StatusBarEntry key={item.id} item={item} />
	}

	return <div className="flex h-full min-h-0 flex-row items-center gap-2 p-1 text-sm">{groups}</div>
})

interface StatusBarEntryProps {
	readonly item: StatusBarItem
}

const StatusBarEntry = memo(({ item }: StatusBarEntryProps) => {
	const { startContent: StartContent, startContentClassName, endContent: EndContent, endContentClassName, label, labelClassName, visible } = useSnapshot(item)
	const { length } = useSnapshot(item.items)

	const groups = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const e = item.items[i]
		groups[i] = <StatusBarEntry key={e.id} item={e} />
	}

	return (
		<Activity mode={visible === undefined || visible === null || visible === true ? 'visible' : 'hidden'}>
			<div className="flex h-full min-h-0 flex-row items-center gap-1">
				{StartContent && (typeof StartContent === 'string' ? <span className={startContentClassName}>{StartContent}</span> : <StartContent />)}
				<span className={labelClassName}>{label}</span>
				<div className="flex h-full min-h-0 flex-row items-center gap-1">{groups}</div>
				{EndContent && (typeof EndContent === 'string' ? <span className={endContentClassName}>{EndContent}</span> : <EndContent />)}
			</div>
		</Activity>
	)
})
