# โค้ดที่ใช้ร่วมกันหลายโปรเจกต์

ธรรมนูญ (`C:\dev\CLAUDE.md` ข้อ 1) ห้าม `import` ข้ามโฟลเดอร์โปรเจกต์โดยเด็ดขาด
ถ้ามีโค้ดที่ต้องใช้ร่วมกันจริงๆ (เช่น type ร่วม, client SDK, util เฉพาะทาง) ให้ทำเป็น
**แพ็กเกจแยกต่างหาก** ตามขั้นตอนนี้:

1. สร้างเป็นโปรเจกต์ใหม่ตามปกติ (1 โฟลเดอร์ = 1 git repo):
   ```bash
   powershell -File C:\dev\.workspace\bin\new-project.ps1 -Name my-shared-lib -Type node
   ```
2. เขียนโค้ด export ผ่าน `package.json` ปกติ (`main`/`types` ชี้ไปที่ output ที่ build แล้ว)
3. ให้โปรเจกต์อื่นติดตั้งผ่าน **dependency ปกติ** ไม่ใช่ relative import:
   - จาก GitHub (แนะนำ เพราะ private repo อยู่แล้ว):
     ```bash
     npm install github:surakarn4327/my-shared-lib
     ```
   - หรือระหว่างพัฒนาในเครื่อง ใช้ `npm link` (ห้าม hardcode `file:../my-shared-lib`
     ลงใน `package.json` ที่จะ commit เพราะ path จะพังถ้าย้ายเครื่อง)

## ทำไมต้องแยก repo แทน monorepo

- แต่ละโปรเจกต์ยังคง deploy/version อิสระกัน ไม่ต้องรอกัน
- CI ของแพ็กเกจกลางพังไม่ทำให้โปรเจกต์อื่นแก้ไฟล์ไม่ได้
- ตรงกับกฎ "หนึ่งโปรเจกต์ = หนึ่ง git repo" ของธรรมนูญ ไม่ต้องมีข้อยกเว้น

## ข้อควรระวัง

- อย่าใส่ secret หรือ config เฉพาะโปรเจกต์ใดโปรเจกต์หนึ่งลงในแพ็กเกจกลาง
- เพิ่ม `CLAUDE.md` ในแพ็กเกจกลางให้ระบุชัดว่ามันถูกใครใช้บ้าง (กัน breaking change เงียบๆ)
