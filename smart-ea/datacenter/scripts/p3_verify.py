r"""Phase 3: independent recomputation of a few pattern statistics (plain SQL + python loops, no p3lib code) compared with p3_real.pkl.
Checks: sandbox filter, residual vs set x direction x half, direction-relative labels, percentile bands of the first half, day-clustered SE.
Usage: python p3_verify.py"""
import os, sqlite3, pickle, math
from collections import defaultdict
from datetime import datetime, timezone
import adx_asof

DB = adx_asof.DBT
ts = lambda s: int(datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
LO, END, HALF = ts("2024-04-15"), ts("2026-06-01"), ts("2025-05-08")
HALFD = HALF // 86400                               # halves by trading day (trades.day), not UTC midnight

def pct(vals, p):                                   # numpy 'linear' percentile, written out
    v = sorted(vals); k = (len(v) - 1) * p / 100.0; f = math.floor(k); c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)

def main():
    db = sqlite3.connect(DB)
    tf = {s: t for s, t in db.execute("SELECT set_id, tf FROM params")}
    rows = db.execute("""SELECT t.set_id, t.entry_t, t.day, t.dir, t.r_std, c.d_day_pos, c.m5k3_reg, c.t_et_hour, c.h1k3_reg, c.m1k2_leg_dir,
                         c.d_broke_pdh, c.d_broke_pdl, c.a_m3_cost_atr, c.m3k3_reg, c.m3k3_dh_atr, c.m3k3_dl_atr
                         FROM trades t JOIN ctx c ON c.entry_t = t.entry_t WHERE t.entry_t >= ? AND t.exit_t + 60 <= ?""", (LO, END)).fetchall()
    grp = defaultdict(list)
    for r in rows: grp[(r[0], r[3] > 0, r[2] >= HALFD)].append(r[4])
    mean = {k: sum(v) / len(v) for k, v in grp.items()}
    def stat(tfv, pred):
        per = defaultdict(lambda: [0.0, 0])
        for r in rows:
            if tf[r[0]] != tfv: continue
            p = pred(r)
            if p is None or not p: continue
            e = r[4] - mean[(r[0], r[3] > 0, r[2] >= HALFD)]; per[r[2]][0] += e; per[r[2]][1] += 1
        S = sum(a for a, b in per.values()); N = sum(b for a, b in per.values()); mu = S / N; D = len(per)
        se = math.sqrt(sum((a - mu * b) ** 2 for a, b in per.values()) * D / (D - 1)) / N
        return mu, mu / se, N
    # percentile bands of d_day_pos (relative) for M1 trades of the first half
    rel = lambda r: None if r[5] is None else (r[5] if r[3] > 0 else 1 - r[5])
    ref = [rel(r) for r in rows if tf[r[0]] == 1 and r[2] < HALFD and rel(r) is not None]
    q20 = pct(ref, 20)
    ref3 = [r[12] for r in rows if tf[r[0]] == 3 and r[2] < HALFD and r[12] is not None]; c80 = pct(ref3, 80)
    def ph(h): return "asia" if (h >= 17 or h < 3) else "london" if h < 8 else "newyork" if h < 13 else "late"
    def reg_m(r, m):
        if r[13] is None: return None
        dh, dl = r[14], r[15]
        return 1 if (dh > m and dl > m) else (-1 if (dh < -m and dl < -m) else 0)
    checks = [
        ((1, "C_daypos", "Q1 (0-20%)"), 1, lambda r: None if rel(r) is None else rel(r) < q20),
        ((5, "A_reg", "ตาม"), 5, lambda r: None if r[6] is None else r[6] * r[3] > 0),
        ((5, "B_phase", "newyork"), 5, lambda r: ph(r[7]) == "newyork"),
        ((1, "D_h1", "sideway"), 1, lambda r: None if r[8] is None else r[8] == 0),
        ((1, "A_leg", "ขาปัจจุบันไปทางไม้"), 1, lambda r: None),   # placeholder replaced below (k3 primary)
        ((3, "C_brk", "ทะลุ H/L เมื่อวานฝั่งไม้แล้ว"), 3,
         lambda r: None if r[10] is None else ((r[10] if r[3] > 0 else r[11]) == 1 and (r[11] if r[3] > 0 else r[10]) == 0)),
        ((3, "B_cost", "Q5 (80-100%)"), 3, lambda r: None if r[12] is None else r[12] >= c80),
    ]
    checks.pop(4)
    real = {(r["tf"], r["feat"], r["level"]): r for r in pickle.load(open(os.path.join(os.path.dirname(DB), "p3_real.pkl"), "rb"))["res"]}
    # regime with tolerance 0.25 ATR (variant 3 of A_reg) for M3 'ตาม'
    mu, t, n = stat(3, lambda r: None if reg_m(r, 0.25) is None else reg_m(r, 0.25) * r[3] > 0)
    rr = real[(3, "A_reg", "ตาม")]; ok_var = abs(t - rr["var_t"][2]) < 1e-6
    print(f"M3 A_reg ตาม tolerance 0.25: independent t {t:+.4f} vs p3lib variant {rr['var_t'][2]:+.4f} -> {'OK' if ok_var else 'DIFF'}")
    bad = 0 if ok_var else 1
    for key, tfv, pred in checks:
        mu, t, n = stat(tfv, pred); r = real[key]
        ok = n == r["n"] and abs(mu - r["lift"]) < 1e-9 and abs(t - r["t"]) < 1e-6
        bad += not ok
        print(f"{key}: independent n {n} lift {mu:+.6f} t {t:+.4f} | p3lib n {r['n']} lift {r['lift']:+.6f} t {r['t']:+.4f} -> {'OK' if ok else 'DIFF'}")
    print("ALL OK" if bad == 0 else f"{bad} DIFFERENCES")

if __name__ == "__main__":
    main()
