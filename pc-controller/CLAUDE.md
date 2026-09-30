# pc-controller

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

คุมเปิด-ปิดคอมจากมือถือผ่าน ESP32+relay พร้อมเช็คสถานะและแจ้งเตือน — ดูสถาปัตยกรรมเต็มและขั้นตอน
ตั้งค่า (broker.emqx.io, Discord webhook, ESP32 provisioning) ที่ [README.md](README.md)

## คำสั่งที่ใช้จริง

```bash
npm install
npm run dev -- --port 5170      # รัน dev (พอร์ต 5170)
npm run build                   # type-check + build ไปที่ dist/
npm run preview                 # preview build ที่ build เสร็จแล้ว
```

หรือใช้ Browser pane: `preview_start` ชื่อ `pc-controller`

ยังไม่มี automated test ของเว็บแอป — `npm run build` (type-check ผ่าน `tsc`) คือการตรวจที่มีอยู่ตอนนี้
ส่วน agent มี `--selftest` (crypto/ตารางเวลา/สแกนโปรแกรม) + เทส crypto ข้ามภาษา ทั้งคู่รันใน CI บน Windows runner
firmware เช็คด้วย `arduino-cli compile --fqbn esp32:esp32:esp32 firmware/pc-controller`

## โครงสร้าง

- `src/` — เว็บแอป PWA (Vite + TypeScript vanilla ไม่มี framework) คุยกับ ESP32 ผ่าน MQTT
  over WebSocket (broker.emqx.io — broker สาธารณะ ไม่มี username/password) ด้วย `mqtt.js`;
  `src/settings.ts` เก็บ/อ่าน Device ID จาก `localStorage` (host/port เป็นค่าคงที่ในโค้ด),
  `src/main.ts` เป็น UI ทั้งหมด (หน้าตั้งค่า + หน้าปุ่มกดเปิด/ปิด)
- `firmware/pc-controller/pc-controller.ino` — โค้ด ESP32 (Arduino) แยกจาก npm/vite build โดยสิ้นเชิง
  (ชื่อโฟลเดอร์ย่อยต้องตรงกับชื่อไฟล์ `.ino` ตามกฎของ Arduino) เปิดด้วย Arduino IDE เอง
  ดูรายละเอียดไลบรารี/การต่อสายที่ [firmware/README.md](firmware/README.md)
- `agent/` — **PC agent** (C# .NET 8 WinForms → `PcControllerAgent.exe` ไฟล์เดียว) รันบนคอมที่ควบคุม: ปิดคอม
  แบบสุภาพตามเวลา + หน้าต่างนับถอยหลัง + เปิด/ปิดโปรแกรมที่เลือก คุยกับมือถือผ่าน MQTT (เข้ารหัส AES-GCM ด้วย token)
  ต้องมี .NET 8 SDK (`dotnet build`/`dotnet publish` ดู [agent/README.md](agent/README.md)) — ไม่เกี่ยวกับ npm/vite
  ข้อความทั้งหมดที่คุยกันดู [PROTOCOL.md](PROTOCOL.md); ทดสอบตรรกะ: `PcControllerAgent.exe --selftest`
- `src/` มีหลายโมดูลแล้ว: `session.ts` (MQTT ตัวเดียวใช้ร่วมทุกหน้า + state), `crypto.ts` (envelope ต้องตรงกับ
  `agent/Envelope.cs` — เทสข้ามภาษาด้วย `scripts/crypto-vector.mjs`), `screens/*` (หน้าหลัก/ตั้งเวลา/โปรแกรม/เชื่อมต่อ)
- `scripts/gen-icons.mjs` — สคริปต์ one-off สร้างไอคอน PWA (`public/icon-192.png`, `icon-512.png`)
  รันด้วย `node scripts/gen-icons.mjs` เฉพาะตอนอยากเปลี่ยนไอคอน ไม่ใช่ส่วนของ build ปกติ
- CI workflow อยู่ที่ **root ของ dev-workspace repo** ไม่ใช่ในโฟลเดอร์นี้ (GitHub Actions มองไม่เห็น
  `.github/workflows/` ที่อยู่ในโฟลเดอร์ย่อยของ monorepo เลย — เจอเป็นบั๊กจริงตอน deploy ครั้งแรก
  ดู [bugs.md](bugs.md)):
  [`../.github/workflows/pc-controller-ci.yml`](../.github/workflows/pc-controller-ci.yml)
  (type-check+build ทุก push/PR ที่แตะไฟล์ในโฟลเดอร์นี้ — มี `paths: ['pc-controller/**']` กรองไว้แล้ว)
- **deploy ใช้ Vercel** (ไม่ใช่ GitHub Pages) เพราะ `dev-workspace` เป็น private repo และ GitHub Pages
  ไม่รองรับ private repo บน free tier — Vercel เชื่อม git แล้ว auto-deploy เอง ไม่มี workflow แยก
  ดูขั้นตอนตั้งค่าที่ [README.md](README.md)

## กฎเฉพาะของโปรเจกต์นี้

- ไม่มีระบบ login/auth ในเว็บแอป (ออกแบบให้ใช้คนเดียว) — อย่าเพิ่มโดยไม่ถามก่อน
- ไม่เก็บ log ประวัติเปิด/ปิดคอม — เอาแค่สถานะปัจจุบัน (ตัดสินใจไว้แล้ว ไม่ใช่ของที่ลืมทำ)
- ค่า Device ID ของเว็บแอปเก็บใน `localStorage` เท่านั้น ไม่มี backend ของตัวเอง
- broker เป็น `broker.emqx.io` สาธารณะ ไม่มี username/password ตั้งใจแลกความง่ายกับความเป็นส่วนตัว
  เล็กน้อย (ดูเหตุผลใน README.md) — อย่าเปลี่ยนกลับไปใช้ broker แบบมี credential โดยไม่ถามก่อน
- เช็คสถานะคอมด้วย **ARP** (`arpCheckOnline()` ใน firmware) ไม่ใช่ ICMP ping ธรรมดา เพราะ Windows
  บล็อก ping โดย default — อย่าเปลี่ยนกลับไปใช้ ping ตรงๆ โดยไม่ถามก่อน (จะพังเงียบๆ บน Windows)
- `vite.config.ts` ไม่มี `base` กำหนดไว้ (default `/`) เพราะ Vercel เสิร์ฟที่ root ของโดเมนตัวเอง
  ไม่ใช่ subpath แบบ GitHub Pages — ถ้าย้าย hosting ไปที่อื่นที่เสิร์ฟใน subpath ต้องเพิ่มค่านี้กลับ
- agent รับแค่ "id ของโปรแกรม" ที่มันสแกนเอง — **ห้ามเพิ่ม** ช่องทางที่รับ path/คำสั่ง/สคริปต์จากข้อความ MQTT
  (broker สาธารณะ: ใครเดา topic ได้ก็ส่งได้ token กันได้แค่คนนอก ไม่ควรให้ช่องทางนี้รันอะไรมั่วได้อยู่ดี)
- หน้าต่างนับถอยหลังของ agent: ปุ่มทุกปุ่ม `TabStop = false` ตั้งใจ — ไม่งั้นมีปุ่มถือ focus แล้วกด Enter/Space ที่พิมพ์อยู่
  ในหน้าต่างอื่นจะไปกด "ข้ามวันนี้" แทน (ดู [bugs.md](bugs.md)) และไม่มีตรวจ idle (เผื่อกำลังดูหนัง) — อย่าเพิ่มโดยไม่ถามก่อน
- **ตอนทดสอบ agent ห้ามรัน `.exe` เปล่าๆ** ใช้ `--dry-run --data-dir <ชั่วคราว>` เสมอ (รัน `.exe` เปล่าจะถามติดตั้งของจริง
  + ตั้ง autostart ใน registry ของเครื่อง)
- ขอบเขตยังไม่รวมการกด Algo Trading ใน MT5 อัตโนมัติ (agent เปิดโปรแกรมตามรายการได้ แต่ไม่ได้ควบคุมปุ่มในโปรแกรม)
  — เฟสถัดไปที่ตั้งใจแยกไว้ อย่าขยายสโคปเข้ามาที่นี่โดยไม่ถามก่อน
