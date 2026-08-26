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

return Config
