# learn-godot

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

โปรเจกต์ฝึกเรียน Godot (GDScript) ตั้งแต่พื้นฐานจนพาทำ tutorial จริง เป้าหมายปลายทางคือทำ
**ระบบจำลองลานจอดรถ (parking lot simulation)** — สร้าง scene แทนลานจอด, node แทนช่องจอด,
sensor (Area2D/Area3D) ตรวจจับรถเข้า/ออก, LED (Sprite/MeshInstance เปลี่ยนสี) แสดงสถานะ
ช่องว่าง/เต็ม, และ Control node จำลอง UI เครื่องสแกนบัตรจอด เขียน logic ด้วย GDScript
แบบ event-driven (signal เช่น `body_entered`, `body_exited`, ปุ่ม UI `pressed`)

โปรเจกต์นี้เปิดผ่าน **Godot Editor** ไม่ใช่ dev server ในเทอร์มินัล/เบราว์เซอร์แบบเว็บ
(ข้อ 7 ของธรรมนูญ "รัน dev server ผ่าน Browser pane" ไม่ใช้กับโปรเจกต์นี้)

## คำสั่งที่ใช้จริง

```bash
# เปิดโปรเจกต์: เปิด Godot Editor → Import → เลือกไฟล์ project.godot ใน C:\dev\learn-godot
# รัน/ทดสอบ: กด Play (F5) ใน Godot Editor โดยตรง (ไม่มีคำสั่ง CLI แยก)
# build/export: Godot Editor → Project > Export
```

ต้องติดตั้ง **Godot Engine** ก่อน (โหลดฟรีจาก godotengine.org, opensource ไม่ผูกบัตร,
ไม่ต้องสมัคร account) เลือกเวอร์ชัน **Godot 4.x** (stable ล่าสุด) — ใช้ GDScript ได้ในตัว
ไม่ต้องติดตั้งอะไรเพิ่ม

## โครงสร้าง

โครงสร้างมาตรฐานของ Godot project (เกิดอัตโนมัติตอนสร้าง project ใหม่ใน Godot Editor):

```
learn-godot\
├── project.godot   ← ไฟล์ config หลักของโปรเจกต์ (Godot สร้างให้ตอนเปิดครั้งแรก)
├── scenes\         ← ไฟล์ .tscn (ฉากที่ประกอบ node: ลานจอด, ช่องจอด, sensor, LED, UI)
└── scripts\        ← ไฟล์ .gd (logic แบบ event: ParkingSensor.gd, LedIndicator.gd,
                       CardScannerUI.gd)
```

`project.godot` ต้องอยู่ที่ root ของโฟลเดอร์นี้เท่านั้น (Godot Editor สร้างให้เองตอน import
ครั้งแรก ถ้ายังไม่มีไฟล์นี้ แปลว่ายังไม่ได้เปิดผ่าน Godot Editor)

## กฎเฉพาะของโปรเจกต์นี้

- ไฟล์ที่ Godot สร้างอัตโนมัติ (`.godot\`, `.import\`, `export_presets.cfg` ถ้ามี secret)
  ต้อง ignore — ห้าม commit (regenerate ได้เสมอ)
- ตั้งชื่อ scene/script เป็นภาษาอังกฤษสื่อความหมาย (`ParkingSensor.gd`, `LedIndicator.gd`,
  `CardScannerUI.gd`) — คอมเมนต์ในโค้ดอังกฤษ, README/บันทึกไทยได้
- โปรเจกต์นี้เป็น **project ฝึกเรียน** เน้นความเข้าใจทีละสเต็ป มากกว่าโครงสร้างโปรดักชัน
  ไม่ต้อง over-engineer (ไม่ต้องทำ autoload/singleton ซับซ้อนตั้งแต่แรก)
