using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace PcControllerAgent;

public sealed record CatalogEntry(string Id, string Name, string Launch, string? Exe, bool Running);

// Finds programs the user can pick (Start Menu shortcuts + currently open
// windowed programs) and launches/closes the ones they picked. The phone only
// ever sees IDs and display names; paths stay on this PC, so a message on the
// public broker can never make the agent run an arbitrary command.
public static class AppCatalog
{
    static readonly string[] SkipNames =
    {
        "uninstall", "unins", "readme", "read me", "help", "documentation", "license", "release notes",
        "website", "manual", "ถอนการติดตั้ง",
    };

    static readonly HashSet<string> SkipProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "ApplicationFrameHost", "TextInputHost", "SystemSettings", "ShellExperienceHost",
        "SearchHost", "StartMenuExperienceHost", "LockApp", "PcControllerAgent", "dotnet", "WindowsTerminal",
        "conhost", "RuntimeBroker", "Widgets", "WidgetService",
    };

    public static string MakeId(string launch) =>
        Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(launch.ToLowerInvariant())))[..10].ToLowerInvariant();

    // COM (WScript.Shell) wants an STA thread.
    public static Task<List<CatalogEntry>> ScanAsync()
    {
        var tcs = new TaskCompletionSource<List<CatalogEntry>>();
        var thread = new Thread(() =>
        {
            try { tcs.SetResult(Scan()); }
            catch (Exception ex) { tcs.SetException(ex); }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return tcs.Task;
    }

    public static List<CatalogEntry> Scan()
    {
        var running = RunningWindowed();
        var runningExe = new HashSet<string>(running.Select(r => r.Path), StringComparer.OrdinalIgnoreCase);

        var byExe = new Dictionary<string, CatalogEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, lnk, target) in InstalledShortcuts())
        {
            if (byExe.ContainsKey(target)) continue;
            byExe[target] = new CatalogEntry(MakeId(lnk), name, lnk, target, runningExe.Contains(target));
        }

        var list = byExe.Values.ToList();
        foreach (var (name, path) in running)
        {
            if (byExe.ContainsKey(path)) continue;
            list.Add(new CatalogEntry(MakeId(path), name, path, path, true));
        }

        return list.OrderBy(e => e.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    static IEnumerable<(string Name, string Lnk, string Target)> InstalledShortcuts()
    {
        var roots = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu), "Programs"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs"),
        };

        Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) yield break;
        dynamic shell = Activator.CreateInstance(shellType)!;

        foreach (string root in roots.Where(Directory.Exists))
        {
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(root, "*.lnk", SearchOption.AllDirectories).ToList(); }
            catch { continue; }

            foreach (string lnk in files)
            {
                string name = Path.GetFileNameWithoutExtension(lnk);
                if (SkipNames.Any(s => name.Contains(s, StringComparison.OrdinalIgnoreCase))) continue;

                string target;
                try { target = (string)shell.CreateShortcut(lnk).TargetPath; }
                catch { continue; }

                if (string.IsNullOrWhiteSpace(target) || !target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                if (!File.Exists(target)) continue;
                // Built-in Windows tools (Character Map, Disk Cleanup, ...) aren't programs anyone schedules.
                if (target.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.Windows) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                if (name.StartsWith('@')) continue;
                string exeName = Path.GetFileNameWithoutExtension(target);
                if (SkipNames.Any(s => exeName.Contains(s, StringComparison.OrdinalIgnoreCase))) continue;
                if (SkipProcesses.Contains(exeName)) continue;

                yield return (name, lnk, target);
            }
        }
    }

    static List<(string Name, string Path)> RunningWindowed()
    {
        var result = new List<(string, string)>();
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                if (p.MainWindowHandle == IntPtr.Zero || string.IsNullOrWhiteSpace(p.MainWindowTitle)) continue;
                if (SkipProcesses.Contains(p.ProcessName)) continue;
                string? path = p.MainModule?.FileName;
                if (path == null) continue;
                string name = p.MainModule?.FileVersionInfo.FileDescription?.Trim() is { Length: > 0 } d ? d : p.ProcessName;
                if (!result.Any(r => r.Item2.Equals(path, StringComparison.OrdinalIgnoreCase))) result.Add((name, path));
            }
            catch
            {
                // Elevated/protected processes refuse MainModule access; just skip them.
            }
            finally
            {
                p.Dispose();
            }
        }
        return result;
    }

    public static bool IsRunning(SelectedApp app)
    {
        if (app.Exe == null) return false;
        var procs = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(app.Exe));
        bool any = procs.Length > 0;
        foreach (var p in procs) p.Dispose();
        return any;
    }

    // Returns null on success, otherwise a short reason.
    public static string? Launch(SelectedApp app)
    {
        try
        {
            Process.Start(new ProcessStartInfo(app.Launch) { UseShellExecute = true })?.Dispose();
            return null;
        }
        catch (Exception ex)
        {
            return ex.Message;
        }
    }

    // Politely asks the program's windows to close, waits, then force-kills
    // whatever is left. Returns the apps that refused the polite request.
    public static async Task<List<string>> CloseAsync(IReadOnlyList<SelectedApp> apps, Action<string> log)
    {
        var refused = new List<string>();
        var targets = new List<(SelectedApp App, Process Proc, bool HadWindow)>();

        foreach (var app in apps.Where(a => a.Exe != null))
        {
            foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(app.Exe!)))
            {
                bool hadWindow = false;
                try
                {
                    hadWindow = p.MainWindowHandle != IntPtr.Zero;
                    if (hadWindow) p.CloseMainWindow();
                }
                catch { }
                targets.Add((app, p, hadWindow));
            }
        }

        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline && targets.Any(t => !SafeExited(t.Proc)))
            await Task.Delay(500);

        foreach (var (app, proc, hadWindow) in targets)
        {
            if (!SafeExited(proc))
            {
                log($"บังคับปิด {app.Name}");
                try { proc.Kill(entireProcessTree: true); } catch { }
                if (hadWindow && !refused.Contains(app.Name)) refused.Add(app.Name);
            }
            proc.Dispose();
        }
        return refused;
    }

    static bool SafeExited(Process p)
    {
        try { return p.HasExited; } catch { return true; }
    }
}
