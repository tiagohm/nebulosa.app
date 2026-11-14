import { useSnapshot } from 'valtio'
import { LinkButton } from '../ui/LinkButton'
import { Notice } from '../ui/Notice'
import { type BindableDevice, boundCameraId, cameraBindingsState, catalogCameraName, catalogState } from './catalog'
import { deviceState } from './equipment'

// Line of a camera panel that says which camera of the Equipment Catalog its frames are recorded against, or its masters
// come from, and, while the device is bound to none, asks to bind it in the Equipment Setup, which it opens. The binding is
// read from the mirror of the server, which is what the wizards and the calibrators use.

// Returns the camera of the Equipment Catalog a camera device is bound to, followed live, or undefined.
export function useBoundCamera(device: BindableDevice | undefined) {
	const bindings = useSnapshot(cameraBindingsState)
	return boundCameraId(bindings, device)
}

export interface CatalogCameraNoticeProps {
	// Camera device of the panel.
	readonly device: BindableDevice | undefined
	// What is recorded against the camera, or comes from it, such as "Frames will be recorded against".
	readonly lead: string
	// What binding allows, said while the device is bound to none, such as "to acquire calibration frames".
	readonly purpose: string
}

// Camera of the catalog of a camera device, or the request to bind it.
export function CatalogCameraNotice({ device, lead, purpose }: CatalogCameraNoticeProps) {
	const { cameras } = useSnapshot(catalogState)
	const cameraId = useBoundCamera(device)

	if (cameraId !== undefined) return <Notice>{`${lead} ${catalogCameraName(cameras, cameraId)}.`}</Notice>

	return (
		<p className="m-0 text-xs leading-4 text-warning">
			{`Bind the camera to a camera of the Equipment Catalog ${purpose}. `}
			<LinkButton onClick={() => (deviceState.open = true)}>Open Equipment Setup</LinkButton>
		</p>
	)
}
