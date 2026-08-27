# bugs.md

Log บั๊กที่เจอ+แก้จริงทุกครั้ง (ไม่ใช่แค่ปรับ scope/feature ใหม่) ต่อ 1 บั๊ก บันทึกอย่างน้อย 3 อย่าง:

1. **ชื่อ/อาการบั๊ก** — สั้นๆ ว่าเจออะไรผิดปกติ
2. **สาเหตุ** — root cause จริงๆ ไม่ใช่แค่ "แก้ตรงไหน"
3. **วิธีแก้** — แก้ยังไง อ้างไฟล์/บรรทัด/commit ถ้ามี

---

<!-- เพิ่มบั๊กใหม่ด้านล่างนี้ -->

## GetDataStore พังทั้งโมดูลเมื่อ place ยังไม่ publish

**อาการ**: กด Play ทดสอบใน Studio ครั้งแรก (place ที่สร้างใหม่ ยังไม่เคย publish) — `PlayerData.luau` error ทั้งโมดูลตั้งแต่โหลด (`Requested module experienced an error while loading`) ทำให้ `init.server.luau` (ที่ require มัน) พังทั้งไฟล์ และฝั่ง client ไม่เจอ `ReplicatedStorage.Remotes` เพราะ server ไม่เคยรันถึง `Remotes.Init()`

**สาเหตุ**: `DataStoreService:GetDataStore(...)` เอง (ไม่ใช่แค่ `GetAsync`/`SetAsync`) จะ throw ทันทีถ้า place ไม่มี id จริง (ยังไม่เคย publish ขึ้น Roblox) — เข้าใจผิดตอนแรกว่า pcall+retry ครอบแค่ `GetAsync`/`SetAsync` ก็พอ แต่ตัว `GetDataStore` ก็ error ได้เหมือนกันถ้าไม่มี place จริงรองรับ

**วิธีแก้**: wrap `DataStoreService:GetDataStore(...)` ด้วย `pcall` เองด้วย (ไม่ใช่แค่ retry loop ของ `GetAsync`/`SetAsync`) ถ้าพังให้ `playerStore = nil` แล้ว `Load`/`Save` เช็ค `if not playerStore` แล้ว fallback เป็นไม่เซฟถาวร (ข้อมูลอยู่แค่ในความจำ) แทนที่จะพังทั้งโมดูล — แก้ที่ `src/server/PlayerData.luau` (guard ตรง `local getStoreOk, playerStore = pcall(...)` และเช็ค `playerStore` ใน `Load`/`Save`)

## Cash/games ค้าง 0 ตอนเข้าเกมครั้งแรก ทั้งที่ server มีข้อมูลถูกต้อง

**อาการ**: กด Play เข้าเกม UI แสดง "Cash: 0" กับ "My Games" ว่างเปล่าตลอด ทั้งที่ `PlayerData.Load` คำนวณ `cash = Config.StartingCash` (100) ถูกต้องฝั่ง server — ต่อเมื่อไป interact อะไรสักอย่าง (เช่นขอไอเดีย/เริ่มทำงาน) ค่าถึงจะขึ้นถูกทันที

**สาเหตุ**: race condition ระหว่าง server กับ client — `Players.PlayerAdded` ยิง `PlayerData.Load(player)` ซึ่งเรียก `PlayerData.Push(player)` (`FireClient` ของ `PlayerDataUpdated`) เกือบจะทันทีตอน player join แต่ client script (`init.client.luau`) ยัง require module/สร้าง UI/ต่อ `OnClientEvent` ไม่เสร็จทัน — `RemoteEvent:FireClient` ไม่มี queue ให้ event ที่ยิงไปตอนยังไม่มีใครฟัง จะหายไปเฉยๆ ไม่ error ให้เห็นด้วย ทำให้ client พลาด state แรกสุดไปเงียบๆ

**วิธีแก้**: อย่าพึ่งแค่ server push ตอน join ให้ client ยิง remote ใหม่ `RequestState` ขอ state เองทันทีหลังต่อ listener เสร็จ (`src/client/init.client.luau` บรรทัดท้ายไฟล์) ฝั่ง server มี `PlayerData.InitRequestHandler()` (`src/server/PlayerData.luau`) คอย retry เช็ค cache ว่าข้อมูลโหลดเสร็จหรือยังก่อน push กลับ (กัน edge case client ขอเร็วกว่า `PlayerData.Load` เสร็จด้วย) — pattern นี้ต้องใช้ทุกครั้งที่มี server-push-on-join ในอนาคต ห้ามพึ่ง auto-push เดี่ยวๆ


## จอมอนิเตอร์ (SurfaceGui) หันเข้ากำแพงแทนที่จะหันเข้าหาเก้าอี้

**อาการ**: นั่งเก้าอี้แล้วกล้องขยับเข้าไปมองจอ แต่เห็นแต่สี่เหลี่ยมมืดๆ ไม่มี UI โผล่เลย ลองสลับ `SurfaceGui.Face`
ระหว่าง `Back`/`Front` หลายรอบก็ยังไม่ขึ้น (เสียเวลาลองผิดลองถูกไปนาน ก่อนกลับไปเช็คจุดเดิม)

**สาเหตุ**: ไม่เกี่ยวกับ `Face` หรือกล้องเลย ปัญหาจริงอยู่ที่ `src/server/WorldObjects.luau` — ตอนสร้าง `MonitorScreen`
(sub-part ของ `Monitor` ที่ทำหน้าที่เป็นตัวจอ) ใช้ `monitor.Position + Vector3.new(0, 0, -0.13)` ซึ่งเป็นค่าที่ตั้งไว้
ตั้งแต่ตอนยังไม่มีห้อง/เก้าอี้จริง พอย้ายโต๊ะไปชิดผนังเหนือ (`desk.Position` เปลี่ยนเป็น `-ROOM_HALF + 3`) แล้วเก้าอี้
อยู่ฝั่ง `+Z` จากโต๊ะ ค่า `-0.13` (ฝั่ง `-Z`) กลายเป็นแปะจอไว้ด้าน**หันเข้ากำแพง**แทนที่จะหันเข้าหาเก้าอี้ — สิ่งที่เห็น
เป็นสี่เหลี่ยมมืดคือด้านหลังกล่อง `Monitor` (สี Metal เข้ม) ไม่ใช่ตัวจอเลย
บทเรียน: ทุกครั้งที่ขยับตำแหน่งวัตถุอ้างอิง (เช่นย้ายโต๊ะ) ต้องเช็ค offset ของ sub-part ที่คำนวณสัมพัทธ์กับมันทั้งหมดด้วย
ไม่ใช่แก้แค่จุดที่ขยับ

**วิธีแก้**: สลับเครื่องหมายเป็น `monitor.Position + Vector3.new(0, 0, 0.13)` (ฝั่ง `+Z` ตรงกับฝั่งที่เก้าอี้อยู่) ที่
`src/server/WorldObjects.luau` — ปัญหานี้เป็น **server-side geometry** ไม่ใช่ client-side Face/camera เลย ต่อไปถ้า
เจอ SurfaceGui ไม่ขึ้น/หันผิดด้าน ให้เช็คตำแหน่งจริงของ part ก่อนไปแก้ Face/camera

## จอมอนิเตอร์ใหญ่จมลงไปในโต๊ะ

**อาการ**: ทดสอบจอ 3 ขนาด (เล็ก/กลาง/ใหญ่) จอ "ใหญ่" มองจากมุมกล้องแล้วเห็นขอบล่างจมลงไปในเนื้อโต๊ะ ทั้งที่จอเล็ก/กลาง
ไม่มีปัญหา

**สาเหตุ**: `monitor.Position` เดิม hardcode offset จากโต๊ะตายตัวค่าเดียว (`desk.Position + Vector3.new(0,2.6,-1.2)`)
ใช้ร่วมกันทุกขนาดจอ ไม่ได้คำนวณจากความสูงจอจริง พอจอสูงขึ้น (ใหญ่ขึ้น) ขอบล่างของจอก็ขยับลงต่ำกว่าค่า offset คงที่
จนต่ำกว่าขอบบนโต๊ะ (`desk.Position.Y + desk.Size.Y/2`) กลายเป็นจมเข้าเนื้อโต๊ะ

**วิธีแก้**: คำนวณตำแหน่ง Y ของจอจาก `deskTopY + monitorHeight/2 + ระยะยกเล็กน้อย` แทน offset ตายตัว ที่
`src/server/WorldObjects.luau` (`createComputerStation`) — ตรงกับกฎใหม่ "ห้าม hardcode ค่าตำแหน่งที่คำนวณจาก
วัตถุจริงได้" ใน CLAUDE.md

## นั่งเก้าอี้แล้วตัวละครตัวเองบังจอ (โดยเฉพาะจอใหญ่)

**อาการ**: นั่งเก้าอี้แล้วกล้องขยับเข้าไปมองจอ แต่เห็นเงาดำของตัวละครตัวเอง (หัว/แขน/ขา) บังจอบางส่วนหรือทั้งหมด
พบเยอะสุดตอนทดสอบจอ "ใหญ่"

**สาเหตุ**: กล้องคำนวณระยะจาก monitor เพื่อให้พอดีจอผู้เล่น (`lookAtScreen`) โดยไม่รู้ว่าตัวละครนั่งอยู่ตรงไหน — จอใหญ่
ต้องการระยะกล้องมาก บวกกับระยะเก้าอี้-จอที่ตายตัว (ไม่ขยับตามขนาดจอ) ทำให้ระยะที่กล้องต้องการเกินระยะเก้าอี้ไปเลย
กล้องเลยไปโผล่ "หลัง" ตัวละคร (ตัวละครอยู่ระหว่างกล้องกับจอ) ลองแก้ด้วยการขยับเก้าอี้ให้ไกลขึ้นตามขนาดจอก่อน ได้ผลจริง
แต่เปลี่ยน layout ทุกครั้งที่จอขยับขนาด (เช่นตอน gear upgrade ในเกม) ยุ่งยาก

**วิธีแก้ที่ใช้จริง**: ไม่ไปยุ่งกับระยะ/ตำแหน่งเลย แต่ทำให้ตัวละครโปร่งใส **เฉพาะฝั่งเราเห็น** (`BasePart.
LocalTransparencyModifier = 1`) ตอนนั่งเก้าอี้ กลับเป็นปกติ (`= 0`) ตอนลุก — คนอื่นในเซิร์ฟเวอร์ยังเห็นเรานั่งเก้าอี้ปกติ
แก้ที่ `src/client/init.client.luau` (`setCharacterLocalVisible`) วิธีนี้แก้ปัญหาถาวรไม่ว่าจอจะใหญ่แค่ไหนในอนาคต
ไม่ต้องคำนวณ/ปรับ layout ซ้ำอีกเลย — ถ้าเจอปัญหา "ตัวละครบังของที่กล้องต้องมองใกล้ๆ" อีก ให้นึกถึงวิธีนี้ก่อนไปแก้
ตำแหน่ง/ระยะ
