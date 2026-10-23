Public Class SimulatedTemperatureSensor
    Implements ITemperatureSensor

    Private Const RoomTemp As Double = 30
    Private Const HeatRate As Double = 0.4
    Private Const CoolRate As Double = 0.03
    ' ตกจากเป้าได้กี่องศา ก่อนเปิดวาล์วอุ่นกลับ
    Public Const DropBand As Double = 5

    Private ReadOnly heater As IHeater
    Private temp As Double

    Public Sub New(heater As IHeater)
        Me.heater = heater
        temp = RoomTemp
    End Sub

    Public ReadOnly Property CurrentTemp As Double Implements ITemperatureSensor.CurrentTemp
        Get
            Return temp
        End Get
    End Property

    Private Const SnapThreshold As Double = 0.1

    Public Sub Tick(targetTemp As Double) Implements ITemperatureSensor.Tick
        If heater.IsOn Then
            If targetTemp - temp <= DropBand Then
                ' ช่วงอุ่นกลับหลังตกลงมา เพิ่มทีละ 1 จนถึงเป้า
                temp = Math.Min(targetTemp, temp + 1)
            Else
                temp = temp + (targetTemp - temp) * HeatRate
                If Math.Abs(targetTemp - temp) < SnapThreshold Then
                    temp = targetTemp
                End If
            End If
        ElseIf temp > targetTemp Then
            temp = Math.Max(targetTemp, temp + (RoomTemp - temp) * CoolRate)
        ElseIf temp > targetTemp - DropBand Then
            ' ถึงเป้าแล้ววาล์วดับ อุณหภูมิตกลงทีละ 1 ไม่เกิน DropBand องศา
            temp = Math.Max(targetTemp - DropBand, temp - 1)
        End If
    End Sub
End Class
