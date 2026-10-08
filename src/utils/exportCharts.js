const SVG_NS = 'http://www.w3.org/2000/svg'

const EXPORT_STYLE = `
.axis-label{fill:#5f687a;font-family:'DM Mono',monospace;font-size:18px;font-weight:500}
.axis-title{fill:#4f596d;font-family:'DM Mono',monospace;font-size:12px;font-weight:500;letter-spacing:.02em}
.threshold-label{fill:#b33f50;font-family:'DM Mono',monospace;font-size:11px;font-weight:600}
.export-legend{fill:#586172;font-family:'DM Mono',monospace;font-size:12px;font-weight:600}
.export-legend-swatch{stroke:#fff;stroke-width:1}
.export-chart-title{fill:#1d2433;font-family:'DM Mono',monospace;font-size:13px;font-weight:700}
`

const asFiniteNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function readDimensions(svg) {
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number) ?? []
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { minX: viewBox[0], minY: viewBox[1], width: viewBox[2], height: viewBox[3] }
  }
  const width = asFiniteNumber(svg.getAttribute('width'), 920)
  const height = asFiniteNumber(svg.getAttribute('height'), 390)
  return { minX: 0, minY: 0, width: Math.max(width, 1), height: Math.max(height, 1) }
}

function readColor(element) {
  if (!element) return '#6d5dfc'
  const style = element.getAttribute?.('style') ?? ''
  const styleMatch = style.match(/(?:^|;)\s*(?:background|background-color)\s*:\s*([^;]+)/i)
  return styleMatch?.[1]?.trim() || element.getAttribute?.('fill') || element.style?.backgroundColor || '#6d5dfc'
}

function normalizeLegendEntries(entries) {
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    if (typeof entry === 'string') return [{ label: entry, color: '#6d5dfc' }]
    if (!entry || typeof entry !== 'object') return []
    const label = String(entry.label ?? entry.name ?? '').trim()
    return label ? [{ label, color: entry.color ?? '#6d5dfc' }] : []
  })
}

function suppliedLegendEntries(svg, chartIndex, options) {
  const supplied = options?.legendEntries
  if (typeof supplied === 'function') return normalizeLegendEntries(supplied(svg, chartIndex))
  if (Array.isArray(supplied)) {
    const isSingleLegend = supplied.every((entry) => typeof entry === 'string' || (entry && typeof entry === 'object' && !Array.isArray(entry)))
    return normalizeLegendEntries(isSingleLegend ? supplied : supplied[chartIndex])
  }
  return []
}

function readLegendEntries(svg, chartIndex, options) {
  const supplied = suppliedLegendEntries(svg, chartIndex, options)
  if (supplied.length) return supplied

  // The live legend is rendered next to the SVG rather than inside it. Read it
  // before cloning so exported SVGs retain the file-to-colour mapping.
  const legend = svg.parentElement?.querySelector('.chart-legend')
  if (!legend) return []
  return [...legend.querySelectorAll('span')].flatMap((entry) => {
    const label = (entry.textContent ?? '').trim()
    return label ? [{ label, color: readColor(entry.querySelector('i')) }] : []
  })
}

function rewriteReferences(svg, suffix) {
  const ids = new Map()
  svg.querySelectorAll('[id]').forEach((element) => {
    const oldId = element.getAttribute('id')
    if (!oldId) return
    const nextId = `${oldId}-${suffix}`
    ids.set(oldId, nextId)
    element.setAttribute('id', nextId)
  })
  if (!ids.size) return

  svg.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value
      ids.forEach((nextId, oldId) => {
        value = value.replaceAll(`url(#${oldId})`, `url(#${nextId})`)
        if (attribute.name === 'href' || attribute.name.endsWith(':href')) value = value.replace(`#${oldId}`, `#${nextId}`)
      })
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    }
  })
}

function addElement(document, name, attributes = {}, text = null) {
  const element = document.createElementNS(SVG_NS, name)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
  if (text !== null) element.textContent = text
  return element
}

function appendChartTitle(document, svg, label) {
  if (!label) return
  const title = addElement(document, 'title', {}, label)
  svg.insertBefore(title, svg.firstChild)
}

function appendLegend(document, root, entries, x, y, width) {
  if (!entries.length) return 0
  const group = addElement(document, 'g', { class: 'export-legend', 'aria-label': 'File legend' })
  const rowHeight = 20
  let cursorX = 0
  let row = 0
  const availableWidth = Math.max(width - 24, 160)
  entries.forEach(({ label, color }) => {
    const itemWidth = Math.max(72, Math.min(320, label.length * 7.1 + 30))
    if (cursorX > 0 && cursorX + itemWidth > availableWidth) {
      cursorX = 0
      row += 1
    }
    const item = addElement(document, 'g', { transform: `translate(${cursorX},${row * rowHeight})` })
    item.appendChild(addElement(document, 'circle', { class: 'export-legend-swatch', cx: 5, cy: 0, r: 5, fill: color }))
    item.appendChild(addElement(document, 'text', { x: 15, y: 4 }, label))
    group.appendChild(item)
    cursorX += itemWidth
  })
  const rows = row + 1
  group.setAttribute('transform', `translate(${x},${y})`)
  root.appendChild(group)
  return rows * rowHeight
}

/**
 * Serialize one or more live chart SVG nodes into one valid SVG document.
 *
 * The helper reads the optional `.chart-legend` sibling rendered by LineChart,
 * embeds that file/color mapping in the export, and accepts `legendEntries` as
 * either a per-chart array, a shared array, or `(svg, index) => entries`.
 * Each entry may be a string or `{ label, color }`.
 *
 * @param {Iterable<SVGSVGElement|null>|Array<SVGSVGElement|null>} chartNodes
 * @param {{ title?: string, gap?: number, legendEntries?: Array|Function }} [options]
 * @returns {string} A single-root SVG document, or an empty string for no nodes.
 */
export function exportChartsToSvg(chartNodes, options = {}) {
  const charts = [...(chartNodes ?? [])].filter((chart) => chart?.nodeType === 1 && chart.localName === 'svg')
  if (!charts.length) return ''

  const document = charts[0].ownerDocument
  if (!document?.createElementNS) throw new TypeError('SVG chart nodes must belong to a document')

  const dimensions = charts.map(readDimensions)
  const gap = Math.max(0, asFiniteNumber(options.gap, 28))
  const legendData = charts.map((chart, index) => readLegendEntries(chart, index, options))
  const legendRows = legendData.map((entries, index) => entries.length ? Math.ceil(entries.reduce((sum, entry) => sum + Math.max(72, Math.min(320, entry.label.length * 7.1 + 30)), 0) / Math.max(dimensions[index].width - 24, 160)) : 0)
  const legendHeights = legendRows.map((rows) => rows * 20)
  const width = Math.max(...dimensions.map(({ width: chartWidth }) => chartWidth))
  const height = dimensions.reduce((sum, { height: chartHeight }, index) => sum + legendHeights[index] + chartHeight + (index ? gap : 0), 0)
  const root = addElement(document, 'svg', { xmlns: SVG_NS, version: '1.1', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': options.title ?? 'Moore Loss chart export' })
  const style = addElement(document, 'style', {}, EXPORT_STYLE)
  root.appendChild(style)
  root.appendChild(addElement(document, 'title', {}, options.title ?? 'Moore Loss chart export'))

  let y = 0
  charts.forEach((chart, index) => {
    const { width: chartWidth, height: chartHeight } = dimensions[index]
    const entries = legendData[index]
    const legendHeight = appendLegend(document, root, entries, 12, y + 16, chartWidth)
    const clone = chart.cloneNode(true)
    rewriteReferences(clone, `chart-${index}`)
    appendChartTitle(document, clone, chart.getAttribute('aria-label') || `Chart ${index + 1}`)
    clone.setAttribute('x', '0')
    clone.setAttribute('y', String(y + legendHeight))
    clone.setAttribute('width', String(chartWidth))
    clone.setAttribute('height', String(chartHeight))
    root.appendChild(clone)
    y += legendHeight + chartHeight + gap
  })

  const serializer = typeof XMLSerializer === 'function'
    ? new XMLSerializer()
    : document.defaultView?.XMLSerializer ? new document.defaultView.XMLSerializer() : null
  if (!serializer) throw new Error('XMLSerializer is unavailable in this environment')
  return serializer.serializeToString(root)
}

export default exportChartsToSvg
