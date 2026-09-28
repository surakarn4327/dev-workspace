"""Anatomy of every UP / DOWN episode, per timeframe (regime judged inside that TF, zigzag 3 ATR; same rule as cat_regime.py).
Inside an UP episode: impulse legs go up (end at highs), pullbacks go down (end at lows); mirror for DOWN.
Per episode we record:
  pullbacks          number of pullbacks completed while the regime held
  depth_k            k-th pullback / the impulse before it (1st, 2nd, 3rd)
  impulse_k/1        k-th impulse / 1st impulse (do pushes grow or shrink?)
  move               start of the episode's first impulse -> its extreme, in ATR and in ADR ; duration (minutes)
  end_kind           how the structure broke: LOWER_HIGH (a new high failed to exceed the last high = momentum fades first)
                     or LOWER_LOW (price broke the last pullback low = pullback went too deep)   [mirror words for DOWN]
  last_push_shorter  was the last impulse shorter than the one before it?
  final_depth        the structure-breaking leg / last impulse
  next               regime after the episode (opposite trend directly, or sideway)
Compared with 3 sign-flipped copies (same bars and volatility, random direction)."""
import numpy as np
import cat_bars as CB, cat_struct as CS
M = CB.m1(); FS = CB.full_list(); ND = len(FS); tv = M["tv"].astype(float); ADR = CB.adr_map()
SER = {"real": (M["o"], M["h"], M["l"], M["c"])}
for s in range(3): SER[f"flip{s}"] = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 1300 + s)[:4]
def episodes(name, tf):
    B = CS.resample(tf, M["t"], M["sid"], *SER[name], tv); full = np.isin(M["day"][B["m1_end"] - 1], FS); bday = M["day"][B["m1_end"] - 1]
    idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"]); n = len(p)
    st = np.zeros(n, int); H = []; L = []
    for k in range(n):
        (H if kind[k] > 0 else L).append(p[k])
        if len(H) >= 2 and len(L) >= 2:
            st[k] = 1 if (H[-1] > H[-2] and L[-1] > L[-2]) else (-1 if (H[-1] < H[-2] and L[-1] < L[-2]) else 0)
    out = []; k = 0
    while k < n:
        if st[k] == 0: k += 1; continue
        d = st[k]; k0 = k
        while k < n and st[k] == d: k += 1
        k1 = k - 1                                             # last pivot while the regime held ; k = breaking pivot (or n)
        if k >= n or k0 < 3: continue
        # legs from the pivot that started the first impulse: the last opposite-kind pivot before k0 that is <= structure start
        first = k0 - 1 if kind[k0 - 1] == -d else k0 - 2       # first impulse starts at an opposite extreme (a low for UP)
        seq = list(range(first, k + 1))                        # pivots first..breaking
        legs = [(p[seq[i + 1]] - p[seq[i]], seq[i + 1]) for i in range(len(seq) - 1)]
        imp = [abs(x) for x, j in legs[:-1] if np.sign(x) == d]
        pb = []; last_imp = None
        for x, j in legs[:-1]:
            if np.sign(x) == d: last_imp = abs(x)
            elif last_imp: pb.append(abs(x) / last_imp)
        brk = legs[-1][0]; brk_pivot = k
        if kind[brk_pivot] == d:  end_kind = "FAILED_NEW_EXTREME"   # e.g. UP: a high that is not higher (lower high)
        else: end_kind = "BROKE_PULLBACK_LOW"                        # e.g. UP: a low below the last low
        ext = max(seq[:-1], key=lambda j: p[j] * d); a0 = B["atr"][idx[first]]; U = ADR.get(int(bday[idx[ext]]))
        nxt = st[k] if k < n else 0
        if not full[idx[ext]] or not np.isfinite(a0) or len(imp) == 0: continue
        out.append(dict(dir=d, pullbacks=len(pb), depths=pb, imps=imp, move_atr=abs(p[ext] - p[first]) / a0,
                        move_adr=abs(p[ext] - p[first]) / U if U else np.nan, minutes=(B["t"][idx[ext]] - B["t"][idx[first]]) / 60,
                        end_kind=end_kind, last_shorter=(len(imp) >= 2 and imp[-1] < imp[-2]),
                        final_depth=abs(brk) / imp[-1], next=("opposite" if nxt == -d else ("same" if nxt == d else "sideway"))))
    return out
def summarize(E):
    if not E: return {}
    pbc = np.array([e["pullbacks"] for e in E]); r = {}
    r["episodes/day"] = len(E) / ND
    for q in (0, 1, 2, 3): r[f"pullbacks={q}"] = np.mean(pbc == q)
    r["pullbacks>=4"] = np.mean(pbc >= 4)
    for q in (0, 1, 2):
        v = [e["depths"][q] for e in E if len(e["depths"]) > q]; r[f"depth {q + 1} median"] = np.median(v) if v else np.nan
    for q in (1, 2):
        v = [e["imps"][q] / e["imps"][0] for e in E if len(e["imps"]) > q]; r[f"impulse {q + 1}/1 median"] = np.median(v) if v else np.nan
    r["move ATR median"] = np.median([e["move_atr"] for e in E]); r["move ADR median"] = np.nanmedian([e["move_adr"] for e in E])
    r["minutes median"] = np.median([e["minutes"] for e in E])
    r["end = new extreme failed"] = np.mean([e["end_kind"] == "FAILED_NEW_EXTREME" for e in E])
    r["last push shorter"] = np.mean([e["last_shorter"] for e in E if len(e["imps"]) >= 2])
    r["final break / last push median"] = np.median([e["final_depth"] for e in E])
    r["next = opposite trend"] = np.mean([e["next"] == "opposite" for e in E]); r["next = sideway"] = np.mean([e["next"] == "sideway" for e in E])
    return r
TFS = (1, 5, 15, 60)
for tf in TFS:
    real = episodes("real", tf); nul = [x for s in range(3) for x in episodes(f"flip{s}", tf)]
    up = summarize([e for e in real if e["dir"] > 0]); dn = summarize([e for e in real if e["dir"] < 0]); nl = summarize(nul)
    nl["episodes/day"] /= 3; nl["episodes/day"] /= 2                       # 3 copies, and per direction
    name = f"M{tf}" if tf < 60 else f"H{tf // 60}"
    print(f"\n=== {name}: real UP n={sum(e['dir'] > 0 for e in real)}, real DOWN n={sum(e['dir'] < 0 for e in real)}, null n={len(nul)} (3 copies, up+down pooled)")
    print(f"  {'':34s} |   UP    |  DOWN   | random-direction")
    for key in up:
        f = "{:7.2f}" if ("median" in key or "day" in key) and "share" not in key else "{:7.0%}"
        if key in ("episodes/day", "move ATR median", "move ADR median", "minutes median") or "depth" in key or "impulse" in key or "final" in key: f = "{:7.2f}" if key != "minutes median" else "{:7.0f}"
        print(f"  {key:34s} | {f.format(up[key])} | {f.format(dn[key])} | {f.format(nl[key])}")
