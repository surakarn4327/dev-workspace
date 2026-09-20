# pc-controller

คุมเปิด-ปิดคอมจากมือถือผ่าน ESP32 + relay ได้จากทุกที่ (ไม่ใช่แค่ในบ้าน) พร้อมเช็คสถานะ
เปิด/ปิดแบบเรียลไทม์ และแจ้งเตือนผ่านมือถือเมื่อสถานะเปลี่ยน — ไม่ต้องพึ่ง Blynk อีกต่อไป

## สถาปัตยกรรม

```
[เว็บแอป PWA]  <--wss (MQTT/WebSocket)-->  [HiveMQ Cloud]  <--mqtts-->  [ESP32 + relay]
   มือถือ                                    broker กลาง                  ต่อกับสวิตช์ power
   (GitHub Pages)                            (ฟรี, ไม่ผูกบัตร)             เมนบอร์ด + ping เช็คสถานะ
                                                                              |
                                                                              v
                                                                    Gmail SMTP (ส่งอีเมลแจ้งเตือน)
```

ไม่มี backend ของตัวเอง ไม่ต้อง port-forward — ทั้งเว็บแอปและ ESP32 ต่อออกไปหา broker กลาง
(HiveMQ Cloud) เหมือนกัน คนละฝั่งคุยกันผ่าน topic เดียวกัน

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

### 1. สมัคร HiveMQ Cloud (ฟรี ไม่ผูกบัตร)

1. ไปที่ https://www.hivemq.com/mqtt-cloud-broker/ กด "Get Started Free" — สมัครด้วยอีเมล
   ไม่ต้องกรอกบัตรเครดิต
2. สร้าง cluster ใหม่ เลือก plan **"Free"** (Serverless, 100 การเชื่อมต่อพร้อมกัน — เกินพอสำหรับใช้คนเดียว)
3. เข้าไปที่ cluster → แท็บ **"Access Management"** → สร้าง credential ใหม่ (username/password)
   ตั้ง permission เป็น publish+subscribe ทุก topic (หรือจำกัดแค่ `pc-controller/#` ก็ได้ถ้าอยากรัดกุมขึ้น)
4. หน้า **"Overview"** ของ cluster จะมี **Cluster URL** (เช่น `xxxxxxxx.s1.eu.hivemq.cloud`) — จดไว้
5. พอร์ตที่ใช้: `8883` (MQTT+TLS ปกติ สำหรับ ESP32) และ `8884` (MQTT over WebSocket/TLS สำหรับเว็บแอป)
   — เป็นค่ามาตรฐานของ HiveMQ Cloud ทุก cluster ไม่ต้องตั้งเพิ่ม

เก็บ 4 อย่างนี้ไว้ใช้ทั้งฝั่ง ESP32 และเว็บแอป: **host, username, password** และ **device ID** ที่จะตั้งเอง
(เช่น `pc01` — ตัวเล็ก ไม่มีเว้นวรรค ใช้ชื่อเดียวกันทั้งสองฝั่ง)

### 2. สร้าง Gmail App Password (ฟรี ไม่ต้องสมัครอะไรใหม่)

ใช้ Gmail ที่มีอยู่แล้วให้ ESP32 ส่งอีเมลแจ้งเตือนแทนตัวเองได้ ไม่ต้องพึ่งบริการภายนอกเพิ่ม
แต่ Google ไม่ให้แอปภายนอกใช้รหัสผ่านจริงส่งอีเมล ต้องสร้าง "app password" แยกต่างหาก:

1. เปิด 2-Step Verification ก่อน (ถ้ายังไม่ได้เปิด) ที่ https://myaccount.google.com/security
2. ไปที่ https://myaccount.google.com/apppasswords
3. ตั้งชื่ออะไรก็ได้ (เช่น `pc-controller`) แล้วกด Create
4. Google จะโชว์รหัส 16 หลัก (เช่น `abcd efgh ijkl mnop`) — **คัดลอกเก็บไว้ ปิดหน้าแล้วจะดูซ้ำไม่ได้**
5. เก็บอีเมล Gmail + รหัส 16 หลักนี้ไว้ ใช้ตอนตั้งค่า ESP32 (ขั้นตอนถัดไป) — **อย่าใช้รหัสผ่านจริงของบัญชี Google**

### 3. Flash + ตั้งค่า ESP32

ดูรายละเอียดทั้งหมด (ไลบรารี, การต่อสาย, ขั้นตอน captive portal) ที่ [firmware/README.md](firmware/README.md)

สรุปสั้นๆ: flash `firmware/pc-controller.ino` → เปิดเครื่อง → ต่อมือถือเข้า wifi
`PC-Controller-Setup` → กรอก wifi บ้าน + HiveMQ host/user/pass + device ID + IP คอม + Gmail address/app password

### 4. ตั้งค่า + deploy เว็บแอป

```bash
npm install
npm run dev -- --port 5170     # ทดสอบก่อน deploy จริง
```

เปิดเว็บแอปครั้งแรก จะเจอหน้า "+ เพิ่มอุปกรณ์" — กรอกข้อมูล HiveMQ ชุดเดียวกับที่ตั้งใน ESP32
(host, **port 8884** สำหรับเว็บ, username, password, device ID ให้ตรงกัน)

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

- กดปุ่ม power ค้าง 3 วินาที (ไม่มีกล่องยืนยัน — กดค้างครบคือสั่งเลย) เพื่อเปิดหรือปิดคอม
- สถานะ "คอม" อัพเดตทุก ~60 วินาที (ESP32 ping IP คอมในวง LAN)
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
