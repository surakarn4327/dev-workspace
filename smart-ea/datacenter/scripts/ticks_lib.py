r"""Real ticks dumped by research\TickDump.mq5 (Common\Files\adxres\ticks\ticks_YYYYMM.bin, 16-byte records: int64 time_msc,
int32 bid points, int32 ask points). Server clock of Exness = UTC."""
import os, glob, numpy as np
import broker as BK
TDIR = os.path.join(os.environ["APPDATA"], r"MetaQuotes\Terminal\Common\Files\adxres\ticks")
DT = np.dtype([("msc", "<i8"), ("bid", "<i4"), ("ask", "<i4")])

def load(months=None):
    fs = sorted(glob.glob(os.path.join(TDIR, "ticks_*.bin")))
    if months: fs = [f for f in fs if os.path.basename(f)[6:12] in months]
    a = np.concatenate([np.fromfile(f, DT) for f in fs])
    return a

def minute_bars(a):
    """bid OHLC per minute from ticks (to compare with bars_m1)"""
    m = a["msc"] // 60000
    st = np.r_[0, np.flatnonzero(np.diff(m)) + 1]
    b = a["bid"].astype(np.int64)
    return dict(t=m[st] * 60, o=b[st], h=np.maximum.reduceat(b, st), l=np.minimum.reduceat(b, st), c=b[np.r_[st[1:], len(b)] - 1])
