using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace PcControllerAgent;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        var opts = Options.Parse(args);
        if (opts.SelfTest) return SelfTest.Run(opts);

        ApplicationConfiguration.Initialize();

        // Must happen before taking the single-instance mutex: the freshly
        // installed copy starts while this process is still exiting.
        if (!opts.NoInstall && Installer.OfferInstall()) return 0;

        string suffix = opts.DataDir == null ? "" : Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(opts.DataDir)))[..8];
        string name = @"Local\PcControllerAgent" + suffix;
        using var mutex = new Mutex(true, name, out bool first);
        if (!first)
        {
            // Already running: ask that instance to show its window instead.
            try { EventWaitHandle.OpenExisting(name + ".Show").Set(); } catch { }
            return 0;
        }

        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, name + ".Show");
        Application.Run(new AgentContext(opts, showEvent));
        return 0;
    }
}

static class AppIcon
{
    public static Icon Load()
    {
        try
        {
            if (Environment.ProcessPath is { } p && Icon.ExtractAssociatedIcon(p) is { } icon) return icon;
        }
        catch { }
        return SystemIcons.Application;
    }
}

static class Autostart
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string ValueName = "PcControllerAgent";

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) != null;
    }

    public static void Set(bool enabled, string? exePath = null)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled)
        {
            string path = exePath ?? Environment.ProcessPath ?? throw new InvalidOperationException("ไม่พบตำแหน่งโปรแกรม");
            key.SetValue(ValueName, $"\"{path}\" --tray");
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }
}

// First run from wherever the user downloaded the .exe: offer to copy it to a
// stable folder and register autostart, so the download can be deleted and a
// new Windows install/PC only needs "download, double-click, yes".
static class Installer
{
    const string ExeName = "PcControllerAgent.exe";

    public static bool OfferInstall()
    {
        string? self = Environment.ProcessPath;
        if (self == null || Path.GetFileName(self).Equals("dotnet.exe", StringComparison.OrdinalIgnoreCase)) return false;

        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PcControllerAgent");
        string target = Path.Combine(dir, ExeName);
        if (string.Equals(Path.GetFullPath(self), target, StringComparison.OrdinalIgnoreCase)) return false;

        bool already = File.Exists(target);
        string question = already
            ? "พบ PC Controller Agent ที่ติดตั้งไว้แล้วในเครื่องนี้ อัปเดตเป็นเวอร์ชันนี้ไหม?"
            : "ติดตั้ง PC Controller Agent ไว้ในเครื่องนี้ และให้เริ่มทำงานพร้อม Windows ไหม?";
        if (MessageBox.Show(question, "PC Controller Agent", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return false; // run from here this time, nothing installed

        try
        {
            StopRunning(target);
            Directory.CreateDirectory(dir);
            File.Copy(self, target, overwrite: true);
            Autostart.Set(true, target);
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            return true;
        }
        catch (Exception ex)
        {
            MessageBox.Show($"ติดตั้งไม่สำเร็จ: {ex.Message}\nจะเปิดใช้งานจากตำแหน่งนี้แทน", "PC Controller Agent");
            return false;
        }
    }

    static void StopRunning(string target)
    {
        foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(ExeName)))
        {
            try
            {
                if (p.Id == Environment.ProcessId) continue;
                if (!string.Equals(p.MainModule?.FileName, target, StringComparison.OrdinalIgnoreCase)) continue;
                p.Kill();
                p.WaitForExit(5000);
            }
            catch { }
            finally { p.Dispose(); }
        }
    }
}

sealed class AgentContext : ApplicationContext
{
    readonly Control _sync = new();
    readonly AgentCore _core;
    readonly MainForm _main;
    readonly NotifyIcon _tray;

    public AgentContext(Options opts, EventWaitHandle showEvent)
    {
        _sync.CreateControl();
        _ = _sync.Handle; // force the handle so BeginInvoke works from MQTT threads

        _core = new AgentCore(opts, _sync);
        _main = new MainForm(_core);

        var menu = new ContextMenuStrip();
        menu.Items.Add("เปิดหน้าต่าง", null, (_, _) => ShowMain());
        menu.Items.Add("ออกจากโปรแกรม", null, (_, _) => ExitApp());

        _tray = new NotifyIcon
        {
            Icon = AppIcon.Load(),
            Text = "PC Controller Agent",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _tray.DoubleClick += (_, _) => ShowMain();
        _main.TrayHint += () => _tray.ShowBalloonTip(3000, "PC Controller Agent", "ยังทำงานอยู่ที่ไอคอนข้างนาฬิกา", ToolTipIcon.Info);

        ThreadPool.RegisterWaitForSingleObject(showEvent, (_, _) => { try { _sync.BeginInvoke(ShowMain); } catch { } }, null, -1, false);

        _core.Start();
        if (!opts.Tray) ShowMain();
    }

    void ShowMain()
    {
        _main.Show();
        if (_main.WindowState == FormWindowState.Minimized) _main.WindowState = FormWindowState.Normal;
        // Windows often won't let a background process take focus; toggling
        // TopMost reliably raises the window (same trick as the countdown window).
        _main.TopMost = true;
        _main.TopMost = false;
        _main.Activate();
    }

    void ExitApp()
    {
        _tray.Visible = false;
        _ = Task.Run(async () =>
        {
            try { await _core.Bridge.GoOfflineAsync(); } catch { }
            _sync.BeginInvoke(() =>
            {
                _main.ExitForReal();
                _core.Dispose();
                ExitThread();
            });
        });
    }
}
