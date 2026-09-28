"""Task 3 (2026-09-28): what follows the footprints that passed (descriptive, NOT profit). Units = ATR20 of that TF at the event bar.
Measured from the event bar's close, in a stated direction s (+1 = the way we ask 'does price go there?'):
  fwd h      (close[i+h] - close[i]) * s / ATR   for h = 3, 12, 48 bars (only if bar i+h is in the same trading day)
  P>0        share of events with fwd > 0
  first ±1   which comes first within 48 bars: +1 ATR in direction s or -1 ATR against (share of '+1 first'), median bars to that touch
  MFE / MAE  median best / worst excursion within 24 bars
Compared with: DRIFT = the same measure on ALL bars of that TF with the same s (real data; removes the 2.5-year up-drift)
               NULL  = the same event definition on 3 sign-flipped copies (same bars and volatility, random direction)
Events (footprints from the catalog):
  BIG     big bar (range >= k ATR, body >= 50% of range), k = 1.5 / 2 / 3; s = opposite to the bar (pull-back after a strong bar);
          split by bar colour x the TF's OWN regime at that bar (cat_episodes.regime_bars, confirmed pivots only)
  EPEND   end of an UP / DOWN episode (structure break confirmed); s = the old episode direction (does the old trend resume?) ; + P(new extreme beyond
          the episode extreme within 48 bars)
  INSIDE  inside bar on M5 / M15 / M30; s = colour of the mother bar ; + range of the next 6 bars / ATR (expansion)
  TRI     contracting triangle (cat_struct.formations, zigzag 2 / 3 ATR, M5 / M15); s = direction of the leg before the triangle
  PDBRK   first M5 close beyond yesterday's high (s=+1) / low (s=-1) per day ; + P(price back at the level within 12 / 48 bars)
  VOLSPK  M1 bar where ATR20 / mean TR of previous 5 days first crosses above its 90th (80th, 95th) percentile; s = +1 ; split by the
          direction of the previous 20 bars (after a drop / after a rise)"""
import pickle, numpy as np
import cat_bars as CB, cat_struct as CS, cat_episodes as CE
M = CB.m1(); FS = CB.full_list(); tv = M["tv"].astype(float)
SER = {"real": (M["o"], M["h"], M["l"], M["c"])}
for s in range(3): SER[f"flip{s}"] = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 1300 + s)[:4]
HZ = (3, 12, 48); W = 48
def measure(B, ev, s):
    """ev bar indices, s +-1 per event -> dict of arrays"""
    ev = np.asarray(ev, int); s = np.asarray(s, float); n = len(B["c"]); a = B["atr"][ev]; c0 = B["c"][ev]; sid = B["sid"]
    ok = np.isfinite(a) & (a > 0); ev, s, a, c0 = ev[ok], s[ok], a[ok], c0[ok]
    out = {"i": ev, "s": s}
    for h in HZ:
        j = np.minimum(ev + h, n - 1); v = (B["c"][j] - c0) * s / a; v[(ev + h >= n) | (sid[j] != sid[ev])] = np.nan; out[f"f{h}"] = v
    J = ev[:, None] + np.arange(1, W + 1)[None, :]; bad = (J >= n); J = np.minimum(J, n - 1); bad |= sid[J] != sid[ev][:, None]
    up = (np.where(s[:, None] > 0, B["h"][J], -B["l"][J]) - (c0 * s)[:, None]) / a[:, None]      # favourable excursion
    dn = (np.where(s[:, None] > 0, B["l"][J], -B["h"][J]) - (c0 * s)[:, None]) / a[:, None]      # adverse (negative)
    up[bad] = np.nan; dn[bad] = np.nan
    out["mfe24"] = np.nanmax(up[:, :24], axis=1); out["mae24"] = np.nanmin(dn[:, :24], axis=1)
    hu = np.where(np.nan_to_num(up, nan=-9) >= 1, np.arange(W)[None, :], 999).min(1); hd = np.where(np.nan_to_num(dn, nan=9) <= -1, np.arange(W)[None, :], 999).min(1)
    first = np.full(len(ev), np.nan); first[(hu < 999) | (hd < 999)] = (hu < hd)[(hu < 999) | (hd < 999)]; out["first"] = first
    out["tfirst"] = np.where(np.minimum(hu, hd) < 999, np.minimum(hu, hd) + 1, np.nan)
    out["up48"], out["dn48"] = up, dn
    return out
def events(name, tf_list=(1, 5, 15, 60)):
    O, H, L, C = SER[name]; E = {}
    Bs = {tf: CS.resample(tf, M["t"], M["sid"], O, H, L, C, tv) for tf in (1, 5, 15, 30, 60)}
    for tf in Bs:
        B = Bs[tf]; B["full"] = np.isin(M["day"][B["m1_end"] - 1], FS); B["day"] = M["day"][B["m1_end"] - 1]
    for tf in tf_list:
        B = Bs[tf]; R = CE.regime_bars(B, 3.0); rng_ = B["h"] - B["l"]; col = np.sign(B["c"] - B["o"]); a = B["atr"]
        allb = np.flatnonzero(B["full"]); allb = allb[::max(1, len(allb) // 60000)]          # subsample (memory); drift estimate only
        E[("DRIFT", tf, "up")] = measure(B, allb, np.ones(len(allb)))
        for k in (1.5, 2.0, 3.0):
            big = B["full"] & np.isfinite(a) & (rng_ >= k * a) & (np.abs(B["c"] - B["o"]) >= 0.5 * rng_)
            for cc, cn in ((1, "upbar"), (-1, "dnbar")):
                for rv, rn in ((1, "regUP"), (-1, "regDN"), (0, "regSIDE")):
                    i = np.flatnonzero(big & (col == cc) & (R == rv)); E[("BIG", tf, f"k{k:g} {cn} {rn}")] = measure(B, i, -cc * np.ones(len(i)))
        for K in (2.0, 3.0, 4.0):
            ep = [e for e in CE.episodes(B, K) if B["full"][e["i_ext"]]]
            for d, dn in ((1, "UP"), (-1, "DN")):
                ee = [e for e in ep if e["dir"] == d]; i = np.array([e["i_end"] for e in ee], int)
                m = measure(B, i, d * np.ones(len(i)))
                ext = np.array([e["p_ext"] for e in ee]); keep = np.isin(i, m["i"]); ext = ext[keep]
                m["beyond"] = np.array([np.nanmax(u) for u in m["up48"]]) >= (ext - B["c"][m["i"]]) * d / B["atr"][m["i"]]
                E[("EPEND", tf, f"k{K:g} {dn}")] = m
    for tf in (5, 15, 30):
        B = Bs[tf]; same = np.r_[False, B["sid"][1:] == B["sid"][:-1]]
        ins = same & B["full"] & (B["h"] < np.r_[B["h"][0], B["h"][:-1]]) & (B["l"] > np.r_[B["l"][0], B["l"][:-1]])
        i = np.flatnonzero(ins); mc = np.sign(B["c"][i - 1] - B["o"][i - 1]); i, mc = i[mc != 0], mc[mc != 0]
        m = measure(B, i, mc); n = len(B["c"]); J = np.minimum(m["i"][:, None] + np.arange(1, 7)[None, :], n - 1)
        m["rng6"] = (B["h"][J].max(1) - B["l"][J].min(1)) / B["atr"][m["i"]]; E[("INSIDE", tf, "mother dir")] = m
        base = np.flatnonzero(same & B["full"]); J = np.minimum(base[:, None] + np.arange(1, 7)[None, :], n - 1)
        E[("INSIDE", tf, "mother dir")]["rng6_all"] = np.nanmedian((B["h"][J].max(1) - B["l"][J].min(1)) / B["atr"][base])
    for tf in (5, 15):
        B = Bs[tf]
        for K in (2.0, 3.0):
            idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"], K); fm = CS.formations(idx, p, kind, conf, B["atr"])
            pos = {int(cf): j for j, cf in enumerate(conf)}
            i = []; s = []
            for typ, cf, d, x1 in fm:
                if typ != "TRIANGLE" or not B["full"][cf]: continue
                j = pos.get(int(cf))
                if j is None or j < 5: continue
                i.append(cf); s.append(np.sign(p[j - 4] - p[j - 5]))          # the leg that led into the triangle
            E[("TRI", tf, f"k{K:g} prior-leg dir")] = measure(B, i, s)
    B = Bs[5]; d = B["day"]; ud = np.unique(d); dh = {x: B["h"][d == x].max() for x in ud}; dl = {x: B["l"][d == x].min() for x in ud}
    prev = {ud[k]: ud[k - 1] for k in range(1, len(ud))}; i = []; s = []; lvl = []
    for x in ud:
        if x not in prev or x not in FS: continue
        ph, pl = dh[prev[x]], dl[prev[x]]; ix = np.flatnonzero(d == x)
        for side, L_ in ((1, ph), (-1, pl)):
            hit = ix[(B["c"][ix] - L_) * side > 0]
            if len(hit): i.append(hit[0]); s.append(side); lvl.append(L_)
    m = measure(B, i, s); lvl = np.array(lvl)[np.isin(np.array(i), m["i"])]
    back = (lvl - B["c"][m["i"]]) * m["s"] / B["atr"][m["i"]]                       # level distance (negative) in s units
    for h in (12, 48): m[f"back{h}"] = np.nanmin(m["dn48"][:, :h], axis=1) <= back
    E[("PDBRK", 5, "break dir")] = m
    B = Bs[1]; pc = np.r_[B["c"][0], B["c"][:-1]]; tr = np.maximum(B["h"], pc) - np.minimum(B["l"], pc); cs = np.r_[0, np.cumsum(tr)]
    Wn = 5 * 1380; n = len(tr); base = np.full(n, np.nan); base[Wn:] = (cs[Wn:n] - cs[:n - Wn]) / Wn; ratio = B["atr"] / base
    prior = np.full(n, np.nan); prior[20:] = B["c"][20:] - B["c"][:-20]
    for q in (80, 90, 95):
        th = np.nanpercentile(ratio[B["full"]], q); x = (ratio >= th) & np.r_[True, ratio[:-1] < th] & B["full"]
        for pd_, pn in ((-1, "after drop"), (1, "after rise")):
            i = np.flatnonzero(x & (np.sign(prior) == pd_)); E[("VOLSPK", 1, f"p{q} {pn}")] = measure(B, i, np.ones(len(i)))
    return E
ALL = {}
for name in SER:
    ALL[name] = events(name); print(name, "done", flush=True)
for name in ALL:
    for key in ALL[name]:
        for big in ("up48", "dn48"): ALL[name][key].pop(big, None)
pickle.dump(ALL, open("cat_follow.pkl", "wb"))
