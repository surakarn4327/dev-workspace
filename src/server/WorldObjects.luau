-- สร้าง Part ในโลกเกม (คอมพิวเตอร์, ห้อง) ด้วยโค้ดตอน server start
-- ทำแบบนี้แทนวางเองใน Studio เพราะ Claude แก้ได้แค่โค้ด .lua ไม่แตะ Studio GUI ได้
-- ยังเป็น primitive Part ประกอบกัน ไม่ใช่โมเดล 3D จริง — โมเดลสวยจาก Toolbox ต้องผู้เล่นไปเลือกเองใน Studio
local WorldObjects = {}

-- ห้อง blockout ง่ายๆ กันความรู้สึก "ลอยอยู่ในความว่าง" — กล่องเปล่าก่อน ค่อยแต่งจริงทีหลัง (ดู DESIGN.md)
-- เว้นช่องประตูด้านใต้ไว้เป็นทางออกไปโลกภายนอก (สำหรับ Part 2 ตระเวนขาย ในอนาคต)
local ROOM_HALF = 12
local WALL_HEIGHT = 10
local DOOR_WIDTH = 6

-- ทดสอบ 3 ขนาดจอ (เล็ก/กลาง/ใหญ่) วางเรียงข้างกัน เพื่อเช็คว่าสูตร fit กล้องรองรับทุกขนาดจอในอนาคต (อัพเกรดจอ)
-- สัดส่วน 16:9 ทุกขนาดเหมือนจอคอมจริง
local COMPUTER_SIZES = {
	{ Name = "Small", ScreenWidth = 2.4 },
	{ Name = "Medium", ScreenWidth = 3.6 },
	{ Name = "Large", ScreenWidth = 5.4 },
}

local function createWall(name, size, position)
	local wall = Instance.new("Part")
	wall.Name = name
	wall.Anchored = true
	wall.CanCollide = true
	wall.Size = size
	wall.Position = position
	wall.Material = Enum.Material.SmoothPlastic
	wall.Color = Color3.fromRGB(210, 205, 195)
	wall.Parent = workspace
end

local function createRoom()
	local roomFolder = Instance.new("Folder")
	roomFolder.Name = "Room"
	roomFolder.Parent = workspace

	local wallCenterY = WALL_HEIGHT / 2
	createWall("NorthWall", Vector3.new(ROOM_HALF * 2, WALL_HEIGHT, 1), Vector3.new(0, wallCenterY, -ROOM_HALF))
	createWall("EastWall", Vector3.new(1, WALL_HEIGHT, ROOM_HALF * 2), Vector3.new(ROOM_HALF, wallCenterY, 0))
	createWall("WestWall", Vector3.new(1, WALL_HEIGHT, ROOM_HALF * 2), Vector3.new(-ROOM_HALF, wallCenterY, 0))

	-- ผนังใต้เว้นช่องกลางไว้เป็นประตู
	local sideWidth = (ROOM_HALF * 2 - DOOR_WIDTH) / 2
	local sideOffsetX = (DOOR_WIDTH + sideWidth) / 2
	createWall("SouthWallLeft", Vector3.new(sideWidth, WALL_HEIGHT, 1), Vector3.new(-sideOffsetX, wallCenterY, ROOM_HALF))
	createWall("SouthWallRight", Vector3.new(sideWidth, WALL_HEIGHT, 1), Vector3.new(sideOffsetX, wallCenterY, ROOM_HALF))
end

-- แต่ละสถานีอยู่ใน Folder ของตัวเอง (Desk/Monitor/MonitorScreen/Chair) กันชื่อชนกันเวลามีหลายจอ
-- client จะหา MonitorScreen ที่ตรงกันจาก seatPart.Parent ตอนนั่ง ไม่ได้ hardcode จอเดียวอีกต่อไป
local function createComputerStation(sizeInfo, deskPositionX)
	local station = Instance.new("Folder")
	station.Name = "ComputerStation_" .. sizeInfo.Name
	station.Parent = workspace

	local screenWidth = sizeInfo.ScreenWidth
	local screenHeight = screenWidth * 9 / 16

	local desk = Instance.new("Part")
	desk.Name = "Computer"
	desk.Anchored = true
	desk.CanCollide = true
	desk.Size = Vector3.new(5, 3, 3)
	desk.Position = Vector3.new(deskPositionX, 1.5, -ROOM_HALF + 3)
	desk.Material = Enum.Material.WoodPlanks
	desk.Color = Color3.fromRGB(120, 80, 50)
	desk.Parent = station

	local monitorHeight = screenHeight + 0.375
	local deskTopY = desk.Position.Y + desk.Size.Y / 2

	local monitor = Instance.new("Part")
	monitor.Name = "Monitor"
	monitor.Anchored = true
	monitor.CanCollide = false
	monitor.Size = Vector3.new(screenWidth + 0.3, monitorHeight, 0.2)
	-- ยกตามความสูงจอจริง กันจอใหญ่จมลงไปในโต๊ะ (เดิม hardcode offset เดียวใช้กับทุกขนาด)
	monitor.Position = Vector3.new(desk.Position.X, deskTopY + monitorHeight / 2 + 0.3, desk.Position.Z - 1.2)
	monitor.Material = Enum.Material.Metal
	monitor.Color = Color3.fromRGB(30, 30, 30)
	monitor.Parent = station

	local screen = Instance.new("Part")
	screen.Name = "MonitorScreen"
	screen.Anchored = true
	screen.CanCollide = false
	screen.Size = Vector3.new(screenWidth, screenHeight, 0.05)
	screen.Position = monitor.Position + Vector3.new(0, 0, 0.13) -- ด้านหันเข้าหาเก้าอี้ (chair อยู่ +Z จากโต๊ะ)
	screen.Material = Enum.Material.Neon
	screen.Color = Color3.fromRGB(60, 160, 255)
	screen.Parent = station

	local glow = Instance.new("PointLight")
	glow.Color = Color3.fromRGB(60, 160, 255)
	glow.Range = 10
	glow.Brightness = 2
	glow.Parent = screen

	-- นั่งเก้าอี้ = เปิดคอม, กระโดดลุก = ออกจากคอม (built-in Seat mechanic ของ Roblox แทนปุ่ม UI)
	-- ตัวละครถูกทำให้โปร่งใสฝั่ง client ตอนนั่ง (ดู init.client.luau) เก้าอี้เลยอยู่ตำแหน่งเดิมได้ทุกขนาดจอ
	-- ไม่ต้องขยับตามขนาดจอ เพราะไม่มีตัวละครมาบังจอให้ต้องหลบอีกแล้ว
	local chair = Instance.new("Seat")
	chair.Name = "ComputerChair"
	chair.Anchored = true
	chair.Size = Vector3.new(2, 1, 2)
	chair.Position = desk.Position + Vector3.new(0, -0.5, 2)
	chair.Material = Enum.Material.Fabric
	chair.Color = Color3.fromRGB(60, 60, 70)
	chair.Parent = station
end

function WorldObjects.Init()
	if workspace:FindFirstChild("ComputerStation_Medium") then
		return
	end

	createRoom()

	local spacing = 8
	local startX = -(#COMPUTER_SIZES - 1) * spacing / 2
	for index, sizeInfo in COMPUTER_SIZES do
		createComputerStation(sizeInfo, startX + (index - 1) * spacing)
	end
end

return WorldObjects
