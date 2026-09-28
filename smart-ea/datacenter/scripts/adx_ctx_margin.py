r"""How close to the line are the regime labels in ctx? For every entry time and TF (zigzag 3 ATR): regime = compare last 2 pivot highs and last 2
pivot lows strictly. margin = the smaller of |H_last - H_prev| and |L_last - L_prev| in ATR of the TF (the difference that decided the label).
Descriptive only (practice period, no outcome). Usage: python adx_ctx_margin.py"""
import sqlite3
import numpy as np
import adx_ctx as X, adx_asof as AS

db = sqlite3.connect(AS.DBT)
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]; ci = {c: i for i, c in enumerate(cols)}
CT = np.array(db.execute("SELECT * FROM ctx WHERE entry_t < 1780272000 ORDER BY entry_t").fetchall(), dtype=float); E = CT[:, 0].astype(np.int64)
_, dE, _ = X.sessions(E); M = X.load(None)
for tf in (1, 3, 5):
    B = X.resample(M, tf); jB = X.last_closed(B, E, dE); idx, pp, kind, conf, ncf, EP = X.zigzag_state(B, 3)
    q = ncf[np.clip(jB, 0, None)] - 1
    Hs = [np.nan] * len(pp); Hp = [np.nan] * len(pp); Ls = [np.nan] * len(pp); Lp = [np.nan] * len(pp); h2 = []; l2 = []
    for m in range(len(pp)):
        (h2 if kind[m] > 0 else l2).append(pp[m])
        if len(h2) >= 2 and len(l2) >= 2: Hs[m], Hp[m], Ls[m], Lp[m] = h2[-1], h2[-2], l2[-1], l2[-2]
    Hs, Hp, Ls, Lp = map(np.array, (Hs, Hp, Ls, Lp))
    a = CT[:, ci[f"a_m{tf}_atr_usd"]]; reg = CT[:, ci[f"m{tf}k3_reg"]]; ok = (q >= 3) & ~np.isnan(reg)
    dh = (Hs[q] - Hp[q]) / a; dl = (Ls[q] - Lp[q]) / a
    # the difference that decided the label: for up/down the smaller of the two moves; for sideway the pair that disagreed
    marg = np.where(reg != 0, np.minimum(np.abs(dh), np.abs(dl)), np.minimum(np.abs(dh), np.abs(dl)))
    print(f"M{tf} zigzag 3 ATR, {int(ok.sum())} entries:")
    for lab, v in ((1, "up"), (-1, "down"), (0, "sideway")):
        s = ok & (reg == lab)
        print(f"   {v:8s} {s.mean() / ok.mean():6.1%} of entries | decided by < 0.1 ATR: {np.mean(marg[s] < 0.1):5.1%}  < 0.25 ATR: {np.mean(marg[s] < 0.25):5.1%}"
              f"  < 0.5 ATR: {np.mean(marg[s] < 0.5):5.1%}  (median {np.median(marg[s]):.2f} ATR)")
    for tol in (0.25, 0.5):
        new = np.where((dh > tol) & (dl > tol), 1, np.where((dh < -tol) & (dl < -tol), -1, 0))
        print(f"   if |difference| <= {tol} ATR counted as 'equal': up {np.mean(new[ok] == 1):.1%} down {np.mean(new[ok] == -1):.1%} sideway {np.mean(new[ok] == 0):.1%}"
              f" | labels that change {np.mean(new[ok] != reg[ok]):.1%}")
