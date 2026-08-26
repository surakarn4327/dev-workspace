-- pool ไอเดียสำหรับ "AI" ปลอม (weighted table ในเกม ไม่ใช่ LLM จริง — ห้ามผูก API ภายนอกตามกฎ workspace)
-- AI level ยิ่งสูง ยิ่งปลดล็อกไอเดีย potential สูงขึ้น
local IdeaPool = {}

IdeaPool.ByLevel = {
	[1] = {
		{ Theme = "a lost pet", Twist = "in a shrinking world", Potential = 20 },
		{ Theme = "a broken vending machine", Twist = "that grants wishes", Potential = 18 },
		{ Theme = "a quiet janitor", Twist = "who is secretly a hero", Potential = 22 },
	},
	[2] = {
		{ Theme = "a forgotten diary", Twist = "that rewrites reality", Potential = 32 },
		{ Theme = "a rival delivery driver", Twist = "racing across dimensions", Potential = 30 },
		{ Theme = "an ancient recipe", Twist = "with dangerous side effects", Potential = 34 },
	},
	[3] = {
		{ Theme = "a dying star", Twist = "that remembers every civilization it destroyed", Potential = 46 },
		{ Theme = "a city built on a sleeping giant", Twist = "that is starting to wake up", Potential = 44 },
		{ Theme = "an AI therapist", Twist = "slowly becoming more human than its patients", Potential = 48 },
	},
}

function IdeaPool.Roll(level, genres)
	local pool = {}
	for lvl = 1, level do
		for _, entry in IdeaPool.ByLevel[lvl] or {} do
			table.insert(pool, entry)
		end
	end

	local picked = pool[math.random(1, #pool)]
	local genre = genres[math.random(1, #genres)]

	return {
		genre = genre,
		theme = picked.Theme,
		twist = picked.Twist,
		potential = picked.Potential,
	}
end

return IdeaPool
