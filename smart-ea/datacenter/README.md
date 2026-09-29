# Gold data center (broker-neutral; ตอนนี้ใช้ข้อมูล Exness XAUUSDc)

คลังข้อมูลพฤติกรรมราคาทองสำหรับงานวิจัย smart-ea (ดูแผนเต็มใน `dev-workspace\smart-ea\CLAUDE.md` หัวข้อ "แผนใหม่: data center")

## ไม่ผูกกับ broker (2026-09-28)
- **ทุกอย่างที่เป็นของ broker อยู่ในไฟล์เดียว** `brokers\<ชื่อ>.json` (symbol, digits, นาฬิกา server, วันเริ่มข้อมูลสะอาด, spread เชื่อได้ตั้งแต่เมื่อไร, ที่อยู่ไฟล์)
  อ่านผ่าน `scripts\broker.py` เท่านั้น — สคริปต์อื่นห้ามฝังค่าของ broker · เลือก broker ด้วย environment variable `DC_BROKER` (ค่าเริ่มต้น `exness`)
- **เวลาในคลัง = UTC เสมอ** (แปลงจากนาฬิกา server ตอนโหลด: `UTC`, `UTC+N` หรือ `NY_CLOSE` = GMT+2/+3 ตาม DST สหรัฐ)
- **วัน = มาตรฐาน 17:00 นิวยอร์ก → 17:00 นิวยอร์ก** (`scripts\dc_sessions.py` คำนวณ DST สหรัฐเอง) · ตรวจแล้วตรงกับช่วงพักตลาดจริงของ Exness ทุกแท่ง
  (เส้นตัดอยู่กลางช่วงพัก) · ฤดูร้อนสหรัฐตลาดเปิด 05:00 ไทย ฤดูหนาว 06:00 ไทย · ช่วง asia/london/newyork/late ใช้นาฬิกานิวยอร์ก
- **"วันเต็ม"** = มีแท่ง ≥ 90% ของค่ากลางแท่งต่อวัน (สัมพัทธ์ ไม่ใช่ตัวเลขของ broker)
- **spread ในแท่ง** เชื่อได้ตั้งแต่วันที่ในโปรไฟล์เท่านั้น (Exness: 2026-03-01; ก่อนหน้าเป็นค่าตายตัว 0.16 ไม่ใช่ต้นทุนจริง)
- ตรวจแล้วว่าไม่ผูกจริง: `scripts\test_broker_neutral.py` สร้าง broker ปลอมนาฬิกา GMT+2/+3 จากข้อมูลเดียวกัน → ตรวจเจอ `NY_CLOSE` ถูก และแคตตาล็อก 47 ตัววัดตรงกัน 1.00 ทุกตัว

## เพิ่ม / เปลี่ยน broker
1. คัดลอก `brokers\exness.json` เป็น `brokers\<ชื่อ>.json` แก้ symbol, digits, `bars_file`/`db_file` (เช่น `brokers/<ชื่อ>/bars.npz`), `bardump_common_subdir`
2. dump แท่ง M1 ด้วย EA `BarDump` ใน terminal ของ broker นั้น → `set DC_BROKER=<ชื่อ>` → `python scripts\bars.py`
3. `python scripts\broker_check.py <ชื่อ>` → แนะนำ `server_time` และ `data_start_utc` ให้ (แก้โปรไฟล์ตาม) + ตาราง spread/tick volume รายเดือน
4. `python scripts\broker_check.py <ชื่อ> --build` → สร้างคลังของ broker นั้นแล้วเทียบกับ Exness ในวันเดียวกัน (ราคา, แคตตาล็อก 47 ตัววัด; ต่างเกิน ±10% = ต้องหาสาเหตุก่อนใช้ข้อสรุปเดิม)
5. spread ต้องเทียบกับ real ticks ของ broker นั้นเอง (ตัดสินจากแท่งอย่างเดียวไม่ได้)

- **หน่วยวัดขนาด:** ADR20 = ช่วงราคาเฉลี่ยต่อวันของ 20 วันก่อนหน้า (รู้ได้ก่อนเริ่มวัน) เพื่อให้เทียบข้ามช่วงที่ตลาดแรงไม่เท่ากันได้
- **แหล่งข้อมูลปัจจุบัน:** แท่ง M1 ของ Exness `XAUUSDc` ตั้งแต่ **2024-04-12** (ก่อนหน้านั้นแท่งแบน ใช้ไม่ได้)

## ไฟล์
| ไฟล์ | คืออะไร |
|---|---|
| `gold_dc.sqlite` | คลังข้อมูลหลัก (SQLite เปิดด้วย DB Browser for SQLite หรือ Python `sqlite3`) |
| `bars.npz` | แท่ง M1 ดิบจาก MT5 (ทั้งหมด รวมช่วงเก่าที่ใช้ไม่ได้) — แหล่งที่ `dc_build.py` ใช้สร้างคลัง |
| `scripts\dc_build.py` | สร้าง `gold_dc.sqlite` ใหม่ทั้งไฟล์จาก `bars.npz` |
| `scripts\dc_summary.py` | ตัวอย่างการใช้งาน: สรุปทุกประเภทเหตุการณ์ + ผลแบบเทรดได้ |
| `brokers\<ชื่อ>.json` + `scripts\broker.py` | โปรไฟล์ broker + ตัวอ่านโปรไฟล์/แปลงนาฬิกาเป็น UTC/DST สหรัฐ (ที่เดียวที่รู้จัก broker) |
| `scripts\broker_check.py` | ตรวจ broker ใหม่ (นาฬิกา, ช่วงข้อมูลสะอาด, spread, tick volume, `--build` เทียบแคตตาล็อกกับ Exness) |
| `scripts\test_sessions.py` / `test_broker_neutral.py` | ทดสอบวัน DST/การแปลงนาฬิกา/นิยามวัน และทดสอบว่าคลังไม่ผูกกับ broker |
| `scripts\dc_sessions.py` | นิยามวันเทรดมาตรฐาน 17:00 นิวยอร์ก + ช่วงของวัน + "วันเต็ม" ใช้ร่วมทุกสคริปต์ |
| `scripts\dc_catalog.py` | แคตตาล็อกพฤติกรรม M1/M5/M15 → ตาราง `patterns` + `legs` (รันหลัง `dc_build.py` ทุกครั้ง) — นิยามทุกตัวอยู่หัวไฟล์ |
| `scripts\cat_bars.py` | ตัวโหลดกลาง: แท่ง M1 + แปลงเป็น TF ใดก็ได้ในวันเทรด + ATR20 |
| `scripts\dc_catalog_b.py` | แคตตาล็อกส่วน B → ตาราง `level_visits` (เข้าหาระดับราคา), `boxes` (กรอบ sideway), `trends` (โครงสร้างเทรนด์) — รันหลัง `dc_catalog.py` |
| `scripts\cat_time.py` | พฤติกรรมตามเวลา → ตาราง `day_time` + รายงาน (ความผันผวนรายชั่วโมง/นาที, เวลาเกิด high/low, gap, วันในสัปดาห์) |
| `scripts\cat_report_b.py` / `cat_null.py` / `cat_verify_b.py` | รายงานส่วน B / เทียบข้อมูลสุ่ม (สลับลำดับแท่ง) / ตรวจตัวนับอิสระ |
| `scripts\cat_struct.py` | ตัวตรวจจับกลาง (zigzag, รูปแบบหลายจุดกลับตัว, ทะลุแล้ว retest) + ข้อมูลสุ่ม 2 แบบ (สลับลำดับแท่ง / สุ่มทิศ) ใช้กับข้อมูลจริงและสุ่มด้วยโค้ดเดียวกัน |
| `scripts\dc_catalog_c.py` | แคตตาล็อกขั้น 2 → ตาราง `patterns_c`, `retests`, `vol_events`, `spread_events`, `nesting` — รันหลัง `dc_catalog_b.py` |
| `scripts\cat_null_all.py` | เทียบทุกพฤติกรรมของแคตตาล็อกส่วน A + ขั้น 1 กับข้อมูลสุ่ม 2 แบบ ด้วยตัวนับเดียว (ผล `cat_null_all.pkl`) |
| `scripts\cat_unnamed.py` / `cat_unnamed_tilt.py` | ขั้น 3: ค้นแบบไม่ตั้งชื่อ (รหัสแท่ง 36 แบบ, คู่ 2 แท่ง, ลำดับ 3 แท่ง) เทียบสุ่มทิศ / ตรวจว่าความเอียงขึ้นเกิน drift รายวันไหม |
| `scripts\cat_robust.py` | ขั้น 4: ทดสอบความไวของเกณฑ์ (ขนาดแท่ง, ATR, TF, zigzag, ระยะแตะ) + ความนิ่งรายปี/รายไตรมาส ของข้อค้นพบที่เหลือรอด |
| `scripts\cat_regime.py` | สภาพตลาดของแต่ละ TF (M1-H4 จากโครงสร้างของ TF นั้นเอง): วัฏจักร, พฤติกรรมภายในขาขึ้น/ขาลง/sideway เทียบสุ่มทิศ |
| `scripts\cat_anatomy.py` | กายวิภาคของทุกรอบขาขึ้น/ขาลงในแต่ละ TF (จำนวน/ความลึกของการย่อ, คลื่นส่งแรงขึ้นหรือผ่อน, นานเท่าไร, จบแบบไหน) เทียบสุ่มทิศ |
| `scripts\cat_episodes.py` | ตัวผ่ารอบขึ้น/ลงกลาง (กฎเดียวกับ `cat_anatomy.py`) + สภาพตลาดต่อแท่งจาก pivot ที่ยืนยันแล้ว — ใช้ร่วมในงาน TF ซ้อน/เวลา/สิ่งที่ตามมา |
| `scripts\cat_nest.py` / `cat_nest_test.py` / `cat_nest_updn.py` | TF ซ้อน: รอบ TF เล็กติดป้ายสภาพ TF ใหญ่ ณ เวลานั้น (`cat_nest.py <k>` → `cat_nest_k<k>.pkl`) / ทดสอบ สวน−ตาม เทียบสุ่มทิศ / ขึ้น−ลง ภายในสภาพ TF ใหญ่เดียวกัน |
| `scripts\cat_eptime.py` / `cat_eptime_report.py` / `cat_eptime_more.py` | เวลากับภาพ: รอบขึ้น/ลงติดป้ายช่วงเวลา/ข่าว 08:30 ET/ความผันผวน (`cat_eptime.py <k>` → `cat_eptime_k<k>.pkl`) / ตาราง+ทดสอบเทียบสุ่มทิศ / สัดส่วนรอบขึ้นรายกลุ่ม |
| `scripts\cat_follow.py` / `cat_follow_report.py` | สิ่งที่ตามมาหลัง footprint (แท่งใหญ่, จบรอบ, inside, สามเหลี่ยม, ทะลุ high/low เมื่อวาน, ผันผวนพุ่ง): ไปต่อ/กลับกี่ ATR ใน 3/12/48 แท่ง เทียบ drift และสุ่มทิศ (`cat_follow.pkl`) |
| `scripts\s3lib.py` / `s3_run.py` / `s3_report.py` | ขั้น 3: กลยุทธ์จาก footprint (S1a/S1b ซื้อตามโครงสร้างขาขึ้น, S2 หลังแท่งลงแรง, S3 ทะลุ high เมื่อวาน + SELL กลับด้าน) จำลองบน M1 เป็น R หลังต้นทุน (`s3_run.py <k> <cost>` → `s3_k<k>_c<cost>.pkl`) |
| `scripts\cat_timedir.py` | รอยเท้าตามเวลา: ทิศรายชั่วโมง, วันในสัปดาห์, ต้น/ปลายเดือน, fix ลอนดอน, ความผันผวนต่อเนื่อง, variance ratio |
| `scripts\cat_report_c.py` / `cat_verify_c.py` | รายงานขั้น 2 เทียบข้อมูลสุ่ม 2 แบบ / ตรวจตัวนับอิสระ |
| `scripts\cat_report.py` | สรุปแคตตาล็อก: ครั้งต่อวัน, การกระจาย, ช่วงเวลา, ความนิ่งรายเดือน → `catalog_summary.csv` |
| `scripts\cat_dq.py` / `cat_breaks.py` / `cat_verify.py` | ตรวจคุณภาพข้อมูล / เวลาพักตลาดจริง / นับซ้ำด้วยโค้ดอิสระ |
| `scripts\s2lib.py` | ขั้น 2: โหลดข้อมูล + ตัวจำลองไม้ (หัก spread, cutoff 16:00 server, กริด SL/TP ละเอียด) |
| `scripts\s2_screen.py` | ขั้น 2: คัดกรองทุกประเภทเหตุการณ์ด้วยเกณฑ์เข้ม (เลือกช่องจากครึ่งแรก ตรวจครึ่งหลัง + null) |
| `scripts\s2_pdb.py` / `s2_null.py` / `s2_ctx.py` / `s2_qtr.py` | ขั้น 2: เจาะ 1 ประเภท (กริด, null ที่ยุติธรรม, บริบท, รายไตรมาส) — ใส่ชื่อประเภทเป็น argument |
| `scripts\s2_deep.py` / `s2_cluster.py` | ขั้น 2: เจาะกริดกว้าง + บริบท / ตรวจ t แบบปรับตามวัน, ถือทีละไม้, bootstrap |
| `scripts\s2_seq.py` | ขั้น 2: ลำดับพฤติกรรม (ระดับวัน + A→B ภายใน 60 นาที) |
| `scripts\s2_act.py` / `s2_combo.py` / `s2_seqtrade.py` | ขั้น 2 รอบ 2: ความคึกคัก vs ผล / รวม 2 ตัวถือทีละไม้ + ทบต้น / เงื่อนไขลำดับที่เทรดได้ |
| `scripts\bars.py` | แปลง CSV ที่ EA `research\BarDump.mq5` dump ออกมา เป็น `bars.npz` |
| `adx_trades.sqlite` | **คลังไม้ AdxEmaVol (smart-ea เฟส 1)** — ทุกไม้ของ 432 ชุดพารามิเตอร์บน M1/M3/M5 เข้าไม้ 2024-04-15 → แท่งล่าสุด (แยกไฟล์จากคลังหลัก) · ตาราง `meta`, `params`, `trades`, `columns` (คำอธิบายทุกคอลัมน์ภาษาไทย) · **โค้ดที่ตัดสินใจ (Selector/walk-forward) ต้องอ่านผ่าน `adx_asof.py` เท่านั้น** |
| `scripts\adx_asof.py` | `as_of(T)` = คลัง ณ เวลา T (เฉพาะไม้ที่ปิดแล้วก่อน T: `exit_t + 60 <= T`), `months()` สำหรับเดินหน้าทีละเดือน, `ctx_for(entry_t)` = สภาพตลาดตอนเข้าไม้ (ตาราง `ctx`) |
| `scripts\adx_ctx.py` | **เฟส 2**: ตาราง `ctx` ใน `adx_trades.sqlite` = สภาพตลาด ณ เวลาเข้าไม้ 1 แถวต่อ `entry_t` (165 คอลัมน์: เวลา / ความคึกคัก / ระดับวัน / footprint / สภาพตลาดและตำแหน่งในรอบของ M1/M3/M5 × zigzag 2/3/4 ATR + สภาพ M15/H1) ใช้เฉพาะแท่ง M1 ที่ปิดก่อนเข้าไม้และแท่ง TF ที่ปิดครบแล้ว · คำอธิบายทุกคอลัมน์ในตาราง `columns` (tbl='ctx') · ค่าที่มีทิศเก็บตามจริง (+ = ขึ้น) คูณ `trades.dir` เองถ้าจะดูเทียบทิศไม้ · ~25 วินาที · **รันหลัง `adx_build.py` ทุกครั้ง** (adx_build สร้างไฟล์ใหม่ ตาราง ctx หาย) |
| `scripts\sync_repo.py` | สำเนาโค้ด (README, `brokers\*.json`, `scripts\*.py`, `scripts\sets\*.set`) เข้า git monorepo `dev-workspace\smart-ea\datacenter\` — ที่ทำงานจริงยังเป็นที่นี่, ไฟล์ข้อมูลไม่เข้า git (สร้างใหม่จากโค้ดได้) · `--check` = ดูแค่ส่วนต่าง |
| `scripts\test_ctx_guard.py` | ทดสอบว่า `adx_ctx` ไม่ยอมสร้างเมื่อแท่งใน `gold_dc.sqlite` ต่างจากไฟล์แท่ง (กันคำนวณไม้ใหม่ด้วยแท่งเก่าแบบเงียบๆ) |
| `scripts\adx_ctx_audit.py` | ตรวจ ctx รอบสุดท้าย: แท่งที่ใช้ = แท่งสัญญาณของทุกไม้ (ราคาปิด = `ref_px`), ADR = `days.adr20`, สภาพตลาด/footprint ตรงแคตตาล็อก (ส่วนที่ต่างพิสูจน์ว่าเป็นเสมอเส้น), ไม่มี inf, สร้างซ้ำได้เหมือนเดิม, ค่ากลางรายครึ่งปี (สนามซ้อม) |
| `scripts\adx_ctx_audit2.py` | ตรวจ ctx ส่วนที่ 2: volume พุ่ง vs `vol_events`, สามเหลี่ยม vs `patterns_c`, gap vs `day_time`, ช่วงราคาเมื่อวาน vs `days` |
| `scripts\adx_ctx_audit3.py` | ตรวจ ctx ส่วนที่ 3: ตำแหน่งในรอบ M1/M5 vs `pivots`/`legs` + แท่งดิบ, เงื่อนไขที่ต้องจริง (กรอบ sideway, กรอบเอเชีย, ทะลุ/gap ฯลฯ) ทุกแถว |
| `scripts\adx_ctx_visual.py` | วาดกราฟตัวอย่างไม้สุ่มจากสนามซ้อม (แท่งก่อนเข้าไม้ + pivot/ขา/กรอบ/ระดับ) คู่ค่าจาก ctx → `ctx_visual.html` ให้ตรวจด้วยตา |
| `scripts\adx_ctx_png.py` / `adx_ctx_margin.py` | กราฟตรวจด้วยตาแบบ PNG (ไม่ใช้ไลบรารี) → `ctx_png\` + `values.txt` / วัดว่าป้ายสภาพตลาดตัดสินด้วยส่วนต่าง H/L เล็กแค่ไหน (ไม่มีระยะยอม) |
| `scripts\adx_ctx_check.py` | ตรวจ ctx อิสระ: ครบทุกไม้/ทุกคอลัมน์มีคำอธิบาย/NULL มีเหตุผล + คำนวณใหม่ด้วยโค้ดแยก (zoneinfo, จำนวนเต็ม) ~2,200 เวลาเข้าไม้ + สร้าง ctx ใหม่จากแท่งที่ตัดตรงเวลาเข้าไม้ 8 จุดแล้วเทียบทุกแถวทุกคอลัมน์ (~6 นาที) |
| `scripts\adx_check_asof.py` | ตรวจว่าไม่รั่วอนาคต: as_of เทียบ SQL อิสระ 70 จุดเวลา + สร้างคลังใหม่จากข้อมูลที่ตัดที่ T แล้วเทียบกับ as_of(T) ทุกแถวทุกคอลัมน์ |
| `scripts\adx_lib.py` | ตัวจำลอง AdxEmaVol ไม้ต่อไม้ (ADX/ATR สูตร MT5, ถือทีละไม้, cutoff, ladder/TP เดียว, spread ฝั่ง SELL) — ตรวจกับ MT5 ไม้ต่อไม้แล้ว |
| `scripts\adx_build.py` | สร้าง `adx_trades.sqlite` ใหม่ทั้งไฟล์ (~15 วินาที) — กริด/ช่วงเวลา/ต้นทุนมาตรฐาน (`COST_STD`) อยู่หัวไฟล์ |
| `scripts\adx_verify.py` | เทียบตัวจำลองกับรายงาน MT5 ของ `test\adxtf\AdxEmaVolReTF` ไม้ต่อไม้ (แสดงแค่การจับคู่/ส่วนต่างต่อไม้ ไม่แสดงกำไรรวม) |
| `scripts\adx_check.py` | ตรวจคลังไม้: ไม้ซ้ำ, ไม้ซ้อน, เวลาเข้า/ออก, วันหาย, NaN, คอลัมน์ไม่มีคำอธิบาย |
| `scripts\adx_audit.py` | ตรวจตัวไฟล์คลังด้วยโค้ดแยก: เทียบรายงาน MT5 (รวมตัวคูณ volume), สูตร `r_std`, คำนวณราคาเข้า/spread/นาทีถือ/MFE/MAE ใหม่จากแท่งดิบ, คีย์วันเทียบ zoneinfo |
| `scripts\adx_audit2.py` | ตรวจส่วนที่ 2: ค่าอินดิเคเตอร์ตอนสัญญาณเทียบ log ของ EA วิจัยใน MT5 + ระดับ SL/TP, เหตุผลปิด, จำนวนการปิดบางส่วน เทียบรายงาน MT5 |
| `scripts\p3lib.py` / `p3_screen.py` | **เฟส 3**: นิยาม pattern 549 ตัว (สภาพตลาด/ตำแหน่งในรอบ/ความคึกคัก/เวลา/footprint/ระดับวัน/M15-H1) + สถิติ "ไม้ใน pattern เทียบค่าเฉลี่ยของชุด × ทิศ × ครึ่ง" SE กลุ่มรายวัน เฉพาะสนามซ้อม → `p3_real.pkl` (หรือระบุไฟล์คลังอื่น) |
| `scripts\p3_perm.py` | เฟส 3 null 1: สลับสภาพตลาดข้ามวัน (ctx ของวันอื่นในครึ่งเดียวกัน นาทีใกล้สุด) 200 รอบ → `p3_perm.pkl` · บันทึกทุก 20 รอบใน `p3_perm_partial.pkl` รันซ้ำแล้วเริ่มต่อเอง |
| `scripts\p3_null_build.py <seed>` | เฟส 3 null 2: ตลาดสุ่มทิศ (กลับทิศแท่ง M1 แบบสุ่ม ความผันผวน/spread/volume เท่าจริง, ถึง 2026-06-01 เท่านั้น) → รันตัวจำลอง 432 ชุด + ctx ใหม่ → `p3_null\sf<seed>\` (แล้ว `p3_screen.py <db> p3_null\p3_sf<seed>.pkl`) |
| `scripts\p3_report.py` / `p3_verify.py` | เฟส 3: ด่าน G1-G6 + เทียบตลาดสุ่มทิศ + คู่ของตัวที่ผ่าน → `p3_results.csv` (ทุก pattern ทุกด่าน) + `p3_summary.txt` / คำนวณซ้ำด้วยโค้ดแยก |
| `scripts\adx_mkverify_sets.py` + `scripts\sets\` | ไฟล์ `.set` สำหรับรัน MT5 ตรวจเทียบ (ห้ามเขียน `.set` ด้วย PowerShell 5.1 — ใส่ BOM แล้ว MT5 อ่านบรรทัดแรกไม่ออก) |

## ตาราง
- **meta** — broker, profile (JSON ทั้งไฟล์ตอนสร้าง), time = UTC, day = 17:00 New York, built_utc
- **bars_m1** — t (UTC), o, h, l, c, tick_vol, spread (หน่วยราคา — ดูวันที่เชื่อได้ในโปรไฟล์)
- **days** — ต่อวัน: open/high/low/close, range, adr20, net_adr, efficiency (|close−open|/range), close_pos, day_type (trend / quiet / two_sided / normal),
  inside, outside, ทะลุ high/low เมื่อวาน, ปิดนอกกรอบเมื่อวาน, activity_1m_range_pct (ค่ากลางช่วงแท่ง 1 นาทีเป็น % ของราคา), spread_median, tick_vol_sum
- **swings** — จุดกลับตัว zigzag (กลับตัว ≥ 20% ADR): pivot_t (เวลาจุดสุด), confirm_t (เวลาที่ยืนยันได้จริง), kind (+1 high / −1 low), leg_size_adr, leg_minutes
- **events** — type, t (เวลาที่รู้ว่าเหตุการณ์เกิดแล้ว), dir (+1/−1 ทิศที่ทดสอบ), hour, session (asia/london/newyork/late), activity_so_far (ช่วงราคาวันนี้ถึงตอนนั้น ÷ ADR),
  backdrop5_aligned (ทิศเดียวกับราคาเทียบ 5 วันก่อนไหม), spread_adr, x1 (ค่าเสริมของแต่ละประเภท)
- **outcomes** (1:1 กับ events) — fwd15/60/240/fwd_end (ราคาไปตามทิศกี่ ADR), mfe240/mae240, และ `g_slXX_tpYY` = ผลเป็น R ถ้าเข้าไม้ตอนเหตุการณ์
  ด้วย SL = XX% ADR และ TP = YY% ADR (−1 = โดน SL, TP/SL = ถึง TP, อื่นๆ = ปิดสิ้นวัน) ยังไม่หัก spread (ลบ spread_adr/SL เอง)

- **patterns** (จาก `dc_catalog.py`) — tf (1/5/15), type, t, day, dir, et_hour, phase, x1 · หน่วย = ATR20 ของ TF นั้น
- **legs** — ขาราคา zigzag (กลับตัว ≥ 3 ATR ของ TF): tf, day, t_start, t_end, dir, size_atr, size_adr, bars, minutes

## ประเภทเหตุการณ์
PREVDAY_BREAK, PREVDAY_FALSEBREAK, SWING_DOUBLE, SWING_SWEEP, SWING_BREAKOUT_THEN_REVERSAL, SWING_LOWERHIGH_HIGHERLOW,
PULLBACK_SHALLOW/MID/DEEP/REVERSED (หลังขาวิ่ง ≥ 50% ADR), FASTMOVE (≥ 25% ADR ใน 30 นาที), SQUEEZE_BREAK (หลุดกรอบ 60 นาทีที่แกว่ง ≤ 12% ADR),
ASIA_BREAK (ปิดนอกกรอบเอเชีย 17:00-02:59 นิวยอร์ก หลังเปิดลอนดอน 03:00 นิวยอร์ก ครั้งแรกต่อฝั่ง, x1 = กรอบ ÷ ADR), PREVWEEK_BREAK (ปิดนอก high/low สัปดาห์ก่อน ครั้งแรกต่อฝั่งต่อสัปดาห์, x1 = ระยะจากราคาเปิดวัน ÷ ADR)

## นโยบายข้อมูล (ตกลงกับผู้ใช้ 2026-09-28)
- **เก็บทุกอย่างตลอดไป ไม่ลบ** จุดเริ่มคงที่ที่ 2024-04-12 สำหรับ Exness (`data_start_utc` ในโปรไฟล์ ห้ามเลื่อน)
- ตอนวิเคราะห์/สร้างระบบ ค่อย **เลือกใช้เฉพาะ 2-3 ปีล่าสุด** (กรองด้วยเวลาใน query) เพื่อให้ระบบเป็นปัจจุบัน
- ข้อมูลใหม่ไม่เข้ามาเอง ต้องอัปเดตตามขั้นตอนด้านล่าง

## อัปเดตข้อมูล
1. ใน terminal `MT5-Optimizer` รัน EA `research\BarDump` ช่วงปีล่าสุด (ดู `smart-ea\CLAUDE.md`)
2. `python scripts\bars.py` → เขียนไฟล์แท่งของ broker ที่เลือก (`DC_BROKER`) ตามโปรไฟล์ให้เอง
3. **คลังหลักก่อน**: `python scripts\dc_build.py` → `python scripts\dc_catalog.py` → `python scripts\dc_catalog_b.py` → `python scripts\cat_time.py` → `python scripts\dc_catalog_c.py`
   (dc_build สร้างไฟล์ใหม่ทั้งไฟล์ ตารางแคตตาล็อกจะหายถ้าไม่รันต่อตามลำดับ) · ห้ามต่อท่อผลลัพธ์เข้า `Select-Object -First` — จะตัดสคริปต์ก่อนบันทึกลงคลัง
4. **แล้วคลังไม้**: `python scripts\adx_build.py` (สร้างคลังไม้ + ตาราง ctx ให้อัตโนมัติ; **หยุดทันทีถ้าแท่งใน gold_dc.sqlite ไม่ตรงกับไฟล์แท่ง** = ลืมข้อ 3)
   → `python scripts\adx_check.py` (รวมตรวจว่ามี ctx ครบ + สำเนาโค้ดใน repo ตรง) → `python scripts\adx_check_asof.py` → `python scripts\adx_ctx_check.py`
5. **ถ้าแก้โค้ด/README**: `python scripts\sync_repo.py` แล้ว commit + push โฟลเดอร์ `dev-workspace\smart-ea\datacenter` (adx_check.py ฟ้องถ้าลืม)
