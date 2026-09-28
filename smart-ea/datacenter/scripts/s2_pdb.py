"""Stage 2 / PREVDAY_BREAK: tradable R (after spread, cutoff 16:00 server) on a fine grid, stability, BUY/SELL, contexts, null."""
import numpy as np, sys
import s2lib as L
TYPE = sys.argv[1] if len(sys.argv) > 1 else "PREVDAY_BREAK"
E = L.events([TYPE]); B = L.bars()
R, HOLD = L.simulate(E["t"], E["dir"], E["U"])
ok = np.isfinite(R[:, 0, 0]); print(f"{TYPE}: events {len(ok)}, tradable (23:00-14:00 server) {ok.sum()}")
tmid = np.median(E["t"][ok]); h1 = ok & (E["t"] < tmid); h2 = ok & (E["t"] >= tmid)
q = L.quarter_key(E["t"]); Q = sorted(set(q[ok]))
buy = ok & (E["dir"] > 0); sell = ok & (E["dir"] < 0)

def grid(mask, title):
    print(f"\n{title} (n={mask.sum()}) mean R after spread; rows SL (ADR), cols TP (ADR, 'EOD' = no TP)")
    print("  SL\\TP " + " ".join(f"{x:>6}" for x in [f"{v:.1f}" if v < 9 else "EOD" for v in L.TPS]))
    for a, s in enumerate(L.SLS):
        print(f"  {s:5.3f} " + " ".join(f"{np.nanmean(R[mask, a, b]):+6.2f}" for b in range(len(L.TPS))))

grid(ok, "ALL"); grid(h1, "H1"); grid(h2, "H2"); grid(buy, "BUY"); grid(sell, "SELL")

# strict screen per cell
print("\nstrict screen per cell: all/H1/H2/BUY/SELL mean, quarters>0, t, wr, avgW/avgL, max losing streak")
rows = []
for a, s in enumerate(L.SLS):
    for b, tp in enumerate(L.TPS):
        r = R[:, a, b]; st = L.stats(r[ok])
        qm = [np.nanmean(r[ok & (q == k)]) for k in Q]
        rows.append((st["t"], s, tp, st, np.nanmean(r[h1]), np.nanmean(r[h2]), np.nanmean(r[buy]), np.nanmean(r[sell]), sum(x > 0 for x in qm), len(qm)))
rows.sort(key=lambda x: -x[0])
for tt, s, tp, st, m1, m2, mb, ms, qp, qn in rows[:15]:
    print(f"  SL {s:.3f} TP {'EOD' if tp > 9 - 1e-9 else f'{tp:.1f}'}: all {st['mean']:+.3f} (t {tt:+.2f}) H1 {m1:+.3f} H2 {m2:+.3f} "
          f"BUY {mb:+.3f} SELL {ms:+.3f} q+ {qp}/{qn} wr {st['wr']:.0%} W {st['aw']:+.2f} L {st['al']:+.2f} streak {st['streak']}")

# null: same days, random entry time in the same tradable window, same direction (tests "the break itself" vs drift/time)
rng = np.random.default_rng(1)
t, day = B["t"], B["day"]
A, Bi = 2, 3   # SL 0.10, TP 0.5 reference cell
ref = np.nanmean(R[ok, A, Bi]); nulls = []
for rep in range(100):
    nt = np.empty(ok.sum(), dtype=np.int64)
    for k, (dk, et) in enumerate(zip(E["day"][ok], E["t"][ok])):
        lo = np.searchsorted(t, dk * 86400 - 3600); hi = np.searchsorted(t, dk * 86400 + L.LAST_ENTRY_H * 3600)
        nt[k] = t[rng.integers(lo, max(lo + 1, hi))]
    Rn, _ = L.simulate(nt, E["dir"][ok], E["U"][ok], sls=np.array([L.SLS[A]]), tps=np.array([L.TPS[Bi]]))
    nulls.append(np.nanmean(Rn))
nulls = np.array(nulls)
print(f"\nnull (random time same day, same dir) SL {L.SLS[A]} TP {L.TPS[Bi]}: real {ref:+.3f} vs null mean {nulls.mean():+.3f} sd {nulls.std():.3f}"
      f" -> z {(ref - nulls.mean()) / nulls.std():+.2f}, null>=real {np.mean(nulls >= ref):.0%}")
np.savez(f"s2_{TYPE}.npz", R=R, HOLD=HOLD, ok=ok, t=E["t"], dir=E["dir"], U=E["U"], session=E["session"], so_far=E["so_far"],
         bk5=E["bk5"], spread_adr=E["spread_adr"], day=E["day"], hour=E["hour"])
