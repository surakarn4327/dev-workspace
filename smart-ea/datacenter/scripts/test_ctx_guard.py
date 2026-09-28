r"""Test: adx_ctx.build() must refuse when gold_dc.sqlite and the bars file (used by adx_build.py) do not hold the same bars
(simulates 'new bars added, only one of the two rebuilt'). Writes nothing: the build stops before writing. Usage: python test_ctx_guard.py"""
import numpy as np
import adx_ctx

real = np.load(adx_ctx.BK.BARS)
fake = {k: real[k] for k in real.files}
fake["c"] = fake["c"].copy(); fake["c"][-1] += 1.0              # the bars file has a changed last bar (as after a new BarDump)
orig = adx_ctx.np.load
adx_ctx.np.load = lambda *a, **k: fake
try:
    adx_ctx.build(log=lambda *a: None); print("BAD: build did not stop on differing bars"); raise SystemExit(1)
except RuntimeError as e:
    print("OK  build refused:", str(e)[:120])
finally:
    adx_ctx.np.load = orig
