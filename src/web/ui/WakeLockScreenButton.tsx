import { memo } from 'react'
import { useWakeLock } from '@/hooks/wakelock.hook'
import { isWakeLockSupported } from '@/shared/util'
import { IconButton, type IconButtonProps } from './components/IconButton'
import { Icons } from './Icon'

export interface WakeLockScreenButtonProps extends Omit<IconButtonProps, 'icon' | 'color' | 'onPointerUp'> {}

export const WakeLockScreenButton = memo((props: WakeLockScreenButtonProps) => {
	const { active, request, release } = useWakeLock()

	if (!isWakeLockSupported()) return null

	return <IconButton color={active ? 'success' : 'primary'} icon={active ? Icons.Monitor : Icons.MonitorLock} onClick={active ? release : request} tooltipContent="Wake Lock" {...props} />
})
