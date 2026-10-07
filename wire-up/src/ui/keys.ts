// Keyboard helpers shared by every shortcut handler.

/**
 * Which key was pressed, whatever the keyboard language: letters and brackets come from the physical key (`e.code`),
 * so Ctrl+C still reads "c" with a Thai layout (where `e.key` would be a Thai letter). Other keys use `e.key`.
 */
export function keyName(e: { key: string; code: string }): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  if (e.code === 'BracketLeft') return '['
  if (e.code === 'BracketRight') return ']'
  return e.key.toLowerCase()
}
