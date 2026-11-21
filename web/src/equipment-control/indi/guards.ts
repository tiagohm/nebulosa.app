// Switches of the INDI Properties view that ask for a confirmation before they are sent, by standard INDI vector and
// element name: the AtMostOne switches that start a motion lasting until it is cleared, or that search for or replace a
// reference of the device. Controls guards the same commands (a held press for manual motion, a confirmation for find
// home, set home, and set park), so the view never does in one tap what Controls asks to confirm. Every other switch is
// sent as is, as the driver defines it.

// Guard of the switches of one vector.
interface SwitchGuard {
	// Elements guarded; every element of the vector when absent.
	readonly elements?: readonly string[]
	// What sending one of them does, shown in the confirmation.
	readonly message: string
}

// Guarded vectors by name.
const GUARDS: Readonly<Record<string, SwitchGuard>> = {
	TELESCOPE_MOTION_NS: { message: 'The mount keeps moving north or south until Clear or Abort is sent. Mount Nudge, in an Images camera tab, moves it only while a direction is held.' },
	TELESCOPE_MOTION_WE: { message: 'The mount keeps moving west or east until Clear or Abort is sent. Mount Nudge, in an Images camera tab, moves it only while a direction is held.' },
	DOME_MOTION: { message: 'The dome keeps rotating until Clear or Abort is sent. The Hold buttons of Controls rotate it only while held.' },
	TELESCOPE_HOME: { elements: ['FIND', 'SET'], message: 'Find moves the axes until the sensors find the home position, so nothing may obstruct the telescope. Set makes the current position the home position, replacing the one the mount knows.' },
	TELESCOPE_PARK_OPTION: { message: 'These options replace, reset, or erase the park position the mount knows.' },
	DOME_PARK_OPTION: { message: 'These options replace, reset, or erase the park position the dome knows.' },
}

// Returns what sending a switch on does when it deserves a confirmation, or undefined when it is sent at once.
export function switchGuardOf(vector: string, element: string): string | undefined {
	const guard = GUARDS[vector]
	return guard && (!guard.elements || guard.elements.includes(element)) ? guard.message : undefined
}
