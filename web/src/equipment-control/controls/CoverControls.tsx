import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { controlRuntime, deviceStateOf, startCommand } from '../control'
import type { InterfaceProps } from '../parts'
import { firstReason, useBusyReason } from '../useControl'

// Controls of a dust cover: open and close. Whether it stands open or closed, as it reports, and the stop of a motion
// in progress are in the header of the device. A request to open is shown as moving until the cover reports standing
// open.

// Controls of a cover.
export function CoverControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const cover = deviceStateOf(control.states, 'cover', device.id)!
	const busy = firstReason(useBusyReason(device), cover.parking && 'Wait until the cover stops moving')
	const openReason = firstReason(busy, !cover.parked && 'The cover is open')
	const closeReason = firstReason(busy, cover.parked && 'The cover is closed')

	function move(action: 'open' | 'close') {
		void startCommand(controlRuntime, { type: 'cover', deviceId: device.id, action, label: action === 'open' ? 'Open' : 'Close' })
	}

	return (
		<PanelSection title="Cover">
			{cover.canPark ? (
				<Actions>
					<Button variant="secondary" disabled={!!openReason} title={openReason} onClick={() => move('open')}>
						Open
					</Button>
					<Button variant="secondary" disabled={!!closeReason} title={closeReason} onClick={() => move('close')}>
						Close
					</Button>
				</Actions>
			) : (
				<Notice>This cover does not accept open and close commands.</Notice>
			)}
		</PanelSection>
	)
}
