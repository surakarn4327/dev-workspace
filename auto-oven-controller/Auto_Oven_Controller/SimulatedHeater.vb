Public Class SimulatedHeater
    Implements IHeater

    Public Property IsOn As Boolean Implements IHeater.IsOn

    Public Sub TurnOn() Implements IHeater.TurnOn
        IsOn = True
    End Sub

    Public Sub TurnOff() Implements IHeater.TurnOff
        IsOn = False
    End Sub
End Class
