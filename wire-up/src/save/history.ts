// Snapshot-based undo / redo.

export class History {
  private stack: string[] = []
  private index = -1

  private limit = 120

  reset(snapshot: string): void {
    this.stack = [snapshot]
    this.index = 0
  }

  push(snapshot: string): void {
    if (this.stack[this.index] === snapshot) return
    this.stack = this.stack.slice(0, this.index + 1)
    this.stack.push(snapshot)
    if (this.stack.length > this.limit) this.stack.shift()
    this.index = this.stack.length - 1
  }

  undo(): string | null {
    if (this.index <= 0) return null
    this.index--
    return this.stack[this.index]
  }

  redo(): string | null {
    if (this.index >= this.stack.length - 1) return null
    this.index++
    return this.stack[this.index]
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1
  }
}
