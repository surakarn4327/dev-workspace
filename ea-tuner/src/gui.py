"""หน้าต่างควบคุมหลักของ ea-tuner — Tkinter (มากับ Python อยู่แล้ว ไม่ต้องลง dependency เพิ่ม)"""
from __future__ import annotations

import queue
import threading
import webbrowser
from datetime import date, datetime
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk
import tkinter as tk

import config
import report
import runner


class SetEditor(tk.Toplevel):
    """หน้าต่างแก้ไฟล์ .set แบบ text ธรรมดา — ใช้แก้ risk mode / ช่วงค่าที่จะจูนได้ตรงๆ"""

    def __init__(self, master: tk.Tk, initial_name: str | None, on_saved):
        super().__init__(master)
        self.title("แก้ไฟล์ .set")
        self.geometry("560x520")
        self.on_saved = on_saved

        top = ttk.Frame(self, padding=8)
        top.pack(fill="x")
        ttk.Label(top, text="ชื่อไฟล์ (ไม่ต้องใส่ .set):").pack(side="left")
        self.name_var = tk.StringVar(value=initial_name or "")
        ttk.Entry(top, textvariable=self.name_var, width=40).pack(side="left", padx=6)

        self.text = scrolledtext.ScrolledText(self, wrap="none", font=("Consolas", 10))
        self.text.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        if initial_name:
            p = config.SETS_DIR / f"{initial_name}.set"
            if p.exists():
                self.text.insert("1.0", p.read_text(encoding="utf-8", errors="replace"))

        btns = ttk.Frame(self, padding=8)
        btns.pack(fill="x")
        ttk.Button(btns, text="บันทึก", command=self._save).pack(side="right")
        ttk.Button(btns, text="ยกเลิก", command=self.destroy).pack(side="right", padx=6)
        ttk.Label(
            btns,
            text="รูปแบบ: ชื่อ=ค่า ต่อบรรทัด · ช่วงค่าที่จะจูนใช้ ค่าเริ่ม||ค่าก้าว||ค่าสุด "
                 "(ดูตัวอย่างใน optimizer/sets/*.set เดิม)",
            foreground="#666",
        ).pack(side="left")

    def _save(self):
        name = self.name_var.get().strip()
        if not name:
            messagebox.showerror("ผิดพลาด", "ใส่ชื่อไฟล์ก่อน")
            return
        config.SETS_DIR.mkdir(parents=True, exist_ok=True)
        path = config.SETS_DIR / f"{name}.set"
        path.write_text(self.text.get("1.0", "end-1c") + "\n", encoding="utf-8")
        self.on_saved(name)
        self.destroy()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ea-tuner — จูน/ทดสอบ EA ของ smart-ea")
        self.geometry("880x720")

        self.eas = config.list_eas()
        self.log_queue: queue.Queue[str] = queue.Queue()
        self.worker: threading.Thread | None = None
        self.last_req: runner.RunRequest | None = None
        self.stage2_out_name: str | None = None  # ผลรอบตรวจสอบเพื่อนบ้าน (โหมด optimize เท่านั้น)
        self.holdout_out_name: str | None = None  # ผลรอบ holdout (โหมด optimize เท่านั้น)

        self._build_ui()
        self.after(100, self._poll_log)

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        pad = {"padx": 6, "pady": 4}
        top = ttk.Frame(self, padding=10)
        top.pack(fill="x")

        # แถว 1: EA + .set
        row1 = ttk.Frame(top)
        row1.pack(fill="x", **pad)
        ttk.Label(row1, text="EA:").pack(side="left")
        self.ea_var = tk.StringVar()
        ea_names = [e["name"] for e in self.eas]
        self.ea_combo = ttk.Combobox(row1, textvariable=self.ea_var, values=ea_names,
                                      state="readonly", width=32)
        if ea_names:
            self.ea_combo.current(0)
        self.ea_combo.pack(side="left", padx=(4, 16))

        ttk.Label(row1, text=".set:").pack(side="left")
        self.set_var = tk.StringVar()
        self.set_combo = ttk.Combobox(row1, textvariable=self.set_var,
                                       values=config.list_sets(), width=28)
        self.set_combo.pack(side="left", padx=4)
        ttk.Button(row1, text="แก้ไฟล์ .set", command=self._open_set_editor).pack(side="left", padx=4)
        ttk.Button(row1, text="รีเฟรชรายการ", command=self._refresh_lists).pack(side="left", padx=4)

        # แถว 2: symbol / period / model / deposit
        row2 = ttk.Frame(top)
        row2.pack(fill="x", **pad)
        ttk.Label(row2, text="สัญลักษณ์:").pack(side="left")
        self.symbol_var = tk.StringVar(value="XAUUSDc")
        ttk.Entry(row2, textvariable=self.symbol_var, width=12).pack(side="left", padx=(4, 16))

        ttk.Label(row2, text="TF:").pack(side="left")
        self.period_var = tk.StringVar(value="M15")
        ttk.Combobox(row2, textvariable=self.period_var, values=config.TIMEFRAMES,
                     state="readonly", width=6).pack(side="left", padx=(4, 16))

        ttk.Label(row2, text="โมเดล tick:").pack(side="left")
        self.model_var = tk.StringVar(value=config.MODELS[0][1])
        self.model_combo = ttk.Combobox(row2, textvariable=self.model_var,
                                         values=[m[1] for m in config.MODELS],
                                         state="readonly", width=30)
        self.model_combo.current(0)
        self.model_combo.pack(side="left", padx=(4, 16))

        ttk.Label(row2, text="เงินฝากตั้งต้น (USD):").pack(side="left")
        self.deposit_var = tk.StringVar(value="10000")
        ttk.Entry(row2, textvariable=self.deposit_var, width=10).pack(side="left", padx=4)

        # แถว 3: ช่วงวันที่
        row3 = ttk.Frame(top)
        row3.pack(fill="x", **pad)
        ttk.Label(row3, text="ตั้งแต่วันที่ (yyyy-mm-dd):").pack(side="left")
        self.from_var = tk.StringVar(value="2025-01-01")
        ttk.Entry(row3, textvariable=self.from_var, width=12).pack(side="left", padx=(4, 16))
        ttk.Label(row3, text="ถึงวันที่:").pack(side="left")
        self.to_var = tk.StringVar(value=date.today().isoformat())
        ttk.Entry(row3, textvariable=self.to_var, width=12).pack(side="left", padx=4)
        ttk.Label(
            row3,
            text="  โหมดความเสี่ยง (fixed USD / % equity) แก้ได้ในไฟล์ .set "
                 "(InpRiskMode/InpRiskPct/InpRiskFixedUsd) — กด 'แก้ไฟล์ .set' ด้านบน",
            foreground="#666",
        ).pack(side="left", padx=6)

        # แถว 4: โหมดรัน
        row4 = ttk.Frame(top)
        row4.pack(fill="x", **pad)
        ttk.Label(row4, text="โหมด:").pack(side="left")
        self.mode_var = tk.StringVar(value=config.RUN_MODES[0][0])
        for value, label in config.RUN_MODES:
            ttk.Radiobutton(row4, text=label, value=value, variable=self.mode_var).pack(side="left", padx=6)

        # แถว 4b: ตั้งค่าเฉพาะโหมดจูน — รันซ้ำกี่รอบ (เช็คความนิ่ง) + กันช่วงท้ายไว้ตรวจสอบกี่ %
        row4b = ttk.Frame(top)
        row4b.pack(fill="x", **pad)
        ttk.Label(row4b, text="(โหมดจูนเท่านั้น) รันซ้ำ genetic:").pack(side="left")
        self.reps_var = tk.StringVar(value="3")
        ttk.Entry(row4b, textvariable=self.reps_var, width=4).pack(side="left", padx=(4, 16))
        ttk.Label(row4b, text="รอบ · กันช่วงท้ายสุด (ล่าสุดเสมอ) ไว้ตรวจสอบ:").pack(side="left")
        self.holdout_var = tk.StringVar(value="20")
        ttk.Entry(row4b, textvariable=self.holdout_var, width=4).pack(side="left", padx=4)
        ttk.Label(row4b, text="% ของช่วงที่ขอ").pack(side="left")

        # แถว 5: ปุ่ม
        row5 = ttk.Frame(top)
        row5.pack(fill="x", **pad)
        self.run_btn = ttk.Button(row5, text="▶  รัน", command=self._on_run)
        self.run_btn.pack(side="left")
        self.status_var = tk.StringVar(value="พร้อม")
        ttk.Label(row5, textvariable=self.status_var, foreground="#666").pack(side="left", padx=10)
        self.open_report_btn = ttk.Button(row5, text="เปิดหน้าสรุปผลล่าสุด",
                                           command=self._open_last_report, state="disabled")
        self.open_report_btn.pack(side="right")

        # log
        ttk.Label(self, text="log:").pack(anchor="w", padx=10)
        self.log_box = scrolledtext.ScrolledText(self, height=28, font=("Consolas", 9),
                                                  state="disabled", bg="#111", fg="#ddd")
        self.log_box.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        self._last_report_path: Path | None = None

    def _refresh_lists(self):
        self.eas = config.list_eas()
        names = [e["name"] for e in self.eas]
        self.ea_combo["values"] = names
        self.set_combo["values"] = config.list_sets()

    def _open_set_editor(self):
        SetEditor(self, self.set_var.get().strip() or None,
                  on_saved=lambda name: (self.set_var.set(name), self._refresh_lists()))

    def _open_last_report(self):
        if self._last_report_path and self._last_report_path.exists():
            webbrowser.open(self._last_report_path.as_uri())

    # ------------------------------------------------------------- run flow
    def _current_ea(self) -> dict | None:
        name = self.ea_var.get()
        return next((e for e in self.eas if e["name"] == name), None)

    def _model_value(self) -> str:
        label = self.model_var.get()
        for value, lbl in config.MODELS:
            if lbl == label:
                return value
        return "0"

    def _log(self, line: str):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", line + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _on_run(self):
        ea = self._current_ea()
        if not ea:
            messagebox.showerror("ผิดพลาด", "เลือก EA ก่อน")
            return
        set_name = self.set_var.get().strip()
        if not set_name:
            messagebox.showerror("ผิดพลาด", "เลือกหรือพิมพ์ชื่อไฟล์ .set ก่อน")
            return
        if not (config.SETS_DIR / f"{set_name}.set").exists():
            messagebox.showerror("ผิดพลาด", f"ไม่พบไฟล์ {set_name}.set ใน optimizer/sets/")
            return
        try:
            date_from = datetime.strptime(self.from_var.get().strip(), "%Y-%m-%d").date()
            date_to = datetime.strptime(self.to_var.get().strip(), "%Y-%m-%d").date()
        except ValueError:
            messagebox.showerror("ผิดพลาด", "รูปแบบวันที่ต้องเป็น yyyy-mm-dd")
            return

        mode = self.mode_var.get()
        try:
            genetic_reps = max(1, int(self.reps_var.get().strip()))
            holdout_pct = float(self.holdout_var.get().strip())
        except ValueError:
            messagebox.showerror("ผิดพลาด", "'รันซ้ำ genetic' ต้องเป็นจำนวนเต็ม และ '%กันไว้ตรวจสอบ' ต้องเป็นตัวเลข")
            return
        if not (0 < holdout_pct < 90):
            messagebox.showerror("ผิดพลาด", "% กันไว้ตรวจสอบ ควรอยู่ระหว่าง 1-89")
            return

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"eatuner_{ea['name']}_{self.symbol_var.get()}_{self.period_var.get()}_{ts}"

        term_dir = config.find_terminal_data_dir(ea["expert_path"])
        if not term_dir:
            messagebox.showerror(
                "ผิดพลาด",
                f"หาโฟลเดอร์ MT5 terminal ที่มี {ea['expert_path']}.ex5 ไม่เจอ — "
                f"compile + copy ไฟล์ .ex5 ไป MQL5\\Experts\\Advisors\\ ก่อน",
            )
            return

        req = runner.RunRequest(
            ea_name=ea["name"],
            expert_path=ea["expert_path"],
            dump_dir=ea["dump_dir"],
            set_name=set_name,
            symbol=self.symbol_var.get().strip(),
            period=self.period_var.get(),
            model=self._model_value(),
            deposit=self.deposit_var.get().strip(),
            date_from=date_from,
            date_to=date_to,
            mode=mode,
            out_name=out_name,
            terminal_data_dir=str(term_dir),
            genetic_reps=genetic_reps,
            holdout_pct=holdout_pct,
        )
        self.last_req = req
        self.stage2_out_name = None
        self.holdout_out_name = None
        self.run_btn.configure(state="disabled")
        self.open_report_btn.configure(state="disabled")
        self.status_var.set("กำลังรัน... (ดู log ด้านล่าง)")
        self._log(f"\n===== เริ่มรัน {out_name} โหมด={mode} =====")

        target = self._run_worker_optimize if mode == "optimize" else self._run_worker
        self.worker = threading.Thread(target=target, args=(req,), daemon=True)
        self.worker.start()

    def _run_worker(self, req: runner.RunRequest):
        try:
            for line in runner.run_streaming(req):
                self.log_queue.put(line)
        except Exception as exc:  # noqa: BLE001 — ต้องโชว์ error ให้ผู้ใช้เห็น ไม่ใช่ให้ thread เงียบตาย
            self.log_queue.put(f"[เกิดข้อผิดพลาด] {exc}")
        self.log_queue.put("__DONE__")

    def _run_worker_optimize(self, req: runner.RunRequest):
        """โหมดจูน = 3 ขั้นเสมอ (กดปุ่มเดียว รันจนจบ ไม่ต้องตัดสินใจเองระหว่างทาง):

        1. **genetic รันซ้ำ {genetic_reps} รอบ** บนช่วง train เท่านั้น (ตัดช่วง holdout ออกไปก่อน
           เลือกค่า) — รันซ้ำหลายรอบเพราะ genetic ของ MT5 สุ่มทดสอบแค่บางส่วนของกริด แต่ละรอบ
           อาจลงคนละจุด รวมผู้ชนะทุกรอบเข้าด้วยกันแล้วเลือกคะแนนสูงสุดจากทั้งหมด แทนที่จะเชื่อ
           รอบเดียว
        2. **exhaustive ไล่ครบทุกจุด ±1 step** รอบผู้ชนะรวมของขั้น 1 (ยังบนช่วง train) — เช็คว่า
           เป็นที่ราบจริงหรือยอดแหลมเดี่ยวๆ (กฎ "ห้ามเชื่อผู้ชนะโดดเดี่ยว")
        3. **ตรวจสอบ holdout**: เอาค่าที่ชนะขั้น 2 ไปรัน single-pass บนช่วง holdout (ส่วนท้ายสุด
           ของช่วงที่ขอมา ไม่เคยถูกใช้เลือกค่าเลยทั้งขั้น 1-2) — ถ้าผลพังตรงนี้ ห้ามเชื่อค่าที่ได้
           ต้องจูนใหม่ ไม่ใช่เอาไปใช้จริง

        ค่าที่ควรใช้จริงคือผู้ชนะของขั้น 2 เสมอ ขั้น 3 มีไว้ "ยืนยัน/ปฏิเสธ" เท่านั้น ไม่ได้ใช้
        เลือกค่าต่อ (ถ้าเอาผล holdout กลับไปเลือกค่าใหม่ ช่วงนั้นก็จะกลายเป็นข้อมูลที่ใช้จูนไปด้วย
        แล้วจะไม่เหลืออะไรไว้ตรวจสอบอีก)
        """
        try:
            train_from, train_to, hold_from, hold_to = runner.split_train_holdout(
                req.date_from, req.date_to, req.holdout_pct
            )
            self.log_queue.put(
                f"ช่วง train (ใช้จูนเท่านั้น): {train_from} – {train_to}\n"
                f"ช่วง holdout (ล่าสุดที่สุดของช่วงที่ขอ — ไม่แตะเลยจนกว่าจะยืนยันตอนท้าย): "
                f"{hold_from} – {hold_to}"
            )

            all_rows: list[dict] = []
            for rep in range(1, req.genetic_reps + 1):
                self.log_queue.put(f"\n----- ขั้น 1/3 — รอบ genetic {rep}/{req.genetic_reps} (ช่วง train) -----")
                rep_req = runner.RunRequest(
                    ea_name=req.ea_name, expert_path=req.expert_path, dump_dir=req.dump_dir,
                    set_name=req.set_name, symbol=req.symbol, period=req.period, model=req.model,
                    deposit=req.deposit, date_from=train_from, date_to=train_to,
                    mode="optimize", out_name=f"{req.out_name}_gen{rep}",
                    terminal_data_dir=req.terminal_data_dir,
                )
                for line in runner.run_streaming(rep_req):
                    self.log_queue.put(line)
                rep_rows = report.parse_pass_csv(config.RESULTS_DIR / f"{rep_req.out_name}.csv")
                if rep_rows:
                    rep_best = max(rep_rows, key=lambda r: r["score"])
                    self.log_queue.put(f"ผู้ชนะรอบที่ {rep}: คะแนน {rep_best['score']:.3f}")
                all_rows.extend(rep_rows)

            if not all_rows:
                self.log_queue.put("[ไม่มีผลจากรอบ genetic เลยสักรอบ — หยุดที่นี่]")
                self.log_queue.put("__DONE__")
                return

            best = max(all_rows, key=lambda r: r["score"])
            tunable_values = best["params"][config.PARAM_PREFIX_COLS:]
            n_params = len(tunable_values)
            self.log_queue.put(
                f"\nผู้ชนะรวมทุกรอบ genetic ({req.genetic_reps} รอบ, {len(all_rows)} ชุดรวม): "
                f"คะแนน {best['score']:.3f} — {best['params']}"
            )

            entries = runner.parse_set_file(config.SETS_DIR / f"{req.set_name}.set")
            neighbor_text = runner.build_neighbor_set(entries, tunable_values, n_params)
            neighbor_name = f"{req.set_name}__neighbor_{req.out_name[-15:]}"
            (config.SETS_DIR / f"{neighbor_name}.set").write_text(neighbor_text, encoding="utf-8")
            self.log_queue.put(f"สร้างไฟล์ตรวจสอบเพื่อนบ้าน: {neighbor_name}.set")

            stage2_out = f"{req.out_name}_neighbor"
            stage2_req = runner.RunRequest(
                ea_name=req.ea_name, expert_path=req.expert_path, dump_dir=req.dump_dir,
                set_name=neighbor_name, symbol=req.symbol, period=req.period, model=req.model,
                deposit=req.deposit, date_from=train_from, date_to=train_to,
                mode="optimize", out_name=stage2_out, terminal_data_dir=req.terminal_data_dir,
                opt_override="1",  # exhaustive — กริดแคบพอจะไล่ครบทุกจุดได้แล้ว
            )
            self.log_queue.put("\n----- ขั้น 2/3 — exhaustive รอบเพื่อนบ้าน (ช่วง train) -----")
            for line in runner.run_streaming(stage2_req):
                self.log_queue.put(line)
            self.stage2_out_name = stage2_out

            verified_rows = report.parse_pass_csv(config.RESULTS_DIR / f"{stage2_out}.csv")
            if not verified_rows:
                self.log_queue.put("[ไม่มีผลจากรอบตรวจสอบเพื่อนบ้าน — ข้ามขั้น holdout]")
                self.log_queue.put("__DONE__")
                return

            verified_best = max(verified_rows, key=lambda r: r["score"])
            verified_values = verified_best["params"][config.PARAM_PREFIX_COLS:]
            self.log_queue.put(
                f"ผู้ชนะรอบตรวจสอบเพื่อนบ้าน (ค่าที่ควรใช้จริง): คะแนน {verified_best['score']:.3f} "
                f"— {verified_best['params']}"
            )

            fixed_text = runner.build_fixed_set(entries, verified_values, n_params)
            fixed_name = f"{req.set_name}__final_{req.out_name[-15:]}"
            (config.SETS_DIR / f"{fixed_name}.set").write_text(fixed_text, encoding="utf-8")

            stage3_out = f"{req.out_name}_holdout"
            stage3_req = runner.RunRequest(
                ea_name=req.ea_name, expert_path=req.expert_path, dump_dir=req.dump_dir,
                set_name=fixed_name, symbol=req.symbol, period=req.period, model=req.model,
                deposit=req.deposit, date_from=hold_from, date_to=hold_to,
                mode="single", out_name=stage3_out, terminal_data_dir=req.terminal_data_dir,
                opt_override="0",
            )
            self.log_queue.put(
                f"\n----- ขั้น 3/3 — ตรวจสอบ holdout ({hold_from}–{hold_to}, ไม่เคยใช้จูนเลย) -----"
            )
            for line in runner.run_streaming(stage3_req):
                self.log_queue.put(line)
            self.holdout_out_name = stage3_out
        except Exception as exc:  # noqa: BLE001
            self.log_queue.put(f"[เกิดข้อผิดพลาด] {exc}")
        self.log_queue.put("__DONE__")

    def _poll_log(self):
        try:
            while True:
                line = self.log_queue.get_nowait()
                if line == "__DONE__":
                    self._on_run_finished()
                else:
                    self._log(line)
        except queue.Empty:
            pass
        self.after(100, self._poll_log)

    def _on_run_finished(self):
        self.run_btn.configure(state="normal")
        self.status_var.set("เสร็จแล้ว — กำลังสร้างหน้าสรุปผล...")
        try:
            path = self._build_report()
            self._last_report_path = path
            self.open_report_btn.configure(state="normal")
            self.status_var.set(f"เสร็จแล้ว — {path.name}")
            webbrowser.open(path.as_uri())
        except Exception as exc:  # noqa: BLE001
            self.status_var.set("รันเสร็จ แต่สร้างหน้าสรุปผลไม่สำเร็จ")
            self._log(f"[สร้างรายงานล้มเหลว] {exc}")

    def _build_report(self) -> Path:
        req = self.last_req
        assert req is not None
        model_label = self.model_var.get()

        pass_rows = None
        verified_rows = None
        period_rows = None
        period_unit = "งวด"
        monthly_rows = None

        holdout_row = None
        if req.mode == "single":
            csv_path = config.RESULTS_DIR / f"{req.out_name}.csv"
            pass_rows = report.parse_pass_csv(csv_path)
            monthly_path = config.RESULTS_DIR / f"{req.out_name}_monthly.csv"
            monthly_rows = report.parse_monthly_series(monthly_path) or None
        elif req.mode == "optimize":
            # รอบ genetic เขียนแยกไฟล์ต่อรอบ (_gen1, _gen2, ...) — รวมทุกรอบเข้าด้วยกันก่อนแสดงตาราง
            pass_rows = []
            for rep in range(1, req.genetic_reps + 1):
                pass_rows += report.parse_pass_csv(config.RESULTS_DIR / f"{req.out_name}_gen{rep}.csv")
            if self.stage2_out_name:
                verified_rows = report.parse_pass_csv(
                    config.RESULTS_DIR / f"{self.stage2_out_name}.csv"
                )
            if self.holdout_out_name:
                holdout_rows = report.parse_pass_csv(config.RESULTS_DIR / f"{self.holdout_out_name}.csv")
                holdout_row = holdout_rows[0] if holdout_rows else None
                monthly_rows = report.parse_monthly_series(
                    config.RESULTS_DIR / f"{self.holdout_out_name}_monthly.csv"
                ) or None
        else:
            period_unit = "สัปดาห์" if req.mode == "weekly" else "เดือน"
            summary_path = config.RESULTS_DIR / f"{req.out_name}_summary.csv"
            period_rows = report.parse_period_summary(summary_path)

        title = f"ผลทดสอบ {req.ea_name} — {req.symbol} {req.period}"
        html_str = report.render_report(
            title=title,
            ea_name=req.ea_name,
            symbol=req.symbol,
            period=req.period,
            mode=dict(config.RUN_MODES)[req.mode],
            date_from=req.date_from.isoformat(),
            date_to=req.date_to.isoformat(),
            model_label=model_label,
            pass_rows=pass_rows,
            verified_rows=verified_rows,
            holdout_row=holdout_row,
            period_rows=period_rows,
            period_unit=period_unit,
            monthly_rows=monthly_rows,
        )
        out_dir = Path(__file__).resolve().parents[1] / "output"
        return report.write_report(html_str, out_dir)
