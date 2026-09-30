# agent — PC Controller Agent (Windows)

โปรแกรม Windows ตัวเล็กที่รันบนคอมที่ต้องการควบคุม ทำสิ่งที่ ESP32 ทำไม่ได้: ปิดคอมแบบสุภาพตามเวลา
(มีหน้าต่างนับถอยหลังให้ยกเลิก/เลื่อน) และเปิด-ปิดโปรแกรมที่เลือกไว้ คุยกับแอปมือถือผ่าน MQTT
(`broker.emqx.io`) ตัวเดียวกับที่ ESP32 ใช้ — ไม่ต้องเปิดพอร์ต ไม่มี server

## ติดตั้ง (ทำครั้งเดียว ทุกครั้งที่ลง Windows ใหม่/เปลี่ยนคอม)

1. ดาวน์โหลด `PcControllerAgent.exe` — จาก GitHub → repo `dev-workspace` → **Actions** → run ล่าสุดของ
   "pc-controller agent (Windows .exe)" → Artifacts → `PcControllerAgent` (หรือ **Releases** ถ้าติด tag
   `pc-agent-vX.Y.Z` ไว้ — ดูด้านล่าง) ต้องล็อกอิน GitHub เพราะ repo เป็น private
2. ดับเบิลคลิก — Windows SmartScreen จะเตือน "unknown publisher" (ไม่ได้ซื้อ code-signing certificate)
   กด **More info → Run anyway** ครั้งเดียว
3. โปรแกรมถามว่า "ติดตั้งไว้ในเครื่องนี้และให้เริ่มพร้อม Windows ไหม?" → **Yes**
   (คัดลอกตัวเองไปที่ `%LocalAppData%\PcControllerAgent\` และตั้ง autostart — ไฟล์ที่โหลดมาลบทิ้งได้)
4. หน้าต่างหลักขึ้นมา กด **คัดลอก** ที่ "รหัสเชื่อมต่อ" แล้วไปวางในแอปมือถือ → เมนู "เชื่อมต่อกับคอม"
   แอปจะขึ้น "เชื่อมต่อ agent แล้ว"
5. ตั้ง auto-login ของ Windows ถ้าอยากให้คอมที่เปิดเองตามเวลาเข้าเดสก์ท็อปและเปิดโปรแกรมได้เองโดยไม่ต้องพิมพ์รหัส
   (`Win+R` → `netplwiz` → เอาติ๊ก "Users must enter a user name and password" ออก)

อัปเดตเวอร์ชันใหม่: ดับเบิลคลิก `.exe` ตัวใหม่ → เลือก Yes ตอนถาม "อัปเดต" (ปิดตัวเก่าให้เอง ค่าตั้งและรหัสเดิมยังอยู่)

กด X ที่หน้าต่าง = ย่อไปไอคอนข้างนาฬิกา (ยังทำงานอยู่) · ออกจริงๆ = คลิกขวาที่ไอคอน → "ออกจากโปรแกรม"

## รหัสเชื่อมต่อ

สร้างอัตโนมัติครั้งแรกและ **คงเดิมจนกว่าจะกด Reset token** เก็บที่ `%AppData%\PcControllerAgent\config.json`
รหัสยาว 40 ตัวอักษร hex = `agentId` 8 ตัว (ใช้เป็นชื่อ topic) + `token` 32 ตัว (กุญแจเข้ารหัส **ไม่เคยส่งผ่าน broker**)
ทุกข้อความระหว่างมือถือกับ agent เข้ารหัส AES-256-GCM ด้วย token — broker สาธารณะเห็นแต่ข้อมูลอ่านไม่ออก
และคนที่ไม่มี token สั่งอะไร agent ไม่ได้ (ดู [../PROTOCOL.md](../PROTOCOL.md))

## ทำงานอย่างไร

- **ปิดคอมตามเวลา**: ถึงเวลา → หน้าต่างนับถอยหลังเด้งอยู่หน้าสุด (ค่าเริ่มต้น 60 วิ ตั้งได้จากมือถือ)
  - กด "เลื่อน 15/30 นาที" → ถามใหม่ตามเวลานั้น · "ข้ามวันนี้" → ไม่ปิดของวันนี้
  - ไม่มีใครกด → ปิดโปรแกรมที่เลือกไว้ (ขอปิดแบบสุภาพก่อน รอสูงสุด 15 วิ ตัวไหนไม่ยอมปิดค่อยบังคับปิด)
    แล้วสั่ง `shutdown /s /f /t 5` (`/f` = ปิดทุกอย่างที่เหลือ กัน Windows ค้างที่หน้าจอ "แอปนี้ขวางการปิดเครื่อง" ทั้งคืน)
  - ไม่มีการตรวจ idle ตั้งใจ (เผื่อกำลังดูหนังโดยไม่แตะเมาส์) — เด้งถามทุกครั้ง
  - เริ่มนับเฉพาะภายใน 10 นาทีหลังเวลาที่ตั้ง — เปิดคอมตอน 21:00 จะไม่ถูกปิดทันทีเพราะตารางเวลา 18:00
- **เปิดโปรแกรมตอนคอมบูต**: เฉพาะตอนที่ Windows เป็นคนเปิด agent (autostart) — รอ 20 วิให้เดสก์ท็อปพร้อม แล้วเปิด
  ทีละตัวตามลำดับ เว้น 10 วิ ข้ามตัวที่เปิดอยู่แล้ว
- **รายการโปรแกรม**: agent สแกน Start Menu + โปรแกรมที่เปิดอยู่ส่งขึ้นไปให้แอปเลือก (แอปรู้แค่ id + ชื่อ
  path อยู่ในเครื่องเท่านั้น → ข้อความจาก broker สั่งรันคำสั่งมั่วๆ ไม่ได้)
- **หยุดชั่วคราว**: สวิตช์เดียวบนแอปมือถือหยุดทั้งเวลาเปิด (ESP32) และเวลาปิด (agent) — ไม่กระทบการเปิดโปรแกรมตอนบูต
- **แจ้งเตือน Discord**: ผ่าน ESP32 (agent ไม่มี webhook เอง) — ปิดคอมตามเวลา, มีคนกดเลื่อน/ข้าม,
  เปิดโปรแกรมไม่ขึ้น, ปิดโปรแกรมไม่ลง

## สำหรับนักพัฒนา

ต้องมี .NET 8 SDK

```bash
cd agent
dotnet build -c Release
# ทดสอบตรรกะล้วน (crypto/ตาราง/สแกน) ผลอยู่ใน selftest.txt, exit code 0 = ผ่านทั้งหมด
bin/Release/net8.0-windows/PcControllerAgent.exe --selftest --data-dir %TEMP%/pcc-selftest
# รันแบบไม่ทำอะไรจริง (ไม่เปิด/ปิดโปรแกรม ไม่ shutdown, ข้ามขั้นตอนติดตั้ง) แยก config ออกจากของจริง
bin/Release/net8.0-windows/PcControllerAgent.exe --dry-run --data-dir %TEMP%/pcc-dry --demo-countdown
# สร้าง .exe ไฟล์เดียว (self-contained ~63 MB)
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o bin/publish
```

⚠️ **อย่ารัน `.exe` เปล่าๆ (ไม่ใส่ `--dry-run`) ตอนทดสอบ** — ถ้ารันจากที่อื่นนอก `%LocalAppData%\PcControllerAgent` มันจะถามติดตั้ง
ตัวจริงและตั้ง autostart ลง registry

Flag: `--tray` (Windows ใส่ให้ตอน autostart: ซ่อนหน้าต่าง + เปิดโปรแกรมตอนบูต) · `--dry-run` · `--data-dir <dir>` ·
`--no-install` · `--selftest [--vector f.json]` · `--demo-countdown`

cross-check crypto กับแอปมือถือ (CI ทำให้ทุกครั้ง): `node ../scripts/crypto-vector.mjs make <dir>` →
`--selftest --vector <dir>/vector.json --data-dir <dir>` → `node ../scripts/crypto-vector.mjs verify <dir>`

ออก release: ติด tag `pc-agent-v1.0.0` แล้ว push → workflow
[`pc-controller-agent-release.yml`](../../.github/workflows/pc-controller-agent-release.yml) แนบ `.exe` ไว้ที่ GitHub Releases
