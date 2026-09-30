r"""Compare the pattern-outcome library results of M1 / M3 / M5 (po_eval2_m<tf>.csv). Output: po\po_tf_compare.txt
1. per family x mode (ctx none): best cell by mean R and by excess over the random-direction market, per TF
2. break of yesterday's high/low (pdx, with the break) for the no-TP cells and the wick stop, per TF
3. cells with mean R > 0, excess > 0 and t_excess >= 3 (not necessarily every gate) per TF
4. cells that pass G1..G4 with excess < 0 (avoid) that appear on >= 2 TFs (same fam/mode/ctx)"""
import csv, os
D = r"C:\trade datacenter\po"; TFS = (1, 3, 5)
T = {tf: list(csv.DictReader(open(os.path.join(D, f"po_eval2_m{tf}.csv"), encoding="utf-8"))) for tf in TFS}
def f(x):
    try: return float(x)
    except: return float("nan")
out = []
def say(s=""): print(s); out.append(s)
for tf in TFS:
    r = T[tf]; say(f"M{tf}: cells {len(r)}  G1 {sum(x['G1']=='True' for x in r)}  all gates {sum(x['all']=='True' for x in r)}  mean R>0 cells {sum(f(x['mean_R'])>0 for x in r)}  "
                   f"mean R>0 & excess>0 & t>=3: {sum(f(x['mean_R'])>0 and f(x['excess'])>0 and f(x['t_excess'])>=3 for x in r)}")
say("\n== 1. ctx none: best cell by mean R per family x mode ==")
say("fam       mode     " + "".join(f"| M{tf}: cell / n/day / win / R / null / t".ljust(58) for tf in TFS))
for fam in ("big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdx", "dayext", "asia"):
    for mode in ("with", "against"):
        line = f"{fam:9s} {mode:8s}"
        for tf in TFS:
            c = [x for x in T[tf] if x["fam"] == fam and x["mode"] == mode and x["ctx"] == "none"]
            b = max(c, key=lambda x: f(x["mean_R"]))
            line += f"| {b['cell']:13s} {f(b['per_day']):5.2f} {f(b['winrate']):.0%} {f(b['mean_R']):+.3f} {f(b['null_R']):+.3f} {f(b['t_excess']):+.1f}".ljust(58)
        say(line)
say("\n== 2. break of yesterday high/low, trade WITH it, ctx none ==")
for cell in ("SL0.5_TPnone", "SL1_TPnone", "SL2_TPnone", "SL3_TPnone", "SLwick_TP1R", "SLwick_TP2R", "SLwick_TP4R", "trail1", "trail2", "SL1_TP4R", "SL2_TP4R"):
    line = f"{cell:14s}"
    for tf in TFS:
        x = [y for y in T[tf] if y["fam"] == "pdx" and y["mode"] == "with" and y["ctx"] == "none" and y["cell"] == cell]
        if x:
            x = x[0]; line += f"| M{tf} n/d {f(x['per_day']):.2f} win {f(x['winrate']):.0%} R {f(x['mean_R']):+.3f} null {f(x['null_R']):+.3f} t {f(x['t_excess']):+.1f} h {f(x['h1']):+.2f}/{f(x['h2']):+.2f} b/s {f(x['buy']):+.2f}/{f(x['sell']):+.2f} ".ljust(100)
    say(line)
say("\n== 3. mean R > 0, excess > 0, t_excess >= 3 (top 25 per TF by t; gates shown G1G2G3G4) ==")
for tf in TFS:
    c = sorted([x for x in T[tf] if f(x["mean_R"]) > 0 and f(x["excess"]) > 0 and f(x["t_excess"]) >= 3], key=lambda x: -f(x["t_excess"]))
    say(f"M{tf}: {len(c)} cells")
    for x in c[:25]:
        g = "".join("1" if x[k] == "True" else "0" for k in ("G1", "G2", "G3", "G4"))
        say(f"  {x['fam']:8s} {x['mode']:7s} {x['ctx']:11s} {x['cell']:14s} n/d {f(x['per_day']):5.2f} win {f(x['winrate']):.0%} R {f(x['mean_R']):+.3f} null {f(x['null_R']):+.3f} rnd {f(x['random_R']):+.3f} t {f(x['t_excess']):+.1f} h {f(x['h1']):+.2f}/{f(x['h2']):+.2f} b/s {f(x['buy']):+.2f}/{f(x['sell']):+.2f} G{g}")
say("\n== 4. excess < 0 with t <= -3.5: fam/mode ctx-none count per TF (avoid), and which appear on all three TFs ==")
av = {}
for tf in TFS:
    for x in T[tf]:
        if f(x["t_excess"]) <= -3.5 and x["ctx"] == "none": av.setdefault((x["fam"], x["mode"]), {}).setdefault(tf, 0); av[(x["fam"], x["mode"])][tf] += 1
for k, v in sorted(av.items()): say(f"  {k[0]:9s} {k[1]:8s} cells with t<=-3.5 (ctx none): " + "  ".join(f"M{tf}:{v.get(tf, 0)}" for tf in TFS))
say("\n== 5. with-the-pattern excess by family: median t_excess over all ctx none cells per TF (positive = pattern direction beats random-direction market) ==")
import statistics as st
for fam in ("big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdx", "dayext", "asia"):
    for mode in ("with", "against"):
        say(f"  {fam:9s} {mode:8s} " + "  ".join(f"M{tf}: median t {st.median([f(x['t_excess']) for x in T[tf] if x['fam']==fam and x['mode']==mode and x['ctx']=='none']):+.2f} median excess {st.median([f(x['excess']) for x in T[tf] if x['fam']==fam and x['mode']==mode and x['ctx']=='none']):+.3f}" for tf in TFS))
open(os.path.join(D, "po_tf_compare.txt"), "w", encoding="utf-8").write("\n".join(out))
