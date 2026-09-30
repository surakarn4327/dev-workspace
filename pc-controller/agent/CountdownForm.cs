using System.Media;

namespace PcControllerAgent;

public enum CountdownResult { Timeout, Postpone15, Postpone30, Skip }

// "Time to shut down" window. Stays on top of everything; if nobody presses a
// button the countdown runs out and the agent shuts the PC down.
public sealed class CountdownForm : Form
{
    readonly Label _seconds = new();
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    int _left;
    bool _done;

    public event Action<CountdownResult>? Completed;

    public CountdownForm(int seconds, IReadOnlyList<string> appNames)
    {
        _left = seconds;

        Text = "ถึงเวลาปิดคอมแล้ว";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ControlBox = false;
        MaximizeBox = false;
        MinimizeBox = false;
        TopMost = true;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(440, 300);
        Font = new Font("Segoe UI", 10f);

        var title = new Label
        {
            Text = "ถึงเวลาปิดคอมแล้ว",
            Font = new Font("Segoe UI", 15f, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Top,
            Height = 52,
        };

        _seconds.Font = new Font("Segoe UI", 40f, FontStyle.Bold);
        _seconds.TextAlign = ContentAlignment.MiddleCenter;
        _seconds.Dock = DockStyle.Top;
        _seconds.Height = 90;
        _seconds.Text = _left.ToString();

        string what = appNames.Count == 0 ? "แล้วจะปิดคอม" : $"แล้วจะปิด {string.Join(", ", appNames)} และปิดคอม";
        var detail = new Label
        {
            Text = $"วินาที {what}",
            TextAlign = ContentAlignment.TopCenter,
            Dock = DockStyle.Top,
            Height = 52,
            Padding = new Padding(16, 6, 16, 0),
        };

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Padding = new Padding(28, 14, 0, 0),
        };
        buttons.Controls.Add(MakeButton("เลื่อน 15 นาที", CountdownResult.Postpone15));
        buttons.Controls.Add(MakeButton("เลื่อน 30 นาที", CountdownResult.Postpone30));
        buttons.Controls.Add(MakeButton("ข้ามวันนี้", CountdownResult.Skip));

        Controls.Add(buttons);
        Controls.Add(detail);
        Controls.Add(_seconds);
        Controls.Add(title);

        _timer.Tick += (_, _) =>
        {
            _left--;
            _seconds.Text = Math.Max(_left, 0).ToString();
            if (_left <= 0) Finish(CountdownResult.Timeout);
        };

        Shown += (_, _) =>
        {
            SystemSounds.Exclamation.Play();
            // Windows often refuses to hand focus to a background process;
            // toggling TopMost reliably raises the window anyway.
            TopMost = false;
            TopMost = true;
            Activate();
            _timer.Start();
        };
    }

    Button MakeButton(string text, CountdownResult result)
    {
        // TabStop off so no button owns keyboard focus when the window pops up:
        // the popup appears while someone may be typing in another window, and a
        // stray Enter/Space must not press "skip" (or anything else) for them.
        var b = new Button { Text = text, Width = 120, Height = 40, TabStop = false };
        b.Click += (_, _) => Finish(result);
        return b;
    }

    void Finish(CountdownResult result)
    {
        if (_done) return;
        _done = true;
        _timer.Stop();
        Completed?.Invoke(result);
        Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }
}
