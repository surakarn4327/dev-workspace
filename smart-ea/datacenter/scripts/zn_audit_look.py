r"""Print raw bars around a few zone-entry events (real market) next to what the library stored, for a by-hand check.
usage: zn_audit_look.py <tf> <type> [n] [label]  -> stdout"""
import sys, os
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, zn_ev as EV, zn_bh as BH, adx_ctx as X, broker as BK, datetime as dt
tf = int(sys.argv[1]); ty = sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 3; lab = sys.argv[4] if len(sys.argv) > 4 else None
OUT = r"C:\trade datacenter\zn"; M = X.load(None); B = EV.obs_bars(M, tf)
E = np.load(os.path.join(OUT, f"zn_ev_m{tf}_real.npz")); H = np.load(os.path.join(OUT, f"zn_bh_m{tf}_real.npz"))
ti = EV.TYPES.index(ty); ev_all = np.flatnonzero(E["v0_type"] == ti)
if lab:
    hrow = np.flatnonzero((H["v0_bits"] & BH.BIT[lab]) != 0); ev_all = np.intersect1d(ev_all, H["v0_ev"][hrow])
rng = np.random.default_rng(42); pick = np.sort(rng.choice(ev_all, n, replace=False))
ts = lambda x: dt.datetime.utcfromtimestamp(int(x)).strftime("%Y-%m-%d %H:%M")
for e in pick:
    j = E["v0_j"][e]; s = E["v0_side"][e]; lo = E["v0_lo"][e] / EV.Q * BK.POINT; hi = E["v0_hi"][e] / EV.Q * BK.POINT; a = B["s20p"][j] / 20 * BK.POINT
    print(f"\n### event {e}: {ty} zone {lo:.3f}-{hi:.3f}  side {'from ABOVE' if s > 0 else 'from BELOW'}  ATR ${a:.3f}  band +-{0.15 * a:.3f}  far = {1.0 * a:.3f} away"
          f"  prior touch {bool(E['v0_prior'][e])}  dup {E['v0_dup'][e]}  v3 {E['v0_v3'][e]:.2f}  leg12 {E['v0_leg12'][e]:.2f}  stretch to {E['v0_xend'][e] - j} bars")
    print(f"    outcome k1/k2/k3 = {E['v0_oc'][e].tolist()} after {E['v0_tm'][e].tolist()} M1 bars (rev = +1, break = -1)")
    hr = np.flatnonzero(H["v0_ev"] == e)
    for b in range(max(j - 6, 0), min(E["v0_xend"][e] + 3, len(B["c"]))):
        tag = "  <== TOUCH" if b == j else ("  (in zone)" if j < b < E["v0_xend"][e] else "")
        k = hr[H["v0_b"][hr] == b]
        if len(k):
            bits = H["v0_bits"][k[0]]; labs = [l for l in BH.LABELS if bits & BH.BIT[l] and l != "any"]
            tag += f"  labels {labs}  rev hit1 {H['v0_rev_hit1'][k[0]]:.0f}  brk SL2_TP1R {H['v0_brk_SL2_TP1R'][k[0]]:+.2f}"
        dist_lo = (B['l'][b] - hi) / a if s > 0 else (lo - B['h'][b]) / a
        print(f"    {ts(B['t_open'][b])} O {B['o'][b]:.3f} H {B['h'][b]:.3f} L {B['l'][b]:.3f} C {B['c'][b]:.3f}  dist-from-zone {dist_lo:+.2f} ATR{tag}")
