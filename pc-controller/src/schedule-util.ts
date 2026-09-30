import type { EspSchedule } from './session';

export const DAY_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const DAY_LONG = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export const DEFAULT_DAYS = [1, 2, 3, 4, 5];
export const DEFAULT_ON = '08:00';
export const DEFAULT_OFF = '18:00';
export const COUNTDOWN_OPTIONS = [10, 30, 60, 120];

export function localTz(): number {
  return -new Date().getTimezoneOffset();
}

export function defaultSchedule(): EspSchedule {
  return { days: DEFAULT_DAYS, on: DEFAULT_ON, paused: false, tz: localTz() };
}

function atTime(base: Date, hhmm: string, addDays: number): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export function nextOccurrence(days: number[], hhmm: string, now: Date, skipToday = false): Date | null {
  if (days.length === 0) return null;
  for (let i = skipToday ? 1 : 0; i < 8; i++) {
    const d = atTime(now, hhmm, i);
    if (d.getTime() > now.getTime() && days.includes(d.getDay())) return d;
  }
  return null;
}

export function formatWhen(date: Date, now: Date): string {
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000,
  );
  if (dayDiff === 0) return `วันนี้ ${time}`;
  if (dayDiff === 1) return `พรุ่งนี้ ${time}`;
  return `วัน${DAY_LONG[date.getDay()]} ${time}`;
}

export function formatUptime(bootAt: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - bootAt) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}
