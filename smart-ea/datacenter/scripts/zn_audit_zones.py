r"""Audit of the zone instances used by steps 3-4 (zn_ev.instances), rebuilt from raw bars with separate code, real market, M1 / M3 / M5:
FVG / demand-supply / order block of the TF and OB M15 (every zone: range, direction, start, end of life), flip of the TF (first close
beyond the pivot after its confirmation, broken today, life = rest of that trading day), big $20 / $50 swings (first close through,
20-day life), previous day high / low, round numbers, EMA 20/50/200 / Bollinger / Keltner of the TF (value of the previous bar).
Output zn\zn_audit_zones.txt"""
import sys, os
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, zn_ev as EV, adx_ctx as X, broker as BK
OUT = r"C:\trade datacenter\zn"; txt = []; bad = []
def say(s): print(s, flush=True); txt.append(s)
def fail(*a): bad.append(a); say("  FAIL " + " ".join(map(str, a)))
M = PO.load_market("real"); Z = ZL.Zones(M); t = M["t"]; n1 = len(t)
pt = lambda x: np.rint(np.asarray(x) / BK.POINT).astype(np.int64)
mh, ml, mc = pt(M["h"]), pt(M["l"]), pt(M["c"])
day = M["day"]; dstart = np.r_[0, np.flatnonzero(np.diff(day)) + 1]; dend = np.r_[dstart[1:], n1]; nd = len(dstart)
di = np.repeat(np.arange(nd), dend - dstart)
def first_beyond(arr, start, level, above, win=40 * 1450):
    """first index >= start with arr > level (above) or < level; n1 if none within win bars (every life here is <= 21 trading days
    ~ 30k bars, so a later crossing cannot change the end of life)"""
    seg = arr[start:start + win]; w = np.flatnonzero(seg > level) if above else np.flatnonzero(seg < level)
    return start + w[0] if len(w) else n1
def agecap(start, age): return dend[min(di[min(start, n1 - 1)] + age, nd - 1)] - 1

def compare(name, exp, S):
    lo, hi, st, de, role = S
    got = {(int(a), int(b), int(c), int(r)): int(d) for a, b, c, d, r in zip(lo // EV.Q, hi // EV.Q, st, de, role)}
    e = {k: v for k, v in exp.items() if k[2] < n1 and v >= k[2]}
    miss = set(e) - set(got); extra = set(got) - set(e); wrong = [k for k in set(e) & set(got) if e[k] != got[k]]
    say(f"  {name}: expected {len(e)} got {len(got)} | missing {len(miss)} extra {len(extra)} wrong end-of-life {len(wrong)}")
    if miss or extra or wrong: fail(name, sorted(miss)[:2], sorted(extra)[:2], [(k, e[k], got[k]) for k in wrong[:2]])

for tf in EV.OBS:
    say(f"=== M{tf} ==="); B = EV.obs_bars(M, tf); S, L = EV.instances(Z, M, B, tf)
    def imbalance(tfz, age):
        Bz = X.resample(M, tfz); h, l, o, c, sid = pt(Bz["h"]), pt(Bz["l"]), pt(Bz["o"]), pt(Bz["c"]), Bz["sid"]
        st = np.searchsorted(t, Bz["t_open"]); en = np.r_[st[1:], n1]
        fvg, ds, ob = {}, {}, {}; last = 0; expA = -10
        for cc in range(2, len(h)):
            a = cc - 2
            if not (sid[a] == sid[a + 1] == sid[cc]): continue
            if l[cc] > h[a]: s = 1; lo, hi = h[a], l[cc]
            elif h[cc] < l[a]: s = -1; lo, hi = h[cc], l[a]
            else: continue
            start = en[cc]
            end = first_beyond(ml, start, lo, False) if s > 0 else first_beyond(mh, start, hi, True)
            fvg[(lo, hi, start, s)] = min(end, agecap(start, age))
            # user's chain rule: a new direction, or bar A beyond the last chain C, starts a zone; inside a chain only A == previous C
            if s != last or a > expA or a == expA:
                end = first_beyond(ml, start, l[a], False) if s > 0 else first_beyond(mh, start, h[a], True)
                ds[(l[a], h[a], start, s)] = min(end, agecap(start, age)); expA = cc
            last = s
            for k in range(a, max(a - 6, -1), -1):
                if sid[k] != sid[a]: break
                if (c[k] - o[k]) * s < 0:
                    end = first_beyond(mc, start, l[k], False) if s > 0 else first_beyond(mc, start, h[k], True)
                    ob[(l[k], h[k], start, s)] = min(end, agecap(start, age)); break
        return fvg, ds, ob
    fvg, ds, ob = imbalance(tf, ZL.ZONE_AGE[tf]); compare("fvg_own", fvg, S["fvg_own"]); compare("ds_own", ds, S["ds_own"])
    if tf == 1:
        _, _, ob15 = imbalance(15, ZL.ZONE_AGE[15])
    compare("ob_m15", ob15, S["ob_m15"])
    # flip of the TF
    z = Z.swa[(tf, 3)]; exp = {}
    for p, k, cf in zip(z["p"], z["kind"], z["conf"]):
        brk = first_beyond(mc, cf + 1, pt(p), k > 0)
        if brk >= n1 or di[cf] < di[brk] - z["age"]: continue
        exp[(int(pt(p)), int(pt(p)), int(brk + 1), int(k))] = int(dend[di[brk]] - 1)
    compare("flip_own", exp, S["flip_own"])
    if tf == 1:
        exp = {}
        for s in (20, 50):
            z = Z.sw[s]
            for p, k, cf in zip(z["p"], z["kind"], z["conf"]):
                brk = first_beyond(mc, cf + 1, pt(p), k > 0)
                exp[(int(pt(p)), int(pt(p)), int(cf + 1), int(-k))] = int(min(brk, dend[min(di[cf] + 20, nd - 1)] - 1))
        sb = exp
        H_ = np.array([mh[a:b].max() for a, b in zip(dstart, dend)]); L_ = np.array([ml[a:b].min() for a, b in zip(dstart, dend)])
        pd = {}
        for d in range(1, nd):
            pd[(int(H_[d - 1]), int(H_[d - 1]), int(dstart[d]), -1)] = int(dend[d] - 1); pd[(int(L_[d - 1]), int(L_[d - 1]), int(dstart[d]), 1)] = int(dend[d] - 1)
        rn = {50: {}, 100: {}}
        for d in range(nd):
            lo_ = int(np.floor((L_[d] * BK.POINT - 50) / 50)); hi_ = int(np.ceil((H_[d] * BK.POINT + 50) / 50))
            for m_ in range(lo_, hi_ + 1):
                lv = int(round(m_ * 50 / BK.POINT)); rn[100 if m_ % 2 == 0 else 50][(lv, lv, int(dstart[d]), 0)] = int(dend[d] - 1)
    compare("swing_big", sb, S["swing_big"]); compare("pd_hl", pd, S["pd_hl"]); compare("rn50", rn[50], S["rn50"]); compare("rn100", rn[100], S["rn100"])
    # lines: value used at bar j = value of bar j-1
    c = B["c"]; nb = len(c); worst = {}
    for p in (20, 50, 200):
        a = 2 / (p + 1); e = [c[0]]
        for x in c[1:]: e.append(e[-1] + a * (x - e[-1]))
        e = np.array(e); e[:p] = np.nan; exp_ = np.r_[np.nan, e[:-1]]
        got = L[f"ema_own_{p}"][0][0] / EV.Q * BK.POINT; m = np.isfinite(exp_)
        worst[f"ema{p}"] = np.nanmax(np.abs(got[m] - exp_[m]));
        if not np.array_equal(np.isfinite(got), m): fail("ema nan pattern", tf, p)
    rng = np.random.default_rng(tf); js = rng.choice(np.arange(220, nb), 3000, replace=False)
    pc = np.r_[c[0], c[:-1]]; tr = np.maximum(B["h"], pc) - np.minimum(B["l"], pc)
    e20 = [c[0]]
    for x in c[1:]: e20.append(e20[-1] + 2 / 21 * (x - e20[-1]))
    e20 = np.array(e20)
    db = dk = 0.0
    for j in js:
        w = c[j - 20:j]; mu = w.mean(); sd = np.sqrt(((w - mu) ** 2).mean())
        db = max(db, abs(L["bb_own"][0][0][j] / EV.Q * BK.POINT - (mu + 2 * sd)), abs(L["bb_own"][1][0][j] / EV.Q * BK.POINT - (mu - 2 * sd)))
        at = tr[j - 10:j].mean(); dk = max(dk, abs(L["kc_own"][0][0][j] / EV.Q * BK.POINT - (e20[j - 1] + 2 * at)), abs(L["kc_own"][1][0][j] / EV.Q * BK.POINT - (e20[j - 1] - 2 * at)))
    worst["bb"] = db; worst["kc"] = dk
    say("  lines max |difference| $: " + ", ".join(f"{k} {v:.2e}" for k, v in worst.items()))
    if max(worst.values()) > 1e-6: fail("lines", tf, worst)
say("RESULT " + ("PASS" if not bad else f"FAIL {len(bad)}"))
open(os.path.join(OUT, "zn_audit_zones.txt"), "w", encoding="utf-8").write("\n".join(txt))
