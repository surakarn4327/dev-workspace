# PROTOCOL — ข้อความระหว่างแอปมือถือ / ESP32 / PC agent

ทุกอย่างผ่าน `broker.emqx.io` (สาธารณะ ไม่มี auth) — ใครเดา topic ได้ก็ส่ง/ฟังได้ จึงแบ่งเป็น 2 กลุ่ม:

## 1. ฝั่ง ESP32 (plain text/JSON — ความปลอดภัยเท่าเดิมคือ Device ID ยาวๆ)

Base `pc-controller/<deviceId>` — รายละเอียดที่ [firmware/README.md](firmware/README.md#หัวข้อ-mqtt-topics):
`status`, `availability`, `cmd` (`toggle`), `sched` (ตารางเปิดคอม, retained), `notify` (agent → Discord ผ่าน ESP32)

## 2. ฝั่ง PC agent (เข้ารหัสทั้งหมด)

Base `pc-controller/agent-<agentId>` (agentId 8 hex **คำนวณจากรหัสเชื่อมต่อ** ไม่ได้สุ่มแยก — ดูด้านล่าง)

| topic | retained | ทิศทาง | เนื้อหา |
|---|---|---|---|
| `availability` | ใช่ (LWT) | agent → มือถือ | `"online"` / `"offline"` (ไม่เข้ารหัส) |
| `state` | ใช่ | agent → มือถือ | envelope(`state`) — config ปัจจุบัน, โปรแกรมที่เลือก, รายการโปรแกรมที่สแกนได้, skipToday, postponedUntil |
| `cfg` | ใช่ | มือถือ → agent | envelope(`cmd`) — config ทั้งชุด (ไม่ใช่บางส่วน) retained เพื่อให้ agent ที่คอมปิดอยู่รับตอนบูต |
| `cmd` | ไม่ | มือถือ → agent | envelope(`cmd`) — คำสั่งครั้งเดียว: `{"type":"scan"}` |

### Envelope

JSON `{"n": base64(nonce 12 bytes), "c": base64(ciphertext ‖ tag 16 bytes)}` — AES-256-GCM
- กุญแจ = ได้จากรหัสเชื่อมต่อ (ดู "รหัสเชื่อมต่อ" ด้านล่าง) · รหัสไม่เคยส่งผ่าน broker
- AAD = `"state"` (agent → มือถือ) หรือ `"cmd"` (มือถือ → agent) กันเอาข้อความทิศหนึ่งไปเล่นซ้ำอีกทิศ
- โค้ด: [src/crypto.ts](src/crypto.ts) ↔ [agent/Envelope.cs](agent/Envelope.cs) (ทดสอบข้ามภาษาด้วย [scripts/crypto-vector.mjs](scripts/crypto-vector.mjs))

### กันเล่นซ้ำ (replay)
- `cfg`: ทุกข้อความมี `ts` (ms) — agent รับเฉพาะ `ts` ที่มากกว่าครั้งล่าสุดที่ใช้ (เก็บใน config.json)
- `cmd`: ต้องมี `ts` ห่างจากเวลาเครื่องไม่เกิน ±10 นาที และ `id` ที่ไม่ซ้ำ

### payload `cfg`
```json
{"days":[1,2,3,4,5],"off":"18:00","countdown":60,"paused":false,
 "apps":["<appId>", "..."],"notifyDevice":"pc-xxxx","ts":1790000000000}
```
- `apps` = id ตามลำดับเปิด (id ที่ agent ไม่รู้จักถูกทิ้ง — **ไม่มี path/คำสั่งผ่าน MQTT เลย**)
- `notifyDevice` ต้องตรง `^[A-Za-z0-9_-]{1,64}$` (ใช้สร้าง topic `pc-controller/<notifyDevice>/notify`)

### รหัสเชื่อมต่อ (pairing code)
12 ตัวอักษรหน้าตา `K7M2-P9X4-QA3D` (Crockford base32 ไม่มี I L O U = 60 บิต) แสดงในหน้าต่าง agent, แอปมือถือรับทั้งก้อน
(พิมพ์เล็ก/ขีด/เว้นวรรคได้ O→0, I/L→1 ให้เอง) ทั้ง **agentId และกุญแจ AES** ได้จากรหัสนี้:

```
PBKDF2-HMAC-SHA256(password = รหัส 12 ตัวตัวพิมพ์ใหญ่ไม่มีขีด, salt = "pc-controller-agent-v1", 200000 รอบ) → 36 ไบต์
  ไบต์ 0-31  = กุญแจ AES-256-GCM
  ไบต์ 32-35 = agentId (hex 8 ตัว)
```

เหตุผล: broker สาธารณะ ใครก็ subscribe ดักข้อความ retained ทุกอันแล้วเอาไปไล่เดารหัสแบบออฟไลน์ได้ — 60 บิตบวก PBKDF2
(ทำให้ทุกการเดาแพงขึ้น ~200,000 เท่า) ทำให้ไม่คุ้มสำหรับภัยระดับบ้านๆ ห้ามลดความยาว/จำนวนรอบลงโดยไม่คิด
โค้ด: [src/crypto.ts](src/crypto.ts) `deriveFromCode` ↔ [agent/Pairing.cs](agent/Pairing.cs) `Derive`
การ Reset token = สร้างรหัสใหม่ → agentId เปลี่ยนด้วย (agent ล้างข้อความ retained ของ topic เก่าก่อนย้าย)
