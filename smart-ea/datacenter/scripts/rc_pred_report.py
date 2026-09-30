r"""Summary of rc_pred.py: top-20% / top-10% predicted trades vs all trades of the month, real market vs random-direction markets."""
import os, glob, numpy as np
D = r"C:\trade datacenter\rc\pred"; out = []
def say(s): print(s); out.append(s)
say("market  model  months  top20 uplift R/trade (mean, months>0)  top10 uplift   corr(pred, R)")
rows = {}
for mkt in ("real", "sf1", "sf2", "sf3", "sf4", "sf5"):
    fs = sorted(f for f in glob.glob(os.path.join(D, f"{mkt}_2*.npz")) if "small" not in f)
    if not fs: continue
    for mdl in ("pg", "pr"):
        u20, u10, cc, tot20 = [], [], [], []
        for f in fs:
            z = np.load(f); p = z[mdl]; r = z["r"]
            t20 = p >= np.quantile(p, 0.8); t10 = p >= np.quantile(p, 0.9)
            u20.append(r[t20].mean() - r.mean()); u10.append(r[t10].mean() - r.mean()); cc.append(np.corrcoef(p, r)[0, 1])
            tot20.append(r[t20].mean())
        u20 = np.array(u20); rows[(mkt, mdl)] = u20.mean()
        say(f"{mkt:5s}  {'boost' if mdl == 'pg' else 'ridge'}   {len(fs):2d}     {u20.mean():+.3f} (sd/sqrt(n) {u20.std() / np.sqrt(len(u20)):.3f}, {int((u20 > 0).sum())}/{len(u20)})"
            f"      {np.mean(u10):+.3f}      {np.mean(cc):+.4f}   | top20 absolute {np.mean(tot20):+.3f}")
for mdl in ("pg", "pr"):
    nul = [rows[(m, mdl)] for m in ("sf1", "sf2", "sf3", "sf4", "sf5") if (m, mdl) in rows]
    if nul and ("real", mdl) in rows:
        say(f"{'boost' if mdl == 'pg' else 'ridge'}: real {rows[('real', mdl)]:+.3f} vs random-direction markets mean {np.mean(nul):+.3f} (range {min(nul):+.3f} .. {max(nul):+.3f})")
open(r"C:\trade datacenter\rc\rc_pred.txt", "w", encoding="utf-8").write("\n".join(out))
