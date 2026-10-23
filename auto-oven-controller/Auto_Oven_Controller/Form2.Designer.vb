<Global.Microsoft.VisualBasic.CompilerServices.DesignerGenerated()>
Partial Class Form2
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
        Me.components = New System.ComponentModel.Container()
        Me.btnStop = New System.Windows.Forms.Button()
        Me.btnStart = New System.Windows.Forms.Button()
        Me.txtStatus = New System.Windows.Forms.TextBox()
        Me.Label6 = New System.Windows.Forms.Label()
        Me.txtTemp = New System.Windows.Forms.TextBox()
        Me.Label5 = New System.Windows.Forms.Label()
        Me.txtMinutes = New System.Windows.Forms.TextBox()
        Me.Label2 = New System.Windows.Forms.Label()
        Me.txtModeName = New System.Windows.Forms.TextBox()
        Me.txtProcess = New System.Windows.Forms.TextBox()
        Me.Label1 = New System.Windows.Forms.Label()
        Me.OvenTimer = New System.Windows.Forms.Timer(Me.components)
        Me.Label8 = New System.Windows.Forms.Label()
        Me.lvProcess = New System.Windows.Forms.ListView()
        Me.ColumnHeader1 = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.ColumnHeader2 = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.ColumnHeader3 = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.ColumnHeader4 = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.ColumnHeader5 = CType(New System.Windows.Forms.ColumnHeader(), System.Windows.Forms.ColumnHeader)
        Me.btnClose = New System.Windows.Forms.Button()
        Me.txtOvenName = New System.Windows.Forms.TextBox()
        Me.Label9 = New System.Windows.Forms.Label()
        Me.sttBlower = New System.Windows.Forms.Label()
        Me.sttSysValve = New System.Windows.Forms.Label()
        Me.SuspendLayout()
        '
        'btnStop
        '
        Me.btnStop.BackColor = System.Drawing.Color.LightCoral
        Me.btnStop.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnStop.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnStop.Location = New System.Drawing.Point(827, 368)
        Me.btnStop.Name = "btnStop"
        Me.btnStop.Size = New System.Drawing.Size(147, 62)
        Me.btnStop.TabIndex = 50
        Me.btnStop.Text = "หยุด"
        Me.btnStop.UseVisualStyleBackColor = False
        '
        'btnStart
        '
        Me.btnStart.BackColor = System.Drawing.Color.LimeGreen
        Me.btnStart.FlatStyle = System.Windows.Forms.FlatStyle.Popup
        Me.btnStart.Font = New System.Drawing.Font("Microsoft Sans Serif", 21.75!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.btnStart.Location = New System.Drawing.Point(620, 368)
        Me.btnStart.Name = "btnStart"
        Me.btnStart.Size = New System.Drawing.Size(147, 62)
        Me.btnStart.TabIndex = 49
        Me.btnStart.Text = "เริ่ม"
        Me.btnStart.UseVisualStyleBackColor = False
        '
        'txtStatus
        '
        Me.txtStatus.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.txtStatus.Location = New System.Drawing.Point(620, 279)
        Me.txtStatus.Name = "txtStatus"
        Me.txtStatus.ReadOnly = True
        Me.txtStatus.Size = New System.Drawing.Size(354, 38)
        Me.txtStatus.TabIndex = 48
        '
        'Label6
        '
        Me.Label6.AutoSize = True
        Me.Label6.BackColor = System.Drawing.Color.Transparent
        Me.Label6.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label6.Location = New System.Drawing.Point(509, 282)
        Me.Label6.Name = "Label6"
        Me.Label6.Size = New System.Drawing.Size(105, 31)
        Me.Label6.TabIndex = 47
        Me.Label6.Text = "สถานะ :"
        '
        'txtTemp
        '
        Me.txtTemp.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.txtTemp.Location = New System.Drawing.Point(869, 156)
        Me.txtTemp.Name = "txtTemp"
        Me.txtTemp.ReadOnly = True
        Me.txtTemp.Size = New System.Drawing.Size(105, 38)
        Me.txtTemp.TabIndex = 46
        '
        'Label5
        '
        Me.Label5.AutoSize = True
        Me.Label5.BackColor = System.Drawing.Color.Transparent
        Me.Label5.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label5.Location = New System.Drawing.Point(744, 159)
        Me.Label5.Name = "Label5"
        Me.Label5.Size = New System.Drawing.Size(119, 31)
        Me.Label5.TabIndex = 45
        Me.Label5.Text = "อุณหภูมิ :"
        '
        'txtMinutes
        '
        Me.txtMinutes.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.txtMinutes.Location = New System.Drawing.Point(632, 221)
        Me.txtMinutes.Name = "txtMinutes"
        Me.txtMinutes.ReadOnly = True
        Me.txtMinutes.Size = New System.Drawing.Size(116, 38)
        Me.txtMinutes.TabIndex = 43
        '
        'Label2
        '
        Me.Label2.AutoSize = True
        Me.Label2.BackColor = System.Drawing.Color.Transparent
        Me.Label2.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label2.Location = New System.Drawing.Point(509, 224)
        Me.Label2.Name = "Label2"
        Me.Label2.Size = New System.Drawing.Size(117, 31)
        Me.Label2.TabIndex = 42
        Me.Label2.Text = "เหลืออีก :"
        '
        'txtModeName
        '
        Me.txtModeName.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.txtModeName.Location = New System.Drawing.Point(515, 90)
        Me.txtModeName.Name = "txtModeName"
        Me.txtModeName.ReadOnly = True
        Me.txtModeName.Size = New System.Drawing.Size(459, 38)
        Me.txtModeName.TabIndex = 39
        '
        'txtProcess
        '
        Me.txtProcess.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.txtProcess.Location = New System.Drawing.Point(629, 156)
        Me.txtProcess.Name = "txtProcess"
        Me.txtProcess.ReadOnly = True
        Me.txtProcess.Size = New System.Drawing.Size(66, 38)
        Me.txtProcess.TabIndex = 38
        '
        'Label1
        '
        Me.Label1.AutoSize = True
        Me.Label1.BackColor = System.Drawing.Color.Transparent
        Me.Label1.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label1.Location = New System.Drawing.Point(509, 159)
        Me.Label1.Name = "Label1"
        Me.Label1.Size = New System.Drawing.Size(114, 31)
        Me.Label1.TabIndex = 37
        Me.Label1.Text = "ขั้นตอน :"
        '
        'OvenTimer
        '
        Me.OvenTimer.Interval = 1000
        '
        'Label8
        '
        Me.Label8.AutoSize = True
        Me.Label8.BackColor = System.Drawing.Color.Transparent
        Me.Label8.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label8.Location = New System.Drawing.Point(754, 224)
        Me.Label8.Name = "Label8"
        Me.Label8.Size = New System.Drawing.Size(58, 31)
        Me.Label8.TabIndex = 53
        Me.Label8.Text = "นาที"
        '
        'lvProcess
        '
        Me.lvProcess.Columns.AddRange(New System.Windows.Forms.ColumnHeader() {Me.ColumnHeader1, Me.ColumnHeader2, Me.ColumnHeader3, Me.ColumnHeader4, Me.ColumnHeader5})
        Me.lvProcess.Font = New System.Drawing.Font("Microsoft Sans Serif", 14.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.lvProcess.FullRowSelect = True
        Me.lvProcess.GridLines = True
        Me.lvProcess.HideSelection = False
        Me.lvProcess.Location = New System.Drawing.Point(14, 22)
        Me.lvProcess.Name = "lvProcess"
        Me.lvProcess.Size = New System.Drawing.Size(476, 408)
        Me.lvProcess.TabIndex = 54
        Me.lvProcess.UseCompatibleStateImageBehavior = False
        Me.lvProcess.View = System.Windows.Forms.View.Details
        '
        'ColumnHeader1
        '
        Me.ColumnHeader1.Text = "ขั้นตอน"
        Me.ColumnHeader1.Width = 70
        '
        'ColumnHeader2
        '
        Me.ColumnHeader2.Text = "อุณหภูมิ"
        Me.ColumnHeader2.TextAlign = System.Windows.Forms.HorizontalAlignment.Center
        Me.ColumnHeader2.Width = 70
        '
        'ColumnHeader3
        '
        Me.ColumnHeader3.Text = "เวลา(นาที)"
        Me.ColumnHeader3.TextAlign = System.Windows.Forms.HorizontalAlignment.Center
        Me.ColumnHeader3.Width = 90
        '
        'ColumnHeader4
        '
        Me.ColumnHeader4.Text = "เวลา(ชม.)"
        Me.ColumnHeader4.TextAlign = System.Windows.Forms.HorizontalAlignment.Center
        Me.ColumnHeader4.Width = 90
        '
        'ColumnHeader5
        '
        Me.ColumnHeader5.Text = "สถานะ"
        Me.ColumnHeader5.TextAlign = System.Windows.Forms.HorizontalAlignment.Center
        Me.ColumnHeader5.Width = 150
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
        Me.btnClose.TabIndex = 57
        Me.btnClose.Text = "X"
        Me.btnClose.UseVisualStyleBackColor = False
        '
        'txtOvenName
        '
        Me.txtOvenName.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.txtOvenName.Location = New System.Drawing.Point(594, 27)
        Me.txtOvenName.Name = "txtOvenName"
        Me.txtOvenName.ReadOnly = True
        Me.txtOvenName.Size = New System.Drawing.Size(105, 38)
        Me.txtOvenName.TabIndex = 59
        '
        'Label9
        '
        Me.Label9.AutoSize = True
        Me.Label9.BackColor = System.Drawing.Color.Transparent
        Me.Label9.Font = New System.Drawing.Font("Microsoft Sans Serif", 20.25!, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.Label9.Location = New System.Drawing.Point(509, 30)
        Me.Label9.Name = "Label9"
        Me.Label9.Size = New System.Drawing.Size(79, 31)
        Me.Label9.TabIndex = 58
        Me.Label9.Text = "ตู้อบ :"
        '
        'sttBlower
        '
        Me.sttBlower.BackColor = System.Drawing.Color.Transparent
        Me.sttBlower.Font = New System.Drawing.Font("Microsoft Sans Serif", 153.0!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(222, Byte))
        Me.sttBlower.ForeColor = System.Drawing.Color.Red
        Me.sttBlower.Location = New System.Drawing.Point(356, 559)
        Me.sttBlower.Name = "sttBlower"
        Me.sttBlower.Size = New System.Drawing.Size(104, 104)
        Me.sttBlower.TabIndex = 60
        Me.sttBlower.Text = "●"
        Me.sttBlower.TextAlign = System.Drawing.ContentAlignment.MiddleCenter
        Me.sttBlower.UseCompatibleTextRendering = True
        '
        'sttSysValve
        '
        Me.sttSysValve.BackColor = System.Drawing.Color.Transparent
        Me.sttSysValve.Font = New System.Drawing.Font("Cambria Math", 74.25!, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point, CType(0, Byte))
        Me.sttSysValve.ForeColor = System.Drawing.Color.Red
        Me.sttSysValve.Location = New System.Drawing.Point(197, 468)
        Me.sttSysValve.Name = "sttSysValve"
        Me.sttSysValve.Size = New System.Drawing.Size(80, 85)
        Me.sttSysValve.TabIndex = 61
        Me.sttSysValve.Text = "⧓"
        Me.sttSysValve.TextAlign = System.Drawing.ContentAlignment.TopCenter
        Me.sttSysValve.UseCompatibleTextRendering = True
        '
        'Form2
        '
        Me.AutoScaleDimensions = New System.Drawing.SizeF(6.0!, 13.0!)
        Me.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font
        Me.BackgroundImage = Global.Auto_Oven_Controller.My.Resources.Resources.รูปหลัก__2_
        Me.BackgroundImageLayout = System.Windows.Forms.ImageLayout.Zoom
        Me.ClientSize = New System.Drawing.Size(1008, 729)
        Me.Controls.Add(Me.sttSysValve)
        Me.Controls.Add(Me.sttBlower)
        Me.Controls.Add(Me.txtOvenName)
        Me.Controls.Add(Me.Label9)
        Me.Controls.Add(Me.btnClose)
        Me.Controls.Add(Me.lvProcess)
        Me.Controls.Add(Me.Label8)
        Me.Controls.Add(Me.btnStop)
        Me.Controls.Add(Me.btnStart)
        Me.Controls.Add(Me.txtStatus)
        Me.Controls.Add(Me.Label6)
        Me.Controls.Add(Me.txtTemp)
        Me.Controls.Add(Me.Label5)
        Me.Controls.Add(Me.txtMinutes)
        Me.Controls.Add(Me.Label2)
        Me.Controls.Add(Me.txtModeName)
        Me.Controls.Add(Me.txtProcess)
        Me.Controls.Add(Me.Label1)
        Me.Name = "Form2"
        Me.Text = " "
        Me.ResumeLayout(False)
        Me.PerformLayout()

    End Sub

    Friend WithEvents btnStop As Button
    Friend WithEvents btnStart As Button
    Friend WithEvents txtStatus As TextBox
    Friend WithEvents Label6 As Label
    Friend WithEvents txtTemp As TextBox
    Friend WithEvents Label5 As Label
    Friend WithEvents txtMinutes As TextBox
    Friend WithEvents Label2 As Label
    Friend WithEvents txtModeName As TextBox
    Friend WithEvents txtProcess As TextBox
    Friend WithEvents Label1 As Label
    Friend WithEvents OvenTimer As Timer
    Friend WithEvents Label8 As Label
    Friend WithEvents lvProcess As ListView
    Friend WithEvents ColumnHeader1 As ColumnHeader
    Friend WithEvents ColumnHeader2 As ColumnHeader
    Friend WithEvents ColumnHeader3 As ColumnHeader
    Friend WithEvents ColumnHeader4 As ColumnHeader
    Friend WithEvents ColumnHeader5 As ColumnHeader
    Friend WithEvents btnClose As Button
    Friend WithEvents txtOvenName As TextBox
    Friend WithEvents Label9 As Label
    Friend WithEvents sttBlower As Label
    Friend WithEvents sttSysValve As Label
End Class
