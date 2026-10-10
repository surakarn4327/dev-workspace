/** Line icons for the menu bar (24x24 viewBox, stroked with currentColor). */
const PATHS = {
  file: '<path d="M3 6h6l2 2h10v11H3z"/>',
  edit: '<path d="M4 20l1-5L16 4l4 4L9 19z M14 6l4 4"/>',
  board: '<path d="M4 4h16v16H4z M9.3 4v16 M14.7 4v16 M4 9.3h16 M4 14.7h16"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0 M12 18l4-6 M8 18h.01 M16 18h.01"/>',
  help: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17v.5"/>',
  new: '<path d="M6 3h8l4 4v14H6z M14 3v4h4 M12 11v6 M9 14h6"/>',
  undo: '<path d="M8 5 3 10l5 5 M4 10h9a5 5 0 0 1 0 10h-4"/>',
  redo: '<path d="M16 5l5 5-5 5 M20 10h-9a5 5 0 0 0 0 10h4"/>',
  wire: '<path d="M5 19h6V6h8"/><circle cx="4.5" cy="19" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/>',
  fit: '<path d="M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M9 9h6v6H9z"/>',
  pause: '<path d="M8 5v14 M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9 M20 4v5h-5"/>',
  duplicate: '<path d="M9 9h11v11H9z M5 15V4h11"/>',
  replace: '<path d="M4 8h14 M14 4l4 4-4 4 M20 16H6 M10 12l-4 4 4 4"/>',
  delete: '<path d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6"/>',
  export: '<path d="M12 15V4 M8 8l4-4 4 4 M4 15v5h16v-5"/>',
  import: '<path d="M12 4v11 M8 11l4 4 4-4 M4 15v5h16v-5"/>',
} as const

export type IconName = keyof typeof PATHS

export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`
}
