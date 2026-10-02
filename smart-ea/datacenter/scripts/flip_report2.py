import pickle, numpy as np
import flip_report as F
src = r"C:\trade datacenter\flip_events_real_all.pkl"
real_path = r"C:\trade datacenter\flip_events_real.pkl"
import shutil, os
shutil.copy(real_path, real_path + ".bak")
shutil.copy(src, real_path)
try:
    A = F.load("real")
finally:
    shutil.copy(real_path + ".bak", real_path); os.remove(real_path + ".bak")
import datetime
d0 = (datetime.date(2026,1,1)-datetime.date(1970,1,1)).days; dX = (datetime.date(2026,6,1)-datetime.date(1970,1,1)).days
periods = {"1 ม.ค.-ปัจจุบัน": A["day"] >= d0, "ม.ค.-พ.ค. 69 (สนามซ้อม)": (A["day"] >= d0) & (A["day"] < dX), "มิ.ย.-ปัจจุบัน 69 (ข้อสอบ)": A["day"] >= dX}
lastday = int(A["day"].max()); print("latest event day:", datetime.date(1970,1,1)+datetime.timedelta(days=lastday), "events total", len(A["day"]))
for pn, pm in periods.items():
    print(f"\n######## {pn} ########")
    for rule in ("any1","high","user","high_high"):
        m = F.sel_rule(A, rule) & pm
        out = []
        for name in ("d_u","d_w"):
            mu,se,t,n,nd = F.cl_stat(A[name][m], A["day"][m]); out.append(f"{name} {mu:+.3f} (t{t:+.1f})")
        print(f"  {F.LABEL[rule]:52s} n {int(m.sum()):6d} days {len(np.unique(A['day'][m])):3d} | " + "  ".join(out) + f" | plan {A['r_plan'][m].mean():+.2f} cut {A['r_cut'][m].mean():+.2f} new {A['r_new'][m].mean():+.2f}")
    m = F.sel_rule(A, "user") & pm
    print("  เคสผู้ใช้ แยก:", end=" ")
    for lab, mm in (("BUY", m&(A["dT"]==1)),("SELL", m&(A["dT"]==-1)),("M1", m&(A["tf"]==1)),("M3", m&(A["tf"]==3)),("M5", m&(A["tf"]==5))):
        mu,se,t,n,nd = F.cl_stat(A["d_u"][mm], A["day"][mm]); print(f"{lab} {mu:+.3f}(t{t:+.1f},n{n})", end="  ")
    print()
    cs = np.unique(A["combo"][m]); print("  combos บวก:", f"{np.mean([A['d_u'][m&(A['combo']==c)].mean()>0 for c in cs]):.0%} of {len(cs)}")
    for a,b in [(-9,0),(0,0.5),(0.5,9)]:
        mm = m & (A["r_cut"]>=a) & (A["r_cut"]<b); r=F.cl_stat(A["d_u"][mm], A["day"][mm]); print(f"  r_cut[{a:+.1f},{b:+.1f}) n {r[3]:6d} d_u {r[0]:+.3f} (t{r[2]:+.1f})")
    # per month
if True:
    print("\nรายเดือน (เคสผู้ใช้, d_u):")
    m = F.sel_rule(A, "user") & (A["day"] >= d0)
    days = A["day"]; 
    for mo in range(1, 10):
        a = (datetime.date(2026,mo,1)-datetime.date(1970,1,1)).days; b = (datetime.date(2026,mo+1,1)-datetime.date(1970,1,1)).days if mo<12 else a+31
        mm = m & (days>=a) & (days<b)
        if mm.sum()>50:
            r=F.cl_stat(A["d_u"][mm], days[mm]); print(f"  2026-{mo:02d}: n {r[3]:6d} d_u {r[0]:+.3f} (t{r[2]:+.1f})")
