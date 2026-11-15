import { cn } from 'cn'
import type { MouseEvent } from 'react'
import { IconButton } from './IconButton'

// Star button marking or unmarking something as a favorite: outlined while it is not one, filled in the accent color
// while it is.

export interface FavoriteButtonProps {
	// Whether it is a favorite now.
	readonly favorite: boolean
	// Marks it (true) or unmarks it (false); receives the click, so a button inside a selectable row can stop it.
	readonly onChange: (favorite: boolean, event: MouseEvent<HTMLButtonElement>) => void
	// Whether marking is not possible yet, such as while what it marks is loading.
	readonly disabled?: boolean
	// Classes of the button.
	readonly className?: string
}

// Favorite toggle.
export function FavoriteButton({ favorite, onChange, disabled, className }: FavoriteButtonProps) {
	return <IconButton icon="favorite" label={favorite ? 'Remove from favorites' : 'Add to favorites'} filled={favorite} disabled={disabled} onClick={(event) => onChange(!favorite, event)} className={cn(favorite && 'text-accent hover:text-accent-hover', className)} />
}
