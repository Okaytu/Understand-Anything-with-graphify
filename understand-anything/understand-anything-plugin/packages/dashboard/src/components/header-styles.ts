/**
 * One size for every control in the header bar (owner: "all buttons the same size"):
 * 36px tall, 13px text, the same corners; the focus ring shows for keyboard users only.
 */
export const FOCUS_RING = "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** A row of options where one is chosen (page switch, persona, domain/structural): 36px tall. */
export const SEGMENT_GROUP = "flex items-center gap-0.5 rounded-lg bg-elevated p-0.5";

export function segment(active: boolean): string {
  return `h-8 px-3.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors ${FOCUS_RING} ${
    active ? "bg-accent/20 text-accent" : "text-text-secondary hover:text-text-primary hover:bg-surface"
  }`;
}

/** A single header button (Diff, Filter, Export, Path, Theme): 36px tall. */
export const HEADER_BUTTON = `h-9 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${FOCUS_RING}`;

/** A square icon-only header button (help): 36 × 36. */
export const HEADER_ICON_BUTTON = `h-9 w-9 inline-flex items-center justify-center rounded-lg transition-colors ${FOCUS_RING}`;
