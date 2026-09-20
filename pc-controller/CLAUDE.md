# pc-controller

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

คุมเปิด-ปิดคอมจากมือถือผ่าน ESP32+relay พร้อมเช็คสถานะและแจ้งเตือน — ดูสถาปัตยกรรมเต็มและขั้นตอน
ตั้งค่า (HiveMQ Cloud, ntfy.sh, ESP32 provisioning) ที่ [README.md](README.md)

## คำสั่งที่ใช้จริง

```bash
npm install
npm run dev -- --port 5170      # รัน dev (พอร์ต 5170)
npm run build                   # type-check + build ไปที่ dist/
npm run preview                 # preview build ที่ build เสร็จแล้ว
```

หรือใช้ Browser pane: `preview_start` ชื่อ `pc-controller`

ยังไม่มี automated test — `npm run build` (type-check ผ่าน `tsc`) คือการตรวจที่มีอยู่ตอนนี้

## โครงสร้าง

- `src/` — เว็บแอป PWA (Vite + TypeScript vanilla ไม่มี framework) คุยกับ ESP32 ผ่าน MQTT
  over WebSocket (HiveMQ Cloud) ด้วย `mqtt.js`; `src/settings.ts` เก็บ/อ่าน broker config จาก
  `localStorage`, `src/main.ts` เป็น UI ทั้งหมด (หน้าตั้งค่า + หน้าปุ่มกดเปิด/ปิด)
- `firmware/pc-controller.ino` — โค้ด ESP32 (Arduino) แยกจาก npm/vite build โดยสิ้นเชิง
  เปิดด้วย Arduino IDE เอง ดูรายละเอียดไลบรารี/การต่อสายที่ [firmware/README.md](firmware/README.md)
- `scripts/gen-icons.mjs` — สคริปต์ one-off สร้างไอคอน PWA (`public/icon-192.png`, `icon-512.png`)
  รันด้วย `node scripts/gen-icons.mjs` เฉพาะตอนอยากเปลี่ยนไอคอน ไม่ใช่ส่วนของ build ปกติ
- `.github/workflows/ci.yml` — type-check+build ทุก push/PR ที่แตะไฟล์ในโฟลเดอร์นี้
- `.github/workflows/pc-controller-deploy.yml` — build+deploy ขึ้น GitHub Pages เมื่อ push `main`

## กฎเฉพาะของโปรเจกต์นี้

- ไม่มีระบบ login/auth ในเว็บแอป (ออกแบบให้ใช้คนเดียว) — อย่าเพิ่มโดยไม่ถามก่อน
- ไม่เก็บ log ประวัติเปิด/ปิดคอม — เอาแค่สถานะปัจจุบัน (ตัดสินใจไว้แล้ว ไม่ใช่ของที่ลืมทำ)
- ค่า broker/device ID ของเว็บแอปเก็บใน `localStorage` เท่านั้น ไม่มี backend ของตัวเอง
- `vite.config.ts` มี `base: '/dev-workspace/pc-controller/'` ตาม GitHub Pages URL ที่คาดไว้ —
  ถ้า URL จริงต่างไป ต้องแก้ค่านี้ก่อน deploy จะใช้งานได้ถูกพาธ
- ขอบเขตยังไม่รวม MT5 auto-start/กด Algo Trading อัตโนมัติ — เป็นเฟสถัดไปที่ตั้งใจแยกไว้
  อย่าขยายสโคปเข้ามาที่นี่โดยไม่ถามก่อน
