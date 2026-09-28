r"""Same visual check as adx_ctx_visual.py, but written as PNG images (pure numpy + zlib, no plotting library) so they can be opened
anywhere, including by Claude's image reader. One PNG per sample and TF + a text file with the ctx values to compare.
Colours: candles green/red, pivot HIGH = blue dot, pivot LOW = cyan dot, zigzag = blue line, running leg = purple dashed + purple tick at
its extreme, sideway box = grey band, yesterday high/low = orange dashed, asia high/low = teal dashed, entry price = black dot at the right edge.
Usage: python adx_ctx_png.py [n=10] [seed=5] [outdir]"""
import os, sys, zlib, struct, sqlite3
from datetime import datetime, timezone, timedelta
import numpy as np
import broker as BK, adx_ctx as X, adx_asof as AS

NS = int(sys.argv[1]) if len(sys.argv) > 1 else 10; SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 5
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(AS.DBT), "ctx_png")
os.makedirs(OUT, exist_ok=True)
TH = timezone(timedelta(hours=7)); W, H = 1000, 460; L, R, T, B_ = 10, 20, 10, 10
COL = dict(bg=(255, 255, 255), up=(22, 163, 74), dn=(220, 38, 38), hi=(37, 99, 235), lo=(6, 182, 212), zz=(96, 140, 235), leg=(147, 51, 234),
           box=(150, 150, 150), pd=(217, 119, 6), asia=(13, 148, 136), now=(0, 0, 0))

def png(img, path):
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(img.shape[0]))
    def ch(t, d): c = struct.pack(">I", len(d)) + t + d; return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", img.shape[1], img.shape[0], 8, 2, 0, 0, 0)) +
                ch(b"IDAT", zlib.compress(raw, 6)) + ch(b"IEND", b""))

class Canvas:
    def __init__(s): s.a = np.full((H, W, 3), 255, np.uint8)
    def px(s, x, y, c, alpha=1.0):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H: s.a[y, x] = (np.array(c) * alpha + s.a[y, x] * (1 - alpha)).astype(np.uint8)
    def line(s, x0, y0, x1, y1, c, dash=0, w=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for i in range(n):
            if dash and (i // (dash * 2)) % 2: continue
            x = x0 + (x1 - x0) * i / max(n - 1, 1); y = y0 + (y1 - y0) * i / max(n - 1, 1)
            for dx in range(-(w // 2), w - w // 2): s.px(x + dx, y, c); s.px(x, y + dx, c)
    def rect(s, x0, y0, x1, y1, c, alpha=1.0):
        xa, xb = sorted((int(round(x0)), int(round(x1)))); ya, yb = sorted((int(round(y0)), int(round(y1))))
        xa, xb, ya, yb = max(xa, 0), min(xb, W - 1), max(ya, 0), min(yb, H - 1)
        if xb >= xa and yb >= ya:
            s.a[ya:yb + 1, xa:xb + 1] = (np.array(c) * alpha + s.a[ya:yb + 1, xa:xb + 1] * (1 - alpha)).astype(np.uint8)
    def dot(s, x, y, r, c):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r: s.px(x + dx, y + dy, c)

db = sqlite3.connect(AS.DBT)
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]
CT = np.array(db.execute("SELECT * FROM ctx WHERE entry_t < 1780272000 AND a_adr_days = 20 AND d_today_bars > 60 ORDER BY entry_t").fetchall(), dtype=float)
pick = np.sort(np.random.default_rng(SEED).choice(len(CT), NS, replace=False))
M = X.load(None); BARS = {tf: X.resample(M, tf) for tf in (1, 5)}; ZZ = {tf: X.zigzag_state(BARS[tf], 3) for tf in (1, 5)}; WIN = {1: 150, 5: 110}
eth_all = ((M["t"] - np.where(BK.us_dst(M["t"]), 4, 5) * 3600) // 3600) % 24
txt = []
for n_, r in enumerate(pick, 1):
    row = dict(zip(cols, CT[r])); E = int(row["entry_t"]); dE = X.sessions(np.array([E]))[1]
    now = M["c"][np.searchsorted(M["t"], int(row["m1_last_t"]))]; adr = row["a_adr_usd"]
    today = (M["day"] == dE[0]) & (M["t"] <= int(row["m1_last_t"])); asia = today & ((eth_all >= 17) | (eth_all < 3))
    lv = {"PDH": (now - row["d_pdh_adr"] * adr, COL["pd"]), "PDL": (now - row["d_pdl_adr"] * adr, COL["pd"])}
    if asia.any(): lv["AsiaH"] = (M["h"][asia].max(), COL["asia"]); lv["AsiaL"] = (M["l"][asia].min(), COL["asia"])
    txt.append(f"=== sample {n_}: entry {datetime.fromtimestamp(E, TH):%Y-%m-%d %H:%M} Thai, entry price (last M1 close) {now:.3f}")
    txt.append("  day: day_pos %.3f pdh_adr %.3f (PDH %.2f) pdl_adr %.3f (PDL %.2f) broke_pdh %d broke_pdl %d asia_pos %s asia_done %d gap_adr %.3f gap_filled %d" % (
        row["d_day_pos"], row["d_pdh_adr"], lv["PDH"][0], row["d_pdl_adr"], lv["PDL"][0], row["d_broke_pdh"], row["d_broke_pdl"],
        f"{row['d_asia_pos']:.3f}", row["d_asia_done"], row["d_gap_adr"], row["d_gap_filled"]))
    for tf in (5, 1):
        B = BARS[tf]; idx, pp, kind, conf, ncf, EP = ZZ[tf]
        jB = int(X.last_closed(B, np.array([E]), dE)[0]); a0 = max(0, jB - WIN[tf] + 1); js = np.arange(a0, jB + 1); q = int(ncf[jB]) - 1
        pv = [m for m in range(max(0, q - 12), q + 1) if idx[m] >= a0]; ep = EP[jB]
        lo_, hi_ = B["l"][js].min(), B["h"][js].max(); span = hi_ - lo_; ylo, yhi = lo_ - 0.04 * span, hi_ + 0.04 * span
        vis = {k: v for k, v in lv.items() if lo_ - 0.6 * span <= v[0] <= hi_ + 0.6 * span}
        for v, _ in vis.values(): ylo, yhi = min(ylo, v - 0.02 * span), max(yhi, v + 0.02 * span)
        bw = (W - L - R) / len(js); Xp = lambda j: L + (j - a0 + 0.5) * bw; Yp = lambda p: T + (yhi - p) / (yhi - ylo) * (H - T - B_)
        cv = Canvas(); bn = row[f"f_m{tf}_box_n"]
        if bn >= 1:
            b0 = jB - int(bn) + 1; cv.rect(Xp(b0) - bw / 2, Yp(B["h"][b0:jB + 1].max()), Xp(jB) + bw / 2, Yp(B["l"][b0:jB + 1].min()), COL["box"], 0.25)
        for v, c in vis.values(): cv.line(L, Yp(v), W - R, Yp(v), c, dash=6)
        for j in js:
            c = COL["up"] if B["c"][j] >= B["o"][j] else COL["dn"]; x = Xp(j)
            cv.line(x, Yp(B["h"][j]), x, Yp(B["l"][j]), c)
            cv.rect(x - bw * 0.33, Yp(max(B["o"][j], B["c"][j])), x + bw * 0.33, Yp(min(B["o"][j], B["c"][j])), c)
        for m0, m1 in zip(pv[:-1], pv[1:]): cv.line(Xp(idx[m0]), Yp(pp[m0]), Xp(idx[m1]), Yp(pp[m1]), COL["zz"])
        for m in pv: cv.dot(Xp(idx[m]), Yp(pp[m]), 5, COL["hi"] if kind[m] > 0 else COL["lo"])
        if q >= 0 and idx[q] >= a0:
            cv.line(Xp(idx[q]), Yp(pp[q]), Xp(jB), Yp(ep), COL["leg"], dash=5, w=2); cv.line(Xp(jB) - 18, Yp(ep), Xp(jB) + 8, Yp(ep), COL["leg"], w=3)
        cv.dot(W - R + 6, Yp(now), 6, COL["now"])
        path = os.path.join(OUT, f"s{n_:02d}_m{tf}.png"); png(cv.a, path)
        p = f"m{tf}k3"
        piv = " ".join(f"{'H' if kind[m] > 0 else 'L'}{pp[m]:.2f}@{datetime.fromtimestamp(int(B['t_last'][idx[m]]), TH):%H:%M}" for m in range(max(0, q - 3), q + 1))
        txt.append(f"  M{tf}: {os.path.basename(path)} | reg {row[p + '_reg']:.0f} n_sw {row[p + '_n_sw']:.0f} leg_dir {row[p + '_leg_dir']:+.0f} leg_atr {row[p + '_leg_atr']:.2f} "
                   f"leg_ratio {row[p + '_leg_ratio']:.2f} retr_atr {row[p + '_retr_atr']:.2f} rng_pos {row[p + '_rng_pos']:.2f} leg_min {row[p + '_leg_min']:.0f} "
                   f"box_n {bn:.0f} inside {row[f'f_m{tf}_inside']:.0f} big_age {row[f'f_m{tf}_big_age']:.0f} | ATR {row[f'a_m{tf}_atr_usd']:.2f} extreme {ep:.2f} "
                   f"| last 4 pivots {piv} | levels in view: {', '.join(vis) or '-'}; out of view: {', '.join(k for k in lv if k not in vis) or '-'}")
with open(os.path.join(OUT, "values.txt"), "w", encoding="utf-8") as f: f.write("\n".join(txt))
print(OUT)
