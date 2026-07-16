import { Icons } from '@ui/Icon'
import type { IDockviewPanelHeaderProps } from 'dockview-react'

export function CloseableTab(props: IDockviewPanelHeaderProps) {
	return (
		<div className="flex w-full items-center justify-center gap-2 px-2">
			{props.api.title}
			<Icons.CloseCircle color="var(--danger)" className="hover:opacity-90" onClick={() => props.api.close()} />
		</div>
	)
}
