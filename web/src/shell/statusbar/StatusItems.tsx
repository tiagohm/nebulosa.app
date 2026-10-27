import { cn } from 'cn'
import type { Ref } from 'react'
import { useSnapshot } from 'valtio'
import { notificationsState } from '../../notifications/notifications'
import { Icon, type IconName } from '../../ui/Icon'
import { navigate, routeState } from '../route'
import { type ChipValue, type ScopedDevice, serverLinkLabel, type StatusTone } from './selectors'

// Items of the status bar, as small as they can be: the server link is an icon alone, and each chip an icon and a
// short reading, its name and full reading in its title. A moving device shows animated dots at the end of its chip
// instead of a motion text. A chip with a device opens that exact device in Equipment Control.

// Text color of each status tone.
export const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
	muted: 'text-ink-300',
	idle: 'text-ink-200',
	active: 'text-accent',
	ok: 'text-success',
	error: 'text-danger',
}

// Classes shared by the chips: the separator and the spacing.
const CHIP_CLASS = 'flex flex-none items-center gap-1 border-l border-line-100 pl-3'

// Classes added to a chip that is a button.
const BUTTON_CLASS = 'cursor-pointer hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

interface ServerLinkItemProps {
	// Element of the item, measured by the bar.
	readonly ref?: Ref<HTMLSpanElement>
}

// Link of the tab to the application server: a server icon, green while the event socket is open and red otherwise,
// with the link and the active profile's connection in its title. The connection itself is managed by the top bar.
export function ServerLinkItem({ ref }: ServerLinkItemProps) {
	const { server } = useSnapshot(notificationsState)
	const text = serverLinkLabel(server)

	return (
		<span ref={ref} title={text} className="flex flex-none items-center">
			<Icon name="server" className={cn('size-3.5', server === 'online' ? 'text-success' : 'text-danger')} />
			<span className="sr-only">{text}</span>
		</span>
	)
}

// Three dots pulsing one after the other, standing for a motion in progress.
export function MotionDots() {
	return (
		<span className="flex flex-none items-center gap-0.5 text-accent">
			<span className="size-1 animate-pulse rounded-full bg-current" />
			<span className="size-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
			<span className="size-1 animate-pulse rounded-full bg-current [animation-delay:600ms]" />
		</span>
	)
}

interface StatusChipProps {
	// Icon of the chip.
	readonly icon: IconName
	// Name of the chip, such as "Mount", read through its title.
	readonly label: string
	// Reading of the chip.
	readonly value: ChipValue
	// Exact device the chip opens in Equipment Control; absent for a chip that opens nothing.
	readonly device?: ScopedDevice
}

// Icon, short reading, and motion dots of a device or session, a button opening its device when it has one.
export function StatusChip({ icon, label, value, device }: StatusChipProps) {
	const title = `${label}${device ? ` ${device.name}` : ''}: ${value.title}`
	const content = (
		<>
			<Icon name={icon} className="size-3.5 text-ink-300" />
			<span className="sr-only">{title}</span>
			{value.text && <span className={cn('max-w-24 truncate', TONE_CLASSES[value.tone])}>{value.text}</span>}
			{value.moving && <MotionDots />}
		</>
	)

	if (!device) {
		return (
			<span title={title} className={CHIP_CLASS}>
				{content}
			</span>
		)
	}

	return (
		<button type="button" title={`${title} · Open in Equipment Control`} onClick={() => navigate(routeState, { workspace: 'equipment', device: device.id })} className={cn(CHIP_CLASS, BUTTON_CLASS)}>
			{content}
		</button>
	)
}
