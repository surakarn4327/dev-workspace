# msnr_research.md — บันทึกค้นคว้าเทคนิค MSNR (Malaysian Support & Resistance)

> **สถานะ: งานค้นคว้า ยังไม่ใช่กฎของผู้ใช้** — รวบรวมจากแหล่งสาธารณะ 2026-10-17 (~30 แหล่ง)
> กฎที่ implement จริงอยู่ที่ `msnr_technique.md` (โค้ด `src/msnr.pine`, เฟส 1 เริ่ม 2026-10-17) — QM ตัดทิ้งตามผู้ใช้

## ความน่าเชื่อถือของแหล่ง (อ่านก่อน)

- **ไม่มีผู้คิดค้นที่ระบุชื่อได้ ไม่มีตำราทางการ** — ทุกแหล่งตรงกันข้อนี้ (FOREXimf, LuxAlgo, Grokipedia)
  เผยแพร่ผ่านคอร์ส, Telegram, TikTok, ฟอรัม, indicator ชุมชน ราวต้นทศวรรษ 2020
- สายที่มีชื่อเสียง: **"Alchemist"** (เทรดเดอร์ทองชาวมาเลเซีย ไม่เปิดชื่อ คอร์สหลุดถูกแชร์ต่อ) และ **"Mr T" (Ariff_T)**
  ที่อ้างว่าทำพอร์ต £1,000 → ~£1M (อ้างเอง ไม่มีการพิสูจน์)
- แหล่งส่วนใหญ่เป็นคำอธิบาย indicator บน TradingView/MQL5 และโน้ตนักเรียน → **แต่ละสำนักเพี้ยนกันเอง**
- **ไม่มีงานทดสอบอิสระว่า level ของ MSNR เด้งจริงบ่อยแค่ไหน** (LuxAlgo เขียนไว้ตรงๆ) ตัวเลข win rate 80–90% ที่วนในโซเชียล
  ไม่มีหลักฐานรองรับ

ระดับความเห็นพ้องในเอกสารนี้: **[ตรงกัน]** = แทบทุกแหล่งพูดเหมือนกัน, **[ขัดกัน]** = แยกเป็นเวอร์ชัน,
**[บางแหล่ง]** = พูดถึงแค่ 1–2 แหล่ง

---

## 1. แก่นของวิธี [ตรงกัน]

- วาดแนวรับ-แนวต้านจาก **ตัวเทียน (ราคาปิด/เปิด) ไม่ใช่ไส้** — มักดูจาก line chart (ราคาปิดอย่างเดียว)
- level เป็น **เส้นราคาเดียว** ไม่ใช่โซนกว้าง (ยกเว้นบางสำนัก ดูข้อ 3)
- ไส้เทียนทะลุเส้นไปบ้างเป็นเรื่องปกติ วิธีนี้ยอมรับโดยตั้งใจ
- ใช้ TF ใหญ่ดูทิศ (storyline) แล้วลง TF เล็กหาจังหวะเข้า

## 2. A-level / V-level [ขัดกัน — มี 3 วิธีวาด]

ความหมายตรงกัน: **A = ยอดแหลม = แนวต้าน**, **V = ก้นแหลม = แนวรับ** แต่ "วาดตรงไหน" ต่างกัน:

| เวอร์ชัน | วิธีหา | ราคาของเส้น | แหล่ง |
|---|---|---|---|
| **A. Pivot บนเส้นราคาปิด** | swing high/low ของราคาปิด มี lookback ซ้าย-ขวา (เช่น pivot depth 3) | ราคาปิดของแท่งยอด | GitHub mdavidjeremiah (`ta.pivothigh(close)`), DoN_JCT, trading-guide, LuxAlgo |
| **B. คู่แท่ง 2 แท่ง** | A = แท่งเขียวตามด้วยแท่งแดง, V = แท่งแดงตามด้วยแท่งเขียว (ไม่ต้องเป็น swing ใหญ่) | **ราคาปิดของแท่งแรก** | RWBTradeLab, MQL5 Vesath, Alchemist Part 1 (note.com, videohighlight) |
| **C. ลากปิด→เปิด** | ลากจากราคาปิดแท่งเขียวไปราคาเปิดแท่งแดงถัดไป | ปิดแท่งแรก/เปิดแท่งถัดไป (ถ้าไม่เท่ากัน = เป็น "แถบ") | zacdivan, Grokipedia, Wonra (ถือเป็นแถบระหว่าง close กับ open) |

- เวอร์ชัน B สร้าง level เยอะมาก (RWBTradeLab เตือนว่า alert A/V "ยิงแทบทุกแท่ง") → สำนัก Alchemist กรองต่อด้วยการเลือก
  เฉพาะ level ที่สำคัญ / มี liquidity ด้านหลัง (slideshare)
- Alchemist (videohighlight): **ใช้ราคาปิดเท่านั้น ไม่ใช้ราคาเปิด**
- **แหล่งนอกคอก:** FOREXimf (โบรกอินโดฯ) แปล A = "Advanced level" (ถูกทดสอบหลายครั้ง), V = "Valid level" (ใหม่)
  — ขัดกับทุกแหล่งอื่น น่าจะเข้าใจผิด **ไม่ควรใช้**

## 3. Gap level / OCL (Open-Close Level) [ขัดกัน — ราคาของเส้น]

ตรงกัน: เกิดจาก **2 แท่งสีเดียวกันติดกัน** (เขียว-เขียว = แนวรับ, แดง-แดง = แนวต้าน) ตรงรอยต่อปิดแท่งแรก/เปิดแท่งสอง
บางสำนักเรียก "hidden level" หรือ OCL (Wonra: OCL เดิมชื่อ "Gap SNR")

ขัดกัน — เส้นอยู่ราคาไหน:

| ราคาเส้น | แหล่ง |
|---|---|
| ราคาปิดแท่งแรก | RWBTradeLab, Alchemist Part 1 (note.com) |
| ราคาเปิดแท่งที่สอง | toby.fx1 (TikTok, bearish OCL) |
| จุดกึ่งกลางของช่องว่าง | GitHub mdavidjeremiah |
| ทั้งแถบระหว่างปิด-เปิด (โซน) | Wonra Alchemist Engine, trading-guide (ตัวเลือก "opening gaps" วาดเป็นกล่อง) |
| ไม่ระบุ | LuxAlgo (และขัดกับกฎ "เส้นเดียว" ของตัวเอง) |

ขัดกันอีกจุด — **ต้องมีช่องว่างจริงไหม**: LuxAlgo บอกต้อง "ไม่แชร์ราคากัน" (มี gap จริง),
RWBTradeLab นับทุกคู่สีเดียวกันแม้ปิด=เปิด, Wonra มี "size floor" กรอง gap เล็ก

**Decision level** [บางแหล่ง]: gap บน **H4** ที่เกิดตรงจุดแตะ level ของ TF ใหญ่ = สัญญาณ breakout กลับเทรนด์
(Scribd guide, DoN_JCT) — Alchemist บอก decision point **ใช้ซ้ำได้ไม่เสื่อม**

## 4. Fresh / Unfresh (ความสด) [ขัดกันพอสมควร]

**กฎหลักที่แหล่งส่วนใหญ่ใช้** (LuxAlgo, trading-guide ×2, MQL5, crowinvesting):
1. level เกิดใหม่ = **fresh**
2. **ไส้เทียนแตะ** = **unfresh** (เส้นประ) — เด้งน้อยลง มีโอกาสทะลุมากขึ้น
3. **ตัวเทียนปิดทะลุ** level unfresh = กลับมา **fresh ใหม่** (แล้วแตะไส้อีกก็ unfresh อีก วนได้)

เวอร์ชันที่ต่างออกไป:

| ประเด็น | เวอร์ชัน | แหล่ง |
|---|---|---|
| อะไรทำให้ unfresh | ไส้แตะ (default) | ส่วนใหญ่ |
| | แตะด้วยตัวเทียนเท่านั้น (ไส้ไม่นับ) — มีให้เลือกเป็น option | MQL5 Vesath (`WickMakesUnfresh`) |
| | ถูก retest "หลายครั้ง" (ไม่ใช่ครั้งเดียว) | hoclamtrader, FOREXimf |
| | ไส้ **หรือ** ตัวเทียนแตะก็นับ | Grokipedia |
| ตัวเทียนปิดทะลุแล้วเป็นอะไร | กลับเป็น fresh (level เดิม) | LuxAlgo, trading-guide |
| | กลับด้านเป็น SBR/RBS และ fresh ใหม่ | MQL5 Vesath, RWBTradeLab |
| | "broken" (เส้นเทา) เป็น flip level | GitHub mdavidjeremiah |
| | "fresh" แปลว่า "ยังไม่ถูกทะลุ" (ไม่สนไส้เลย) | DoN_JCT |
| ใช้ได้กี่ครั้ง | ครั้งเดียว | Jithuze (SBR/RBS แตะไส้ครั้งเดียวลบทิ้ง), slideshare (order block) |
| | ได้ 2 ครั้ง (ยกเว้น gap รายวันที่เคยเด้งแรง) | Studocu guide |
| | ไม่จำกัด แต่ซ่อนเมื่อถูกทะลุเกิน N ครั้ง | trading-guide (`Max Level Breaks`) |

**แหล่งกลับด้าน (น่าจะผิด):** Studocu 1 ฉบับ: fresh = "ไม่เคยถูกตัวเทียนทะลุ", unfresh = "ถูกไส้ทะลุ" — ขัดกับที่เหลือ

## 5. Break / Flip — SBR, RBS [ตรงกัน]

- **ทะลุ = ตัวเทียนปิดผ่าน** เท่านั้น ไส้ทะลุไม่นับ
- แนวรับโดนปิดทะลุลง → **SBR** (Support Becomes Resistance)
- แนวต้านโดนปิดทะลุขึ้น → **RBS** (Resistance Becomes Support)
- RWBTradeLab ถือ SBR/RBS เป็น level ที่น่าจับตาที่สุด (เส้นหนา)
- Wonra: ต้องปิดทะลุ "ขอบไกล" ของแถบ

## 6. Miss [บางแหล่ง — แต่ไม่มีใครค้าน]

- **ความหมาย:** ราคาวิ่งเข้าหา level แล้วกลับตัว **ก่อนไส้จะถึง** (Studocu, Wonra)
- ถือว่า **ยืนยันความแข็งแรง** ของ level เพราะ liquidity ตรงนั้นยังไม่ถูกกิน
- Studocu: ยิ่งมี miss หลายแท่งก่อนแตะจริง = ยิ่งแรง ("สะสมแรงกด")
- Wonra นับ miss แยกจาก touch

## 7. การแตะครั้งแรก [บางแหล่ง — ขัดกัน]

- Studocu: แตะครั้งแรกของ level fresh **ต้องเป็นไส้** ถ้าตัวเทียนแตะ/เข้าไปเลย = **ไม่เทรด level นั้น**
- GitHub mdavidjeremiah: level ที่ไส้แตะแล้วยังเทรดได้ แค่อ่อนกว่า

## 8. Storyline (เนื้อเรื่อง / ทิศของตลาด) [ขัดกัน — วิธีนิยาม]

ความหมายตรงกัน: **ทิศทางหลักจาก TF ใหญ่** — เข้าเทรดตามทิศนี้เท่านั้น ห้ามสวน (Alchemist: "ซื้อ breakout ในเทรนด์ขาลง = ผิด")

| เวอร์ชัน | นิยาม | แหล่ง |
|---|---|---|
| **A. Rejection + Breakout** (สาย Alchemist) | ราคาแตะ level TF ใหญ่ (M/W/D) แล้ว **ปิดตีกลับ** (rejection) → รอ **breakout ใน TF ต่ำลง 1–2 ขั้น** ยืนยัน = เรื่องเริ่ม | Alchemist notes, crowinvesting, Wonra, chaindesk summary |
| **B. โครงสร้าง swing** | HH+HL = ขึ้น, LH+LL = ลง, ใช้ BOS (ต่อเทรนด์) / CHoCH (กลับเทรนด์) | GitHub mdavidjeremiah |
| **C. Pivot หลาย TF** | เส้นทิศจาก pivot ของ W/D/H4/H1 แยกกัน ใช้เมื่อหลาย TF ตรงกัน | zacdivan |

- Wonra แยก breakout เป็น **internal** (level ที่เกิดหลัง rejection) กับ **external** (level ที่มีอยู่ก่อน)
- **TF ที่ใช้ทำ storyline ต่างกัน:** Daily+Weekly (Studocu), W/D/H4 (LuxAlgo), M/W/D (Alchemist)

## 9. Roadblock (สิ่งกีดขวาง) [ตรงกันพอสมควร]

- level ที่ **ขวางทาง** ระหว่างราคากับเป้า / level ที่ **สวนทิศ storyline** → ราคามักพักหรือย่อตรงนั้น **ไม่ใช่จุดกลับตัว**
- อยู่ **ต่ำกว่า TF ของ storyline 1 ขั้น**: storyline W → roadblock บน D, storyline D → roadblock บน H4 (crowinvesting, Alchemist notes)
- zacdivan วัดระยะถึง roadblock ด้วย ATR เป็นตัวกรองว่ามีที่ให้วิ่งพอไหม

## 10. ของเสริมที่บางสำนักใส่ [บางแหล่ง]

- **QM / QML (Quasimodo):** ไหล่ซ้าย → หัวที่ไกลกว่า → กลับมา; **เทรดที่ไหล่ซ้าย ไม่ใช่หัว** ต้องมี structure break
  (Wonra, toby.fx1) — Alchemist บอกเป็นแค่รูปแบบหนึ่งของ A/V "ชื่อไม่สำคัญ"
- **Apex:** ยอดหัวของ QM — SL วางเหนือ apex (Scribd guide)
- **Engulfing (EG/EF):** แท่งกลืนกินใหญ่พอ → โซนบนแท่งที่ถูกกลืน (Wonra); หรือใช้เป็นแท่งยืนยันเข้าบน H1/M15 (crowinvesting, FOREXimf)
- **Trendline:** ลากผ่าน 2 level → **แตะครั้งที่ 3** คาดว่าเด้ง; trendline ตัดกับ level = confluence ดีสุด (Scribd guide)
  Wonra นับเฉพาะเมื่อแตะตรง POI (OCL fresh / SBR ฯลฯ); Mr T เน้น "trendline 2 เส้นสำคัญ" (ไม่อธิบายรายละเอียด)
- **Liquidity:** high/low ของวัน/สัปดาห์/เดือนก่อน (Alchemist: "SNR 95% + SMC 5%")

## 11. การเข้าเทรด / SL / TP [ขัดกันในรายละเอียด]

ลำดับที่เกือบทุกแหล่งตรงกัน:
1. ดู storyline TF ใหญ่ → 2. หา level **fresh** ที่ตรงทิศ (ขาขึ้นหาแนวรับ fresh, ขาลงหาแนวต้าน fresh)
→ 3. รอราคามาถึง → 4. ลง TF เล็กรอ **สัญญาณยืนยัน** → 5. เข้า
**"ราคาแตะ level เฉยๆ ยังไม่ใช่จุดเข้า"** [ตรงกัน]

| ประเด็น | เวอร์ชัน |
|---|---|
| สัญญาณยืนยัน | ไส้แตะแล้วปิดกลับฝั่งเดิม (LuxAlgo) / engulfing H1–M15 (crowinvesting) / break & retest (Alchemist) / LTF structure shift (hoclamtrader) / pin bar (Grokipedia) |
| คู่ TF | W→D→H4→H1→M15/M5 "sniper" (crowinvesting) / D→H4→H1 (FOREXimf) / M,W,D + H4,H1 **ห้าม M1/M5/M15** (Alchemist) |
| จุดเข้า | เปิดแท่งถัดจาก engulfing หรือ limit ในโซน (crowinvesting) |
| SL | เลย level ไป (ส่วนใหญ่) / เลยไส้ rejection / เลย apex ของ QM |
| TP | level fresh ถัดไปตามทิศ (LuxAlgo, toby) / RR ขั้นต่ำ 1:2 อยากได้ 1:3–1:4 (crowinvesting) / liquidity ภายนอก (slideshare) |
| เทรดแบบทะลุ | level ที่ unfresh แล้ว = มองเป็นจุด breakout แล้วเทรด retest แบบ flip (LuxAlgo) |

## 11.5 วิธีใช้งานจริงของเทรดเดอร์ (workflow) — ค้นเพิ่ม 2026-10-17

ไม่มีแหล่งไหนให้ตัวอย่างเทรดครบตั้งแต่ต้นจนจบพร้อมราคาจริง และไม่มีสถิติ backtest เลย — ด้านล่างคือขั้นตอนที่ซ้ำกันหลายแหล่ง

**ขั้นตอนหลัก (เกือบทุกแหล่งตรงกัน):**
1. **ดู storyline บน TF ใหญ่ก่อน** (W/D หรือ M/W/D สาย Alchemist) ตัดสินว่าวันนี้หาแต่ซื้อ หรือหาแต่ขาย
   — บางสำนัก: ขาลงให้ "mark แต่แนวต้าน" ขาขึ้น "mark แต่แนวรับ" (pullbackforextrading)
2. **mark เส้นน้อยๆ** บน TF ใหญ่/กลาง (D/H4) แค่ 2–3 เส้นใกล้ราคา (pullbackforextrading, hoclamtrader) — ห้ามสร้างเส้นใหม่บน TF เข้า
3. **รอเฉยๆ จนราคามาถึงเส้น fresh ที่ตรงทิศ** — "อย่าเปิด TF เล็กจนกว่าราคาจะมาถึงเส้นที่ mark ไว้" (SOP มาเลย์)
   indicator หลายตัวมี alert "แตะเส้น fresh" ไว้ใช้ตรงนี้ (trading-guide MT, DoN_JCT)
4. **ลง TF เล็กหาสัญญาณยืนยัน** — คู่ TF ที่พบ: D→H1 ("ลง 2 TF"), H4→H1/M30/M15, H1+→M5/M1 (MQL5 Detector), W→D→H4→H1→M15
   สัญญาณ: pin bar, engulfing, doji/tweezer, ไส้ตีกลับ, LTF structure break
5. **เข้า → SL เลยไส้ rejection แรก / เลยเส้น → TP ที่เส้นตรงข้ามถัดไป** (RR ที่อ้าง: 1:1.5 คงที่ (ebook), ≥1:2–1:4 (crowinvesting), 1:5 (blog))
6. จด journal ทุกเทรด (hoclamtrader)

**แบบเข้าเทรด 2 แบบที่พบ:**
- **Reaction (เด้ง):** แตะเส้น fresh ตามทิศ + แท่งยืนยัน → เข้า (แบบที่ indicator เราทำอยู่)
- **Breakout + retest (SBR/RBS):** storyline เริ่ม (แตะ HTF แล้วตีกลับ) → รอ **H1 ทะลุ (BO)** → รอราคากลับมาแตะ **เส้น fresh ล่าสุด** แล้วเข้า
  (KororFX mentor doc) — มาเลย์บล็อกมี 2 ทางเลือก: เข้าทันทีแท่งถัดจากแท่งทะลุ หรือรอ retest แล้วค่อยเข้า (เลือกทางเดียว)

**กฎเสริมที่เจอ:**
- ถ้าแนวรับ fresh บน H1 ถูกทะลุ ห้ามซื้อที่แนวรับ H1 อื่นอีก ต้องขึ้นไปใช้ H4 (SnRNotes)
- setup เกรด A+ = Daily rejection + H4/H1 ทะลุ + เข้าที่ QM/apex, setup ต่อเทรนด์ = เส้น fresh H4 ที่ตรงกับ H1 (โน้ต MSnR Abdoulaye Aziz — ผู้ใช้ตัด QM ไปแล้ว)
- เส้นปัจจุบันทับเส้น HTF หรือ decision level = สัญญาณแรงสุด (DoN_JCT)
- ราคาที่ไม่ชัดว่าเทรนด์/ไซด์เวย์ = ไม่เทรด (hoclamtrader)

**แหล่งเพิ่ม:** DoN_JCT https://www.tradingview.com/script/KTVRYsRL/ ,
MQL5 Malaysian SNR Detector https://www.mql5.com/en/market/product/170486 ,
AlgoBot https://algobot.com/library/algobot-malaysian-snr-for-tradingview/ ,
hoclamtrader workflow https://hoclamtrader.com/en/msnr-trading-strategy/ ,
pullbackforextrading (มาเลย์) https://pullbackforextrading.com/cara-sebenar-menggunakan-snr-candlestick-dan-multi-timeframe/

## 11.6 จุดเข้า / SL / TP — ค้นเพิ่ม 2026-10-17 (ผู้ใช้สั่ง "เลิกเดา" — ด้านล่างคือสิ่งที่แต่ละแหล่งพูดจริงๆ ไม่มีการเลือกให้)

**ข้อสรุปตรงๆ: แหล่งสาธารณะฟรีไม่มีสูตร entry/SL/TP ชุดเดียวที่เป็นทางการ และไม่มีแหล่งไหนให้ backtest** — แต่ละแหล่งพูดไม่เหมือนกัน (RR ตั้งแต่ 1:1.5 ถึง 1:20)

| แหล่ง | ชนิด | จุดเข้า | SL | TP / RR |
|---|---|---|---|---|
| GitHub mdavidjeremiah (โค้ดเปิด อ่านสูตรจริงได้) | indicator ชุมชน | ราคาปิดของแท่ง reaction (ไส้เข้าเขต ±1 ATR แล้วปิดกลับฝั่งเดิม) ในทิศ storyline | ขอบเส้น − **0.25 × ATR(14)** (ไม่ใช่เลยไส้) | เส้น**ที่ยังไม่ถูกทะลุ**ฝั่งตรงข้ามที่**ใกล้ที่สุด** ไม่มีเส้น = RR 2 — ผู้เขียนเตือนเองว่ายังไม่มีสถิติ backtest |
| toby.fx1 (TikTok, OCL ขาลง) | เทรดเดอร์/ขายคอร์ส | รอแตะ OCL fresh + แท่งยืนยันขาลง ตามทิศ storyline | เหนือเส้น/โซน OCL "นิดเดียว" | เส้น fresh ถัดไป หรือ low สำคัญก่อนหน้า (ไม่ระบุ RR) |
| Alchemist checklist (Scribd, ผ่านผล search — ตัวเลขดูเป็นแม่แบบ) | โน้ตคอร์ส | zone → rejection → ยืนยัน (engulfing) → เข้า | เลยสวิง/ไส้ fakeout **10–15 pip** | **25–30 pip, RR ≥ 1:3**, ปิดบางส่วนที่ 1:2–1:3, trailing, เสี่ยง 2%/ไม้, ≤3 ไม้/วัน |
| slideshare (Malaysian SNR pdf) | โน้ตผสม SMC/ICT | เข้าจาก POI ของ TF ใหญ่ (Daily/H4) ช่วง London/NY | เหนือ rejection block, ตัวอย่าง **~3–5 pip**, ลดได้โดยวางเลยไส้ rejection | เล็ง external range liquidity — ตัวอย่างอ้าง **1:20, 17R, 32R** (ผู้เขียนแปลว่าเป็นตัวอย่าง ไม่ใช่กฎ) |
| AlgoBot (หน้าขาย indicator) | โฆษณา | — | "narrow stop-loss" | "potential big risk-to-reward" (ไม่ระบุตัวเลข) |
| pullbackforextrading (บล็อกมาเลย์) | บล็อก | H4 mark โซน → ลง H1/M30/M15 รอ pin bar/engulfing | อย่างต่ำ**เลยปลาย rejection แรก** | อ้าง RR ~1:5 ไม่มีวิธี |
| YouTube "Simplest MSNR Entry Model (1:8rrr Storyline Secret)" | วิดีโอ | อ่านเนื้อหาไม่ได้ (เห็นแต่ชื่อ) | — | ชื่อวิดีโออ้าง RR 1:8 |
| crowinvesting | บล็อก | H4 โซน fresh ตาม storyline → H1/M15 engulfing → เปิดแท่งถัดไป หรือ limit | ต่ำกว่า low ของโซน fresh (ขายกลับกัน) | **RR ≥ 1:2 ดีสุด 1:3–1:4** |
| ebook "Malaysian SNR Day Trading Strategy" (เห็นแต่คำโฆษณา) | หนังสือ | bias รายวัน | — | **RR คงที่ 1:1.5** |
| LuxAlgo / hoclamtrader | สารานุกรม/บล็อก | ไส้แตะเส้นแล้วปิดกลับฝั่งเดิม / trigger เช่น engulfing | เลยเส้น หรือเลย invalidation (จุดที่ไอเดียผิด) | เส้น fresh ถัดไป / ด่านตรงข้ามถัดไป ไม่มีตัวเลข RR |
| Studocu คอร์สฝรั่งเศส (ผ่านผล search — เลขในนั้นขัดกันเอง) | โน้ตคอร์ส | — | — | TP1 = ครึ่งทางไปแนวต้าน, TP2 = โซน H4 |
| Mr T / mentorship ทั่วไป | พอดแคสต์ | — | — | ไม่เปิดเผย (อ้างผลกำไรเอง ไม่พิสูจน์) |

**ที่ตรงกันทุกแหล่ง:** SL อยู่ "ติดเส้น/ติดไส้ rejection" ไม่ใช่ไกลออกไป · TP คือเส้น fresh ถัดไป หรือ liquidity ของ TF ใหญ่ · ต้องมีแท่งยืนยันก่อนเข้า
**ที่ขัดกัน:** ระยะ SL เป็นตัวเลขแน่นอน (pip / ATR) · RR ขั้นต่ำ (1:1.5 / 1:2 / 1:3) · TP เส้นใกล้ที่สุด หรือเส้นไกล/liquidity
**ที่ไม่มีใครบอก:** TF ที่ใช้เข้าที่แน่นอน (H1 / M15 / M5 / M1 ต่างกัน) · วิธีวัดผลที่พิสูจน์ได้ · SL เมื่อเข้า M1 เป็นกี่ pip

**หมายเหตุความผิดพลาดของผม:** ค่าเริ่มต้นเดิมใน `msnr.pine` (SL เลยเส้น + buffer ATR, TP เส้นที่ใกล้ที่สุด, สำรองด้วย RR คงที่) ตรงกับ indicator ของ GitHub mdavidjeremiah ตัวเดียว ซึ่งเป็นโค้ดของคนทำ indicator ไม่ใช่กฎของเทรดเดอร์ — ผมไม่ได้บอกผู้ใช้ตอนนั้น

## 12. จุดที่ต้องตัดสินใจถ้าจะเขียนลง Pine

ถ้าจะ implement ต้องเลือกเวอร์ชันให้ชัดก่อน (แต่ละข้อมีหลายคำตอบในแหล่งข้อมูล):
1. A/V แบบไหน — pivot มี lookback (ข้อ 2 A) หรือคู่แท่ง 2 แท่ง (B) หรือแถบปิด-เปิด (C)
2. Gap/OCL เส้นอยู่ราคาไหน — ปิดแท่งแรก / เปิดแท่งสอง / กลาง / ทั้งแถบ; ต้องมีช่องว่างจริงไหม
3. unfresh เมื่อไร — ไส้แตะครั้งเดียว / ตัวเทียนแตะ / แตะหลายครั้ง
4. ปิดทะลุแล้ว — fresh ใหม่ที่เดิม / flip เป็น SBR-RBS / ลบทิ้ง
5. นับ miss ไหม, กฎ "แตะครั้งแรกต้องเป็นไส้" ใช้ไหม
6. storyline แบบไหน (rejection+breakout / BOS-CHoCH / pivot หลาย TF) และใช้ TF ไหน
7. ใช้ TF ไหนคำนวณ level (TF ชาร์ต หรือ `request.security` จาก TF ใหญ่)

หมายเหตุ: การนับ "แตะ/ทะลุ" แบบ pattern "loop อัปเดตของเก่ารันก่อนสร้างของใหม่" ต้องระวังบั๊กพลาด 1 แท่ง
แบบที่เคยเจอใน `manageFvgTf` (ดู `CLAUDE.md` และ `bugs.md`)

---

## แหล่งข้อมูล

คำอธิบายวิธี:
- LuxAlgo — Malaysian SnR concept: https://www.luxalgo.com/library/concept/malaysian-snr/
- Hoc Lam Trader — MSNR zone framework: https://hoclamtrader.com/en/malaysian-support-and-resistance-msnr-zone-framework/
- Hoc Lam Trader — MSNR vs traditional SR: https://hoclamtrader.com/en/msnr-vs-random-support-and-resistance-key-differences/
- Crow Investing — MSNR trading explained: https://crowinvesting.com/guides/msnr-trading-explained/
- FOREXimf (อินโดฯ) — fakta & mitos: https://www.foreximf.com/blog/trading/malaysian-snr-trading-benarkah-strategi-ini-bisa-bikin-cuan-gila-gilaan-kupas-tuntas-fakta-mitosnya
- Grokipedia — Malaysian Support and Resistance: https://grokipedia.com/page/malaysian-support-and-resistance
- note.com — Alchemist SnR Part 1: https://note.com/murone169/n/n9fd33bf87d40
- videohighlight — Alchemist SNR Part 1 (สรุปวิดีโอ): https://videohighlight.com/v/Bwktah4s79k
- TradingNut podcast — Mr T: https://tradingnut.com/mr-t/
- TikTok toby.fx1 — MSNR at a glance / bearish OCL: https://www.tiktok.com/@toby.fx1/video/7608116772859890962 , https://www.tiktok.com/@toby.fx1/video/7598866511591116050
- Slideshare — Malaysian SNR pdf: https://www.slideshare.net/slideshow/8041707456492093639302-malaysian-snr-pdf/279734960
- Studocu / Scribd / CourseHero (โน้ตนักเรียน ส่วนใหญ่ติด paywall — อ้างผ่านข้อความที่ search engine ดึงมา)

Indicator (คำอธิบายจากผู้เขียน):
- trading-guide — Malaysian SnR Levels: https://www.tradingview.com/script/20NljIPT-Malaysian-SnR-Levels/
- trading-guide — Fixed Range: https://www.tradingview.com/script/KKLcgG6L-Malaysian-SNR-Levels-Fixed-Range/
- RWBTradeLab — MSnR Key Level [6 Types]: https://www.tradingview.com/script/erb7xGg9-MSnR-Key-Level-6-Types/
- zacdivan — Malaysian SnR + Storyline: https://www.tradingview.com/script/zHJLrkfS-Malaysian-SnR-Storyline/
- Wonra — Alchemist SNR Engine: https://www.tradingview.com/script/ANCSINu0-Wonra-Alchemist-SNR-Engine/
- Jithuze — MSNR Fresh Levels: https://www.tradingview.com/script/jYg6YsfN-MSNR-Jithuze-Fresh-Levels/
- DoN_JCT — Malaysian SnR and Decision Levels: https://www.tradingview.com/script/iWgxW7bW/
- GitHub mdavidjeremiah — Malaysian SnR Storyline (open source): https://github.com/mdavidjeremiah/Malaysian-SnR-Storyline-TradingView-Indicator
- MQL5 — Malaysian SNR Levels: https://www.mql5.com/en/market/product/115614
- MQL5 Vesath — MSNR Key Levels MTF: https://www.mql5.com/en/code/76993
