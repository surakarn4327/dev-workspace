r"""Phase 3B-c report: gates for every cell (set x state level and parameter-group x state level) -> p3c\p3c_results.csv (cells with
finite t that reach |t| >= 2 or pass anything beyond G1, plus every group-layer cell) + p3c\p3c_summary.txt.
Gates (same as phase 3 / 3B-b, adapted to a set-vs-all-sets interaction I):
  G1 |t| >= 3 and >= 100 trading days of that set/group in the level
  G2 both halves the same sign as I with |t| >= 1.5          G3 BUY and SELL the same sign with |t| >= 1.5
  G4 set layer: >= 70 % of the neighbouring sets (one parameter one step; sets with an IDENTICAL trade list excluded, e.g. min_adx/gap
     that never filter anything) have the same sign ; group layer: >= 70 % of the member sets the same sign
  G5 every neighbour definition (quintile edges -5/+5, zigzag k 2/3/4 of the same column) the same sign with |t| >= 1.5 (none -> fail)
  G6 calibrated null p <= 0.01 (null 1 day swap, TIME_FEATS null 1b time shift; z vs each cell's own null mean/sd, 500 draws, top-up to
     2,000 for candidates when p3c_perm_top.pkl exists)
  p_fw family-wise: share of null draws whose largest |z| over ALL cells >= the cell's |z|
  null 2 label (5 random-direction markets): gold / mechanical / between, the rule of p3_report."""
import os, glob, pickle, csv, time, hashlib
import numpy as np
import p3lib as L, p3c_lib as C, adx_asof
from p3c_perm import BASE

STEPS = dict(tf=[1, 3, 5], adx_p=[8, 14, 28], ema_p=[5, 40], min_adx=[0.0, 29.0], min_gap=[0.0, 9.2], sl_atr=[4.0, 8.0, 12.0], exit_mode=["L", "T3"])

def set_neighbours(P, T):
    """one-step neighbours of every set, without sets that have exactly the same trades in the sandbox"""
    sig = {}
    for s in np.unique(T["set_id"]):
        m = T["set_id"] == s; sig[s] = hashlib.sha1(np.stack([T["entry_t"][m], T["dir"][m], np.round(T["r"][m] * 1e9)]).astype(np.int64).tobytes()).hexdigest()
    key = {s: tuple(P[s][d] for d in C.PARAM_DIMS) for s in P}; inv = {v: s for s, v in key.items()}
    NB = {}
    for s in P:
        nb = []
        for di, d in enumerate(C.PARAM_DIMS):
            st = STEPS[d]; i = st.index(P[s][d])
            for j in (i - 1, i + 1):
                if 0 <= j < len(st):
                    k = list(key[s]); k[di] = st[j]; o = inv.get(tuple(k))
                    if o is not None and sig.get(o) != sig.get(s): nb.append(o)
        NB[s] = nb
    return NB, sig

def main():
    t0 = time.time(); out = []
    def pr(*a):
        s = " ".join(str(x) for x in a); out.append(s); print(s, flush=True)
    R = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb")); lay = R["layout"]; nc = len(lay)
    Pm = pickle.load(open(os.path.join(BASE, "real_perm.pkl"), "rb"))
    assert np.allclose(np.nan_to_num(Pm["real_t"]), np.nan_to_num(R["t"]), atol=1e-9), "perm real t != res t"
    top = os.path.join(BASE, "real_perm_top.pkl"); TP = pickle.load(open(top, "rb")) if os.path.exists(top) else None
    sfs = [pickle.load(open(f, "rb")) for f in sorted(glob.glob(os.path.join(BASE, "sf*_res.pkl")))]
    for s in sfs: assert s["layout"] == lay
    T, X = L.load(adx_asof.DBT); P = C.load_params(adx_asof.DBT); NB, sig = set_neighbours(P, T)
    n_ident = len(set(sig.values()))
    pos = {k: i for i, k in enumerate(lay)}
    I, t, days = R["I"], R["t"], R["days"]
    sgn = np.sign(I)
    G1 = (np.abs(t) >= 3) & (days >= 100)
    G2 = (np.sign(R["h1"]) == sgn) & (np.sign(R["h2"]) == sgn) & (np.abs(R["h1_t"]) >= 1.5) & (np.abs(R["h2_t"]) >= 1.5)
    G3 = (np.sign(R["buy"]) == sgn) & (np.sign(R["sell"]) == sgn) & (np.abs(R["buy_t"]) >= 1.5) & (np.abs(R["sell_t"]) >= 1.5)
    vt = np.full((nc, 4), np.nan); vI = np.full((nc, 4), np.nan); o = 0
    for a, b in zip(R["var_t"], R["var_I"]):
        k = a.shape[0]; vt[o:o + k, :a.shape[1]] = a; vI[o:o + k, :b.shape[1]] = b; o += k
    assert o == nc
    nv_def = np.array([a.shape[1] for a in R["var_t"] for _ in range(a.shape[0])])
    with np.errstate(invalid="ignore"):
        G5 = (nv_def > 0) & np.all(np.where(np.arange(4)[None] < nv_def[:, None], (np.sign(vI) == sgn[:, None]) & (np.abs(vt) >= 1.5), True), 1)
    # G4
    G4 = np.zeros(nc, bool); g4share = np.full(nc, np.nan)
    for i, (f, lv, kind, key) in enumerate(lay):
        if not np.isfinite(t[i]): continue
        if kind == "set": cand = NB[key]
        else: cand = [s for s in P if P[s][kind] == key]
        vals = [v for v in (I[pos[(f, lv, "set", s)]] for s in cand) if np.isfinite(v)]
        if vals:
            g4share[i] = np.mean(np.sign(vals) == sgn[i]); G4[i] = g4share[i] >= 0.7
    # G6 / family-wise
    pc = Pm["p_cell"].copy(); zr = Pm["z_real"]; n2 = Pm["n2"]; maxz = Pm["maxz"]
    if TP is not None:
        for i, p in TP["p_cell"].items(): pc[i] = p
    G6 = pc <= 0.01
    srt = np.sort(maxz); pfw = (1 + len(srt) - np.searchsorted(srt, np.abs(zr), side="left")) / (1 + len(srt))
    # family = the G1-eligible cells (real days >= 100, p3c_perm2); cells outside the family get no family-wise p
    pfw = np.where(np.isfinite(zr) & (days >= 100), pfw, np.nan)
    # null 2
    lab = np.array(["-"] * nc, dtype=object); zsf = np.full(nc, np.nan); msf = np.full(nc, np.nan)
    if sfs:
        SI = np.stack([s["I"] for s in sfs]); ST = np.stack([s["t"] for s in sfs])
        with np.errstate(invalid="ignore", divide="ignore"):
            msf = np.nanmean(SI, 0); ssf = np.nanstd(SI, 0, ddof=1)
            zsf = (I - msf) / np.sqrt(R["se"] ** 2 + ssf ** 2 / np.isfinite(SI).sum(0))
        gold = (np.sign(I - msf) == sgn) & (np.abs(zsf) >= 2); mech = (np.sign(msf) == sgn) & (np.abs(msf) >= 0.5 * np.abs(I))
        lab = np.where(gold, "gold", np.where(mech, "mechanical", "between"))
    fin = np.isfinite(t)
    passed = G1 & G2 & G3 & G4 & G5 & G6 & fin
    # ---------------- summary
    pr(f"3B-c: cells {nc} (finite {fin.sum()}), features {len(set(k[0] for k in lay))}, sets {len(P)} ({n_ident} distinct trade lists), null draws pass1 {Pm['n1']} pass2 {n2}"
       + (f", top-up {TP['n']} for {len(TP['p_cell'])} cells" if TP else ""))
    for layer, m in (("set", np.array([k[2] == "set" for k in lay])), ("group", np.array([k[2] != "set" for k in lay]))):
        mm = m & fin
        zf = np.abs(zr[mm]); zf = zf[np.isfinite(zf)]
        pr(f"[{layer}] cells {mm.sum()}: |t|>=3 {np.sum(np.abs(t[mm]) >= 3)} ({np.mean(np.abs(t[mm]) >= 3):.4f}), calibrated |z|>=3 {np.sum(zf >= 3)} ({np.mean(zf >= 3):.4f}; normal 0.0027)"
           + f" | pass G1 {np.sum(G1 & mm)} G2 {np.sum(G2 & mm)} G3 {np.sum(G3 & mm)} G4 {np.sum(G4 & mm)} G5 {np.sum(G5 & mm)} G6 {np.sum(G6 & mm)}"
           + f" | G1-G5 {np.sum(G1 & G2 & G3 & G4 & G5 & mm)} | ALL {np.sum(passed & mm)} | p_fw<=0.05 {np.sum((pfw <= 0.05) & mm)}")
    pr(f"null family max |z|: median {np.median(maxz):.2f}, 95% {np.percentile(maxz, 95):.2f}, max {maxz.max():.2f} | raw max |t| median {np.median(Pm['maxt']):.2f}")
    if sfs: pr(f"random-direction markets ({len(sfs)}): sd of t {np.nanstd(ST):.2f}, |t|>=3 share {np.nanmean(np.abs(ST) >= 3):.4f} (real {np.mean(np.abs(t[fin]) >= 3):.4f})")
    def fmt(i):
        f, lv, kind, key = lay[i]
        return (f"{kind}={key} | {f} {lv} | I {I[i]:+.3f} t {t[i]:+.1f} days {int(days[i])} n {int(R['n'][i])} | h1/h2 {R['h1'][i]:+.3f}/{R['h2'][i]:+.3f}"
                f" buy/sell {R['buy'][i]:+.3f}/{R['sell'][i]:+.3f} | G4 {g4share[i]:.2f} var t {np.round(vt[i, :nv_def[i]], 1).tolist()}"
                f" | z {zr[i]:+.1f} p {pc[i]:.4f} p_fw {pfw[i]:.3f} | sf {msf[i]:+.3f} z {zsf[i]:+.1f} {lab[i]}"
                f" | fail {''.join(g for g, ok in zip(('1','2','3','4','5','6'), (G1[i], G2[i], G3[i], G4[i], G5[i], G6[i])) if not ok) or '-'}")
    order = np.argsort(-np.nan_to_num(np.abs(zr), nan=-1))
    pr("\n=== passed every gate ===")
    for i in order:
        if passed[i]: pr(fmt(i))
    pr("\n=== pass G1-G5, fail G6 ===")
    for i in order:
        if G1[i] and G2[i] and G3[i] and G4[i] and G5[i] and fin[i] and not G6[i]: pr(fmt(i))
    pr("\n=== group layer (parameter dimension x state): strongest 40 by calibrated |z| ===")
    k = 0
    for i in order:
        if lay[i][2] != "set" and fin[i]:
            pr(fmt(i)); k += 1
            if k >= 40: break
    pr("\n=== set layer: strongest 30 by calibrated |z| ===")
    k = 0
    for i in order:
        if lay[i][2] == "set" and fin[i]:
            pr(fmt(i)); k += 1
            if k >= 30: break
    keep = fin & ((np.abs(t) >= 2) | G1 | (np.array([k[2] != "set" for k in lay])))
    with open(os.path.join(BASE, "p3c_results.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["feature", "level", "layer", "key", "I", "se", "t", "n", "days", "h1", "h1_t", "h2", "h2_t", "buy", "buy_t", "sell", "sell_t",
                    "g4_share", "var_t", "z_cal", "p_cell", "p_fw", "sf_I", "z_vs_sf", "null2", "G1", "G2", "G3", "G4", "G5", "G6", "passed"])
        for i in np.flatnonzero(keep):
            f, lv, kind, key = lay[i]
            w.writerow([f, lv, kind, key, I[i], R["se"][i], t[i], R["n"][i], days[i], R["h1"][i], R["h1_t"][i], R["h2"][i], R["h2_t"][i],
                        R["buy"][i], R["buy_t"][i], R["sell"][i], R["sell_t"][i], g4share[i], np.round(vt[i, :nv_def[i]], 3).tolist(),
                        zr[i], pc[i], pfw[i], msf[i], zsf[i], lab[i], G1[i], G2[i], G3[i], G4[i], G5[i], G6[i], passed[i]])
    pickle.dump(dict(G1=G1, G2=G2, G3=G3, G4=G4, G5=G5, G6=G6, passed=passed, pfw=pfw, p_cell=pc, g4share=g4share, null2=lab, z_vs_sf=zsf),
                open(os.path.join(BASE, "p3c_gates.pkl"), "wb"))
    open(os.path.join(BASE, "p3c_summary.txt"), "w", encoding="utf-8").write("\n".join(out))
    pr(f"({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
