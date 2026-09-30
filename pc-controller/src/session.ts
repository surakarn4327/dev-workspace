import mqtt, { type MqttClient } from 'mqtt';
import { open, seal, type DerivedPairing } from './crypto';
import {
  MQTT_HOST, MQTT_WSS_PATH, MQTT_WSS_PORT, agentTopics, topics,
  type BrokerSettings,
} from './settings';

// One MQTT connection shared by every screen. Screens subscribe to `session`
// changes and re-render; they never touch the client directly.

export interface EspSchedule {
  days: number[]; // 0 = Sunday ... 6 = Saturday (same as JS Date#getDay)
  on: string; // "HH:MM"
  paused: boolean;
  tz: number; // minutes east of UTC, e.g. 420 for Thailand
}

export interface AgentApp {
  id: string;
  name: string;
  running?: boolean;
}

export interface AgentState {
  ts: number;
  version: string;
  bootAt: number | null; // unix ms when the PC booted
  config: { days: number[]; off: string; countdown: number; paused: boolean };
  selected: AgentApp[];
  catalog: AgentApp[];
  skipToday: boolean;
  postponedUntil: number | null;
}

export type ConnState = 'connecting' | 'connected' | 'error';
// unpaired: no code saved · waiting: code saved, nothing heard yet ·
// notfound: waited, no agent with that ID · badcode: state seen but not
// decryptable with our key · online/offline: paired, agent up / PC off.
export type AgentLink = 'unpaired' | 'waiting' | 'notfound' | 'badcode' | 'online' | 'offline';

export interface SessionState {
  conn: ConnState;
  esp: boolean | null;
  pc: boolean | null;
  sched: EspSchedule | null;
  agentLink: AgentLink;
  agent: AgentState | null;
}

const NOTFOUND_AFTER_MS = 8000;

let client: MqttClient | null = null;
let settings: BrokerSettings | null = null;
let pairing: DerivedPairing | null = null;
let notFoundTimer: number | undefined;
let agentAvailability: 'online' | 'offline' | null = null;
let agentDecryptOk = false;
let agentBadCode = false;

const listeners = new Set<() => void>();

export const state: SessionState = {
  conn: 'connecting',
  esp: null,
  pc: null,
  sched: null,
  agentLink: 'unpaired',
  agent: null,
};

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

function recomputeAgentLink(): void {
  if (!pairing) state.agentLink = 'unpaired';
  else if (agentBadCode && !agentDecryptOk) state.agentLink = 'badcode';
  else if (agentDecryptOk) state.agentLink = agentAvailability === 'online' ? 'online' : 'offline';
  else if (agentAvailability === 'online') state.agentLink = 'waiting';
  else state.agentLink = notFoundTimer === undefined ? 'notfound' : 'waiting';
}

function resetAgentTracking(): void {
  window.clearTimeout(notFoundTimer);
  notFoundTimer = undefined;
  agentAvailability = null;
  agentDecryptOk = false;
  agentBadCode = false;
  state.agent = null;
  if (pairing) {
    notFoundTimer = window.setTimeout(() => {
      notFoundTimer = undefined;
      recomputeAgentLink();
      emit();
    }, NOTFOUND_AFTER_MS);
  }
  recomputeAgentLink();
}

export function startSession(s: BrokerSettings, p: DerivedPairing | null): void {
  stopSession();
  settings = s;
  pairing = p;
  state.conn = 'connecting';
  state.esp = null;
  state.pc = null;
  state.sched = null;
  resetAgentTracking();

  const t = topics(s.deviceId);
  const c = mqtt.connect(`wss://${MQTT_HOST}:${MQTT_WSS_PORT}${MQTT_WSS_PATH}`, {
    protocolVersion: 4,
    reconnectPeriod: 3000,
    clientId: `webapp-${Math.random().toString(16).slice(2)}`,
  });
  client = c;

  c.on('connect', () => {
    state.conn = 'connected';
    c.subscribe([t.status, t.availability, t.sched]);
    subscribeAgent();
    emit();
  });
  c.on('reconnect', () => { state.conn = 'connecting'; emit(); });
  c.on('error', () => { state.conn = 'error'; emit(); });
  c.on('close', () => { state.conn = 'error'; emit(); });

  c.on('message', (topic, payload) => {
    const value = payload.toString();
    if (topic === t.status) {
      state.pc = value === 'online';
    } else if (topic === t.availability) {
      state.esp = value === 'online';
    } else if (topic === t.sched) {
      try { state.sched = JSON.parse(value) as EspSchedule; } catch { /* ignore junk */ }
    } else if (pairing && topic === agentTopics(pairing.agentId).availability) {
      agentAvailability = value === 'online' ? 'online' : 'offline';
    } else if (pairing && topic === agentTopics(pairing.agentId).state) {
      void handleAgentState(value, pairing);
      return;
    }
    recomputeAgentLink();
    emit();
  });
  emit();
}

async function handleAgentState(text: string, forPairing: DerivedPairing): Promise<void> {
  const parsed = await open<AgentState>(forPairing.key, 'state', text);
  if (pairing !== forPairing) return; // pairing changed while decrypting
  if (parsed) {
    agentDecryptOk = true;
    agentBadCode = false;
    state.agent = parsed;
  } else {
    agentBadCode = true;
  }
  recomputeAgentLink();
  emit();
}

function subscribeAgent(): void {
  if (!client || !pairing) return;
  const a = agentTopics(pairing.agentId);
  client.subscribe([a.availability, a.state]);
}

// Optimistic local update so the UI reacts before the agent's new retained
// state arrives (which then overwrites this with what it actually applied).
export function patchAgentLocal(patch: AgentConfigPatch): void {
  const a = state.agent;
  if (!a) return;
  if (patch.days) a.config.days = patch.days;
  if (patch.off) a.config.off = patch.off;
  if (patch.countdown) a.config.countdown = patch.countdown;
  if (patch.paused !== undefined) a.config.paused = patch.paused;
  if (patch.apps) {
    const byId = new Map([...a.selected, ...a.catalog].map((x) => [x.id, x]));
    a.selected = patch.apps.map((id) => byId.get(id)).filter((x): x is AgentApp => !!x);
  }
  emit();
}

export function setPairing(p: DerivedPairing | null): void {
  if (client && pairing) {
    const old = agentTopics(pairing.agentId);
    client.unsubscribe([old.availability, old.state]);
  }
  pairing = p;
  resetAgentTracking();
  subscribeAgent();
  emit();
}

export function stopSession(): void {
  window.clearTimeout(notFoundTimer);
  notFoundTimer = undefined;
  if (client) {
    client.end(true);
    client = null;
  }
}

// ---------- outgoing ----------

export function pressPower(): void {
  if (settings) client?.publish(topics(settings.deviceId).cmd, 'toggle');
}

export function publishSchedule(sched: EspSchedule): void {
  if (!settings) return;
  state.sched = sched;
  client?.publish(topics(settings.deviceId).sched, JSON.stringify(sched), { retain: true });
  emit();
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sendAgentCommand(type: string): Promise<void> {
  if (!client || !pairing) return;
  const envelope = await seal(pairing.key, 'cmd', { type, ts: Date.now(), id: randomId() });
  client.publish(agentTopics(pairing.agentId).cmd, envelope);
}

export interface AgentConfigPatch {
  days?: number[];
  off?: string;
  countdown?: number;
  paused?: boolean;
  apps?: string[]; // ids, in launch order
}

// Publishes a full config snapshot (current agent state + patch). Needs the
// agent's state first: sending a snapshot built from nothing would wipe the
// agent's saved program list.
export async function sendAgentConfig(patch: AgentConfigPatch): Promise<boolean> {
  if (!client || !pairing || !settings || !state.agent) return false;
  const cur = state.agent;
  const snapshot = {
    days: cur.config.days,
    off: cur.config.off,
    countdown: cur.config.countdown,
    paused: cur.config.paused,
    apps: cur.selected.map((a) => a.id),
    ...patch,
    ts: Date.now(),
    // The agent can't learn the ESP32's device ID by itself; it needs it to
    // route Discord notifications through the ESP32.
    notifyDevice: settings.deviceId,
  };
  const envelope = await seal(pairing.key, 'cmd', snapshot);
  client.publish(agentTopics(pairing.agentId).cfg, envelope, { retain: true });
  return true;
}
