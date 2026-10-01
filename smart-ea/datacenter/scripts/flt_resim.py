r"""Re-simulate the AdxEma library (432 sets) WITH an entry filter (user 2026-10-01). A filter changes which signals are taken, so later signals
that the stored library skipped (position busy) can become entries -> filters must be evaluated by re-simulation, not by deleting library trades.
Same simulator, market data, cost and vol_mult as adx_build.py; the no-filter run is checked against the stored library (set_id x sum r_std).

Filters are functions of the direction-relative features of flt_feat (arrays over the signals of one (tf, adx, ema) combination):
  none | rel_pos >= q | pdc_d >= x | ahead20 <= y (nan = allowed) | combinations
Output flt\flt_resim.pkl: per (filter, set_id): trade arrays (entry_t, exit_t, day, dir, r_std, vol_mult). Resumable per filter set.
usage: python flt_resim.py [--sets 0|all]"""
import sys, os, time, pickle, itertools
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, broker as BK, adx_lib as A, po_lib as PO, zn_lib as ZL, flt_feat as FF
import adx_build as AB
OUT = r"C:\trade datacenter\flt"

def F_none(D): return np.ones(len(D["rel_pos"]), bool)
def nan_ok(a, f): return np.where(np.isfinite(a), f(a), True)
FILTERS = {
    "none": F_none,
    "pos20": lambda D: nan_ok(D["rel_pos"], lambda a: a >= 0.20), "pos30": lambda D: nan_ok(D["rel_pos"], lambda a: a >= 0.30),
    "pos38": lambda D: nan_ok(D["rel_pos"], lambda a: a >= 0.38), "pos50": lambda D: nan_ok(D["rel_pos"], lambda a: a >= 0.50),
    "pdc-20": lambda D: nan_ok(D["pdc_d"], lambda a: a >= -0.20), "pdc-11": lambda D: nan_ok(D["pdc_d"], lambda a: a >= -0.11),
    "pdc-05": lambda D: nan_ok(D["pdc_d"], lambda a: a >= -0.05), "pdc0": lambda D: nan_ok(D["pdc_d"], lambda a: a >= 0.0),
    "ah08": lambda D: nan_ok(D["ahead20"], lambda a: a <= 0.8), "ah115": lambda D: nan_ok(D["ahead20"], lambda a: a <= 1.15), "ah15": lambda D: nan_ok(D["ahead20"], lambda a: a <= 1.5),
}
for q in (25, 35, 42, 45, 55, 60, 65, 70, 80):
    FILTERS[f"pos{q}"] = (lambda q: lambda D: nan_ok(D["rel_pos"], lambda a: a >= q / 100))(q)
for x in (-15, -8, -3, 5):
    FILTERS[f"pdc{x}"] = (lambda x: lambda D: nan_ok(D["pdc_d"], lambda a: a >= x / 100))(x)
for q in (60, 70, 90, 100):
    FILTERS[f"ah{q:03d}"] = (lambda q: lambda D: nan_ok(D["ahead20"], lambda a: a <= q / 100))(q)
FILTERS["pos38+ah115"] = lambda D: FILTERS["pos38"](D) & FILTERS["ah115"](D)
FILTERS["pos38+pdc-5"] = lambda D: FILTERS["pos38"](D) & FILTERS["pdc-05"](D)
FILTERS["pos38|pdc-5"] = lambda D: FILTERS["pos38"](D) | FILTERS["pdc-05"](D)
FILTERS["pdc-11+ah115"] = lambda D: FILTERS["pdc-11"](D) & FILTERS["ah115"](D)
FILTERS["pos30+ah115"] = lambda D: FILTERS["pos30"](D) & FILTERS["ah115"](D)

def run_sel(mk, S, sel, sl, ex, cache):
    out = []; busy_i = -1; busy_open = False
    for j in sel:
        e = S["e"][j]
        if busy_i > e or (busy_i == e and not busy_open): continue
        key = (int(j), sl, ex); T = cache.get(key)
        if T is None: T = A.trade(mk, S, j, sl, ex); cache[key] = T
        out.append(T); busy_i, busy_open = T["exit_i"], T["at_open"]
    return out

def main():
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    names = only or list(FILTERS)
    f = os.path.join(OUT, "flt_resim.pkl"); res = pickle.load(open(f, "rb")) if os.path.exists(f) else {}
    names = [n for n in names if n not in res]
    if not names: print("nothing to do"); return
    t0 = time.time(); M = A.load_m1(AB.utc(AB.WARM_FROM) - 86400, AB.utc(AB.LIB_TO)); mk = A.Market(M, AB.START_H, AB.CUTOFF_H, AB.NO_ENTRY_MIN)
    tu = BK.server_to_utc(M["t"]); lo = AB.utc(AB.LIB_FROM); _, day_all, _ = AB.sessions(tu)
    Mp = PO.load_market("real"); Z = ZL.Zones(Mp); L = FF.build_levels(Z); print("zones", f"{time.time() - t0:.0f}s", flush=True)
    for n in names: res[n] = {}
    sid = 0
    for tf, ap, ep in itertools.product(AB.TFS, AB.ADXS, AB.EMAS):
        S = A.signals(mk, tf, ap, ep); cache = {}
        ent = tu[S["e"]]; ue, inv = np.unique(ent, return_inverse=True); ip = np.searchsorted(Mp["t"], ue)
        ok = (ip < len(Mp["t"])) & (Mp["t"][np.minimum(ip, len(Mp["t"]) - 1)] == ue)
        Fu = FF.feats_at(Mp, Z, L, np.where(ok, ip, 1000)); good = ok & np.isfinite(Fu["adr"])
        Dd = FF.directed({k: v[inv] for k, v in Fu.items()}, S["dir"])
        for k in Dd: Dd[k] = np.where(good[inv], Dd[k], np.nan)
        allow = {n: FILTERS[n](Dd) for n in names}
        for ma, gp, sl, ex in itertools.product(AB.MINADX, AB.GAPS, AB.SLS, AB.EXITS):
            sid += 1; base = np.flatnonzero((S["adx"] >= ma) & (S["gap"] >= gp))
            for n in names:
                rows = []
                for T in run_sel(mk, S, base[allow[n][base]], sl, ex, cache):
                    e = T["e"]
                    if tu[e] < lo or T["reason"] == 4: continue
                    j = T["j"]; vr = float(S["vol_ratio"][j])
                    if BK.server_to_utc(S["vol_base_t"][j]) < BK.T0: vr = -1.0
                    vm = 1.0 if vr < 0 else (AB.VOL_LOW if vr < AB.VOL_THR else AB.VOL_HIGH)
                    r_std = T["r"] - (AB.COST_STD - T["sp_entry"]) / T["risk"] if T["risk"] > 0 else 0.0
                    rows.append((int(tu[e]), int(tu[T["exit_i"]]), int(day_all[e]), T["d"], r_std, vm))
                res[n][sid] = np.array(rows, float).reshape(-1, 6)
        print(f"M{tf} ADX{ap} EMA{ep} sets to {sid} {time.time() - t0:.0f}s", flush=True)
    pickle.dump(res, open(f + ".tmp", "wb")); os.replace(f + ".tmp", f); print("saved", names, f"{time.time() - t0:.0f}s")

if __name__ == "__main__":
    main()
