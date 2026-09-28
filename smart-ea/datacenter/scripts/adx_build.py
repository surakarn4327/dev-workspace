r"""Phase 1: build the AdxEmaVol trade library adx_trades.sqlite (separate from gold_dc.sqlite).

Grid (agreed with the user 2026-09-28): TF M1/M3/M5 x ADX 8/14/28 x EMA 5/40 x MinADX 0/29 x DI gap 0/9.2 x SL 4/8/12 ATR
x exit ladder 15/17/21 ATR ('L') or single TP 3R ('T3') = 432 sets. ATR 84. Rules = AdxEmaVol V1 without the
"no new entry N min before cutoff" rule: start 23:00 server, cutoff 16:00 server, one position at a time, no re-entry rule.
Period: entries from LIB_FROM to the last bar (UTC). Indicators are warmed up from WARM_FROM. Trades whose exit is not yet
known (data ends while the trade is open, exit_reason 4) are NOT stored — they are completed on the next rebuild.
Usage: python adx_build.py            (writes adx_trades.sqlite next to gold_dc.sqlite)"""
import os, sys, sqlite3, time, json, itertools
import numpy as np
import broker as BK, adx_lib as A
from dc_sessions import sessions

# The library holds ALL data up to the latest bars (user 2026-09-28: the library grows every month). Anything that makes decisions
# (Strategy Selector, walk-forward tests) must read it through adx_asof.py so it only sees trades closed before its decision time.
LIB_FROM, WARM_FROM = "2024-04-15", "2024-02-01"
LIB_TO = os.environ.get("ADX_LIB_TO", "2099-01-01")   # exclusive; default = up to the last bar in the bars file
TFS, ADXS, EMAS, MINADX, GAPS, SLS, EXITS = (1, 3, 5), (8, 14, 28), (5, 40), (0.0, 29.0), (0.0, 9.2), (4.0, 8.0, 12.0), ("L", "T3")
START_H, CUTOFF_H, NO_ENTRY_MIN = 23, 16, 0
VOL_THR, VOL_LOW, VOL_HIGH = 0.90, 0.5, 1.5
# standard cost per trade in price units, replacing the bar spread paid in r_raw. Measured 2026-09-28 with adx_verify.py on
# MT5 REAL TICKS 2026-01-05..06-30 (3 sets, 1,766 matched trades): bar spread median $0.28 + extra fill cost median $0.016-0.038
# -> $0.31 (per-trade comparison only, no totals looked at). Bar spread in 2024-25 is a fixed 0.16, not the real cost.
COST_STD = float(os.environ.get("ADX_COST_STD", "0.31"))
OUT = os.environ.get("ADX_OUT") or os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite")

COLS = [  # name, sql type, description (Thai) — stored in table `columns`
 ("set_id", "INTEGER", "รหัสชุดพารามิเตอร์ (ดูตาราง params)"),
 ("n", "INTEGER", "ลำดับไม้ในชุดนั้น เริ่ม 1"),
 ("sig_t", "INTEGER", "เวลาเปิดของแท่งสัญญาณ (แท่ง TF ที่ปิดแล้วและเกิดการตัด) UTC epoch วินาที"),
 ("entry_t", "INTEGER", "เวลาเข้าไม้ = เวลาเปิดแท่ง M1 แรกของแท่ง TF ถัดไป UTC epoch วินาที"),
 ("exit_t", "INTEGER", "เวลาเปิดของแท่ง M1 ที่ไม้ปิด (ทั้งไม้ รวมส่วนสุดท้าย) UTC epoch วินาที"),
 ("day", "INTEGER", "วันเทรดมาตรฐาน 17:00 นิวยอร์ก ของเวลาเข้าไม้ = จำนวนวันนับจาก 1970-01-01 ของวันที่เริ่มหลัง 17:00 ET (คีย์เดียวกับตาราง days ใน gold_dc.sqlite; แปลงเป็นวันที่: date(1970,1,1)+day วัน)"),
 ("dir", "INTEGER", "ทิศไม้ +1 BUY / -1 SELL (+DI > -DI = BUY)"),
 ("adx", "REAL", "ADX ของแท่งสัญญาณ"),
 ("ema", "REAL", "EMA ของ ADX ที่แท่งสัญญาณ"),
 ("di_plus", "REAL", "+DI ของแท่งสัญญาณ"),
 ("di_minus", "REAL", "-DI ของแท่งสัญญาณ"),
 ("atr", "REAL", "ATR84 ของ TF ที่แท่งสัญญาณ (หน่วยราคา $)"),
 ("ref_px", "REAL", "ราคาปิดแท่งสัญญาณ (Bid) ใช้คำนวณ SL/TP"),
 ("entry_px", "REAL", "ราคาเข้า: BUY = Ask (open + spread แท่ง), SELL = Bid (open)"),
 ("sl_px", "REAL", "SL ที่ส่ง broker (SELL บวก spread ตอนเข้าแล้ว)"),
 ("tp1_px", "REAL", "TP1 (ladder) หรือ TP เดียว (T3) — SELL บวก spread แล้ว"),
 ("tp2_px", "REAL", "TP2 (ladder) หรือเท่า TP เดียว"),
 ("tp3_px", "REAL", "TP3 ที่ส่ง broker (ladder) หรือ TP เดียว"),
 ("risk_px", "REAL", "ระยะเสี่ยง |entry - SL ก่อนบวก spread| (หน่วยราคา $) = 1R"),
 ("spread_entry", "REAL", "spread ของแท่ง M1 ที่เข้าไม้ ($) — ปี 2024-25 เป็นค่าตายตัวของ broker ไม่ใช่ต้นทุนจริง"),
 ("exit_px", "REAL", "ราคาปิดส่วนสุดท้ายของไม้"),
 ("exit_reason", "INTEGER", "1 = SL, 2 = TP (TP3/TP เดียว), 3 = cutoff 16:00 server, 4 = ข้อมูลหมด"),
 ("hit_tp1", "INTEGER", "ladder: ปิด 1/3 ที่ TP1 แล้ว (0/1); T3: 1 เมื่อถึง TP"),
 ("hit_tp2", "INTEGER", "ladder: ปิด 1/3 ที่ TP2 แล้ว (0/1); T3: 1 เมื่อถึง TP"),
 ("r_raw", "REAL", "ผลเป็น R แบบเดียวกับ MT5 (spread ในแท่ง, ไม่คิด swap/ปัดเศษ lot) — ตรวจกับ MT5 ไม้ต่อไม้แล้ว"),
 ("r_std", "REAL", "ผลเป็น R หลังหักต้นทุนมาตรฐาน: r_raw - (COST_STD - spread_entry) / risk_px (COST_STD ดูตาราง meta)"),
 ("mfe_r", "REAL", "ราคาวิ่งไปทางกำไรสูงสุดระหว่างถือ (R, จากราคาเข้า, ราคาฝั่งที่ใช้ปิด)"),
 ("mae_r", "REAL", "ราคาวิ่งสวนสูงสุดระหว่างถือ (R)"),
 ("hold_min", "INTEGER", "นาทีที่ถือ = (exit_t - entry_t) / 60"),
 ("vol_ratio", "REAL", "tick volume เฉลี่ย 10 แท่ง TF ที่ปิดแล้ว ÷ เฉลี่ย 1440 แท่ง TF (แบบ EA; -1 = ข้อมูลไม่พอ หรือหน้าต่างคร่อมข้อมูลแบนก่อน data_start ของ broker)"),
 ("vol_mult", "REAL", "ตัวคูณขนาดไม้ตาม volume ของ AdxEmaVol (< 0.90 → 0.5, ≥ 0.90 → 1.5, ข้อมูลไม่พอ → 1) — ไม่ได้คูณใน r_raw/r_std"),
]
PCOLS = [("set_id", "INTEGER", "รหัสชุด"), ("tf", "INTEGER", "TF ที่ใช้คำนวณสัญญาณ (นาที) 1/3/5"), ("adx_p", "INTEGER", "ADX period"),
 ("ema_p", "INTEGER", "EMA period ของเส้น ADX"), ("min_adx", "REAL", "ADX ขั้นต่ำ"), ("min_gap", "REAL", "|+DI - -DI| ขั้นต่ำ"),
 ("sl_atr", "REAL", "SL เป็นเท่าของ ATR84"), ("exit_mode", "TEXT", "L = ladder TP 15/17/21 ATR ปิด 1/3 ที่ TP1/TP2; T3 = TP เดียวที่ 3 เท่าระยะ SL"),
 ("atr_p", "INTEGER", "ATR period (84)"), ("n_trades", "INTEGER", "จำนวนไม้ในคลังของชุดนี้")]

def utc(s): return BK.utc_ts(s)

def main():
    t0 = time.time()
    # server clock bounds (Exness server = UTC; for other brokers the bars file is in server time -> widen by a day)
    M = A.load_m1(utc(WARM_FROM) - 86400, utc(LIB_TO))     # bars strictly before LIB_TO: the build never sees later data
    mk = A.Market(M, START_H, CUTOFF_H, NO_ENTRY_MIN)
    tu = BK.server_to_utc(M["t"]); lo, hi = utc(LIB_FROM), utc(LIB_TO)
    _, day_all, _ = sessions(tu)
    if os.path.exists(OUT): os.remove(OUT)
    db = sqlite3.connect(OUT)
    db.execute("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)")
    db.execute("CREATE TABLE columns (tbl TEXT, name TEXT, type TEXT, description TEXT)")
    db.execute("CREATE TABLE params (" + ", ".join(f"{c} {t}" for c, t, _ in PCOLS) + ")")
    db.execute("CREATE TABLE trades (" + ", ".join(f"{c} {t}" for c, t, _ in COLS) + ")")
    db.executemany("INSERT INTO columns VALUES (?,?,?,?)", [("params", *c) for c in PCOLS] + [("trades", *c) for c in COLS])
    meta = dict(broker=BK.NAME, symbol=BK.SYMBOL, lib_from_utc=LIB_FROM, lib_to_utc_excl=LIB_TO, warm_from=WARM_FROM,
                last_bar_utc=time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(tu[-1]))),
                read_rule="decisions at time T may only use trades fully closed before T: exit_t + 60 <= T (use adx_asof.py)",
                start_server_hour=START_H, cutoff_server_hour=CUTOFF_H, no_entry_before_cutoff_min=NO_ENTRY_MIN,
                ladder_atr=list(A.LADDER), atr_period=A.ATR_P, cost_std_price=COST_STD, vol_rule=[VOL_THR, VOL_LOW, VOL_HIGH],
                time="UTC epoch seconds", simulator="adx_lib.py (MT5 every-tick-generated equivalent, see CLAUDE.md phase 1)",
                built_utc=time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()))
    db.executemany("INSERT INTO meta VALUES (?,?)", [(k, json.dumps(v) if not isinstance(v, str) else v) for k, v in meta.items()])
    sid = 0
    for tf, ap, ep in itertools.product(TFS, ADXS, EMAS):
        S = A.signals(mk, tf, ap, ep); cache = {}
        for ma, gp, sl, ex in itertools.product(MINADX, GAPS, SLS, EXITS):
            sid += 1
            rows = []
            for T in A.run_set(mk, S, ma, gp, sl, ex, cache):
                e = T["e"]
                if not (lo <= tu[e] < hi) or T["reason"] == 4: continue   # reason 4 = still open at data end
                j = T["j"]; vr = float(S["vol_ratio"][j])
                if BK.server_to_utc(S["vol_base_t"][j]) < BK.T0: vr = -1.0   # base window reaches into the unusable (flat) data
                vm = 1.0 if vr < 0 else (VOL_LOW if vr < VOL_THR else VOL_HIGH)
                r_std = T["r"] - (COST_STD - T["sp_entry"]) / T["risk"] if T["risk"] > 0 else 0.0
                rows.append((sid, len(rows) + 1, int(BK.server_to_utc(S["sig_t"][j])), int(tu[e]), int(tu[T["exit_i"]]), int(day_all[e]),
                             T["d"], float(S["adx"][j]), float(S["ema"][j]), float(S["pdi"][j]), float(S["ndi"][j]), float(S["atr"][j]),
                             float(S["ref"][j]), T["entry"], T["sl"], T["tp1"], T["tp2"], T["tp3"], T["risk"], T["sp_entry"], T["exit_px"],
                             T["reason"], int(T["hit1"]), int(T["hit2"]), T["r"], r_std, T["mfe_r"], T["mae_r"],
                             int((tu[T["exit_i"]] - tu[e]) // 60), vr, vm))
            db.executemany("INSERT INTO trades VALUES (" + ",".join("?" * len(COLS)) + ")", rows)
            db.execute("INSERT INTO params VALUES (?,?,?,?,?,?,?,?,?,?)", (sid, tf, ap, ep, ma, gp, sl, ex, A.ATR_P, len(rows)))
        db.commit()
        print(f"TF M{tf} ADX{ap} EMA{ep}: {len(S['k'])} signals, sets up to {sid}, {time.time() - t0:.0f}s", flush=True)
    db.execute("CREATE INDEX ix_trades ON trades(set_id, entry_t)"); db.execute("CREATE INDEX ix_day ON trades(day)")
    db.commit(); db.close()
    print("done", OUT, f"{time.time() - t0:.0f}s")
    # phase 2: this file is recreated from scratch, so the ctx table (market context at entry) must be rebuilt right away, otherwise it
    # silently disappears. Only for the main library (test builds with ADX_OUT / ADX_LIB_TO are not used for decisions).
    if not os.environ.get("ADX_OUT") and "ADX_LIB_TO" not in os.environ:
        import adx_ctx
        adx_ctx.build()

if __name__ == "__main__":
    main()
