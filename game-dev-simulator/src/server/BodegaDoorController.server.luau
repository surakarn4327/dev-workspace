local TweenService = game:GetService("TweenService")

local bldg = workspace.City_Template.CityTemplateBuildings["28_bldg"]
local X_MIN, X_MAX = 398.16, 426.16
local Z_MIN, Z_MAX = 116.24, 159.23
local interiorCentroid = Vector3.new((X_MIN + X_MAX) / 2, 5, (Z_MIN + Z_MAX) / 2)

local OPEN_ANGLE = math.rad(110)
local TWEEN_TIME = 0.6

for _, doorModel in ipairs(bldg.Bldg_Doors:GetChildren()) do
	local panel = doorModel:FindFirstChild("Bldg_Door_B_Panel")
	if panel then
		local closedCFrame = panel.CFrame
		local halfWidth = panel.Size.Z / 2

		local hingeA = closedCFrame * CFrame.new(0, 0, -halfWidth)
		local hingeB = closedCFrame * CFrame.new(0, 0, halfWidth)

		local function rotateAround(hingeCF, angle)
			local pivotPos = hingeCF.Position
			return CFrame.new(pivotPos) * CFrame.Angles(0, angle, 0) * CFrame.new(-pivotPos) * closedCFrame
		end

		-- Try both hinge edges x both directions, pick whichever swings the panel's far edge deepest into the interior
		local candidates = {
			{hinge = hingeA, cf = rotateAround(hingeA, OPEN_ANGLE)},
			{hinge = hingeA, cf = rotateAround(hingeA, -OPEN_ANGLE)},
			{hinge = hingeB, cf = rotateAround(hingeB, OPEN_ANGLE)},
			{hinge = hingeB, cf = rotateAround(hingeB, -OPEN_ANGLE)},
		}
		local best, bestDist
		for _, c in ipairs(candidates) do
			local d = (c.cf.Position - interiorCentroid).Magnitude
			if not bestDist or d < bestDist then
				bestDist = d
				best = c
			end
		end
		local openCFrame = best.cf
		local hingeAttachPos = best.hinge.Position

		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Open"
		prompt.ObjectText = "Door"
		prompt.KeyboardKeyCode = Enum.KeyCode.E
		prompt.MaxActivationDistance = 8
		prompt.HoldDuration = 0
		prompt.RequiresLineOfSight = false
		prompt.Parent = panel

		local isOpen = false
		local tweening = false

		prompt.Triggered:Connect(function(player)
			if tweening then return end
			tweening = true
			isOpen = not isOpen
			prompt.ActionText = isOpen and "Close" or "Open"
			local targetCFrame = isOpen and openCFrame or closedCFrame
			local tween = TweenService:Create(panel, TweenInfo.new(TWEEN_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {CFrame = targetCFrame})
			tween:Play()
			tween.Completed:Connect(function()
				tweening = false
			end)
		end)
	end
end
