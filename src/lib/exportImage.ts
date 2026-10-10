/** Render the live SVG map to a PNG, resolving CSS variables so the image matches the screen. */
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const css = getComputedStyle(document.documentElement)
  // walk the live tree and its clone together, baking computed colours into attributes
  const live = [svg, ...svg.querySelectorAll<SVGElement>('*')]
  const copy = [clone, ...clone.querySelectorAll<SVGElement>('*')]
  live.forEach((el, i) => {
    const c = copy[i]!
    const cs = getComputedStyle(el)
    if (el.tagName === 'stop') c.setAttribute('stop-color', cs.stopColor)
    else {
      if (el.getAttribute('fill') !== null || el.style.fill) {
        const f = el.getAttribute('fill')
        c.setAttribute('fill', f && f.startsWith('url(') ? f : cs.fill)
      }
      if (el.getAttribute('stroke') !== null) {
        const st = el.getAttribute('stroke')
        c.setAttribute('stroke', st && st.startsWith('url(') ? st : cs.stroke)
      }
    }
    c.removeAttribute('class') // no animations in the snapshot
    c.removeAttribute('style')
    if (el.tagName === 'image') c.remove() // cross-origin icons would taint the canvas
  })
  const box = svg.viewBox.baseVal
  const size = 1200
  clone.setAttribute('width', String(size))
  clone.setAttribute('height', String(size))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('font-family', css.getPropertyValue('--font-sans') || 'system-ui, sans-serif')
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(box.x))
  bg.setAttribute('y', String(box.y))
  bg.setAttribute('width', String(box.width))
  bg.setAttribute('height', String(box.height))
  bg.setAttribute('fill', css.getPropertyValue('--bg').trim() || '#fff')
  clone.insertBefore(bg, clone.firstChild)

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok()
      img.onerror = () => fail(new Error('Could not render the map'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = size * scale
    canvas.height = size * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, size, size)
    ctx.font = `500 16px ${css.getPropertyValue('--font-sans') || 'sans-serif'}`
    ctx.fillStyle = css.getPropertyValue('--ink-3').trim() || '#888'
    ctx.fillText('Inbox Bubble Map · inbox-bubble-map.vercel.app', 24, size - 24)
    return await new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob failed'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
