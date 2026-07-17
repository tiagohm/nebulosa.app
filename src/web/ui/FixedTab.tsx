import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useState, useEffect } from 'react'

export function FixedTab(props: IDockviewPanelHeaderProps) {
	const [title, setTitle] = useState(props.api.title)

	useEffect(() => {
		const listener = props.api.onDidTitleChange((e) => setTitle(e.title))
		return () => listener.dispose()
	}, [])

	return <div className="flex h-full w-full items-center px-2 text-sm">{title}</div>
}
