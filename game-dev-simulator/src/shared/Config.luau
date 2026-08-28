-- ค่าคงที่ balance เกมทั้งหมด รวมไว้จุดเดียวตามกฎใน CLAUDE.md
local Config = {}

Config.StartingCash = 100

Config.GameQuality = {
	MinMinutes = 1,
	MaxMinutes = 10,
	BasePricePerQuality = 5,
}

Config.Employee = {
	BaseHireCost = 500,
	QualityBonusPerEmployee = 0.1,
}

return Config
