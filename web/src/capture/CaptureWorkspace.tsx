import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { ImageViewer } from '../viewer/ImageViewer'

// Capture workspace: image acquisition with the profile's main camera, showing the latest frame in the
// shared image viewer.

// Capture workspace.
export function CaptureWorkspace() {
	return (
		<WorkspaceLayout workspace="capture" title="Capture" panel={{ title: 'Camera', content: <EmptyState title="Camera controls are not available yet" /> }}>
			<ImageViewer empty={<EmptyState title="No image captured" />} />
		</WorkspaceLayout>
	)
}
