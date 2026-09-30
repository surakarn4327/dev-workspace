using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PcControllerAgent;

public sealed class SelectedApp
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    // What to hand to ShellExecute when launching (a .lnk or an .exe path).
    public string Launch { get; set; } = "";
    // The executable whose processes get closed at shutdown time.
    public string? Exe { get; set; }
}

public sealed class AppConfig
{
    public string AgentId { get; set; } = "";
    public string Token { get; set; } = "";

    public int[] Days { get; set; } = { 1, 2, 3, 4, 5 };
    public string Off { get; set; } = "18:00";
    public int Countdown { get; set; } = 60;
    public bool Paused { get; set; }

    // ESP32 device ID, learned from the phone. Only used to route Discord
    // notifications through the ESP32's webhook.
    public string? NotifyDevice { get; set; }
    public List<SelectedApp> Selected { get; set; } = new();

    // Timestamp of the last phone config applied; older/equal ones are ignored
    // (replay protection for the retained config message).
    public long CfgTs { get; set; }
    public string? LastHandledDate { get; set; }
    public string? SkippedDate { get; set; }

    [JsonIgnore]
    public string PairingCode => AgentId + Token;

    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static string FilePath(string dir) => Path.Combine(dir, "config.json");

    public static AppConfig LoadOrCreate(string dir)
    {
        Directory.CreateDirectory(dir);
        AppConfig? cfg = null;
        try
        {
            if (File.Exists(FilePath(dir)))
                cfg = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(FilePath(dir)));
        }
        catch
        {
            // Corrupt file: start over rather than refuse to run. A new agent ID
            // and token just means the phone has to be paired again.
        }

        cfg ??= new AppConfig();
        bool changed = false;
        if (cfg.AgentId.Length != 8) { cfg.AgentId = RandomHex(4); changed = true; }
        if (cfg.Token.Length != 32) { cfg.Token = RandomHex(16); changed = true; }
        if (changed) cfg.Save(dir);
        return cfg;
    }

    public void Save(string dir)
    {
        Directory.CreateDirectory(dir);
        string tmp = FilePath(dir) + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
        File.Move(tmp, FilePath(dir), overwrite: true);
    }

    public void ResetToken() => Token = RandomHex(16);

    public static string RandomHex(int bytes) => Convert.ToHexString(RandomNumberGenerator.GetBytes(bytes)).ToLowerInvariant();

    public static string FormatCode(string hex)
    {
        var parts = new List<string>();
        for (int i = 0; i < hex.Length; i += 4) parts.Add(hex.Substring(i, Math.Min(4, hex.Length - i)));
        return string.Join("-", parts);
    }
}

public sealed record EventEntry(long Ts, string Text);

public sealed class EventLog
{
    readonly string _path;
    readonly List<EventEntry> _items = new();
    public event Action? Changed;

    public EventLog(string dir)
    {
        _path = Path.Combine(dir, "events.json");
        try
        {
            if (File.Exists(_path))
                _items = JsonSerializer.Deserialize<List<EventEntry>>(File.ReadAllText(_path)) ?? new();
        }
        catch { /* history is best-effort */ }
    }

    public IReadOnlyList<EventEntry> Items
    {
        get { lock (_items) return _items.ToList(); }
    }

    public void Add(string text)
    {
        lock (_items)
        {
            _items.Add(new EventEntry(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), text));
            if (_items.Count > 50) _items.RemoveRange(0, _items.Count - 50);
            try { File.WriteAllText(_path, JsonSerializer.Serialize(_items)); } catch { }
        }
        Changed?.Invoke();
    }
}
