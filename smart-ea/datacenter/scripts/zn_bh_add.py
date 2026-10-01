r"""Step 4 follow-up: does a behaviour add anything BEYOND being in that zone? For every named label row of zn_bh_eval_m<tf>.csv:
add = excess(label) - excess('any' stretch bar of the same TF / group / direction / measure); conservative SE = sqrt(se_label^2 + se_any^2)
(se = |excess / t|; the rows overlap, so the true SE is smaller -> t_add is conservative). hit1 rows: only dir = rev (brk is its mirror).
Output zn\zn_bh_add.txt"""
import csv, os, math
OUT = r"C:\trade datacenter\zn"; txt = []
def say(s=""): print(s); txt.append(s)
for tf in (1, 3, 5):
    R = list(csv.DictReader(open(os.path.join(OUT, f"zn_bh_eval_m{tf}.csv"), encoding="utf-8")))
    any_ = {(r["group"], r["dir"], r["meas"]): r for r in R if r["kind"] == "named" and r["label"] == "any"}
    res = []
    for r in R:
        if r["kind"] != "named" or r["label"] == "any" or (r["meas"] == "hit1" and r["dir"] == "brk"): continue
        a = any_.get((r["group"], r["dir"], r["meas"]))
        if not a or float(r["t"]) == 0 or float(a["t"]) == 0: continue
        se = abs(float(r["excess"]) / float(r["t"])); sa = abs(float(a["excess"]) / float(a["t"]))
        add = float(r["excess"]) - float(a["excess"]); t = add / math.sqrt(se ** 2 + sa ** 2)
        res.append((t, add, r, a))
    n = len(res); big = [x for x in res if abs(x[0]) >= 3]
    say(f"M{tf}: {n} label tests | |t_add| >= 3: {len(big)} | >= 2: {sum(abs(x[0]) >= 2 for x in res)} (independent-test chance ~{0.0027 * n:.1f} / {0.0455 * n:.1f})")
    for t, add, r, a in sorted(big, key=lambda x: -abs(x[0]))[:15]:
        say(f"   {r['group']:11s} {r['label']:13s} {r['dir']} {r['meas']:11s} n {r['n']} mean {float(r['mean']):+.3f} (any {float(a['mean']):+.3f}) excess {float(r['excess']):+.3f} vs any {float(a['excess']):+.3f} add {add:+.3f} t {t:+.1f} gates-all {r['all']}")
open(os.path.join(OUT, "zn_bh_add.txt"), "w", encoding="utf-8").write("\n".join(txt))
