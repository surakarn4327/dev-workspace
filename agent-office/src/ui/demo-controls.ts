// Rehearsal controls (speed, forced QA reject / agent error / courier jam, auto-answer) exist only in the
// mock office. Their elements carry `data-demo`; with a real source they are hidden.

export function showDemoControls(available: boolean, root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-demo]')) node.hidden = !available;
}
