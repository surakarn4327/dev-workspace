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

