"""Retro-check (user 2026-09-28): every behaviour of catalog part A (dc_catalog.py) and step 1 (dc_catalog_b.py / cat_time.py) measured
on the real series AND on two kinds of null series, with ONE function so real and null are measured identically:
  shuffle  = bars shuffled in time inside each day (destroys direction AND volatility clustering)
  signflip = every bar kept in place, each bar mirrored with p=1/2 (destroys ONLY direction; volatility, news spikes, volume stay real)
Reading: real ~ signflip -> not a directional habit of gold (any series with gold's volatility rhythm does it);
         real ~ signflip but != shuffle -> it comes from volatility clustering; real != signflip -> directional property of gold.
Sanity: the real-series counts from this function are compared with the tables in the data center (must match)."""
import numpy as np, sqlite3, sys
import cat_bars as CB, cat_struct as CS
M = CB.m1(); FULL = CB.full_list(); FS = np.asarray(FULL); ND = len(FULL)
db = sqlite3.connect(CB.DB)

def bar_patterns(B, full):
    """exact copy of the rules in dc_catalog.py; returns {type: count on full days}, plus direction lists"""
    o, h, l, c, sid, atr = B["o"], B["h"], B["l"], B["c"], B["sid"], B["atr"]; n = len(c)
    pc = np.r_[c[0], c[:-1]]; rng = h - l; body = np.abs(c - o); up = h - np.maximum(o, c); dn = np.minimum(o, c) - l; col = np.sign(c - o)
    same = np.r_[False, sid[1:] == sid[:-1]]; ok = np.isfinite(atr) & (atr > 0); R = {}
    m = ok & (rng >= atr) & (body <= 0.3 * rng) & ((up >= 0.6 * rng) | (dn >= 0.6 * rng)); R["PINBAR"] = m & full
    R["PINBAR_bull_share"] = np.mean(dn[m & full] >= 0.6 * rng[m & full])
    pb_o, pb_c = np.r_[o[0], o[:-1]], np.r_[c[0], c[:-1]]; pcol = np.sign(pb_c - pb_o)
    R["ENGULF"] = ok & same & (body >= 0.5 * atr) & (col != 0) & (pcol == -col) & (np.maximum(o, c) >= np.maximum(pb_o, pb_c)) & (np.minimum(o, c) <= np.minimum(pb_o, pb_c)) & full
    ph_, pl_ = np.r_[h[0], h[:-1]], np.r_[l[0], l[:-1]]
    R["INSIDE"] = ok & same & (h < ph_) & (l > pl_) & full; R["OUTSIDE"] = ok & same & (h > ph_) & (l < pl_) & full
    R["BIGBAR"] = ok & (rng >= 2 * atr) & full; R["DOJI"] = ok & (rng >= 0.5 * atr) & (body <= 0.1 * rng) & full
    step = np.sign(c - pc); run = 0; last = 0; r3 = np.zeros(n, bool)
    for k in range(n):
        if not same[k] or step[k] == 0 or step[k] != last: run = 0
        last = step[k] if same[k] else 0
        if same[k] and step[k] != 0: run += 1
        if run == 3 and ok[k]: r3[k] = True; run = -10 ** 9
    R["RUN3"] = r3 & full
    W = 12; armed_s = armed_p = True; sq = np.zeros(n, bool); pu = np.zeros(n, bool)
    hmax = np.full(n, np.nan); lmin = np.full(n, np.nan)
    if n > W:
        from numpy.lib.stride_tricks import sliding_window_view as sw
        hmax[W - 1:] = sw(h, W).max(1); lmin[W - 1:] = sw(l, W).min(1)
        path = np.full(n, np.nan); ad = np.abs(np.diff(c)); cs = np.r_[0, np.cumsum(ad)]; path[W:] = cs[W:n] - cs[:n - W]
    for k in range(W, n):
        if sid[k - W + 1] != sid[k]: armed_s = armed_p = True; continue
        a0 = atr[k - W + 1]
        if not np.isfinite(a0) or a0 <= 0: continue
        if hmax[k] - lmin[k] <= 2.5 * a0:
            if armed_s: sq[k] = True; armed_s = False
        else: armed_s = True
        net = c[k] - c[k - W]
        if path[k] > 0 and abs(net) / path[k] >= 0.6 and abs(net) >= 4 * a0:
            if armed_p: pu[k] = True; armed_p = False
        else: armed_p = True
    R["SQUEEZE"] = sq & full; R["PUSH"] = pu & full
    return R

def structure(B, full):
    """zigzag (same rule) -> swing classes, pullback bands, legs, structure runs (as dc_catalog.py / dc_catalog_b.py)"""
    idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"]); atr = B["atr"]; R = {}
    cls = {k: 0 for k in ("SW_NEWEXT", "SW_SWEEP", "SW_DOUBLE", "SW_FAIL", "PULLBACK_SHALLOW", "PULLBACK_MID", "PULLBACK_DEEP", "PULLBACK_OVER")}
    sh_dir = []
    for m in range(2, len(p)):
        if not full[conf[m]]: continue
        a = atr[idx[m]]; beyond = (p[m] - p[m - 2]) * kind[m] / a
        cls["SW_NEWEXT" if beyond > 1 else ("SW_SWEEP" if beyond > 0.3 else ("SW_DOUBLE" if beyond >= -0.3 else "SW_FAIL"))] += 1
        retr = abs(p[m] - p[m - 1]) / abs(p[m - 1] - p[m - 2])
        band = "SHALLOW" if retr < 0.382 else ("MID" if retr < 0.618 else ("DEEP" if retr < 1 else "OVER")); cls["PULLBACK_" + band] += 1
        if band == "SHALLOW": sh_dir.append(np.sign(p[m - 1] - p[m - 2]))
    R.update(cls); R["PULLBACK_SHALLOW_up_share"] = np.mean(np.array(sh_dir) > 0) if sh_dir else np.nan
    R["LEGS"] = int(np.sum(full[idx[1:]]))
    runs = []; k = 2
    while k < len(p):
        s = 1 if p[k] > p[k - 2] else -1; k0 = k
        while k < len(p) and ((p[k] > p[k - 2]) if s > 0 else (p[k] < p[k - 2])): k += 1
        if k - k0 >= 2 and full[idx[k - 1]]: runs.append(k - k0)
        if k == k0: k += 1
    runs = np.array(runs); R["TREND_RUNS"] = len(runs)
    R["TREND_P_CONT_3to4"] = np.mean(runs >= 4) / max(np.mean(runs >= 3), 1e-9); R["TREND_share_n5+"] = np.mean(runs >= 5)
    return R

def boxes(B, full):
    bh, bl, bs, atr = B["h"], B["l"], B["sid"], B["atr"]; n = len(bh); cnt = bars = up = dn = 0; i = 0
    while i < n - 1:
        a = atr[i]
        if not np.isfinite(a) or a <= 0: i += 1; continue
        hi_, lo_ = bh[i], bl[i]; j = i
        while j + 1 < n and bs[j + 1] == bs[i] and max(hi_, bh[j + 1]) - min(lo_, bl[j + 1]) <= 4 * a:
            j += 1; hi_ = max(hi_, bh[j]); lo_ = min(lo_, bl[j])
        if j - i + 1 >= 20:
            if full[j]:
                cnt += 1; bars += j - i + 1
                if j + 1 < n and bs[j + 1] == bs[i]:
                    if bh[j + 1] > hi_: up += 1
                    else: dn += 1
            i = j + 1
        else: i += 1
    return {"BOXES": cnt, "BOX_time_share": bars / max(1, full.sum()), "BOX_exit_up_share": up / max(1, up + dn)}

def levels_and_time(t, sid, day, o, h, l, c, B5, fullday_set):
    """round-number / pseudo / previous-day-H/L visits (same rules as dc_catalog_b.py), plus time behaviours of cat_time.py"""
    a5 = np.full(len(t), np.nan)
    for k in range(len(B5["c"])): a5[(B5["m1_end"][k - 1] if k else 0):B5["m1_end"][k]] = B5["atr"][k]
    starts = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; ends = np.r_[starts[1:], len(t)]
    V = {g: [0, 0, 0] for g in ("ROUND", "PSEUDO", "PREVDAY_HL")}; prev = None; ranges = []
    T = {"hl_first_hour": 0, "first_hour_share": [], "gaps": 0, "gap_filled": 0, "days": 0}
    def visit(w, L, g):
        a = a5[w]; ok = np.isfinite(a)
        if ok.sum() < 30: return
        d_ = (c[w] - L) / a; far = ok & (np.abs(d_) >= 1); side = np.sign(d_); band = ok & (l[w] <= L + 0.25 * a) & (h[w] >= L - 0.25 * a)
        F = np.flatnonzero(far); cb = np.r_[0, np.cumsum(band)]
        for f0, f1 in zip(F[:-1], F[1:]):
            if f1 == f0 + 1 and side[f0] == side[f1]: continue
            if side[f0] != side[f1]: V[g][2] += 1; continue
            if cb[f1] - cb[f0 + 1] == 0: continue
            if ((c[w[f0 + 1:f1]] - L) * side[f0] < -0.25 * a[f0 + 1:f1]).any(): V[g][1] += 1
            else: V[g][0] += 1
    for a_, b_ in zip(starts, ends):
        w = np.arange(a_, b_); dk = int(day[b_ - 1]); hi_, lo_ = h[w].max(), l[w].min()
        if dk in fullday_set:
            for g10 in np.arange(np.floor(lo_ / 10) * 10, hi_ + 10, 10):
                visit(w, g10, "ROUND"); visit(w, g10 + 3.3, "PSEUDO"); visit(w, g10 + 6.7, "PSEUDO")
            if prev is not None: visit(w, prev[0], "PREVDAY_HL"); visit(w, prev[1], "PREVDAY_HL")
            fh = w[t[w] < t[a_] + 3600]; R_ = hi_ - lo_
            T["days"] += 1; T["first_hour_share"].append((h[fh].max() - l[fh].min()) / R_)
            T["hl_first_hour"] += (np.argmax(h[w]) < len(fh)) or (np.argmin(l[w]) < len(fh))
            if len(ranges) >= 20 and a_ > 0:
                U = np.mean(ranges[-20:]); pcl = c[a_ - 1]; gap = o[a_] - pcl
                if abs(gap) >= 0.02 * U:
                    T["gaps"] += 1; T["gap_filled"] += bool(((l[w] <= pcl) if gap > 0 else (h[w] >= pcl)).any())
        ranges.append(hi_ - lo_); prev = (hi_, lo_)
    out = {}
    for g, (b, pk, cr) in V.items():
        n = b + pk + cr; out[f"LEVEL_{g}_visits"] = n; out[f"LEVEL_{g}_bounce_share"] = b / max(1, n); out[f"LEVEL_{g}_cross_share"] = cr / max(1, n)
    out["TIME_high_or_low_in_first_hour_share"] = T["hl_first_hour"] / T["days"]
    out["TIME_first_hour_share_of_range_median"] = float(np.median(T["first_hour_share"]))
    out["TIME_gap_fill_share"] = T["gap_filled"] / max(1, T["gaps"])
    return out

def measure_all(o, h, l, c, tv):
    t, sid, day = M["t"], M["sid"], M["day"]; out = {}
    fullday_set = set(FS.tolist())
    for tf in (1, 5, 15):
        B = CS.resample(tf, t, sid, o, h, l, c, tv); full = np.isin(day[B["m1_end"] - 1], FS)
        for k, v in bar_patterns(B, full).items(): out[(tf, k)] = v.sum() if isinstance(v, np.ndarray) else v
        for k, v in structure(B, full).items(): out[(tf, k)] = v
        for k, v in boxes(B, full).items(): out[(tf, k)] = v
        if tf == 5: B5 = B
    for k, v in levels_and_time(t, sid, day, o, h, l, c, B5, fullday_set).items(): out[(0, k)] = v
    return out

tv = M["tv"].astype(float)
print("measuring real ...", flush=True); REAL = measure_all(M["o"], M["h"], M["l"], M["c"], tv)
# sanity vs the data-center tables (real counts must equal the stored tables on the same full days)
q = ",".join(str(int(d)) for d in FS); chk = []
for tf in (1, 5, 15):
    for ty in ("PINBAR", "ENGULF", "INSIDE", "OUTSIDE", "BIGBAR", "DOJI", "RUN3", "SQUEEZE", "PUSH", "SW_NEWEXT", "SW_FAIL", "PULLBACK_OVER"):
        tb = db.execute(f"SELECT COUNT(*) FROM patterns WHERE tf=? AND type=? AND day IN ({q})", (tf, ty)).fetchone()[0]
        chk.append(tb == REAL[(tf, ty)])
    tb = db.execute(f"SELECT COUNT(*) FROM boxes WHERE tf=? AND day IN ({q})", (tf,)).fetchone()[0]; chk.append(tb == REAL[(tf, "BOXES")])
print(f"sanity: function vs data-center tables match on {sum(chk)}/{len(chk)} checks", flush=True)
SH, SF = [], []
for s in range(3):
    print(f"null copy {s + 1}/3 ...", flush=True)
    SH.append(measure_all(*CS.shuffle_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 500 + s)[:4], tv))
    SF.append(measure_all(*CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 600 + s)[:4], tv))
import pickle; pickle.dump((REAL, SH, SF), open("cat_null_all.pkl", "wb"))
def row(key):
    r = REAL[key]; sh = np.array([x[key] for x in SH], float); sf = np.array([x[key] for x in SF], float); rate = isinstance(r, (int, np.integer)) or (isinstance(r, (float, np.floating)) and r > 2)
    if isinstance(r, (int, np.integer)):
        r_, sh_, sf_ = r / ND, sh.mean() / ND, sf.mean() / ND; unit = "/day"
    else: r_, sh_, sf_ = r, sh.mean(), sf.mean(); unit = "share"
    z = (r_ - sf_) / (sf.std() / (ND if unit == "/day" else 1) + 1e-12) if len(sf) > 1 else np.nan
    verdict = "~ random" if abs(r_ / sf_ - 1) < 0.1 else ("MORE than random" if r_ > sf_ else "LESS than random")
    return f"{r_:9.3f} {unit:5s} | {sh_:9.3f} | {sf_:9.3f} | {r_ / sh_ if sh_ else np.nan:6.2f} | {r_ / sf_ if sf_ else np.nan:6.2f} | {verdict}"
print("\n TF  behaviour                              |      real        | shuffle   | signflip  | r/shuf | r/sflip | vs signflip (+-10%)")
for key in sorted(REAL, key=lambda k: (k[0], str(k[1]))):
    print(f" {('M' + str(key[0])) if key[0] else '--':3s} {str(key[1]):38s} | {row(key)}")
