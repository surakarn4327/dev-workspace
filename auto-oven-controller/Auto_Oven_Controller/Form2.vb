Public Class Form2
    Public ProcessList As OvenProcess()
    Public RecipeName As String
    Private currentStep As Integer
    Private secondsElapsed As Integer
    Private heater As IHeater
    Private fan As IFan
    Private sensor As ITemperatureSensor
    Private link As ModbusLink
    Private finsLink As FinsLink
    Private heartbeat As FinsHeartbeat
    Private reachedTarget As Boolean
    Private stepRising As Boolean
    Private directionKnown As Boolean

    ' ตำแหน่ง/ขนาด/ฟอนต์ของไฟแสดงสถานะ ตอนออกแบบบนฟอร์ม 1008x729 (พื้นหลังโหมด Zoom)
    Private Const DesignW As Single = 1008.0F
    Private Const DesignH As Single = 729.0F
    Private blowerDesign As RectangleF
    Private valveDesign As RectangleF
    Private blowerFontSize As Single
    Private valveFontSize As Single

    ' พื้นหลัง Zoom ย่อ/ขยายตามหน้าจอ แต่ Label ไม่ขยายตาม ต้องคำนวณตำแหน่งใหม่ให้ตรงกับรูป
    Private Sub PlaceIndicators()
        If blowerFontSize = 0 Then Return
        Dim img As Image = BackgroundImage
        If img Is Nothing Then Return
        ' ตำแหน่งของรูปในฟอร์มตอนออกแบบ (Zoom) และตอนนี้
        Dim sDesign As Single = Math.Min(DesignW / img.Width, DesignH / img.Height)
        Dim offDX As Single = (DesignW - img.Width * sDesign) / 2.0F
        Dim offDY As Single = (DesignH - img.Height * sDesign) / 2.0F
        Dim sNow As Single = Math.Min(ClientSize.Width / CSng(img.Width), ClientSize.Height / CSng(img.Height))
        If sNow <= 0 Then Return
        Dim offNX As Single = (ClientSize.Width - img.Width * sNow) / 2.0F
        Dim offNY As Single = (ClientSize.Height - img.Height * sNow) / 2.0F
        PlaceOne(sttBlower, blowerDesign, blowerFontSize, sDesign, offDX, offDY, sNow, offNX, offNY)
        PlaceOne(sttSysValve, valveDesign, valveFontSize, sDesign, offDX, offDY, sNow, offNX, offNY)
    End Sub

    Private Sub PlaceOne(lbl As Label, d As RectangleF, fontSize As Single, sD As Single, offDX As Single, offDY As Single, sN As Single, offNX As Single, offNY As Single)
        Dim k As Single = sN / sD
        lbl.Font = New Font(lbl.Font.FontFamily, fontSize * k, lbl.Font.Style, GraphicsUnit.Point, lbl.Font.GdiCharSet)
        lbl.SetBounds(CInt(offNX + (d.X - offDX) * k), CInt(offNY + (d.Y - offDY) * k), CInt(d.Width * k), CInt(d.Height * k))
    End Sub

    Private Sub Form2_Resize(sender As Object, e As EventArgs) Handles MyBase.Resize
        PlaceIndicators()
    End Sub

    Private Sub Form2_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        blowerDesign = New RectangleF(sttBlower.Left, sttBlower.Top, sttBlower.Width, sttBlower.Height)
        valveDesign = New RectangleF(sttSysValve.Left, sttSysValve.Top, sttSysValve.Width, sttSysValve.Height)
        blowerFontSize = sttBlower.Font.SizeInPoints
        valveFontSize = sttSysValve.Font.SizeInPoints
        ShowFullScreenOnSecondMonitor(Me)
        PlaceIndicators()
        txtOvenName.Text = OvenSettings.OvenName
        currentStep = 0
        secondsElapsed = 0
        CreateHardware()
        sensor = New SimulatedTemperatureSensor(heater)
        reachedTarget = False
        UpdateDisplay()
        UpdateHardwareIndicators()
    End Sub

    ' ใช้ PLC จริงผ่าน FINS ถ้าตั้งค่าไว้และต่อติด รองลงมา Factory I/O ผ่าน Modbus ไม่งั้นใช้ตัวจำลองในโปรแกรม
    Private Sub CreateHardware()
        If OvenSettings.UseFins Then
            finsLink = New FinsLink(OvenSettings.FinsHost, OvenSettings.FinsPort, OvenSettings.FinsPlcNode, OvenSettings.FinsPcNode)
            If finsLink.TryConnect() Then
                heater = New FinsHeater(finsLink)
                fan = New FinsFan(finsLink)
                heartbeat = New FinsHeartbeat(finsLink)
                Return
            End If
            MessageBox.Show("เชื่อมต่อ PLC ไม่ได้ (" & OvenSettings.FinsHost & ":" & OvenSettings.FinsPort & ")" & vbCrLf &
                            finsLink.LastError & vbCrLf & vbCrLf & "จะใช้ตัวจำลองในโปรแกรมแทน", "FINS", MessageBoxButtons.OK, MessageBoxIcon.Warning)
            finsLink.Dispose()
            finsLink = Nothing
        End If
        If OvenSettings.UseModbus Then
            link = New ModbusLink(OvenSettings.ModbusHost, OvenSettings.ModbusPort)
            If link.TryConnect() Then
                heater = New ModbusHeater(link)
                fan = New ModbusFan(link)
                Return
            End If
            MessageBox.Show("เชื่อมต่อ Factory I/O ไม่ได้ (" & OvenSettings.ModbusHost & ":" & OvenSettings.ModbusPort & ")" & vbCrLf &
                            link.LastError & vbCrLf & vbCrLf & "จะใช้ตัวจำลองในโปรแกรมแทน", "Modbus", MessageBoxButtons.OK, MessageBoxIcon.Warning)
            link = Nothing
        End If
        heater = New SimulatedHeater()
        fan = New SimulatedFan()
    End Sub

    ' ปิดฮีตเตอร์/วาล์วและพัดลมทุกครั้งที่ปิดหน้านี้ ไม่ให้ PLC หรือ Factory I/O ค้างสถานะเปิด
    Private Sub Form2_FormClosing(sender As Object, e As FormClosingEventArgs) Handles MyBase.FormClosing
        OvenTimer.Stop()
        ' ถ้าก่อนหน้านี้ส่งไม่ผ่านและกำลังพักรอ ให้ลองส่งคำสั่งปิดอีกครั้งทันที
        If finsLink IsNot Nothing Then finsLink.ResetRetry()
        If heater IsNot Nothing Then heater.TurnOff()
        If fan IsNot Nothing Then fan.TurnOff()
        If link IsNot Nothing Then link.Disconnect()
        If heartbeat IsNot Nothing Then heartbeat.Dispose()
        If finsLink IsNot Nothing Then finsLink.Dispose()
    End Sub

    Private Function FormatHour(totalMinutes As Integer) As String
        Dim h As Integer = totalMinutes \ 60
        Dim m As Integer = totalMinutes Mod 60
        Return h.ToString() & ":" & m.ToString("00")
    End Function

    Private Sub UpdateDisplay()
        txtModeName.Text = RecipeName
        txtProcess.Text = (currentStep + 1).ToString()
        txtMinutes.Text = (ProcessList(currentStep).Minutes - secondsElapsed).ToString()
        txtStatus.Text = ProcessList(currentStep).Status
        txtTemp.Text = sensor.CurrentTemp.ToString("0.0")

        lvProcess.Items.Clear()
        Dim i As Integer = 0
        For Each p As OvenProcess In ProcessList
            Dim row As New ListViewItem(New String() {(i + 1).ToString(), p.Temp.ToString(), p.Minutes.ToString(), FormatHour(p.Minutes), p.Status})
            If i = currentStep Then
                row.BackColor = Color.LightGreen
            End If
            lvProcess.Items.Add(row)
            i = i + 1
        Next
    End Sub

    Private Sub UpdateHardwareIndicators()
        sttBlower.ForeColor = If(fan.IsOn, Color.Lime, Color.Red)
        sttSysValve.ForeColor = If(heater.IsOn, Color.Lime, Color.Red)
    End Sub

    Private Sub btnStart_Click(sender As Object, e As EventArgs) Handles btnStart.Click
        OvenTimer.Start()
        heater.TurnOn()
        fan.TurnOn()
        UpdateHardwareIndicators()
    End Sub

    Private Sub btnStop_Click(sender As Object, e As EventArgs) Handles btnStop.Click
        OvenTimer.Stop()
        heater.TurnOff()
        fan.TurnOff()
        UpdateHardwareIndicators()
        currentStep = 0
        secondsElapsed = 0
        reachedTarget = False
        directionKnown = False
        UpdateDisplay()
    End Sub

    Private Sub OvenTimer_Tick(sender As Object, e As EventArgs) Handles OvenTimer.Tick
        If currentStep >= ProcessList.Length Then
            OvenTimer.Stop()
            Exit Sub
        End If

        Dim targetTemp As Integer = ProcessList(currentStep).Temp

        ' ทิศทางของขั้นนี้ดูจากอุณหภูมิตอนเริ่มขั้น เทียบกับเป้า ไม่ดูจากป้ายสถานะ
        ' (เช่น ขั้น "ทำให้เย็น" ที่เป้า 100 ต่อจากขั้นที่เป้า 90 ต้องเพิ่มอุณหภูมิขึ้น ไม่ใช่รอให้เย็นลง)
        If Not directionKnown Then
            stepRising = sensor.CurrentTemp < targetTemp
            directionKnown = True
        End If

        ' ถึงเป้าแล้วดับ ตกลงไป DropBand องศาแล้วเปิดใหม่ ระหว่างนั้นคงสถานะเดิม
        If sensor.CurrentTemp >= targetTemp Then
            heater.TurnOff()
        ElseIf sensor.CurrentTemp <= targetTemp - SimulatedTemperatureSensor.DropBand Then
            heater.TurnOn()
        End If

        UpdateHardwareIndicators()

        sensor.Tick(targetTemp)

        txtTemp.Text = sensor.CurrentTemp.ToString("0.0")

        If Not reachedTarget Then
            If stepRising Then
                reachedTarget = sensor.CurrentTemp >= targetTemp
            Else
                reachedTarget = sensor.CurrentTemp <= targetTemp
            End If
        End If

        If reachedTarget Then
            secondsElapsed = secondsElapsed + 1

            Dim totalSeconds As Integer = ProcessList(currentStep).Minutes
            Dim remaining As Integer = totalSeconds - secondsElapsed

            txtMinutes.Text = remaining.ToString()

            If remaining <= 0 Then
                currentStep = currentStep + 1

                If currentStep >= ProcessList.Length Then
                    OvenTimer.Stop()
                    heater.TurnOff()
                    fan.TurnOff()
                    UpdateHardwareIndicators()
                    txtStatus.Text = "เสร็จสิ้น"
                Else
                    secondsElapsed = 0
                    reachedTarget = False
                    directionKnown = False
                    UpdateDisplay()
                End If
            End If
        End If
    End Sub

    Private Sub btnClose_Click(sender As Object, e As EventArgs) Handles btnClose.Click
        Me.Close()
    End Sub


End Class
