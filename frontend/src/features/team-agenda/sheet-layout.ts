/**
 * The sheets of the agenda (D80): from the right on the desktop, beside the
 * grid that stays visible; from the bottom on the phone, within thumb reach,
 * scrolling inside when the content is taller than the screen.
 */
export function sheetSide(desktop: boolean): 'right' | 'bottom' {
  return desktop ? 'right' : 'bottom'
}

export function sheetClassName(desktop: boolean): string {
  return desktop
    ? 'w-full gap-6 overflow-y-auto p-6 data-[side=right]:sm:max-w-lg'
    : 'max-h-[92svh] gap-5 overflow-y-auto rounded-t-2xl px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]'
}
