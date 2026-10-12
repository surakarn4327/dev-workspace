// What a device on the I2C bus has to be. No DOM, nothing from the rest of the app.

/** A device on the I2C bus. */
export interface I2cDevice {
  /** The 7-bit address it answers to. */
  address: number
  /** A transmission addressed to it (the data bytes). Returns 0 when it answered every byte, 3 when it did not. */
  write(data: number[]): number
  /** `count` bytes for a master that reads. */
  read(count: number): number[]
  /** Lost its power: back to the state of a chip just switched on. */
  reset(): void
  /** What a picture of the device needs, as numbers (a part's `live` values). */
  live?(): Record<string, number>
}
