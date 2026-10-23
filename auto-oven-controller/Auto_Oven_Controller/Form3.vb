Public Class Form3
    Public Sub New()
        InitializeComponent()
        LoadRecipes()
    End Sub

    Private Sub LoadRecipes()
        lvRecipes.Items.AddRange(New ListViewItem() {
            New ListViewItem(New String() {"GPN: 1.5 - 6", "1", "125", "240", "4:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >6 - 10", "1", "125", "300", "5:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >10 - 18", "1", "95", "60", "1:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >10 - 18", "2", "105", "60", "1:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >10 - 18", "3", "120", "60", "1:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >10 - 18", "4", "134", "210", "3:30", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "1", "85", "90", "1:30", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "2", "105", "60", "1:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "3", "115", "60", "1:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "4", "134", "360", "6:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "5", "75", "10", "0:10", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "6", "80", "90", "1:30", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "7", "55", "10", "0:10", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >18 - 30", "8", "60", "120", "2:00", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "1", "60", "120", "2:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "2", "80", "120", "2:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "3", "90", "60", "1:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "4", "100", "120", "2:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "5", "110", "120", "2:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "6", "134", "420", "7:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "7", "90", "10", "0:10", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "8", "100", "120", "2:00", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "9", "80", "90", "1:30", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >32 - 50", "10", "60", "120", "2:00", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >40.0", "1", "80", "60", "1:00", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >40.0", "2", "100", "30", "0:30", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >40.0", "3", "110", "30", "0:30", "ให้ความร้อน"}),
            New ListViewItem(New String() {"GPN: >40.0", "4", "127", "100", "7:00", "ให้ความร้อน"}), 'แก้จาก 420
            New ListViewItem(New String() {"GPN: >40.0", "5", "90", "10", "0:10", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >40.0", "6", "100", "30", "0:30", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >40.0", "7", "80", "30", "0:30", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >40.0", "8", "85", "10", "0:10", "ทำให้เย็น"}),
            New ListViewItem(New String() {"GPN: >40.0", "9", "60", "90", "1:30", "ทำให้เย็น"})
        })
    End Sub

End Class