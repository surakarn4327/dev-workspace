r"""Phase 3B-a: build adx_hold.sqlite = library of decision points while a trade is open (definitions: hold_lib.py docstring).

Tables: meta, columns (Thai description of every column), utrades (unique trades), set_map (set_id, n -> uid), dec (one row per unique
trade x decision bar), ctx_dec (market context at every decision time, same 192 columns as table ctx of adx_trades.sqlite), view dec_v
(event bits as named 0/1 columns + r_half).
Resumable: every month (by TRADING day of the entry) is written in one transaction together with its 'done' mark, ctx_dec in chunks the
same way; a stopped run continues where it stopped. Sandbox only: bars before 2026-06-01 are the only bars ever loaded.
Usage:  python hold_build.py            (full build / resume, file adx_hold.sqlite next to adx_trades.sqlite)
        python hold_build.py --fresh    (delete and rebuild)
Env HOLD_OUT = other file, HOLD_MONTHS = comma list 'YYYY-MM' (small test build)."""
import os, sys, sqlite3, time, json, datetime
import numpy as np
import broker as BK, adx_ctx as X, hold_lib as H

DBT = X.DBT
OUT = os.environ.get("HOLD_OUT") or os.path.join(os.path.dirname(DBT), "adx_hold.sqlite")
ONLY = [m for m in os.environ.get("HOLD_MONTHS", "").split(",") if m]
CTX_CHUNK = 60000

UCOLS = [("uid", "INTEGER", "รหัสไม้ไม่ซ้ำ (ไม้ของหลายชุดที่ต่างกันแค่ตัวกรอง MinADX/DI gap แต่เข้าเวลา/ทิศ/ระดับเดียวกัน = ไม้เดียวกัน)"),
 ("tf", "INTEGER", "TF ของไม้ (นาที) 1/3/5 = TF ที่ใช้หาเหตุการณ์ระหว่างถือด้วย"),
 ("exit_mode", "TEXT", "L = ladder TP 15/17/21 ATR ปิด 1/3 ที่ TP1/TP2; T3 = TP เดียว 3R"),
 ("entry_t", "INTEGER", "เวลาเข้าไม้ UTC epoch วินาที (= trades.entry_t)"), ("exit_t", "INTEGER", "เวลาปิดไม้ตามแผน (= trades.exit_t)"),
 ("day", "INTEGER", "วันเทรด 17:00 นิวยอร์ก (= trades.day)"), ("dir", "INTEGER", "ทิศไม้ +1 BUY / -1 SELL"),
 ("entry_px", "REAL", "ราคาเข้า (= trades.entry_px)"), ("sl_px", "REAL", "SL ที่ broker (= trades.sl_px)"),
 ("tp1_px", "REAL", "TP1 (= trades.tp1_px)"), ("tp2_px", "REAL", "TP2 (= trades.tp2_px)"), ("tp3_px", "REAL", "TP3 / TP เดียว (= trades.tp3_px)"),
 ("risk_px", "REAL", "1R เป็นราคา (= trades.risk_px)"), ("spread_entry", "REAL", "spread แท่งที่เข้าไม้ (= trades.spread_entry)"),
 ("exit_reason", "INTEGER", "เหตุผลปิดตามแผน 1 SL / 2 TP / 3 cutoff (= trades.exit_reason)"),
 ("r_std", "REAL", "ผลตามแผนหลังหักต้นทุนมาตรฐาน (= trades.r_std) — ตัวจำลองของตารางนี้คำนวณซ้ำได้เท่ากันทุกไม้ (ตรวจใน hold_build/hold_check)"),
 ("n_sets", "INTEGER", "จำนวนแถวใน trades (ชุด × ไม้) ที่เป็นไม้นี้ (ดู set_map)"),
 ("n_dec", "INTEGER", "จำนวนจุดตัดสินที่เก็บของไม้นี้ (แถวใน dec)")]
MCOLS = [("set_id", "INTEGER", "รหัสชุดพารามิเตอร์ (ตาราง params ใน adx_trades.sqlite)"), ("n", "INTEGER", "ลำดับไม้ในชุด (= trades.n)"),
 ("uid", "INTEGER", "ไม้ไม่ซ้ำใน utrades — จับคู่ trades (set_id, n) → uid เพื่อเอาจุดตัดสินไปใช้กับทุกชุด")]
DCOLS = [("uid", "INTEGER", "ไม้ (utrades.uid)"),
 ("dec_t", "INTEGER", "เวลาตัดสิน UTC epoch = เวลาเปิดแท่ง M1 แรกหลังแท่ง TF นี้ปิด (tick แรกหลังปิดแท่ง เหมือนจังหวะเข้าไม้) — คีย์จับคู่ ctx_dec.dec_t"),
 ("bar_n", "INTEGER", "แท่ง TF ของไม้ที่เพิ่งปิดเป็นแท่งที่เท่าไรนับจากแท่งที่เข้าไม้ (1 = แท่งเข้าไม้ปิดแล้ว)"),
 ("flags", "INTEGER", "bitmask เหตุการณ์ของแท่งนี้: " + ", ".join(f"{1 << i} {n}" for i, n in enumerate(H.EV)) + " (ดูคอลัมน์ ev_* ใน view dec_v)"),
 ("ev_big_dir", "INTEGER", "ทิศแท่งใหญ่ +1 ปิดขึ้น / -1 ปิดลง / 0 = ไม่มีแท่งใหญ่ (ค่าจริง ไม่เทียบทิศไม้; คูณ utrades.dir เพื่อดูตาม/สวนไม้)"),
 ("ev_pin_dir", "INTEGER", "ทิศ pinbar +1 ไส้ล่างยาว (ปฏิเสธราคาต่ำ) / -1 ไส้บนยาว / 0 = ไม่มี"),
 ("ev_piv_dir", "INTEGER", "pivot ใหม่ยืนยัน: ทิศขาใหม่ +1 ขึ้น (ยืนยัน low) / -1 ลง (ยืนยัน high) / 0 = ไม่มี"),
 ("ev_reg_new", "INTEGER", "สภาพตลาดใหม่เมื่อป้ายเปลี่ยน +1 ขึ้น / -1 ลง / 0 sideway (อ่านคู่ bit regime; ไม่มีเหตุการณ์ = 0 เช่นกัน)"),
 ("ev_box_dir", "INTEGER", "หลุดกรอบ sideway +1 ขึ้น / -1 ลง / 0 = ไม่มี"),
 ("held_min", "INTEGER", "ถือมาแล้วกี่นาที = (dec_t − entry_t) / 60"),
 ("min_to_cut", "INTEGER", "นาทีที่เหลือถึง cutoff ของ EA ตามนาฬิกา (16:00 เวลา server ถัดไป) = ctx_dec.t_min_cutoff (วันตลาดปิดเร็ว ไม้จริงจะถูกปิดที่แท่งสุดท้ายก่อนหน้านั้น)"),
 ("n_tp_hit", "INTEGER", "ladder: ปิดไปแล้วกี่ส่วนที่ TP1/TP2 ก่อนหรือที่ tick ตัดสิน (0-2); T3 = 0"),
 ("rem", "REAL", "สัดส่วนไม้ที่ยังเปิดอยู่ (1, 2/3, 1/3)"),
 ("realized_r", "REAL", "กำไรที่ปิดไปแล้ว (TP1/TP2) เป็น R ของไม้เต็ม ยังไม่หักต้นทุน"),
 ("open_r", "REAL", "ราคา ณ tick ตัดสิน (ฝั่งที่ใช้ปิด: BUY Bid / SELL Ask) ห่างจากราคาเข้ากี่ R (บวก = กำไรลอย) ต่อไม้เต็ม 1 หน่วย; ส่วนที่เปิดอยู่จริง = open_r × rem"),
 ("mfe_r", "REAL", "ราคาวิ่งไปทางกำไรสูงสุดตั้งแต่เข้าไม้ถึง tick ตัดสิน (R)"),
 ("mae_r", "REAL", "ราคาวิ่งสวนสูงสุดตั้งแต่เข้าไม้ถึง tick ตัดสิน (R)"),
 ("dist_sl_r", "REAL", "ระยะจากราคา ณ tick ตัดสินถึง SL (R, บวก = ยังไม่ถึง)"),
 ("dist_tp_r", "REAL", "ระยะจากราคา ณ tick ตัดสินถึง TP ถัดไปที่ยังไม่ถึง (R)"),
 ("r_plan", "REAL", "[ผลลัพธ์ = อนาคต ห้ามใช้เป็นตัวบอก] ถือตามแผนต่อ — ต้องเท่า utrades.r_std ทุกแถว (ตัวตรวจ)"),
 ("r_cut", "REAL", "[ผลลัพธ์] ปิดส่วนที่เหลือทันทีที่ tick ตัดสิน (BUY ที่ Bid / SELL ที่ Ask) รวมส่วนที่ปิดไปแล้ว หักต้นทุนแบบ r_std"),
 ("r_be", "REAL", "[ผลลัพธ์] ย้าย SL ของส่วนที่เหลือมาที่ราคาเข้า (TP เดิม) — เฉพาะเมื่อ open_r > 0 ไม่งั้น NULL"),
 ("r_hold", "REAL", "[ผลลัพธ์] เอา TP ที่ยังไม่ถึงออกทั้งหมด ถือจนโดน SL เดิมหรือ cutoff"),
 ("be_exit_t", "INTEGER", "[ผลลัพธ์] เวลาเปิดแท่ง M1 ที่ไม้ปิดหมดในทางเลือก BE (NULL เมื่อ r_be เป็น NULL)"),
 ("be_reason", "INTEGER", "[ผลลัพธ์] ทางเลือก BE ปิดด้วย 1 SL(ที่ทุน) / 2 TP / 3 cutoff"),
 ("hold_exit_t", "INTEGER", "[ผลลัพธ์] เวลาเปิดแท่ง M1 ที่ไม้ปิดในทางเลือกถือยาว"),
 ("hold_reason", "INTEGER", "[ผลลัพธ์] ทางเลือกถือยาวปิดด้วย 1 SL / 3 cutoff")]
VIEW_EXTRA = [("ev_" + n, "INTEGER", "1 = " + H.EV_DESC[n]) for n in H.EV] + \
             [("r_half", "REAL", "[ผลลัพธ์] ปิดครึ่งหนึ่งของส่วนที่เหลือทันที อีกครึ่งถือตามแผน = (r_cut + r_plan) / 2 พอดี (กำไรเป็นเส้นตรงตามขนาดไม้)")]

def month_of(day): return (datetime.date(1970, 1, 1) + datetime.timedelta(days=int(day))).strftime("%Y-%m")

def load_trades():
    db = sqlite3.connect(DBT)
    P = {r[0]: (r[1], r[2]) for r in db.execute("SELECT set_id, tf, exit_mode FROM params")}
    meta = dict(db.execute("SELECT k, v FROM meta").fetchall())
    q = ("SELECT set_id, n, entry_t, exit_t, day, dir, entry_px, sl_px, tp1_px, tp2_px, tp3_px, risk_px, spread_entry, exit_reason, r_std "
         "FROM trades WHERE entry_t >= ? AND exit_t + 60 <= ? AND day < ? ORDER BY entry_t, set_id")
    rows = db.execute(q, (H.LIB_FROM, H.SANDBOX_END, H.END_DAY)).fetchall(); db.close()
    U = {}; smap = []
    for r in rows:
        tf, ex = P[r[0]]
        key = (tf, ex, r[2], r[5], r[7], r[8], r[10])
        if key not in U: U[key] = [tf, ex] + list(r[2:]) + [0]
        else:
            u = U[key]
            assert u[3] == r[3] and u[5 + 6] == r[11] and abs(u[14] - r[14]) < 1e-12, f"sets disagree on the same trade {key}"
        U[key][-1] += 1; smap.append((r[0], r[1], key))
    keys = sorted(U, key=lambda k: (U[k][2], U[k][0], U[k][1], U[k][5], U[k][6]))
    uid = {k: i + 1 for i, k in enumerate(keys)}
    ut = [[uid[k]] + U[k] for k in keys]          # uid, tf, ex, entry_t, exit_t, day, dir, entry, sl, tp1, tp2, tp3, risk, sp, reason, r_std, n_sets
    return ut, [(s, n, uid[k]) for s, n, k in smap], float(meta["cost_std_price"]), int(meta["cutoff_server_hour"])

def create(db, ut, smap, cost):
    db.execute("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)")
    db.execute("CREATE TABLE columns (tbl TEXT, name TEXT, type TEXT, description TEXT)")
    for name, cols in (("utrades", UCOLS), ("set_map", MCOLS), ("dec", DCOLS)):
        db.execute(f"CREATE TABLE {name} (" + ", ".join(f"{c} {t}" for c, t, _ in cols) + ")")
        db.executemany("INSERT INTO columns VALUES (?,?,?,?)", [(name, *c) for c in cols])
    db.executemany("INSERT INTO columns VALUES (?,?,?,?)", [("dec_v", *c) for c in VIEW_EXTRA])
    db.executemany("INSERT INTO utrades VALUES (" + ",".join("?" * len(UCOLS)) + ")", [u + [0] for u in ut])
    db.executemany("INSERT INTO set_map VALUES (?,?,?)", smap)
    db.execute("CREATE INDEX ix_map ON set_map(set_id, n)"); db.execute("CREATE UNIQUE INDEX ix_ut ON utrades(uid)")
    ev = ", ".join(f"((flags >> {i}) & 1) AS ev_{n}" for i, n in enumerate(H.EV))
    db.execute(f"CREATE VIEW dec_v AS SELECT *, {ev}, (r_cut + r_plan) / 2.0 AS r_half FROM dec")
    meta = dict(source=os.path.basename(DBT), sandbox_from_utc="2024-04-15", sandbox_end_utc_excl="2026-06-01",
                trade_filter="entry_t >= 2024-04-15, exit_t + 60 <= 2026-06-01, trading day < 2026-06-01", cost_std_price=cost,
                events=H.EV, check_n=H.CHECK_N, stand_min=H.STAND_MIN, zigzag_k=H.ZZ_K,
                time_rule="event bits / state columns / ctx_dec use data up to the decision tick only; r_* and *_exit_t / *_reason are outcomes (future)",
                built_by="hold_build.py (definitions in hold_lib.py)", started_utc=time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()))
    db.executemany("INSERT INTO meta VALUES (?,?)", [(k, json.dumps(v) if not isinstance(v, str) else v) for k, v in meta.items()])
    db.commit()

def month_rows(mk, EVT, trades, cost, CUT_H):
    """rows of table dec for a list of utrades rows; returns rows + {uid: n_dec}"""
    rows = []; nd = {}; tu = mk.tu; bad = 0
    for u in trades:
        uid, tf, ex, et, xt, day, d = u[:7]
        G = EVT[tf]; tO = G["B"]["t_open"]
        b0 = int(np.searchsorted(tO, et)); assert tO[b0] == et, "entry is not the first M1 bar of a TF bar"
        b1 = int(np.searchsorted(tO, xt, "right"))
        bb = np.arange(b0, b1); bar_n = bb - b0 + 1
        fl = G["flags"][bb] | np.where(bar_n % H.CHECK_N == 0, H.BIT["check"], 0)
        keep = (fl != 0) & (G["dec_t"][bb] > 0); bb, bar_n, fl = bb[keep], bar_n[keep], fl[keep]
        dt = G["dec_t"][bb]; di = np.searchsorted(tu, dt)
        e = int(np.searchsorted(tu, et)); assert tu[e] == et
        assert np.all(tu[np.minimum(di, len(tu) - 1)] == dt), "decision tick missing in the walk market"
        T = dict(e=e, dir=d, entry_px=u[7], sl_px=u[8], tp1_px=u[9], tp2_px=u[10], tp3_px=u[11], risk_px=u[12], spread_entry=u[13], ladder=(ex == "L"))
        r0, O = H.trade_rows(mk, T, di, cost)
        if abs(r0 - u[15]) > 1e-9: bad += 1
        ok = O["ok"]; nd[uid] = int(ok.sum())
        if not ok.any(): continue
        if np.max(np.abs(O["r_plan"] - u[15])) > 1e-9: bad += 1
        bb, bar_n, fl, dt = bb[ok], bar_n[ok], fl[ok], dt[ok]
        # minutes to the EA cutoff by the CLOCK (next CUT_H:00 server), like ctx.t_min_cutoff — not by the next bar outside the trading
        # hours, which on an early-close holiday would reveal the closure before it happens
        off = dt - BK.server_to_utc(dt); serv = dt + off
        nxt = (serv // 86400) * 86400 + CUT_H * 3600; nxt = np.where(nxt <= serv, nxt + 86400, nxt); Dv = G["dirs"]
        be_ok = O["be_exit_i"] >= 0                                       # BE applicable (in profit at the decision tick)
        nul = lambda a: [x if k else None for x, k in zip(a.tolist(), be_ok.tolist())]
        cols = [np.full(len(bb), uid), dt, bar_n, fl, Dv["big"][bb], Dv["pin"][bb], Dv["piv"][bb], Dv["reg"][bb], Dv["box"][bb],
                (dt - et) // 60, (nxt - serv) // 60, O["n_tp_hit"], O["rem"], O["realized_r"], O["open_r"], O["mfe_r"], O["mae_r"],
                O["dist_sl_r"], O["dist_tp_r"], O["r_plan"], O["r_cut"], O["r_be"], O["r_hold"],
                tu[np.clip(O["be_exit_i"], 0, None)], O["be_reason"], tu[O["hold_exit_i"]], O["hold_reason"]]
        L = [c.tolist() for c in cols]
        L[21] = nul(O["r_be"]); L[23] = nul(cols[23]); L[24] = nul(cols[24])
        rows.extend(zip(*L))
    return rows, nd, bad

def write_ctx(db, M, cost, cut_h, log):
    done = {r[0] for r in db.execute("SELECT k FROM meta WHERE k LIKE 'ctx_chunk_%'")}
    Dt = np.array([r[0] for r in db.execute("SELECT DISTINCT dec_t FROM dec ORDER BY dec_t")], dtype=np.int64)
    exists = db.execute("SELECT name FROM sqlite_master WHERE name='ctx_dec'").fetchone()
    for ci, a in enumerate(range(0, len(Dt), CTX_CHUNK)):
        key = f"ctx_chunk_{ci}"
        if key in done: continue
        E = Dt[a:a + CTX_CHUNK]; t0 = time.time()
        C, Dd, dE, i1 = X.compute(E, M, cost, cut_h, log=lambda *x: None)
        order = X.column_order(C)
        if not exists:
            base = [("dec_t", "INTEGER", "เวลาตัดสิน (UTC epoch) = คีย์จับคู่ dec.dec_t; ทุกค่าในแถวใช้เฉพาะข้อมูลก่อนเวลานี้ (กติกาเดียวกับตาราง ctx)"),
                    ("day", "INTEGER", "วันเทรดมาตรฐานของเวลาตัดสิน"), ("m1_last_t", "INTEGER", "เวลาเปิดแท่ง M1 ล่าสุดที่ใช้ (≤ dec_t − 60)")]
            db.execute("CREATE TABLE ctx_dec (" + ", ".join(f"{x} {y}" for x, y, _ in base) + ", " + ", ".join(f"{x} {C[x][1]}" for x in order) + ")")
            db.executemany("INSERT INTO columns VALUES ('ctx_dec',?,?,?)", base + [(x, C[x][1], Dd[x].replace("เวลาเข้าไม้", "เวลาตัดสิน").replace("ก่อนเข้าไม้", "ก่อนเวลาตัดสิน")
                                                                                     + " [ณ เวลาตัดสิน dec_t; นิยามเดียวกับตาราง ctx]") for x in order])
            exists = True
        cols = [E, dE, M["t"][i1]] + [C[x][0] for x in order]; kinds = ["INTEGER"] * 3 + [C[x][1] for x in order]
        L = [[None if v != v else (int(v) if k == "INTEGER" else v) for v in c.tolist()] for c, k in zip(cols, kinds)]
        rows = list(zip(*L))
        db.executemany("INSERT INTO ctx_dec VALUES (" + ",".join("?" * len(cols)) + ")", rows)
        db.execute("INSERT INTO meta VALUES (?, ?)", (key, str(len(E))))
        db.commit()
        log(f"ctx_dec chunk {ci}: {len(E)} times, {time.time() - t0:.0f}s")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_ctx_dec ON ctx_dec(dec_t)"); db.commit()

def main(log=print):
    t0 = time.time()
    if "--fresh" in sys.argv and os.path.exists(OUT): os.remove(OUT)
    ut, smap, cost, cut_h = load_trades()
    fresh = not os.path.exists(OUT)
    db = sqlite3.connect(OUT)
    if fresh: create(db, ut, smap, cost)
    else:
        n_old = db.execute("SELECT COUNT(*) FROM utrades").fetchone()[0]
        if n_old != len(ut): raise RuntimeError("adx_trades.sqlite changed since this file was started -> run with --fresh")
    log(f"unique trades {len(ut)}, trade rows {len(smap)}, {time.time() - t0:.0f}s")
    M = H.load_ctx_bars(); SLv = H.sessions_levels(M)
    EVT = {tf: H.tf_events(M, tf, SLv) for tf in H.TFS}
    mk = H.walk_market()
    log(f"events + market ready {time.time() - t0:.0f}s")
    by_m = {}
    for u in ut: by_m.setdefault(month_of(u[5]), []).append(u)
    months = sorted(by_m)
    if ONLY: months = [m for m in months if m in ONLY]
    done = {r[0][5:] for r in db.execute("SELECT k FROM meta WHERE k LIKE 'done_%'")}
    for mo in months:
        if mo in done: continue
        t1 = time.time(); tr = by_m[mo]
        rows, nd, bad = month_rows(mk, EVT, tr, cost, cut_h)
        if bad: raise RuntimeError(f"{mo}: {bad} trades where the simulator does not reproduce r_std -> nothing written")
        db.executemany("INSERT INTO dec VALUES (" + ",".join("?" * len(DCOLS)) + ")", rows)
        db.executemany("UPDATE utrades SET n_dec = ? WHERE uid = ?", [(v, k) for k, v in nd.items()])
        db.execute("INSERT INTO meta VALUES (?, ?)", ("done_" + mo, str(len(rows))))
        db.commit()
        log(f"{mo}: {len(tr)} trades, {len(rows)} rows, {time.time() - t1:.0f}s (total {time.time() - t0:.0f}s)")
    db.execute("CREATE INDEX IF NOT EXISTS ix_dec_uid ON dec(uid)"); db.execute("CREATE INDEX IF NOT EXISTS ix_dec_t ON dec(dec_t)"); db.commit()
    write_ctx(db, M, cost, cut_h, log)
    db.execute("INSERT OR REPLACE INTO meta VALUES ('finished_utc', ?)", (time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),)); db.commit()
    db.close(); log(f"done {OUT} {time.time() - t0:.0f}s")

if __name__ == "__main__":
    main()
