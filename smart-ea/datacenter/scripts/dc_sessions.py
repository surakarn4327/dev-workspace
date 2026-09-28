"""Standard trading day, independent of any broker: 17:00 New York -> 17:00 New York (the usual gold / FX "NY close" day).
Input times must be UTC (broker.server_to_utc converts the broker clock first). US daylight saving is computed from the calendar.
- sid[i]    : running session number (changes when the trading date changes)
- day[i]    : trading date key = days since epoch of the date that starts at 17:00 ET the evening before
- et_hour[i]: New York clock hour; phases: asia 17:00-02:59, london 03:00-07:59, newyork 08:00-12:59, late 13:00-16:59 ET
(2026-09-28: replaced detection of the broker's daily pause, which only worked for one broker's hours.)"""
import numpy as np
from broker import us_dst

def sessions(t_utc):
    t = np.asarray(t_utc, dtype=np.int64)
    et_sec = t - np.where(us_dst(t), 4, 5) * 3600                     # New York local time in seconds
    day = (et_sec + 7 * 3600) // 86400                                 # 17:00 ET + 7h = next midnight -> belongs to the next date
    sid = np.concatenate([[0], np.cumsum(np.diff(day) != 0)])
    et_hour = (et_sec // 3600) % 24
    return sid, day, et_hour

def phase(et_hour):
    e = np.asarray(et_hour)
    return np.where((e >= 17) | (e < 3), "asia", np.where(e < 8, "london", np.where(e < 13, "newyork", "late")))

def full_days(day):
    """Trading dates with a normal amount of data: >= 90% of the median bars per date (broker-neutral replacement for '>= 1200 bars';
    90% keeps holiday early-close days out, as before)."""
    ud, cnt = np.unique(np.asarray(day), return_counts=True)
    return ud[cnt >= 0.90 * np.median(cnt)]
