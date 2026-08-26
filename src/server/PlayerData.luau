-- เก็บ/โหลดข้อมูลผู้เล่น (เงิน, เกมที่สร้างแล้ว) ผ่าน DataStore
-- ทุกเรียก DataStore ต้อง pcall+retry ตามกฎ CLAUDE.md เพราะ DataStore ล้มเหลวเป็นระยะได้
local DataStoreService = game:GetService("DataStoreService")

local Config = require(game:GetService("ReplicatedStorage").Shared.Config)

-- place ที่ไม่เคย publish ขึ้น Roblox เรียก GetDataStore ไม่ได้เลย (ไม่ใช่แค่ GetAsync/SetAsync)
-- guard ไว้เพื่อให้ทดสอบใน Studio ได้โดยไม่ต้อง publish จริง (fallback เป็นไม่เซฟถาวร)
local getStoreOk, playerStore = pcall(function()
	return DataStoreService:GetDataStore("PlayerData_v1")
end)
if not getStoreOk then
	warn("PlayerData: DataStore ใช้ไม่ได้ (place ยังไม่ publish?) จะไม่มีการเซฟถาวร")
	playerStore = nil
end

local RETRY_COUNT = 3
local RETRY_WAIT_SECONDS = 2

local PlayerData = {}
local cache = {} -- [userId] = data table, อยู่ในหน่วยความจำระหว่าง session

local function attempt(fn)
	for i = 1, RETRY_COUNT do
		local ok, result = pcall(fn)
		if ok then
			return true, result
		end
		if i < RETRY_COUNT then
			task.wait(RETRY_WAIT_SECONDS)
		end
	end
	return false, nil
end

local function defaultData()
	return {
		cash = Config.StartingCash,
		games = {}, -- { {id, genre, quality, sold} }
	}
end

function PlayerData.Load(player)
	if not playerStore then
		local data = defaultData()
		cache[player.UserId] = data
		return data
	end

	local key = "Player_" .. player.UserId
	local ok, result = attempt(function()
		return playerStore:GetAsync(key)
	end)

	local data = (ok and result) or defaultData()
	cache[player.UserId] = data
	return data
end

function PlayerData.Get(player)
	return cache[player.UserId]
end

function PlayerData.Save(player)
	local data = cache[player.UserId]
	if not data or not playerStore then
		return false
	end

	local key = "Player_" .. player.UserId
	local ok = attempt(function()
		playerStore:SetAsync(key, data)
	end)
	return ok
end

function PlayerData.Release(player)
	PlayerData.Save(player)
	cache[player.UserId] = nil
end

return PlayerData
