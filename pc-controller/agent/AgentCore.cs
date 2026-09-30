using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PcControllerAgent;

public sealed class Options
{
    public bool Tray { get; set; }          // started by Windows at login (autostart)
    public bool DryRun { get; set; }        // never launch/close/kill/shutdown, only log
    public bool SelfTest { get; set; }
    public bool NoInstall { get; set; }
    public bool DemoCountdown { get; set; } // show the countdown window shortly after start
    public string? DataDir { get; set; }
    public string? VectorFile { get; set; }

    public static Options Parse(string[] args)
    {
        var o = new Options();
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--tray": o.Tray = true; break;
                case "--dry-run": o.DryRun = true; o.NoInstall = true; break;
                case "--selftest": o.SelfTest = true; break;
                case "--no-install": o.NoInstall = true; break;
                case "--demo-countdown": o.DemoCountdown = true; break;
                case "--data-dir" when i + 1 < args.Length: o.DataDir = args[++i]; break;
                case "--vector" when i + 1 < args.Length: o.VectorFile = args[++i]; break;
            }
        }
        return o;
    }
}

// Everything the agent does, minus the windows. All state changes happen on
// the UI thread (`_sync`); MQTT callbacks hop over to it before touching anything.
public sealed class AgentCore : IDisposable
{
    public const string Version = "1.0.0";
    static readonly Regex DeviceIdPattern = new(@"^[A-Za-z0-9_-]{1,64}$");
    const long MaxClockSkewMs = 10 * 60 * 1000;

    public readonly Options Opts;
    public readonly string DataDir;
    public readonly AppConfig Config;
    public readonly EventLog Events;
    public readonly MqttBridge Bridge;
    public long LastPhoneMessageMs { get; private set; }
    public bool BrokerConnected { get; private set; }
    public event Action? StatusChanged;

    readonly Control _sync;
    readonly DateTimeOffset _startedAt = DateTimeOffset.Now;
    readonly TaskCompletionSource _catalogReady = new();
    readonly HashSet<string> _seenCmdIds = new();
    List<CatalogEntry> _catalog = new();
    DateTime? _postponedUntil;
    CountdownForm? _countdown;
    System.Windows.Forms.Timer? _tick;
    System.Windows.Forms.Timer? _stateTimer;

    public AgentCore(Options opts, Control sync)
    {
        Opts = opts;
        _sync = sync;
        DataDir = opts.DataDir ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PcControllerAgent");
        Config = AppConfig.LoadOrCreate(DataDir);
        Events = new EventLog(DataDir);
        Bridge = new MqttBridge(() => Config);
    }

    static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    void Run(Action a)
    {
        if (_sync.IsDisposed) return;
        try { _sync.BeginInvoke(a); } catch (InvalidOperationException) { }
    }

    public void Start()
    {
        Bridge.ConnectionChanged += connected => Run(() =>
        {
            BrokerConnected = connected;
            if (connected) _ = PublishStateAsync();
            StatusChanged?.Invoke();
        });
        Bridge.MessageReceived += (kind, text) => Run(() => _ = HandleMessageAsync(kind, text));
        Bridge.Start();

        _ = RescanAsync();

        _tick = new System.Windows.Forms.Timer { Interval = 5000 };
        _tick.Tick += (_, _) => Tick();
        _tick.Start();

        _stateTimer = new System.Windows.Forms.Timer { Interval = 5 * 60 * 1000 };
        _stateTimer.Tick += (_, _) => _ = PublishStateAsync();
        _stateTimer.Start();

        if (Opts.Tray) _ = BootLaunchAsync();
        if (Opts.DemoCountdown)
        {
            var t = new System.Windows.Forms.Timer { Interval = 3000 };
            t.Tick += (_, _) => { t.Stop(); StartCountdown(); };
            t.Start();
        }
    }

    // ---------- catalog + state ----------

    async Task RescanAsync()
    {
        try
        {
            _catalog = await AppCatalog.ScanAsync();
        }
        catch (Exception ex)
        {
            Events.Add($"สแกนโปรแกรมไม่สำเร็จ: {ex.Message}");
        }
        finally
        {
            _catalogReady.TrySetResult();
        }
    }

    object BuildState()
    {
        string today = DateTime.Now.ToString("yyyy-MM-dd");
        return new
        {
            ts = NowMs(),
            version = Version,
            bootAt = _startedAt.ToUnixTimeMilliseconds(),
            config = new { days = Config.Days, off = Config.Off, countdown = Config.Countdown, paused = Config.Paused },
            selected = Config.Selected.Select(a => new { id = a.Id, name = a.Name }),
            catalog = _catalog.Select(c => new { id = c.Id, name = c.Name, running = c.Running }),
            skipToday = Config.SkippedDate == today,
            postponedUntil = _postponedUntil is { } p ? new DateTimeOffset(p).ToUnixTimeMilliseconds() : (long?)null,
        };
    }

    public async Task PublishStateAsync()
    {
        string envelope = Envelope.Seal(Config.Token, "state", BuildState());
        await Bridge.PublishAsync(MqttBridge.Topics(Config.AgentId).State, envelope, retain: true);
    }

    public async Task NotifyAsync(string text)
    {
        if (Config.NotifyDevice == null) return;
        await Bridge.PublishAsync($"pc-controller/{Config.NotifyDevice}/notify", text);
    }

    // ---------- messages from the phone ----------

    async Task HandleMessageAsync(string kind, string text)
    {
        var body = Envelope.Open(Config.Token, "cmd", text);
        if (body is not { } msg) return; // wrong token / tampered / not for us

        long ts = msg.TryGetProperty("ts", out var tsEl) && tsEl.TryGetInt64(out long t) ? t : 0;
        if (kind == "cfg") await ApplyConfigAsync(msg, ts);
        else await HandleCommandAsync(msg, ts);
    }

    async Task HandleCommandAsync(JsonElement msg, long ts)
    {
        if (Math.Abs(NowMs() - ts) > MaxClockSkewMs) return;
        string id = msg.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
        if (id.Length == 0 || !_seenCmdIds.Add(id)) return;
        if (_seenCmdIds.Count > 200) _seenCmdIds.Clear();

        LastPhoneMessageMs = NowMs();
        string type = msg.TryGetProperty("type", out var typeEl) ? typeEl.GetString() ?? "" : "";
        if (type == "scan")
        {
            await RescanAsync();
            Events.Add("สแกนโปรแกรมใหม่ตามคำขอจากมือถือ");
            await PublishStateAsync();
        }
        StatusChanged?.Invoke();
    }

    async Task ApplyConfigAsync(JsonElement msg, long ts)
    {
        if (ts <= Config.CfgTs) return; // old or replayed
        await _catalogReady.Task;       // app IDs can only be resolved once we know what's installed

        var days = new List<int>();
        if (msg.TryGetProperty("days", out var daysEl) && daysEl.ValueKind == JsonValueKind.Array)
            foreach (var d in daysEl.EnumerateArray())
                if (d.TryGetInt32(out int v) && v is >= 0 and <= 6 && !days.Contains(v)) days.Add(v);

        string? off = msg.TryGetProperty("off", out var offEl) ? offEl.GetString() : null;
        bool offChanged = ScheduleLogic.IsValidTime(off) && off != Config.Off;

        Config.CfgTs = ts;
        if (msg.TryGetProperty("days", out _)) Config.Days = days.OrderBy(x => x).ToArray();
        if (ScheduleLogic.IsValidTime(off)) Config.Off = off!;
        if (msg.TryGetProperty("countdown", out var cdEl) && cdEl.TryGetInt32(out int cd))
            Config.Countdown = Math.Clamp(cd, 5, 600);
        if (msg.TryGetProperty("paused", out var pEl) && pEl.ValueKind is JsonValueKind.True or JsonValueKind.False)
            Config.Paused = pEl.GetBoolean();
        if (msg.TryGetProperty("notifyDevice", out var ndEl) && ndEl.GetString() is { } nd && DeviceIdPattern.IsMatch(nd))
            Config.NotifyDevice = nd;

        if (msg.TryGetProperty("apps", out var appsEl) && appsEl.ValueKind == JsonValueKind.Array)
        {
            var known = _catalog.ToDictionary(c => c.Id, c => new SelectedApp { Id = c.Id, Name = c.Name, Launch = c.Launch, Exe = c.Exe });
            foreach (var s in Config.Selected) known[s.Id] = s;
            var chosen = new List<SelectedApp>();
            foreach (var idEl in appsEl.EnumerateArray())
                if (idEl.GetString() is { } appId && known.TryGetValue(appId, out var app) && chosen.All(c => c.Id != appId))
                    chosen.Add(app);
            Config.Selected = chosen;
        }

        if (offChanged)
        {
            // A new off time is a fresh schedule: forget today's "already handled/skipped".
            Config.LastHandledDate = null;
            Config.SkippedDate = null;
            _postponedUntil = null;
        }

        Config.Save(DataDir);
        LastPhoneMessageMs = NowMs();
        Events.Add("ได้รับการตั้งค่าใหม่จากมือถือ");
        await PublishStateAsync();
        StatusChanged?.Invoke();
    }

    // ---------- pairing ----------

    public async Task ResetTokenAsync()
    {
        Config.ResetToken();
        Config.CfgTs = 0;
        Config.Save(DataDir);
        var t = MqttBridge.Topics(Config.AgentId);
        // The retained config on the broker is encrypted with the old token.
        await Bridge.PublishAsync(t.Cfg, "", retain: true);
        await PublishStateAsync();
        Events.Add("สร้างรหัสเชื่อมต่อใหม่แล้ว");
        StatusChanged?.Invoke();
    }

    // ---------- schedule ----------

    void Tick()
    {
        if (_countdown != null) return;
        var now = DateTime.Now;

        if (Config.Paused || !Config.Days.Contains((int)now.DayOfWeek))
        {
            _postponedUntil = null;
            return;
        }

        if (_postponedUntil is { } until)
        {
            if (now >= until)
            {
                _postponedUntil = null;
                StartCountdown();
            }
            return;
        }

        if (ScheduleLogic.ShouldStartCountdown(Config, now))
        {
            Config.LastHandledDate = now.ToString("yyyy-MM-dd");
            Config.Save(DataDir);
            StartCountdown();
        }
    }

    void StartCountdown()
    {
        if (_countdown != null) return;
        var names = Config.Selected.Select(a => a.Name).ToList();
        Events.Add("ถึงเวลาปิดคอม — แสดงหน้าต่างนับถอยหลัง");
        _countdown = new CountdownForm(Config.Countdown, names);
        _countdown.Completed += result => Run(() => _ = OnCountdownResultAsync(result));
        _countdown.Show();
        _countdown.Activate();
        _ = PublishStateAsync();
    }

    async Task OnCountdownResultAsync(CountdownResult result)
    {
        _countdown = null;
        switch (result)
        {
            case CountdownResult.Postpone15:
            case CountdownResult.Postpone30:
                int minutes = result == CountdownResult.Postpone15 ? 15 : 30;
                _postponedUntil = DateTime.Now.AddMinutes(minutes);
                Events.Add($"มีคนกดเลื่อนการปิดไป {minutes} นาที");
                await NotifyAsync($"มีคนอยู่หน้าคอม เลื่อนการปิดไป {minutes} นาที");
                break;
            case CountdownResult.Skip:
                Config.SkippedDate = DateTime.Now.ToString("yyyy-MM-dd");
                Config.Save(DataDir);
                Events.Add("มีคนกดข้ามการปิดคอมของวันนี้");
                await NotifyAsync("มีคนอยู่หน้าคอม ข้ามการปิดคอมของวันนี้");
                break;
            default:
                await ExecuteShutdownAsync();
                return;
        }
        await PublishStateAsync();
        StatusChanged?.Invoke();
    }

    async Task ExecuteShutdownAsync()
    {
        var apps = Config.Selected.ToList();
        Events.Add("ปิดโปรแกรมแล้วปิดเครื่องตามเวลา");
        await NotifyAsync($"ปิดคอมตามเวลาแล้ว ({Config.Off})");

        if (Opts.DryRun)
        {
            Events.Add($"[dry-run] จะปิด: {(apps.Count == 0 ? "(ไม่มีโปรแกรม)" : string.Join(", ", apps.Select(a => a.Name)))} แล้วปิดเครื่อง");
            return;
        }

        var refused = await AppCatalog.CloseAsync(apps, msg => Events.Add(msg));
        foreach (string name in refused) await NotifyAsync($"ปิด {name} ไม่ลง เลยบังคับปิดแล้ว");

        await Bridge.GoOfflineAsync();
        // /f: anything still open (unsaved documents in programs that weren't on
        // the list) is closed by force, otherwise Windows can sit on the
        // "this app is preventing shutdown" screen all night.
        Process.Start(new ProcessStartInfo("shutdown.exe", "/s /f /t 5 /c \"PC Controller: ปิดเครื่องตามเวลา\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
        });
    }

    // ---------- launch at boot ----------

    async Task BootLaunchAsync()
    {
        await Task.Delay(TimeSpan.FromSeconds(20)); // let the desktop and network settle
        await _catalogReady.Task;
        var apps = Config.Selected.ToList();
        if (apps.Count == 0) return;

        var opened = new List<string>();
        foreach (var app in apps)
        {
            if (Opts.DryRun)
            {
                Events.Add($"[dry-run] จะเปิด {app.Name}");
            }
            else if (AppCatalog.IsRunning(app))
            {
                Events.Add($"{app.Name} เปิดอยู่แล้ว ข้าม");
            }
            else if (AppCatalog.Launch(app) is { } error)
            {
                Events.Add($"เปิด {app.Name} ไม่สำเร็จ: {error}");
                await NotifyAsync($"เปิด {app.Name} ไม่สำเร็จ ลองเช็คที่คอมหน่อยนะ");
            }
            else
            {
                opened.Add(app.Name);
            }
            if (app != apps[^1]) await Task.Delay(TimeSpan.FromSeconds(10));
        }
        if (opened.Count > 0) Events.Add($"เปิดโปรแกรมตามลำดับแล้ว ({string.Join(", ", opened)})");
    }

    public void Dispose()
    {
        _tick?.Dispose();
        _stateTimer?.Dispose();
        Bridge.Dispose();
    }
}
