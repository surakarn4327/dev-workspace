r"""3B-c pilot: small checks before any full run. (1) level structure of every feature, (2) cell statistics of the engine vs an
independent brute-force computation (plain loops over days, own mean/SE formula written separately), (3) timing of one full t pass."""
import time, numpy as np
import p3lib as L, p3c_lib as C, adx_asof

t0 = time.time()
T, X = L.load(adx_asof.DBT); P = C.load_params(adx_asof.DBT)
print(f"loaded {len(T['e'])} trades, {len(X['entry_t'])} ctx rows, sets {len(np.unique(T['set_id']))} ({time.time()-t0:.0f}s)")
assert T["entry_t"].max() < L.SANDBOX_END
E = C.Engine(T, X, P)
print(f"features {len(E.F)}, cells {len(E.layout())} ({time.time()-t0:.0f}s)")
nlev = [len(l.names) for l in E.lev]
print("levels per feature: min", min(nlev), "max", max(nlev), "total", sum(nlev), "| categorical", sum(l.cat for l in E.lev),
      "| with special value", sum((not l.cat) and l.special is not None for l in E.lev))
for j in range(0, len(E.F), 23): print("  ", E.F[j]["name"], E.lev[j].names, "k-neighbours", [E.F[i]["name"] for i in E.kneighbours(j)])

# (2) independent brute force for a few cells
def brute(lab, keyarr, kval, e, day):
    """I and day-clustered SE of (mean e of key in level) - (mean e of all in level), written from the definition"""
    out = {}
    for lv in np.unique(lab[lab >= 0]):
        inl = lab == lv; ink = inl & (keyarr == kval)
        if ink.sum() < C.MIN_N or len(np.unique(day[ink])) < C.MIN_D: out[lv] = (np.nan, np.nan); continue
        mk = e[ink].mean(); ma = e[inl].mean(); I = mk - ma
        days = np.unique(day[inl]); zz = []
        Nk, Na = ink.sum(), inl.sum()
        for d in days:
            a = ink & (day == d); b = inl & (day == d)
            zz.append((e[a].sum() - mk * a.sum()) / Nk - (e[b].sum() - ma * b.sum()) / Na)
        zz = np.array(zz); se = np.sqrt((zz ** 2).sum() * len(days) / (len(days) - 1))
        out[lv] = (I, I / se)
    return out

rng = np.random.default_rng(7); worst = 0; ncheck = 0
lay = E.layout(); tt = E.t_all(); pos = {k: i for i, k in enumerate(lay)}
for j in rng.choice(len(E.F), 6, replace=False):
    lab = E.labels(j, T["ci"])
    for kind in ("set", "sl_atr", "tf"):
        if kind == "set":
            s = int(rng.choice(E.set_ids)); keyarr = T["set_id"]; kval = s; kname = s
        else:
            D = [d for d in E.dims if d["dim"] == kind][0]; vi = int(rng.integers(D["nk"])); keyarr = D["key"]; kval = vi; kname = D["vals"][vi]
        b = brute(lab, keyarr, kval, T["e"], T["day"])
        for lv, (I, t) in b.items():
            te = tt[pos[(E.F[j]["name"], E.lev[j].names[lv], kind, kname)]]
            if np.isnan(t) and np.isnan(te): continue
            worst = max(worst, abs(te - t)); ncheck += 1
print(f"brute-force cells checked {ncheck}, max |t diff| {worst:.2e}")
# (2b) one-pass engine (_both: set sums once, group sums via membership matrix) vs the per-layer reference interaction(), all cells
ref = []
for j in range(len(E.F)):
    nl = len(E.lev[j].names); lab = E.labels(j, T["ci"])
    R = [C.interaction(lab, E.si, E.ns, T["e"], E.di, E.nd, nl=nl)] + [C.interaction(lab, D["key"], D["nk"], T["e"], E.di, E.nd, nl=nl) for D in E.dims]
    for li in range(nl):
        for r in R: ref.append(r[2][:, li])
ref = np.concatenate(ref); both = np.isfinite(ref) & np.isfinite(tt)
print(f"one-pass vs reference: cells {len(ref)}, finite pattern equal {np.array_equal(np.isfinite(ref), np.isfinite(tt))}, max |t diff| {np.abs(ref[both]-tt[both]).max():.2e}")
t1 = time.time(); E.t_all(); print(f"one t pass {time.time()-t1:.1f}s; finite cells {np.isfinite(tt).sum()} of {len(tt)}; sd {np.nanstd(tt):.2f}, |t|>=3 {np.nanmean(np.abs(tt)>=3):.4f}")
