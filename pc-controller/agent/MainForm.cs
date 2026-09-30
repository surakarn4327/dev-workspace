namespace PcControllerAgent;

public sealed class MainForm : Form
{
    readonly AgentCore _core;
    readonly Label _status = new();
    readonly TextBox _code = new();
    readonly Button _show = new();
    readonly Button _copy = new();
    readonly Label _phone = new();
    readonly CheckBox _autostart = new();
    readonly ListBox _events = new();
    readonly System.Windows.Forms.Timer _refresh = new() { Interval = 1000 };
    bool _revealed;
    bool _exiting;
    bool _hintShown;

    public event Action? TrayHint;

    public MainForm(AgentCore core)
    {
        _core = core;
        Text = "PC Controller Agent";
        ClientSize = new Size(560, 520);
        MinimumSize = new Size(560, 520);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10f);
        Icon = AppIcon.Load();

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            Padding = new Padding(20, 16, 20, 16),
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        var header = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, AutoSize = true };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.Controls.Add(new Label { Text = "สถานะ", Font = new Font("Segoe UI", 14f, FontStyle.Bold), AutoSize = true }, 0, 0);
        _status.AutoSize = true;
        _status.Padding = new Padding(0, 6, 0, 0);
        header.Controls.Add(_status, 1, 0);
        layout.Controls.Add(header);

        layout.Controls.Add(new Label { Text = "รหัสเชื่อมต่อ (ใส่ในแอปมือถือ)", AutoSize = true, Margin = new Padding(0, 16, 0, 4), ForeColor = SystemColors.GrayText });

        var codeRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, AutoSize = true };
        codeRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        codeRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        codeRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _code.ReadOnly = true;
        _code.TabStop = false;
        _code.Dock = DockStyle.Fill;
        _code.Font = new Font("Consolas", 10f);
        _code.UseSystemPasswordChar = false;
        _code.PasswordChar = '•';
        _show.Text = "แสดง";
        _show.AutoSize = true;
        _show.Click += (_, _) => { _revealed = !_revealed; RefreshCode(); };
        _copy.Text = "คัดลอก";
        _copy.AutoSize = true;
        _copy.Click += (_, _) => CopyCode();
        codeRow.Controls.Add(_code, 0, 0);
        codeRow.Controls.Add(_show, 1, 0);
        codeRow.Controls.Add(_copy, 2, 0);
        layout.Controls.Add(codeRow);

        var reset = new Button { Text = "Reset token", AutoSize = true, Margin = new Padding(0, 10, 0, 0) };
        reset.Click += async (_, _) =>
        {
            var ok = MessageBox.Show(this, "สร้างรหัสเชื่อมต่อใหม่?", "Reset token", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (ok == DialogResult.Yes) await _core.ResetTokenAsync();
        };
        layout.Controls.Add(reset);

        _phone.AutoSize = true;
        _phone.Margin = new Padding(0, 16, 0, 0);
        layout.Controls.Add(_phone);

        _autostart.Text = "เริ่มพร้อม Windows";
        _autostart.AutoSize = true;
        _autostart.Margin = new Padding(0, 8, 0, 0);
        _autostart.Checked = Autostart.IsEnabled();
        _autostart.Enabled = !_core.Opts.DryRun;
        _autostart.CheckedChanged += (_, _) =>
        {
            try { Autostart.Set(_autostart.Checked); }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, "ตั้งค่าไม่สำเร็จ"); }
        };
        layout.Controls.Add(_autostart);

        layout.Controls.Add(new Label { Text = "เหตุการณ์ล่าสุด", AutoSize = true, Margin = new Padding(0, 16, 0, 4), ForeColor = SystemColors.GrayText });

        _events.Dock = DockStyle.Fill;
        _events.IntegralHeight = false;
        _events.Height = 150;
        _events.Font = new Font("Segoe UI", 9.5f);
        layout.Controls.Add(_events);

        layout.Controls.Add(new Label
        {
            Text = "กด X จะย่อเก็บที่ไอคอนข้างนาฬิกา โปรแกรมยังทำงานต่อ",
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
            Margin = new Padding(0, 10, 0, 0),
            Font = new Font("Segoe UI", 8.5f),
        });

        Controls.Add(layout);

        _core.StatusChanged += RefreshAll;
        _core.Events.Changed += () =>
        {
            if (IsHandleCreated && !IsDisposed) BeginInvoke(RefreshEvents);
        };
        _refresh.Tick += (_, _) => RefreshAll();
        _refresh.Start();
        RefreshAll();
    }

    // The window's X button hides it to the tray; only "ออกจากโปรแกรม" really quits.
    public void ExitForReal()
    {
        _exiting = true;
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            if (!_hintShown)
            {
                _hintShown = true;
                TrayHint?.Invoke();
            }
            return;
        }
        base.OnFormClosing(e);
    }

    void RefreshAll()
    {
        if (IsDisposed) return;
        _status.Text = _core.BrokerConnected ? "เชื่อมต่อ broker แล้ว" : "กำลังเชื่อมต่อ broker...";
        _status.ForeColor = _core.BrokerConnected ? Color.SeaGreen : SystemColors.GrayText;
        RefreshCode();

        if (_core.LastPhoneMessageMs == 0)
        {
            _phone.Text = "มือถือ: ยังไม่มีคำสั่งเข้ามา";
        }
        else
        {
            var ago = DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(_core.LastPhoneMessageMs);
            _phone.Text = ago.TotalMinutes < 1 ? "มือถือ: คำสั่งล่าสุดเมื่อสักครู่" : $"มือถือ: คำสั่งล่าสุด {(int)ago.TotalMinutes} นาทีที่แล้ว";
        }
        RefreshEvents();
    }

    void RefreshCode()
    {
        _code.PasswordChar = _revealed ? '\0' : '•';
        _code.Text = AppConfig.FormatCode(_core.Config.PairingCode);
        _code.Select(0, 0);
        _show.Text = _revealed ? "ซ่อน" : "แสดง";
    }

    void RefreshEvents()
    {
        var items = _core.Events.Items.Reverse().Select(e =>
        {
            var t = DateTimeOffset.FromUnixTimeMilliseconds(e.Ts).ToLocalTime();
            string when = t.Date == DateTime.Today ? t.ToString("HH:mm") : t.ToString("dd/MM HH:mm");
            return $"{when}   {e.Text}";
        }).ToArray();

        if (_events.Items.Count == items.Length && items.Length > 0 && (string)_events.Items[0] == items[0]) return;
        _events.BeginUpdate();
        _events.Items.Clear();
        _events.Items.AddRange(items);
        _events.EndUpdate();
    }

    async void CopyCode()
    {
        Clipboard.SetText(_core.Config.PairingCode);
        _copy.Text = "คัดลอกแล้ว";
        await Task.Delay(1500);
        if (!IsDisposed) _copy.Text = "คัดลอก";
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _refresh.Dispose();
        base.Dispose(disposing);
    }
}
