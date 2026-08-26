-- ค่าคงที่ balance เกมทั้งหมด รวมไว้จุดเดียวตามกฎใน CLAUDE.md
local Config = {}

Config.StartingCash = 100

Config.GameQuality = {
	MinMinutes = 1,
	MaxMinutes = 10,
	BasePricePerQuality = 5,
	QualityPerMinute = 8, -- quality point ต่อ 1 นาทีที่ทุ่มเวลาทำ (ก่อน cap ที่ 100)
}

Config.Genres = {
	"Action",
	"Puzzle",
	"Simulation",
	"Horror",
	"Racing",
}

Config.Employee = {
	BaseHireCost = 500,
	QualityBonusPerEmployee = 0.1,
}

Config.Storage = {
	MaxUnsoldGames = 5, -- "พื้นที่ดิสก์" เต็มแล้วสร้างเกมใหม่ไม่ได้จนกว่าจะขาย
}

Config.AI = {
	FreeQueriesPerCycle = 3,
	QueryResetSeconds = 300, -- 1 "รอบวัน" = 5 นาทีจริง
	SubscriptionCostPerCycle = 200,
	SubscriptionCycleSeconds = 300,
	SubscriptionQueryBonus = 5,
	MaxLevel = 3,
	MaxIdeaInventory = 5,
}

Config.WorkSession = {
	SecondsPerGameMinute = 2, -- ก่อนหาร gear.SpeedMultiplier
	MaxDeskDistance = 12,
	DecisionChanceEachTick = 0.12,
	MaxDecisionsPerSession = 2,
	DecisionResponseSeconds = 15,
}

Config.Focus = {
	Max = 100,
	DrainPerSecondWorking = 1.5,
	RegenPerSecondIdle = 4,
}

Config.Gear = {
	{ Name = "Old Laptop", Cost = 0, SpeedMultiplier = 1, QualityCap = 60 },
	{ Name = "Budget PC", Cost = 300, SpeedMultiplier = 1.5, QualityCap = 80 },
	{ Name = "Dev Workstation", Cost = 1200, SpeedMultiplier = 2.2, QualityCap = 100 },
}

Config.DecisionEvents = {
	{
		Key = "weird_bug",
		Prompt = "You hit a weird bug mid-development.",
		Choices = {
			{ Key = "fix", Label = "Stop and fix it properly", QualityDelta = 8, ExtraSeconds = 6, FocusDelta = -5 },
			{ Key = "skip", Label = "Patch around it and move on", QualityDelta = -3, ExtraSeconds = 0, FocusDelta = 0 },
		},
	},
	{
		Key = "creative_spark",
		Prompt = "A creative idea hits you out of nowhere.",
		Choices = {
			{ Key = "explore", Label = "Chase the idea", QualityDelta = 10, ExtraSeconds = 4, FocusDelta = -8 },
			{ Key = "ignore", Label = "Stay focused on the plan", QualityDelta = 0, ExtraSeconds = 0, FocusDelta = 0 },
		},
	},
}

return Config
