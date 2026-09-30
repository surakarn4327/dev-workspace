using System.Text;
using System.Text.Json;

namespace PcControllerAgent;

// `PcControllerAgent.exe --selftest [--vector file.json] [--data-dir dir]`
// Runs the pure-logic checks (crypto, schedule, catalog scan) without any UI or
// network, and writes selftest.txt. Exit code 0 = all passed. The optional
// vector file is produced by the phone app's crypto (scripts/crypto-vector.mjs)
// to prove both sides really speak the same envelope format.
static class SelfTest
{
    public static int Run(Options opts)
    {
        var log = new StringBuilder();
        int failures = 0;
        void Check(string name, bool ok, string detail = "")
        {
            log.AppendLine($"{(ok ? "PASS" : "FAIL")}  {name}{(detail.Length > 0 ? "  " + detail : "")}");
            if (!ok) failures++;
        }

        // --- crypto ---
        string token = "0123456789abcdef0123456789abcdef";
        string sealedText = Envelope.Seal(token, "cmd", new { hello = "world", n = 42 });
        var back = Envelope.Open(token, "cmd", sealedText);
        Check("envelope round-trip", back is { } b && b.GetProperty("hello").GetString() == "world" && b.GetProperty("n").GetInt32() == 42);
        Check("wrong token rejected", Envelope.Open("ffffffffffffffffffffffffffffffff", "cmd", sealedText) == null);
        Check("wrong direction rejected", Envelope.Open(token, "state", sealedText) == null);
        Check("garbage rejected", Envelope.Open(token, "cmd", "not json") == null);

        if (opts.VectorFile != null)
        {
            var v = JsonDocument.Parse(File.ReadAllText(opts.VectorFile)).RootElement;
            string vToken = v.GetProperty("token").GetString()!;
            var fromJs = Envelope.Open(vToken, v.GetProperty("direction").GetString()!, v.GetProperty("envelope").GetString()!);
            Check("decrypts envelope made by the phone app (JS)",
                fromJs is { } j && j.GetProperty("type").GetString() == "cfg-test" && j.GetProperty("thai").GetString() == "สวัสดี ทดสอบ");

            // and the reverse direction, verified by the JS side reading this file
            string outPath = Path.Combine(Path.GetDirectoryName(opts.VectorFile)!, "vector-from-csharp.json");
            File.WriteAllText(outPath, JsonSerializer.Serialize(new
            {
                token = vToken,
                direction = "state",
                envelope = Envelope.Seal(vToken, "state", new { type = "state-test", thai = "สวัสดี ทดสอบ", n = 7 }),
            }));
            log.AppendLine($"wrote {outPath}");
        }

        // --- schedule ---
        var cfg = new AppConfig { Days = new[] { 1, 2, 3, 4, 5 }, Off = "18:00" };
        var mon = new DateTime(2026, 9, 28); // a Monday
        var sat = new DateTime(2026, 10, 3);
        Check("fires at off time on a scheduled day", ScheduleLogic.ShouldStartCountdown(cfg, mon.AddHours(18)));
        Check("fires inside the window", ScheduleLogic.ShouldStartCountdown(cfg, mon.AddHours(18).AddMinutes(9)));
        Check("does not fire before off time", !ScheduleLogic.ShouldStartCountdown(cfg, mon.AddHours(17).AddMinutes(59)));
        Check("does not fire after the window", !ScheduleLogic.ShouldStartCountdown(cfg, mon.AddHours(18).AddMinutes(10)));
        Check("does not fire on an unscheduled day", !ScheduleLogic.ShouldStartCountdown(cfg, sat.AddHours(18)));
        cfg.Paused = true;
        Check("does not fire while paused", !ScheduleLogic.ShouldStartCountdown(cfg, mon.AddHours(18)));
        cfg.Paused = false;
        cfg.LastHandledDate = "2026-09-28";
        Check("does not fire twice in one day", !ScheduleLogic.ShouldStartCountdown(cfg, mon.AddHours(18).AddMinutes(1)));
        Check("time validation", ScheduleLogic.IsValidTime("08:00") && !ScheduleLogic.IsValidTime("8:00") && !ScheduleLogic.IsValidTime("24:00") && !ScheduleLogic.IsValidTime(null));

        // --- pairing code format ---
        string code = AppConfig.RandomHex(4) + AppConfig.RandomHex(16);
        Check("pairing code is 40 hex chars", code.Length == 40 && code.All(Uri.IsHexDigit));
        Check("pairing code formatting", AppConfig.FormatCode(code).Replace("-", "") == code && AppConfig.FormatCode(code).Split('-').Length == 10);

        // --- catalog ---
        try
        {
            var scan = AppCatalog.ScanAsync().GetAwaiter().GetResult();
            Check("catalog scan finds programs", scan.Count > 0, $"({scan.Count} found)");
            Check("catalog ids are unique", scan.Select(s => s.Id).Distinct().Count() == scan.Count);
            foreach (var s in scan.Take(8)) log.AppendLine($"      - {s.Name}{(s.Running ? " [running]" : "")}");
        }
        catch (Exception ex)
        {
            Check("catalog scan", false, ex.Message);
        }

        log.AppendLine(failures == 0 ? "ALL PASSED" : $"{failures} FAILED");
        string dir = opts.DataDir ?? AppContext.BaseDirectory;
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "selftest.txt"), log.ToString());
        return failures == 0 ? 0 : 1;
    }
}
