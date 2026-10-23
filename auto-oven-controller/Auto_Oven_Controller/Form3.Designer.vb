<Global.Microsoft.VisualBasic.CompilerServices.DesignerGenerated()> _
Partial Class Form3
    Inherits System.Windows.Forms.Form

    'Form overrides dispose to clean up the component list.
    <System.Diagnostics.DebuggerNonUserCode()> _
    Protected Overrides Sub Dispose(ByVal disposing As Boolean)
        Try
            If disposing AndAlso components IsNot Nothing Then
                components.Dispose()
            End If
        Finally
            MyBase.Dispose(disposing)
        End Try
    End Sub

    'Required by the Windows Form Designer
    Private components As System.ComponentModel.IContainer

    'NOTE: The following procedure is required by the Windows Form Designer
    'It can be modified using the Windows Form Designer.  
    'Do not modify it using the code editor.
    <System.Diagnostics.DebuggerStepThrough()> _
    Private Sub InitializeComponent()
        Dim colRecipe As System.Windows.Forms.ColumnHeader
        Me.lvRecipes = New System.Windows.Forms.ListView()
        Me.colStep = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.colTemp = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.colMinutes = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.colHour = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.colStatus = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        colRecipe = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.SuspendLayout()
        '
        'lvRecipes
        '
        Me.lvRecipes.Columns.AddRange(New System.Windows.Forms.ColumnHeader() {colRecipe, Me.colStep, Me.colTemp, Me.colMinutes, Me.colHour, Me.colStatus})
        Me.lvRecipes.FullRowSelect = True
        Me.lvRecipes.GridLines = True
        Me.lvRecipes.HideSelection = False
        Me.lvRecipes.Location = New System.Drawing.Point(12, 12)
        Me.lvRecipes.Name = "lvRecipes"
        Me.lvRecipes.Size = New System.Drawing.Size(740, 630)
        Me.lvRecipes.TabIndex = 0
        Me.lvRecipes.UseCompatibleStateImageBehavior = False
        Me.lvRecipes.View = System.Windows.Forms.View.Details
        '
        'colRecipe
        '
        colRecipe.Text = "ผลิตภัณฑ์"
        colRecipe.Width = 160
        '
        'colStep
        '
        Me.colStep.Text = "Step"
        '
        'colTemp
        '
        Me.colTemp.Text = "อุณหภูมิ"
        Me.colTemp.Width = 100
        '
        'colMinutes
        '
        Me.colMinutes.Text = "นาที"
        Me.colMinutes.Width = 100
        '
        'colHour
        '
        Me.colHour.Text = "ชั่วโมง"
        Me.colHour.Width = 100
        '
        'colStatus
        '
        Me.colStatus.Text = "สถานะ"
        Me.colStatus.Width = 150
        '
        'Form3
        '
        Me.AutoScaleDimensions = New System.Drawing.SizeF(6.0!, 13.0!)
        Me.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font
        Me.ClientSize = New System.Drawing.Size(766, 656)
        Me.Controls.Add(Me.lvRecipes)
        Me.Name = "Form3"
        Me.Text = "Form3"
        Me.ResumeLayout(False)

    End Sub

    Friend WithEvents lvRecipes As ListView
    Friend WithEvents colStep As ColumnHeader
    Friend WithEvents colTemp As ColumnHeader
    Friend WithEvents colMinutes As ColumnHeader
    Friend WithEvents colHour As ColumnHeader
    Friend WithEvents colStatus As ColumnHeader
End Class
