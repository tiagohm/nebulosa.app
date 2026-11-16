import type { GatewayState } from 'api'
import { MOUNT_ROLE_BLOCKERS, type RoleStatus } from '../equipment/equipment'
import type { ToolId } from '../shell/route'
import type { StatusTone } from '../ui/StatusBadge'

// Readiness of the tools of the catalog: the one word a card shows, only by exception. A tool ready to use shows
// nothing; a planned tool, a tool whose main job is blocked by the active profile (no connected mount, no observing
// site, no MediaMTX), or a tool that keeps running on the server after its view is closed shows one word, with the full
// reason as its tooltip. A tool that only needs the internet is never marked: it shows its own state when opened.

// Word a card shows for its tool.
export interface ToolReadiness {
	// Short word or phrase shown on the card.
	readonly label: string
	// Tone of the badge: muted for a setup gap or a planned tool, warning for a configured service that fails, active
	// for work that runs on the server.
	readonly tone: StatusTone
	// Full reason, shown as the tooltip.
	readonly reason: string
}

// State of the enabled Meridian Flip Monitor of the profile's mount, as the status bar words it.
export interface MeridianFlipReadiness {
	// Headline of the monitor and its tone (meridianFlipHeadline).
	readonly headline: readonly [string, StatusTone]
	// Step of a flip the executor is running; absent when none runs.
	readonly step?: string
	// Whether a flip is armed or scheduled.
	readonly armed: boolean
}

// What the readiness of the tools depends on, read from the stores of the tab for the active profile.
export interface ToolReadinessContext {
	// State of the profile's MOUNT role.
	readonly mount: RoleStatus
	// Whether the profile has an active observing site.
	readonly site: boolean
	// Media gateway of Observatory Cameras; absent before the first snapshot.
	readonly gateway?: Pick<GatewayState, 'status' | 'message'>
	// Enabled monitor of the profile's mount; absent when it is disabled or there is no mount.
	readonly meridianFlip?: MeridianFlipReadiness
	// Running Mount Remote Control listeners of the profile's mount, each as "<protocol> on <host:port>".
	readonly listeners: readonly string[]
}

// Word of a planned tool, whose view does not exist yet.
const PLANNED: ToolReadiness = { label: 'Planned', tone: 'muted', reason: 'Not available yet.' }

// Returns the word of the card of a tool, or undefined when the tool is ready and its card shows none. A planned tool
// is said first, then what blocks the tool, then what it runs; planned is whether the tool has a view.
export function toolReadiness(id: ToolId, planned: boolean, context: ToolReadinessContext): ToolReadiness | undefined {
	if (planned) return PLANNED

	switch (id) {
		case 'meridian-flip-monitor':
			if (context.mount !== 'connected') return { label: 'Needs mount', tone: 'muted', reason: MOUNT_ROLE_BLOCKERS[context.mount] }
			return context.meridianFlip && meridianFlipReadiness(context.meridianFlip)
		case 'mount-remote-control':
			if (context.mount !== 'connected') return { label: 'Needs mount', tone: 'muted', reason: MOUNT_ROLE_BLOCKERS[context.mount] }
			return context.listeners.length > 0 ? { label: 'Serving', tone: 'active', reason: `Listening: ${context.listeners.join(', ')}.` } : undefined
		case 'astro-weather':
			return context.site ? undefined : { label: 'Needs site', tone: 'muted', reason: 'Set the observing site of this profile.' }
		case 'observatory-cameras':
			if (context.gateway?.status === 'notInstalled') return { label: 'Needs MediaMTX', tone: 'muted', reason: context.gateway.message ?? 'MediaMTX is not installed.' }
			if (context.gateway?.status === 'unavailable') return { label: 'MediaMTX unavailable', tone: 'warning', reason: context.gateway.message ?? 'MediaMTX is not running.' }
			return undefined
		default:
			return undefined
	}
}

// Word of an enabled Meridian Flip Monitor: the step of a running flip, Armed, or the headline the status bar shows.
// Its tone is the headline's, so a flip window or a passed deadline keeps its warning or danger, except that a
// monitor that is only monitoring is active, never the success colour.
function meridianFlipReadiness({ headline: [label, tone], step, armed }: MeridianFlipReadiness): ToolReadiness {
	if (step) return { label: step, tone: 'active', reason: `Flipping the mount: ${step}.` }
	if (armed) return { label: 'Armed', tone: tone === 'success' ? 'active' : tone, reason: `A flip is armed. Monitor: ${label}.` }
	return { label, tone: tone === 'success' ? 'active' : tone, reason: `Monitor enabled: ${label}.` }
}
