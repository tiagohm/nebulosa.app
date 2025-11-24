import { useEffect, useRef, useState } from 'react'

// Hook to manage the Wake Lock API
export function useWakeLock() {
	const [active, setActive] = useState(false)
	const wakeLock = useRef<WakeLockSentinel | null>(null)

	const request = async () => {
		try {
			wakeLock.current = await navigator.wakeLock.request('screen')
			setActive(true)

			wakeLock.current.addEventListener('release', () => {
				setActive(false)
				wakeLock.current = null
			})
		} catch (e) {
			console.error('wake Lock request failed:', e)
			setActive(false)
		}
	}

	const release = () => {
		if (wakeLock.current) {
			wakeLock.current.release()
			wakeLock.current = null
			setActive(false)
		}
	}

	// Reacquire wake lock if the app regains visibility
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (wakeLock.current && document.visibilityState === 'visible') {
				void request()
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange)

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			release()
		}
	}, [])

	return { active, request, release }
}
