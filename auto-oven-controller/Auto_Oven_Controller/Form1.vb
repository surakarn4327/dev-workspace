Public Class Form1
    Private Sub Form1_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        ShowFullScreenOnSecondMonitor(Me)
        txtOvenName.Text = OvenSettings.OvenName
    End Sub

    Private Function GetProcess(recipeName As String) As OvenProcess()
        Dim list As New List(Of OvenProcess)

        For Each item As ListViewItem In Form3.lvRecipes.Items
            If item.SubItems(0).Text = recipeName Then
                Dim p As New OvenProcess()
                p.Temp = Integer.Parse(item.SubItems(2).Text)
                p.Minutes = Integer.Parse(item.SubItems(3).Text)
                p.Status = item.SubItems(5).Text
                list.Add(p)
            End If
        Next

        Return list.ToArray()
    End Function

    Private Sub btnMode01_Click(sender As Object, e As EventArgs) Handles btnMode01.Click
        Form2.RecipeName = btnMode01.Text
        Form2.ProcessList = GetProcess(btnMode01.Text)
        Form2.Show()
    End Sub

    Private Sub btnMode02_Click(sender As Object, e As EventArgs) Handles btnMode02.Click
        Form2.RecipeName = btnMode02.Text
        Form2.ProcessList = GetProcess(btnMode02.Text)
        Form2.Show()
    End Sub

    Private Sub btnMode03_Click(sender As Object, e As EventArgs) Handles btnMode03.Click
        Form2.RecipeName = btnMode03.Text
        Form2.ProcessList = GetProcess(btnMode03.Text)
        Form2.Show()
    End Sub

    Private Sub btnMode04_Click(sender As Object, e As EventArgs) Handles btnMode04.Click
        Form2.RecipeName = btnMode04.Text
        Form2.ProcessList = GetProcess(btnMode04.Text)
        Form2.Show()
    End Sub

    Private Sub btnMode05_Click(sender As Object, e As EventArgs) Handles btnMode05.Click
        Form2.RecipeName = btnMode05.Text
        Form2.ProcessList = GetProcess(btnMode05.Text)
        Form2.Show()
    End Sub

    Private Sub btnMode06_Click(sender As Object, e As EventArgs) Handles btnMode06.Click
        Form2.RecipeName = btnMode06.Text
        Form2.ProcessList = GetProcess(btnMode06.Text)
        Form2.Show()
    End Sub

    Private Sub btnClose_Click(sender As Object, e As EventArgs) Handles btnClose.Click
        Me.Close()
    End Sub
End Class

Public Class OvenProcess
    Public Temp As Integer
    Public Minutes As Integer
    Public Status As String

End Class