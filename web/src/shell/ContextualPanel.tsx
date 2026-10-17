import { cn } from 'cn'
import type { ReactNode } from 'react'
import { IconButton } from '../ui/IconButton'

// Collapsible right-hand panel of a workspace with the controls of its current context. On wide screens
// it is a docked column that takes no space when collapsed; on narrow screens it slides over the
// workspace as a drawer. The panel only presents controls: collapsing or replacing it never stops what
// those controls started, so it holds no operational state of its own.

export interface ContextualPanelProps {
	// Heading of the panel's current content.
	readonly title: string
	// Whether the panel is shown.
	readonly open: boolean
	// Whether the panel is docked (wide screen) rather than a drawer.
	readonly docked: boolean
	// Hides the panel.
	readonly onClose: () => void
	// Controls of the current context; scrolls vertically when taller than the panel.
	readonly children: ReactNode
}

// Right-hand panel of a workspace.
export function ContextualPanel({ title, open, docked, onClose, children }: ContextualPanelProps) {
	return (
		<>
			{!docked && open && <button type="button" title="Close panel" onClick={onClose} className="absolute inset-0 z-20 cursor-default border-0 bg-[rgb(10_10_9/0.6)] p-0" />}
			<aside
				inert={!open}
				onKeyDown={(e) => !docked && e.key === 'Escape' && onClose()}
				className={cn(
					'flex-none overflow-hidden bg-base-000 motion-reduce:transition-none',
					docked
						? cn('h-full border-line-100 transition-[width] duration-200', open ? 'w-80 border-l xl:w-88' : 'w-0')
						: cn('absolute inset-y-0 right-0 z-30 w-[min(20rem,calc(100%-3rem))] border-l border-line-100 shadow-[-16px_0_48px_rgb(0_0_0/0.45)] transition-transform duration-200', open ? 'translate-x-0' : 'translate-x-full'),
				)}
			>
				<div className={cn('flex h-full flex-col', docked ? 'w-80 xl:w-88' : 'w-full')}>
					<header className="flex h-12 flex-none items-center gap-2 border-b border-line-100 pr-2 pl-4">
						<h2 className="m-0 min-w-0 flex-1 truncate text-xs font-semibold tracking-[0.08em] text-ink-200 uppercase">{title}</h2>
						<IconButton icon="close" label="Hide panel" onClick={onClose} />
					</header>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
				</div>
			</aside>
		</>
	)
}

export interface PanelSectionProps {
	// Section heading.
	readonly title: string
	// Section content.
	readonly children: ReactNode
}

export interface PlannedControlsProps {
	// Names of the controls the section will hold.
	readonly items: readonly string[]
}

// Placeholder of controls that are not implemented yet: lists what the section will hold, never a fake
// value, and says why nothing can be changed.
export function PlannedControls({ items }: PlannedControlsProps) {
	return (
		<>
			<ul className="m-0 flex list-none flex-col gap-1 p-0">
				{items.map((item) => (
					<li key={item} className="flex items-center gap-2 text-ink-300">
						<span className="size-1 flex-none rounded-full bg-line-200" />
						{item}
					</li>
				))}
			</ul>
			<p className="m-0 text-xs leading-4 text-ink-300 italic">Not available yet.</p>
		</>
	)
}

// Titled group of controls inside a contextual panel.
export function PanelSection({ title, children }: PanelSectionProps) {
	return (
		<section className="border-b border-line-100 px-4 py-3 last:border-b-0">
			<h3 className="m-0 mb-2 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">{title}</h3>
			<div className="flex flex-col gap-2 text-[13px] leading-5 text-ink-200">{children}</div>
		</section>
	)
}
