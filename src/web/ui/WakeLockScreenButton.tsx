import { memo } from 'react'
import { useWakeLock } from 'src/web/hooks/wakelock'
import { isWakeLockSupported } from '@/shared/util'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface WakeLockScreenButtonProps extends Omit<IconButtonProps, 'icon' | 'color' | 'onPointerUp'> {}

export const WakeLockScreenButton = memo((props: WakeLockScreenButtonProps) => {
	const { active, request, release } = useWakeLock()

	if (!isWakeLockSupported()) return null

	return <IconButton color={active ? 'success' : 'primary'} icon={active ? Icons.Monitor : Icons.MonitorLock} onPointerUp={active ? release : request} tooltipContent='Wake Lock' {...props} />
})
