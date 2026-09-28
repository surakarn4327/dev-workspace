"""Write .set files for AdxEmaVolReTF verification runs (re-entry off, vol sizing off, fixed $100 risk, no late-entry rule)."""
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sets"); os.makedirs(OUT, exist_ok=True)
# name: tf, adx, ema, minadx, gap, sl, exit
SETS = {
    "v_m1_a8e40_l":  (1, 8, 40, 29.0, 9.2, 8.0, "L"),
    "v_m1_a14e5_t3": (1, 14, 5, 0.0, 0.0, 4.0, "T3"),
    "v_m3_a14e5_t3": (3, 14, 5, 0.0, 0.0, 4.0, "T3"),
    "v_m3_a28e40_l": (3, 28, 40, 29.0, 9.2, 12.0, "L"),
    "v_m5_a8e40_l":  (5, 8, 40, 29.0, 9.2, 8.0, "L"),
    "v_m5_a28e5_t3": (5, 28, 5, 0.0, 9.2, 12.0, "T3"),
}
for name, (tf, ap, ep, ma, gp, sl, ex) in SETS.items():
    fix_tp = 3 * sl if ex == "T3" else 20.0
    kv = [("InpTradeTF", tf), ("InpADXPeriod", ap), ("InpEmaPeriod", ep), ("InpMinADXLevel", ma), ("InpMinDiGap", gp),
          ("InpATRPeriod", 84), ("InpSLAtrMult", sl), ("InpFixRRTpAtrMult", fix_tp), ("InpTp1AtrMult", 15.0), ("InpTp2AtrMult", 17.0),
          ("InpTp3AtrMult", 21.0), ("InpDynTpMinAtrMult", 11.0), ("InpDynTpMaxAtrMult", 31.0), ("InpExitOnMomentumLoss", "false"),
          ("InpTpMode", 1 if ex == "L" else 0), ("InpRiskMode", 1), ("InpRiskPct", 5.0), ("InpRiskFixedUsd", 100.0),
          ("InpRiskPointUnit", 1), ("InpMagic", 20260930), ("InpUseCutoff", "true"), ("InpCutoffServerHour", 16),
          ("InpTradeStartServerHour", 23), ("InpNoEntryBeforeCutoffMin", 0), ("InpUseVolSizing", "false"), ("InpVolSizeWindow", 10),
          ("InpVolSizeBaseBars", 1440), ("InpVolSizeThreshold", 0.9), ("InpVolSizeLow", 0.5), ("InpVolSizeHigh", 1.5),
          ("InpUseAdaptiveReentry", "false"), ("InpReentryHalfLife", 20), ("InpReentryMinSamples", 10), ("InpReentryResetYearly", "true"),
          ("InpMinTrades", 30), ("InpMinProfit", 0), ("InpDumpPasses", "false"), ("InpShowChartObjects", "false"),
          ("InpShowDashboard", "false"), ("InpSummaryEveryMin", 0), ("InpSummaryOnlyTradeHours", "true")]
    with open(os.path.join(OUT, name + ".set"), "w", encoding="utf-8", newline="") as f:
        f.write("\r\n".join(f"{k}={v}" for k, v in kv) + "\r\n")
print("wrote", len(SETS), "sets to", OUT)
