// The "Search helper" panel in the Menu: a coloured square and one sentence saying whether the helper that
// searches the web for the team is running, with a button to look again.

import type { HelperMonitor } from '../ai/helper-monitor.ts';
import { t } from '../core/i18n.ts';
import { el } from './dom.ts';

export function mountHelperStatus(monitor: HelperMonitor): { refresh(): void } {
  const dot = el<HTMLElement>('#helper-dot');
  const text = el<HTMLElement>('#helper-status');
  const button = el<HTMLButtonElement>('#helper-recheck');

  function refresh(): void {
    const { state } = monitor.status;
    dot.dataset.state = state;
    text.textContent = t(`helper.state.${state}`);
    button.disabled = state === 'checking';
  }

  button.addEventListener('click', () => {
    void monitor.check();
  });
  monitor.onChange(refresh);
  refresh();
  return { refresh };
}
