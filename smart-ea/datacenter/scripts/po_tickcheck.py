r"""Does the pattern-outcome library (M1 bars, 4-point path) give the same trade results as REAL ticks? (2026-01 .. 2026-09)
Trades: (1) the one pattern that made money on M5: new break of yesterday's high/low, trade with it, no TP, SL 0.5/1/1.5/2/3 ATR + wick
        (2) a random sample of 2,000 M5 bars, BUY and SELL, SL 0.5/1/2 ATR x TP 1R/2R/3R/none = general calibration of tight stops
Per trade three versions:
  model  = po_lib.trade_R (M1 4-point path, cost $0.31)
  tickA  = same entry price (bid) and levels as the model, but walked tick by tick on the bid, fills at the tick that crossed, exit at the
           last bid before the model's exit time, cost $0.31  -> isolates the price-PATH error of the bar model
  tickB  = realistic: BUY enters at the first tick's ask, SELL at its bid; BUY stops/targets/exits on the bid, SELL on the ask; levels
           placed from the actual fill; no extra cost (the real spread is paid inside)  -> path + real spread
Output: po\po_tickcheck.txt"""
import sys, os
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, po_eval as EV, ticks_lib as TL
import broker as BK

R = EV.L["real"]; M = PO.load_market("real"); t = M["t"]
TK = TL.load(); msc = TK["msc"]; bid = TK["bid"] * BK.POINT; ask = TK["ask"] * BK.POINT
T0 = int(msc[0] // 1000); T1 = int(msc[-1] // 1000)
out = []
def say(s): print(s, flush=True); out.append(s)
say(f"ticks {len(msc):,} from {T0} to {T1}")

def walk(side, px_path, entry, s_abs, tp_abs):
    """px_path = prices the position is closed at (BUY bid / SELL ask) in time order. returns exit price"""
    x = side * (px_path - entry)
    hitS = np.flatnonzero(x <= -s_abs); iS = hitS[0] if len(hitS) else 1 << 40
    iT = 1 << 40
    if tp_abs is not None:
        hitT = np.flatnonzero(x >= tp_abs); iT = hitT[0] if len(hitT) else 1 << 40
    if iS == iT == 1 << 40: return px_path[-1]
    return px_path[min(iS, iT)]

def tick_versions(q, side, s_atr, tp_atr):
    dec = int(R["dec_t"][q]); a = R["atr"][q]; e = R["entry"][q]
    j0 = np.searchsorted(t, dec); je = j0 + R["n_pts"][q] // 4 - 1; t_end = int(t[je]) + 60
    i0 = np.searchsorted(msc, dec * 1000); i1 = np.searchsorted(msc, t_end * 1000)
    if i1 - i0 < 2 or abs(bid[i0] - e) > 1e-6: return None
    s_abs = s_atr * a; tp_abs = None if tp_atr is None else tp_atr * a
    b = bid[i0:i1]; k = ask[i0:i1]
    # A: model rules on the bid path
    xa = walk(side, b, e, s_abs, tp_abs); ra = side * (xa - e) / s_abs - PO.COST / s_abs
    # B: realistic fills
    ent = k[0] if side > 0 else b[0]; path = b if side > 0 else k
    xb = walk(side, path, ent, s_abs, tp_abs); rb = side * (xb - ent) / s_abs
    return ra, rb

rng = np.random.default_rng(1)
in26 = (R["dec_t"] >= T0) & (R["dec_t"] < T1 - 86400)
# (1) the pattern
rows, d = EV.events(R, "pdx"); keep = in26[rows]; rows, d = rows[keep], d[keep]
say(f"\n(1) break of yesterday high/low, with the break, no TP: {len(rows)} trades in the real-tick period")
say("   SL       model R   tickA R   tickB R   | same exit type (A)   mean |model-tickA|")
for s in (0.5, 1, 1.5, 2, 3):
    sk = EV.LVi(s); mr, ar, br, same = [], [], [], []
    for q, sd in zip(rows, d):
        v = tick_versions(q, sd, s, None)
        if v is None: continue
        m_ = PO.trade_R(R, np.array([q]), sd, sk, None)[0]; mr.append(m_); ar.append(v[0]); br.append(v[1])
        same.append((m_ <= -0.999 - PO.COST / (s * R["atr"][q]) + 1e-9) == (v[0] <= -0.999 - PO.COST / (s * R["atr"][q]) + 1e-9))
    mr, ar, br = map(np.array, (mr, ar, br))
    say(f"   {s:<5}  {mr.mean():+8.3f}  {ar.mean():+8.3f}  {br.mean():+8.3f}   | {np.mean(same):.1%}  (n {len(mr)})   {np.mean(np.abs(mr - ar)):.3f}")
# wick stop
mr, ar, br = [], [], []
for q, sd in zip(rows, d):
    s = (R["s_b"] if sd > 0 else R["s_s"])[q]
    if s <= 0: continue
    v = tick_versions(q, sd, s, None)
    if v is None: continue
    m_ = PO.trade_R_struct(R, np.array([q]), sd, 0); tpn = None
    # no-TP wick stop: model = fin unless stop hit
    tS = (R["sb_t"] if sd > 0 else R["ss_t"])[q]; g = (R["sb_g"] if sd > 0 else R["ss_g"])[q]
    mm = (-s - g if tS >= 0 else sd * R["fin"][q]) / s - PO.COST / (s * R["atr"][q])
    mr.append(mm); ar.append(v[0]); br.append(v[1])
mr, ar, br = map(np.array, (mr, ar, br))
say(f"   wick   {mr.mean():+8.3f}  {ar.mean():+8.3f}  {br.mean():+8.3f}   (n {len(mr)})")

# (2) random calibration
pool = np.flatnonzero(in26); samp = rng.choice(pool, 2000, replace=False)
say(f"\n(2) random M5 bars (n 2000 x BUY/SELL): model vs real ticks, mean R")
say("   SL   TP      model R   tickA R   tickB R   mean |model-tickA|   SL-hit rate model / tickA")
for s, tp in ((0.5, 1), (0.5, 2), (1, 1), (1, 3), (1, None), (2, 2), (2, None)):
    sk = EV.LVi(s); tk = None if tp is None else EV.LVi(s * tp)
    mr, ar, br, hm, ha = [], [], [], [], []
    for q in samp:
        for sd in (1, -1):
            v = tick_versions(q, sd, s, None if tp is None else s * tp)
            if v is None: continue
            m_ = PO.trade_R(R, np.array([q]), sd, sk, tk)[0]; mr.append(m_); ar.append(v[0]); br.append(v[1])
            c = PO.COST / (s * R["atr"][q]); hm.append(m_ <= -1 - c + 1e-9); ha.append(v[0] <= -1 - c + 1e-9)
    mr, ar, br = map(np.array, (mr, ar, br))
    say(f"   {s:<4} {str(tp) + 'R' if tp else 'none':6s}  {mr.mean():+8.3f}  {ar.mean():+8.3f}  {br.mean():+8.3f}   {np.mean(np.abs(mr - ar)):.3f}"
        f"               {np.mean(hm):.1%} / {np.mean(ha):.1%}  (n {len(mr)})")
open(os.path.join(PO.OUTD, "po_tickcheck.txt"), "w", encoding="utf-8").write("\n".join(out))
