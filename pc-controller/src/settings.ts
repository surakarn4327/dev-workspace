export interface BrokerSettings {
  host: string;
  port: number;
  username: string;
  password: string;
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
