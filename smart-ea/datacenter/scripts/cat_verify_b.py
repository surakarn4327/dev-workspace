"""Independent checks for catalog part B.
1) level visits: bar-by-bar state machine (no shared code) for R10/PDH/PDL on 10 random sessions vs table counts per outcome
2) boxes: every stored box re-validated from raw TF bars (height <= 4 ATR at start, >= 20 bars, inside one session, exit direction)
3) trends: re-derive runs from the pivots table with a different loop and compare counts per TF"""
import numpy as np, sqlite3
import cat_bars as CB
db = sqlite3.connect(CB.DB); M = CB.m1(); t, h, l, c, sid, day = (M[x] for x in ("t", "h", "l", "c", "sid", "day"))
B5 = CB.tf_bars(5); a5 = np.full(len(t), np.nan)
for k in range(len(B5["t"])): a5[B5["m1_start"][k]:B5["m1_end"][k]] = B5["atr"][k]
FULLSET = set(CB.full_list().tolist())
rng = np.random.default_rng(9); sids = [s for s in np.unique(sid) if int(day[np.flatnonzero(sid == s)[-1]]) in FULLSET]
pick = rng.choice(sids, 10, replace=False); agree = {}
prev_hl = {}
for s in np.unique(sid):
    w = np.flatnonzero(sid == s)
    prev_hl[s] = (h[w].max(), l[w].min())
ss = sorted(prev_hl)
for s in pick:
    w = np.flatnonzero(sid == s); dk = int(day[w[-1]]); i_prev = ss.index(s) - 1
    levels = [(g, "R10") for g in np.arange(np.floor(l[w].min() / 10) * 10, h[w].max() + 10, 10) if g % 50 != 0]
    if i_prev >= 0: levels += [(prev_hl[ss[i_prev]][0], "PDH"), (prev_hl[ss[i_prev]][1], "PDL")]
    for L, typ in levels:
        state = None; side = 0; touched = False; poked = False
        for i in w:
            a = a5[i]
            if not np.isfinite(a): continue
            d = (c[i] - L) / a
            if abs(d) >= 1:
                sd = 1 if d > 0 else -1
                if state == "armed":
                    if sd != side: agree.setdefault((typ, "CROSS"), [0, 0])[0] += 1
                    elif touched: agree.setdefault((typ, "POKE" if poked else "BOUNCE"), [0, 0])[0] += 1
                state = "armed"; side = sd; touched = False; poked = False
            elif state == "armed":
                if l[i] <= L + 0.25 * a and h[i] >= L - 0.25 * a: touched = True
                if (c[i] - L) * side < -0.25 * a: poked = True
        for out in ("BOUNCE", "POKE", "CROSS"):
            pass
    for typ in ("R10", "PDH", "PDL"):
        for out in ("BOUNCE", "POKE", "CROSS"):
            n = db.execute("SELECT COUNT(*) FROM level_visits WHERE level_type=? AND outcome=? AND day=?", (typ, out, dk)).fetchone()[0]
            agree.setdefault((typ, out), [0, 0])[1] += n
print("1) level visits, 10 random sessions (R10 excludes R50/R100 multiples):")
for k, (a, b) in sorted(agree.items()): print(f"   {k[0]:4s} {k[1]:6s} recount {a:4d} table {b:4d} {'OK' if a == b else 'DIFF'}")
print("2) boxes re-validation:")
for tf in (1, 5, 15):
    B = B5 if tf == 5 else CB.tf_bars(tf); pos = {int(x): i for i, x in enumerate(B["t_open"])}; endpos = {int(x): i for i, x in enumerate(B["t"])}
    bad = 0; X = db.execute("SELECT t_start, t_end, bars, exit FROM boxes WHERE tf=?", (tf,)).fetchall()
    for ts, te, nb, ex in X:
        i, j = pos[ts], endpos[te]; a = B["atr"][i]
        H_ = B["h"][i:j + 1].max() - B["l"][i:j + 1].min()
        okk = (j - i + 1 == nb) and nb >= 20 and H_ <= 4 * a + 1e-9 and len(set(B["sid"][i:j + 1])) == 1
        if ex != "END": okk &= (B["sid"][j + 1] == B["sid"][j]) and (max(B["h"][i:j + 2]) - min(B["l"][i:j + 2]) > 4 * a)
        bad += not okk
    print(f"   M{tf}: {len(X)} boxes, violations {bad}")
print("3) trend runs re-derived from pivots:")
for tf in (1, 5, 15):
    P = np.array(db.execute("SELECT price FROM pivots WHERE tf=? ORDER BY t_pivot", (tf,)).fetchall())[:, 0]
    flag = np.sign(P[2:] - P[:-2])                     # +1 pivot beyond previous same-kind pivot upward, -1 downward
    runs = []; cur_s = 0; n = 0
    for f in flag:
        if f == cur_s and f != 0: n += 1
        else:
            if n >= 2: runs.append(n)
            cur_s = f; n = 1 if f != 0 else 0
    if n >= 2: runs.append(n)
    tb = db.execute("SELECT COUNT(*) FROM trends WHERE tf=?", (tf,)).fetchone()[0]
    print(f"   M{tf}: recount {len(runs)} table {tb} {'OK' if len(runs) == tb else 'DIFF'}")
