-- entry point ฝั่ง client — UI/input เท่านั้น ห้ามคำนวณเงิน/ราคาขายเอง
-- ทุกค่าที่เห็น (เงิน, คุณภาพ, ราคา) มาจาก server ผ่าน PlayerDataUpdated เท่านั้น
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Remotes = require(ReplicatedStorage.Shared.Remotes)

local createGameRemote = Remotes.Get("CreateGame")
local sellGameRemote = Remotes.Get("SellGame")
local playerDataUpdated = Remotes.Get("PlayerDataUpdated")

local player = Players.LocalPlayer
local selectedGenre = Config.Genres[1]
local selectedMinutes = Config.GameQuality.MinMinutes

-- ===== root UI =====
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "GameDevSimulatorUI"
screenGui.ResetOnSpawn = false
screenGui.Parent = player:WaitForChild("PlayerGui")

local cashLabel = Instance.new("TextLabel")
cashLabel.Name = "CashLabel"
cashLabel.Size = UDim2.new(0, 220, 0, 40)
cashLabel.Position = UDim2.new(0, 20, 0, 20)
cashLabel.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
cashLabel.TextColor3 = Color3.fromRGB(255, 215, 0)
cashLabel.Font = Enum.Font.GothamBold
cashLabel.TextSize = 22
cashLabel.Text = "Cash: 0"
cashLabel.Parent = screenGui

-- ===== create-game panel =====
local createPanel = Instance.new("Frame")
createPanel.Name = "CreatePanel"
createPanel.Size = UDim2.new(0, 260, 0, 220)
createPanel.Position = UDim2.new(0, 20, 0, 80)
createPanel.BackgroundColor3 = Color3.fromRGB(25, 25, 25)
createPanel.Parent = screenGui

local createTitle = Instance.new("TextLabel")
createTitle.Size = UDim2.new(1, 0, 0, 30)
createTitle.BackgroundTransparency = 1
createTitle.TextColor3 = Color3.new(1, 1, 1)
createTitle.Font = Enum.Font.GothamBold
createTitle.TextSize = 18
createTitle.Text = "สร้างเกม"
createTitle.Parent = createPanel

local genreLabel = Instance.new("TextLabel")
genreLabel.Size = UDim2.new(1, -20, 0, 24)
genreLabel.Position = UDim2.new(0, 10, 0, 30)
genreLabel.BackgroundTransparency = 1
genreLabel.TextColor3 = Color3.new(1, 1, 1)
genreLabel.Font = Enum.Font.Gotham
genreLabel.TextSize = 14
genreLabel.TextXAlignment = Enum.TextXAlignment.Left
genreLabel.Text = "Genre: " .. selectedGenre
genreLabel.Parent = createPanel

local genreButtonRow = Instance.new("Frame")
genreButtonRow.Size = UDim2.new(1, -20, 0, 30)
genreButtonRow.Position = UDim2.new(0, 10, 0, 56)
genreButtonRow.BackgroundTransparency = 1
genreButtonRow.Parent = createPanel

local genreLayout = Instance.new("UIListLayout")
genreLayout.FillDirection = Enum.FillDirection.Horizontal
genreLayout.Padding = UDim.new(0, 4)
genreLayout.Parent = genreButtonRow

local function cycleGenre()
	local currentIndex = table.find(Config.Genres, selectedGenre) or 1
	local nextIndex = (currentIndex % #Config.Genres) + 1
	selectedGenre = Config.Genres[nextIndex]
	genreLabel.Text = "Genre: " .. selectedGenre
end

local genreCycleButton = Instance.new("TextButton")
genreCycleButton.Size = UDim2.new(0, 100, 0, 28)
genreCycleButton.BackgroundColor3 = Color3.fromRGB(60, 60, 60)
genreCycleButton.TextColor3 = Color3.new(1, 1, 1)
genreCycleButton.Font = Enum.Font.Gotham
genreCycleButton.TextSize = 14
genreCycleButton.Text = "เปลี่ยน genre"
genreCycleButton.Parent = genreButtonRow
genreCycleButton.MouseButton1Click:Connect(cycleGenre)

local minutesLabel = Instance.new("TextLabel")
minutesLabel.Size = UDim2.new(1, -20, 0, 24)
minutesLabel.Position = UDim2.new(0, 10, 0, 96)
minutesLabel.BackgroundTransparency = 1
minutesLabel.TextColor3 = Color3.new(1, 1, 1)
minutesLabel.Font = Enum.Font.Gotham
minutesLabel.TextSize = 14
minutesLabel.TextXAlignment = Enum.TextXAlignment.Left
minutesLabel.Text = "เวลาที่ใช้ทำ: " .. selectedMinutes .. " นาที"
minutesLabel.Parent = createPanel

local function updateMinutes(delta)
	selectedMinutes = math.clamp(selectedMinutes + delta, Config.GameQuality.MinMinutes, Config.GameQuality.MaxMinutes)
	minutesLabel.Text = "เวลาที่ใช้ทำ: " .. selectedMinutes .. " นาที"
end

local minutesButtonRow = Instance.new("Frame")
minutesButtonRow.Size = UDim2.new(1, -20, 0, 30)
minutesButtonRow.Position = UDim2.new(0, 10, 0, 122)
minutesButtonRow.BackgroundTransparency = 1
minutesButtonRow.Parent = createPanel

local minutesLayout = Instance.new("UIListLayout")
minutesLayout.FillDirection = Enum.FillDirection.Horizontal
minutesLayout.Padding = UDim.new(0, 4)
minutesLayout.Parent = minutesButtonRow

local minusButton = Instance.new("TextButton")
minusButton.Size = UDim2.new(0, 40, 0, 28)
minusButton.BackgroundColor3 = Color3.fromRGB(60, 60, 60)
minusButton.TextColor3 = Color3.new(1, 1, 1)
minusButton.Font = Enum.Font.GothamBold
minusButton.TextSize = 16
minusButton.Text = "-1"
minusButton.Parent = minutesButtonRow
minusButton.MouseButton1Click:Connect(function()
	updateMinutes(-1)
end)

local plusButton = Instance.new("TextButton")
plusButton.Size = UDim2.new(0, 40, 0, 28)
plusButton.BackgroundColor3 = Color3.fromRGB(60, 60, 60)
plusButton.TextColor3 = Color3.new(1, 1, 1)
plusButton.Font = Enum.Font.GothamBold
plusButton.TextSize = 16
plusButton.Text = "+1"
plusButton.Parent = minutesButtonRow
plusButton.MouseButton1Click:Connect(function()
	updateMinutes(1)
end)

local createButton = Instance.new("TextButton")
createButton.Size = UDim2.new(1, -20, 0, 36)
createButton.Position = UDim2.new(0, 10, 0, 168)
createButton.BackgroundColor3 = Color3.fromRGB(40, 130, 60)
createButton.TextColor3 = Color3.new(1, 1, 1)
createButton.Font = Enum.Font.GothamBold
createButton.TextSize = 16
createButton.Text = "สร้างเกม"
createButton.Parent = createPanel
createButton.MouseButton1Click:Connect(function()
	createGameRemote:FireServer(selectedGenre, selectedMinutes)
end)

-- ===== games list panel =====
local listPanel = Instance.new("Frame")
listPanel.Name = "GamesListPanel"
listPanel.Size = UDim2.new(0, 320, 0, 400)
listPanel.Position = UDim2.new(0, 300, 0, 80)
listPanel.BackgroundColor3 = Color3.fromRGB(25, 25, 25)
listPanel.Parent = screenGui

local listTitle = Instance.new("TextLabel")
listTitle.Size = UDim2.new(1, 0, 0, 30)
listTitle.BackgroundTransparency = 1
listTitle.TextColor3 = Color3.new(1, 1, 1)
listTitle.Font = Enum.Font.GothamBold
listTitle.TextSize = 18
listTitle.Text = "เกมของฉัน"
listTitle.Parent = listPanel

local scrollFrame = Instance.new("ScrollingFrame")
scrollFrame.Size = UDim2.new(1, -10, 1, -40)
scrollFrame.Position = UDim2.new(0, 5, 0, 34)
scrollFrame.BackgroundTransparency = 1
scrollFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
scrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
scrollFrame.ScrollBarThickness = 6
scrollFrame.Parent = listPanel

local function renderGames(games)
	scrollFrame:ClearAllChildren() -- ลบ layout เดิมไปด้วย ต้องสร้างใหม่ทุกครั้ง
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 6)
	layout.Parent = scrollFrame

	for _, gameEntry in games do
		local row = Instance.new("Frame")
		row.Size = UDim2.new(1, 0, 0, 50)
		row.BackgroundColor3 = Color3.fromRGB(45, 45, 45)
		row.Parent = scrollFrame

		local info = Instance.new("TextLabel")
		info.Size = UDim2.new(1, -90, 1, 0)
		info.Position = UDim2.new(0, 8, 0, 0)
		info.BackgroundTransparency = 1
		info.TextColor3 = Color3.new(1, 1, 1)
		info.Font = Enum.Font.Gotham
		info.TextSize = 14
		info.TextXAlignment = Enum.TextXAlignment.Left
		info.TextWrapped = true
		local status = gameEntry.sold and "ขายแล้ว" or "ยังไม่ขาย"
		info.Text = string.format("#%d %s\nคุณภาพ %d — %s", gameEntry.id, gameEntry.genre, gameEntry.quality, status)
		info.Parent = row

		local sellButton = Instance.new("TextButton")
		sellButton.Size = UDim2.new(0, 70, 0, 34)
		sellButton.Position = UDim2.new(1, -78, 0.5, -17)
		sellButton.BackgroundColor3 = gameEntry.sold and Color3.fromRGB(70, 70, 70) or Color3.fromRGB(180, 140, 30)
		sellButton.TextColor3 = Color3.new(1, 1, 1)
		sellButton.Font = Enum.Font.GothamBold
		sellButton.TextSize = 14
		sellButton.Text = gameEntry.sold and "ขายแล้ว" or "ขาย"
		sellButton.AutoButtonColor = not gameEntry.sold
		sellButton.Parent = row

		if not gameEntry.sold then
			sellButton.MouseButton1Click:Connect(function()
				sellGameRemote:FireServer(gameEntry.id)
			end)
		end
	end
end

playerDataUpdated.OnClientEvent:Connect(function(state)
	cashLabel.Text = "Cash: " .. state.cash
	renderGames(state.games)
end)

print("game-dev-simulator: client started")
