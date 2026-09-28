"""Check the broker-neutral day (17:00 New York) against the pause-based day measured on Exness, and the DST dates / clock conversions."""
import numpy as np
from datetime import datetime, timezone
import broker as BK
from dc_sessions import sessions
# 1) US DST switch instants 2024-2026 (expected: 2nd Sun Mar 07:00 UTC, 1st Sun Nov 06:00 UTC)
for y in (2024, 2025, 2026):
    ts = np.arange(int(datetime(y, 1, 1, tzinfo=timezone.utc).timestamp()), int(datetime(y + 1, 1, 1, tzinfo=timezone.utc).timestamp()), 3600)
    d = BK.us_dst(ts); ch = np.flatnonzero(np.diff(d.astype(int))) + 1
    print(y, "DST switches:", [datetime.fromtimestamp(int(ts[i]), timezone.utc).strftime("%Y-%m-%d %H:%M UTC") for i in ch])
# 2) NY_CLOSE / UTC+N conversions round trip on known instants
for st, server, want in (("UTC+2", "2025-01-15 02:00", "2025-01-15 00:00"), ("NY_CLOSE", "2025-01-15 00:00", "2025-01-14 22:00"),
                         ("NY_CLOSE", "2025-07-15 00:00", "2025-07-14 21:00")):
    BK.P["server_time"] = st
    s = int(datetime.strptime(server, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp())
    got = datetime.fromtimestamp(int(BK.server_to_utc([s])[0]), timezone.utc).strftime("%Y-%m-%d %H:%M")
    print(f"{st:8s} server {server} -> UTC {got} (expected {want}) {'OK' if got == want else 'WRONG'}")
BK.P["server_time"] = "UTC"
# 3) new day key vs Exness pause-based day key (pause >= 30 min after 16:00 UTC or weekend)
B = np.load(BK.BARS); t = BK.server_to_utc(B["t"]); t = t[t >= BK.T0]
gap = np.diff(t) // 60; hr = (t[:-1] // 3600) % 24
brk = (gap >= 30) & ((hr >= 16) | (gap > 1000)); sid_old = np.r_[0, np.cumsum(brk)]
st = np.r_[0, np.flatnonzero(brk) + 1]; day_old = (t[st][sid_old] + 3 * 3600) // 86400
sid, day, et = sessions(t)
diff = day != day_old
print(f"bars {len(t)}, day key differs on {diff.sum()} bars ({diff.mean():.4%})")
if diff.any():
    u = np.unique(day_old[diff])
    for d in u[:15]:
        m = diff & (day_old == d)
        print("  old day", datetime.fromtimestamp(int(d) * 86400, timezone.utc).strftime("%Y-%m-%d"), "bars", m.sum(),
              "UTC", datetime.fromtimestamp(int(t[m][0]), timezone.utc).strftime("%m-%d %H:%M"), "->", datetime.fromtimestamp(int(t[m][-1]), timezone.utc).strftime("%H:%M"))
# 4) where does 17:00 ET fall relative to the Exness pause (minutes of bars within +-60 min of the cut)
cut_side = []
for i in np.flatnonzero(np.diff(day) != 0)[:2000]:
    cut_side.append((t[i + 1] - t[i]) // 60)
print("gap in minutes across each new-day boundary: median", np.median(cut_side), "min", np.min(cut_side), "(>= 60 means the cut sits inside the market pause)")
