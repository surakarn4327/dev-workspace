// Label-gap harness (dev only, not bundled). In the running dev page console: const h = await import('/scripts/label-gap-harness.js'); await h.harness()
// Draws every part with its real draw() + pin labels at 4 rotations in pixel and vector look, then prints the pixel gap between each label box
// and the nearest drawn ink. Every number should be 4 (LABEL_GAP); see style.md 3.5.
export async function harness(opts = {}) {
  const parts = await import('/src/parts/index.ts')
  const { Renderer } = await import('/src/render/renderer.ts')
  const { scene } = await import('/src/render/scene.ts')
  const K = 3, SIZE = 1000, OX = 500, OY = 260, BG = [35, 35, 43]
  const cv = document.createElement('canvas')
  cv.width = SIZE
  cv.height = SIZE
  const c = cv.getContext('2d', { willReadFrequently: true })
  const fake = Object.create(Renderer.prototype)
  fake.ctx = c
  const render = (def, part, withLabels) => {
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.fillStyle = `rgb(${BG})`
    c.fillRect(0, 0, SIZE, SIZE)
    c.setTransform(K, 0, 0, K, OX, OY)
    scene.labeled = withLabels ? new Set([part.id]) : new Set()
    c.save()
    c.translate(part.x, part.y)
    c.rotate((part.rot * Math.PI) / 2)
    def.draw(c, part, {}, 0)
    c.restore()
    if (withLabels) fake.drawPinLabels(part)
    c.setTransform(1, 0, 0, 1, 0, 0)
    return c.getImageData(0, 0, SIZE, SIZE).data
  }
  const components = (mask) => {
    const seen = new Uint8Array(SIZE * SIZE)
    const out = []
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (!mask[i] || seen[i]) continue
      let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1, n = 0
      const stack = [i]
      seen[i] = 1
      while (stack.length) {
        const p = stack.pop()
        const x = p % SIZE, y = (p / SIZE) | 0
        n++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
          const q = ny * SIZE + nx
          if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q) }
        }
      }
      if (n > 30) out.push({ x0, y0, x1, y1 })
    }
    return out
  }
  const results = {}
  for (const mode of opts.modes ?? ['pixel', 'vector']) {
    scene.pixel = mode === 'pixel'
    fake.pixelMode = scene.pixel
    for (const def of parts.ALL_PARTS) {
      if (['breadboard-mini', 'supply', 'meter'].includes(def.type)) continue
      const row = []
      for (let rot = 0; rot < 4; rot++) {
        const part = parts.newPart('t', def.type, 0, 0)
        part.rot = rot
        const bare = render(def, part, false)
        const full = render(def, part, true)
        const changed = new Uint8Array(SIZE * SIZE)
        const ink = []
        for (let i = 0; i < SIZE * SIZE; i++) {
          const o = i * 4
          if (full[o] !== bare[o] || full[o + 1] !== bare[o + 1] || full[o + 2] !== bare[o + 2]) changed[i] = 1
          if (Math.abs(bare[o] - BG[0]) + Math.abs(bare[o + 1] - BG[1]) + Math.abs(bare[o + 2] - BG[2]) > 60) ink.push(i)
        }
        const gaps = components(changed).map((L) => {
          let best = 1e9
          for (const i of ink) {
            const x = i % SIZE, y = (i / SIZE) | 0
            const s = Math.max(x - L.x1 - 1, L.x0 - x - 1, y - L.y1 - 1, L.y0 - y - 1, 0)
            if (s < best) best = s
          }
          return +(best / K).toFixed(1)
        })
        row.push(gaps.join(' '))
      }
      results[mode + ' ' + def.type] = row.join(' | ')
    }
  }
  scene.pixel = true
  scene.labeled = new Set()
  return results
}
