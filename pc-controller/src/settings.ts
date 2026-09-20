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
  };
}
