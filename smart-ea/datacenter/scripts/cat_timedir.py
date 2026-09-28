"""Time footprints (descriptive statistics, full days only, sizes in ADR20):
 1) direction by clock hour (New York clock + Thai clock): mean net move of that hour / ADR, share of up hours, t-stat with day clusters,
    both halves of the data
 2) weekday and turn-of-month: mean net day move / ADR, share of up days
 3) LBMA London gold fix (auctions 10:30 and 15:00 London time, UK daylight saving handled): volatility in the 10 minutes after the fix
    vs the same clock minute averaged over the other :30/:00 marks; reversal = the 30 minutes after the fix go against the 30 minutes before
 4) volatility carry-over: correlation of range in consecutive windows (last hour -> next hour, first hour -> rest of day, yesterday -> today)
 5) persistence by horizon: variance ratio VR(q) of M1 returns inside the day for q = 5, 15, 60, 240 minutes
    (VR < 1 = moves tend to reverse at that horizon, VR > 1 = moves tend to continue); sign-flipped copies give the no-dependence level"""
import numpy as np
from datetime import datetime, timezone
import cat_bars as CB, cat_struct as CS, broker as BK
M = CB.m1(); FS = CB.full_list(); FSs = set(FS.tolist()); ADR = CB.adr_map()
t, o, h, l, c, sid, day, et = (M[x] for x in ("t", "o", "h", "l", "c", "sid", "day", "et"))
starts = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; ends = np.r_[starts[1:], len(t)]
S = [(a, b) for a, b in zip(starts, ends) if int(day[b - 1]) in FSs]
half_cut = FS[len(FS) // 2]
def tstat(x): x = np.asarray(x, float); x = x[np.isfinite(x)]; return x.mean() / (x.std(ddof=1) / np.sqrt(len(x))) if len(x) > 2 else np.nan
# ---- 1) direction by hour
print("1) DIRECTION BY CLOCK HOUR (net move of the hour / ADR x100; share of up hours; t; H1 | H2 means)")
for clock in ("NY", "Thai"):
    rows = {}
    for a, b in S:
        dk = int(day[b - 1]); U = ADR[dk]; w = np.arange(a, b)
        hr = et[w] if clock == "NY" else ((t[w] // 3600) + 7) % 24
        for hh in np.unique(hr):
            k = w[hr == hh]
            if len(k) < 30: continue
            rows.setdefault(int(hh), []).append(((c[k[-1]] - o[k[0]]) / U, dk < half_cut))
    order = list(range(17, 24)) + list(range(0, 17)) if clock == "NY" else list(range(5, 24)) + list(range(0, 5))
    print(f"  {clock} hour | mean x100 | up share | t     | H1 x100 | H2 x100")
    for hh in order:
        if hh not in rows: continue
        x = np.array([r[0] for r in rows[hh]]); hf = np.array([r[1] for r in rows[hh]])
        flag = " <--" if abs(tstat(x)) >= 3 and np.sign(x[hf].mean()) == np.sign(x[~hf].mean()) else ""
        print(f"   {hh:02d}      | {100 * x.mean():+6.2f}    | {np.mean(x > 0):5.0%}    | {tstat(x):+5.1f} | {100 * x[hf].mean():+6.2f}  | {100 * x[~hf].mean():+6.2f}{flag}")
# ---- 2) weekday / turn of month
print("\n2) WEEKDAY and TURN-OF-MONTH (net day move / ADR x100)")
D = []
for a, b in S:
    dk = int(day[b - 1]); dt = datetime.fromtimestamp(dk * 86400, timezone.utc); D.append((dk, dt.weekday(), dt.day, dt.month, (c[b - 1] - o[a]) / ADR[dk]))
D = np.array(D, dtype=float)
for wd, nm in enumerate(("Mon", "Tue", "Wed", "Thu", "Fri")):
    x = D[D[:, 1] == wd, 4]; print(f"  {nm}: mean {100 * x.mean():+6.1f} up {np.mean(x > 0):.0%} t {tstat(x):+.1f} (n {len(x)})")
# trading-day position in month
pos_first = np.zeros(len(D), bool); pos_last = np.zeros(len(D), bool)
ym = D[:, 3] + 100 * np.floor(D[:, 0] / 365)
for m_ in np.unique([(int(datetime.fromtimestamp(int(d) * 86400, timezone.utc).strftime('%Y%m'))) for d in D[:, 0]]):
    idx = [i for i, d in enumerate(D[:, 0]) if int(datetime.fromtimestamp(int(d) * 86400, timezone.utc).strftime('%Y%m')) == m_]
    pos_first[idx[:2]] = True; pos_last[idx[-2:]] = True
for nm, m in (("first 2 trading days", pos_first), ("last 2 trading days", pos_last), ("other days", ~(pos_first | pos_last))):
    x = D[m, 4]; print(f"  {nm:22s}: mean {100 * x.mean():+6.1f} up {np.mean(x > 0):.0%} t {tstat(x):+.1f} (n {len(x)})")
# ---- 3) London fix
def uk_dst(ts):
    d = datetime.fromtimestamp(int(ts), timezone.utc); y = d.year
    def last_sun(mo):
        x = datetime(y, mo, 31, tzinfo=timezone.utc); return int(x.timestamp()) - ((x.weekday() + 1) % 7) * 86400 + 3600
    return last_sun(3) <= ts < last_sun(10)
tpos = {int(x): i for i, x in enumerate(t)}
def window_stats(offset_fn):
    vol, rev, n = [], [], 0
    for a, b in S:
        dk = int(day[b - 1]); f_ts = offset_fn(dk)
        if f_ts is None or f_ts not in tpos: continue
        i = tpos[f_ts]
        if i - 30 < a or i + 30 >= b: continue
        day_10 = np.mean([(h[j:j + 10].max() - l[j:j + 10].min()) for j in range(a, b - 10, 10)])
        vol.append((h[i:i + 10].max() - l[i:i + 10].min()) / day_10)
        before = c[i - 1] - c[i - 31]; after = c[i + 29] - c[i - 1]
        if abs(before) > 0: rev.append(np.sign(after) == -np.sign(before))
    return np.array(vol), np.array(rev)
def london_ts(dk, hh, mm):
    base = dk * 86400 + hh * 3600 + mm * 60; return base - 3600 if uk_dst(base) else base
print("\n3) LONDON GOLD FIX (10 min range after the mark / average 10-min range of the day | share of 30-min reversal around the mark)")
for nm, hh, mm in (("AM fix 10:30 London", 10, 30), ("PM fix 15:00 London", 15, 0)):
    v_, r_ = window_stats(lambda dk: london_ts(dk, hh, mm))
    print(f"  {nm}: vol x{np.median(v_):.2f} (mean {v_.mean():.2f}), reversal {r_.mean():.1%} (n {len(r_)})")
print("  baseline: other London half-hour marks 08:00-16:30 (same measures)")
bv, br = [], []
for hh in range(8, 17):
    for mm in (0, 30):
        if (hh, mm) in ((10, 30), (15, 0)): continue
        v_, r_ = window_stats(lambda dk: london_ts(dk, hh, mm)); bv.append(np.median(v_)); br.append(r_.mean())
        print(f"    {hh:02d}:{mm:02d} vol x{np.median(v_):.2f} rev {r_.mean():.1%}")
print(f"  baseline median vol x{np.median(bv):.2f}, reversal {np.median(br):.1%}")
# ---- 4) volatility carry-over
print("\n4) VOLATILITY CARRY-OVER (correlation of ranges)")
fr, rest, yday, today = [], [], [], []
H = []
prevR = None
for a, b in S:
    w = np.arange(a, b); R_ = h[w].max() - l[w].min(); f = w[t[w] < t[a] + 3600]; r_ = w[t[w] >= t[a] + 3600]
    fr.append(h[f].max() - l[f].min()); rest.append(h[r_].max() - l[r_].min())
    if prevR is not None: yday.append(prevR); today.append(R_)
    prevR = R_
    hr_blocks = [(h[w[j:j + 60]].max() - l[w[j:j + 60]].min()) for j in range(0, len(w) - 60, 60)]
    H += list(zip(hr_blocks[:-1], hr_blocks[1:]))
H = np.array(H)
print(f"  first hour -> rest of day {np.corrcoef(fr, rest)[0, 1]:.2f} | yesterday -> today {np.corrcoef(yday, today)[0, 1]:.2f} | hour -> next hour {np.corrcoef(H[:, 0], H[:, 1])[0, 1]:.2f}")
# ---- 5) variance ratio
print("\n5) VARIANCE RATIO of M1 returns inside the day (real vs sign-flipped)")
def vr(cc, q):
    num, den = [], []
    for a, b in S:
        x = cc[a:b]; r1 = np.diff(x)
        if len(r1) < q * 4: continue
        rq = x[q:] - x[:-q]; num.append(np.sum(rq ** 2) / len(rq)); den.append(q * np.sum(r1 ** 2) / len(r1))
    return np.sum(num) / np.sum(den)
flips = [CS.signflip_m1(o, h, l, c, M["tv"].astype(float), sid, 1200 + s)[3] for s in range(3)]
for q in (5, 15, 60, 240):
    rr = vr(c, q); ff = [vr(x, q) for x in flips]
    hA = [(a, b) for a, b in S if day[b - 1] < half_cut]
    print(f"  q={q:3d} min: real {rr:.3f} vs signflip {np.mean(ff):.3f} (range {min(ff):.3f}-{max(ff):.3f})")
