# firmware

โค้ด ESP32 (Arduino) สำหรับ `pc-controller` — ไม่ได้อยู่ใน build pipeline ของเว็บแอป (npm/vite)
เป็นไฟล์แยกที่เปิดด้วย Arduino IDE หรือ PlatformIO เอง

## ฮาร์ดแวร์

- ESP32 DevKit (บอร์ดทั่วไป)
- Relay module 1 ช่อง (module สำเร็จรูปมักมี opto-isolator ในตัว รับสัญญาณ 3.3V จาก ESP32 ได้)
- ต่อสาย: `GPIO 23` (ปรับได้ที่ `RELAY_PIN` ในโค้ด) → ขา `IN` ของ relay module
- ขา `COM` และ `NO` ของ relay → บัดกรีขนานเข้ากับขา **POWER SW** บน front-panel header ของเมนบอร์ด
  (สองขาเดียวกับที่สวิตช์ power ตัวจริงต่ออยู่ — ตรวจสัญลักษณ์บนเมนบอร์ดหรือคู่มือเมนบอร์ดให้แน่ใจ)
- ไฟเลี้ยง ESP32 + relay module: ใช้ USB adapter แยกที่เสียบปลั๊กผนังตลอด (ไม่ได้พ่วงจากเมนบอร์ด
  เพราะเมนบอร์ดต้องปิดได้โดยที่ ESP32 ยังทำงานอยู่)

⚠️ **ระวังไฟ AC ถ้า relay module มีด้าน mains โดยตรง** — งานนี้ต่อกับสัญญาณ front-panel switch
เท่านั้น (แรงดันต่ำ, ปลอดภัย) ไม่ได้ตัดไฟ AC ของ PSU โดยตรง

## ไลบรารีที่ต้องติดตั้ง (Arduino Library Manager)

| ไลบรารี | ผู้เขียน | ใช้ทำอะไร |
|---|---|---|
| WiFiManager | tzapu | captive portal ตั้งค่า wifi ครั้งแรก |
| PubSubClient | knolleary | MQTT client (ใช้คู่กับ `WiFiClientSecure` เพื่อทำ TLS) |
| ESPping | dvarrel (สืบทอดจาก ESP32Ping เดิมของ marian-craciunescu) | ทริกเกอร์ ARP resolution เพื่อเช็คสถานะเปิด/ปิด (ดูหัวข้อด้านล่าง) |

แจ้งเตือนใช้ Discord webhook ยิง HTTPS POST ตรงๆ ผ่าน `HTTPClient`/`WiFiClientSecure` ที่มากับ esp32 core
อยู่แล้ว ไม่ต้องลงไลบรารีเพิ่ม

Board setting: **ESP32 Dev Module** (จาก esp32 core ของ Espressif ผ่าน Boards Manager)

## Broker: broker.emqx.io (สาธารณะ ไม่ต้องสมัคร)

ใช้ `broker.emqx.io` ของ EMQX — broker MQTT สาธารณะที่รับ connection แบบไม่ต้องมี username/password
เลย ฮาร์ดโค้ดไว้ในโค้ดแล้ว (`MQTT_HOST`, `MQTT_PORT`) ไม่ต้องตั้งค่าอะไรเพิ่ม แลกกับความเป็นส่วนตัว
เล็กน้อย (ใครเดา Device ID ถูกจะแอบส่งคำสั่งได้) — ดูเหตุผลเพิ่มเติมที่ [README.md หลัก](../README.md)

## ตั้งค่าครั้งแรก (provisioning)

1. เปิดไฟ ESP32 ครั้งแรก (หรือหลังล้างค่า wifi) — บอร์ดจะปล่อย wifi hotspot ชื่อ **`PC-Controller-Setup`**
2. เอามือถือไปต่อ wifi นั้น — ปกติจะมี popup "ลงชื่อเข้าใช้เครือข่าย" เด้งขึ้นอัตโนมัติ (captive portal)
   ถ้าไม่เด้ง ให้เปิดเบราว์เซอร์ไปที่ `http://192.168.4.1`
3. กด "Configure WiFi" เลือก wifi บ้าน + ใส่รหัสผ่าน แล้วกรอกฟอร์มเพิ่มเติมท้ายหน้า:
   - **Device ID** — ระบบ pre-fill ให้อัตโนมัติจาก MAC address ของบอร์ด (เช่น `pc-a1b2c3d4`)
     กด Save ผ่านได้เลยไม่ต้องพิมพ์เอง — แต่ต้อง **copy ค่านี้ไปกรอกในเว็บแอปด้วย** (คนละอุปกรณ์กัน
     ไม่รู้ค่ากันเอง)
   - **PC's LAN IP** — IP ของคอมในวง LAN (ตั้งเป็น static/reserved DHCP ที่เราเตอร์ ไม่ให้เปลี่ยน)
   - **Discord webhook URL** — จาก Discord channel settings → Integrations → Webhooks
     (ดูวิธีสร้างใน [README.md หลัก](../README.md)) — ถือเป็นความลับเหมือนรหัสผ่าน ใครมี URL นี้ส่งข้อความ
     เข้าช่องนั้นได้เลย
4. กด Save — หน้า "Credentials saved" จะโชว์ลิงก์เข้าเว็บแอปที่ฝัง Device ID ไว้ให้แล้ว (เช่น
   `pc-controller-eight.vercel.app/?device=pc-a1b2c3d4`) รอมือถือสลับกลับไปใช้เน็ตปกติสัก 5-10 วิ
   (ตอนนี้ยังต่อ wifi ชั่วคราวของ ESP32 อยู่ ไม่มีเน็ตจริง) แล้วกดลิงก์นั้นได้เลย เว็บแอปจะกรอก Device ID
   ให้อัตโนมัติ ไม่ต้องจด/พิมพ์เอง (ดู `buildPostSaveLinkHeadElement()` ในโค้ด) — ส่วนตัวบอร์ดเองจะ
   reboot แล้วต่อ wifi บ้าน + broker ตามค่าที่กรอกทันที ครั้งต่อไปเปิดเครื่องจะจำค่าไว้เลย ไม่ต้องตั้งใหม่
   (ค่าถูกเก็บใน flash ผ่าน `Preferences`/NVS)
5. อยากตั้งใหม่ (เช่น ย้าย wifi บ้าน) — **กดปุ่ม `BOOT` ค้าง 5 วินาที** ระหว่างเครื่องทำงานปกติ (ปุ่มที่ติด
   มากับบอร์ด ESP32-WROOM-32 devkit ทั่วไปอยู่แล้ว ไม่ต้องบัดกรีปุ่มเพิ่ม) บอร์ดจะล้างทั้ง wifi credential
   และค่า Device ID/PC IP/Discord webhook ที่เคยตั้งไว้ แล้ว reboot เข้าโหมด setup portal ใหม่เหมือน
   flash ครั้งแรก — ไม่ต้อง flash sketch ใหม่อีกต่อไป (ดู `serviceWifiResetButton()` ในโค้ด)

## เช็คสถานะเปิด/ปิดด้วย ARP แทน ping

Windows ปิดการตอบ ICMP ping (`Echo Request`) ไว้เป็นค่า default ของทุกเครื่อง (เหตุผลด้านความ
ปลอดภัย) การเช็คสถานะด้วย ping ธรรมดาจึงมักจะรายงานว่า "ปิดอยู่" ทั้งที่เครื่องเปิดอยู่จริง เว้นแต่ผู้ใช้
จะไปเปิด firewall rule เองทุกครั้งที่ลง Windows ใหม่/ย้ายเครื่อง — ยุ่งยากและต้องทำซ้ำเรื่อยๆ

โค้ดนี้เลยใช้ **ARP** แทน: อุปกรณ์บนเครือข่ายปฏิเสธการตอบ ARP request ไม่ได้ (ไม่งั้นจะรับส่งข้อมูล
อะไรในวงแลนไม่ได้เลย) ฟังก์ชัน `arpCheckOnline()` เรียก `Ping.ping()` เพื่อกระตุ้นให้เกิดการ resolve
ARP เป็นผลข้างเคียง (ไม่สนใจผลลัพธ์ของ ICMP เอง เพราะอาจถูกบล็อก) แล้วเช็คตาราง ARP ของ ESP32
โดยตรงผ่าน `etharp_find_addr()` (lwIP) — วิธีนี้ทำงานได้แม้ Windows Firewall จะบล็อก ping อยู่
โดยไม่ต้องตั้งค่าอะไรฝั่งคอมเลย ย้ายไปคอมเครื่องไหน ลง Windows ใหม่กี่ครั้งก็ยังทำงานได้ทันที

## หัวข้อ MQTT (topics)

Base: `pc-controller/<deviceId>` (deviceId = ค่าที่ pre-fill/ตั้งตอน provisioning)

| topic | retained | ใครส่ง | ค่า |
|---|---|---|---|
| `.../status` | ใช่ | ESP32 | `"online"` / `"offline"` — สถานะคอม (จาก ARP) |
| `.../availability` | ใช่ (LWT) | ESP32 | `"online"` / `"offline"` — สถานะตัว ESP32 เอง |
| `.../cmd` | ไม่ | เว็บแอป | `"toggle"` — สั่งกด relay ค้าง `HOLD_MS` (default 1 วิ) |

## ข้อจำกัดที่รู้อยู่แล้ว

- **broker.emqx.io เป็น broker สาธารณะ ไม่มี authentication** — ใครก็ตามที่รู้ Device ID ของคุณ
  publish/subscribe topic เดียวกันได้เลย (คือสั่งเปิด/ปิดคอมคุณได้) Device ID ที่ auto-gen จาก MAC
  ยาวพอสมควรอยู่แล้ว แต่ถ้าอยากปลอดภัยขึ้นควรกลับไปใช้ broker แบบมี credential (เช่น HiveMQ Cloud)
- แจ้งเตือน "ESP32 หลุดการเชื่อมต่อ" เป็น best-effort เท่านั้น — ตอนหลุดจริงๆ ส่งอะไรไม่ได้อยู่แล้ว
  โค้ดเลยแจ้งตอน **กลับมาออนไลน์** แทน (บอกว่า "เพิ่งหลุดไปแล้วกลับมาแล้ว") ไม่ใช่แจ้งตอนหลุดจริง
- `tlsClient.setInsecure()` ข้ามการเช็ค CA certificate ของ TLS (ใช้งานง่ายสำหรับโปรเจกต์ส่วนตัว
  ถ้าอยากให้ปลอดภัยขึ้นควร pin root CA ของ broker/Discord เอง)
- เช็คสถานะทุก 10 วิ ตามสเปก หมายความว่าอัพเดตสถานะช้าสุด ~10 วิหลังคอมเปิด/ปิดจริง
- Discord webhook URL เป็นความลับ (ไม่มี auth token แยก ใครมี URL ก็ส่งข้อความแทนได้เลย) —
  ถ้า URL รั่วไหลให้ลบ webhook นั้นแล้วสร้างใหม่ทันที
- ต้องตั้ง static/reserved DHCP ให้คอมเครื่องนี้ที่เราเตอร์ — ถ้า IP เปลี่ยน ต้อง provisioning ใหม่
  เพื่อแก้ค่า PC's LAN IP
