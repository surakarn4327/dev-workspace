"""First use of the data center: per event type, count/day, direction hit (4h), and tradable R for each SL/TP cell after spread,
split first half vs second half of the data (stability)."""
import sqlite3, numpy as np
db = sqlite3.connect(r"C:\trade datacenter\gold_dc.sqlite")
ndays = db.execute("SELECT COUNT(*) FROM days WHERE adr20 IS NOT NULL").fetchone()[0]
cols = ["g_sl10_tp10", "g_sl10_tp20", "g_sl10_tp30", "g_sl10_tp50", "g_sl20_tp20", "g_sl20_tp40", "g_sl20_tp60", "g_sl30_tp30", "g_sl30_tp60"]
sls = [0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.3, 0.3]
rows = db.execute("SELECT e.type, e.t, e.spread_adr, o.fwd240, " + ",".join("o." + c for c in cols) + " FROM events e JOIN outcomes o ON o.event_id = e.id").fetchall()
a = np.array([r[1:] for r in rows], dtype=float); typ = np.array([r[0] for r in rows])
tmid = np.median(a[:, 0])
print(f" days {ndays} | split at {__import__('datetime').datetime.utcfromtimestamp(tmid):%Y-%m-%d}")
print(" event type                     | per day | hit4h H1/H2 | best SL/TP cell (R after spread) H1 / H2 | all cells H1 -> H2")
for ty in sorted(set(typ), key=lambda x: -np.sum(typ == x)):
    m = typ == ty; h1 = m & (a[:, 0] < tmid); h2 = m & (a[:, 0] >= tmid)
    net = np.column_stack([a[:, 3 + k] - a[:, 1] / sls[k] for k in range(len(cols))])   # subtract spread (in R of that SL)
    e1 = net[h1].mean(0); e2 = net[h2].mean(0); b = int(np.argmax(e1))
    cells = " ".join(f"{x:+.2f}>{y:+.2f}" for x, y in zip(e1, e2))
    print(f" {ty:30s} | {m.sum() / ndays:5.2f} | {np.mean(a[h1, 2] > 0):.0%}/{np.mean(a[h2, 2] > 0):.0%} | {cols[b][2:]:9s} {e1[b]:+.3f} / {e2[b]:+.3f} | {cells}")
