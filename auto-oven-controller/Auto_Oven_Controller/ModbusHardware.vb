Imports EasyModbus

' Coil addresses ใน Factory I/O (Modbus TCP/IP Server) ตามที่จับคู่ไว้ในฉาก Oven Simulator
Public Module FactoryIoMap
    Public Const ValveCoil As Integer = 0         ' Emitter (Emit)  = วาล์ว
    Public Const BlowerCoil As Integer = 1        ' Pivot Arm Sorter 0 Turn = พัดลม
End Module

' การเชื่อมต่อ Modbus TCP ตัวเดียว ใช้ร่วมกันระหว่าง heater และ fan
Public Class ModbusLink
    Private Const RetrySeconds As Integer = 5

    Private ReadOnly client As ModbusClient
    Private nextRetry As DateTime = DateTime.MinValue

    Public Sub New(host As String, port As Integer)
        client = New ModbusClient(host, port)
        client.ConnectionTimeout = 2000
    End Sub

    Public ReadOnly Property IsConnected As Boolean
        Get
            Return client.Connected
        End Get
    End Property

    Public Property LastError As String

    Public Function TryConnect() As Boolean
        Try
            client.Connect()
            Return True
        Catch ex As Exception
            LastError = ex.Message
            Return False
        End Try
    End Function

    ' ส่งสำเร็จคืน True ถ้าล้มเหลวไม่ throw (กัน Timer เด้ง) แต่เก็บข้อความไว้ใน LastError
    Public Function TryWriteCoil(address As Integer, value As Boolean) As Boolean
        ' หลังล้มเหลว พักก่อนลองใหม่ ไม่งั้นทุก tick จะรอ timeout จนหน้าจอค้าง
        If DateTime.Now < nextRetry Then
            Return False
        End If
        Try
            If Not client.Connected Then
                client.Connect()
            End If
            client.WriteSingleCoil(address, value)
            Return True
        Catch ex As Exception
            LastError = ex.Message
            nextRetry = DateTime.Now.AddSeconds(RetrySeconds)
            Return False
        End Try
    End Function

    Public Sub Disconnect()
        Try
            If client.Connected Then
                client.Disconnect()
            End If
        Catch ex As Exception
            LastError = ex.Message
        End Try
    End Sub
End Class

Public Class ModbusHeater
    Implements IHeater

    Private ReadOnly link As ModbusLink
    Private _isOn As Boolean
    Private writePending As Boolean

    Public Sub New(link As ModbusLink)
        Me.link = link
        _isOn = False
        writePending = True
        Flush()
    End Sub

    Public ReadOnly Property IsOn As Boolean Implements IHeater.IsOn
        Get
            Return _isOn
        End Get
    End Property

    Public Sub TurnOn() Implements IHeater.TurnOn
        SetState(True)
    End Sub

    Public Sub TurnOff() Implements IHeater.TurnOff
        SetState(False)
    End Sub

    ' เขียนเมื่อสถานะเปลี่ยน หรือเมื่อครั้งก่อนเขียนไม่สำเร็จ (ลองใหม่ในการเรียกครั้งถัดไป)
    Private Sub SetState(value As Boolean)
        If value <> _isOn Then
            _isOn = value
            writePending = True
        End If
        If writePending Then
            Flush()
        End If
    End Sub

    Private Sub Flush()
        writePending = Not link.TryWriteCoil(FactoryIoMap.ValveCoil, _isOn)
    End Sub
End Class

Public Class ModbusFan
    Implements IFan

    Private ReadOnly link As ModbusLink
    Private _isOn As Boolean
    Private writePending As Boolean

    Public Sub New(link As ModbusLink)
        Me.link = link
        _isOn = False
        writePending = True
        Flush()
    End Sub

    Public ReadOnly Property IsOn As Boolean Implements IFan.IsOn
        Get
            Return _isOn
        End Get
    End Property

    Public Sub TurnOn() Implements IFan.TurnOn
        SetState(True)
    End Sub

    Public Sub TurnOff() Implements IFan.TurnOff
        SetState(False)
    End Sub

    Private Sub SetState(value As Boolean)
        If value <> _isOn Then
            _isOn = value
            writePending = True
        End If
        If writePending Then
            Flush()
        End If
    End Sub

    ' พัดลมเปิด = สั่งให้แขน Pivot Arm Sorter หมุนออกเพื่อเบี่ยงกล่อง
    Private Sub Flush()
        writePending = Not link.TryWriteCoil(FactoryIoMap.BlowerCoil, _isOn)
    End Sub
End Class
