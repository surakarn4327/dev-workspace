Imports System.Configuration

Public Module OvenSettings

    ' ชื่อตู้ที่เครื่องนี้คุม (จาก App.config)
    Public ReadOnly Property OvenName As String
        Get
            Return ReadSetting("OvenName")
        End Get
    End Property

    ' Address ของตู้ที่เครื่องนี้คุม (จาก App.config)
    Public ReadOnly Property OvenAddress As Integer
        Get
            Dim text As String = ReadSetting("OvenAddress")
            Dim address As Integer
            If Not Integer.TryParse(text, address) Then
                Throw New ConfigurationErrorsException("OvenAddress ใน App.config ต้องเป็นตัวเลข แต่พบ: '" & text & "'")
            End If
            Return address
        End Get
    End Property

    ' เปิดใช้การสั่ง Factory I/O ผ่าน Modbus TCP (ถ้าไม่ตั้งค่า = ใช้ตัวจำลองในโปรแกรม)
    Public ReadOnly Property UseModbus As Boolean
        Get
            Dim value As Boolean
            Boolean.TryParse(ConfigurationManager.AppSettings("UseModbus"), value)
            Return value
        End Get
    End Property

    Public ReadOnly Property ModbusHost As String
        Get
            Return ReadSetting("ModbusHost")
        End Get
    End Property

    Public ReadOnly Property ModbusPort As Integer
        Get
            Dim text As String = ConfigurationManager.AppSettings("ModbusPort")
            Dim port As Integer
            If Integer.TryParse(text, port) Then
                Return port
            End If
            Return 502
        End Get
    End Property

    ' เปิดใช้การสั่ง PLC Omron จริงผ่าน FINS/UDP (ถ้าเปิดไว้ จะถูกใช้ก่อน Modbus และตัวจำลอง)
    Public ReadOnly Property UseFins As Boolean
        Get
            Dim value As Boolean
            Boolean.TryParse(ConfigurationManager.AppSettings("UseFins"), value)
            Return value
        End Get
    End Property

    Public ReadOnly Property FinsHost As String
        Get
            Return ReadSetting("FinsHost")
        End Get
    End Property

    Public ReadOnly Property FinsPort As Integer
        Get
            Return ReadIntSetting("FinsPort", 9600)
        End Get
    End Property

    ' node ของ PLC ใน FINS (บอร์ด CIF41 ใช้เลขท้ายของ IP เป็น node)
    Public ReadOnly Property FinsPlcNode As Integer
        Get
            Return ReadIntSetting("FinsPlcNode", 1)
        End Get
    End Property

    ' node ของคอมเครื่องนี้ (เลขท้ายของ IP คอม)
    Public ReadOnly Property FinsPcNode As Integer
        Get
            Return ReadIntSetting("FinsPcNode", 10)
        End Get
    End Property

    Private Function ReadIntSetting(key As String, defaultValue As Integer) As Integer
        Dim text As String = ConfigurationManager.AppSettings(key)
        If String.IsNullOrWhiteSpace(text) Then
            Return defaultValue
        End If
        Dim number As Integer
        If Not Integer.TryParse(text, number) OrElse number < 0 OrElse number > 65535 Then
            Throw New ConfigurationErrorsException(key & " ใน App.config ต้องเป็นตัวเลข 0-65535 แต่พบ: '" & text & "'")
        End If
        Return number
    End Function

    Private Function ReadSetting(key As String) As String
        Dim value As String = ConfigurationManager.AppSettings(key)
        If String.IsNullOrWhiteSpace(value) Then
            Throw New ConfigurationErrorsException("ไม่พบค่า '" & key & "' ใน App.config")
        End If
        Return value
    End Function

End Module