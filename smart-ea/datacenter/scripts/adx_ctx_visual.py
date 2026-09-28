r"""Phase 2 audit part 4 (by eye): draw random entries of the practice period with what ctx says, so a human can check that the numbers MEAN
what their descriptions say. Draws only bars closed before the entry (nothing after it, no outcome). Output: ctx_visual.html next to the DB.
Usage: python adx_ctx_visual.py [n=10] [seed=5]"""
import os, sys, sqlite3, html
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import numpy as np
import broker as BK, adx_ctx as X, adx_asof as AS

NS = int(sys.argv[1]) if len(sys.argv) > 1 else 10; SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 5
NY = ZoneInfo("America/New_York"); TH = timezone(timedelta(hours=7))
db = sqlite3.connect(AS.DBT)
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]
CT = np.array(db.execute("SELECT * FROM ctx WHERE entry_t < 1780272000 AND a_adr_days = 20 AND d_today_bars > 60 ORDER BY entry_t").fetchall(), dtype=float)
rng = np.random.default_rng(SEED); pick = np.sort(rng.choice(len(CT), NS, replace=False))
M = X.load(None)
BARS = {tf: X.resample(M, tf) for tf in (1, 5)}
ZZ = {tf: X.zigzag_state(BARS[tf], 3) for tf in (1, 5)}
WIN = {1: 150, 5: 110}

def f(v, d=2):
    return "—" if v is None or (isinstance(v, float) and np.isnan(v)) else (f"{int(v)}" if float(v).is_integer() and d == 0 else f"{v:.{d}f}")
REG = {1: "ขาขึ้น", -1: "ขาลง", 0: "sideway"}

def chart(tf, row):
    B = BARS[tf]; idx, pp, kind, conf, ncf, EP = ZZ[tf]; E = int(row["entry_t"])
    dE = X.sessions(np.array([E]))[1]; jB = int(X.last_closed(B, np.array([E]), dE)[0])
    a0 = max(0, jB - WIN[tf] + 1); js = np.arange(a0, jB + 1)
    q = int(ncf[jB]) - 1
    pv = [m for m in range(max(0, q - 12), q + 1) if idx[m] >= a0]
    now = M["c"][np.searchsorted(M["t"], int(row["m1_last_t"]))]
    lo_, hi_ = B["l"][js].min(), B["h"][js].max()
    ep = EP[jB]; levels = {}
    adr = row["a_adr_usd"]
    for name, key, colr in (("PDH", "d_pdh_adr", "#d97706"), ("PDL", "d_pdl_adr", "#d97706")):
        levels[name] = (now - row[key] * adr, colr)
    today = (M["day"] == dE[0]) & (M["t"] <= int(row["m1_last_t"]))
    eth = ((M["t"] - np.where(BK.us_dst(M["t"]), 4, 5) * 3600) // 3600) % 24
    asia = today & ((eth >= 17) | (eth < 3))
    if asia.any(): levels["Asia H"] = (M["h"][asia].max(), "#0d9488"); levels["Asia L"] = (M["l"][asia].min(), "#0d9488")
    span = hi_ - lo_; ylo, yhi = lo_ - 0.05 * span, hi_ + 0.05 * span
    notes = []
    for name, (v, _) in list(levels.items()):
        if v < lo_ - 0.6 * span or v > hi_ + 0.6 * span: notes.append(f"{name} {v:.2f} อยู่นอกกรอบกราฟ ({'สูงกว่า' if v > hi_ else 'ต่ำกว่า'})"); del levels[name]
        else: ylo, yhi = min(ylo, v - 0.03 * span), max(yhi, v + 0.03 * span)
    W, H, L, R, T, Bm = 880, 340, 8, 70, 12, 22
    n = len(js); bw = (W - L - R) / n
    X_ = lambda j: L + (j - a0 + 0.5) * bw
    Y = lambda p: T + (yhi - p) / (yhi - ylo) * (H - T - Bm)
    s = [f'<svg viewBox="0 0 {W} {H}" class="ch" role="img">']
    bn = row[f"f_m{tf}_box_n"]
    if bn and bn >= 1:
        b0 = jB - int(bn) + 1; bh, bl = B["h"][b0:jB + 1].max(), B["l"][b0:jB + 1].min()
        s.append(f'<rect x="{X_(b0) - bw / 2:.1f}" y="{Y(bh):.1f}" width="{(jB - b0 + 1) * bw:.1f}" height="{Y(bl) - Y(bh):.1f}" class="box"/>')
        s.append(f'<text x="{X_(b0) - bw / 2 + 3:.1f}" y="{Y(bh) - 3:.1f}" class="lb">กรอบ box_n={int(bn)} แท่ง</text>')
    for name, (v, colr) in levels.items():
        s.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{colr}" stroke-dasharray="5 4" stroke-width="1.2"/>'
                 f'<text x="{W - R + 3}" y="{Y(v) + 4:.1f}" fill="{colr}" class="lb">{name}</text>')
    for j in js:
        up = B["c"][j] >= B["o"][j]; cc = "var(--up)" if up else "var(--dn)"; x = X_(j)
        s.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{Y(B["h"][j]):.1f}" y2="{Y(B["l"][j]):.1f}" stroke="{cc}"/>')
        y1, y2 = Y(max(B["o"][j], B["c"][j])), Y(min(B["o"][j], B["c"][j]))
        s.append(f'<rect x="{x - bw * 0.35:.1f}" y="{y1:.1f}" width="{bw * 0.7:.1f}" height="{max(y2 - y1, 0.8):.1f}" fill="{cc}"/>')
    pts = [(X_(idx[m]), Y(pp[m])) for m in pv]
    if len(pts) > 1: s.append('<polyline points="' + " ".join(f"{x:.1f},{y:.1f}" for x, y in pts) + '" class="zz"/>')
    for m in pv:
        x, y = X_(idx[m]), Y(pp[m]); up = kind[m] > 0
        s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" class="pv"/><text x="{x:.1f}" y="{y + (-7 if up else 15):.1f}" class="lb" text-anchor="middle">{"H" if up else "L"}</text>')
    if q >= 0 and idx[q] >= a0:
        s.append(f'<line x1="{X_(idx[q]):.1f}" y1="{Y(pp[q]):.1f}" x2="{X_(jB):.1f}" y2="{Y(ep):.1f}" class="leg"/>'
                 f'<line x1="{X_(jB) - 12:.1f}" x2="{X_(jB) + 6:.1f}" y1="{Y(ep):.1f}" y2="{Y(ep):.1f}" class="leg2"/>'
                 f'<text x="{X_(jB) - 14:.1f}" y="{Y(ep) + (-5 if kind[q] < 0 else 12):.1f}" class="lb" text-anchor="end">จุดสุดของขาที่กำลังวิ่ง</text>')
    s.append(f'<circle cx="{W - R - 2}" cy="{Y(now):.1f}" r="4" class="now"/><text x="{W - R + 3}" y="{Y(now) - 6:.1f}" class="lb nowt">ราคาตอนเข้า</text>')
    s.append("</svg>")
    return "".join(s), notes

def table(rows):
    return "<table>" + "".join(f"<tr><td>{html.escape(a)}</td><td class='v'>{b}</td><td class='d'>{html.escape(c)}</td></tr>" for a, b, c in rows) + "</table>"

parts = []
for n_, r in enumerate(pick, 1):
    row = dict(zip(cols, CT[r])); E = int(row["entry_t"])
    tth = datetime.fromtimestamp(E, TH).strftime("%Y-%m-%d %H:%M"); tny = datetime.fromtimestamp(E, NY).strftime("%H:%M")
    ph = ["asia", "london", "newyork", "late"][int(row["t_phase"])]
    sec = [f'<section><h2>ตัวอย่าง {n_} · เข้าไม้ {tth} เวลาไทย (นิวยอร์ก {tny}, ช่วง {ph})</h2>']
    for tf in (5, 1):
        p = f"m{tf}k3"; svg, notes = chart(tf, row)
        reg = row[f"{p}_reg"]; ld = row[f"{p}_leg_dir"]
        rows = [
            ("สภาพตลาด M%d (zigzag 3 ATR)" % tf, REG.get(int(reg), "—") if reg == reg else "—", "ขาขึ้น = H 2 ตัวล่าสุดสูงขึ้นและ L 2 ตัวล่าสุดสูงขึ้น (ดูจุด H/L บนกราฟ)"),
            ("อยู่ในสภาพนี้มา", f(row[f"{p}_reg_age"], 0) + " นาที", "นับจากแท่งที่ยืนยัน pivot ที่ทำให้สภาพนี้เริ่ม"),
            ("ย่อ/เด้งไปแล้ว", f(row[f"{p}_n_sw"], 0) + " ขา", "pivot ที่ยืนยันเพิ่มหลังสภาพนี้เริ่ม"),
            ("ขาที่กำลังวิ่ง", ("ขึ้น" if ld > 0 else "ลง") + f" · {f(row[f'{p}_leg_atr'])} ATR", "เส้นประม่วงจาก pivot ล่าสุดถึงจุดสุดของขา"),
            ("ขานี้ ÷ ขาก่อน", f(row[f"{p}_leg_ratio"]), "< 1 = ยังไม่เลยจุดเริ่มของขาก่อน"),
            ("ถอยจากจุดสุด", f(row[f"{p}_retr_atr"]) + " ATR", "ระยะจากขีดจุดสุดถึงจุด 'ราคาตอนเข้า'"),
            ("ตำแหน่งเทียบ H/L ล่าสุด", f(row[f"{p}_rng_pos"]), "0 = ที่ L ล่าสุด, 1 = ที่ H ล่าสุด, >1 = เหนือ H"),
            ("กี่นาทีจาก pivot ล่าสุด", f(row[f"{p}_leg_min"], 0), ""),
            ("ATR M%d" % tf, "$" + f(row[f"a_m{tf}_atr_usd"]), "ความกว้างแท่งเฉลี่ย 20 แท่งล่าสุด"),
            ("กรอบ sideway ล่าสุด", f(row[f"f_m{tf}_box_n"], 0) + " แท่ง", "กรอบสีเทา: แท่งล่าสุดติดกันที่ high−low รวม ≤ 4 ATR"),
            ("แท่งใหญ่ล่าสุด", f(row[f"f_m{tf}_big_age"], 0) + " แท่งก่อน", "-1 = ไม่มีใน 1 วัน"),
            ("inside bar แท่งล่าสุด", "ใช่" if row[f"f_m{tf}_inside"] == 1 else "ไม่", ""),
        ]
        sec.append(f'<div class="pane"><h3>M{tf} — แท่งที่ปิดแล้วก่อนเข้าไม้เท่านั้น</h3>{svg}' +
                   ("".join(f'<p class="note">{html.escape(x)}</p>' for x in notes)) + table(rows) + "</div>")
    day = [("ตำแหน่งในกรอบวันนี้", f(row["d_day_pos"]), "0 = low ของวัน, 1 = high ของวัน (ถึงตอนเข้าไม้)"),
           ("เทียบ high เมื่อวาน", f(row["d_pdh_adr"]) + " ADR" + (" · ทะลุแล้ววันนี้" if row["d_broke_pdh"] == 1 else ""), "เส้นส้ม PDH"),
           ("เทียบ low เมื่อวาน", f(row["d_pdl_adr"]) + " ADR" + (" · ทะลุแล้ววันนี้" if row["d_broke_pdl"] == 1 else ""), "เส้นส้ม PDL"),
           ("กรอบเอเชีย", f(row["d_asia_rng_adr"]) + " ADR · ตำแหน่ง " + f(row["d_asia_pos"]) + (" · จบแล้ว" if row["d_asia_done"] == 1 else " · ยังอยู่ในช่วงเอเชีย"), "เส้นเขียวอมฟ้า Asia H/L"),
           ("gap เปิดวัน", f(row["d_gap_adr"], 3) + " ADR · " + ("ปิดแล้ว" if row["d_gap_filled"] == 1 else "ยังไม่ปิด"), ""),
           ("ADR", "$" + f(row["a_adr_usd"]) + f" ({f(row['a_adr_pct'])}% ของราคา)", "")]
    sec.append('<div class="pane"><h3>ระดับวัน</h3>' + table(day) + "</div></section>")
    parts.append("".join(sec))

page = f"""<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ctx visual check</title><style>
:root{{--bg:#fbfaf7;--fg:#1f2328;--mut:#6b7280;--line:#e5e7eb;--up:#16a34a;--dn:#dc2626;--card:#fff}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#16181c;--fg:#e6e6e6;--mut:#9ca3af;--line:#2d3139;--up:#22c55e;--dn:#f87171;--card:#1d2026}}}}
body{{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif;margin:0 auto;max-width:960px;padding:16px}}
h1{{font-size:20px}}h2{{font-size:16px;margin:28px 0 8px;border-top:1px solid var(--line);padding-top:16px}}h3{{font-size:14px;margin:12px 0 4px;color:var(--mut)}}
.pane{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}}
.ch{{width:100%;height:auto}} .zz{{fill:none;stroke:#2563eb;stroke-width:1.3}} .pv{{fill:#2563eb}} .leg{{stroke:#9333ea;stroke-width:1.6;stroke-dasharray:6 4}}
.leg2{{stroke:#9333ea;stroke-width:2.5}} .now{{fill:var(--fg)}} .box{{fill:#9ca3af;fill-opacity:.22;stroke:#9ca3af}} .lb{{font-size:11px;fill:var(--mut)}} .nowt{{fill:var(--fg)}}
table{{border-collapse:collapse;width:100%;font-size:13px}} td{{border-top:1px solid var(--line);padding:3px 6px;vertical-align:top}} td.v{{white-space:nowrap;font-weight:600}} td.d{{color:var(--mut)}}
.note{{color:#d97706;font-size:12px;margin:2px 0}} ul{{color:var(--mut)}}
</style></head><body>
<h1>ตรวจด้วยตา: สภาพตลาดตอนเข้าไม้ (ตาราง ctx)</h1>
<p>สุ่ม {NS} เวลาเข้าไม้จากสนามซ้อม (ก่อน 1 มิ.ย. 2026) · แสดงเฉพาะแท่งที่ปิดแล้วก่อนเข้าไม้ ไม่มีผลไม้/อนาคต · ตัวเลขในตารางอ่านจาก ctx ตรงๆ ส่วนกราฟวาดจากแท่งดิบ</p>
<ul><li>จุด H/L สีน้ำเงิน = pivot zigzag 3 ATR ที่ยืนยันแล้ว — เช็คว่าสภาพ ขึ้น/ลง/sideway ตรงกับลำดับ H/L</li>
<li>เส้นประม่วง = ขาที่กำลังวิ่งจาก pivot ล่าสุด, ขีดม่วง = จุดสุดของขานี้ — เช็คทิศ/ระยะ และ "ถอยจากจุดสุด"</li>
<li>กรอบเทา = กรอบ sideway ล่าสุด (box_n แท่ง) · เส้นส้ม = high/low เมื่อวาน · เส้นเขียวอมฟ้า = กรอบเอเชียวันนี้ · จุดดำ = ราคาตอนเข้า</li></ul>
{''.join(parts)}</body></html>"""
out = os.path.join(os.path.dirname(AS.DBT), "ctx_visual.html")
with open(out, "w", encoding="utf-8") as fh: fh.write(page)
print(out)
