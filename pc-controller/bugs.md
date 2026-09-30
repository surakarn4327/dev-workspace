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

---

## 5. GitHub Actions มองไม่เห็น workflow ที่อยู่ในโฟลเดอร์ย่อยของ monorepo

**อาการ**: push ขึ้น GitHub แล้ว รอ workflow deploy รันแต่ไม่มีอะไรเกิดขึ้นเลย เช็คผ่าน
`gh api repos/.../actions/runs` และ `.../actions/workflows` เจอ `"total_count": 0` ทั้งคู่ —
GitHub ไม่รู้จัก workflow นี้อยู่เลย ทั้งที่ push ไฟล์ `.yml` ขึ้นไปแล้วจริง (เช็คด้วย
`gh api repos/.../contents/pc-controller/.github/workflows` ยืนยันว่าไฟล์อยู่บน remote จริง)

**สาเหตุ**: `new-project.ps1` (สคริปต์ scaffold กลางของ workspace) สร้าง `.github/workflows/ci.yml`
ไว้ **ข้างในโฟลเดอร์ของแต่ละโปรเจกต์** (เช่น `pc-controller/.github/workflows/`) แต่ **GitHub Actions
จะอ่าน workflow เฉพาะจาก `.github/workflows/` ที่ root ของ repo เท่านั้น** — ไม่มองเข้าไปในโฟลเดอร์ย่อย
เลยแม้แต่น้อย นี่คือข้อจำกัดของ GitHub เอง ไม่ใช่บั๊กที่แก้ผ่าน config ได้ ปัญหานี้น่าจะกระทบ **ทุก
โปรเจกต์อื่นในเดียวกัน**ที่ใช้ scaffold script เดียวกันนี้ด้วย (ยังไม่ได้ไปเช็ค/แก้โปรเจกต์อื่น)

**วิธีแก้**: ย้าย `pc-controller/.github/workflows/*.yml` ไปไว้ที่
[`dev-workspace/.github/workflows/`](../.github/workflows/) (root ของ repo) ตั้งชื่อไฟล์แบบมี prefix
`pc-controller-` กันชนกับ workflow ของโปรเจกต์อื่นในอนาคต และใส่ `paths: ['pc-controller/**']` +
`defaults.run.working-directory: pc-controller` ไว้ในแต่ละ workflow เพื่อให้รันเฉพาะตอนแตะไฟล์ใน
โฟลเดอร์นี้ และ build ในโฟลเดอร์ที่ถูกต้อง

---

## 6. GitHub Pages ใช้กับ private repo ไม่ได้ (ต้อง public หรืออัปเกรดเสียเงิน)

**อาการ**: workflow deploy รันผ่าน build สำเร็จ แต่ step `actions/deploy-pages@v4` fail ด้วย
`Failed to create deployment (status: 404) ... Ensure GitHub Pages has been enabled` — เข้าไปดูหน้า
repo Settings → Pages เจอข้อความ "Upgrade or make this repository public to enable Pages"

**สาเหตุ**: GitHub Pages (ฟรี) ใช้ได้เฉพาะกับ **public repo** เท่านั้น ส่วน private repo ต้องอัปเกรด
เป็นแผนเสียเงินถึงจะเปิด Pages ได้ — `dev-workspace` เป็น private repo โดยตั้งใจตามกฎ workspace
(มีโค้ดโปรเจกต์อื่นที่ไม่อยากเปิดเผย) เลยเปิด Pages ไม่ได้เลยไม่ว่าจะตั้งค่า workflow ถูกแค่ไหนก็ตาม
เป็นข้อจำกัดของ GitHub เอง ไม่ใช่บั๊กที่แก้ผ่าน workflow config ได้

**วิธีแก้**: เปลี่ยนไปใช้ **Vercel** แทน — ฟรี ไม่ผูกบัตร รองรับ deploy จาก private repo ได้ตรงๆ
(เชื่อมผ่าน GitHub App ที่ขอสิทธิ์เฉพาะ repo ไม่ทำให้ repo เป็น public) ตั้งค่า **Root Directory**
เป็น `pc-controller` ในหน้า Vercel project settings แล้วปล่อยให้ Vercel auto-deploy ทุกครั้งที่ push
เอง ไม่ต้องมี GitHub Actions workflow สำหรับ deploy อีกต่อไป (ลบ `pc-controller-deploy.yml` ทิ้ง
เหลือแค่ `pc-controller-ci.yml` ไว้ type-check) — ดูขั้นตอนเต็มใน [README.md](README.md)

---

## 7. กดปุ่ม power ครั้งเดียว แต่คอมเปิดแล้วดับเองภายในไม่กี่วินาที

**อาการ**: ทดสอบจริงบน production (`pc-controller-eight.vercel.app`) กดปุ่ม power ค้าง 3 วิครั้งเดียว
— คอมเปิดติดจริง แต่ดับไปเองอีกครั้งภายในไม่กี่วินาทีถัดมา ทั้งที่ไม่ได้กดปุ่มซ้ำ

**สาเหตุ** (ยังไม่ยืนยัน root cause 100% เพราะเหตุการณ์จริงไม่มี serial log คาอยู่ตอนนั้น แต่ระหว่าง
ทดสอบก่อนหน้านี้ในเซสชันเดียวกัน เคยสังเกตว่า log `[mqtt] message ... toggle` / `[relay] pulse
triggered` ขึ้น **ซ้ำ 2 ครั้ง** จากการจำลองกดปุ่มแค่ 1 ครั้งเหมือนกัน) — ตั้งสมมติฐานว่า ESP32 ได้รับ
คำสั่ง `"toggle"` ซ้ำจาก MQTT (อาจเพราะ broker สาธารณะ `broker.emqx.io` ส่งข้อความซ้ำ หรือ resubscribe
ซ้อนตอน reconnect) ทำให้ relay กดปุ่ม power **สองครั้งติดกัน** — ครั้งแรกเปิดเครื่อง ครั้งที่สอง (ที่ไม่
ตั้งใจ) เหมือนไปกดปุ่ม power ซ้ำตอนเครื่องเปิดอยู่แล้ว ซึ่งเมนบอร์ด/Windows ส่วนใหญ่ตีความเป็นคำสั่ง
shutdown ทันที

**วิธีแก้**: [`firmware/pc-controller/pc-controller.ino`](firmware/pc-controller/pc-controller.ino)
`onMqttMessage()` — เพิ่ม debounce ระดับเฟิร์มแวร์ (`TOGGLE_DEBOUNCE_MS = 2000`) เพิกเฉยคำสั่ง
`"toggle"` ที่มาซ้ำภายใน 2 วินาทีจากครั้งก่อนหน้า ป้องกันปัญหานี้ได้ไม่ว่าสาเหตุจริงจะมาจากไหน (MQTT
ส่งซ้ำ, เว็บแอป publish ซ้ำ, หรือผู้ใช้กดซ้ำโดยไม่ตั้งใจ) เพราะการกดค้าง 1 ครั้งไม่มีทางตั้งใจสั่ง toggle
สองครั้งภายใน 2 วินาทีอยู่แล้ว

**หมายเหตุ**: แก้ debounce แล้วอาการยังไม่หาย — ตัวการจริงคือบั๊ก #8 (ขั้ว relay กลับด้าน) ต่างหาก
debounce ยังคงมีประโยชน์เก็บไว้เป็นการป้องกันซ้อนอีกชั้น แต่ไม่ใช่สาเหตุหลักของอาการนี้

---

## 8. ขั้ว relay กลับด้าน (`RELAY_ACTIVE_HIGH`) ทำให้กดเปิดแล้วคอมดับเองใน 2-3 วิ

**อาการ**: กดปุ่ม power ในแอปครั้งเดียว (ไม่ซ้ำ ไม่ใช่บั๊ก MQTT ซ้ำแบบบั๊ก #7) — relay ทำงาน 1 วิ
ตามที่ตั้งไว้ คอมเปิดติดจริง **แต่ดับไปเองอีกครั้งภายในไม่กี่วินาทีถัดมา** ทุกครั้งไม่มีข้อยกเว้น

**สาเหตุ**: โค้ดตั้ง `RELAY_ACTIVE_HIGH = true` (คิดว่าโมดูล relay ทำงานตอนสัญญาณเป็น HIGH) แต่โมดูล
relay ราคาประหยัดทั่วไปส่วนใหญ่เป็นแบบ **active-LOW** (ทำงานตอนสัญญาณเป็น LOW) — ผลจากขั้วกลับด้าน:

1. สถานะ idle ปกติ (ไม่มีคำสั่ง) → โค้ดส่ง LOW ตลอดเวลา → บนโมดูล active-low นี้คือ **relay
   ปิดวงจรค้างตลอดเวลา** (เหมือนมีคนกดปุ่ม power ค้างไว้ตลอด แต่เมนบอร์ดไม่ทำอะไรเพราะเป็นสถานะนิ่งๆ
   ไม่ใช่การกด/ปล่อยที่แท้จริง)
2. กด "เปิด" ในแอป → โค้ดสั่ง HIGH ชั่วคราวตาม `HOLD_MS` → บนโมดูลนี้คือ **relay ปล่อยวงจร (ปุ่มถูก
   ปล่อย)** ตรงข้ามกับที่ตั้งใจ
3. ครบเวลา โค้ดสั่งกลับเป็น LOW → **relay ปิดวงจรอีกครั้ง (เท่ากับกดปุ่มลงตอนนี้พอดี)** — นี่คือจังหวะ
   ที่คอมเปิดจริงๆ (ไม่ใช่ตอนเริ่ม pulse อย่างที่ตั้งใจ)
4. หลังจากนั้น relay ค้างปิดวงจรต่อเนื่องตลอดไป (กลับสู่ idle state ที่ผิดขั้ว) → เมนบอร์ดตีความว่า
   "ปุ่ม power ถูกกดค้างไว้นานเกิน ~4 วิ" ตามมาตรฐาน ATX → **สั่ง force shutdown ให้เอง** ทุกครั้ง

ผลข้างเคียงอีกอย่าง: relay จะดึงกระแสไฟต่อเนื่องตลอดเวลาที่ idle (แทนที่จะดึงแค่ตอน pulse สั้นๆ)
เพราะขดลวดถูก energize ค้างไว้เกือบตลอดเวลา — อาจเป็นสาเหตุร่วมของอาการไฟตก/ESP32 รีเซ็ตตัวเองที่
เคยสังเกตด้วย (ยังไม่ยืนยัน)

**วิธีแก้**: เปลี่ยน `RELAY_ACTIVE_HIGH` จาก `true` เป็น `false` ใน
[`firmware/pc-controller/pc-controller.ino`](firmware/pc-controller/pc-controller.ino) — ถ้าใช้
relay module ต่างรุ่นในอนาคตที่เป็น active-HIGH จริง ค่อยเปลี่ยนกลับ (เช็ค datasheet/ทดสอบจริงของ
โมดูลนั้นๆ ก่อนเสมอ อย่าสันนิษฐานเอาเอง)

---

## 9. Arduino คอมไพล์ไม่ผ่าน: `'PowerOnSchedule' has not been declared`

**อาการ**: เพิ่ม `struct PowerOnSchedule` กลางไฟล์ `.ino` (ใกล้ฟังก์ชัน `parseSchedule`) แล้ว `arduino-cli compile`
ล้มเหลวด้วย `'PowerOnSchedule' has not been declared` ที่บรรทัดประกาศฟังก์ชันที่รับ struct นั้นเป็นพารามิเตอร์

**สาเหตุ**: Arduino สร้าง function prototype ให้ทุกฟังก์ชันอัตโนมัติแล้วแปะไว้ **บนสุดของไฟล์** ก่อนโค้ดจริง —
prototype ของ `parseSchedule(const String&, PowerOnSchedule&)` จึงมาก่อนบรรทัดที่ประกาศ struct ทำให้คอมไพเลอร์ไม่รู้จักชนิดนี้

**วิธีแก้**: ย้ายนิยาม `struct` ขึ้นไปไว้ส่วนบนของไฟล์ (ก่อนฟังก์ชันใดๆ) — บทเรียน: ชนิดข้อมูล (struct/enum/class)
ที่ใช้เป็นพารามิเตอร์ของฟังก์ชันใน `.ino` ต้องประกาศไว้บนสุดเสมอ

---

## 10. Vite dev server ตายด้วย `EBUSY` ตอน `dotnet build` ทำงาน

**อาการ**: dev server (พอร์ต 5170) ดับเองกลางคัน exit code 1 หน้าเว็บขาวใน Browser pane — log ขึ้น
`EBUSY: resource busy or locked, watch '...\agent\obj\<guid>.tmp'`

**สาเหตุ**: Vite/chokidar เฝ้าไฟล์ทั้งโฟลเดอร์โปรเจกต์ รวมถึง `agent/` (โค้ด C#) ที่ `dotnet build` สร้าง-ลบไฟล์ `.tmp`
ใน `agent/obj/` ตลอด — พอ watcher พยายาม watch ไฟล์ที่ถูกล็อก/หายไปแล้วก็ throw จนโปรเซสตาย

**วิธีแก้**: [`vite.config.ts`](vite.config.ts) `server.watch.ignored` = `**/agent/**`, `**/firmware/**`, `**/scripts/**`
— โฟลเดอร์ที่ไม่ใช่เว็บแอปไม่ควรให้ Vite เฝ้าเลย

---

## 11. หน้าต่างนับถอยหลังของ agent: ปุ่ม "ข้ามวันนี้" ถือ keyboard focus ตอนเด้ง

**อาการ**: ตอนทดสอบ เหตุการณ์ "มีคนกดข้ามการปิดคอมของวันนี้" โผล่ภายในไม่กี่วินาทีหลังหน้าต่างเด้งหลายรอบ
(ตอนนั้นมีคนนั่งหน้าจออยู่ จึงยืนยันไม่ได้ว่าเป็นการกดเมาส์จริงหรือคีย์ที่เผลอพิมพ์) ส่วนรอบที่ย้ายหน้าต่างออกนอกจอด้วย
Win32 `SetWindowPos` กันคนกด ระบบนับจนหมดแล้วปิดเครื่อง (dry-run) ถูกต้อง — ตัวตรรกะนับถอยหลังจึงไม่ใช่ต้นเหตุ

**สาเหตุ**: ภาพหน้าจอตอนทดสอบเห็นว่ามีปุ่มถือ focus (กรอบสีฟ้า) ตั้งแต่หน้าต่างเด้ง (ครั้งหนึ่งเป็น "เลื่อน 15 นาที"
อีกครั้งเป็น "ข้ามวันนี้") — หน้าต่างเด้งมาอยู่หน้าสุดตอนที่คนอาจกำลังพิมพ์งานอยู่ในโปรแกรมอื่น คีย์ Enter/Space ที่พิมพ์ไป
จะไปกดปุ่มที่ถือ focus แทน ทำให้ตารางปิดคอมโดนข้ามหรือเลื่อนเงียบๆ โดยไม่ตั้งใจ

**วิธีแก้**: [`agent/CountdownForm.cs`](agent/CountdownForm.cs) ตั้ง `TabStop = false` ให้ทุกปุ่ม ไม่ให้ปุ่มไหนถือ focus
ตอนหน้าต่างเด้ง (เมาส์คลิกยังทำงานปกติ) · ยังไม่ได้พิสูจน์ว่าการข้ามตอนทดสอบเกิดจากสาเหตุนี้จริง แต่เป็นความเสี่ยงจริงที่ปิดไว้ก่อน
