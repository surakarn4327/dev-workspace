-- "AI" ปลอม — random idea pool ในเกม ไม่ยิง request ไปหา LLM จริง (ห้ามผูก API ภายนอกตามกฎ workspace)
-- ห้าม trust client เรื่อง limit/cash ใดๆ — เช็ค/หัก/สุ่มฝั่ง server ทั้งหมด
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Remotes = require(ReplicatedStorage.Shared.Remotes)
local IdeaPool = require(ReplicatedStorage.Shared.IdeaPool)
local PlayerData = require(script.Parent.PlayerData)

local COMPUTER_NAME = "Computer"

local AITerminal = {}

-- มีหลายสถานีคอม (เล็ก/กลาง/ใหญ่) กระจายอยู่ใน Folder คนละอัน ต้องเช็คทุกอัน ไม่ใช่แค่ตัวแรกที่เจอ
local function isNearTerminal(player)
	local character = player.Character
	if not character then
		return false
	end
	local root = character:FindFirstChild("HumanoidRootPart")
	if not root then
		return false
	end
	for _, obj in workspace:GetDescendants() do
		if obj.Name == COMPUTER_NAME and obj:IsA("BasePart") then
			if (root.Position - obj.Position).Magnitude <= Config.WorkSession.MaxDeskDistance then
				return true
			end
		end
	end
	return false
end

local function resetQueriesIfNeeded(data)
	if os.time() >= data.aiQueryResetAt then
		data.aiQueriesUsed = 0
		data.aiQueryResetAt = os.time() + Config.AI.QueryResetSeconds
	end
end

local function queryLimit(data)
	local bonus = data.subscriptionActive and Config.AI.SubscriptionQueryBonus or 0
	return Config.AI.FreeQueriesPerCycle + bonus
end

function AITerminal.Init()
	Remotes.Get("RequestIdea").OnServerEvent:Connect(function(player)
		local data = PlayerData.Get(player)
		if not data or not isNearTerminal(player) then
			return
		end

		resetQueriesIfNeeded(data)
		if data.aiQueriesUsed >= queryLimit(data) then
			return
		end
		if #data.ideas >= Config.AI.MaxIdeaInventory then
			return
		end

		data.aiQueriesUsed += 1
		local idea = IdeaPool.Roll(data.aiLevel, Config.Genres)
		idea.id = data.nextIdeaId
		data.nextIdeaId += 1
		table.insert(data.ideas, idea)

		PlayerData.Push(player)
	end)

	Remotes.Get("SubscribeAI").OnServerEvent:Connect(function(player)
		local data = PlayerData.Get(player)
		if not data or not isNearTerminal(player) then
			return
		end
		if data.subscriptionActive or data.aiLevel >= Config.AI.MaxLevel then
			return
		end
		if data.cash < Config.AI.SubscriptionCostPerCycle then
			return
		end

		data.cash -= Config.AI.SubscriptionCostPerCycle
		data.subscriptionActive = true
		data.aiLevel += 1
		data.subscriptionNextChargeAt = os.time() + Config.AI.SubscriptionCycleSeconds

		PlayerData.Push(player)
	end)
end

-- เก็บค่า subscribe รายรอบ ยกเลิกอัตโนมัติถ้าเงินไม่พอ
function AITerminal.StartBillingLoop()
	task.spawn(function()
		while true do
			task.wait(5)
			for _, player in Players:GetPlayers() do
				local data = PlayerData.Get(player)
				if data and data.subscriptionActive and data.subscriptionNextChargeAt and os.time() >= data.subscriptionNextChargeAt then
					if data.cash >= Config.AI.SubscriptionCostPerCycle then
						data.cash -= Config.AI.SubscriptionCostPerCycle
						data.subscriptionNextChargeAt = os.time() + Config.AI.SubscriptionCycleSeconds
					else
						data.subscriptionActive = false
					end
					PlayerData.Push(player)
				end
			end
		end
	end)
end

return AITerminal
