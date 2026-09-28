"""Report for catalog step 2 (formations, spikes, retests, tick volume, spread, TF nesting, level retests) on FULL days,
each behaviour next to the same measure on 3 shuffled (null) copies of the series: if real ~ null, it is what any series with gold's
volatility does, not a property of gold. Stability = min/max of the monthly per-day average."""
import numpy as np, sqlite3
from datetime import datetime, timezone
import cat_bars as CB, cat_struct as CS
db = sqlite3.connect(CB.DB); M = CB.m1(); FULL = CB.full_list(); ND = len(FULL); FS = set(FULL.tolist())
mon = np.array([datetime.fromtimestamp(int(d) * 86400, timezone.utc).strftime("%Y-%m") for d in FULL]); months = sorted(set(mon))
day_m1 = M["day"]
def perday(days):
    days = np.asarray(days, dtype=np.int64); days = days[np.isin(days, FULL)]
    return np.bincount(np.searchsorted(FULL, days), minlength=ND).astype(float)
def mm(p): v = [p[mon == m].mean() for m in months]; return min(v), max(v)
# ---------- null runs (3 shuffles) : formation / spike / retest / divergence / nesting measures
def measures(t, sid, o, h, l, c, tv, dayarr):
    out = {}; legs = {}
    for tf in (1, 5, 15):
        B = CS.resample(tf, t, sid, o, h, l, c, tv); bday = dayarr[B["m1_end"] - 1]; full = np.isin(bday, FULL)
        idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"])
        for typ, j, d, x in CS.formations(idx, p, kind, conf, B["atr"]):
            if full[j]: out[(tf, typ)] = out.get((tf, typ), 0) + 1
        rng = B["h"] - B["l"]; ok = np.isfinite(B["atr"]) & (rng >= 3 * B["atr"]) & full
        pos = np.where(rng > 0, (B["c"] - B["l"]) / np.where(rng > 0, rng, 1), 0.5); col = np.sign(B["c"] - B["o"])
        m = ok & (((col > 0) & (pos <= 0.3)) | ((col < 0) & (pos >= 0.7)) | ((pos <= 0.3) & (B["h"] - np.maximum(B["o"], B["c"]) >= 0.6 * rng)) | ((pos >= 0.7) & (np.minimum(B["o"], B["c"]) - B["l"] >= 0.6 * rng)))
        out[(tf, "SPIKE_REJECT")] = int(m.sum())
        R = [r for r in CS.retests(idx, p, kind, conf, B["h"], B["l"], B["c"], B["atr"], B["sid"]) if full[r[1]]]
        for o_ in ("NODEPART", "NORETEST", "RETEST_HOLD", "RETEST_FAIL"): out[(tf, o_)] = sum(1 for r in R if r[0] == o_)
        tvb = B["tv"].astype(float); vpb = [tvb[idx[q - 1] + 1:idx[q] + 1].sum() / max(1, idx[q] - idx[q - 1]) for q in range(1, len(p))]
        dv = cf = 0
        for q in range(3, len(p)):
            if (p[q] - p[q - 2]) * kind[q] > B["atr"][idx[q]] and full[conf[q]]:
                if vpb[q - 1] < vpb[q - 3]: dv += 1
                else: cf += 1
        out[(tf, "DIV_SHARE")] = dv / max(1, dv + cf)
        legs[tf] = (B["t"][idx], p)
    for lo, hi in ((1, 5), (1, 15), (5, 15)):
        tl, pl = legs[lo]; th, ph = legs[hi]; same = tot = 0
        for q in range(1, len(pl)):
            hh = np.searchsorted(th, tl[q], "left")
            if 0 < hh < len(th): tot += 1; same += np.sign(pl[q] - pl[q - 1]) == np.sign(ph[hh] - ph[hh - 1])
        out[("NEST", lo, hi)] = same / max(1, tot); out[("NESTN", lo, hi)] = (len(pl) - 1) / max(1, len(ph) - 1)
    return out
print("computing 3 shuffled + 3 sign-flipped copies ...", flush=True)
NULLS, NULLF = [], []
for s in range(3):
    O, H, L, C, TV = CS.shuffle_m1(M["o"], M["h"], M["l"], M["c"], M["tv"].astype(float), M["sid"], 300 + s)
    NULLS.append(measures(M["t"], M["sid"], O, H, L, C, TV, day_m1))
    O, H, L, C, TV = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], M["tv"].astype(float), M["sid"], 400 + s)
    NULLF.append(measures(M["t"], M["sid"], O, H, L, C, TV, day_m1))
REAL = measures(M["t"], M["sid"], M["o"], M["h"], M["l"], M["c"], M["tv"].astype(float), day_m1)
def nl(key, W=None): v = [x.get(key, 0) for x in (NULLS if W is None else W)]; return np.mean(v), np.std(v)
print(f"full days {ND}\n\nA) FORMATIONS / SPIKES per day (real vs shuffled null; ratio > 1 = more common in gold than in a random series)")
print(" TF  type          | real/day [days>=1] | shuffle null | real/shuffle | signflip null | real/signflip | monthly min-max | dir +1 | peak NY hr")
for tf in (1, 5, 15):
    for ty in ("HS", "IHS", "TRIPLE", "TRIANGLE", "BROADEN", "FLAG", "V_REV", "EXHAUST", "SPIKE_REJECT"):
        X = db.execute("SELECT day, dir, et_hour FROM patterns_c WHERE tf=? AND type=?", (tf, ty)).fetchall()
        X = [x for x in X if x[0] in FS]; p = perday([x[0] for x in X]); a, b = nl((tf, ty))
        d = np.array([x[1] for x in X]); eh = np.array([x[2] for x in X]) if X else np.array([0]); f_, g_ = nl((tf, ty), NULLF)
        print(f" M{tf:<2} {ty:13s} | {p.mean():6.2f} [{np.mean(p >= 1):4.0%}]    | {a / ND:6.2f}       | {p.mean() / (a / ND) if a else np.nan:6.2f}       |"
              f" {f_ / ND:6.2f}        | {p.mean() / (f_ / ND) if f_ else np.nan:6.2f}        | {mm(p)[0]:5.2f}-{mm(p)[1]:5.2f}   |"
              f" {np.mean(d[d != 0] > 0) if np.any(d != 0) else np.nan:5.0%}  | {np.bincount(eh, minlength=24).argmax():02d}")
print("\nB) BREAK & RETEST of swing levels (per break; real vs null)")
print(" TF  | breaks/day | never left 1 ATR / left no retest / retest+hold / retest+fail | median bars break->retest | shuffle null (same 4) | signflip null (same 4)")
K4 = ("NODEPART", "NORETEST", "RETEST_HOLD", "RETEST_FAIL")
def shares(W, tf): nn = [sum(x.get((tf, k), 0) for x in W) for k in K4]; ns = max(1, sum(nn)); return " / ".join(f"{v / ns:.0%}" for v in nn)
for tf in (1, 5, 15):
    X = db.execute("SELECT outcome, day, bars_to_retest FROM retests WHERE tf=?", (tf,)).fetchall(); X = [x for x in X if x[1] in FS]
    o = np.array([x[0] for x in X]); nb = np.array([x[2] for x in X]); n = len(o)
    real4 = " / ".join(f"{np.mean(o == k):.0%}" for k in K4)
    print(f" M{tf:<2} | {n / ND:9.2f}  | {real4:60s} | {np.median(nb[nb >= 0]):6.0f}                    | {shares(NULLS, tf):21s} | {shares(NULLF, tf)}")
print("\nC) RETEST OF PRICE LEVELS (from level_visits: a CROSS followed by the next visit of the same level from the new side)")
print(" level group     | retests/day | holds (BOUNCE) | poke | fails (CROSS back)")
V = db.execute("SELECT level_type, day, level, t_touch, side, outcome FROM level_visits ORDER BY level_type, level, t_touch").fetchall()
from collections import defaultdict
seq = defaultdict(list)
for v in V: seq[(v[0], round(v[2], 3), v[1])].append(v)
grp = {"round $10-100": ("R10", "R50", "R100"), "pseudo levels": ("P10a", "P10b"), "prev day H/L/C": ("PDH", "PDL", "PDC"),
       "opens (day/LDN/NY)": ("DOPEN", "LOPEN", "NYOPEN"), "prev week/month H/L": ("PWH", "PWL", "PMH", "PML")}
for g, types in grp.items():
    res = []
    for (lt, lv, dk), vs in seq.items():
        if lt not in types or dk not in FS: continue
        for a_, b_ in zip(vs[:-1], vs[1:]):
            if a_[5] == "CROSS" and b_[4] == -a_[4]: res.append((dk, b_[5]))
    o = np.array([r[1] for r in res])
    print(f" {g:18s} | {len(res) / ND:10.2f}  | {np.mean(o == 'BOUNCE'):12.0%}   | {np.mean(o == 'POKE'):4.0%} | {np.mean(o == 'CROSS'):6.0%}")
print("\nD) TICK VOLUME (relative to the previous day's mean bar volume of the same TF)")
print(" TF  | VOL_SPIKE/day (>=3x) [also a bar >= 2 ATR] | VOL_DRY/day | new extremes: divergence share (lower vol than previous leg) real vs null")
for tf in (1, 5, 15):
    S = [x for x in db.execute("SELECT day, t FROM vol_events WHERE tf=? AND type='VOL_SPIKE'", (tf,)).fetchall() if x[0] in FS]
    Dr = [x for x in db.execute("SELECT day FROM vol_events WHERE tf=? AND type='VOL_DRY'", (tf,)).fetchall() if x[0] in FS]
    big = set(r[0] for r in db.execute("SELECT t FROM patterns WHERE tf=? AND type='BIGBAR'", (tf,)).fetchall())
    dv = [x for x in db.execute("SELECT day, type FROM vol_events WHERE tf=? AND type IN ('DIVERGENCE','CONFIRM')", (tf,)).fetchall() if x[0] in FS]
    share = np.mean([x[1] == "DIVERGENCE" for x in dv]); a, b = nl((tf, "DIV_SHARE")); f_, g_ = nl((tf, "DIV_SHARE"), NULLF)
    print(f" M{tf:<2} | {len(S) / ND:8.2f} [{np.mean([s[1] in big for s in S]):4.0%}]                         | {len(Dr) / ND:8.2f}    |"
          f" {share:.0%} vs shuffle {a:.0%} / signflip {f_:.0%} (sd {g_:.1%})")
print("\nE) SPREAD WIDENING (M1, bar spread >= 2x the day's median; only where the broker profile marks bar spread as real)")
SE = db.execute("SELECT day, minutes, peak_ratio, et_hour FROM spread_events").fetchall()
nd_sp = len(set(db.execute("SELECT day FROM days").fetchall()))
if SE:
    days_sp = len(set(d for d in M["day"][M["t"] >= (CB.BK.SPREAD_OK_FROM if hasattr(CB, 'BK') else 0)]))
import broker as BK
sp_days = np.unique(M["day"][M["t"] >= BK.SPREAD_OK_FROM]) if BK.SPREAD_OK_FROM else []
if len(sp_days) and SE:
    eh = np.array([x[3] for x in SE])
    print(f"   {len(SE)} events in {len(sp_days)} days ({len(SE) / len(sp_days):.2f}/day), median {np.median([x[1] for x in SE]):.0f} min, peak {np.median([x[2] for x in SE]):.1f}x;"
          f" NY hours: {dict(zip(*np.unique(eh, return_counts=True)))}")
print("\nF) TIMEFRAME NESTING (lower-TF legs inside higher-TF legs)")
print(" pair     | lower legs per higher leg | share in the SAME direction as the higher leg | shuffle null | signflip null | larger lower legs (>= 5 ATR) same-dir share")
for lo, hi in ((1, 5), (1, 15), (5, 15)):
    X = np.array([x for x in db.execute("SELECT day, same_dir, size_atr FROM nesting WHERE tf_low=? AND tf_high=?", (lo, hi)).fetchall() if x[0] in FS])
    a, b = nl(("NEST", lo, hi)); f_, g_ = nl(("NEST", lo, hi), NULLF)
    print(f" M{lo}-M{hi:<3} | {REAL[('NESTN', lo, hi)]:6.1f}                    | {X[:, 1].mean():6.1%}                                        | {a:6.1%}"
          f"       | {f_:6.1%}        | {X[X[:, 2] >= 5, 1].mean():6.1%}")
