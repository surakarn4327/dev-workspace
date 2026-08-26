-- รับ "เจตนา" ขายเกมจาก client (แค่ gameId) แล้วคำนวณราคาฝั่ง server เท่านั้น
-- ห้าม trust ราคา/คุณภาพใดๆ จาก client ตามกฎ CLAUDE.md
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Remotes = require(ReplicatedStorage.Shared.Remotes)
local PlayerData = require(script.Parent.PlayerData)

local GameSelling = {}

local function findGame(data, gameId)
	for _, gameEntry in data.games do
		if gameEntry.id == gameId then
			return gameEntry
		end
	end
	return nil
end

local function computePrice(quality)
	return quality * Config.GameQuality.BasePricePerQuality
end

function GameSelling.Init()
	local sellGameRemote = Remotes.Get("SellGame")

	sellGameRemote.OnServerEvent:Connect(function(player, gameId)
		if type(gameId) ~= "number" then
			return
		end

		local data = PlayerData.Get(player)
		if not data then
			return
		end

		local gameEntry = findGame(data, gameId)
		if not gameEntry or gameEntry.sold then
			return
		end

		gameEntry.sold = true
		local price = computePrice(gameEntry.quality)
		data.cash += price

		PlayerData.Push(player)
		print(string.format("[GameSelling] %s sold game #%d for %d cash (total cash: %d)", player.Name, gameEntry.id, price, data.cash))
	end)
end

return GameSelling
