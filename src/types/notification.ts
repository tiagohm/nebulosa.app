export type Severity = 'success' | 'primary' | 'secondary' | 'warning' | 'danger'

export interface Notification {
	target?: string
	color: Severity
	title: string
	description: string
}
