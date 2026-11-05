import { Button } from '../ui/Button'
import { deviceState } from './equipment'

// The Equipment Setup button a panel offers when the equipment it needs is not set up: it opens the Equipment Setup
// dialog of the active profile and changes nothing else.

// Button that opens Equipment Setup, sized to its label inside a panel section.
export function EquipmentSetupButton() {
	return (
		<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
			Equipment Setup
		</Button>
	)
}
