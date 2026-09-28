"""Load M1 bars dumped by BarDump.mq5 (CSV per year in MT5 Common\Files\<bardump_common_subdir>) into the active broker's bars file
(deduped, sorted). Times stay in the broker's server clock here; dc_build.py converts to UTC via broker.py."""
import os, glob
import numpy as np
import broker as BK
COMMON = os.path.expandvars(r"%APPDATA%\MetaQuotes\Terminal\Common\Files\\" + BK.P["bardump_common_subdir"])
parts = [np.loadtxt(f, delimiter=",", skiprows=1) for f in sorted(glob.glob(os.path.join(COMMON, "bars_y*.csv")))]
a = np.concatenate(parts)
t, k = np.unique(a[:, 0].astype(np.int64), return_index=True)
a = a[k]
np.savez_compressed(BK.BARS, t=t, o=a[:, 1], h=a[:, 2], l=a[:, 3], c=a[:, 4], tv=a[:, 5], sp=a[:, 6])
print(BK.NAME, len(t), "bars", t[0], t[-1], "->", BK.BARS)
