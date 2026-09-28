"""Shared episode dissection (same rules as cat_anatomy.py / cat_regime.py) so nesting / timing / follow-through studies use ONE definition.
regime_bars(B, k)  -> regime of every TF bar from pivots CONFIRMED at or before that bar (+1 UP / -1 DOWN / 0 SIDE) = known in real time
episodes(B, k)     -> every UP / DOWN episode of that TF with its anatomy + the bar indices needed to place it in time:
    i_known   bar where the episode became known (confirmation of the pivot that turned the regime on)
    i_first   bar of the pivot that starts the first impulse ; i_ext bar of the episode extreme ; i_end bar where the break was confirmed
All sizes in ATR20 of the TF taken at the first impulse's start pivot."""
import numpy as np
import cat_struct as CS

def regime_bars(B, k=3.0):
    idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"], k)
    st = np.zeros(len(p) + 1, int); H = []; L = []
    for j in range(len(p)):
        (H if kind[j] > 0 else L).append(p[j])
        if len(H) >= 2 and len(L) >= 2:
            st[j + 1] = 1 if (H[-1] > H[-2] and L[-1] > L[-2]) else (-1 if (H[-1] < H[-2] and L[-1] < L[-2]) else 0)
    ncf = np.searchsorted(conf, np.arange(len(B["c"])), "right")
    return st[ncf]

def episodes(B, k=3.0):
    idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"], k); n = len(p)
    st = np.zeros(n, int); H = []; L = []
    for j in range(n):
        (H if kind[j] > 0 else L).append(p[j])
        if len(H) >= 2 and len(L) >= 2:
            st[j] = 1 if (H[-1] > H[-2] and L[-1] > L[-2]) else (-1 if (H[-1] < H[-2] and L[-1] < L[-2]) else 0)
    out = []; j = 0
    while j < n:
        if st[j] == 0: j += 1; continue
        d = st[j]; k0 = j
        while j < n and st[j] == d: j += 1
        if j >= n or k0 < 3: continue
        first = k0 - 1 if kind[k0 - 1] == -d else k0 - 2
        seq = list(range(first, j + 1))
        legs = [p[seq[i + 1]] - p[seq[i]] for i in range(len(seq) - 1)]
        imp = [abs(x) for x in legs[:-1] if np.sign(x) == d]
        pb = []; last_imp = None
        for x in legs[:-1]:
            if np.sign(x) == d: last_imp = abs(x)
            elif last_imp: pb.append(abs(x) / last_imp)
        ext = max(seq[:-1], key=lambda q: p[q] * d); a0 = B["atr"][idx[first]]
        if not np.isfinite(a0) or len(imp) == 0: continue
        out.append(dict(dir=int(d), pullbacks=len(pb), depths=pb, imps=imp, move=abs(p[ext] - p[first]), move_atr=abs(p[ext] - p[first]) / a0,
                        atr0=a0, end_failed=(kind[j] == d), last_shorter=(len(imp) >= 2 and imp[-1] < imp[-2]), final_depth=abs(legs[-1]) / imp[-1],
                        i_known=int(conf[k0]), i_first=int(idx[first]), i_ext=int(idx[ext]), i_end=int(conf[j]),
                        p_first=p[first], p_ext=p[ext]))
    return out

def summarize(E, nd):
    """same keys as cat_anatomy.summarize (plus n)"""
    if not E: return {"n": 0}
    pbc = np.array([e["pullbacks"] for e in E]); r = {"n": len(E), "episodes/day": len(E) / nd}
    for q in (0, 1, 2): r[f"pullbacks={q}"] = np.mean(pbc == q)
    r["pullbacks>=3"] = np.mean(pbc >= 3)
    for q in (0, 1):
        v = [e["depths"][q] for e in E if len(e["depths"]) > q]; r[f"depth {q + 1} median"] = np.median(v) if v else np.nan
    v = [e["imps"][1] / e["imps"][0] for e in E if len(e["imps"]) > 1]; r["impulse 2/1 median"] = np.median(v) if v else np.nan
    r["move ATR median"] = np.median([e["move_atr"] for e in E])
    r["minutes median"] = np.median([e["minutes"] for e in E])
    r["end = new extreme failed"] = np.mean([e["end_failed"] for e in E])
    v = [e["last_shorter"] for e in E if len(e["imps"]) >= 2]; r["last push shorter"] = np.mean(v) if v else np.nan
    r["final break / last push median"] = np.median([e["final_depth"] for e in E])
    return r
