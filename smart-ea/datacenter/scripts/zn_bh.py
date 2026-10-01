r"""Step 4 of the zone plan (user 2026-10-01): behaviour on EVERY TF bar while price is in the zone (the stretch of each zone-entry event of
zn_ev), and what happens after an entry taken at the next M1 open after that bar closes (no limit orders), from the po_* outcome library.
Library + builder: zn_bh.py [market ...] [--tf 1,3,5] -> zn\zn_bh_m<tf>_<market>.npz (resumable).

Every bar is ORIENTED to the reversal direction d = event side (+1 came from above -> a reversal is UP; -1 mirrored), so "lower wick" always
means the wick that rejected the break direction. near / far = zone edge on the approach side / the other side (lines: both = the line).
Bar labels (all from bar b and bars before it; A = ATR20 of the TF from the 20 bars before b):
  rej_pin      range >= 1 A, body <= 30% of range, lower wick >= 60% (pinbar toward the reversal = hold_lib pinbar definition)
  against_pin  same with the upper wick (rejection of the reversal direction)
  wick_half    lower wick >= 50% of range
  engulf_rev   bull bar (oriented), previous bar bear, body engulfs the previous body, body >= 0.5 A ; engulf_brk mirror
  sweep_ret    traded beyond the far edge and closed back inside / above it ; close_through = closed beyond the far edge
  hold_through closed beyond the far edge and the previous stretch bar did too ; close_out = closed beyond the near edge (back outside)
  inside       inside bar ; small = range < 0.5 A ; decel = range < 0.5 x mean range of the 3 bars before the touch bar
  vspike       tick volume >= 3 x mean of the 20 bars before
  big_rev / big_brk  range >= 2 A, body >= 50% of range toward the reversal / the break ; bull / bear = oriented colour
  any          every stretch bar (baseline)
Unnamed codes (catalog / po_eval4 36-code: size x body x close position), oriented: code1 (bar b), code2 (bar b-1 > bar b, same session).
After-bar results (po row of bar b; rows outside the EA trading window have no po row and are dropped), for both trade directions
(rev = d, brk = -d), before cost unless R:
  hit1 / hit2   1 if +1 (+2) ATR came before -1 (-2) ATR, 0 if the reverse, nan if neither before the forced exit
  R cells       SL 1 / 2 ATR x TP 1R / 2R / none, and SL behind the bar's wick (+0.1 A) TP 2R ; R after the standard cost $0.31
  mfe24 / mae24 best / worst level (ATR, from po levels) reached within 24 TF bars ; t_up1 / t_dn1 = M1 bars to +1 / -1 ATR (-1 = never)
"""
import sys, os, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, zn_ev as EV
OUT = r"C:\trade datacenter\zn"
LABELS = ["any", "rej_pin", "against_pin", "wick_half", "engulf_rev", "engulf_brk", "sweep_ret", "close_through", "hold_through", "close_out",
          "inside", "small", "decel", "vspike", "big_rev", "big_brk", "bull", "bear"]
BIT = {k: 1 << i for i, k in enumerate(LABELS)}
CELLS = [("SL1_TP1R", 1.0, 1.0), ("SL1_TP2R", 1.0, 2.0), ("SL1_TPnone", 1.0, None), ("SL2_TP1R", 2.0, 1.0), ("SL2_TP2R", 2.0, 2.0),
         ("SL2_TPnone", 2.0, None), ("SLwick_TP2R", "wick", 2.0)]
LVi = lambda x: int(np.flatnonzero(np.isclose(PO.LV, x))[0])

def codes36(B):
    """same thresholds as the catalog / po_eval4 code, decided in integer points (ties exact; bugs.md 2026-10-01): size = range / ATR
    (< 0.5, 0.5-1, 1-2, >= 2; ATR = s20 / 20), body share (< 0.3, 0.3-0.7, >= 0.7), close position (< 1/3, 1/3-2/3, >= 2/3)"""
    o, h, l, c, s20 = B["oi"], B["hi"], B["li"], B["ci"], B["s20p"]; r = h - l; ok = (s20 > 0) & (r > 0)
    s = (40 * r >= s20).astype(int) + (20 * r >= s20) + (10 * r >= s20)
    ab = np.abs(c - o); b = (10 * ab >= 3 * r).astype(int) + (10 * ab >= 7 * r)
    p = (3 * (c - l) >= r).astype(int) + (3 * (c - l) >= 2 * r)
    return np.where(ok, s * 9 + b * 3 + p, -1)
mir36 = lambda x: np.where(x >= 0, (x // 3) * 3 + (2 - x % 3), -1)

def stretch_rows(E, vi):
    """(event index, bar, pos) for every bar of every stretch of variant vi"""
    j, xe = E[f"v{vi}_j"], E[f"v{vi}_xend"]; ln = xe - j
    ev = np.repeat(np.arange(len(j)), ln); pos = np.arange(ln.sum()) - np.repeat(np.cumsum(ln) - ln, ln)
    return ev, j[ev] + pos, pos

def label_rows(B, E, vi, Lns, ev, b, pos):
    var, D = EV.VARIANTS[vi]; sh = {"real": 0, "fake+": 200, "fake-": -200}[var]
    ty = E[f"v{vi}_type"][ev]; d = E[f"v{vi}_side"][ev]; s20 = B["s20p"]; A = 100 * s20[b].astype(np.int64)
    lo = E[f"v{vi}_lo"][ev].copy(); hi = E[f"v{vi}_hi"][ev].copy()
    for ti, tn in enumerate(EV.TYPES):                                         # lines move: zone value at bar b
        if tn not in Lns: continue
        m = ty == ti
        for li, (L_, H_, role) in enumerate(Lns[tn]):
            k = m & (E[f"v{vi}_inst"][ev] == li); bb = b[k]
            lo[k] = L_[bb] + sh * s20[bb]; hi[k] = H_[bb] + sh * s20[bb]
    o, h, l, c = B["oq"][b], B["hq"][b], B["lq"][b], B["cq"][b]; pb = b - 1
    po_, ph, pl, pc = B["oq"][pb], B["hq"][pb], B["lq"][pb], B["cq"][pb]
    up = d > 0
    O = np.where(up, o, -o); Hh = np.where(up, h, -l); Ll = np.where(up, l, -h); C = np.where(up, c, -c)
    PO_ = np.where(up, po_, -po_); PH = np.where(up, ph, -pl); PL = np.where(up, pl, -ph); PC = np.where(up, pc, -pc)
    near = np.where(up, hi, -lo); far = np.where(up, lo, -hi)
    # far edge of the previous bar (lines move); for pos 0 the previous bar is before the touch
    pfar = far.copy()
    r = Hh - Ll; body = C - O; ab = np.abs(body); lw = np.minimum(O, C) - Ll; uw = Hh - np.maximum(O, C)
    j0 = b - pos; rg3 = np.zeros(len(b))
    for k in (1, 2, 3): rg3 += B["hq"][j0 - k] - B["lq"][j0 - k]
    tv = B["tv"].astype(float); ctv = np.r_[0, np.cumsum(tv)]; m20 = np.where(b >= 20, (ctv[b] - ctv[np.maximum(b - 20, 0)]) / 20, np.nan)
    bits = np.zeros(len(b), np.int64)
    def put(nm, m): nonlocal bits; bits |= np.where(m, BIT[nm], 0)
    put("any", np.ones(len(b), bool))
    put("rej_pin", (r >= A) & (10 * ab <= 3 * r) & (100 * lw >= 60 * r))
    put("against_pin", (r >= A) & (10 * ab <= 3 * r) & (100 * uw >= 60 * r))
    put("wick_half", (r > 0) & (2 * lw >= r))
    put("engulf_rev", (body > 0) & (PC < PO_) & (C >= PO_) & (O <= PC) & (2 * body >= A))
    put("engulf_brk", (body < 0) & (PC > PO_) & (C <= PO_) & (O >= PC) & (-2 * body >= A))
    put("sweep_ret", (Ll < far) & (C > far)); put("close_through", C < far)
    prev_in = pos > 0
    put("hold_through", (C < far) & prev_in & (PC < pfar)); put("close_out", C > near)
    put("inside", (Hh < PH) & (Ll > PL)); put("small", 2 * r < A); put("decel", 6 * r < rg3)
    put("vspike", tv[b] >= 3 * m20); put("big_rev", (r >= 2 * A) & (2 * body >= r)); put("big_brk", (r >= 2 * A) & (-2 * body >= r))
    put("bull", body > 0); put("bear", body < 0)
    c36 = codes36(B); s_ = B["sid"]
    k1 = np.where(up, c36[b], mir36(c36[b])); k0 = np.where(up, c36[pb], mir36(c36[pb]))
    k2 = np.where((s_[pb] == s_[b]) & (k0 >= 0) & (k1 >= 0), k0 * 36 + k1, -1)
    return bits, k1.astype(np.int16), k2.astype(np.int16), d

def after(Rpo, prow, side, tf):
    """results after the bar for entries in direction `side` (array +1/-1) on po rows prow"""
    n = len(prow); out = {}
    U = np.where(side > 0, 1, 0)
    up_t, dn_t = Rpo["up_t"][prow], Rpo["dn_t"][prow]
    fav = np.where((side > 0)[:, None], up_t, dn_t); adv = np.where((side > 0)[:, None], dn_t, up_t)
    for k, lv in ((1, 1.0), (2, 2.0)):
        i = LVi(lv); f = fav[:, i].astype(np.int64); a = adv[:, i].astype(np.int64)
        f = np.where(f < 0, 1 << 40, f); a = np.where(a < 0, 1 << 40, a)
        out[f"hit{k}"] = np.where(f < a, 1.0, np.where(a < f, 0.0, np.nan))
    i1 = LVi(1.0); out["t_up1"] = fav[:, i1] // 4; out["t_dn1"] = adv[:, i1] // 4
    out["t_up1"] = np.where(fav[:, i1] >= 0, out["t_up1"], -1); out["t_dn1"] = np.where(adv[:, i1] >= 0, out["t_dn1"], -1)
    lim = 4 * tf * 24
    reach = lambda T: np.where(((T >= 0) & (T < lim)).any(1), PO.LV[np.where((T >= 0) & (T < lim), np.arange(len(PO.LV)), -1).max(1)], 0.0)
    out["mfe24"] = reach(fav); out["mae24"] = reach(adv)
    for nm, sl, rr in CELLS:
        r = np.full(n, np.nan)
        for sd in (1, -1):
            k = side == sd
            if not k.any(): continue
            if sl == "wick": r[k] = PO.trade_R_struct(Rpo, prow[k], sd, int(np.flatnonzero(np.isclose(PO.RR, rr))[0]))
            else: r[k] = PO.trade_R(Rpo, prow[k], sd, LVi(sl), None if rr is None else LVi(sl * rr))
        out[nm] = r
    return out

PO_KEYS = ("b", "day", "atr", "fin", "up_t", "dn_t", "up_g", "dn_g", "s_b", "s_s", "sb_t", "ss_t", "sb_g", "ss_g", "sbT_t", "ssT_t")

def build(mkt, tf, M, Z):
    f = os.path.join(OUT, f"zn_bh_m{tf}_{mkt}.npz")
    if os.path.exists(f): return
    t0 = time.time(); B = EV.obs_bars(M, tf); S, Lns = EV.instances(Z, M, B, tf)
    E = np.load(os.path.join(OUT, f"zn_ev_m{tf}_{mkt}.npz"))
    E = {k: E[k] for k in E.files}
    fz = np.load(os.path.join(PO.OUTD, f"po_m{tf}_{mkt}.npz")); Rpo = {k: fz[k] for k in PO_KEYS}; del fz
    rowof = np.full(len(B["c"]), -1, np.int64); rowof[Rpo["b"]] = np.arange(len(Rpo["b"]))
    res = {}
    for vi in range(len(EV.VARIANTS)):
        ev, b, pos = stretch_rows(E, vi)
        bits, k1, k2, d = label_rows(B, E, vi, Lns, ev, b, pos)
        pr = rowof[b]; keep = pr >= 0
        ev, b, pos, bits, k1, k2, d, pr = ev[keep], b[keep], pos[keep], bits[keep], k1[keep], k2[keep], d[keep], pr[keep]
        res[f"v{vi}_ev"] = ev.astype(np.int32); res[f"v{vi}_b"] = b; res[f"v{vi}_pos"] = pos.astype(np.int16); res[f"v{vi}_bits"] = bits.astype(np.int32)
        res[f"v{vi}_k1"] = k1; res[f"v{vi}_k2"] = k2; res[f"v{vi}_day"] = Rpo["day"][pr]; res[f"v{vi}_atr"] = Rpo["atr"][pr]
        for nm, sg in (("rev", 1), ("brk", -1)):
            for k, v in after(Rpo, pr, sg * d, tf).items():
                res[f"v{vi}_{nm}_{k}"] = v.astype(np.float32) if v.dtype.kind == "f" else v.astype(np.int32)
        print(f"  {mkt} m{tf} v{vi}: {len(b)} rows {time.time() - t0:.0f}s", flush=True)
    np.savez(f + ".tmp.npz", **res); os.replace(f + ".tmp.npz", f)

if __name__ == "__main__":
    a = sys.argv[1:]; tfs = EV.OBS
    if "--tf" in a: i = a.index("--tf"); tfs = tuple(int(x) for x in a[i + 1].split(",")); a = a[:i] + a[i + 2:]
    for mkt in (a or ["real", "sf1", "sf2", "sf3"]):
        todo = [tf for tf in tfs if not os.path.exists(os.path.join(OUT, f"zn_bh_m{tf}_{mkt}.npz"))]
        if not todo: continue
        t0 = time.time(); M = PO.load_market(mkt); Z = ZL.Zones(M); print(mkt, "zones", f"{time.time() - t0:.0f}s", flush=True)
        for tf in todo: build(mkt, tf, M, Z)
