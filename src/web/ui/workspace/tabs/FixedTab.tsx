import type { IDockviewPanelHeaderProps } from 'dockview-react'

export function FixedTab(props: IDockviewPanelHeaderProps) {
	return <div className="flex h-full w-full items-center px-2">{props.api.title}</div>
}
