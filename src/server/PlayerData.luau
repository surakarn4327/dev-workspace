-- เก็บ/โหลดข้อมูลผู้เล่น (เงิน, เกมที่สร้างแล้ว) ผ่าน DataStore
-- ทุกเรียก DataStore ต้อง pcall+retry ตามกฎ CLAUDE.md เพราะ DataStore ล้มเหลวเป็นระยะได้
local DataStoreService = game:GetService("DataStoreService")

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Remotes = require(ReplicatedStorage.Shared.Remotes)

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
		ideas = {}, -- { {id, genre, theme, twist, potential} }
		nextIdeaId = 1,
		aiLevel = 1,
		aiQueriesUsed = 0,
		aiQueryResetAt = os.time() + Config.AI.QueryResetSeconds,
		subscriptionActive = false,
		subscriptionNextChargeAt = nil,
		gearTier = 1,
		focus = Config.Focus.Max,
	}
end

-- เติม field ที่ขาด (เซฟเก่าจากก่อนเพิ่มระบบ AI/gear/focus) กัน nil error
local function withDefaults(data)
	local defaults = defaultData()
	for key, value in defaults do
		if data[key] == nil then
			data[key] = value
		end
	end
	return data
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

	local data = withDefaults((ok and result) or defaultData())
	cache[player.UserId] = data
	PlayerData.Push(player)
	return data
end

function PlayerData.Get(player)
	return cache[player.UserId]
end

-- ส่ง state ปัจจุบัน (เงิน, เกม) ไปให้ client render UI — เรียกทุกครั้งที่ data เปลี่ยน
function PlayerData.Push(player)
	local data = cache[player.UserId]
	if not data then
		return
	end

	local queryLimit = Config.AI.FreeQueriesPerCycle + (data.subscriptionActive and Config.AI.SubscriptionQueryBonus or 0)

	local unsoldCount = 0
	for _, gameEntry in data.games do
		if not gameEntry.sold then
			unsoldCount += 1
		end
	end

	Remotes.Get("PlayerDataUpdated"):FireClient(player, {
		cash = data.cash,
		games = data.games,
		unsoldGames = unsoldCount,
		maxUnsoldGames = Config.Storage.MaxUnsoldGames,
		ideas = data.ideas,
		aiLevel = data.aiLevel,
		aiQueriesLeft = math.max(0, queryLimit - data.aiQueriesUsed),
		subscriptionActive = data.subscriptionActive,
		gearTier = data.gearTier,
		focus = data.focus,
	})
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

-- client ยิงขอ state เองตอน start กัน race condition (server push เร็วกว่า client ต่อ listener ทัน)
function PlayerData.InitRequestHandler()
	Remotes.Get("RequestState").OnServerEvent:Connect(function(player)
		for _ = 1, 20 do
			if cache[player.UserId] then
				PlayerData.Push(player)
				return
			end
			task.wait(0.25)
		end
	end)
end

return PlayerData
