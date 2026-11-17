import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { EmptyState } from './WorkspaceLayout'

// Error boundary of the active workspace or page: one whose render throws shows what failed in its place instead of
// unmounting the whole application, so the top bar, the navigation, the status bar with the Abort of each running
// operation, and the management modals stay usable. React catches a render error only in a class component, which is
// why this one is a class. The shell keys it by workspace, so navigating elsewhere starts it again.

export interface WorkspaceErrorBoundaryProps {
	// The workspace or page it guards.
	readonly children: ReactNode
}

// Failure caught, if any.
interface WorkspaceErrorBoundaryState {
	// Error the guarded render threw; absent while it renders.
	readonly error?: Error
}

// Shows the failure of a workspace that threw while rendering, with a command to render it again.
export class WorkspaceErrorBoundary extends Component<WorkspaceErrorBoundaryProps, WorkspaceErrorBoundaryState> {
	override state: WorkspaceErrorBoundaryState = {}

	// Records the error a render threw; React may throw any value, so a value that is not an Error is wrapped in one.
	static getDerivedStateFromError(error: unknown): WorkspaceErrorBoundaryState {
		return { error: error instanceof Error ? error : new Error(String(error)) }
	}

	// Logs the failure with the components it went through, which the message alone does not tell.
	override componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error('The workspace failed to render', error, info.componentStack)
	}

	override render() {
		const { error } = this.state
		if (!error) return this.props.children

		return (
			<div className="flex min-w-0 flex-1">
				<EmptyState
					title="This workspace failed to render"
					description={error.message}
					action={
						<Button variant="secondary" onClick={() => this.setState({ error: undefined })}>
							Try again
						</Button>
					}
				/>
			</div>
		)
	}
}
