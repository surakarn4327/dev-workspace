using System.Text.RegularExpressions;

namespace PcControllerAgent;

public static class ScheduleLogic
{
    // The countdown only fires within this many minutes after the off time, so
    // booting the PC at 21:00 doesn't immediately shut it down for a 18:00 schedule.
    public const int FireWindowMinutes = 10;

    static readonly Regex Hhmm = new(@"^([01]\d|2[0-3]):[0-5]\d$");

    public static bool IsValidTime(string? s) => s != null && Hhmm.IsMatch(s);

    public static DateTime TimeOn(DateTime day, string hhmm)
    {
        int h = int.Parse(hhmm[..2]);
        int m = int.Parse(hhmm[3..5]);
        return day.Date.AddHours(h).AddMinutes(m);
    }

    // True when the regular (non-postponed) shutdown countdown should start now.
    public static bool ShouldStartCountdown(AppConfig cfg, DateTime now)
    {
        if (cfg.Paused || !cfg.Days.Contains((int)now.DayOfWeek)) return false;
        string today = now.ToString("yyyy-MM-dd");
        if (cfg.LastHandledDate == today) return false;
        DateTime off = TimeOn(now, cfg.Off);
        return now >= off && now < off.AddMinutes(FireWindowMinutes);
    }
}
