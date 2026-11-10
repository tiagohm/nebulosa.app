import type { DeviceSummary } from 'api'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { MISSING } from '../format'
import { navigate, routeState } from '../shell/route'
import { LinkButton } from '../ui/LinkButton'

// Inline link from a device named in another workspace (such as the Equipment section of an Images camera
// tool) to its page in Equipment Control.

interface DeviceLinkProps {
	// Device to open; absent when there is none, so the fallback is shown as plain text.
	readonly device?: DeviceSummary
	// Text shown without a device; MISSING by default.
	readonly fallback?: ReactNode
	// Extra classes of the link.
	readonly className?: string
	// Called after the device was opened, such as to close the panel holding the link.
	readonly onNavigate?: () => void
}

// Name of a device that opens it in Equipment Control, or the fallback text without a device.
export function DeviceLink({ device, fallback = MISSING, className, onNavigate }: DeviceLinkProps) {
	if (!device) return <>{fallback}</>

	return (
		<LinkButton
			title={`Open ${device.name} in Equipment Control`}
			className={cn('max-w-full truncate', className)}
			onClick={() => {
				navigate(routeState, { workspace: 'equipment', device: device.id })
				onNavigate?.()
			}}
		>
			{device.name}
		</LinkButton>
	)
}
