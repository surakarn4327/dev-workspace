// Public EMQX test broker: free, no account, no credentials. Trades a
// little privacy (anyone who guesses your device ID could publish to your
// topics) for a much simpler setup — mitigated by picking a long, random
// device ID, the same way you'd pick an unguessable ntfy.sh topic name.
export const MQTT_HOST = 'broker.emqx.io';
export const MQTT_WSS_PORT = 8084;
export const MQTT_WSS_PATH = '/mqtt';

export interface BrokerSettings {
  deviceId: string;
  deviceName: string;
}

const STORAGE_KEY = 'pc-controller:settings';

export function loadSettings(): BrokerSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BrokerSettings;
  } catch {
    return null;
  }
}

export function saveSettings(settings: BrokerSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function topics(deviceId: string) {
  const base = `pc-controller/${deviceId}`;
  return {
    status: `${base}/status`,
    availability: `${base}/availability`,
    cmd: `${base}/cmd`,
    // Power-on schedule for the ESP32 (retained, plain JSON).
    sched: `${base}/sched`,
    // Plain-text events from the PC agent that the ESP32 forwards to Discord.
    notify: `${base}/notify`,
  };
}

// ---------- pairing with the Windows agent ----------

// Only the normalized 12-character pairing code is stored; the agent ID and
// encryption key are derived from it (see crypto.ts) each time the app starts.
const PAIRING_KEY = 'pc-controller:agent-code';

export function loadPairingCode(): string | null {
  try {
    return localStorage.getItem(PAIRING_KEY);
  } catch {
    return null;
  }
}

export function savePairingCode(code: string): void {
  localStorage.setItem(PAIRING_KEY, code);
}

export function clearPairingCode(): void {
  localStorage.removeItem(PAIRING_KEY);
}

export function agentTopics(agentId: string) {
  const base = `pc-controller/agent-${agentId}`;
  return {
    availability: `${base}/availability`,
    state: `${base}/state`,
    // One-shot commands (scan, ...). Not retained.
    cmd: `${base}/cmd`,
    // Full configuration snapshot, retained so an agent that was off when the
    // schedule was edited still picks the change up when the PC boots.
    cfg: `${base}/cfg`,
  };
}
