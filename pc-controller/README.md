# pc-controller

คุมเปิด-ปิดคอมจากมือถือผ่าน ESP32 + relay ได้จากทุกที่ (ไม่ใช่แค่ในบ้าน) พร้อมเช็คสถานะ
เปิด/ปิดแบบเรียลไทม์ และแจ้งเตือนผ่าน Discord เมื่อสถานะเปลี่ยน — ไม่ต้องพึ่ง Blynk อีกต่อไป

## สถาปัตยกรรม

```
[เว็บแอป PWA]  <--wss (MQTT/WebSocket)-->  [broker.emqx.io]  <--mqtts-->  [ESP32 + relay]
   มือถือ                                    broker สาธารณะ                ต่อกับสวิตช์ power
   (GitHub Pages)                            (ฟรี ไม่ต้องสมัคร             เมนบอร์ด + เช็คสถานะ
                                              ไม่มี username/password)      ด้วย ARP (ไม่ใช่ ping)
                                                                              |
                                                                              v
                                                                    Discord webhook (ข้อความแจ้งเตือน)
```

ไม่มี backend ของตัวเอง ไม่ต้อง port-forward — ทั้งเว็บแอปและ ESP32 ต่อออกไปหา broker สาธารณะ
(`broker.emqx.io`) เหมือนกัน คนละฝั่งคุยกันผ่าน topic เดียวกัน โดยใช้ **Device ID** เป็นตัวแยกอุปกรณ์
(ตั้งอัตโนมัติจาก MAC address ของ ESP32 ตอน provisioning ครั้งแรก ไม่ต้องคิดเอง)

**broker เป็นแบบสาธารณะ ไม่มีรหัสผ่าน** — แลกความง่ายในการตั้งค่ากับความเป็นส่วนตัวเล็กน้อย
(ใครเดา Device ID ถูกจะส่งคำสั่งเปิด/ปิดคอมแทนได้) Device ID ที่ auto-gen ให้ยาวพอสมควรอยู่แล้ว
ทำให้เดาถูกยาก แต่ถ้าอยากตั้งเองก็ตั้งยาวๆ สุ่มๆ ได้เหมือนกัน

รายละเอียด topic ทั้งหมด: [firmware/README.md](firmware/README.md#หัวข้อ-mqtt-topics)

## โครงสร้างโปรเจกต์

```
pc-controller/
├── src/            เว็บแอป PWA (Vite + TypeScript, ไม่มี framework)
├── firmware/       โค้ด ESP32 (Arduino .ino) — เปิดด้วย Arduino IDE แยกต่างหาก ไม่ใช่ npm
├── scripts/        สคริปต์ one-off (เช่น gen-icons.mjs สร้างไอคอน PWA)
└── .github/workflows/   CI + deploy ขึ้น GitHub Pages
```

## ตั้งค่าใช้งานจริง (ทำตามลำดับ)

### 1. สร้าง Discord webhook (ฟรี ไม่ต้อง 2FA/app password)

1. เปิด Discord — ถ้ายังไม่มีเซิร์ฟเวอร์ของตัวเอง กด "+" → "Create My Own" → "For me and my friends"
2. สร้างช่อง (channel) ใหม่หรือใช้ช่องเดิม (เช่นตั้งชื่อ `pc-notify`)
3. คลิกไอคอนเฟือง ⚙ ข้างชื่อช่อง → แท็บ **"Integrations"** → **"Webhooks"** → **"New Webhook"**
4. ตั้งชื่อ webhook (เช่น `PC Controller`) แล้วกด **"Copy Webhook URL"**
5. เก็บ URL นี้ไว้ (หน้าตาประมาณ `https://discord.com/api/webhooks/123.../abc...`) — **ถือเป็นความลับ
   เหมือนรหัสผ่าน** ใครมี URL นี้ส่งข้อความเข้าช่องนั้นแทนเราได้เลย ใช้ตอนตั้งค่า ESP32 (ขั้นตอนถัดไป)

### 2. เช็ค/ตั้ง IP ของคอมเครื่องนี้ให้คงที่

ESP32 ต้องรู้ IP ของคอมในวง LAN เพื่อเช็คสถานะเปิด/ปิด — เข้า router ตั้งเป็น **static/reserved DHCP**
ให้คอมเครื่องนี้ (ผูก IP กับ MAC address ของการ์ดเน็ตเวิร์ก) ไม่ให้ router สลับ IP ให้ทีหลัง
มิฉะนั้นสถานะจะผิดพลาดเมื่อ IP เปลี่ยน

### 3. Flash + ตั้งค่า ESP32

ดูรายละเอียดทั้งหมด (ไลบรารี, การต่อสาย, ขั้นตอน captive portal) ที่ [firmware/README.md](firmware/README.md)

สรุปสั้นๆ: flash `firmware/pc-controller/pc-controller.ino` → เปิดเครื่อง → ต่อมือถือเข้า wifi
`PC-Controller-Setup` → กรอก wifi บ้าน + IP คอม + Discord webhook URL (Device ID จะ pre-fill ให้แล้ว
กด Save ผ่านได้เลย ไม่ต้องพิมพ์เอง แต่ต้องจำ/copy ค่านี้ไปกรอกในเว็บแอปด้วย)

### 4. ตั้งค่า + deploy เว็บแอป

```bash
npm install
npm run dev -- --port 5170     # ทดสอบก่อน deploy จริง
```

เปิดเว็บแอปครั้งแรก จะเจอหน้า "+ เพิ่มอุปกรณ์" — กรอกแค่ **Device ID** (ค่าเดียวกับที่ ESP32 ใช้)
กับตั้งชื่ออุปกรณ์ที่อยากให้แสดงบนหน้าจอ ไม่ต้องกรอก host/พอร์ต/รหัสผ่านอะไรเลย (broker เป็นค่าคงที่
ในโค้ดอยู่แล้ว)

deploy ขึ้น GitHub Pages (workflow จะรันอัตโนมัติเมื่อ push ขึ้น `main` ที่แตะไฟล์ในโฟลเดอร์นี้):

```bash
npm run build
```

**ขั้นตอนเดียวที่ต้องทำเองครั้งแรกบน GitHub**: ไปที่ repo `dev-workspace` → Settings → Pages →
Source เลือก **"GitHub Actions"** (ไม่ใช่ "Deploy from a branch") มิฉะนั้น workflow deploy จะรันไม่ได้

URL ที่ได้ควรเป็น `https://<username>.github.io/dev-workspace/pc-controller/` — ถ้า URL จริงต่างจากนี้
ให้แก้ค่า `base` ใน [vite.config.ts](vite.config.ts) ให้ตรงกับพาธจริง แล้ว build+deploy ใหม่

### 5. ติดตั้งเป็นไอคอนบนหน้าจอมือถือ (PWA)

เปิดเว็บแอปที่ deploy แล้วในเบราว์เซอร์มือถือ → เมนูเบราว์เซอร์ → "เพิ่มลงหน้าจอโฮม" /
"Install app" — จะได้ไอคอนเปิดแอปได้เหมือนแอปจริง

## การใช้งาน

- กดปุ่ม power ค้าง 3 วินาทีในแอป (ไม่มีกล่องยืนยัน — กดค้างครบคือสั่งเลย) → ESP32 ปิดวงจร relay 1 วินาที
  (จำลองการกดปุ่ม power บนเคส — พอสำหรับเปิดเครื่อง/สั่ง shutdown ปกติ แต่ไม่พอสำหรับบังคับปิดเครื่องที่ค้าง
  ซึ่งเมนบอร์ดส่วนใหญ่ต้องการกดค้าง 4 วิขึ้นไป — ปรับได้ที่ `HOLD_MS` ใน firmware ถ้าต้องการ)
- สถานะ "คอม" อัพเดตทุก ~60 วินาที — ESP32 เช็คด้วย **ARP** (ไม่ใช่ ICMP ping ธรรมดา) เพื่อให้ทำงาน
  ได้แม้ Windows Firewall จะบล็อก ping อยู่ (ค่า default ของ Windows ทุกเครื่อง) โดยไม่ต้องไปตั้งค่า
  firewall เองแม้แต่นิดเดียว — ย้าย ESP32 ไปคอมเครื่องอื่น หรือลง Windows ใหม่ก็ยังทำงานได้ทันที
- สถานะ "ESP32" แยกต่างหาก บอกว่าตัว ESP32 เองยังออนไลน์อยู่ไหม (ไม่ใช่สถานะคอม)
- ไม่มีระบบ login (ออกแบบมาให้ใช้คนเดียว) และไม่เก็บ log ประวัติการเปิด/ปิด

## Dev commands

```bash
npm install       # ติดตั้ง dependency
npm run dev -- --port 5170   # dev server
npm run build     # type-check + build ไปที่ dist/
npm run preview   # preview build ที่ทำเสร็จแล้ว
```

หรือใช้ Browser pane: `preview_start` ชื่อ `pc-controller`

## ขอบเขตที่ยังไม่ทำ (เฟสถัดไป)

- MT5 auto-start + กด Algo Trading อัตโนมัติหลังคอมเปิดเสร็จ (ตั้งใจแยกเป็นงานถัดไป)
- ปุ่ม reset wifi บน ESP32 โดยไม่ต้อง flash ใหม่
