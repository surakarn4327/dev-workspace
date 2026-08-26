-- จุดเดียวที่นิยาม RemoteEvent ทั้งหมด กัน client/server อ้างชื่อไม่ตรงกัน
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local REMOTE_NAMES = {
	"CreateGame",
	"SellGame",
	"PlayerDataUpdated",
}

local Remotes = {}

-- server เรียกครั้งเดียวตอน start เพื่อสร้าง RemoteEvent จริงใน ReplicatedStorage
function Remotes.Init()
	local folder = ReplicatedStorage:FindFirstChild("Remotes")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "Remotes"
		folder.Parent = ReplicatedStorage
	end

	for _, remoteName in REMOTE_NAMES do
		if not folder:FindFirstChild(remoteName) then
			local remote = Instance.new("RemoteEvent")
			remote.Name = remoteName
			remote.Parent = folder
		end
	end

	return folder
end

-- client/server เรียกเพื่อรอ+อ้างอิง RemoteEvent ที่มีอยู่แล้ว
function Remotes.Get(remoteName)
	local folder = ReplicatedStorage:WaitForChild("Remotes")
	return folder:WaitForChild(remoteName)
end

return Remotes
