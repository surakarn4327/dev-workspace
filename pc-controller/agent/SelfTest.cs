using System.Text;
using System.Text.Json;

namespace PcControllerAgent;

// `PcControllerAgent.exe --selftest [--vector file.json] [--data-dir dir]`
// Runs the pure-logic checks (crypto, schedule, catalog scan) without any UI or
// network, and writes selftest.txt. Exit code 0 = all passed. The optional
// vector file is produced by the phone app's crypto (scripts/crypto-vector.mjs)
// to prove both sides really derive the same key/agent ID from a pairing code
// and speak the same envelope format.
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

        // --- pairing code ---
        string code = Pairing.NewCode();
        Check("new code is 12 valid characters", Pairing.Normalize(code) == code);
        Check("formatted as xxxx-xxxx-xxxx", Pairing.Format("K7M2P9X4QA3D") == "K7M2-P9X4-QA3D");
        Check("normalize accepts lower case, dashes, spaces", Pairing.Normalize(" k7m2-p9x4 qa3d ") == "K7M2P9X4QA3D");
        Check("normalize maps look-alikes (O/I/L)", Pairing.Normalize("K7M2-P9X4-QA3D") == Pairing.Normalize("k7m2p9x4qa3d") && Pairing.Normalize("OIL0OIL0OIL0") == "011001100110");
        Check("normalize rejects wrong length / bad chars", Pairing.Normalize("K7M2-P9X4") == null && Pairing.Normalize("K7M2-P9X4-QA3U") == null && Pairing.Normalize(null) == null);
        var (idA, keyA) = Pairing.Derive("K7M2P9X4QA3D");
        var (idB, keyB) = Pairing.Derive("K7M2P9X4QA3D");
        var (idC, _) = Pairing.Derive("K7M2P9X4QA3E");
        Check("derive is deterministic, 8-hex agent id, 32-byte key", idA == idB && keyA.SequenceEqual(keyB) && idA.Length == 8 && keyA.Length == 32);
        Check("different code gives different agent id", idA != idC);

        // --- crypto ---
        byte[] key = keyA;
        string sealedText = Envelope.Seal(key, "cmd", new { hello = "world", n = 42 });
        var back = Envelope.Open(key, "cmd", sealedText);
        Check("envelope round-trip", back is { } b && b.GetProperty("hello").GetString() == "world" && b.GetProperty("n").GetInt32() == 42);
        Check("wrong key rejected", Envelope.Open(Pairing.Derive("K7M2P9X4QA3E").Key, "cmd", sealedText) == null);
        Check("wrong direction rejected", Envelope.Open(key, "state", sealedText) == null);
        Check("garbage rejected", Envelope.Open(key, "cmd", "not json") == null);

        if (opts.VectorFile != null)
        {
            var v = JsonDocument.Parse(File.ReadAllText(opts.VectorFile)).RootElement;
            string vCode = v.GetProperty("code").GetString()!;
            var (vId, vKey) = Pairing.Derive(vCode);
            Check("agent id derived from the code matches the phone app (JS)", vId == v.GetProperty("agentId").GetString());
            var fromJs = Envelope.Open(vKey, v.GetProperty("direction").GetString()!, v.GetProperty("envelope").GetString()!);
            Check("decrypts envelope made by the phone app (JS)",
                fromJs is { } j && j.GetProperty("type").GetString() == "cfg-test" && j.GetProperty("thai").GetString() == "สวัสดี ทดสอบ");

            // and the reverse direction, verified by the JS side reading this file
            string outPath = Path.Combine(Path.GetDirectoryName(opts.VectorFile)!, "vector-from-csharp.json");
            File.WriteAllText(outPath, JsonSerializer.Serialize(new
            {
                code = vCode,
                direction = "state",
                envelope = Envelope.Seal(vKey, "state", new { type = "state-test", thai = "สวัสดี ทดสอบ", n = 7 }),
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
