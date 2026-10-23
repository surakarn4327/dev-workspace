Imports System.Net
Imports System.Net.Sockets

' บิตที่โปรแกรมนี้เขียนเข้า PLC Omron CP1L-M30DR-A (พื้นที่ W)
' ladder ใน PLC เป็นตัวสั่งขาออกจริง: ฮีตเตอร์ = 100.00, พัดลม = 100.02
' (ดู ladder_watchdog_mnemonic.txt) ถ้าไม่มีสัญญาณชีพจรเกินเวลาที่ ladder ตั้งไว้ PLC จะปิดขาออกเอง
Public Module PlcMap
    Public Const WorkWord As Integer = 0              ' W0
    Public Const HeaterRequestBit As Integer = 0      ' W0.00 = ขอให้ฮีตเตอร์ทำงาน
    Public Const FanRequestBit As Integer = 1         ' W0.01 = ขอให้พัดลมทำงาน
    Public Const HeartbeatBit As Integer = 2          ' W0.02 = สัญญาณชีพจร สลับ 0/1 ทุกวินาที
    Public Const HeartbeatIntervalMs As Integer = 1000
End Module

' การเชื่อมต่อ FINS/UDP ตัวเดียว ใช้ร่วมกันระหว่าง heater, fan และสัญญาณชีพจร
Public Class FinsLink
    Implements IDisposable

    ' รหัส memory area ของ FINS: 30 = CIO (bit), 31 = W (bit)
    Public Const AreaCioBit As Byte = &H30
    Public Const AreaWorkBit As Byte = &H31

    Private Const RetrySeconds As Integer = 5
    Private Const ReplyTimeoutMs As Integer = 1000

    Private ReadOnly udp As UdpClient
    Private ReadOnly header As Byte()
    Private sidCounter As Integer
    Private nextRetry As DateTime = DateTime.MinValue

    Public Sub New(host As String, port As Integer, plcNode As Integer, pcNode As Integer)
        udp = New UdpClient()
        udp.Client.ReceiveTimeout = ReplyTimeoutMs
        udp.Client.SendTimeout = ReplyTimeoutMs
        ' UDP ไม่มีการจับมือ Connect แค่จำปลายทาง ไม่ได้แปลว่า PLC ตอบ
        udp.Connect(host, port)
        ' FINS header 10 ไบต์: ICF, RSV, GCT, DNA, DA1(node PLC), DA2, SNA, SA1(node PC), SA2, SID
        header = New Byte() {&H80, &H0, &H2, &H0, CByte(plcNode), &H0, &H0, CByte(pcNode), &H0, &H0}
    End Sub

    Public Property LastError As String

    ' ถามสถานะ CPU (คำสั่ง 06 01 อ่านอย่างเดียว) ถ้า PLC ตอบ OK ถือว่าต่อติด
    Public Function TryConnect() As Boolean
        Return Exchange(New Byte() {&H6, &H1})
    End Function

    ' เขียนบิตใน PLC ส่งสำเร็จคืน True ถ้าล้มเหลวไม่ throw (กัน Timer เด้ง) แต่เก็บข้อความไว้ใน LastError
    Public Function TryWriteBit(area As Byte, word As Integer, bit As Integer, value As Boolean) As Boolean
        ' 01 02 = เขียน memory area, ตามด้วย area(1) word(2) bit(1) จำนวน(2) ข้อมูล(1)
        Dim body As Byte() = New Byte() {&H1, &H2, area, CByte((word >> 8) And &HFF), CByte(word And &HFF), CByte(bit),
                                         &H0, &H1, If(value, CByte(1), CByte(0))}
        Return Exchange(body)
    End Function

    ' ยกเลิกการพักรอ ใช้ก่อนสั่งปิดตอนปิดหน้าจอ เพื่อให้คำสั่งปิดถูกส่งแน่ๆ
    Public Sub ResetRetry()
        nextRetry = DateTime.MinValue
    End Sub

    Private Function Exchange(body As Byte()) As Boolean
        ' หลังล้มเหลว พักก่อนลองใหม่ ไม่งั้นทุก tick จะรอ timeout จนหน้าจอค้าง
        If DateTime.Now < nextRetry Then
            Return False
        End If
        Try
            sidCounter = (sidCounter + 1) And &HFF
            Dim sid As Byte = CByte(sidCounter)

            Dim frame(header.Length + body.Length - 1) As Byte
            Buffer.BlockCopy(header, 0, frame, 0, header.Length)
            Buffer.BlockCopy(body, 0, frame, header.Length, body.Length)
            frame(9) = sid

            ' ทิ้งคำตอบเก่าที่ค้างอยู่ จะได้ไม่เอาไปปนกับคำตอบของคำสั่งนี้
            Do While udp.Available > 0
                Dim junkEp As New IPEndPoint(IPAddress.Any, 0)
                udp.Receive(junkEp)
            Loop

            udp.Send(frame, frame.Length)

            Dim ep As New IPEndPoint(IPAddress.Any, 0)
            Dim reply As Byte() = udp.Receive(ep)

            If reply.Length < 14 Then
                Throw New InvalidOperationException("คำตอบจาก PLC สั้นเกินไป (" & reply.Length & " ไบต์)")
            End If
            If reply(9) <> sid Then
                Throw New InvalidOperationException("คำตอบจาก PLC ไม่ตรงกับคำสั่งที่ส่ง")
            End If
            If reply(12) <> 0 OrElse reply(13) <> 0 Then
                Throw New InvalidOperationException("PLC ตอบ end code " & reply(12).ToString("X2") & reply(13).ToString("X2"))
            End If
            Return True
        Catch ex As Exception
            LastError = ex.Message
            nextRetry = DateTime.Now.AddSeconds(RetrySeconds)
            Return False
        End Try
    End Function

    Public Sub Dispose() Implements IDisposable.Dispose
        Try
            udp.Close()
        Catch ex As Exception
            LastError = ex.Message
        End Try
    End Sub
End Class

' บิตคำสั่งหนึ่งตัวใน PLC จำสถานะที่ต้องการ และเขียนซ้ำถ้าครั้งก่อนเขียนไม่สำเร็จ
Friend Class FinsOutputBit
    Private ReadOnly link As FinsLink
    Private ReadOnly word As Integer
    Private ReadOnly bit As Integer
    Private _isOn As Boolean
    Private writePending As Boolean

    Public Sub New(link As FinsLink, word As Integer, bit As Integer)
        Me.link = link
        Me.word = word
        Me.bit = bit
        _isOn = False
        writePending = True
        Flush()
    End Sub

    Public ReadOnly Property IsOn As Boolean
        Get
            Return _isOn
        End Get
    End Property

    ' เขียนเมื่อสถานะเปลี่ยน หรือเมื่อครั้งก่อนเขียนไม่สำเร็จ (ลองใหม่ในการเรียกครั้งถัดไป)
    Public Sub SetState(value As Boolean)
        If value <> _isOn Then
            _isOn = value
            writePending = True
        End If
        If writePending Then
            Flush()
        End If
    End Sub

    Private Sub Flush()
        writePending = Not link.TryWriteBit(FinsLink.AreaWorkBit, word, bit, _isOn)
    End Sub
End Class

Public Class FinsHeater
    Implements IHeater

    Private ReadOnly output As FinsOutputBit

    Public Sub New(link As FinsLink)
        output = New FinsOutputBit(link, PlcMap.WorkWord, PlcMap.HeaterRequestBit)
    End Sub

    Public ReadOnly Property IsOn As Boolean Implements IHeater.IsOn
        Get
            Return output.IsOn
        End Get
    End Property

    Public Sub TurnOn() Implements IHeater.TurnOn
        output.SetState(True)
    End Sub

    Public Sub TurnOff() Implements IHeater.TurnOff
        output.SetState(False)
    End Sub
End Class

Public Class FinsFan
    Implements IFan

    Private ReadOnly output As FinsOutputBit

    Public Sub New(link As FinsLink)
        output = New FinsOutputBit(link, PlcMap.WorkWord, PlcMap.FanRequestBit)
    End Sub

    Public ReadOnly Property IsOn As Boolean Implements IFan.IsOn
        Get
            Return output.IsOn
        End Get
    End Property

    Public Sub TurnOn() Implements IFan.TurnOn
        output.SetState(True)
    End Sub

    Public Sub TurnOff() Implements IFan.TurnOff
        output.SetState(False)
    End Sub
End Class

' สลับสัญญาณชีพจรใน PLC ทุกวินาที ladder ใช้ดูว่าโปรแกรมนี้ยังทำงานอยู่ ถ้าเงียบไปเกินเวลาที่ตั้ง PLC ปิดขาออกเอง
Public Class FinsHeartbeat
    Implements IDisposable

    Private ReadOnly link As FinsLink
    Private ReadOnly ticker As Timer
    Private level As Boolean

    Public Sub New(link As FinsLink)
        Me.link = link
        ticker = New Timer()
        ticker.Interval = PlcMap.HeartbeatIntervalMs
        AddHandler ticker.Tick, AddressOf OnTick
        ticker.Start()
    End Sub

    Private Sub OnTick(sender As Object, e As EventArgs)
        ' สลับค่าเฉพาะเมื่อเขียนสำเร็จ ถ้าล้มเหลวจะลองใหม่รอบหน้า (PLC จะเห็นว่าชีพจรขาดและปิดขาออกเอง)
        If link.TryWriteBit(FinsLink.AreaWorkBit, PlcMap.WorkWord, PlcMap.HeartbeatBit, Not level) Then
            level = Not level
        End If
    End Sub

    Public Sub Dispose() Implements IDisposable.Dispose
        ticker.Stop()
        ticker.Dispose()
    End Sub
End Class
