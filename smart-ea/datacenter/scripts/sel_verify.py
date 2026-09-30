r"""Independent check of the Phase-4 Selector walk-forward (sel_lib / sel_exit / sel_walk). Does NOT import those modules nor
adx_asof: reads the two sqlite files with plain SQL and re-implements the written rule from its description.
Checks: (1) picks per month  (2) month R per set  (3) exit-rule R per trade  (4) compounding  (5) no row used by a decision
closes at/after T, and no traded row has trade-day >= 2026-06-01.
"""
import sqlite3, datetime as dt, math, os, sys
import numpy as np

T_DB = r"C:\trade datacenter\adx_trades.sqlite"; H_DB = r"C:\trade datacenter\adx_hold.sqlite"
OUT = os.path.join(os.path.dirname(__file__), "..", "sel", "sel_walk_out.npz")
LIM = (dt.date(2026, 6, 1) - dt.date(1970, 1, 1)).days
WIN, MINN, NBS, SEM, K = 365, 200, 0.70, 1.0, 5

def ts(y, m): return int(dt.datetime(y, m, 1, tzinfo=dt.timezone.utc).timestamp())

t = sqlite3.connect(T_DB); h = sqlite3.connect(H_DB)
par = {r[0]: r[1:] for r in t.execute("SELECT set_id, tf, adx_p, ema_p, min_adx, min_gap, sl_atr, exit_mode FROM params")}
rows = t.execute("SELECT set_id, n, day, exit_t, r_std FROM trades WHERE day < ?", (LIM,)).fetchall()
umap = {(s, n): u for s, n, u in h.execute("SELECT set_id, n, uid FROM set_map")}
# exit rule (a), written independently: M3 trade, first dec row (by time) with new day low for BUY / new day high for SELL
first_cut = {}
for u, d, fl, dt_, rc in h.execute("SELECT u.uid, u.dir, d.flags, d.dec_t, d.r_cut FROM dec d JOIN utrades u USING(uid) WHERE u.tf = 3"):
    hit = (d > 0 and fl & 1024) or (d < 0 and fl & 512)
    if hit and (u not in first_cut or dt_ < first_cut[u][1]): first_cut[u] = (rc, dt_)
tr = []   # set, n, day, exit_t (plan), r_adj, exit_adj
for s, n, d, ex, r in rows:
    u = umap[(s, n)]
    if par[s][0] == 3 and u in first_cut: tr.append((s, n, d, ex, first_cut[u][0], first_cut[u][1]))
    else: tr.append((s, n, d, ex, r, ex))
print("trades", len(tr), " M3 cut", sum(1 for x in tr if x[5] != x[3] or (par[x[0]][0] == 3 and umap[(x[0], x[1])] in first_cut)))

# neighbours: one parameter one step away
dims = list(zip(*par.values())); vals = [sorted(set(v)) for v in dims]
bykey = {v: s for s, v in par.items()}
def nbrs(s):
    out = []
    for i in range(7):
        j = vals[i].index(par[s][i])
        for jj in (j - 1, j + 1):
            if 0 <= jj < len(vals[i]):
                kk = list(par[s]); kk[i] = vals[i][jj]; kk = tuple(kk)
                if kk in bykey: out.append(bykey[kk])
    return out

def pick(T):
    d0 = T // 86400; a = d0 - WIN; mid = d0 - WIN // 2
    by = {}
    for s, n, d, ex, r, exa in tr:
        if ex + 60 <= T and a <= d < d0: by.setdefault(s, []).append((d, r))
    st = {}
    for s, v in by.items():
        if len(v) < 2: continue
        r = np.array([x[1] for x in v]); d = np.array([x[0] for x in v]); n = len(r)
        h1, h2 = r[d < mid], r[d >= mid]
        st[s] = (n, r.mean(), r.mean() - SEM * r.std(ddof=1) / math.sqrt(n), len(h1) > 0 and len(h2) > 0 and h1.mean() > 0 and h2.mean() > 0,
                 (n, round(float(r.sum()), 9), round(float(np.abs(r).sum()), 9)))
    el = set()
    for s, (n, mu, sc, both, _) in st.items():
        if n < MINN or not both: continue
        nb = [st[j][1] > 0 for j in nbrs(s) if j in st and st[j][0] >= MINN]
        if nb and sum(nb) / len(nb) >= NBS: el.add(s)
    order = sorted(el, key=lambda s: -st[s][2]) + sorted(set(st) - el, key=lambda s: -st[s][2])
    out, seen = [], set()
    for s in order:
        if st[s][4] in seen: continue
        seen.add(st[s][4]); out.append(s)
        if len(out) == K: break
    return out

Z = np.load(OUT, allow_pickle=True)
ok = True; alltr = []
for i, T in enumerate(Z["months"]):
    y, m = int(T[:4]), int(T[5:7]); t0 = ts(y, m); y2, m2 = (y + (m == 12), m % 12 + 1)
    a, b = t0 // 86400, min(ts(y2, m2) // 86400, LIM)
    p = pick(t0)
    mr = np.mean([sum(x[4] for x in tr if x[0] == s and a <= x[2] < b) for s in p])
    alltr += [(x[5], x[4]) for x in tr if x[0] in p and a <= x[2] < b]
    good = list(p) == list(Z["picks"][i]) and abs(mr - Z["month_r"][i]) < 1e-9
    ok &= good
    print(T, p, "%+.2f" % mr, "OK" if good else f"MISMATCH walk={list(Z['picks'][i])} {Z['month_r'][i]:+.2f}")
alltr.sort()
rs = np.array([x[1] for x in alltr])
same = len(rs) == len(Z["trades"]) and np.allclose(rs, Z["trades"][:, 1], atol=1e-12)
print("trade list identical:", same); ok &= same
for f in (0.01, 0.02, 0.05):
    eq = 10000.0; pk = eq; dd = 0
    for x in rs: eq *= 1 + f / K * x; pk = max(pk, eq); dd = max(dd, 1 - eq / pk)
    print("  %.0f%%: %.0f  maxDD %.0f%%" % (f * 100, eq, dd * 100))
tfp = [par[s][0] for p in Z["picks"] for s in p]
print("TF of picks (M1/M3/M5):", tfp.count(1), tfp.count(3), tfp.count(5))
print("ALL OK" if ok else "FAILED"); sys.exit(0 if ok else 1)
