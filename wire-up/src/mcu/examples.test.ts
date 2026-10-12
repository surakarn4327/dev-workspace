// The standard sketches that come with the Arduino IDE (File > Examples), word for word where the language allows: they must compile
// and do what the real board does.

import { describe, expect, it } from 'vitest'
import { errorOf, run } from './testkit.ts'

const lines = (s: string): string[] => s.split('\r\n')

describe('Arduino IDE examples', () => {
  it('01.Basics Blink', () => {
    const { log } = run(
      `void setup() { pinMode(LED_BUILTIN, OUTPUT); }
       void loop() { digitalWrite(LED_BUILTIN, HIGH); delay(1000); digitalWrite(LED_BUILTIN, LOW); delay(1000); }`,
      4.5,
    )
    expect(log.writes.map(([, v]) => v)).toEqual([1, 0, 1, 0, 1])
    expect(log.writes[1][2]).toBeCloseTo(1, 2)
  })

  it('01.Basics Fade: the brightness walks up by 5 and back down', () => {
    const { log } = run(
      `int led = 9;
       int brightness = 0;
       int fadeAmount = 5;
       void setup() { pinMode(led, OUTPUT); }
       void loop() {
         analogWrite(led, brightness);
         brightness = brightness + fadeAmount;
         if (brightness <= 0 || brightness >= 255) { fadeAmount = -fadeAmount; }
         delay(30);
       }`,
      3.5,
    )
    const v = log.pwm.map(([, x]) => x)
    expect(v.slice(0, 4)).toEqual([0, 5, 10, 15])
    expect(v[51]).toBe(255)
    // the step that reached 255 turned the direction round, so the next write is already on the way down
    expect(v[52]).toBe(250)
    expect(v[53]).toBe(245)
    expect(Math.max(...v)).toBe(255)
    expect(log.pwm.every(([p]) => p === 9)).toBe(true)
    // 30 ms apart
    expect(log.pwm[1][2] - log.pwm[0][2]).toBeCloseTo(0.03, 3)
  })

  it('01.Basics AnalogReadSerial', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600); }
       void loop() { int sensorValue = analogRead(A0); Serial.println(sensorValue); delay(1); }`,
      0.1,
      (l) => {
        l.analog[14] = 733
      },
    )
    const out = lines(log.serial).filter((x) => x !== '')
    expect(out.length).toBeGreaterThan(10)
    expect(new Set(out)).toEqual(new Set(['733']))
  })

  it('02.Digital DigitalReadSerial', () => {
    const { log } = run(
      `int pushButton = 2;
       void setup() { Serial.begin(9600); pinMode(pushButton, INPUT); }
       void loop() { int buttonState = digitalRead(pushButton); Serial.println(buttonState); delay(1); }`,
      0.2,
      (l) => {
        l.level = (_p, t) => (t < 0.1 ? 0 : 1)
      },
    )
    const out = lines(log.serial).filter((x) => x !== '')
    expect(out[0]).toBe('0')
    expect(out[out.length - 1]).toBe('1')
  })

  it('02.Digital Button', () => {
    const src = `
      const int buttonPin = 2;
      const int ledPin = 13;
      int buttonState = 0;
      void setup() { pinMode(ledPin, OUTPUT); pinMode(buttonPin, INPUT); }
      void loop() {
        buttonState = digitalRead(buttonPin);
        if (buttonState == HIGH) { digitalWrite(ledPin, HIGH); } else { digitalWrite(ledPin, LOW); }
      }`
    const down = run(src, 0.05, (l) => {
      l.level = () => 1
    })
    expect(down.log.writes.at(-1)![1]).toBe(1)
    const up = run(src, 0.05, (l) => {
      l.level = () => 0
    })
    expect(up.log.writes.at(-1)![1]).toBe(0)
  })

  it('02.Digital Debounce: a bouncing press toggles the LED once', () => {
    const { log } = run(
      `const int buttonPin = 2;
       const int ledPin = 13;
       int ledState = HIGH;
       int buttonState;
       int lastButtonState = LOW;
       unsigned long lastDebounceTime = 0;
       unsigned long debounceDelay = 50;
       void setup() { pinMode(buttonPin, INPUT); pinMode(ledPin, OUTPUT); digitalWrite(ledPin, ledState); }
       void loop() {
         int reading = digitalRead(buttonPin);
         if (reading != lastButtonState) { lastDebounceTime = millis(); }
         if ((millis() - lastDebounceTime) > debounceDelay) {
           if (reading != buttonState) {
             buttonState = reading;
             if (buttonState == HIGH) { ledState = !ledState; }
           }
         }
         digitalWrite(ledPin, ledState);
         lastButtonState = reading;
       }`,
      1,
      (l) => {
        // the press at 300 ms bounces for 10 ms, then holds
        l.level = (_p, t) => (t < 0.3 ? 0 : t < 0.302 ? 1 : t < 0.304 ? 0 : t < 0.306 ? 1 : t < 0.308 ? 0 : 1)
      },
    )
    const states = log.writes.filter(([p]) => p === 13).map(([, v]) => v)
    // starts on, goes off once the press has settled, and stays off
    expect(states[0]).toBe(1)
    expect(states.at(-1)).toBe(0)
    expect(states.filter((v, i) => i > 0 && v !== states[i - 1]).length).toBe(1)
  })

  it('02.Digital toneMelody', () => {
    const { log } = run(
      `#define NOTE_B3 247
       #define NOTE_C4 262
       #define NOTE_G3 196
       #define NOTE_A3 220
       int melody[] = { NOTE_C4, NOTE_G3, NOTE_G3, NOTE_A3, NOTE_G3, 0, NOTE_B3, NOTE_C4 };
       int noteDurations[] = { 4, 8, 8, 4, 4, 4, 4, 4 };
       void setup() {
         for (int thisNote = 0; thisNote < 8; thisNote++) {
           int noteDuration = 1000 / noteDurations[thisNote];
           tone(8, melody[thisNote], noteDuration);
           int pauseBetweenNotes = noteDuration * 1.30;
           delay(pauseBetweenNotes);
           noTone(8);
         }
       }
       void loop() {}`,
      3,
    )
    const starts = log.tones.filter(([, f]) => f > 0).map(([, f]) => f)
    expect(starts).toEqual([262, 196, 196, 220, 196, 247, 262])
    // the first note: 250 ms of tone, then the pause of 325 ms in all
    const firstOff = log.tones.find(([, f]) => f === 0)!
    expect(firstOff[2]).toBeCloseTo(0.25, 2)
    // all eight notes take 325 + 162 + 162 + 325 * 5 ms... = 2.275 s
    expect(log.tones.at(-1)![2]).toBeGreaterThan(2.2)
  })

  it('toneMelody with the modern sizeof loop', () => {
    const { log } = run(
      `int melody[] = { 262, 196, 196 };
       int noteDurations[] = { 4, 8, 8 };
       void setup() {
         for (int thisNote = 0; thisNote < sizeof(melody) / sizeof(melody[0]); thisNote++) {
           int noteDuration = 1000 / noteDurations[thisNote];
           tone(8, melody[thisNote], noteDuration);
           delay(noteDuration * 1.30);
           noTone(8);
         }
       }
       void loop() {}`,
      1,
    )
    expect(log.tones.filter(([, f]) => f > 0).length).toBe(3)
  })

  it('04.Communication ShiftOut-style counter on a 74HC595', () => {
    const { log } = run(
      `int latchPin = 8;
       int clockPin = 12;
       int dataPin = 11;
       void setup() { pinMode(latchPin, OUTPUT); pinMode(dataPin, OUTPUT); pinMode(clockPin, OUTPUT); }
       void loop() {
         for (int numberToDisplay = 0; numberToDisplay < 3; numberToDisplay++) {
           digitalWrite(latchPin, LOW);
           shiftOut(dataPin, clockPin, MSBFIRST, numberToDisplay);
           digitalWrite(latchPin, HIGH);
           delay(500);
         }
       }`,
      1.2,
    )
    const latch = log.writes.filter(([p]) => p === 8).map(([, v]) => v)
    expect(latch.slice(0, 6)).toEqual([0, 1, 0, 1, 0, 1])
    const data = log.writes.filter(([p]) => p === 11).map(([, v]) => v)
    expect(data.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(data.slice(8, 16)).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(data.slice(16, 24)).toEqual([0, 0, 0, 0, 0, 0, 1, 0])
    // the latch goes low, the clocking happens, then the latch goes high: the order in time is kept
    const t = log.writes.map(([p, , time]) => [p, time])
    const firstData = t.findIndex(([p]) => p === 11)
    const latchHigh = t.findIndex(([p], i) => p === 8 && i > firstData)
    expect(latchHigh).toBeGreaterThan(firstData)
  })

  it('EEPROM Read: walks the cells and wraps at the length', () => {
    const { log } = run(
      `#include <EEPROM.h>
       int address = 0;
       byte value;
       void setup() { Serial.begin(9600); }
       void loop() {
         value = EEPROM.read(address);
         Serial.print(address);
         Serial.print("\\t");
         Serial.print(value, DEC);
         Serial.println();
         address = address + 1;
         if (address == EEPROM.length()) { address = 0; }
         delay(500);
       }`,
      1.2,
    )
    expect(lines(log.serial).slice(0, 3)).toEqual(['0\t255', '1\t255', '2\t255'])
  })

  it('EEPROM Write: stores the analog reading / 4 and moves on', () => {
    const { m } = run(
      `#include <EEPROM.h>
       int addr = 0;
       void setup() {}
       void loop() {
         int val = analogRead(0) / 4;
         EEPROM.write(addr, val);
         addr = addr + 1;
         if (addr == EEPROM.length()) { addr = 0; }
         delay(100);
       }`,
      0.45,
      (l) => {
        l.analog[14] = 512
      },
    )
    expect(Array.from(m.eeprom.slice(0, 6))).toEqual([128, 128, 128, 128, 128, 255])
    expect(m.eepromDirty).toBe(true)
  })

  it('EEPROM Update keeps a cell that already holds the value (no wear)', () => {
    const { m } = run(`void setup() { EEPROM.update(0, 255); EEPROM.update(1, 9); } void loop() {}`, 0.1)
    expect(m.eeprom[0]).toBe(255)
    expect(m.eeprom[1]).toBe(9)
  })
})

describe('what the engine still refuses, and says so', () => {
  it('interrupts are named as not available yet', () => {
    expect(errorOf('void isr() {} void setup() { attachInterrupt(0, isr, RISING); } void loop() {}').message).toContain('not supported')
  })
})
