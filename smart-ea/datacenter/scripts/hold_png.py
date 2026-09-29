r"""Phase 3B-a visual check: PNG per sample trade (pure numpy + zlib) + values.txt, so a human (or Claude's image reader) can see that the
decision points, events and alternative exits sit where the definitions say. Sandbox only.
Picture: candles of the trade's OWN TF (green up / red down) · entry = black dot · SL = red dashed · TP1/TP2/TP3 = green dashed (T3: one line) ·
entry price = grey line · yesterday high/low = orange dotted · Asia high/low (after Asia) = teal dotted · confirmed zigzag-3 pivots = blue (high) /
cyan (low) dots, pivot CONFIRMATION bar = small blue tick at the bottom · decision rows = ticks on the top strip: grey = checkpoint only,
orange = footprint, blue = structure, magenta = level (several kinds stack upwards) · the highlighted decision = black vertical line ·
its alternatives: cut = orange disc at the decision price, BE exit = purple disc, hold exit = navy disc, plan exit = black X.
Usage: python hold_png.py [outdir]"""
import os, sys, zlib, struct, sqlite3
from datetime import datetime, timezone, timedelta
import numpy as np
import broker as BK, adx_ctx as X, hold_lib as H, hold_build as HB

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HB.OUT), "hold_png")
os.makedirs(OUT, exist_ok=True)
TH = timezone(timedelta(hours=7)); W, Hh = 1100, 520; L, R, T, B_ = 10, 20, 40, 14
C = dict(up=(22, 163, 74), dn=(220, 38, 38), sl=(220, 38, 38), tp=(22, 140, 60), ent=(150, 150, 150), pd=(217, 119, 6), asia=(13, 148, 136),
         hi=(37, 99, 235), lo=(6, 182, 212), fp=(245, 140, 0), st=(37, 99, 235), lv=(200, 0, 200), ck=(185, 185, 185), cut=(245, 140, 0),
         be=(147, 51, 234), hold=(20, 30, 120), k=(0, 0, 0))

def png(img, path):
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(img.shape[0]))
    def ch(t, d): c = struct.pack(">I", len(d)) + t + d; return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", img.shape[1], img.shape[0], 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw, 6)) + ch(b"IEND", b""))

class Cv:
    def __init__(s): s.a = np.full((Hh, W, 3), 255, np.uint8)
    def px(s, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < Hh: s.a[y, x] = c
    def line(s, x0, y0, x1, y1, c, dash=0, w=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for i in range(n):
            if dash and (i // (dash * 2)) % 2: continue
            x = x0 + (x1 - x0) * i / max(n - 1, 1); y = y0 + (y1 - y0) * i / max(n - 1, 1)
            for dd in range(w): s.px(x + dd, y, c); s.px(x, y + dd, c)
    def rect(s, x0, y0, x1, y1, c):
        xa, xb = sorted((int(round(x0)), int(round(x1)))); ya, yb = sorted((int(round(y0)), int(round(y1))))
        s.a[max(ya, 0):min(yb, Hh - 1) + 1, max(xa, 0):min(xb, W - 1) + 1] = c
    def dot(s, x, y, r, c):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r: s.px(x + dx, y + dy, c)
    def cross(s, x, y, r, c):
        for i in range(-r, r + 1): s.px(x + i, y + i, c); s.px(x + i, y - i, c); s.px(x + i + 1, y + i, c); s.px(x + i + 1, y - i, c)

db = sqlite3.connect(HB.OUT); db.execute(f"ATTACH DATABASE '{X.DBT}' AS T")
UT = {r[0]: r for r in db.execute("SELECT uid, tf, exit_mode, entry_t, exit_t, day, dir, entry_px, sl_px, tp1_px, tp2_px, tp3_px, risk_px FROM utrades")}
first = {}
for s_, n_, u_ in db.execute("SELECT set_id, n, uid FROM set_map"): first.setdefault(u_, (s_, n_))
WANT = [("M1 ladder, TP1 reached while open", "u.tf = 1 AND u.exit_mode = 'L' AND d.n_tp_hit = 1"),
        ("M3 T3 SELL with BE applicable", "u.tf = 3 AND u.exit_mode = 'T3' AND u.dir = -1 AND d.r_be IS NOT NULL"),
        ("M5 ladder with a box break", "u.tf = 5 AND u.exit_mode = 'L' AND (d.flags & 64) != 0"),
        ("M1 with a yesterday-high/low break", "u.tf = 1 AND (d.flags & 384) != 0"),
        ("M3 with an Asia-range break", "u.tf = 3 AND (d.flags & 6144) != 0"),
        ("M5 with a new day high/low after 60 min", "u.tf = 5 AND (d.flags & 1536) != 0"),
        ("M1 with BE exit at entry (be_reason 1)", "u.tf = 1 AND d.be_reason = 1 AND d.n_tp_hit = 0"),
        ("M3 hold exits at cutoff", "u.tf = 3 AND d.hold_reason = 3")]
M = H.load_ctx_bars(); SLv = H.sessions_levels(M); EVT = {tf: H.tf_events(M, tf, SLv) for tf in H.TFS}
ZZ = {tf: X.zigzag_state(EVT[tf]["B"], H.ZZ_K) for tf in H.TFS}
rng = np.random.default_rng(11); txt = []
GRP = [(C["fp"], ("big", "pin", "vspike", "inside")), (C["st"], ("pivot", "regime", "boxbreak")),
       (C["lv"], ("pdh", "pdl", "dayhigh", "daylow", "asiahigh", "asialow"))]
for n_, (title, cond) in enumerate(WANT, 1):
    cand = db.execute(f"SELECT d.uid, d.dec_t FROM dec d JOIN utrades u USING(uid) WHERE {cond} AND (u.exit_t - u.entry_t) <= u.tf * 60 * 150 "
                      f"LIMIT 400").fetchall()
    uid, D0 = cand[int(rng.integers(len(cand)))]
    U = UT[uid]; tf = U[1]; d = U[6]; Ev = EVT[tf]; Bb = Ev["B"]; rows = db.execute("SELECT * FROM dec WHERE uid = ? ORDER BY dec_t", (uid,)).fetchall()
    dcols = [r[1] for r in db.execute("PRAGMA table_info(dec)")]; rows = [dict(zip(dcols, r)) for r in rows]
    hl = next(r for r in rows if r["dec_t"] == D0)
    s_, nn = first[uid]; exit_px = db.execute("SELECT exit_px FROM T.trades WHERE set_id = ? AND n = ?", (s_, nn)).fetchone()[0]
    b0 = int(np.searchsorted(Bb["t_open"], U[3])); last_t = max(U[4], hl["hold_exit_t"], hl["be_exit_t"] or 0)
    b1 = int(np.searchsorted(Bb["t_open"], last_t, "right")); a0 = max(0, b0 - 30); a1 = min(len(Bb["c"]), b1 + 10); js = np.arange(a0, a1)
    sess = np.searchsorted(SLv["ss"], np.searchsorted(M["t"], Bb["t_open"][b0]), "right") - 1
    lev = [U[8], U[11], U[7]] + ([U[9], U[10]] if U[2] == "L" else [])
    extra = {"PDH": SLv["pdh"][sess], "PDL": SLv["pdl"][sess], "AsiaH": SLv["ah"][sess], "AsiaL": SLv["al"][sess]}
    lo_, hi_ = Bb["l"][js].min(), Bb["h"][js].max()
    for v in lev: lo_, hi_ = min(lo_, v), max(hi_, v)
    span = hi_ - lo_; vis = {k: v for k, v in extra.items() if np.isfinite(v) and lo_ - 0.3 * span <= v <= hi_ + 0.3 * span}
    for v in vis.values(): lo_, hi_ = min(lo_, v), max(hi_, v)
    ylo, yhi = lo_ - 0.03 * (hi_ - lo_), hi_ + 0.03 * (hi_ - lo_)
    bw = (W - L - R) / len(js); Xp = lambda j: L + (j - a0 + 0.5) * bw; Yp = lambda p: T + (yhi - p) / (yhi - ylo) * (Hh - T - B_)
    xt = lambda ts: Xp(int(np.searchsorted(Bb["t_open"], ts, "right")) - 1 + ((ts % (tf * 60)) / (tf * 60)))
    cv = Cv()
    for k, v in vis.items(): cv.line(L, Yp(v), W - R, Yp(v), C["pd"] if k.startswith("PD") else C["asia"], dash=1)
    cv.line(Xp(b0), Yp(U[7]), W - R, Yp(U[7]), C["ent"])
    cv.line(Xp(b0), Yp(U[8]), W - R, Yp(U[8]), C["sl"], dash=4)
    for v in lev[3:] + [U[11]]: cv.line(Xp(b0), Yp(v), W - R, Yp(v), C["tp"], dash=4)
    for j in js:
        o, c, h, l = Bb["o"][j], Bb["c"][j], Bb["h"][j], Bb["l"][j]; col = C["up"] if c >= o else C["dn"]; x = Xp(j)
        cv.line(x, Yp(h), x, Yp(l), col); cv.rect(x - max(bw * 0.3, 0.5), Yp(max(o, c)), x + max(bw * 0.3, 0.5), Yp(min(o, c)), col)
    idx, pp, kind, conf, ncf, EP = ZZ[tf]
    for q in np.flatnonzero((conf >= a0) & (conf < a1) & (idx >= a0)):
        cv.dot(Xp(idx[q]), Yp(pp[q]), 3, C["hi"] if kind[q] > 0 else C["lo"]); cv.line(Xp(conf[q]), Hh - 12, Xp(conf[q]), Hh - 2, C["hi"], w=2)
    for r in rows:                                                     # top strip: the TF bar that just closed = the bar before the decision tick
        bi = int(np.searchsorted(Bb["t_open"], r["dec_t"], "left")) - 1; x = Xp(bi); fl = r["flags"]; y = 4
        if fl == H.BIT["check"]: cv.line(x, 4, x, 10, C["ck"]); continue
        for col, names in GRP:
            if any(fl & H.BIT[nm] for nm in names): cv.rect(x - 1, y, x + 1, y + 8, col); y += 10
    xd = xt(hl["dec_t"]); cv.line(xd, T, xd, Hh - B_, C["k"])
    px = U[7] + hl["open_r"] * U[12] * d
    cv.dot(xd, Yp(px), 5, C["cut"])
    if hl["be_exit_t"]: cv.dot(xt(hl["be_exit_t"]), Yp(U[7] if hl["be_reason"] == 1 else U[11]), 5, C["be"])
    cv.dot(xt(hl["hold_exit_t"]), Yp(U[8]) if hl["hold_reason"] == 1 else Yp(px), 5, C["hold"])
    cv.cross(xt(U[4]), Yp(exit_px), 6, C["k"]); cv.dot(Xp(b0) - bw * 0.5, Yp(U[7]), 4, C["k"])
    png(cv.a, os.path.join(OUT, f"trade_{n_}.png"))
    ft = lambda ts: datetime.fromtimestamp(ts, TH).strftime("%m-%d %H:%M") if ts else "-"
    txt.append(f"=== trade_{n_}.png — {title}: uid {uid}, M{tf} {U[2]} {'BUY' if d > 0 else 'SELL'}, entry {ft(U[3])} (Thai) @ {U[7]:.3f}, "
               f"SL {U[8]:.3f}, TP {U[9]:.3f}/{U[10]:.3f}/{U[11]:.3f}, 1R = {U[12]:.3f}, plan exit {ft(U[4])} @ {exit_px:.3f}")
    txt.append("    levels: " + ", ".join(f"{k} {v:.3f}" for k, v in extra.items() if np.isfinite(v)))
    txt.append(f"    highlighted decision {ft(hl['dec_t'])} bar_n {hl['bar_n']}: events " + ",".join(n for n in H.EV if hl["flags"] & H.BIT[n]) +
               f" | price {px:.3f} open_r {hl['open_r']:.3f} realized {hl['realized_r']:.3f} tp_hit {hl['n_tp_hit']} rem {hl['rem']:.3f} "
               f"mfe {hl['mfe_r']:.3f} mae {hl['mae_r']:.3f} to_SL {hl['dist_sl_r']:.3f} to_TP {hl['dist_tp_r']:.3f} min_to_cut {hl['min_to_cut']}")
    txt.append(f"    alternatives: plan {hl['r_plan']:.3f} | cut {hl['r_cut']:.3f} | BE {hl['r_be'] if hl['r_be'] is None else round(hl['r_be'], 3)} "
               f"(exit {ft(hl['be_exit_t'])}, reason {hl['be_reason']}) | hold {hl['r_hold']:.3f} (exit {ft(hl['hold_exit_t'])}, reason {hl['hold_reason']})")
    txt.append("    all decision rows: " + "; ".join(f"{ft(r['dec_t'])[6:]} " + ",".join(n for n in H.EV if r['flags'] & H.BIT[n]) for r in rows))
with open(os.path.join(OUT, "values.txt"), "w", encoding="utf-8") as f: f.write("\n".join(txt) + "\n")
print("written", OUT)
