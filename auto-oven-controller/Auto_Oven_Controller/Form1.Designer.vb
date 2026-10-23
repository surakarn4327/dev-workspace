<Global.Microsoft.VisualBasic.CompilerServices.DesignerGenerated()>
Partial Class Form1
    Inherits System.Windows.Forms.Form

    'Form overrides dispose to clean up the component list.
    <System.Diagnostics.DebuggerNonUserCode()>
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
    <System.Diagnostics.DebuggerStepThrough()>
    Private Sub InitializeComponent()
        Me.Label1 = New System.Windows.Forms.Label()
        Me.btnMode06 = New System.Windows.Forms.Button()
        Me.btnMode05 = New System.Windows.Forms.Button()
        Me.btnMode04 = New System.Windows.Forms.Button()
        Me.btnMode03 = New System.Windows.Forms.Button()
        Me.btnMode02 = New System.Windows.Forms.Button()
        Me.btnMode01 = New System.Windows.Forms.Button()
        Me.btnClose = New System.Windows.Forms.Button()
        Me.txtOvenName = New System.Windows.Forms.TextBox()
        Me.Label9 = New System.Windows.Forms.Label()
        Me.SuspendLayout()
        '
        'Label1
        '
        Me.Label1.AutoSize = True
        Me.Label1.Font = New System.Drawing.Font("Microsoft Sans Serif", 36.0!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label1.Location = New System.Drawing.Point(251, 92)
        Me.Label1.Name = "Label1"
        Me.Label1.Size = New System.Drawing.Size(502, 55)
        Me.Label1.TabIndex = 25
        Me.Label1.Text = "ระบบควบคุมอุณหภูมิตู้อบ"
        '
        'btnMode06
        '
        Me.btnMode06.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnMode06.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnMode06.Location = New System.Drawing.Point(696, 366)
        Me.btnMode06.Name = "btnMode06"
        Me.btnMode06.Size = New System.Drawing.Size(300, 115)
        Me.btnMode06.TabIndex = 24
        Me.btnMode06.Text = "GPN: >40.0"
        Me.btnMode06.UseVisualStyleBackColor = True
        '
        'btnMode05
        '
        Me.btnMode05.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnMode05.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnMode05.Location = New System.Drawing.Point(354, 366)
        Me.btnMode05.Name = "btnMode05"
        Me.btnMode05.Size = New System.Drawing.Size(300, 115)
        Me.btnMode05.TabIndex = 23
        Me.btnMode05.Text = "GPN: >32 - 50"
        Me.btnMode05.UseVisualStyleBackColor = True
        '
        'btnMode04
        '
        Me.btnMode04.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnMode04.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnMode04.Location = New System.Drawing.Point(12, 366)
        Me.btnMode04.Name = "btnMode04"
        Me.btnMode04.Size = New System.Drawing.Size(300, 115)
        Me.btnMode04.TabIndex = 22
        Me.btnMode04.Text = "GPN: >18 - 30"
        Me.btnMode04.UseVisualStyleBackColor = True
        '
        'btnMode03
        '
        Me.btnMode03.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnMode03.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnMode03.Location = New System.Drawing.Point(696, 195)
        Me.btnMode03.Name = "btnMode03"
        Me.btnMode03.Size = New System.Drawing.Size(300, 115)
        Me.btnMode03.TabIndex = 21
        Me.btnMode03.Text = "GPN: >10 - 18"
        Me.btnMode03.UseVisualStyleBackColor = True
        '
        'btnMode02
        '
        Me.btnMode02.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnMode02.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnMode02.Location = New System.Drawing.Point(354, 195)
        Me.btnMode02.Name = "btnMode02"
        Me.btnMode02.Size = New System.Drawing.Size(300, 115)
        Me.btnMode02.TabIndex = 20
        Me.btnMode02.Text = "GPN: >6 - 10"
        Me.btnMode02.UseVisualStyleBackColor = True
        '
        'btnMode01
        '
        Me.btnMode01.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnMode01.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnMode01.Location = New System.Drawing.Point(12, 195)
        Me.btnMode01.Name = "btnMode01"
        Me.btnMode01.Size = New System.Drawing.Size(300, 115)
        Me.btnMode01.TabIndex = 19
        Me.btnMode01.Text = "GPN: 1.5 - 6"
        Me.btnMode01.UseVisualStyleBackColor = True
        '
        'btnClose
        '
        Me.btnClose.BackColor = System.Drawing.Color.Brown
        Me.btnClose.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnClose.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnClose.ForeColor = System.Drawing.Color.Black
        Me.btnClose.Location = New System.Drawing.Point(946, 12)
        Me.btnClose.Name = "btnClose"
        Me.btnClose.Size = New System.Drawing.Size(50, 50)
        Me.btnClose.TabIndex = 58
        Me.btnClose.Text = "X"
        Me.btnClose.UseVisualStyleBackColor = False
        '
        'txtOvenName
        '
        Me.txtOvenName.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.txtOvenName.Location = New System.Drawing.Point(102, 6)
        Me.txtOvenName.Name = "txtOvenName"
        Me.txtOvenName.ReadOnly = True
        Me.txtOvenName.Size = New System.Drawing.Size(105, 40)
        Me.txtOvenName.TabIndex = 61
        '
        'Label9
        '
        Me.Label9.AutoSize = True
        Me.Label9.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label9.Location = New System.Drawing.Point(12, 9)
        Me.Label9.Name = "Label9"
        Me.Label9.Size = New System.Drawing.Size(84, 33)
        Me.Label9.TabIndex = 60
        Me.Label9.Text = "ตู้อบ :"
        '
        'Form1
        '
        Me.AutoScaleDimensions = New System.Drawing.SizeF(6.0!, 13.0!)
        Me.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font
        Me.ClientSize = New System.Drawing.Size(1008, 729)
        Me.Controls.Add(Me.txtOvenName)
        Me.Controls.Add(Me.Label9)
        Me.Controls.Add(Me.btnClose)
        Me.Controls.Add(Me.Label1)
        Me.Controls.Add(Me.btnMode06)
        Me.Controls.Add(Me.btnMode05)
        Me.Controls.Add(Me.btnMode04)
        Me.Controls.Add(Me.btnMode03)
        Me.Controls.Add(Me.btnMode02)
        Me.Controls.Add(Me.btnMode01)
        Me.Name = "Form1"
        Me.Text = "ระบบควบคุมอุณหภูมิเตาอบ"
        Me.ResumeLayout(False)
        Me.PerformLayout()

    End Sub

    Friend WithEvents Label1 As Label
    Friend WithEvents btnMode06 As Button
    Friend WithEvents btnMode05 As Button
    Friend WithEvents btnMode04 As Button
    Friend WithEvents btnMode03 As Button
    Friend WithEvents btnMode02 As Button
    Friend WithEvents btnMode01 As Button
    Friend WithEvents btnClose As Button
    Friend WithEvents txtOvenName As TextBox
    Friend WithEvents Label9 As Label
End Class
