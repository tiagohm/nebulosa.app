import { Icons } from '@ui/Icon'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useEffect, useState } from 'react'

export function CloseableTab(props: IDockviewPanelHeaderProps) {
	const [title, setTitle] = useState(props.api.title)

	useEffect(() => {
		const listener = props.api.onDidTitleChange((e) => setTitle(e.title))
		return () => listener.dispose()
	}, [])

	return (
		<div className="flex w-full items-center justify-center gap-2 px-2 text-sm">
			{title}
			<Icons.CloseCircle color="var(--danger)" className="hover:opacity-90" onClick={() => props.api.close()} />
		</div>
	)
}
