-- entry point ฝั่ง server — เงิน/การขาย/จ้างพนักงานทั้งหมดต้อง authoritative ที่นี่
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Remotes = require(ReplicatedStorage.Shared.Remotes)
local PlayerData = require(script.PlayerData)
local GameSelling = require(script.GameSelling)
local AITerminal = require(script.AITerminal)
local WorkSession = require(script.WorkSession)
local WorldObjects = require(script.WorldObjects)

Remotes.Init()
WorldObjects.Init()
PlayerData.InitRequestHandler()
GameSelling.Init()
AITerminal.Init()
WorkSession.Init()
AITerminal.StartBillingLoop()
WorkSession.StartFocusRegenLoop()

Players.PlayerAdded:Connect(function(player)
	PlayerData.Load(player)
end)

Players.PlayerRemoving:Connect(function(player)
	PlayerData.Release(player)
end)

game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		PlayerData.Save(player)
	end
end)

print("game-dev-simulator: server started")
