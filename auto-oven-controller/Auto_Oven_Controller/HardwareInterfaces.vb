Public Interface IHeater
    ReadOnly Property IsOn As Boolean
    Sub TurnOn()
    Sub TurnOff()
End Interface

Public Interface IFan
    ReadOnly Property IsOn As Boolean
    Sub TurnOn()
    Sub TurnOff()
End Interface

Public Interface ITemperatureSensor
    ReadOnly Property CurrentTemp As Double
    Sub Tick(targetTemp As Double)
End Interface
