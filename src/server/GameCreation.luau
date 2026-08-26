-- รับ "เจตนา" สร้างเกมจาก client (genre + เวลาที่ทุ่ม) แล้วคำนวณคุณภาพฝั่ง server เท่านั้น
-- ห้าม trust ค่าคุณภาพ/ราคาใดๆ จาก client ตามกฎ CLAUDE.md
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Remotes = require(ReplicatedStorage.Shared.Remotes)
local PlayerData = require(script.Parent.PlayerData)

local GameCreation = {}

local function isValidGenre(genre)
	for _, g in Config.Genres do
		if g == genre then
			return true
		end
	end
	return false
end

local function clampMinutes(minutes)
	if type(minutes) ~= "number" then
		return Config.GameQuality.MinMinutes
	end
	return math.clamp(minutes, Config.GameQuality.MinMinutes, Config.GameQuality.MaxMinutes)
end

local function computeQuality(minutes)
	local raw = minutes * Config.GameQuality.QualityPerMinute
	return math.clamp(raw, 0, 100)
end

function GameCreation.Init()
	local createGameRemote = Remotes.Get("CreateGame")

	createGameRemote.OnServerEvent:Connect(function(player, genre, minutes)
		if not isValidGenre(genre) then
			return
		end

		local data = PlayerData.Get(player)
		if not data then
			return
		end

		local safeMinutes = clampMinutes(minutes)
		local quality = computeQuality(safeMinutes)

		table.insert(data.games, {
			id = #data.games + 1,
			genre = genre,
			quality = quality,
			sold = false,
		})

		PlayerData.Push(player)
		print(string.format("[GameCreation] %s created game #%d (%s, quality %d)", player.Name, #data.games, genre, quality))
	end)
end

return GameCreation
