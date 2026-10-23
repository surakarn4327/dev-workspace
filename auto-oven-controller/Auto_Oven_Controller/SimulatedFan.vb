Public Class SimulatedFan
    Implements IFan

    Public Property IsOn As Boolean Implements IFan.IsOn

    Public Sub TurnOn() Implements IFan.TurnOn
        IsOn = True
    End Sub

    Public Sub TurnOff() Implements IFan.TurnOff
        IsOn = False
    End Sub
End Class
