import './style.css'
import { App } from './ui/app.ts'

// The board writes its text in the pixel font Silver. Start the board only once the font is here (or after a few seconds if it
// cannot load), so the first frames are never drawn in the fallback font and then switched over.
const FONT_WAIT_MS = 4000
const fontReady = Promise.race([document.fonts.load('16px Silver'), new Promise<void>((done) => window.setTimeout(done, FONT_WAIT_MS))]).catch(() => {})
void fontReady.then(() => new App())
