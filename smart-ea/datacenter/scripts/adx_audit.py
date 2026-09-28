r"""Phase 1 audit of the FILE adx_trades.sqlite (not the simulator) with code written separately from adx_lib.py:
A) library rows vs MT5 reports trade by trade (6 fixed-risk runs + volume-sizing runs: lot size tells the EA's volume multiplier)
B) r_std formula re-computed
C) hold_min / MFE / MAE / entry price / spread re-computed from raw bars for random trades
D) trading-day key re-computed with zoneinfo (independent of broker.us_dst)
Usage: python adx_audit.py <reports dir>"""
import os, sys, sqlite3, json
from datetime import datetime, timezone
import numpy as np
import broker as BK
from adx_verify import parse_report

REP = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\surak\Downloads\ADX-opt\research-2026-09-27\scripts\reports"
db = sqlite3.connect(os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite"))
cols = [r[1] for r in db.execute("PRAGMA table_info(trades)")]
bad = 0
def rep(name, ok, extra=""):
    global bad; bad += not ok
    print(f"{'OK ' if ok else 'BAD'} {name} {extra}")

def set_id(tf, ap, ep, ma, gp, sl, ex):
    r = db.execute("SELECT set_id FROM params WHERE tf=? AND adx_p=? AND ema_p=? AND abs(min_adx-?)<1e-9 AND abs(min_gap-?)<1e-9 AND sl_atr=? AND exit_mode=?",
                   (tf, ap, ep, ma, gp, sl, ex)).fetchone()
    return r[0]

def rows(sid):
    X = db.execute(f"SELECT {','.join(cols)} FROM trades WHERE set_id=? ORDER BY entry_t", (sid,)).fetchall()
    return {int(r[cols.index('entry_t')]): dict(zip(cols, r)) for r in X}

LO, HI = BK.utc_ts("2024-04-16"), BK.utc_ts("2025-12-30")     # skip the tester's first/last day (warm-up / forced end)
RUNS = {"v_m1_a8e40_l": (1, 8, 40, 29, 9.2, 8, "L"), "v_m1_a14e5_t3": (1, 14, 5, 0, 0, 4, "T3"), "v_m3_a14e5_t3": (3, 14, 5, 0, 0, 4, "T3"),
        "v_m3_a28e40_l": (3, 28, 40, 29, 9.2, 12, "L"), "v_m5_a8e40_l": (5, 8, 40, 29, 9.2, 8, "L"), "v_m5_a28e5_t3": (5, 28, 5, 0, 9.2, 12, "T3")}
print("A) library file vs MT5 (every tick, 2024-04-16 .. 2025-12-29)")
for name, p in RUNS.items():
    L = rows(set_id(*p))
    M = {int(BK.server_to_utc(q["t"] // 60 * 60)): q for q in parse_report(os.path.join(REP, f"diag_{name}.htm"))}
    L = {k: v for k, v in L.items() if LO <= k < HI}; M = {k: v for k, v in M.items() if LO <= k < HI}
    both = set(L) & set(M)
    dr = []
    for k in both:
        m, l = M[k], L[k]; vol = sum(o[1] for o in m["outs"])
        dr.append(sum(o[1] * (o[2] - m["px"]) * m["d"] for o in m["outs"]) / (vol * l["risk_px"]) - l["r_raw"])
    dr = np.abs(dr); dirm = sum(M[k]["d"] != L[k]["dir"] for k in both)
    unm = len(set(L) ^ set(M))
    rep(f"  {name}: lib {len(L)} mt5 {len(M)} matched {len(both)} unmatched {unm} dir-mismatch {dirm} |dR| p50 {np.median(dr):.4f} p99 {np.percentile(dr, 99):.3f}",
        dirm == 0 and unm <= max(4, 0.005 * len(M)) and np.median(dr) < 0.005)   # SL-4 M1 sets: a few cents = 0.002-0.003R
for name, p in (("vol_v_m1_a8e40_l", RUNS["v_m1_a8e40_l"]), ("vol_v_m5_a8e40_l", RUNS["v_m5_a8e40_l"])):
    f = os.path.join(REP, f"diag_{name}.htm")
    if not os.path.exists(f): rep(f"  {name}: report missing", False); continue
    L = rows(set_id(*p)); M = {int(BK.server_to_utc(q["t"] // 60 * 60)): q for q in parse_report(f)}
    # vol_ratio = -1 in the library on purpose where the EA's 1440-bar window still reaches the flat pre-data_start bars
    both = [k for k in set(L) & set(M) if LO <= k < HI and L[k]["vol_ratio"] >= 0]
    rep(f"  {name}: trades matched {len(both)} (lib {len([k for k in L if LO <= k < HI])}, mt5 {len([k for k in M if LO <= k < HI])})",
        len(both) >= 0.99 * len([k for k in L if LO <= k < HI and L[k]["vol_ratio"] >= 0]))
    implied = np.array([M[k]["vol"] * L[k]["risk_px"] / 100.0 for k in both]); lib = np.array([L[k]["vol_mult"] for k in both])
    agree = np.abs(implied - lib) < 0.05
    rep(f"  {name}: volume multiplier agrees on {agree.sum()}/{len(both)} trades (lib 1.5 share {np.mean(lib == 1.5):.2f})", agree.mean() > 0.995)
    for k in [k for k, a in zip(both, agree) if not a][:5]:
        print("     e.g.", datetime.fromtimestamp(k, timezone.utc), "mt5 implied", round(M[k]["vol"] * L[k]["risk_px"] / 100, 3), "lib", L[k]["vol_mult"], "ratio", round(L[k]["vol_ratio"], 3))

print("B) r_std")
cost = json.loads(dict(db.execute("SELECT k, v FROM meta").fetchall())["cost_std_price"])
d = db.execute("SELECT MAX(ABS(r_std - (r_raw - (? - spread_entry) / risk_px))) FROM trades", (cost,)).fetchone()[0]
rep(f"  r_std = r_raw - ({cost} - spread_entry)/risk_px, max error {d:.2e}", d < 1e-9)

print("C) raw-bar recompute on 3000 random trades")
_z = np.load(BK.BARS); z = {k: _z[k] for k in _z.files}   # decompress once (NpzFile re-reads the file on every access)
bt = BK.server_to_utc(z["t"].astype(np.int64)); idx = {int(t): i for i, t in enumerate(bt)}
R = db.execute(f"SELECT {','.join(cols)} FROM trades ORDER BY RANDOM() LIMIT 3000").fetchall()
e_hold = e_px = e_sp = e_mfe = e_mae = 0
for r in R:
    x = dict(zip(cols, r)); i, j = idx[x["entry_t"]], idx[x["exit_t"]]
    sp = z["sp"][i] * BK.POINT
    e_sp += abs(sp - x["spread_entry"]) > 1e-9
    e_px += abs((z["o"][i] + (sp if x["dir"] == 1 else 0)) - x["entry_px"]) > 1e-9
    e_hold += x["hold_min"] != (x["exit_t"] - x["entry_t"]) // 60
    a = z["sp"][i:j + 1] * BK.POINT if x["dir"] == -1 else 0.0
    hi, lo = z["h"][i:j + 1] + a, z["l"][i:j + 1] + a
    # favourable/adverse extremes: bars before the exit bar are fully seen; the exit bar only partly -> bracket
    if x["dir"] == 1: f_in, f_out, a_in, a_out = hi[:-1].max(initial=-1e9) - x["entry_px"], hi.max() - x["entry_px"], x["entry_px"] - lo[:-1].min(initial=1e9), x["entry_px"] - lo.min()
    else:             f_in, f_out, a_in, a_out = x["entry_px"] - lo[:-1].min(initial=1e9), x["entry_px"] - lo.min(), hi[:-1].max(initial=-1e9) - x["entry_px"], hi.max() - x["entry_px"]
    rk = x["risk_px"]; tol = 1e-6
    e_mfe += not (max(f_in, 0) / rk - tol <= x["mfe_r"] <= max(f_out, 0) / rk + tol)
    e_mae += not (max(a_in, 0) / rk - tol <= x["mae_r"] <= max(a_out, 0) / rk + tol)
rep(f"  spread_entry / entry_px / hold_min mismatches: {e_sp} / {e_px} / {e_hold}", e_sp + e_px + e_hold == 0)
rep(f"  MFE / MAE outside the bracket from raw bars: {e_mfe} / {e_mae}", e_mfe + e_mae == 0)

print("D) trading day with zoneinfo")
try:
    from zoneinfo import ZoneInfo
    ny = ZoneInfo("America/New_York")
    E = [r[0] for r in db.execute("SELECT entry_t, day FROM trades ORDER BY RANDOM() LIMIT 5000")]
    D = dict(db.execute("SELECT entry_t, day FROM trades").fetchall())
    wrong = 0
    for t in E:
        loc = datetime.fromtimestamp(t, timezone.utc).astimezone(ny)
        dd = loc.date().toordinal() - datetime(1970, 1, 1).toordinal() + (1 if loc.hour >= 17 else 0)
        wrong += dd != D[t]
    rep(f"  day key mismatches in 5000 random trades: {wrong}", wrong == 0)
except Exception as ex:
    print("  skipped (zoneinfo/tzdata not available):", ex)
print("RESULT:", "audit passed" if bad == 0 else f"{bad} check(s) failed")
