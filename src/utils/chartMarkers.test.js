import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// These source-contract checks protect the chart's JSX marker layers. They are
// not browser-tested rendering or interaction checks.
const source = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')

function sectionBetween(start, end, text = source) {
  const startIndex = text.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing chart section: ${start}`)
  const endIndex = text.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing chart section boundary: ${end}`)
  return text.slice(startIndex, endIndex)
}

const lineChart = sectionBetween('function LineChart(', '\nfunction Dropzone(')

test('normal series keep their line paths without persistent point circles', () => {
  const layer = sectionBetween('{visibleSeries.map(', '{anomalyMarkers.filter(', lineChart)
  assert.match(layer, /<path\b[^>]*\bd=\{pathFor\(item\.points\)\}/)
  assert.doesNotMatch(layer, /<circle\b/)
})

test('anomaly markers retain their circles and dashed vertical guides', () => {
  const layer = sectionBetween('{anomalyMarkers.filter(', '{thresholdValue !== null', lineChart)
  assert.match(layer, /<circle\b[^>]*\br="6"/)
  assert.match(layer, /<circle\b[^>]*\bcx=\{x\(event\.step\)\}/)
  assert.match(layer, /<circle\b[^>]*\bcy=\{markerY\}/)

  const guide = layer.match(/<line\b([^>]*)\/>/)?.[1]
  assert.ok(guide, 'Anomaly markers must have a line guide')
  assert.match(guide, /\bx1=\{x\(event\.step\)\}/)
  assert.match(guide, /\bx2=\{x\(event\.step\)\}/)
  assert.match(guide, /\by1=\{pad\.top\}/)
  assert.match(guide, /\by2=\{height - pad\.bottom\}/)
  assert.match(guide, /\bstrokeDasharray="3 5"/)
})

test('hover highlights remain conditional circles with pointer-driven state', () => {
  const layer = sectionBetween('{hoverX !== null && <g className="chart-hover">', '</svg>', lineChart)
  assert.match(layer, /hoverValues\.filter\(\(item\) => item\.point\)\.map\(/)
  assert.match(layer, /<circle\b[^>]*\br="5"/)
  assert.match(layer, /<circle\b[^>]*\bcx=\{hoverX\}/)
  assert.match(layer, /<circle\b[^>]*\bcy=\{y\(item\.point\.value\)\}/)
  assert.match(lineChart, /const hoverX = hoverStep === null \? null : x\(hoverStep\)/)

  const handlers = sectionBetween('<svg ref=', '<defs>', lineChart)
  assert.match(handlers, /onMouseMove=\{[\s\S]*?readPoint\(event\);\s*setHoverStep\(point\?\.step \?\? null\);\s*setHoverPosition\(point\)/)
  assert.match(handlers, /onMouseLeave=\{[\s\S]*?setHoverStep\(null\);\s*setHoverPosition\(null\)/)
})
