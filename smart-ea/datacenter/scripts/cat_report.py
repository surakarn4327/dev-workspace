"""Catalog report (descriptive): for every behaviour x TF -> per-day frequency over FULL sessions, distribution, direction split,
when it happens (phase rates per hour, peak Thai hour), stability (monthly CV, min/max month, first vs second half, link with activity).
Writes catalog_summary.csv next to the database."""
import numpy as np, sqlite3, os, csv
from datetime import datetime, timezone
import cat_bars as CB
HERE = os.path.dirname(CB.DB); DB = CB.DB
db = sqlite3.connect(DB)
adr = dict(db.execute("SELECT day, adr20 FROM days").fetchall()); opn = dict(db.execute("SELECT day, open FROM days").fetchall())
FULL = CB.full_list()                                            # full trading days (>= 85% of median bars/day) with ADR
fullset = set(FULL.tolist()); ND = len(FULL)
mon = np.array([datetime.fromtimestamp(int(d) * 86400, timezone.utc).strftime("%Y-%m") for d in FULL]); months = sorted(set(mon))
mon_act = np.array([np.mean([adr[int(d)] / opn[int(d)] * 100 for d in FULL[mon == m]]) for m in months])
half = FULL < np.median(FULL)
# phase hours (NY clock): asia 17-03 (10h), london 03-08 (5h), newyork 08-13 (5h), late 13-17 (4h, market pauses ~1h)
PH_H = {"asia": 10, "london": 5, "newyork": 5, "late": 3}
print(f"full sessions used: {ND} ({datetime.fromtimestamp(int(FULL[0]) * 86400, timezone.utc):%Y-%m-%d} .. {datetime.fromtimestamp(int(FULL[-1]) * 86400, timezone.utc):%Y-%m-%d}), months {len(months)}")
out = []
hdr = (" TF  behaviour         | per day  med [p10-p90]  days>=1 | bull%  | per hour: asia london NY late | peak Thai hr | monthly: CV  min-max   | H1   H2   | rho(activity)")
for tf in (1, 5, 15):
    print("\n" + hdr)
    types = [r[0] for r in db.execute("SELECT DISTINCT type FROM patterns WHERE tf=? ORDER BY type", (tf,))]
    for ty in types:
        rows = db.execute("SELECT day, dir, phase, t FROM patterns WHERE tf=? AND type=?", (tf, ty)).fetchall()
        dd = np.array([r[0] for r in rows]); keep = np.isin(dd, FULL)
        dd = dd[keep]; dr = np.array([r[1] for r in rows])[keep]; ph = np.array([r[2] for r in rows])[keep]; tt = np.array([r[3] for r in rows], dtype=np.int64)[keep]
        per = np.array([np.sum(dd == d) for d in FULL]) if len(dd) else np.zeros(ND)
        per = np.bincount(np.searchsorted(FULL, dd), minlength=ND).astype(float)
        mm = np.array([per[mon == m].mean() for m in months])
        rates = {p: np.sum(ph == p) / ND / PH_H[p] for p in PH_H}
        thai = ((tt // 3600) + 7) % 24; peak = np.bincount(thai, minlength=24).argmax()
        bull = np.mean(dr[dr != 0] > 0) if np.any(dr != 0) else np.nan
        rho = np.corrcoef(mm, mon_act)[0, 1]
        rec = dict(tf=tf, type=ty, per_day=per.mean(), median=np.median(per), p10=np.percentile(per, 10), p90=np.percentile(per, 90),
                   days_ge1=np.mean(per >= 1), bull=bull, asia_h=rates["asia"], london_h=rates["london"], ny_h=rates["newyork"], late_h=rates["late"],
                   peak_thai=peak, month_cv=mm.std() / mm.mean() if mm.mean() else np.nan, month_min=mm.min(), month_max=mm.max(),
                   h1=per[half].mean(), h2=per[~half].mean(), rho_act=rho)
        out.append(rec)
        print(f" M{tf:<2} {ty:17s} | {rec['per_day']:7.2f} {rec['median']:4.0f} [{rec['p10']:3.0f}-{rec['p90']:4.0f}] {rec['days_ge1']:6.0%}  |"
              f" {'  -  ' if np.isnan(bull) else f'{bull:5.0%}'}  | {rates['asia']:6.2f} {rates['london']:6.2f} {rates['newyork']:6.2f} {rates['late']:5.2f} |"
              f"   {peak:02d}:00     | {rec['month_cv']:4.2f} {mm.min():6.2f}-{mm.max():6.2f} | {rec['h1']:5.2f} {rec['h2']:5.2f} | {rho:+.2f}")
    # legs
    L = np.array(db.execute("SELECT day, size_atr, size_adr, minutes FROM legs WHERE tf=?", (tf,)).fetchall(), dtype=float)
    L = L[np.isin(L[:, 0], FULL)]; per = np.bincount(np.searchsorted(FULL, L[:, 0].astype(np.int64)), minlength=ND)
    print(f" M{tf:<2} LEGS (zigzag 3 ATR)  | per day {per.mean():.1f} [p10-p90 {np.percentile(per, 10):.0f}-{np.percentile(per, 90):.0f}] | size ATR median {np.median(L[:, 1]):.1f}"
          f" [p90 {np.percentile(L[:, 1], 90):.1f}] | size ADR median {np.nanmedian(L[:, 2]):.3f} | minutes median {np.median(L[:, 3]):.0f} [p90 {np.percentile(L[:, 3], 90):.0f}]"
          f" | monthly per-day min-max {min(per[mon == m].mean() for m in months):.1f}-{max(per[mon == m].mean() for m in months):.1f}")
    out.append(dict(tf=tf, type="LEGS", per_day=per.mean(), median=np.median(per), p10=np.percentile(per, 10), p90=np.percentile(per, 90)))
with open(os.path.join(HERE, "catalog_summary.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); [w.writerow({k: r.get(k, "") for k in out[0]}) for r in out]
print(f"\nmonthly activity (ADR % of price) range {mon_act.min():.2f}-{mon_act.max():.2f}")
