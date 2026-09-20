# bugs.md — pc-controller

log บั๊กที่เจอ+แก้จริงระหว่างพัฒนา/ทดสอบ ดูก่อนแก้โค้ดจุดที่เกี่ยวข้อง

---

## 1. ไลบรารีชื่อผิด: `ESP32Ping` ไม่มีจริงใน Arduino Library Manager

**อาการ**: `arduino-cli lib install "ESP32Ping"` ล้มเหลว `Library 'ESP32Ping@latest' not found`

**สาเหตุ**: ไลบรารีตัวเดิมของ marian-craciunescu ถูกสืบทอด/publish ใหม่ในชื่อ **`ESPping`** (โดย
dvarrel) — ชื่อ `ESP32Ping` ที่คิดไว้ตอนแรกไม่ตรงกับชื่อจริงในระบบ ทั้งที่ header ภายในยังใช้ชื่อ
`ESP32Ping.h` ในคอมเมนต์ต้นไฟล์ของไลบรารีเอง ทำให้เข้าใจผิดได้ง่าย

**วิธีแก้**: ใช้ชื่อ `ESPping` ตอน install (`arduino-cli lib install "ESPping"`) และ
`#include <ESPping.h>` ในโค้ด — API (`Ping.ping(ip, count)`) เหมือนเดิมทุกอย่าง

---

## 2. WiFiManager ข้าม captive portal ไปเงียบๆ เพราะจำ wifi เดิมได้

**อาการ**: Flash firmware ครั้งแรก คาดว่าจะเห็น wifi hotspot `PC-Controller-Setup` แต่ไม่เจอเลย —
บอร์ดต่อ wifi บ้านสำเร็จเงียบๆ โดยไม่เคยเปิด portal ให้กรอกค่า custom (HiveMQ/Device ID ฯลฯ)
เลยค้างเป็นค่า default ว่างเปล่าไปหมด

**สาเหตุ**: บอร์ด ESP32 ตัวนี้เคยต่อ wifi บ้านมาก่อนจากโปรเจกต์อื่น ค่า SSID/password ถูกเก็บไว้ใน
wifi storage ของตัวชิปเอง (คนละที่กับ `Preferences` ที่โค้ดนี้ใช้เก็บ custom params) —
`WiFiManager::autoConnect()` เจอ credential เดิมที่ใช้ได้ เลยต่อสำเร็จทันทีและ**ข้ามการเปิด portal
ไปเลย** ซึ่งเป็นพฤติกรรม by-design ของไลบรารี ไม่ใช่บั๊กของ WiFiManager เอง — พังเพราะไม่ได้คาดถึง
ว่าค่า wifi กับค่า custom params ของเราอยู่คนละที่กัน

**วิธีแก้**: [`firmware/pc-controller/pc-controller.ino`](firmware/pc-controller/pc-controller.ino)
`setupWifi()` — เช็คก่อนว่า `cfgDeviceId` ว่างอยู่ไหม (แปลว่ายังไม่เคย provisioning โปรเจกต์นี้สำเร็จ)
ถ้าว่าง เรียก `wm.resetSettings()` บังคับให้ล้าง wifi credential เดิมทิ้งก่อน `autoConnect()` เสมอ
ทำให้ portal เปิดแน่นอนในการตั้งค่าครั้งแรก ไม่ว่าบอร์ดจะเคยต่อ wifi อะไรมาก่อนก็ตาม

---

## 3. GPIO pin ในโค้ดไม่ตรงกับที่ต่อสายจริง

**อาการ**: ยืนยันแล้วว่า MQTT/ซอฟต์แวร์ทำงานถูกต้อง (`[relay] pulse triggered` ขึ้นใน serial log)
แต่ relay module ไม่ขยับ/ไม่มีเสียงคลิกเลย

**สาเหตุ**: โค้ดตั้ง `RELAY_PIN = 26` ตามค่า default ที่เดาไว้ตอนเขียนครั้งแรก แต่สายจริงต่อไว้ที่
**GPIO 23**

**วิธีแก้**: แก้ `RELAY_PIN` เป็น `23` ให้ตรงกับที่ต่อสายจริง — บทเรียน: เวลาเขียนโค้ดที่ผูกกับพินจริง
ควรถามยืนยันว่าต่อขาไหนจริงๆ ก่อน แทนที่จะเดาเลขพินไปตั้งค่า default ล่วงหน้า

---

## 4. Windows Firewall บล็อก ICMP ping โดย default — เช็คสถานะผิดตลอด

**อาการ**: เว็บแอปขึ้น "คอมปิดอยู่" ตลอด ทั้งที่คอมเปิดอยู่จริง

**สาเหตุ** (มี 2 ชั้นซ้อนกัน — ต้องแก้ทั้งคู่):

1. `cfgPcIp` ที่บันทึกไว้เป็นค่า default เดิม (`192.168.1.100`) ไม่ตรงกับ IP จริงของคอม
   (`192.168.1.40`) เพราะฟอร์ม captive portal ไม่เคยถูกกรอกค่าจริงให้ (เกี่ยวโยงกับบั๊ก #2)
2. **แม้แก้ IP ถูกแล้ว** — Windows ปิดการตอบ ICMP Echo Request (`ping`) ไว้เป็นค่า default ของทุก
   เครื่อง (inbound firewall rule "File and Printer Sharing (Echo Request - ICMPv4-In)" เป็น
   `Enabled: False` โดย default) ทำให้ ping จาก ESP32 ไปเจอ "ไม่ตอบ" เสมอ ต่อให้ IP ถูกก็ตาม

**วิธีแก้**:
- แก้ IP ให้ตรงของจริง (แก้ผ่าน `Preferences` โดยตรงในรอบทดสอบ ไม่ต้องเข้า captive portal ใหม่)
- เปลี่ยนวิธีเช็คสถานะจาก ICMP ping เป็น **ARP** แทนทั้งหมด — ดูรายละเอียดใน
  [firmware/README.md](firmware/README.md#เช็คสถานะเปิดปิดด้วย-arp-แทน-ping) — อุปกรณ์ปฏิเสธ ARP
  ไม่ได้ (ต่างจาก ICMP ที่ Windows เลือกเพิกเฉยได้) เลยไม่ต้องพึ่งการตั้งค่า firewall ของเครื่องเป้าหมาย
  เลย ทนทานกว่าเดิมมาก โดยเฉพาะกรณีลง Windows ใหม่หรือย้าย ESP32 ไปคอมเครื่องอื่น
