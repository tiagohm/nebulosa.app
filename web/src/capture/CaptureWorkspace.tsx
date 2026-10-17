import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'

// Capture workspace: image acquisition with the profile's main camera.

// Capture workspace.
export function CaptureWorkspace() {
	return (
		<WorkspaceLayout workspace="capture" title="Capture" panel={{ title: 'Camera', content: <EmptyState title="Camera controls are not available yet" /> }}>
			<EmptyState title="No image captured" />
		</WorkspaceLayout>
	)
}
