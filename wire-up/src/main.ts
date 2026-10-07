import './style.css'
import { App } from './ui/app.ts'

// start loading the pixel font early; the canvas redraws every frame, so text switches over once it is ready
void document.fonts.load('16px Silver').catch(() => {})

new App()
