r"""How many zone lives changed with the integer fix of zn_lib.first_through (bugs.md 2026-10-01)? Recomputes every break / death with
the OLD float rule next to the stored (new) values, real market. Output stdout."""
import sys
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL
M = PO.load_market("real"); Z = ZL.Zones(M); n = len(M["t"])
def old(start, level, side, maxbars, use_close):
    e = min(n, start + maxbars)
    if start >= e: return n
    x = (M["c"] if use_close else (M["h"] if side > 0 else M["l"]))[start:e]; w = np.flatnonzero((x - level) * side > 0)
    return start + w[0] if len(w) else n
tot = ch = 0
for s, z in Z.sw.items():
    o = np.array([old(c + 1, p, k, Z.maxbars, True) for p, k, c in zip(z["p"], z["kind"], z["conf"])]); d = int((o != z["brk"]).sum()); tot += len(o); ch += d
    print(f"swing ${s}: {d} of {len(o)} breaks changed")
for key, z in Z.swa.items():
    mb = (ZL.ATR_SW_AGE[key[0]] + 2) * 1450
    o = np.array([old(c + 1, p, k, mb, True) for p, k, c in zip(z["p"], z["kind"], z["conf"])]); d = int((o != z["brk"]).sum()); tot += len(o); ch += d
    print(f"swing M{key[0]} {key[1]} ATR: {d} of {len(o)} breaks changed")
print(f"imbalance zones use bar prices on both sides (no float gap) -> unchanged by construction; total swing breaks changed {ch} of {tot} ({ch / tot:.4%})")
