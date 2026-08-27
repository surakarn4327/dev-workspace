-- entry point ฝั่ง client — UI/input เท่านั้น ห้ามคำนวณเงิน/คุณภาพ/เวลาเอง
-- ทุกค่าที่เห็นมาจาก server ผ่าน remote เท่านั้น (PlayerDataUpdated, WorkProgress, DecisionEvent, ...)
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage.Shared.Config)
local Remotes = require(ReplicatedStorage.Shared.Remotes)

local Theme = {
	PanelBackground = Color3.fromRGB(24, 26, 30),
	PanelAccent = Color3.fromRGB(70, 90, 120),
	Accent = Color3.fromRGB(70, 160, 220),
	AccentDark = Color3.fromRGB(45, 130, 190),
	Positive = Color3.fromRGB(60, 170, 100),
	Warning = Color3.fromRGB(210, 160, 50),
	Danger = Color3.fromRGB(190, 70, 70),
	RowBackground = Color3.fromRGB(38, 40, 46),
	Text = Color3.fromRGB(235, 235, 240),
	TextDim = Color3.fromRGB(170, 175, 185),
}

local sellGameRemote = Remotes.Get("SellGame")
local playerDataUpdated = Remotes.Get("PlayerDataUpdated")
local requestStateRemote = Remotes.Get("RequestState")
local requestIdeaRemote = Remotes.Get("RequestIdea")
local subscribeAIRemote = Remotes.Get("SubscribeAI")
local startWorkRemote = Remotes.Get("StartWork")
local cancelWorkRemote = Remotes.Get("CancelWork")
local decisionChoiceRemote = Remotes.Get("DecisionChoice")
local buyGearRemote = Remotes.Get("BuyGear")
local workSessionStarted = Remotes.Get("WorkSessionStarted")
local workProgressRemote = Remotes.Get("WorkProgress")
local decisionEventRemote = Remotes.Get("DecisionEvent")
local workSessionEnded = Remotes.Get("WorkSessionEnded")

local player = Players.LocalPlayer
local latestState = {
	cash = 0,
	games = {},
	ideas = {},
	aiLevel = 1,
	aiQueriesLeft = 0,
	subscriptionActive = false,
	gearTier = 1,
	focus = Config.Focus.Max,
	unsoldGames = 0,
	maxUnsoldGames = Config.Storage.MaxUnsoldGames,
}
local selectedIdeaId = nil
local selectedMinutes = Config.GameQuality.MinMinutes

-- ===== helpers =====
local function addCorner(instance, radius)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius or 8)
	corner.Parent = instance
	return corner
end

local function addStroke(instance, color, thickness)
	local stroke = Instance.new("UIStroke")
	stroke.Color = color or Theme.PanelAccent
	stroke.Thickness = thickness or 1
	stroke.Transparency = 0.4
	stroke.Parent = instance
	return stroke
end

local function makeFrame(props)
	local frame = Instance.new("Frame")
	frame.BorderSizePixel = 0
	for key, value in props do
		frame[key] = value
	end
	addCorner(frame, 8)
	return frame
end

local function makeLabel(props)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.TextColor3 = Theme.Text
	label.Font = Enum.Font.Gotham
	label.TextSize = 14
	label.TextXAlignment = Enum.TextXAlignment.Left
	for key, value in props do
		label[key] = value
	end
	return label
end

local function makeButton(props)
	local button = Instance.new("TextButton")
	button.BorderSizePixel = 0
	button.BackgroundColor3 = Color3.fromRGB(60, 64, 72)
	button.TextColor3 = Theme.Text
	button.Font = Enum.Font.GothamBold
	button.TextSize = 14
	button.AutoButtonColor = false
	for key, value in props do
		button[key] = value
	end
	addCorner(button, 6)

	local baseColor = button.BackgroundColor3
	local hoverColor = Color3.new(
		math.min(1, baseColor.R * 1.25 + 0.05),
		math.min(1, baseColor.G * 1.25 + 0.05),
		math.min(1, baseColor.B * 1.25 + 0.05)
	)
	button.MouseEnter:Connect(function()
		TweenService:Create(button, TweenInfo.new(0.12), { BackgroundColor3 = hoverColor }):Play()
	end)
	button.MouseLeave:Connect(function()
		TweenService:Create(button, TweenInfo.new(0.12), { BackgroundColor3 = baseColor }):Play()
	end)

	return button
end

-- เปิด/ปิด panel แบบนุ่มๆ แทนสลับ .Visible ตรงๆ
local function setPanelVisible(panel, visible)
	if visible then
		local targetSize = panel:GetAttribute("TargetSize")
		if not targetSize then
			targetSize = panel.Size
			panel:SetAttribute("TargetSize", targetSize)
		end
		panel.Size = UDim2.new(targetSize.X.Scale, targetSize.X.Offset, 0, 0)
		panel.Visible = true
		TweenService:Create(panel, TweenInfo.new(0.18, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Size = targetSize }):Play()
	else
		panel.Visible = false
	end
end

-- ===== root UI =====
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "GameDevSimulatorUI"
screenGui.ResetOnSpawn = false
screenGui.Parent = player:WaitForChild("PlayerGui")

local cashLabel = makeLabel({
	Name = "CashLabel",
	Size = UDim2.new(0, 220, 0, 44),
	Position = UDim2.new(0, 20, 0, 20),
	BackgroundTransparency = 0,
	BackgroundColor3 = Theme.PanelBackground,
	TextColor3 = Color3.fromRGB(255, 215, 0),
	Font = Enum.Font.GothamBold,
	TextSize = 22,
	TextXAlignment = Enum.TextXAlignment.Center,
	Text = "Cash: 0",
	Parent = screenGui,
})
addCorner(cashLabel, 10)
addStroke(cashLabel)

-- ===== computer panel เต็มจอ (ซ่อนไว้ก่อน เปิดตอนนั่งเก้าอี้) =====
-- เต็มจอทั้งหมด เพื่อให้รู้สึกเหมือนกำลังจ้องหน้าจอมอนิเตอร์จริงๆ ไม่เห็นโลก 3D รอบๆ ระหว่างใช้คอม
local computerPanel = Instance.new("Frame")
computerPanel.Name = "ComputerPanel"
computerPanel.Size = UDim2.new(1, 0, 1, 0)
computerPanel.Position = UDim2.new(0, 0, 0, 0)
computerPanel.BackgroundColor3 = Color3.fromRGB(30, 80, 140) -- สีพื้นหลัง desktop แบบ Windows
computerPanel.BorderSizePixel = 0
computerPanel.Visible = false
computerPanel.Parent = screenGui

local screenArea = computerPanel

-- ไอคอนบน desktop
local desktopIcons = makeFrame({
	Size = UDim2.new(1, 0, 1, 0),
	BackgroundTransparency = 1,
	Parent = screenArea,
})

local function makeDesktopIcon(position, label, iconBuilder)
	local iconButton = makeButton({
		Size = UDim2.new(0, 74, 0, 74),
		Position = position,
		BackgroundTransparency = 1,
		AutoButtonColor = false,
		Text = "",
		Parent = desktopIcons,
	})

	local iconArt = makeFrame({
		Size = UDim2.new(0, 48, 0, 48),
		Position = UDim2.new(0.5, -24, 0, 2),
		Parent = iconButton,
	})
	iconBuilder(iconArt)

	makeLabel({
		Size = UDim2.new(1, 0, 0, 18),
		Position = UDim2.new(0, 0, 0, 54),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 12,
		TextColor3 = Color3.new(1, 1, 1),
		Text = label,
		Parent = iconButton,
	})

	return iconButton
end

local aiIconButton = makeDesktopIcon(UDim2.new(0, 14, 0, 10), "AI Chat", function(art)
	art.BackgroundColor3 = Theme.Accent
	makeLabel({
		Size = UDim2.new(1, 0, 1, 0),
		TextXAlignment = Enum.TextXAlignment.Center,
		Font = Enum.Font.GothamBold,
		TextSize = 20,
		TextColor3 = Color3.new(1, 1, 1),
		Text = "AI",
		Parent = art,
	})
end)

local filesIconButton = makeDesktopIcon(UDim2.new(0, 14, 0, 96), "My Files", function(art)
	art.BackgroundColor3 = Color3.fromRGB(230, 190, 60) -- โฟลเดอร์เหลือง
	local tab = Instance.new("Frame")
	tab.Size = UDim2.new(0.5, 0, 0.28, 0)
	tab.Position = UDim2.new(0, 4, 0, -6)
	tab.BackgroundColor3 = art.BackgroundColor3
	tab.BorderSizePixel = 0
	tab.Parent = art
	addCorner(tab, 4)
end)

-- ===== AI chat window (ปิดไว้ก่อน, เปิดเมื่อกดไอคอน) =====
local aiWindow = makeFrame({
	Size = UDim2.new(1, -120, 1, -126),
	Position = UDim2.new(0, 60, 0, 30),
	BackgroundColor3 = Theme.PanelBackground,
	Visible = false,
	Parent = screenArea,
})

local aiTitleBar = makeFrame({ Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = Theme.AccentDark, Parent = aiWindow })
makeLabel({
	Size = UDim2.new(1, -40, 1, 0),
	Position = UDim2.new(0, 10, 0, 0),
	Font = Enum.Font.GothamBold,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "AI Chat",
	Parent = aiTitleBar,
})
local aiWindowCloseButton = makeButton({
	Size = UDim2.new(0, 26, 0, 22),
	Position = UDim2.new(1, -32, 0, 4),
	BackgroundColor3 = Theme.Danger,
	TextSize = 14,
	Text = "X",
	Parent = aiTitleBar,
})

local aiContent = makeFrame({
	Size = UDim2.new(1, -20, 1, -42),
	Position = UDim2.new(0, 10, 0, 36),
	BackgroundTransparency = 1,
	Parent = aiWindow,
})

local aiStatusLabel = makeLabel({
	Size = UDim2.new(1, 0, 0, 40),
	TextColor3 = Theme.TextDim,
	TextWrapped = true,
	Text = "Queries left: 0\nAI level: 1",
	Parent = aiContent,
})

local requestIdeaButton = makeButton({
	Size = UDim2.new(1, 0, 0, 36),
	Position = UDim2.new(0, 0, 0, 44),
	BackgroundColor3 = Theme.AccentDark,
	Text = "Ask AI for an idea",
	Parent = aiContent,
})
requestIdeaButton.MouseButton1Click:Connect(function()
	requestIdeaRemote:FireServer()
end)

local subscribeButton = makeButton({
	Size = UDim2.new(1, 0, 0, 36),
	Position = UDim2.new(0, 0, 0, 86),
	BackgroundColor3 = Color3.fromRGB(140, 90, 190),
	Text = string.format("Subscribe ($%d/cycle)", Config.AI.SubscriptionCostPerCycle),
	Parent = aiContent,
})
subscribeButton.MouseButton1Click:Connect(function()
	subscribeAIRemote:FireServer()
end)

makeLabel({ Size = UDim2.new(1, 0, 0, 20), Position = UDim2.new(0, 0, 0, 130), Font = Enum.Font.GothamBold, TextColor3 = Theme.TextDim, Text = "Ideas:", Parent = aiContent })

local aiIdeaScroll = Instance.new("ScrollingFrame")
aiIdeaScroll.Size = UDim2.new(1, 0, 1, -156)
aiIdeaScroll.Position = UDim2.new(0, 0, 0, 152)
aiIdeaScroll.BackgroundTransparency = 1
aiIdeaScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
aiIdeaScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
aiIdeaScroll.ScrollBarThickness = 6
aiIdeaScroll.Parent = aiContent

local function renderIdeaSummaries(ideas)
	aiIdeaScroll:ClearAllChildren()
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 4)
	layout.Parent = aiIdeaScroll

	for _, idea in ideas do
		local row = makeFrame({ Size = UDim2.new(1, 0, 0, 36), BackgroundColor3 = Theme.RowBackground, Parent = aiIdeaScroll })
		makeLabel({
			Size = UDim2.new(1, -12, 1, 0),
			Position = UDim2.new(0, 6, 0, 0),
			TextWrapped = true,
			TextSize = 13,
			Text = string.format("%s — %s %s (pot. %d)", idea.genre, idea.theme, idea.twist, idea.potential),
			Parent = row,
		})
	end
end

-- ===== My Files window (ปิดไว้ก่อน, เปิดเมื่อกดไอคอน) =====
local filesWindow = makeFrame({
	Size = UDim2.new(1, -120, 1, -126),
	Position = UDim2.new(0, 60, 0, 30),
	BackgroundColor3 = Theme.PanelBackground,
	Visible = false,
	Parent = screenArea,
})

local filesTitleBar = makeFrame({ Size = UDim2.new(1, 0, 0, 30), BackgroundColor3 = Color3.fromRGB(180, 140, 40), Parent = filesWindow })
makeLabel({
	Size = UDim2.new(1, -40, 1, 0),
	Position = UDim2.new(0, 10, 0, 0),
	Font = Enum.Font.GothamBold,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "My Files",
	Parent = filesTitleBar,
})
local filesWindowCloseButton = makeButton({
	Size = UDim2.new(0, 26, 0, 22),
	Position = UDim2.new(1, -32, 0, 4),
	BackgroundColor3 = Theme.Danger,
	TextSize = 14,
	Text = "X",
	Parent = filesTitleBar,
})

local filesContent = makeFrame({
	Size = UDim2.new(1, -20, 1, -42),
	Position = UDim2.new(0, 10, 0, 36),
	BackgroundTransparency = 1,
	Parent = filesWindow,
})

local storageLabel = makeLabel({
	Size = UDim2.new(1, 0, 0, 20),
	TextColor3 = Theme.TextDim,
	Text = "Storage: 0 / 5",
	Parent = filesContent,
})

local gamesScroll = Instance.new("ScrollingFrame")
gamesScroll.Size = UDim2.new(1, 0, 0, 130)
gamesScroll.Position = UDim2.new(0, 0, 0, 24)
gamesScroll.BackgroundTransparency = 1
gamesScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
gamesScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
gamesScroll.ScrollBarThickness = 6
gamesScroll.Parent = filesContent

local function renderGames(games)
	gamesScroll:ClearAllChildren()
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 6)
	layout.Parent = gamesScroll

	for _, gameEntry in games do
		local row = makeFrame({
			Size = UDim2.new(1, 0, 0, 50),
			BackgroundColor3 = Theme.RowBackground,
			Parent = gamesScroll,
		})

		local status = gameEntry.sold and "Sold" or "Not sold"
		makeLabel({
			Size = UDim2.new(1, -90, 1, 0),
			Position = UDim2.new(0, 8, 0, 0),
			TextWrapped = true,
			Text = string.format("#%d %s.game\nQuality %d — %s", gameEntry.id, gameEntry.genre, gameEntry.quality, status),
			Parent = row,
		})

		local sellButton = makeButton({
			Size = UDim2.new(0, 70, 0, 34),
			Position = UDim2.new(1, -78, 0.5, -17),
			BackgroundColor3 = gameEntry.sold and Color3.fromRGB(70, 70, 70) or Theme.Warning,
			Text = gameEntry.sold and "Sold" or "Sell",
			AutoButtonColor = not gameEntry.sold,
			Parent = row,
		})

		if not gameEntry.sold then
			sellButton.MouseButton1Click:Connect(function()
				sellGameRemote:FireServer(gameEntry.id)
			end)
		end
	end
end

makeLabel({
	Size = UDim2.new(1, 0, 0, 20),
	Position = UDim2.new(0, 0, 0, 162),
	Font = Enum.Font.GothamBold,
	TextColor3 = Theme.TextDim,
	Text = "New project",
	Parent = filesContent,
})

local gearLabel = makeLabel({
	Size = UDim2.new(1, 0, 0, 20),
	Position = UDim2.new(0, 0, 0, 186),
	TextColor3 = Theme.TextDim,
	Text = "Gear: Old Laptop (cap 60)",
	Parent = filesContent,
})

local buyGearButton = makeButton({
	Size = UDim2.new(1, 0, 0, 28),
	Position = UDim2.new(0, 0, 0, 208),
	BackgroundColor3 = Theme.Positive,
	TextSize = 13,
	Text = "Upgrade gear",
	Parent = filesContent,
})
buyGearButton.MouseButton1Click:Connect(function()
	local nextTier = latestState.gearTier + 1
	if Config.Gear[nextTier] then
		buyGearRemote:FireServer(nextTier)
	end
end)

local ideaPickerScroll = Instance.new("ScrollingFrame")
ideaPickerScroll.Size = UDim2.new(1, 0, 0, 90)
ideaPickerScroll.Position = UDim2.new(0, 0, 0, 240)
ideaPickerScroll.BackgroundTransparency = 1
ideaPickerScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
ideaPickerScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
ideaPickerScroll.ScrollBarThickness = 6
ideaPickerScroll.Parent = filesContent

local minutesLabel = makeLabel({
	Size = UDim2.new(1, 0, 0, 22),
	Position = UDim2.new(0, 0, 1, -66),
	TextColor3 = Theme.TextDim,
	Text = "Time to spend: " .. selectedMinutes .. " min",
	Parent = filesContent,
})

local function updateMinutes(delta)
	selectedMinutes = math.clamp(selectedMinutes + delta, Config.GameQuality.MinMinutes, Config.GameQuality.MaxMinutes)
	minutesLabel.Text = "Time to spend: " .. selectedMinutes .. " min"
end

local minutesButtonRow = makeFrame({
	Size = UDim2.new(0, 90, 0, 26),
	Position = UDim2.new(1, -90, 1, -66),
	BackgroundTransparency = 1,
	Parent = filesContent,
})
local minutesLayout = Instance.new("UIListLayout")
minutesLayout.FillDirection = Enum.FillDirection.Horizontal
minutesLayout.Padding = UDim.new(0, 4)
minutesLayout.Parent = minutesButtonRow

makeButton({ Size = UDim2.new(0, 40, 0, 26), Text = "-1", Parent = minutesButtonRow }).MouseButton1Click:Connect(function()
	updateMinutes(-1)
end)
makeButton({ Size = UDim2.new(0, 40, 0, 26), Text = "+1", Parent = minutesButtonRow }).MouseButton1Click:Connect(function()
	updateMinutes(1)
end)

local startWorkButton = makeButton({
	Size = UDim2.new(1, 0, 0, 34),
	Position = UDim2.new(0, 0, 1, -30),
	BackgroundColor3 = Theme.Positive,
	Text = "Start Working",
	Parent = filesContent,
})
startWorkButton.MouseButton1Click:Connect(function()
	if selectedIdeaId then
		startWorkRemote:FireServer(selectedIdeaId, selectedMinutes)
		setPanelVisible(computerPanel, false)
	end
end)

local function renderIdeaPicker(ideas)
	ideaPickerScroll:ClearAllChildren()
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 4)
	layout.Parent = ideaPickerScroll

	if selectedIdeaId then
		local stillHave = false
		for _, idea in ideas do
			if idea.id == selectedIdeaId then
				stillHave = true
			end
		end
		if not stillHave then
			selectedIdeaId = nil
		end
	end

	for _, idea in ideas do
		local pickButton = makeButton({
			Size = UDim2.new(1, 0, 0, 30),
			BackgroundColor3 = (idea.id == selectedIdeaId) and Theme.Positive or Color3.fromRGB(55, 58, 66),
			Text = string.format("%s — %s %s (pot. %d)", idea.genre, idea.theme, idea.twist, idea.potential),
			TextSize = 12,
			TextWrapped = true,
			Parent = ideaPickerScroll,
		})
		pickButton.MouseButton1Click:Connect(function()
			selectedIdeaId = idea.id
			renderIdeaPicker(ideas)
		end)
	end
end

-- ===== taskbar ล่างจอ (ปุ่ม home กลับ desktop + นาฬิกา) =====
local taskbar = makeFrame({
	Size = UDim2.new(1, 0, 0, 40),
	Position = UDim2.new(0, 0, 1, -40),
	BackgroundColor3 = Color3.fromRGB(13, 26, 43),
	Parent = screenArea,
})

local homeButton = makeButton({
	Size = UDim2.new(0, 26, 0, 26),
	Position = UDim2.new(0, 8, 0.5, -13),
	BackgroundColor3 = Theme.Accent,
	Text = "",
	Parent = taskbar,
})

local clockLabel = makeLabel({
	Size = UDim2.new(0, 80, 1, 0),
	Position = UDim2.new(1, -90, 0, 0),
	TextXAlignment = Enum.TextXAlignment.Right,
	TextColor3 = Theme.TextDim,
	Text = "00:00",
	Parent = taskbar,
})

task.spawn(function()
	while true do
		clockLabel.Text = os.date("%H:%M")
		task.wait(15)
	end
end)

-- ===== เปิด/ปิดหน้าต่างแอป (กดไอคอน = เปิด, กด X = กลับ desktop) =====
local function goToDesktop()
	aiWindow.Visible = false
	filesWindow.Visible = false
	desktopIcons.Visible = true
end

local function openAiWindow()
	desktopIcons.Visible = false
	filesWindow.Visible = false
	aiWindow.Visible = true
end

local function openFilesWindow()
	desktopIcons.Visible = false
	aiWindow.Visible = false
	filesWindow.Visible = true
	renderIdeaPicker(latestState.ideas)
end

aiIconButton.MouseButton1Click:Connect(openAiWindow)
filesIconButton.MouseButton1Click:Connect(openFilesWindow)
aiWindowCloseButton.MouseButton1Click:Connect(goToDesktop)
filesWindowCloseButton.MouseButton1Click:Connect(goToDesktop)
homeButton.MouseButton1Click:Connect(goToDesktop)

goToDesktop()

-- ===== work session HUD (progress + focus, โผล่ตอนกำลังทำงาน) =====
local workHud = makeFrame({
	Name = "WorkHud",
	Size = UDim2.new(0, 320, 0, 110),
	Position = UDim2.new(0.5, -160, 0, 20),
	BackgroundColor3 = Theme.PanelBackground,
	Visible = false,
	Parent = screenGui,
})
addStroke(workHud)

makeLabel({ Size = UDim2.new(1, -20, 0, 16), Position = UDim2.new(0, 10, 0, 6), TextSize = 12, TextColor3 = Theme.TextDim, Text = "Progress", Parent = workHud })
local progressBarBg = makeFrame({ Size = UDim2.new(1, -20, 0, 18), Position = UDim2.new(0, 10, 0, 24), BackgroundColor3 = Color3.fromRGB(50, 52, 58), Parent = workHud })
local progressBarFill = makeFrame({ Size = UDim2.new(0, 0, 1, 0), BackgroundColor3 = Theme.Accent, Parent = progressBarBg })

makeLabel({ Size = UDim2.new(1, -20, 0, 16), Position = UDim2.new(0, 10, 0, 46), TextSize = 12, TextColor3 = Theme.TextDim, Text = "Focus", Parent = workHud })
local focusBarBg = makeFrame({ Size = UDim2.new(1, -20, 0, 18), Position = UDim2.new(0, 10, 0, 64), BackgroundColor3 = Color3.fromRGB(50, 52, 58), Parent = workHud })
local focusBarFill = makeFrame({ Size = UDim2.new(1, 0, 1, 0), BackgroundColor3 = Theme.Warning, Parent = focusBarBg })

local cancelWorkButton = makeButton({
	Size = UDim2.new(1, -20, 0, 26),
	Position = UDim2.new(0, 10, 0, 88),
	BackgroundColor3 = Theme.Danger,
	Text = "Stop working",
	Parent = workHud,
})
cancelWorkButton.MouseButton1Click:Connect(function()
	cancelWorkRemote:FireServer()
end)

-- ===== decision popup =====
local decisionPopup = makeFrame({
	Name = "DecisionPopup",
	Size = UDim2.new(0, 340, 0, 160),
	Position = UDim2.new(0.5, -170, 0.5, -80),
	BackgroundColor3 = Color3.fromRGB(40, 26, 26),
	Visible = false,
	Parent = screenGui,
})
addStroke(decisionPopup, Theme.Warning, 1.5)

local decisionPromptLabel = makeLabel({
	Size = UDim2.new(1, -20, 0, 60),
	Position = UDim2.new(0, 10, 0, 10),
	TextWrapped = true,
	Font = Enum.Font.GothamBold,
	TextSize = 16,
	Text = "",
	Parent = decisionPopup,
})

local decisionChoiceHolder = makeFrame({ Size = UDim2.new(1, -20, 0, 80), Position = UDim2.new(0, 10, 0, 74), BackgroundTransparency = 1, Parent = decisionPopup })

local function showDecision(event)
	decisionChoiceHolder:ClearAllChildren()
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 6)
	layout.Parent = decisionChoiceHolder

	decisionPromptLabel.Text = event.prompt
	for _, choice in event.choices do
		local choiceButton = makeButton({
			Size = UDim2.new(1, 0, 0, 32),
			BackgroundColor3 = Color3.fromRGB(70, 70, 70),
			Text = choice.Label,
			Parent = decisionChoiceHolder,
		})
		choiceButton.MouseButton1Click:Connect(function()
			decisionChoiceRemote:FireServer(choice.Key)
			setPanelVisible(decisionPopup, false)
		end)
	end
	setPanelVisible(decisionPopup, true)
end

-- ===== นั่งเก้าอี้ = เปิดคอม, กระโดดลุก = ปิดคอม (built-in Seat mechanic) =====
local function onCharacterAdded(character)
	local humanoid = character:WaitForChild("Humanoid")
	humanoid.Seated:Connect(function(active, seatPart)
		if active and seatPart and seatPart.Name == "ComputerChair" then
			renderIdeaPicker(latestState.ideas)
			setPanelVisible(computerPanel, true)
		elseif not active then
			setPanelVisible(computerPanel, false)
		end
	end)
end

if player.Character then
	onCharacterAdded(player.Character)
end
player.CharacterAdded:Connect(onCharacterAdded)

-- ===== state updates from server =====
playerDataUpdated.OnClientEvent:Connect(function(state)
	latestState = state
	cashLabel.Text = "Cash: " .. state.cash
	renderGames(state.games)
	renderIdeaSummaries(state.ideas)
	if filesWindow.Visible then
		renderIdeaPicker(state.ideas)
	end

	storageLabel.Text = string.format("Storage: %d / %d", state.unsoldGames, state.maxUnsoldGames)
	aiStatusLabel.Text = string.format("Queries left: %d\nAI level: %d%s", state.aiQueriesLeft, state.aiLevel, state.subscriptionActive and " (subscribed)" or "")

	local gear = Config.Gear[state.gearTier] or Config.Gear[1]
	gearLabel.Text = string.format("Gear: %s (cap %d)", gear.Name, gear.QualityCap)
	local nextTier = Config.Gear[state.gearTier + 1]
	buyGearButton.Text = nextTier and string.format("Upgrade to %s ($%d)", nextTier.Name, nextTier.Cost) or "Max gear"
	buyGearButton.Visible = nextTier ~= nil

	startWorkButton.Text = (state.unsoldGames >= state.maxUnsoldGames) and "Storage full — sell a game first" or "Start Working"

	focusBarFill.Size = UDim2.new(state.focus / Config.Focus.Max, 0, 1, 0)
end)

workSessionStarted.OnClientEvent:Connect(function()
	progressBarFill.Size = UDim2.new(0, 0, 1, 0)
	setPanelVisible(workHud, true)
end)

workProgressRemote.OnClientEvent:Connect(function(progress)
	progressBarFill.Size = UDim2.new(math.clamp(progress.elapsed / progress.total, 0, 1), 0, 1, 0)
	focusBarFill.Size = UDim2.new(progress.focus / Config.Focus.Max, 0, 1, 0)
end)

decisionEventRemote.OnClientEvent:Connect(showDecision)

workSessionEnded.OnClientEvent:Connect(function()
	setPanelVisible(workHud, false)
	setPanelVisible(decisionPopup, false)
end)

requestStateRemote:FireServer()

print("game-dev-simulator: client started")
