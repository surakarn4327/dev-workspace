r"""The ONLY place that knows about the broker. Every script gets paths, symbol spec and the server clock from here.
Active broker = environment variable DC_BROKER (default "exness") -> profile file ..\brokers\<name>.json

server_time options (how the broker's MT5 server clock relates to UTC):
  "UTC"         server = UTC (Exness)
  "UTC+N"       fixed offset, e.g. "UTC+2"
  "NY_CLOSE"    GMT+2 in US winter / GMT+3 in US summer (the common "New York close" server: 17:00 ET = 00:00 server)
All data in the data center is stored in UTC; the trading day is the standard 17:00 New York -> 17:00 New York day (see dc_sessions.py),
so nothing downstream depends on the broker's clock."""
import json, os
from datetime import datetime, timezone
import numpy as np
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
NAME = os.environ.get("DC_BROKER", "exness")
with open(os.path.join(ROOT, "brokers", NAME + ".json"), encoding="utf-8") as f: P = json.load(f)
def path(key): return os.path.join(ROOT, P[key])
DB = path("db_file"); BARS = path("bars_file"); POINT = 10.0 ** -P["digits"]; SYMBOL = P["symbol"]
def utc_ts(date_str): return int(datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
T0 = utc_ts(P["data_start_utc"])
SPREAD_OK_FROM = utc_ts(P["bar_spread_reliable_from_utc"]) if P.get("bar_spread_reliable_from_utc") else None

def us_dst(t_utc):
    """True where US daylight saving time is in effect (2nd Sunday of March 07:00 UTC -> 1st Sunday of November 06:00 UTC)."""
    t_utc = np.asarray(t_utc, dtype=np.int64); out = np.zeros(t_utc.shape, bool)
    years = (t_utc // 86400 // 365.2425 + 1970).astype(int)
    for y in np.unique(np.r_[years - 1, years, years + 1]):
        def nth_sunday(month, n):
            d = datetime(int(y), month, 1, tzinfo=timezone.utc); first = (6 - d.weekday()) % 7
            return int(d.timestamp()) + (first + 7 * (n - 1)) * 86400
        a = nth_sunday(3, 2) + 7 * 3600; b = nth_sunday(11, 1) + 6 * 3600
        out |= (t_utc >= a) & (t_utc < b)
    return out

def server_to_utc(t_server):
    t = np.asarray(t_server, dtype=np.int64); st = P["server_time"]
    if st == "UTC": return t.copy()
    if st.startswith("UTC"): return t - int(float(st[3:]) * 3600)
    if st == "NY_CLOSE":
        guess = t - 2 * 3600                      # decide DST on an approximate UTC, then apply +3 in US summer
        return t - np.where(us_dst(guess), 3, 2) * 3600
    raise ValueError("unknown server_time " + st)
