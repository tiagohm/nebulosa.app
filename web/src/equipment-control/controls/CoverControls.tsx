import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { controlRuntime, deviceStateOf, startCommand, stopCommand } from '../control'
import { Actions, type InterfaceProps, Notice, Readout } from '../parts'

// Controls of a dust cover: whether it stands open or closed as it reports, open and close, and a stop of
// a motion in progress. A request to open is shown as moving until the cover reports standing open.

// Controls of a cover.
export function CoverControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const cover = deviceStateOf(control.states, 'cover', device.id)!
	const busy = control.pending[device.id] !== undefined

	function move(action: 'open' | 'close') {
		void startCommand(controlRuntime, { type: 'cover', deviceId: device.id, action, label: action === 'open' ? 'Open' : 'Close' })
	}

	return (
		<PanelSection title="Cover">
			<Readout label="State">{cover.parking ? 'Moving' : cover.parked ? 'Closed' : 'Open'}</Readout>
			{cover.canPark ? (
				<Actions>
					<Button size="sm" variant="secondary" disabled={busy || cover.parking || !cover.parked} onClick={() => move('open')}>
						Open
					</Button>
					<Button size="sm" variant="secondary" disabled={busy || cover.parking || cover.parked} onClick={() => move('close')}>
						Close
					</Button>
					{cover.parking && cover.canAbort && (
						<Button size="sm" onClick={() => void stopCommand(controlRuntime, { type: 'cover', deviceId: device.id, action: 'stop' })}>
							Stop
						</Button>
					)}
				</Actions>
			) : (
				<Notice>This cover does not accept open and close commands.</Notice>
			)}
		</PanelSection>
	)
}
