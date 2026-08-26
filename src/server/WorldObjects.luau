-- สร้าง Part ในโลกเกม (คอมพิวเตอร์เครื่องเดียว) ด้วยโค้ดตอน server start
-- ทำแบบนี้แทนวางเองใน Studio เพราะ Claude แก้ได้แค่โค้ด .lua ไม่แตะ Studio GUI ได้
-- ยังเป็น primitive Part ประกอบกัน ไม่ใช่โมเดล 3D จริง — โมเดลสวยจาก Toolbox ต้องผู้เล่นไปเลือกเองใน Studio
local WorldObjects = {}

local function addLabel(basePart, text, color)
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "Label"
	billboard.Size = UDim2.new(0, 160, 0, 36)
	billboard.StudsOffset = Vector3.new(0, 2.2, 0)
	billboard.AlwaysOnTop = true
	billboard.Parent = basePart

	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 1, 0)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextSize = 16
	label.TextColor3 = color
	label.TextStrokeTransparency = 0.3
	label.Text = text
	label.Parent = billboard
end

function WorldObjects.Init()
	if workspace:FindFirstChild("Computer") then
		return
	end

	local desk = Instance.new("Part")
	desk.Name = "Computer"
	desk.Anchored = true
	desk.CanCollide = true
	desk.Size = Vector3.new(5, 3, 3)
	desk.Position = Vector3.new(0, 1.5, 0)
	desk.Material = Enum.Material.WoodPlanks
	desk.Color = Color3.fromRGB(120, 80, 50)
	desk.Parent = workspace

	local monitor = Instance.new("Part")
	monitor.Name = "Monitor"
	monitor.Anchored = true
	monitor.CanCollide = false
	monitor.Size = Vector3.new(2, 1.4, 0.2)
	monitor.Position = desk.Position + Vector3.new(0, 2.2, -1.2)
	monitor.Material = Enum.Material.Metal
	monitor.Color = Color3.fromRGB(30, 30, 30)
	monitor.Parent = workspace

	local screen = Instance.new("Part")
	screen.Name = "MonitorScreen"
	screen.Anchored = true
	screen.CanCollide = false
	screen.Size = Vector3.new(1.7, 1.1, 0.05)
	screen.Position = monitor.Position + Vector3.new(0, 0, -0.13)
	screen.Material = Enum.Material.Neon
	screen.Color = Color3.fromRGB(60, 160, 255)
	screen.Parent = workspace

	local glow = Instance.new("PointLight")
	glow.Color = Color3.fromRGB(60, 160, 255)
	glow.Range = 10
	glow.Brightness = 2
	glow.Parent = screen

	-- นั่งเก้าอี้ = เปิดคอม, กระโดดลุก = ออกจากคอม (built-in Seat mechanic ของ Roblox แทนปุ่ม UI)
	local chair = Instance.new("Seat")
	chair.Name = "ComputerChair"
	chair.Anchored = true
	chair.Size = Vector3.new(2, 1, 2)
	chair.Position = desk.Position + Vector3.new(0, -0.5, 2)
	chair.Material = Enum.Material.Fabric
	chair.Color = Color3.fromRGB(60, 60, 70)
	chair.Parent = workspace

	addLabel(desk, "Computer", Color3.fromRGB(160, 200, 255))
end

return WorldObjects
