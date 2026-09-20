# firmware

โค้ด ESP32 (Arduino) สำหรับ `pc-controller` — ไม่ได้อยู่ใน build pipeline ของเว็บแอป (npm/vite)
เป็นไฟล์แยกที่เปิดด้วย Arduino IDE หรือ PlatformIO เอง

## ฮาร์ดแวร์

- ESP32 DevKit (บอร์ดทั่วไป)
- Relay module 1 ช่อง (module สำเร็จรูปมักมี opto-isolator ในตัว รับสัญญาณ 3.3V จาก ESP32 ได้)
- ต่อสาย: `GPIO 26` (ปรับได้ที่ `RELAY_PIN` ในโค้ด) → ขา `IN` ของ relay module
- ขา `COM` และ `NO` ของ relay → บัดกรีขนานเข้ากับขา **POWER SW** บน front-panel header ของเมนบอร์ด
  (สองขาเดียวกับที่สวิตช์ power ตัวจริงต่ออยู่ — ตรวจสัญลักษณ์บนเมนบอร์ดหรือคู่มือเมนบอร์ดให้แน่ใจ)
- ไฟเลี้ยง ESP32 + relay module: ใช้ USB adapter แยกที่เสียบปลั๊กผนังตลอด (ไม่ได้พ่วงจากเมนบอร์ด
  เพราะเมนบอร์ดต้องปิดได้โดยที่ ESP32 ยังทำงานอยู่)

⚠️ **ระวังไฟ AC ถ้า relay module มีด้าน mains โดยตรง** — งานนี้ต่อกับสัญญาณ front-panel switch
เท่านั้น (แรงดันต่ำ, ปลอดภัย) ไม่ได้ตัดไฟ AC ของ PSU โดยตรง

## ไลบรารีที่ต้องติดตั้ง (Arduino Library Manager)

| ไลบรารี | ผู้เขียน | ใช้ทำอะไร |
|---|---|---|
| WiFiManager | tzapu | captive portal ตั้งค่า wifi + broker ครั้งแรก |
| PubSubClient | knolleary | MQTT client (ใช้คู่กับ `WiFiClientSecure` เพื่อทำ TLS) |
| ESPping | dvarrel (สืบทอดจาก ESP32Ping เดิมของ marian-craciunescu) | ping IP คอมเพื่อเช็คสถานะเปิด/ปิด |

แจ้งเตือนใช้ Discord webhook ยิง HTTPS POST ตรงๆ ผ่าน `HTTPClient`/`WiFiClientSecure` ที่มากับ esp32 core
อยู่แล้ว ไม่ต้องลงไลบรารีเพิ่ม

Board setting: **ESP32 Dev Module** (จาก esp32 core ของ Espressif ผ่าน Boards Manager)

## ตั้งค่าครั้งแรก (provisioning)

1. เปิดไฟ ESP32 ครั้งแรก (หรือหลังล้างค่า wifi) — บอร์ดจะปล่อย wifi hotspot ชื่อ **`PC-Controller-Setup`**
2. เอามือถือไปต่อ wifi นั้น — ปกติจะมี popup "ลงชื่อเข้าใช้เครือข่าย" เด้งขึ้นอัตโนมัติ (captive portal)
   ถ้าไม่เด้ง ให้เปิดเบราว์เซอร์ไปที่ `http://192.168.4.1`
3. กด "Configure WiFi" เลือก wifi บ้าน + ใส่รหัสผ่าน แล้วกรอกฟอร์มเพิ่มเติมท้ายหน้า:
   - **HiveMQ host** — จากหน้า cluster ใน HiveMQ Cloud (ดูวิธีสมัครใน [README.md หลักของโปรเจกต์](../README.md))
   - **MQTT port** — ใช้ `8883` (TLS ธรรมดา ไม่ใช่ websocket)
   - **MQTT username / password** — จาก HiveMQ Cloud
   - **Device ID** — ตัวเล็กไม่มีเว้นวรรค เช่น `pc01` (ต้องตรงกับที่กรอกในเว็บแอปด้วย)
   - **PC's LAN IP** — IP ของคอมในวง LAN (ตั้งเป็น static/reserved DHCP ที่เราเตอร์ ไม่ให้เปลี่ยน)
   - **Discord webhook URL** — จาก Discord channel settings → Integrations → Webhooks
     (ดูวิธีสร้างใน [README.md หลัก](../README.md)) — ถือเป็นความลับเหมือนรหัสผ่าน ใครมี URL นี้ส่งข้อความ
     เข้าช่องนั้นได้เลย
4. กด Save — บอร์ด reboot แล้วต่อ wifi บ้าน + broker ตามค่าที่กรอกทันที ครั้งต่อไปเปิดเครื่องจะจำค่าไว้เลย
   ไม่ต้องตั้งใหม่ (ค่าถูกเก็บใน flash ผ่าน `Preferences`/NVS)
5. อยากตั้งใหม่ (เช่น ย้าย wifi บ้าน) — กดปุ่ม `EN`/reset ค้างตอนไฟเข้าไม่ได้ช่วย ต้อง flash ใหม่หรือ
   เพิ่มปุ่ม "reset wifi" เองภายหลัง (ยังไม่ได้ทำในเวอร์ชันนี้ — ทางลัดตอนนี้คือ flash sketch ใหม่)

## หัวข้อ MQTT (topics)

Base: `pc-controller/<deviceId>` (deviceId = ค่าที่ตั้งตอน provisioning)

| topic | retained | ใครส่ง | ค่า |
|---|---|---|---|
| `.../status` | ใช่ | ESP32 | `"online"` / `"offline"` — สถานะคอม (จาก ping) |
| `.../availability` | ใช่ (LWT) | ESP32 | `"online"` / `"offline"` — สถานะตัว ESP32 เอง |
| `.../cmd` | ไม่ | เว็บแอป | `"toggle"` — สั่งกด relay ค้าง 3 วิ |

## ข้อจำกัดที่รู้อยู่แล้ว

- แจ้งเตือน "ESP32 หลุดการเชื่อมต่อ" เป็น best-effort เท่านั้น — ตอนหลุดจริงๆ ส่งอะไรไม่ได้อยู่แล้ว
  โค้ดเลยแจ้งตอน **กลับมาออนไลน์** แทน (บอกว่า "เพิ่งหลุดไปแล้วกลับมาแล้ว") ไม่ใช่แจ้งตอนหลุดจริง
- `tlsClient.setInsecure()` ข้ามการเช็ค CA certificate ของ TLS (ใช้งานง่ายสำหรับโปรเจกต์ส่วนตัว
  ถ้าอยากให้ปลอดภัยขึ้นควร pin root CA ของ HiveMQ Cloud/Discord เอง)
- ping ทุก 60 วิ ตามสเปก หมายความว่าอัพเดตสถานะช้าสุด ~60 วิหลังคอมเปิด/ปิดจริง
- Discord webhook URL เป็นความลับ (ไม่มี auth token แยก ใครมี URL ก็ส่งข้อความแทนได้เลย) —
  ถ้า URL รั่วไหลให้ลบ webhook นั้นแล้วสร้างใหม่ทันที
