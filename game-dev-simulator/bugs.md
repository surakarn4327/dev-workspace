# bugs.md — game-dev-simulator

Log บั๊กจริงทุกครั้งที่แก้ (ไม่ใช่แค่ปรับ scope/feature ใหม่) ตามกฎ `C:\dev\CLAUDE.md` หมวด 3

ต่อ 1 บั๊ก บันทึก:
1. **ชื่อ/อาการ** — สั้นๆ ว่าเจออะไรผิดปกติ
2. **สาเหตุ** — root cause จริง ไม่ใช่แค่ "แก้ตรงไหน"
3. **วิธีแก้** — แก้ยังไง อ้างไฟล์/บรรทัด/commit ถ้ามี

---

## 2026-08-28 — Roblox_Studio MCP server เชื่อมไม่ได้ (tool ไม่โผล่ใน session)

1. **อาการ** — เพิ่ม MCP server `Roblox_Studio` ใน config แล้ว (ชี้ไปที่
   `%LOCALAPPDATA%\Roblox\mcp.bat`) restart Claude Code desktop กี่รอบ tool ก็ไม่โผล่มาให้เรียกใช้เลย
2. **สาเหตุ** — `mcp.bat` ที่ Roblox ติดตั้งเองมี syntax error: บรรทัด `else` แยกบรรทัดจาก `)` ที่ปิด
   if-block ก่อนหน้า (`if exist (...)` จบบรรทัดตัวเอง แล้ว `else (...)` มาบรรทัดถัดไป) — cmd.exe ต้องการ
   `) else (` อยู่บรรทัดเดียวกันถึงจะ parse if/else แบบหลายบรรทัดถูก ทำให้รันแล้ว error
   `'else' is not recognized as an internal or external command` ตัว MCP client (Claude Code) เห็น
   process ตายเลยไม่โหลด tool ให้ (ทดสอบมือ: รัน `cmd.exe /c "cd /d %LOCALAPPDATA%\Roblox && .\mcp.bat"`
   ตรงๆ เห็น error นี้ชัดเจน)
3. **วิธีแก้** — เลี่ยงตัว `mcp.bat` ที่พัง แก้ config ให้เรียก `StudioMCP.exe` ตรงๆ แทน (path จริงที่เจอ:
   `C:\Users\OH\AppData\Local\Roblox\Versions\version-268c7d941ba34c1a\StudioMCP.exe`) แก้ที่
   `C:\Users\OH\.claude.json` → `projects."C:/dev/game-dev-simulator".mcpServers.Roblox_Studio`
   **ข้อควรระวัง**: path นี้มี version folder ผูกกับ Studio build ปัจจุบัน ถ้า Roblox Studio update
   version folder จะเปลี่ยนชื่อ ต้องไปแก้ path ใหม่อีกครั้ง (เช็คด้วย `reg query
   HKEY_CURRENT_USER\Software\Roblox\RobloxStudio /v ContentFolder` หรือดูโฟลเดอร์ล่าสุดใน
   `%LOCALAPPDATA%\Roblox\Versions\`)

## 2026-08-28 — City template ขาด PlayerModule → เดิน/กระโดด/ขับรถไม่ได้เลยทั้งเกม

1. **อาการ** — ผู้ใช้ทดสอบเองใน Studio จริง: นั่งรถแล้วกด WASD รถไม่ขยับ, กด Space กระโดดออกจากรถไม่ได้
   (ตัวติดอยู่ในรถ เดินไม่ได้), กด E ซ้ำเพื่อออกกลับเด้งไปนั่งเองอีกรอบ
2. **สาเหตุ (แก้ไขจากที่เข้าใจผิดตอนแรก)** — `game.StarterPlayer.StarterPlayerScripts` ไม่มี
   `PlayerModule` เลย (ModuleScript มาตรฐานที่ Roblox ใส่ให้ทุก place ใหม่ปกติ คุมทั้งกล้อง **และ**
   input WASD/Space ของ humanoid ทั้งระบบ ผ่าน `ControlModule`) — เข้าใจผิดตอนแรกว่ากระทบแค่
   speedometer GUI เพราะเทสด้วย `Chassis.UpdateThrottle` ตรงๆ (ข้าม Driver script ทั้งหมด) แล้วเห็นรถวิ่งได้
   เลยสรุปผิดว่าไม่กระทบ ที่จริง `Sedan.Scripts.LocalVehicleGui` เรียก
   `LocalPlayer.PlayerScripts:WaitForChild("PlayerModule")` ที่ **module-level** (บรรทัด 11 นอกฟังก์ชัน)
   — พอ `Driver` LocalScript เรียก `require(LocalVehicleGui).new(Car)` (บรรทัด 21) มันค้างตรงนั้นทันที
   **ก่อน**จะไปถึงส่วนผูกปุ่ม `ContextActionService:BindAction` (บรรทัด 118+) เลย ทำให้ WASD ในรถใช้ไม่ได้
   จริง และเพราะ `PlayerModule/ControlModule` หายทั้งระบบ การเดิน/กระโดดปกตินอกรถก็ใช้ไม่ได้เช่นกัน
   (Space ไม่มี script แปลง input เป็น `Humanoid.Jump`) — อธิบายอาการ "ติดอยู่ในรถ" ได้ตรงเป๊ะ เพราะออกจาก
   เบาะกลายเป็น standing เฉยๆ ที่ขยับไม่ได้ (ไม่ใช่ bug ของระบบ seat exit)
3. **วิธีแก้** — ดึง `PlayerModule` (ครบทุกไฟล์ CameraModule + ControlModule + CommonUtils, 43 instances)
   จาก source จริงที่ Roblox Studio ติดตั้งไว้ในเครื่องเอง (
   `%LOCALAPPDATA%\Roblox\Versions\<version>\ExtraContent\scripts\PlayerScripts\StarterPlayerScripts\PlayerModule.module*`
   — เป็น default content ที่ Studio ใช้ตอนสร้าง place ใหม่ปกติ ไม่ใช่ของ mod) กลับเข้า
   `StarterPlayer.StarterPlayerScripts` **วิธี transfer**: เขียนไฟล์เป็น JSON tree (name/className/
   source/children) แล้วเปิด local HTTP server (Node, `127.0.0.1:8973`) ให้ฝั่ง Studio
   (`HttpService:GetAsync`, เปิด `HttpEnabled = true` ชั่วคราวแล้วปิดกลับหลังใช้เสร็จ) ดึง JSON ไปสร้าง
   Instance เองฝั่ง Luau (`HttpService:JSONDecode` + recursive `Instance.new`) — เลี่ยงการ paste source
   ทีละไฟล์ผ่าน tool call ที่กิน token มหาศาล (ลองแบบ base64 chunk ผ่าน `execute_luau` โดยตรงก่อน แต่
   อ่านไฟล์ chunk กลับมาผ่าน context ตัวเองแพงเกินไป เปลี่ยนมาใช้ local HTTP แทนสำเร็จ)
   ทดสอบยืนยันแล้ว: นั่งรถไม่มี warning ค้างอีก, `ContextActionService:GetAllBoundActionInfo()` มีทั้ง
   `VehicleChassisRawInput`, `moveForwardAction` ฯลฯ ครบ, ออกจากเบาะ (`seat:Sit(nil)`) สำเร็จไม่ error
   **ยังไม่ได้ทดสอบด้วยคีย์บอร์ดจริงจากผู้เล่น** (MCP simulate keyboard ไม่ถึง real input focus ตามที่เจอ
   ก่อนหน้า) รอผู้ใช้ยืนยันในเกมจริงอีกที

## 2026-08-29 — ปุ่ม E เข้า apartment หายไป (`ServerScriptService.ApartmentDoorController`)

1. **อาการ** — ผู้ใช้รายงาน "ปุ่ม E เข้า apartment หายไปอีกแล้ว" ทดสอบยืนหน้าประตู
   `33_BLDG.Bldg_Doors.Bldg_Door_B_Panel` ไม่มี ProximityPrompt ให้กด E เลย
2. **สาเหตุ** — `Workspace.PocketRooms.PlayerApartment.ExitDoorPanel` (ประตูทางออกฝั่งในห้อง) หายไปทั้ง
   instance (ถูกลบตอนไหนไม่ทราบ — ไม่มี log) สคริปต์เข้าถึงด้วย dot index (`apt.ExitDoorPanel`) ซึ่ง throw
   error ทันทีถ้า child ไม่มีจริง (ต่างจาก `WaitForChild`/`FindFirstChild` ที่ fail แบบนุ่มนวลกว่า) —
   error เกิดที่บรรทัด 7 **ก่อน**โค้ดสร้าง enter prompt (บรรทัดหลังจากนั้น) จะรันเลย ทำให้ script ตายทั้งฟังก์ชัน
   ตั้งแต่ต้น: enter prompt (ประตูหน้า, คนละ object กับ exit door) ก็เลยไม่ถูกสร้างไปด้วย — บั๊ก 2 อาการ
   (เข้าไม่ได้ + ออกไม่ได้) จริงๆ เป็นสาเหตุเดียวกัน เพราะโค้ดผูก 2 ปุ่มไว้ในสคริปต์เดียวแบบ fail-together
3. **วิธีแก้** — คำนวณช่องเปิดประตูจาก wall parts จริงที่ยังอยู่ (`Wall_NegZ_Left`/`Wall_NegZ_Right`/
   `Wall_NegZ_Top`/`Floor` — ช่องว่างระหว่างกำแพงซ้าย/ขวา/บนคือกรอบประตูเดิม) สร้าง Part
   `ExitDoorPanel` ใหม่ตรงตำแหน่ง/ขนาดที่คำนวณได้ (ไม่เดาตัวเลข) แล้วแก้ `ApartmentDoorController`
   ให้สร้าง enter prompt กับ exit prompt **แยกอิสระจากกัน** (exit door หาไม่เจอก็แค่ `warn` ข้าม ไม่ทำให้
   enter prompt พังตาม) กัน pattern เดิมเกิดซ้ำ — ถ้ามีใครลบ/ย้าย object ในอนาคตอีก อย่างน้อยประตูหน้าไม่พังตาม
   **ข้อควรระวัง**: ถ้าใครแก้/ลบเฟอร์นิเจอร์ในห้อง `PlayerApartment` ต้องเช็คว่าไม่ได้ลบ `ExitDoorPanel`
   ไปด้วยโดยไม่ตั้งใจ (ไม่มี error indicator ชัดเจนใน Studio Explorer ว่ามันหายไปแล้ว ต้องดู Output log ตอน
   play ถึงจะเห็น)

## 2026-08-29 (รอบ 2) — ประตูในห้อง apartment "หายไป" อีกรอบ หลังแก้บั๊กก่อนหน้า

1. **อาการ** — ผู้ใช้รายงานประตูในห้องหายไปอีก สงสัยว่าโดนทับ
2. **สาเหตุ** — เป็นบั๊กที่ Claude สร้างเองตอนแก้บั๊กรอบก่อน (2026-08-29 รอบแรก): ตอนนั้นสร้าง
   `ExitDoorPanel` ขึ้นใหม่เป็น Part สีเทาทึบ (`Material = Concrete`, `Transparency = 0`, `CanCollide = true`)
   เพื่อแทนประตูที่ "หาย" — แต่จริงๆ ประตูจริงไม่ได้หาย มันคือ `Workspace.RealisticDoorPack.Door` (asset
   ที่มี `Handler` script แกว่งเปิด-ปิดพร้อมเสียงอยู่แล้ว) ซึ่งอยู่ตำแหน่งเดียวกับช่องเปิดนั้นพอดี
   (`GetPivot()` ตรงกับตำแหน่งที่คำนวณจาก wall parts เป๊ะ) — กล่องคอนกรีตทึบที่สร้างใหม่เลย**ทับบัง
   ประตูจริงจนมองไม่เห็น** ผู้ใช้เข้าใจว่าประตูหาย ทั้งที่จริงมันอยู่ข้างหลังกล่องเทานั่นเอง
   **บทเรียน**: ตอน "restore" object ที่คิดว่าหาย ต้องเช็คก่อนว่ามันหายจริงมั้ย หรือมันอยู่ที่อื่นในลำดับชั้น
   ที่คนละ path (ตอนนั้น grep คำว่า "door" จำกัดแค่ path `Workspace.PocketRooms.PlayerApartment` เท่านั้น
   เลยไม่เจอ `RealisticDoorPack` ที่อยู่คนละ folder ทั้งที่ตำแหน่งจริงในโลกทับกัน)
3. **วิธีแก้** — ไม่ลบ `ExitDoorPanel` (ยังใช้เป็นจุด attach ProximityPrompt สำหรับ teleport ออกจาก pocket
   dimension เพราะประตูจริงเป็นแค่ physical door ไม่ได้ทำ teleport) แต่เปลี่ยนให้เป็น**โซนล่องหน**แทน:
   `Transparency = 1`, `CanCollide = false` แล้วแก้ `ApartmentDoorController` (`src/server/
   ApartmentDoorController.server.luau`) ให้ exit prompt ตั้ง `RequiresLineOfSight = true` แทน `false`
   เดิม — ผลคือผู้เล่นต้องเปิดประตูจริงก่อน (กด E ที่ `Door.Handle` ให้ Handler แกว่งบาน) ถึงจะมองทะลุไปเจอ
   ExitDoorPanel ล่องหนแล้วกด E "Exit" อีกทีเพื่อเทเลพอร์ตออกไปถนนจริงได้ — สมจริงขึ้นด้วย (ต้องเปิดประตูก่อนจะ
   ออกไปได้ ไม่ใช่เดินทะลุกำแพงโปร่งไปเฉยๆ)
   **สังเกตเพิ่ม**: เจอ `Workspace.RealisticDoorPack` มี 2 folder ชื่อซ้ำกันใน Workspace (อันหนึ่งมีแค่ readme
   script อันหนึ่งมี Door model จริง) ยังไม่ได้ลบ/รวมอันไหน เพราะไม่ชัดว่าเป็นของตั้งใจทิ้งไว้หรือ insert ซ้ำ
   โดยไม่ตั้งใจ — รอผู้ใช้ยืนยันก่อนแตะ

## 2026-08-29 (รอบ 3) — Fixed avatar ที่ล็อกไว้กลายเป็นตัว "noob" เหลี่ยมๆ สีเหลือง/น้ำเงิน ไม่ใช่ตัวเทาเรียบ

1. **อาการ** — ผู้ใช้เอา Rig (R15 เรียบๆ สีเทาเดียวกันทั้งตัว ไม่มีหน้า) มาวางโชว์ในห้อง ขอให้ใช้หน้าตานี้เป็น
   fixed avatar แต่พอเข้าเกมจริงตัวละครกลับเป็นบล็อกสี่เหลี่ยมเหลือง/น้ำเงินมาตรฐานของ Roblox (ตัว "noob"
   คลาสสิก) หน้าตาไม่เหมือน Rig ที่โชว์ไว้เลย
2. **สาเหตุ** — ตอนแรกใช้ `player:LoadCharacterWithHumanoidDescription(FIXED_DESCRIPTION)` โดยตั้ง
   `FIXED_DESCRIPTION.BodyTypeScale = 0` คิดว่าจะได้ตัวเรียบไม่มีลวดลาย — แต่ระบบ body-type blending ของ
   Roblox (`ApplyDescription`/`LoadCharacterWithHumanoidDescription`) ไม่เสถียร: ตรวจสอบ humanoid จริงหลัง
   spawn เจอว่า `BodyTypeScale` กลายเป็น `0.3` เอง (ไม่ตรงกับที่ตั้ง) และได้ mesh ชุด asset id ขึ้นต้นด้วย
   `743...` ซึ่งคือชุด mesh "default fallback" ของ Roblox เวลา HumanoidDescription ไม่มี custom
   BodyColors/clothing/BodyTypeScale ที่ชัดเจนพอ — กลายเป็นตัว noob บล็อกสีเหลือง/น้ำเงินไปเลย ทั้งที่ Rig
   ต้นแบบที่ผู้ใช้วางโชว์ (สร้างจาก Rig Builder plugin ตรงๆ ไม่ผ่าน `ApplyDescription` เลย) มี
   `BodyTypeScale = 0` เท่ากันแต่ได้ mesh ชุด `865...` (เรียบ สีเทาเดียวกันทั้งตัว) แทน — สรุปคือ
   **ตัวเลข `BodyTypeScale` เดียวกันให้ mesh คนละชุดได้ ขึ้นกับว่าผ่าน `ApplyDescription` มาหรือเปล่า**
   เชื่อ `HumanoidDescription` ในการควบคุมหน้าตาแบบละเอียดไม่ได้ 100%
3. **วิธีแก้** — เลิกใช้ `HumanoidDescription` ทั้งหมด เปลี่ยนเป็น**ย้าย Rig ต้นแบบที่ผู้ใช้อนุมัติเข้า
   `ServerStorage.PlayerCharacterTemplate` แล้ว `:Clone()` ตรงๆ ทุกครั้งที่ spawn/respawn** ใน
   `src/server/FixedAvatarController.server.luau` — วิธีนี้ไม่ผ่านระบบ body-type blending เลย ได้ mesh/สี
   ตรงกับต้นแบบเป๊ะ 100% ทดสอบยืนยันแล้ว: `torsoMeshId` ตรงกับ template, screenshot ตัวละครในเกมออกมาสีเทา
   เรียบเหมือนต้นแบบ ไม่มี error ใน console
   **บทเรียน**: ถ้าต้องการ fixed appearance ที่ต้อง "เหมือนเป๊ะ" กับของอ้างอิงที่มีอยู่แล้วในโลกเกม ให้ clone
   object นั้นตรงๆ ดีกว่าลองสร้างใหม่ผ่าน API ระดับสูงอย่าง `HumanoidDescription` ที่มี behavior ซ่อนอยู่
   ควบคุมไม่ได้ 100%

## 2026-08-29 (รอบ 4) — ผู้เล่น spawn กลางแมพ ไม่ใช่หน้า apartment

1. **อาการ** — ผู้ใช้รายงานว่าตัวละคร spawn ไม่ตรงหน้า apartment เหมือนควรจะเป็น
2. **สาเหตุ** — บั๊กที่ Claude สร้างเองตอนเขียน `FixedAvatarController` (รอบก่อนหน้า): ฟังก์ชัน
   `findSpawnCFrame()` หา spawn ด้วย `workspace:FindFirstChildOfClass("SpawnLocation")` ซึ่งมองแค่
   **direct child ของ Workspace เท่านั้น** ไม่ไล่ลงไปใน model ที่ซ้อนอยู่ (`FindFirstChildOfClass` ไม่มี
   recursive parameter) แต่ `SpawnLocation` จริงอยู่ที่ `Workspace.City_Template.SpawnLocation` (ซ้อนอยู่ใน
   model `City_Template`) — หาไม่เจอ เลยตกไปใช้ fallback `CFrame.new(0, 10, 0)` แทนตลอดเวลา ทำให้ผู้เล่น
   ไปโผล่กลางแมพ (ใกล้ origin) แทนที่จะเป็นหน้าตึก apartment ตามที่คนสร้างแมพวางจุด spawn ไว้จริง (พิกัด
   spawn จริง `(351, 2.25, 47)` อยู่ใกล้ประตูตึก apartment `(351, 13, 33)`)
3. **วิธีแก้** — เปลี่ยนเป็น `workspace:FindFirstChild("SpawnLocation", true)` (พารามิเตอร์ที่สองคือ
   `recursive = true`) เพื่อไล่ค้นทุกระดับ ไม่ใช่แค่ direct child — ทดสอบยืนยันแล้ว character spawn ตรง
   ตำแหน่ง SpawnLocation จริงเป๊ะ
   **บทเรียน**: `FindFirstChild(name)` มี optional param ตัวที่สองสำหรับ recursive search แต่
   `FindFirstChildOfClass`/`FindFirstChildWhichIsA` **ไม่มี** พารามิเตอร์แบบนี้ — ถ้าจะหา instance ตาม
   class/type แบบไล่ทุกชั้น ต้องเขียน loop เอง (เช่น `GetDescendants()` แล้ว filter ด้วย `:IsA()`) จะปลอดภัย
   กว่าเดาว่ามันมี recursive mode ให้

## 2026-08-29 (รอบ 5) — คลิกขวาลากหมุนกล้องใน Studio Edit mode ไม่ได้

1. **อาการ** — ผู้ใช้รายงานว่าอยู่ๆ คลิกขวาค้างลากเพื่อหมุนกล้องใน viewport ของ Studio (Edit mode) ใช้ไม่ได้
   เลย ทั้งที่ก่อนหน้านี้ปกติดี
2. **สาเหตุ** — Claude เป็นคนทำเอง: ใช้ tool `screen_capture` พร้อม `camera_position`/`look_at_position`
   เพื่อถ่ายภาพมุมที่ต้องการ ซึ่งเบื้องหลัง tool นี้ตั้ง `workspace.CurrentCamera.CameraType =
   Enum.CameraType.Scriptable` ชั่วคราวเพื่อ pin กล้องตามพิกัดที่สั่ง แล้วปกติจะ reset กลับให้เอง — แต่มีครั้ง
   หนึ่งที่ call `screen_capture` timeout (error "Request timed out") กลางทาง ทำให้ขั้นตอน reset
   `CameraType` กลับเป็นปกติไม่ได้รัน กล้อง Studio เลยค้างอยู่ใน `Scriptable` mode ต่อเนื่องข้ามไปอีก session
   หนึ่ง (`Scriptable` คือโหมดที่ปิดการควบคุมกล้องด้วย mouse/keyboard ปกติทั้งหมด เพราะออกแบบมาให้ script
   คุมกล้องเองในเกม ไม่ใช่สำหรับ Studio edit camera)
3. **วิธีแก้** — เช็ค `workspace.CurrentCamera.CameraType` ผ่าน `execute_luau` เจอว่าเป็น `Scriptable` จริง
   สั่ง `cam.CameraType = Enum.CameraType.Custom` กลับ คลิกขวาลากหมุนกล้องกลับมาใช้ได้ปกติทันที
   **ข้อควรระวังสำหรับ Claude ในอนาคต**: ทุกครั้งที่ใช้ `screen_capture` พร้อม
   `camera_position`/`look_at_position` แล้วเจอ error/timeout ระหว่างทาง ต้องเช็ค
   `workspace.CurrentCamera.CameraType` ทันทีว่าค้างเป็น `Scriptable` มั้ย แล้วรีบสั่งกลับเป็น `Custom`
   เอง ไม่ต้องรอผู้ใช้มาถามว่าทำไมกล้องพัง
