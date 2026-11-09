import { cn } from 'cn'
import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Popover } from '../ui/Popover'
import { fitImageToolBar, IMAGE_TOOL_DEFINITIONS, imageToolGroup, type ImageToolId, imageToolUnavailable } from './tools'

// Tool bar of the Images header: a button with the icon of each tool of the active document, the image tools and the
// camera operations apart, and, when the header has no room for all of them, a button at its end that lists the rest
// in a popover. The bar takes the width the header leaves it and refits whenever that width changes; the selected tool
// always keeps its button.

export interface ImageToolBarProps {
	// Tools of the active document, in tool bar order.
	readonly tools: readonly ImageToolId[]
	// Tool shown by the active document.
	readonly selected: ImageToolId
	// Whether no tool can be selected, as when no document is open.
	readonly disabled?: boolean
	// Called with the tool chosen.
	readonly onSelect: (id: ImageToolId) => void
}

// Returns whether a divider separates a tool from the one before it: the first camera operation after the image tools.
function startsCategory(tools: readonly ImageToolId[], index: number): boolean {
	return index > 0 && IMAGE_TOOL_DEFINITIONS[tools[index]].category !== IMAGE_TOOL_DEFINITIONS[tools[index - 1]].category
}

// Returns the tooltip of a tool's button or entry: its name, and why it cannot be selected when it cannot.
function toolTitle(id: ImageToolId): string {
	const reason = imageToolUnavailable(id)
	return reason ? `${IMAGE_TOOL_DEFINITIONS[id].label} (${reason})` : IMAGE_TOOL_DEFINITIONS[id].label
}

// Icon tool bar of the Images header.
export function ImageToolBar({ tools, selected, disabled = false, onSelect }: ImageToolBarProps) {
	const ref = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState<number>()
	const [open, setOpen] = useState(false)

	// Measured before paint, so the bar never shows buttons it has no room for.
	useLayoutEffect(() => {
		const element = ref.current
		if (!element) return
		setWidth(element.clientWidth)
		const observer = new ResizeObserver(() => setWidth(element.clientWidth))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	const { shown, overflow } = width === undefined ? { shown: tools, overflow: [] } : fitImageToolBar(tools, selected, width)

	// Selects a tool and closes the overflow list.
	function select(id: ImageToolId) {
		setOpen(false)
		onSelect(id)
	}

	return (
		<div ref={ref} className="flex min-w-0 flex-1 items-center gap-0.5">
			{shown.map((id, index) => (
				<Fragment key={id}>
					{startsCategory(shown, index) && <span className="mx-1 h-5 w-px flex-none bg-line-100" />}
					<IconButton icon={IMAGE_TOOL_DEFINITIONS[id].icon} label={toolTitle(id)} pressed={!disabled && id === selected} disabled={disabled || !!imageToolUnavailable(id)} onClick={() => onSelect(id)} />
				</Fragment>
			))}
			{overflow.length > 0 && (
				<Popover icon="more" label="More Tools" open={open} onOpenChange={setOpen} disabled={disabled}>
					<div className="-mx-1 flex flex-col">
						{overflow.map((id, index) => {
							const heading = imageToolGroup(id)
							const startsGroup = index === 0 || imageToolGroup(overflow[index - 1]) !== heading

							return (
								<Fragment key={id}>
									{startsGroup && <span className={cn('px-2 pb-1 text-xs font-medium tracking-wide text-ink-300 uppercase select-none', index > 0 ? 'mt-1 border-t border-line-100 pt-2' : 'pt-1')}>{heading}</span>}
									<button
										type="button"
										title={toolTitle(id)}
										disabled={!!imageToolUnavailable(id)}
										onClick={() => select(id)}
										className="flex cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left font-mono text-sm whitespace-nowrap text-ink-100 transition-colors duration-150 hover:bg-base-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent motion-reduce:transition-none"
									>
										<Icon name={IMAGE_TOOL_DEFINITIONS[id].icon} className="text-ink-200" />
										{IMAGE_TOOL_DEFINITIONS[id].label}
									</button>
								</Fragment>
							)
						})}
					</div>
				</Popover>
			)}
		</div>
	)
}
