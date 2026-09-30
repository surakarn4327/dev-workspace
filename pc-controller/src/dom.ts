export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function q<T extends HTMLElement>(root: ParentNode, selector: string): T {
  return root.querySelector<T>(selector)!;
}

export function screenHeader(title: string): string {
  return `
    <header class="sub-header">
      <button class="back-btn" data-back aria-label="กลับ">‹</button>
      <h1>${escapeHtml(title)}</h1>
    </header>`;
}

export function toggleHtml(id: string, on: boolean): string {
  return `<button type="button" class="toggle${on ? ' on' : ''}" id="${id}" role="switch" aria-checked="${on}"><span></span></button>`;
}

export function setToggle(btn: HTMLElement, on: boolean): void {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', String(on));
}
