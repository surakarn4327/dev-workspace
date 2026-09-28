r"""Phase 1 audit, part 2 — columns not covered by adx_audit.py:
E) indicator values at the signal (adx, ema, di_plus, di_minus, atr, ref_px) vs the MT5 research EA log AdxResearchLog
   (sig_y2025.csv, M1 ADX8/EMA40, rows the real EA would take = taken==1; iADX/iATR computed inside MT5)
F) broker levels + exit bookkeeping vs MT5 reports: sl_px, tp3_px (order S/L, T/P), exit_reason (last deal sl/tp/other),
   hit_tp1/hit_tp2 (number of partial closes) for the 6 fixed-risk verification runs
Usage: python adx_audit2.py [reports dir]"""
import os, sys, re, csv, html, sqlite3
from datetime import datetime, timezone
import numpy as np
import broker as BK

REP = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\surak\Downloads\ADX-opt\research-2026-09-27\scripts\reports"
db = sqlite3.connect(os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite"))
cols = [r[1] for r in db.execute("PRAGMA table_info(trades)")]
bad = 0
def rep(name, ok, extra=""):
    global bad; bad += not ok
    print(f"{'OK ' if ok else 'BAD'} {name} {extra}")
def ts(s, fmt): return int(datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).timestamp())
def set_id(tf, ap, ep, ma, gp, sl, ex):
    return db.execute("SELECT set_id FROM params WHERE tf=? AND adx_p=? AND ema_p=? AND abs(min_adx-?)<1e-9 AND abs(min_gap-?)<1e-9 "
                      "AND sl_atr=? AND exit_mode=?", (tf, ap, ep, ma, gp, sl, ex)).fetchone()[0]
def rows(sid):
    X = db.execute(f"SELECT {','.join(cols)} FROM trades WHERE set_id=?", (sid,)).fetchall()
    return {int(r[cols.index('entry_t')]): dict(zip(cols, r)) for r in X}

print("E) indicator values vs MT5 research log (M1 ADX8/EMA40, 2025)")
L = rows(set_id(1, 8, 40, 29, 9.2, 8, "L"))   # indicator values at a signal do not depend on the path; match by entry time
f = os.path.expandvars(r"%APPDATA%\MetaQuotes\Terminal\Common\Files\adxres\sig_y2025.csv")
n = 0; d = {k: [] for k in ("adx", "ema", "dip", "dim", "atr", "ref")}
with open(f) as fh:
    for r in csv.DictReader(fh):
        if r["v"] != "0": continue                        # variant 0 = ADX8 / EMA40
        t = int(BK.server_to_utc(ts(r["entry_t"], "%Y.%m.%d %H:%M")))
        x = L.get(t)
        if x is None: continue
        n += 1
        d["adx"].append(float(r["adx"]) - x["adx"]); d["ema"].append(float(r["ema"]) - x["ema"])
        d["dip"].append(float(r["dip"]) - x["di_plus"]); d["dim"].append(float(r["dim"]) - x["di_minus"])
        d["atr"].append(float(r["atr"]) - x["atr"]); d["ref"].append(float(r["close1"]) - x["ref_px"])
for k, v in d.items():
    a = np.abs(np.array(v)); tol = {"atr": 1e-4, "ref": 1e-6}.get(k, 1e-3)
    rep(f"  {k:4s}: {n} signals, |diff| max {a.max():.2e} p99 {np.percentile(a, 99):.2e}", n > 1000 and a.max() <= tol)

print("F) SL/TP levels, exit reason, partial closes vs MT5 reports (2024-04-16 .. 2025-12-29)")
def parse(path):
    raw = open(path, "rb").read(); txt = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "ignore")
    def table(title, stop=None):
        s = txt.find(f"<b>{title}</b>"); e = txt.find("</table>", s)
        if stop:
            k = txt.find(f"<b>{stop}</b>", s + 1)
            if 0 < k < e: e = k
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", txt[s:e], re.S):
            c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(c) >= 11 and c[0][:1].isdigit(): yield c
    num = lambda s: float(s.replace(" ", "").replace("\xa0", "")) if s else float("nan")
    orders = {c[1]: (num(c[6]), num(c[7])) for c in table("Orders", "Deals")}
    pos, cur = [], None
    for c in table("Deals"):
        if len(c) < 13 or c[2] == "": continue
        t = ts(c[0], "%Y.%m.%d %H:%M:%S")
        if c[4] == "in":
            if cur: pos.append(cur)
            sl, tp = orders.get(c[7], (float("nan"), float("nan")))
            cur = dict(t=t // 60 * 60, sl=sl, tp=tp, outs=[])
        elif c[4] == "out" and cur: cur["outs"].append(c[12])
    if cur: pos.append(cur)
    return pos
LO, HI = BK.utc_ts("2024-04-16"), BK.utc_ts("2025-12-30")
RUNS = {"v_m1_a8e40_l": (1, 8, 40, 29, 9.2, 8, "L"), "v_m1_a14e5_t3": (1, 14, 5, 0, 0, 4, "T3"), "v_m3_a14e5_t3": (3, 14, 5, 0, 0, 4, "T3"),
        "v_m3_a28e40_l": (3, 28, 40, 29, 9.2, 12, "L"), "v_m5_a8e40_l": (5, 8, 40, 29, 9.2, 8, "L"), "v_m5_a28e5_t3": (5, 28, 5, 0, 9.2, 12, "T3")}
for name, p in RUNS.items():
    Lr = rows(set_id(*p)); M = {int(BK.server_to_utc(q["t"])): q for q in parse(os.path.join(REP, f"diag_{name}.htm"))}
    both = [k for k in set(Lr) & set(M) if LO <= k < HI]
    dsl = np.array([abs(M[k]["sl"] - round(Lr[k]["sl_px"], 3)) for k in both])
    dtp = np.array([abs(M[k]["tp"] - round(Lr[k]["tp3_px"], 3)) for k in both])
    def kind(o): return "sl" if o.startswith("sl") else "tp" if o.startswith("tp") else "other"
    r_bad = sum({1: "sl", 2: "tp"}.get(Lr[k]["exit_reason"], "other") != kind(M[k]["outs"][-1]) for k in both)
    # ladder: partial closes are the extra out-deals before the last one
    p_bad = sum((Lr[k]["hit_tp1"] + Lr[k]["hit_tp2"]) != len(M[k]["outs"]) - 1 for k in both) if p[6] == "L" else 0
    ok = dsl.max() <= 0.0015 and dtp.max() <= 0.0015 and r_bad <= max(2, 0.002 * len(both)) and p_bad <= max(2, 0.002 * len(both))
    rep(f"  {name}: {len(both)} trades | SL |diff| max {dsl.max():.4f} | TP max {dtp.max():.4f} | exit-reason mismatch {r_bad}"
        + (f" | partial-close count mismatch {p_bad}" if p[6] == "L" else ""), ok)
print("RESULT:", "audit part 2 passed" if bad == 0 else f"{bad} check(s) failed")
