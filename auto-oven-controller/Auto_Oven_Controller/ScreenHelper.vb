Module ScreenHelper
    Public Sub ShowFullScreenOnSecondMonitor(frm As Form)
        If Screen.AllScreens.Length > 1 Then
            Dim targetScreen As Screen = Screen.AllScreens(1)
            frm.FormBorderStyle = FormBorderStyle.None
            frm.StartPosition = FormStartPosition.Manual
            frm.Bounds = targetScreen.Bounds
            frm.WindowState = FormWindowState.Maximized
        End If
    End Sub
End Module
