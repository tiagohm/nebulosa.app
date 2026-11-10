import { cn } from 'cn'
import type { ComponentProps } from 'react'

// Command written as a link inside a line of text, such as the name of a device that opens it in Equipment Control or
// an Open beside a row: accent text, underlined while hovered, with the focus outline of every control. It takes the
// size of the text around it.

// Inline button that reads as a link.
export function LinkButton({ className, type = 'button', ...props }: ComponentProps<'button'>) {
	return <button type={type} className={cn('cursor-pointer border-0 bg-transparent p-0 text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', className)} {...props} />
}
