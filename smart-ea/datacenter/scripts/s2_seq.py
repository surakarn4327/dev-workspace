"""Stage 2 sequences.
A) day level: yesterday type (+ quiet streak) -> today type / today range÷ADR / |net|÷ADR, with H1/H2.
B) intraday: after event A, does B happen within 60 min (same or opposite direction) more often than B happens in the same
   clock-time window on an average day? lift = P(B|A) / base, z from binomial SE, H1/H2 lifts."""
import numpy as np
import s2lib as L
D = L.days(); ok = np.isfinite(D["adr20"]); n = len(D["day"])
typ = D["day_type"]; rr = D["range"] / D["adr20"]; an = np.abs(D["net_adr"])
half = np.where(np.arange(n) < np.median(np.flatnonzero(ok)), 1, 2)
print("A) yesterday -> today (days with ADR)   base rates today: " + " ".join(f"{k} {np.mean(typ[ok] == k):.0%}" for k in ("trend", "quiet", "two_sided", "normal")))
print("  yesterday      n  | P(trend) P(quiet) P(two) | range/ADR mean  |net|/ADR mean | H1 P(trend) H2 P(trend) | H1 range H2 range")
cond = {}
for k in ("trend", "quiet", "two_sided", "normal"): cond[k] = np.r_[False, typ[:-1] == k]
qs = np.r_[False, False, (typ[:-2] == "quiet") & (typ[1:-1] == "quiet")]; cond["quiet x2"] = qs
lowr = np.r_[False, rr[:-1] < np.nanquantile(rr[ok], 0.2)]; cond["range<q20"] = lowr
hir = np.r_[False, rr[:-1] > np.nanquantile(rr[ok], 0.8)]; cond["range>q80"] = hir
for name, c in cond.items():
    m = c & ok
    f = lambda mm, k: np.mean(typ[mm] == k)
    print(f"  {name:10s} {m.sum():4d} | {f(m, 'trend'):6.0%} {f(m, 'quiet'):7.0%} {f(m, 'two_sided'):6.0%} | {np.nanmean(rr[m]):.2f}           {np.nanmean(an[m]):.2f}"
          f"          | {f(m & (half == 1), 'trend'):6.0%}      {f(m & (half == 2), 'trend'):6.0%}      | {np.nanmean(rr[m & (half == 1)]):.2f} {np.nanmean(rr[m & (half == 2)]):.2f}")
print(f"  all        {ok.sum():4d} | range/ADR {np.nanmean(rr[ok]):.2f}  |net|/ADR {np.nanmean(an[ok]):.2f}   (range autocorr lag1 {np.corrcoef(rr[ok][1:], rr[ok][:-1])[0, 1]:+.2f},"
      f" |net| lag1 {np.corrcoef(an[ok][1:], an[ok][:-1])[0, 1]:+.2f}, net sign lag1 {np.corrcoef(np.sign(D['net_adr'][ok][1:]), np.sign(D['net_adr'][ok][:-1]))[0, 1]:+.2f})")

# B) intraday sequences
E = L.events(); types = sorted(set(E["type"])); dayidx = {k: i for i, k in enumerate(D["day"])}
tod = ((E["t"] + 3600) % 86400) // 60; di = np.array([dayidx[k] for k in E["day"]])
tmid = np.median(E["t"])
M = {}
for ty in types:
    for sd in (1, -1):
        A = np.zeros((n, 1441), np.int32); m = (E["type"] == ty) & (E["dir"] == sd)
        np.add.at(A, (di[m], tod[m] + 1), 1); M[(ty, sd)] = np.cumsum(A > 0, 1)
W = 60
print(f"\nB) A -> B within {W} min (B after A, strictly later). lift = P(B|A)/P(B in same clock window on any day). show |z|>=3, nA>=40")
print("  A                               -> B (same/opp dir)                 nA   P(B|A)  base   lift   z    | lift H1  H2")
rows = []
for ta in types:
    ma = E["type"] == ta
    if ma.sum() < 40: continue
    ia = np.flatnonzero(ma)
    for tb in types:
        for rel in ("same", "opp"):
            hit = np.zeros(len(ia), bool); base = np.zeros(len(ia))
            for j, k in enumerate(ia):
                sd = E["dir"][k] if rel == "same" else -E["dir"][k]; cs = M[(tb, sd)]
                s0, s1 = tod[k] + 1, min(1440, tod[k] + W)
                hit[j] = cs[di[k], s1] - cs[di[k], s0] > 0
                base[j] = np.mean(cs[ok, s1] - cs[ok, s0] > 0)
            p, b = hit.mean(), base.mean()
            if b <= 0: continue
            se = np.sqrt(b * (1 - b) / len(ia)); z = (p - b) / se
            h1 = E["t"][ia] < tmid
            l1 = hit[h1].mean() / base[h1].mean() if base[h1].mean() > 0 else np.nan; l2 = hit[~h1].mean() / base[~h1].mean() if base[~h1].mean() > 0 else np.nan
            rows.append((z, ta, tb, rel, len(ia), p, b, p / b, l1, l2))
rows.sort(key=lambda x: -abs(x[0]))
for z, ta, tb, rel, na, p, b, lf, l1, l2 in rows:
    if abs(z) < 3: continue
    print(f"  {ta[:30]:30s} -> {tb[:28]:28s} {rel:4s} {na:5d}  {p:5.1%}  {b:5.1%}  {lf:5.2f} {z:+5.1f} | {l1:5.2f} {l2:5.2f}")
