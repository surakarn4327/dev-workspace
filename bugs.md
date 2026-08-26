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

