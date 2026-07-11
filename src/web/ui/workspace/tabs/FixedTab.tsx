import type { IDockviewPanelHeaderProps } from 'dockview-react'

export function FixedTab(props: IDockviewPanelHeaderProps) {
	return <div className="flex w-full h-full items-center px-2">{props.api.title}</div>
}
