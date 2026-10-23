import { cn } from 'cn'
import { type KeyboardEvent, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { Icon } from '../ui/Icon'
import { moveIndex } from '../ui/navigation'
import { openWorkspace, routeState } from './route'
import { WORKSPACES } from './workspaces'

// Fixed vertical bar on the left that switches between the main workspaces. Arrow keys, Home, and End
// move the focus between its buttons. Switching only changes what is shown.

// Navigation rail of the application.
export function NavigationRail() {
	const { route } = useSnapshot(routeState)
	const navRef = useRef<HTMLElement>(null)

	function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
		const buttons = Array.from(navRef.current?.querySelectorAll('button') ?? [])
		const index = moveIndex(buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length, e.key)
		if (index === undefined) return
		e.preventDefault()
		buttons[index]?.focus()
	}

	return (
		<nav ref={navRef} onKeyDown={handleKeyDown} className="flex w-16 flex-none flex-col items-center gap-1 overflow-y-auto border-r border-line-100 bg-base-000 py-2">
			{WORKSPACES.map(({ id, label, icon }) => {
				const active = route.workspace === id

				return (
					<button
						key={id}
						type="button"
						title={label}
						onClick={() => openWorkspace(routeState, id)}
						className={cn(
							'relative flex w-14 flex-none cursor-pointer flex-col items-center gap-1 rounded-md border-0 px-0 py-2 font-mono transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
							active ? 'bg-accent-subtle text-accent' : 'bg-transparent text-ink-300 hover:bg-base-300 hover:text-ink-100',
						)}
					>
						{active && <span className="absolute top-2 bottom-2 -left-1 w-[3px] rounded-full bg-accent" />}
						<Icon name={icon} />
						<span className={cn('text-[10px] leading-3', active && 'font-semibold')}>{label}</span>
					</button>
				)
			})}
		</nav>
	)
}
