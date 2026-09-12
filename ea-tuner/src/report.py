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
from pathlib import Path

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
    period_rows: list[tuple[str, float, int]] | None = None,
    period_unit: str = "งวด",
    monthly_rows: list[tuple[str, float, int]] | None = None,
) -> str:
    pass_rows = pass_rows or []
    n_params = max((len(r["params"]) for r in pass_rows), default=0)
    param_headers = [f"Param{i+1}" for i in range(n_params)]

    data = []
    for r in pass_rows:
        params = r["params"] + [""] * (n_params - len(r["params"]))
        data.append(params + [r[m] for m in METRIC_NAMES])
    metric_start = n_params

    table_html = ""
    if pass_rows:
        headers = param_headers + [
            "ไม้", "กำไร", "DD", "PF", "payoff", "winrate", "เดือนทั้งหมด",
            "เดือนกำไร", "%เดือนกำไร", "เดือนแย่สุด", "เดือนกลาง",
            "ไม้ใหญ่สุด/กำไร", "ถือ(ชม.)", "แพ้ติดกัน", "คะแนน",
        ]
        # ข้าม deposit (metric index 0) และ shareGross (index 13) ในการแสดงผล ให้กระชับ
        show_metric_idx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16]
        head_cells = "".join(
            f'<th data-i="{i}">{html.escape(h)}</th>' for i, h in enumerate(param_headers)
        )
        head_cells += "".join(
            f'<th data-i="{n_params + idx}">{h}</th>'
            for idx, h in zip(show_metric_idx, [
                "ไม้", "กำไร", "DD", "PF", "payoff", "winrate", "เดือนทั้งหมด",
                "เดือนกำไร", "%เดือนกำไร", "เดือนแย่สุด", "ไม้ใหญ่สุด/กำไร",
                "ถือ(ชม.)", "แพ้ติดกัน", "คะแนน",
            ])
        )
        table_html = f"""
        <div class="grid">
          <table>
            <thead><tr id="head">{head_cells}</tr></thead>
            <tbody id="body"></tbody>
          </table>
        </div>
        <p class="note">กดหัวคอลัมน์เพื่อเรียง · {len(pass_rows)} ชุดทั้งหมด เรียงตามคะแนนมากไปน้อยโดย default
          · Param1..{n_params} คือพารามิเตอร์ตามลำดับใน .set ของ EA นี้ (ea-tuner ไม่รู้ชื่อจริงของแต่ละตัว
          เปิด .set คู่กับตารางนี้เพื่อเทียบลำดับ)</p>
        """
    else:
        table_html = '<p class="empty">โหมดนี้ไม่มีตารางไล่ดูราย pass (ดูกราฟรายงวดด้านล่างแทน)</p>'

    best = None
    if pass_rows:
        best = max(pass_rows, key=lambda r: r["score"])

    stat_cells = ""
    if best:
        stat_defs = [
            ("ไม้", f"{best['trades']:,.0f}"),
            ("กำไรสุทธิ", _fmt_money(best["profit"])),
            ("ขาดทุนสูงสุด", _fmt_money(best["dd"])),
            ("PF", f"{best['pf']:.2f}"),
            ("winrate", f"{best['winrate']*100:.1f}%"),
            ("เดือนที่กำไร", f"{best['posMonths']:.0f}/{best['months']:.0f}"),
        ]
        stat_cells = "".join(
            f'<div class="st"><div class="k">{k}</div><div class="v">{v}</div></div>'
            for k, v in stat_defs
        )

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

    js_data = json.dumps(data)
    n_metrics_shown = len(show_metric_idx) if pass_rows else 0

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

{'<section><h2>ชุดคะแนนสูงสุด</h2><div class="stats">' + stat_cells + '</div></section>' if best else ''}

{period_section}
{monthly_section}

<section>
  <h2>ตารางอันดับทุกชุดที่รัน (เรียงตามคะแนน)</h2>
  {table_html}
</section>

</div>
<script>
const DATA = {js_data};
const N_PARAMS = {n_params};
const SCORE_COL = N_PARAMS + 16; // ตำแหน่งคะแนนใน METRIC_NAMES (index 16) หลังพารามิเตอร์
let sortCol = SCORE_COL, sortDir = -1;

function fmt(v, i) {{
  if (typeof v !== 'number') return v;
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2);
}}

function render() {{
  const body = document.getElementById('body');
  if (!body) return;
  const rows = DATA.slice().sort((a,b) => {{
    const x = a[sortCol], y = b[sortCol];
    if (x < y) return -1*sortDir; if (x > y) return 1*sortDir; return 0;
  }});
  const showIdx = [1,2,3,4,5,6,7,8,9,10,12,14,15,16].map(i => N_PARAMS + i);
  const cols = [...Array(N_PARAMS).keys(), ...showIdx];
  body.innerHTML = rows.map(r =>
    '<tr>' + cols.map(i => `<td>${{fmt(r[i], i)}}</td>`).join('') + '</tr>'
  ).join('') || '<tr><td class="empty">ไม่มีข้อมูล</td></tr>';
}}
const head = document.getElementById('head');
if (head) {{
  head.addEventListener('click', e => {{
    const th = e.target.closest('th'); if (!th) return;
    const i = parseInt(th.dataset.i, 10);
    if (sortCol === i) sortDir *= -1; else {{ sortCol = i; sortDir = -1; }}
    render();
  }});
}}
render();
</script>
</body></html>"""
    return html_out


def write_report(html_str: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"report_{time.strftime('%Y%m%d_%H%M%S')}.html"
    path.write_text(html_str, encoding="utf-8")
    return path
