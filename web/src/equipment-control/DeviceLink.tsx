import type { DeviceSummary } from 'api'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { navigate, routeState } from '../shell/route'

// Inline link from a device named in another workspace (such as the Equipment section of an Images camera
// tool) to its page in Equipment Control.

interface DeviceLinkProps {
	// Device to open; absent when there is none, so the fallback is shown as plain text.
	readonly device?: DeviceSummary
	// Text shown without a device.
	readonly fallback: ReactNode
	// Extra classes of the link.
	readonly className?: string
}

// Name of a device that opens it in Equipment Control, or the fallback text without a device.
export function DeviceLink({ device, fallback, className }: DeviceLinkProps) {
	if (!device) return <>{fallback}</>

	return (
		<button
			type="button"
			title={`Open ${device.name} in Equipment Control`}
			className={cn('max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', className)}
			onClick={() => navigate(routeState, { workspace: 'equipment', device: device.id })}
		>
			{device.name}
		</button>
	)
}
