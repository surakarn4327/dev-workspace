local bldg = workspace.City_Template.CityTemplateBuildings["33_BLDG"]
local realPanel = bldg.Bldg_Doors:GetChildren()[1].Bldg_Door_B_Panel
local frame = bldg.Bldg_Doors:GetChildren()[1].Bldg_Door_B_frame

local apt = workspace.PocketRooms.PlayerApartment
local interiorSpawn = apt.InteriorSpawnPoint

local rightVec = realPanel.CFrame.RightVector -- points outward, toward street

local exteriorPos = realPanel.Position + rightVec * 3
exteriorPos = Vector3.new(exteriorPos.X, frame.Position.Y - frame.Size.Y/2 + 3, exteriorPos.Z)
local exteriorLook = -rightVec -- face back toward the door

local interiorPos = interiorSpawn.Position
local interiorLook = Vector3.new(0, 0, 1) -- face into the room (away from entrance wall)

local function teleport(character, position, lookDir)
	local hrp = character:FindFirstChild("HumanoidRootPart")
	if not hrp then return end
	hrp.CFrame = CFrame.lookAt(position, position + lookDir)
end

-- Real front door: Enter (independent of the interior exit door existing)
local enterPrompt = Instance.new("ProximityPrompt")
enterPrompt.ActionText = "Enter"
enterPrompt.ObjectText = "Apartment"
enterPrompt.KeyboardKeyCode = Enum.KeyCode.E
enterPrompt.MaxActivationDistance = 8
enterPrompt.HoldDuration = 0
enterPrompt.RequiresLineOfSight = false
enterPrompt.Parent = realPanel

enterPrompt.Triggered:Connect(function(player)
	if player.Character then
		teleport(player.Character, interiorPos, interiorLook)
	end
end)

-- Apartment interior exit door: Exit (set up separately so a missing/renamed
-- exit door can never break the entrance prompt above)
local exitDoor = apt:FindFirstChild("ExitDoorPanel")
if exitDoor then
	local exitPrompt = Instance.new("ProximityPrompt")
	exitPrompt.ActionText = "Exit"
	exitPrompt.ObjectText = "Apartment"
	exitPrompt.KeyboardKeyCode = Enum.KeyCode.E
	exitPrompt.MaxActivationDistance = 8
	exitPrompt.HoldDuration = 0
	exitPrompt.RequiresLineOfSight = true -- must see through the real (physical) door to exit; forces opening it first
	exitPrompt.Parent = exitDoor

	exitPrompt.Triggered:Connect(function(player)
		if player.Character then
			teleport(player.Character, exteriorPos, exteriorLook)
		end
	end)
else
	warn("ApartmentDoorController: ExitDoorPanel not found under PlayerApartment — exit prompt skipped")
end
