local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")

Players.CharacterAutoLoads = false

-- Every player spawns as an exact clone of this one approved template rig --
-- furniture sizing throughout the game is measured against this fixed
-- character, so letting players keep their own avatar (or generating one via
-- HumanoidDescription, which produced the default blocky "noob" look instead
-- of this template) would silently break every scale/appearance reference.
local TEMPLATE = ServerStorage:WaitForChild("PlayerCharacterTemplate")

local RESPAWN_DELAY = 3

local function findSpawnCFrame()
	local spawnLocation = workspace:FindFirstChild("SpawnLocation", true) -- recursive: the real one is nested inside City_Template, not a direct child of Workspace
	if spawnLocation then
		return spawnLocation.CFrame + Vector3.new(0, spawnLocation.Size.Y / 2 + 3, 0)
	end
	return CFrame.new(0, 10, 0)
end

local function spawnFixedCharacter(player)
	local character = TEMPLATE:Clone()
	character.Name = player.Name
	character:PivotTo(findSpawnCFrame())
	character.Parent = workspace
	player.Character = character

	local humanoid = character:WaitForChild("Humanoid")
	humanoid.Died:Connect(function()
		task.wait(RESPAWN_DELAY)
		if player.Parent then
			spawnFixedCharacter(player)
		end
	end)
end

Players.PlayerAdded:Connect(spawnFixedCharacter)
