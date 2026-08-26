-- entry point ฝั่ง client — UI/input เท่านั้น ห้ามคำนวณเงิน/ราคาขายเอง
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Remotes = require(ReplicatedStorage.Shared.Remotes)

print("game-dev-simulator: client started")

-- ทดสอบชั่วคราว: ยังไม่มี UI จริง รอทำหน้าสร้างเกม
local createGameRemote = Remotes.Get("CreateGame")
local sellGameRemote = Remotes.Get("SellGame")

_G.TestCreateGame = function(genre, minutes)
	createGameRemote:FireServer(genre, minutes)
end

_G.TestSellGame = function(gameId)
	sellGameRemote:FireServer(gameId)
end
