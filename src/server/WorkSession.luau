-- work session ที่โต๊ะคอม — เวลาจริงไหลจริง, decision event สุ่มระหว่างทำ, focus มีผลต่อคุณภาพ
-- ห้าม trust client เรื่องคุณภาพ/เวลา/focus ใดๆ — คำนวณ/ตรวจระยะห่างฝั่ง server ทั้งหมด
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Remotes = require(ReplicatedStorage.Shared.Remotes)
local PlayerData = require(script.Parent.PlayerData)

local DESK_NAME = "Computer"

local WorkSession = {}
local sessions = {} -- [userId] = sessionState

-- มีหลายสถานีคอม (เล็ก/กลาง/ใหญ่) กระจายอยู่ใน Folder คนละอัน ต้องเช็คทุกอัน ไม่ใช่แค่ตัวแรกที่เจอ
local function isNearDesk(player)
	local character = player.Character
	if not character then
		return false
	end
	local root = character:FindFirstChild("HumanoidRootPart")
	if not root then
		return false
	end
	for _, obj in workspace:GetDescendants() do
		if obj.Name == DESK_NAME and obj:IsA("BasePart") then
			if (root.Position - obj.Position).Magnitude <= Config.WorkSession.MaxDeskDistance then
				return true
			end
		end
	end
	return false
end

local function countUnsoldGames(data)
	local count = 0
	for _, gameEntry in data.games do
		if not gameEntry.sold then
			count += 1
		end
	end
	return count
end

local function findIdea(data, ideaId)
	for index, idea in data.ideas do
		if idea.id == ideaId then
			return idea, index
		end
	end
	return nil
end

local function gearFor(tier)
	return Config.Gear[tier] or Config.Gear[1]
end

local function endSession(player, cancelled)
	local session = sessions[player.UserId]
	if not session then
		return
	end
	sessions[player.UserId] = nil

	Remotes.Get("WorkSessionEnded"):FireClient(player, { cancelled = cancelled })

	local data = PlayerData.Get(player)
	if not data then
		return
	end
	data.focus = session.focus

	if not cancelled then
		local gear = gearFor(data.gearTier)
		local base = session.idea.potential + session.minutes * Config.GameQuality.QualityPerMinute
		local focusMultiplier = 0.5 + 0.5 * (session.focus / Config.Focus.Max)
		local quality = math.clamp((base + session.qualityBonus) * focusMultiplier, 0, gear.QualityCap)
		quality = math.floor(quality + 0.5)

		table.insert(data.games, {
			id = #data.games + 1,
			genre = session.idea.genre,
			quality = quality,
			sold = false,
		})
	else
		-- cancel กลางทาง ไอเดียเสียไป (ตัดสินใจไปแล้วว่าจะทำ ล้มเลิกกลางทางไม่คืนของ)
	end

	PlayerData.Push(player)
end

local function resolveDecision(session, choice)
	session.qualityBonus += choice.QualityDelta
	session.totalSeconds += choice.ExtraSeconds
	session.focus = math.clamp(session.focus + choice.FocusDelta, 0, Config.Focus.Max)
	session.pendingDecision = nil
	session.decisionDeadline = nil
end

local function runSessionLoop(player, session)
	while sessions[player.UserId] == session do
		task.wait(1)

		if not isNearDesk(player) then
			endSession(player, true)
			return
		end

		if session.pendingDecision then
			if os.time() >= session.decisionDeadline then
				local choices = session.pendingDecision.Choices
				resolveDecision(session, choices[#choices]) -- หมดเวลา = เลือกตัวเลือกปลอดภัยสุด (ตัวสุดท้าย)
			else
				continue
			end
		end

		session.elapsed += 1
		session.focus = math.max(0, session.focus - Config.Focus.DrainPerSecondWorking)

		Remotes.Get("WorkProgress"):FireClient(player, {
			elapsed = session.elapsed,
			total = session.totalSeconds,
			focus = session.focus,
		})

		if
			session.decisionsShown < Config.WorkSession.MaxDecisionsPerSession
			and session.elapsed < session.totalSeconds
			and math.random() < Config.WorkSession.DecisionChanceEachTick
		then
			session.decisionsShown += 1
			local eventDef = Config.DecisionEvents[math.random(1, #Config.DecisionEvents)]
			session.pendingDecision = eventDef
			session.decisionDeadline = os.time() + Config.WorkSession.DecisionResponseSeconds

			Remotes.Get("DecisionEvent"):FireClient(player, {
				key = eventDef.Key,
				prompt = eventDef.Prompt,
				choices = eventDef.Choices,
			})
		end

		if session.elapsed >= session.totalSeconds then
			endSession(player, false)
			return
		end
	end
end

function WorkSession.Init()
	Remotes.Get("StartWork").OnServerEvent:Connect(function(player, ideaId, minutes)
		if sessions[player.UserId] then
			return
		end
		if not isNearDesk(player) then
			return
		end

		local data = PlayerData.Get(player)
		if not data then
			return
		end

		local idea, index = findIdea(data, ideaId)
		if not idea then
			return
		end

		if countUnsoldGames(data) >= Config.Storage.MaxUnsoldGames then
			return -- ดิสก์เต็ม ต้องขายก่อนถึงจะเริ่มงานใหม่ได้
		end

		local safeMinutes = math.clamp(
			type(minutes) == "number" and minutes or Config.GameQuality.MinMinutes,
			Config.GameQuality.MinMinutes,
			Config.GameQuality.MaxMinutes
		)
		local gear = gearFor(data.gearTier)
		local totalSeconds = math.max(1, math.floor((safeMinutes * Config.WorkSession.SecondsPerGameMinute) / gear.SpeedMultiplier))

		table.remove(data.ideas, index)
		PlayerData.Push(player)

		local session = {
			idea = idea,
			minutes = safeMinutes,
			totalSeconds = totalSeconds,
			elapsed = 0,
			focus = data.focus,
			qualityBonus = 0,
			decisionsShown = 0,
			pendingDecision = nil,
			decisionDeadline = nil,
		}
		sessions[player.UserId] = session

		Remotes.Get("WorkSessionStarted"):FireClient(player, { totalSeconds = totalSeconds })
		task.spawn(runSessionLoop, player, session)
	end)

	Remotes.Get("CancelWork").OnServerEvent:Connect(function(player)
		endSession(player, true)
	end)

	Remotes.Get("DecisionChoice").OnServerEvent:Connect(function(player, choiceKey)
		local session = sessions[player.UserId]
		if not session or not session.pendingDecision then
			return
		end
		if type(choiceKey) ~= "string" then
			return
		end

		local chosen
		for _, choice in session.pendingDecision.Choices do
			if choice.Key == choiceKey then
				chosen = choice
				break
			end
		end
		if not chosen then
			return
		end

		resolveDecision(session, chosen)
	end)

	Remotes.Get("BuyGear").OnServerEvent:Connect(function(player, tierIndex)
		if type(tierIndex) ~= "number" then
			return
		end
		if sessions[player.UserId] then
			return -- ห้ามซื้อระหว่างทำงาน
		end

		local data = PlayerData.Get(player)
		if not data then
			return
		end

		local tier = Config.Gear[tierIndex]
		if not tier or tierIndex <= data.gearTier then
			return
		end
		if data.cash < tier.Cost then
			return
		end

		data.cash -= tier.Cost
		data.gearTier = tierIndex
		PlayerData.Push(player)
	end)
end

-- focus ฟื้นเมื่อไม่ได้ทำงาน (เดินออกไปพัก)
function WorkSession.StartFocusRegenLoop()
	task.spawn(function()
		while true do
			task.wait(1)
			for _, player in Players:GetPlayers() do
				if not sessions[player.UserId] then
					local data = PlayerData.Get(player)
					if data and data.focus < Config.Focus.Max then
						data.focus = math.min(Config.Focus.Max, data.focus + Config.Focus.RegenPerSecondIdle)
						PlayerData.Push(player)
					end
				end
			end
		end
	end)
end

return WorkSession
