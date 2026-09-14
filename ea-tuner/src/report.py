"""อ่านไฟล์ผล .csv จาก optimizer/results/ แล้วประกอบเป็นหน้าเว็บสรุปเดียว (self-contained HTML)

ผังคอลัมน์ของไฟล์ pass-per-row: [พารามิเตอร์ ...] + 17 คอลัมน์ตัวชี้วัดท้ายบรรทัด
(มาจาก MetricsCsvTail() ใน smart-ea/src/TesterMetrics.mqh) — ต่างกลยุทธ์มีจำนวน
คอลัมน์พารามิเตอร์ไม่เท่ากัน ea-tuner จึงไม่พยายามรู้ความหมายของแต่ละคอลัมน์พารามิเตอร์
(ต่างจาก optimizer/bin/show-results.ps1 ที่นิยาม layout ตายตัวต่อกลยุทธ์) แค่แสดงมัน
เป็น Param1..N เพื่อให้ใช้ได้กับ EA ใหม่ในอนาคตโดยไม่ต้องแก้ ea-tuner
"""
from __future__ import annotations

import html
import json
import time
from datetime import datetime
from pathlib import Path

import config

METRIC_NAMES = [
    "deposit", "trades", "profit", "dd", "pf", "payoff",
    "winrate", "months", "posMonths", "posPct", "worstMonth", "medianMonth",
    "shareNet", "shareGross", "holdH", "maxLossStreak", "score",
]
N_METRICS = len(METRIC_NAMES)


def parse_pass_csv(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = line.strip().rstrip(";")
        if not line:
            continue
        fields = line.split(";")
        if len(fields) < N_METRICS:
            continue
        params = fields[:-N_METRICS]
        metrics_raw = fields[-N_METRICS:]
        metrics = {}
        for name, val in zip(METRIC_NAMES, metrics_raw):
            try:
                metrics[name] = float(val)
            except ValueError:
                metrics[name] = 0.0
        rows.append({"params": params, **metrics})
    return rows


def parse_period_summary(path: Path) -> list[tuple[str, float, int]]:
    """อ่านไฟล์ผลของ run-weekly-reset.ps1 / run-monthly-reset.ps1: label;profit;trades ต่อบรรทัด"""
    out = []
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(";")
        if len(parts) < 3:
            continue
        label, profit, trades = parts[0], parts[1], parts[2]
        try:
            out.append((label, float(profit), int(trades)))
        except ValueError:
            continue
    return out


def parse_monthly_series(path: Path) -> list[tuple[str, float, int]]:
    """อ่านไฟล์ WriteMonthlySeries (yyyy-MM;profit;trades) — รูปแบบเดียวกับ period summary พอดี"""
    return parse_period_summary(path)


_CSS = """
:root{
  --bg:#EDF0F1; --surface:#FFFFFF; --sunk:#E3E8EA;
  --ink:#10181B; --muted:#5B6A70; --faint:#8B989D;
  --line:#D3DBDD; --line-soft:#E4EAEB;
  --accent:#8A5A12; --accent-ink:#6E470D; --accent-soft:#F3E7D1;
  --good:#136E49; --bad:#A43124;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0E1417; --surface:#161E21; --sunk:#121A1D;
    --ink:#E6EDEF; --muted:#8FA0A6; --faint:#68787E;
    --line:#263136; --line-soft:#1E272B;
    --accent:#D9A441; --accent-ink:#E8BC68; --accent-soft:#2E2616;
    --good:#4FB98A; --bad:#E1755F;
  }
}
*{box-sizing:border-box}
body{background:var(--bg); color:var(--ink); font-family:system-ui,sans-serif; margin:0;
     line-height:1.6}
.wrap{max-width:1180px; margin:0 auto; padding:28px 20px 70px; display:flex;
      flex-direction:column; gap:32px}
h1{font-size:22px; margin:0}
h2{font-size:16px; margin:0}
.runbar{display:flex; flex-wrap:wrap; gap:6px 22px; font-family:ui-monospace,monospace;
        font-size:12px; color:var(--muted); border-top:1px solid var(--line); padding-top:12px}
.runbar b{color:var(--ink)}
.card{background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px 18px}
.stats{display:grid; grid-template-columns:repeat(6,1fr); gap:1px; background:var(--line);
       border:1px solid var(--line); border-radius:10px; overflow:hidden}
@media (max-width:900px){ .stats{grid-template-columns:repeat(3,1fr)} }
.st{background:var(--surface); padding:12px 14px; display:flex; flex-direction:column; gap:4px}
.st .k{font-size:11px; color:var(--muted)}
.st .v{font-family:ui-monospace,monospace; font-size:19px; font-weight:600}
.pos{color:var(--good)} .neg{color:var(--bad)}
.bars{display:flex; align-items:flex-end; gap:4px; height:180px; padding:10px 4px 0;
      border-bottom:1px solid var(--line); overflow-x:auto}
.bcol{display:flex; flex-direction:column; align-items:center; gap:4px; min-width:34px; flex:1}
.bcol .b{width:100%; border-radius:3px 3px 0 0; min-height:2px}
.bcol .lab{font-size:10px; color:var(--muted); writing-mode:vertical-rl; text-orientation:mixed;
           max-height:70px}
.bcol .val{font-size:10px; font-family:ui-monospace,monospace; white-space:nowrap}
table.plain{border-collapse:collapse; width:100%; font-size:13px}
table.plain th, table.plain td{padding:6px 10px; text-align:right; border-bottom:1px solid var(--line-soft)}
table.plain th:first-child, table.plain td:first-child{text-align:left}
table.plain thead th{font-size:11px; color:var(--muted); font-weight:500;
                      border-bottom:1px solid var(--line)}
.grid{border:1px solid var(--line); border-radius:10px; overflow:auto; max-height:640px}
.grid table{border-collapse:separate; border-spacing:0; width:100%; min-width:700px; font-size:12.5px}
.grid th, .grid td{padding:6px 10px; text-align:right; white-space:nowrap;
                    border-bottom:1px solid var(--line-soft); font-family:ui-monospace,monospace}
.grid th:first-child, .grid td:first-child{text-align:left; position:sticky; left:0;
                    background:var(--surface)}
.grid thead th{position:sticky; top:0; background:var(--sunk); cursor:pointer; user-select:none;
               font-size:10.5px; color:var(--muted); z-index:2}
.grid thead th:first-child{z-index:3}
.grid tbody tr:hover td{background:var(--sunk)}
.empty{padding:30px; text-align:center; color:var(--muted)}
.note{color:var(--muted); font-size:12.5px}
"""


def _fmt_money(v: float) -> str:
    sign = "-" if v < 0 else ""
    return f"{sign}{abs(v):,.0f}"


def _bars_html(rows: list[tuple[str, float, int]], unit_label: str, total_label: str) -> str:
    if not rows:
        return '<p class="empty">ไม่มีข้อมูล</p>'
    max_abs = max(abs(p) for _, p, _ in rows) or 1
    cols = []
    for label, profit, trades in rows:
        h = max(2, int(abs(profit) / max_abs * 150))
        color = "var(--good)" if profit >= 0 else "var(--bad)"
        cols.append(
            f'<div class="bcol"><div class="val">{_fmt_money(profit)}</div>'
            f'<div class="b" style="height:{h}px;background:{color}"></div>'
            f'<div class="lab">{html.escape(label)}</div></div>'
        )
    total = sum(p for _, p, _ in rows)
    total_trades = sum(t for _, _, t in rows)
    body = (
        f'<div class="bars">{"".join(cols)}</div>'
        f'<p class="note">รวม {len(rows)} {unit_label} · {total_label} '
        f'<b class="{"pos" if total>=0 else "neg"}">{_fmt_money(total)}</b> · '
        f'{total_trades:,} ไม้</p>'
    )
    return body


_METRIC_LABELS = [
    "ไม้", "กำไร", "DD", "PF", "payoff", "winrate", "เดือนทั้งหมด",
    "เดือนกำไร", "%เดือนกำไร", "เดือนแย่สุด", "ไม้ใหญ่สุด/กำไร",
    "ถือ(ชม.)", "แพ้ติดกัน", "คะแนน",
]
_SHOW_METRIC_IDX = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16]  # ดัชนีใน METRIC_NAMES


def _table_and_script(rows: list[dict], table_id: str) -> tuple[str, str, int]:
    """สร้าง <table> + <script> คู่หนึ่ง คืน (html, script, n_params) — แยก id ตาม table_id
    เพื่อให้วางสองตาราง (genetic กับ neighbor-verify) ในหน้าเดียวกันได้โดยไม่ชนกัน"""
    n_params = max((len(r["params"]) for r in rows), default=0)
    data = [r["params"] + [""] * (n_params - len(r["params"])) + [r[m] for m in METRIC_NAMES]
            for r in rows]

    if not rows:
        return '<p class="empty">ไม่มีข้อมูล</p>', "", n_params

    fixed_labels = ["Symbol", "TF"][:min(n_params, config.PARAM_PREFIX_COLS)]
    param_headers = fixed_labels + [
        f"Param{i+1}" for i in range(max(0, n_params - len(fixed_labels)))
    ]
    head_cells = "".join(f'<th data-i="{i}">{html.escape(h)}</th>' for i, h in enumerate(param_headers))
    head_cells += "".join(
        f'<th data-i="{n_params + idx}">{h}</th>' for idx, h in zip(_SHOW_METRIC_IDX, _METRIC_LABELS)
    )
    table_html = f"""
    <div class="grid">
      <table>
        <thead><tr id="head{table_id}">{head_cells}</tr></thead>
        <tbody id="body{table_id}"></tbody>
      </table>
    </div>
    <p class="note">กดหัวคอลัมน์เพื่อเรียง · {len(rows)} ชุด · Param1..{n_params} คือพารามิเตอร์ตามลำดับใน
      .set ของ EA นี้ (เปิด .set คู่กับตารางนี้เพื่อเทียบลำดับ)</p>
    """
    script = f"""
(function() {{
  const DATA = {json.dumps(data)};
  const N_PARAMS = {n_params};
  const SCORE_COL = N_PARAMS + 16;
  let sortCol = SCORE_COL, sortDir = -1;
  function fmt(v) {{
    if (typeof v !== 'number') return v;
    return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2);
  }}
  function render() {{
    const body = document.getElementById('body{table_id}');
    if (!body) return;
    const rows = DATA.slice().sort((a,b) => {{
      const x = a[sortCol], y = b[sortCol];
      if (x < y) return -1*sortDir; if (x > y) return 1*sortDir; return 0;
    }});
    const showIdx = {_SHOW_METRIC_IDX}.map(i => N_PARAMS + i);
    const cols = [...Array(N_PARAMS).keys(), ...showIdx];
    body.innerHTML = rows.map(r =>
      '<tr>' + cols.map(i => `<td>${{fmt(r[i])}}</td>`).join('') + '</tr>'
    ).join('') || '<tr><td class="empty">ไม่มีข้อมูล</td></tr>';
  }}
  const head = document.getElementById('head{table_id}');
  if (head) {{
    head.addEventListener('click', e => {{
      const th = e.target.closest('th'); if (!th) return;
      const i = parseInt(th.dataset.i, 10);
      if (sortCol === i) sortDir *= -1; else {{ sortCol = i; sortDir = -1; }}
      render();
    }});
  }}
  render();
}})();
"""
    return table_html, script, n_params


def _stat_cells(best: dict) -> str:
    stat_defs = [
        ("ไม้", f"{best['trades']:,.0f}"),
        ("กำไรสุทธิ", _fmt_money(best["profit"])),
        ("ขาดทุนสูงสุด", _fmt_money(best["dd"])),
        ("PF", f"{best['pf']:.2f}"),
        ("winrate", f"{best['winrate']*100:.1f}%"),
        ("เดือนที่กำไร", f"{best['posMonths']:.0f}/{best['months']:.0f}"),
    ]
    return "".join(
        f'<div class="st"><div class="k">{k}</div><div class="v">{v}</div></div>'
        for k, v in stat_defs
    )


def render_report(
    *,
    title: str,
    ea_name: str,
    symbol: str,
    period: str,
    mode: str,
    date_from: str,
    date_to: str,
    model_label: str,
    pass_rows: list[dict] | None = None,
    verified_rows: list[dict] | None = None,
    holdout_row: dict | None = None,
    period_rows: list[tuple[str, float, int]] | None = None,
    period_unit: str = "งวด",
    monthly_rows: list[tuple[str, float, int]] | None = None,
) -> str:
    pass_rows = pass_rows or []
    verified_rows = verified_rows or []

    table1_html, script1, _ = _table_and_script(pass_rows, "1")
    table2_html, script2, _ = _table_and_script(verified_rows, "2") if verified_rows else ("", "", 0)

    best_genetic = max(pass_rows, key=lambda r: r["score"]) if pass_rows else None
    best_verified = max(verified_rows, key=lambda r: r["score"]) if verified_rows else None
    # ค่าที่ควรใช้จริง: ถ้ามีรอบตรวจสอบเพื่อนบ้าน (exhaustive) ใช้ผู้ชนะของรอบนั้นเสมอ
    # เพราะรอบ genetic สุ่มมาแค่บางส่วนของกริด ผู้ชนะอาจเป็นแค่จุดฟลุก
    best = best_verified or best_genetic

    verify_callout = ""
    if best_verified and best_genetic:
        same = best_verified["params"] == best_genetic["params"]
        verify_callout = f"""
        <section>
          <div class="card" style="border-left:3px solid var(--accent)">
            <h2>ผลตรวจสอบเพื่อนบ้าน (รอบ exhaustive รอบที่ 2)</h2>
            <p class="note">รอบแรก (genetic) สุ่มทดสอบแค่บางส่วนของกริดทั้งหมด ผู้ชนะรอบนั้นอาจเป็นจุดฟลุก —
              รอบนี้ไล่ครบทุกจุด ±1 ขั้นรอบค่าที่ชนะรอบแรก เพื่อดูว่าเป็น "ที่ราบ" จริงหรือ "ยอดแหลม"
              เดี่ยวๆ ค่าที่ควรเอาไปใช้จริงคือผู้ชนะของรอบนี้ ไม่ใช่รอบแรก</p>
            <p>คะแนนรอบแรก (genetic): <b>{best_genetic['score']:.3f}</b> ·
               คะแนนสูงสุดในรอบเพื่อนบ้าน (exhaustive): <b>{best_verified['score']:.3f}</b> ·
               {'<span class="pos">ค่าเดิมยืนยันแล้วว่าเป็นจุดดีที่สุดในละแวกนี้จริง</span>' if same else
                '<span class="neg">ค่าที่ดีที่สุดขยับจากรอบแรก — แปลว่ารอบแรกยังไม่ใช่จุดที่ดีที่สุดในละแวกนั้น</span>'}
            </p>
          </div>
        </section>
        """

    holdout_section = ""
    if holdout_row and best_verified:
        passed = holdout_row["profit"] > 0 and holdout_row["pf"] >= 1.0
        verdict = (
            "ผ่าน — ยังทำกำไรได้จริงบนช่วงที่ไม่เคยใช้เลือกค่าเลย"
            if passed else
            "ไม่ผ่าน — อย่าเอาค่านี้ไปใช้จริง ต้องจูนใหม่หรือทบทวนตรรกะ ไม่ใช่แค่ขยับพารามิเตอร์"
        )
        holdout_section = f"""
        <section>
          <div class="card" style="border-left:3px solid var(--{'good' if passed else 'bad'})">
            <h2>ตรวจสอบ holdout (ช่วงล่าสุดที่ไม่เคยใช้เลือกค่าเลยทั้งสองขั้นที่แล้ว)</h2>
            <p class="note">ห้ามเอาผลตรงนี้กลับไปเลือกค่าใหม่ — แค่ไว้ยืนยัน/ปฏิเสธค่าที่ได้จากขั้นตรวจสอบ
              เพื่อนบ้านเท่านั้น ถ้าเอาไปเลือกค่าต่อ ช่วงนี้ก็จะกลายเป็นข้อมูลที่ใช้จูนไปด้วย
              แล้วจะไม่เหลืออะไรไว้ตรวจสอบอีกเลย</p>
            <table class="plain">
              <thead><tr><th></th><th>ช่วง train (ตรวจสอบเพื่อนบ้าน)</th><th>ช่วง holdout (ล่าสุด)</th></tr></thead>
              <tbody>
                <tr><td>ไม้</td><td>{best_verified['trades']:,.0f}</td><td>{holdout_row['trades']:,.0f}</td></tr>
                <tr><td>กำไรสุทธิ</td><td>{_fmt_money(best_verified['profit'])}</td><td>{_fmt_money(holdout_row['profit'])}</td></tr>
                <tr><td>PF</td><td>{best_verified['pf']:.2f}</td><td>{holdout_row['pf']:.2f}</td></tr>
                <tr><td>winrate</td><td>{best_verified['winrate']*100:.1f}%</td><td>{holdout_row['winrate']*100:.1f}%</td></tr>
                <tr><td>เดือนที่กำไร</td><td>{best_verified['posMonths']:.0f}/{best_verified['months']:.0f}</td>
                    <td>{holdout_row['posMonths']:.0f}/{holdout_row['months']:.0f}</td></tr>
              </tbody>
            </table>
            <p style="margin-top:10px"><b class="{'pos' if passed else 'neg'}">{verdict}</b></p>
          </div>
        </section>
        """

    period_section = ""
    if period_rows is not None:
        period_section = f"""
        <section>
          <h2>กำไรราย{period_unit} (จำลองถอนกำไรทุกงวด — รีเซ็ตทุนกลับที่เดิมทุกครั้ง)</h2>
          <div class="card">{_bars_html(period_rows, period_unit, "กำไรสะสมถ้าถอนทุกงวด")}</div>
        </section>
        """

    monthly_section = ""
    if monthly_rows:
        monthly_section = f"""
        <section>
          <h2>กำไรรายเดือน (ของรอบทดสอบต่อเนื่อง ไม่ได้รีเซ็ตทุน)</h2>
          <div class="card">{_bars_html(monthly_rows, "เดือน", "รวมกำไรสุทธิทั้งช่วง")}</div>
        </section>
        """

    verified_section = ""
    if verified_rows:
        verified_section = f"""
        <section>
          <h2>ตารางรอบตรวจสอบเพื่อนบ้าน (exhaustive — ค่าที่ควรใช้จริงมาจากตารางนี้)</h2>
          {table2_html}
        </section>
        """

    html_out = f"""<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>{_CSS}</style></head>
<body><div class="wrap">
<header>
  <h1>{html.escape(title)}</h1>
  <div class="runbar">
    <span>EA <b>{html.escape(ea_name)}</b></span>
    <span>สัญลักษณ์ <b>{html.escape(symbol)}</b></span>
    <span>TF <b>{html.escape(period)}</b></span>
    <span>โหมด <b>{html.escape(mode)}</b></span>
    <span>ช่วง <b>{html.escape(date_from)} – {html.escape(date_to)}</b></span>
    <span>โมเดล tick <b>{html.escape(model_label)}</b></span>
    <span>สร้างเมื่อ <b>{time.strftime('%Y-%m-%d %H:%M')}</b></span>
  </div>
</header>

{'<section><h2>ชุดที่แนะนำให้ใช้จริง</h2><div class="stats">' + _stat_cells(best) + '</div></section>' if best else ''}

{verify_callout}
{holdout_section}
{period_section}
{monthly_section}
{verified_section}

<section>
  <h2>{'ตารางรอบค้นกว้าง (genetic)' if verified_rows else 'ตารางอันดับทุกชุดที่รัน (เรียงตามคะแนน)'}</h2>
  {table1_html}
</section>

</div>
<script>
{script1}
{script2}
</script>
</body></html>"""
    return html_out


def write_report(html_str: str, out_dir: Path, prefix: str = "report") -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    # ใช้ datetime.now() ไม่ใช่ time.strftime — %f (ไมโครวินาที) ไม่รองรับใน time.strftime ของ C
    # runtime บน Windows (raise "ValueError: Invalid format string") datetime.strftime รองรับ %f
    # ปกติ ต้องมีความละเอียดระดับนี้เพราะ "รันทุก .set" เรียก write_report ติดกันหลายครั้งในไม่กี่
    # วินาที ถ้าใช้แค่ระดับวินาทีไฟล์จะทับกันเอง (เจอจริง 2026-09-12 ตอนทดสอบปุ่มนี้)
    path = out_dir / f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.html"
    path.write_text(html_str, encoding="utf-8")
    return path


def render_comparison_report(
    *,
    ea_name: str,
    symbol: str,
    period: str,
    date_from: str,
    date_to: str,
    results: list[dict],
) -> str:
    """สรุปเทียบผลการจูนของทุก .set ของ EA เดียวกันในตารางเดียว (ใช้ตอนกด "รันทุก .set")

    แต่ละ entry ใน results คือ dict: set_name, best_verified (dict หรือ None),
    holdout_row (dict หรือ None), report_path (ชื่อไฟล์ report เดี่ยวของชุดนั้น หรือ None),
    error (str ถ้ารันพัง) — เรียงให้ชุดที่ "ผ่าน holdout" และคะแนนสูงสุดขึ้นก่อนเสมอ
    """

    def sort_key(r: dict) -> tuple:
        if r.get("error") or not r.get("holdout_row"):
            return (0, 0.0)
        h = r["holdout_row"]
        passed = h["profit"] > 0 and h["pf"] >= 1.0
        score = r["best_verified"]["score"] if r.get("best_verified") else 0.0
        return (1 if passed else 0, score)

    ordered = sorted(results, key=sort_key, reverse=True)

    rows_html = []
    for r in ordered:
        name = html.escape(r["set_name"])
        if r.get("error"):
            rows_html.append(
                f'<tr><td>{name}</td>'
                f'<td colspan="6" class="neg">รันล้มเหลว: {html.escape(r["error"])}</td></tr>'
            )
            continue

        v = r.get("best_verified")
        h = r.get("holdout_row")
        score_s = f"{v['score']:.3f}" if v else "-"
        train_profit_s = _fmt_money(v["profit"]) if v else "-"
        train_pf_s = f"{v['pf']:.2f}" if v else "-"
        hold_profit_s = _fmt_money(h["profit"]) if h else "-"
        hold_pf_s = f"{h['pf']:.2f}" if h else "-"

        if not h:
            verdict, verdict_cls = "ไม่มีผล holdout", ""
        elif h["profit"] > 0 and h["pf"] >= 1.0:
            verdict, verdict_cls = "ผ่าน", "pos"
        else:
            verdict, verdict_cls = "ไม่ผ่าน", "neg"

        link = (
            f'<a href="{html.escape(r["report_path"])}">{name}</a>'
            if r.get("report_path") else name
        )
        rows_html.append(
            f'<tr><td>{link}</td><td>{score_s}</td><td>{train_profit_s}</td>'
            f'<td>{train_pf_s}</td><td>{hold_profit_s}</td><td>{hold_pf_s}</td>'
            f'<td class="{verdict_cls}">{verdict}</td></tr>'
        )

    table = f"""
    <table class="plain">
      <thead><tr>
        <th>.set</th><th>คะแนน (verify)</th><th>กำไร train</th><th>PF train</th>
        <th>กำไร holdout</th><th>PF holdout</th><th>ผลตรวจสอบ</th>
      </tr></thead>
      <tbody>{''.join(rows_html)}</tbody>
    </table>
    <p class="note">เรียงชุดที่ "ผ่าน" holdout และคะแนนสูงสุดไว้บนสุด — กดชื่อ .set เพื่อเปิดรายงาน
      เต็มของชุดนั้น (ตารางพารามิเตอร์ทุกชุดที่จูน) ค่าที่ควรใช้จริงต้องดูจากชุดที่ "ผ่าน" เท่านั้น
      ห้ามเลือกจากคะแนน train อย่างเดียวเพราะยังไม่ผ่านการตรวจสอบด้วยข้อมูลที่ไม่เคยใช้จูน</p>
    """

    title = f"เทียบผลจูนทุก .set — {ea_name} ({symbol} {period})"
    return f"""<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>{_CSS}</style></head>
<body><div class="wrap">
<header>
  <h1>{html.escape(title)}</h1>
  <div class="runbar">
    <span>EA <b>{html.escape(ea_name)}</b></span>
    <span>สัญลักษณ์ <b>{html.escape(symbol)}</b></span>
    <span>TF <b>{html.escape(period)}</b></span>
    <span>ช่วง <b>{html.escape(date_from)} – {html.escape(date_to)}</b></span>
    <span>สร้างเมื่อ <b>{time.strftime('%Y-%m-%d %H:%M')}</b></span>
  </div>
</header>
<section>
  <h2>สรุปเทียบทุก .set ของ {html.escape(ea_name)} ({len(results)} ชุด)</h2>
  <div class="card">{table}</div>
</section>
</div></body></html>"""
