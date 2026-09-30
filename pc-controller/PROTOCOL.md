# PROTOCOL — ข้อความระหว่างแอปมือถือ / ESP32 / PC agent

ทุกอย่างผ่าน `broker.emqx.io` (สาธารณะ ไม่มี auth) — ใครเดา topic ได้ก็ส่ง/ฟังได้ จึงแบ่งเป็น 2 กลุ่ม:

## 1. ฝั่ง ESP32 (plain text/JSON — ความปลอดภัยเท่าเดิมคือ Device ID ยาวๆ)

Base `pc-controller/<deviceId>` — รายละเอียดที่ [firmware/README.md](firmware/README.md#หัวข้อ-mqtt-topics):
`status`, `availability`, `cmd` (`toggle`), `sched` (ตารางเปิดคอม, retained), `notify` (agent → Discord ผ่าน ESP32)

## 2. ฝั่ง PC agent (เข้ารหัสทั้งหมด)

Base `pc-controller/agent-<agentId>` (agentId 8 hex สุ่มโดย agent)

| topic | retained | ทิศทาง | เนื้อหา |
|---|---|---|---|
| `availability` | ใช่ (LWT) | agent → มือถือ | `"online"` / `"offline"` (ไม่เข้ารหัส) |
| `state` | ใช่ | agent → มือถือ | envelope(`state`) — config ปัจจุบัน, โปรแกรมที่เลือก, รายการโปรแกรมที่สแกนได้, skipToday, postponedUntil |
| `cfg` | ใช่ | มือถือ → agent | envelope(`cmd`) — config ทั้งชุด (ไม่ใช่บางส่วน) retained เพื่อให้ agent ที่คอมปิดอยู่รับตอนบูต |
| `cmd` | ไม่ | มือถือ → agent | envelope(`cmd`) — คำสั่งครั้งเดียว: `{"type":"scan"}` |

### Envelope

JSON `{"n": base64(nonce 12 bytes), "c": base64(ciphertext ‖ tag 16 bytes)}` — AES-256-GCM
- กุญแจ = SHA-256(token เป็น ASCII hex 32 ตัว) · token ไม่เคยส่งผ่าน broker
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
40 ตัว hex = agentId (8) + token (32) — แสดงในหน้าต่าง agent, แอปมือถือรับทั้งก้อน (ขีด/เว้นวรรคไม่สำคัญ)
