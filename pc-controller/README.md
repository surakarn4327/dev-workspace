# pc-controller

คุมเปิด-ปิดคอมจากมือถือผ่าน ESP32 + relay ได้จากทุกที่ (ไม่ใช่แค่ในบ้าน) พร้อมเช็คสถานะ
เปิด/ปิดแบบเรียลไทม์ และแจ้งเตือนผ่าน Discord เมื่อสถานะเปลี่ยน — ไม่ต้องพึ่ง Blynk อีกต่อไป

## สถาปัตยกรรม

```
[เว็บแอป PWA]  <--wss (MQTT/WebSocket)-->  [broker.emqx.io]  <--mqtts-->  [ESP32 + relay]
   มือถือ                                    broker สาธารณะ                ต่อกับสวิตช์ power
   (Vercel)                                  (ฟรี ไม่ต้องสมัคร             เมนบอร์ด + เช็คสถานะ
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

รายละเอียด topic ทั้งหมด: [firmware/README.md](firmware/README.md#หัวข้อ-mqtt-topics) และ
[PROTOCOL.md](PROTOCOL.md) (ข้อความที่คุยกับ PC agent)

## ตั้งเวลา + โปรแกรม (PC agent)

ESP32 กดได้แค่ปุ่ม power — ปิดคอมแบบสุภาพ, นับถอยหลังให้คนยกเลิก, เปิด/ปิดโปรแกรม ต้องมีโปรแกรมบนตัวคอมเอง
จึงมี **PC agent** (`agent/` — Windows `.exe` ไฟล์เดียว) รันอยู่ที่ไอคอนข้างนาฬิกา คุยกับมือถือผ่าน broker ตัวเดิม:

```
[มือถือ] --ตารางเวลาเปิด (retained)--> [ESP32]  กดรีเลย์ตามเวลา (เช็คว่าคอมปิดอยู่จริงก่อน)
[มือถือ] --config/คำสั่ง (เข้ารหัส)--> [PC agent] ปิดคอมตามเวลา + นับถอยหลัง + เปิด/ปิดโปรแกรม
[PC agent] --ข้อความ--> [ESP32] --> Discord
```

- **ตั้งจากมือถือทั้งหมด**: เมนู "ตั้งเวลา" (วัน/เวลาเปิด/เวลาปิด/นับถอยหลัง/หยุดชั่วคราว), "โปรแกรม"
  (agent สแกนรายการส่งมาให้กดเพิ่ม — เพิ่มแล้วคือทั้งเปิดตอนบูตและปิดตอนถึงเวลาปิดคอม), "เชื่อมต่อกับคอม"
- **ต้อง flash firmware ใหม่หนึ่งครั้ง** ถึงจะมีเวลาเปิดคอมและส่งต่อแจ้งเตือนจาก agent (ค่า wifi/Device ID เดิมยังอยู่)
- **ติดตั้ง agent**: ดาวน์โหลด `.exe` → ดับเบิลคลิก → Yes → คัดลอกรหัสเชื่อมต่อไปวางในแอป
  ดูขั้นตอนเต็มที่ [agent/README.md](agent/README.md)
- **ความปลอดภัย**: ข้อความถึง agent เข้ารหัส AES-GCM ด้วย token ที่ไม่เคยส่งผ่าน broker และ agent รับแค่ "id ของโปรแกรม"
  ที่มันสแกนเอง ไม่รับ path/คำสั่งจากเครือข่าย (ดู [PROTOCOL.md](PROTOCOL.md))

## โครงสร้างโปรเจกต์

```
pc-controller/
├── src/            เว็บแอป PWA (Vite + TypeScript, ไม่มี framework)
├── agent/          PC agent (C# .NET 8 WinForms → .exe) — build ด้วย dotnet ไม่ใช่ npm
├── firmware/       โค้ด ESP32 (Arduino .ino) — เปิดด้วย Arduino IDE แยกต่างหาก ไม่ใช่ npm
├── scripts/        สคริปต์ one-off (gen-icons.mjs สร้างไอคอน PWA, crypto-vector.mjs เทส crypto ข้ามภาษา)
└── PROTOCOL.md     ข้อความระหว่างแอป/ESP32/agent
```

CI (type-check+build) อยู่ที่ [`../.github/workflows/pc-controller-ci.yml`](../.github/workflows/pc-controller-ci.yml)
(root ของ repo — ดูเหตุผลใน [bugs.md](bugs.md)) ส่วน deploy ใช้ Vercel's git integration เอง
ไม่มี workflow แยกสำหรับ deploy · ตัว agent build บน Windows runner ที่
[`pc-controller-agent.yml`](../.github/workflows/pc-controller-agent.yml) (selftest + publish `.exe` เป็น artifact)
และ [`pc-controller-agent-release.yml`](../.github/workflows/pc-controller-agent-release.yml) (ติด tag `pc-agent-v*` → GitHub Release)

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

**deploy ผ่าน Vercel** (ไม่ใช้ GitHub Pages เพราะ `dev-workspace` เป็น private repo — GitHub Pages
ต้องการ repo public หรืออัปเกรดเป็นเสียเงินถึงจะใช้ได้ ส่วน Vercel free tier รองรับ private repo
ได้ตรงๆ ดู [bugs.md](bugs.md)):

1. เข้า https://vercel.com → **Add New → Project**
2. เลือก repo `dev-workspace` จากรายการ GitHub ที่เชื่อมไว้แล้ว
3. ตั้งค่า:
   - **Root Directory** → กด Edit เลือก `pc-controller` (สำคัญมาก — ไม่งั้น Vercel จะพยายาม build
     ทั้ง monorepo ที่ root ซึ่งไม่มี `package.json`)
   - **Framework Preset** → Vercel ควร detect เป็น "Vite" อัตโนมัติหลังตั้ง Root Directory ถูก
   - Build Command / Output Directory ปล่อยเป็นค่า default ของ Vite preset ได้เลย (`npm run build`,
     `dist`)
4. กด **Deploy** — เสร็จแล้ว Vercel จะ auto-deploy ทุกครั้งที่ push ขึ้น `main` ที่แตะไฟล์ในโฟลเดอร์นี้
   เอง ไม่ต้องตั้ง GitHub Actions อะไรเพิ่ม
5. ได้ URL แบบ `https://pc-controller-xxxx.vercel.app` (หรือตั้งชื่อโปรเจกต์เองใน Vercel ให้ URL
   สั้นลงได้)

### 5. ติดตั้งเป็นไอคอนบนหน้าจอมือถือ (PWA)

เปิดเว็บแอปที่ deploy แล้วในเบราว์เซอร์มือถือ → เมนูเบราว์เซอร์ → "เพิ่มลงหน้าจอโฮม" /
"Install app" — จะได้ไอคอนเปิดแอปได้เหมือนแอปจริง

## การใช้งาน

- กดปุ่ม power ค้าง 3 วินาทีในแอป (ไม่มีกล่องยืนยัน — กดค้างครบคือสั่งเลย) → ESP32 ปิดวงจร relay 1 วินาที
  (จำลองการกดปุ่ม power บนเคส — พอสำหรับเปิดเครื่อง/สั่ง shutdown ปกติ แต่ไม่พอสำหรับบังคับปิดเครื่องที่ค้าง
  ซึ่งเมนบอร์ดส่วนใหญ่ต้องการกดค้าง 4 วิขึ้นไป — ปรับได้ที่ `HOLD_MS` ใน firmware ถ้าต้องการ)
- สถานะ "คอม" อัพเดตทุก ~10 วินาที — ESP32 เช็คด้วย **ARP** (ไม่ใช่ ICMP ping ธรรมดา) เพื่อให้ทำงาน
  ได้แม้ Windows Firewall จะบล็อก ping อยู่ (ค่า default ของ Windows ทุกเครื่อง) โดยไม่ต้องไปตั้งค่า
  firewall เองแม้แต่นิดเดียว — ย้าย ESP32 ไปคอมเครื่องอื่น หรือลง Windows ใหม่ก็ยังทำงานได้ทันที
- สถานะ "ESP32" แยกต่างหาก บอกว่าตัว ESP32 เองยังออนไลน์อยู่ไหม (ไม่ใช่สถานะคอม)
- ไม่มีระบบ login (ออกแบบมาให้ใช้คนเดียว) และไม่เก็บ log ประวัติการเปิด/ปิด (หน้าต่าง agent เก็บ "เหตุการณ์ล่าสุด"
  50 รายการไว้ในเครื่องคอมเท่านั้น ไม่ขึ้น cloud)
- ตั้งเวลาเปิดคอม: ESP32 กดรีเลย์เมื่อถึงเวลาและคอมปิดอยู่ · ตั้งเวลาปิดคอม: agent เด้งหน้าต่างนับถอยหลังก่อนปิดเสมอ
  (ไม่มีข้ามเมื่อไม่มีคนใช้ เผื่อกำลังดูหนัง)
- สวิตช์ "หยุดชั่วคราว" ในแอปหยุดทั้งเวลาเปิดและเวลาปิด (ลาพักร้อน/วันหยุดยาว)

## Dev commands

```bash
npm install       # ติดตั้ง dependency
npm run dev -- --port 5170   # dev server
npm run build     # type-check + build ไปที่ dist/
npm run preview   # preview build ที่ทำเสร็จแล้ว
```

หรือใช้ Browser pane: `preview_start` ชื่อ `pc-controller`

## ขอบเขตที่ยังไม่ทำ (เฟสถัดไป)

- กด Algo Trading ของ MT5 อัตโนมัติหลังเปิดโปรแกรม (ตอนนี้ agent เปิดโปรแกรมตามรายการได้ทั่วไปรวม MT5 แล้ว
  แต่ยังไม่ได้ควบคุมปุ่มข้างในโปรแกรม — ตั้งใจแยกเป็นงานถัดไป)
- ยังไม่ได้ทดสอบบนฮาร์ดแวร์จริง: เวลาเปิดคอมของ ESP32 (คอมไพล์ผ่านเท่านั้น), ตัวติดตั้ง/autostart ตอนลง Windows ใหม่,
  การปิดเครื่องจริง (`shutdown`) — ทดสอบแบบ `--dry-run` และแอปมือถือ↔agent ผ่าน broker จริงแล้ว
- **ลดขั้นตอนสำหรับขายต่อให้ผู้ใช้ที่ไม่เก่งคอม** (คุยไว้แล้ว):
  1. ✅ Discord webhook ไม่บังคับอยู่แล้วในโค้ด (เว้นว่างได้) — แค่ต้องปรับคู่มือผู้ซื้อให้บอกชัดว่าข้ามได้
  2. ✅ **auto-link Device ID** — ทำแล้ว: หน้า "Credentials saved" หลังกด Save บนพอร์ทัล ESP32 โชว์ลิงก์ที่ฝัง
     Device ID ไว้ให้ (เช่น `pc-controller-eight.vercel.app/?device=pc-xxxx`, ดู
     `buildPostSaveLinkHeadElement()` ใน [firmware/pc-controller/pc-controller.ino](firmware/pc-controller/pc-controller.ino))
     เว็บแอปอ่านค่า `?device=` จาก URL มา prefill ให้อัตโนมัติแล้ว (ดู `getDeviceIdFromUrl()` ใน
     [src/main.ts](src/main.ts)) — ผู้ซื้อแค่ตั้งชื่ออุปกรณ์แล้วกดบันทึก ไม่ต้องพิมพ์ Device ID เอง
     (ข้อจำกัด: มือถือยังไม่มีเน็ตตอนหน้านี้เด้งขึ้น เพราะยังต่ออยู่กับ wifi ชั่วคราวของ ESP32 — ต้องรอ
     สัก 5-10 วิให้มือถือสลับกลับไปใช้เน็ตปกติเองก่อนถึงจะกดลิงก์เข้าเว็บแอปได้จริง ยังไม่ได้ทดสอบบน
     ฮาร์ดแวร์จริง เพราะ session นี้ไม่มี ESP32 ต่ออยู่ — คอมไพล์ผ่านแล้วเท่านั้น)
  3. **auto-discover PC's LAN IP** — ยังไม่ได้ทำ: ให้ ESP32 สแกนหาอุปกรณ์ในวง LAN แล้วโชว์เป็นลิสต์ให้เลือก
     ระหว่าง provisioning แทนที่จะให้ผู้ใช้เปิด `cmd` พิมพ์ `ipconfig` เอง (ขั้นตอนที่ non-tech user น่าจะ
     งงสุด) — ยังไม่ทำเพราะเป็นงานเสี่ยงกว่า 2 ข้อบนมาก ต้องเขียน scan ทั้งวง LAN + resolve ชื่อเครื่อง
     (NBNS/mDNS) + จัดการโหมด AP+STA พร้อมกัน ซึ่งไม่มีทางเทสต์ถูกต้องได้โดยไม่มี ESP32 จริงต่อกับ
     เครือข่ายจริงตรงหน้า — ทำแบบเดาไปคอมไพล์ผ่านอย่างเดียวเสี่ยงพังของเดิมที่ใช้งานได้อยู่แล้ว
