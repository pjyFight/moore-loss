import assert from 'node:assert/strict'
import test from 'node:test'
import { detectAnomalies } from './anomalies.js'
import { parseLogText } from './parseLog.js'

test('keeps NaN and Inf records for anomaly detection', () => {
  const points = parseLogText('step=0 loss=1 grad_norm=1\nstep=100 loss=NaN grad_norm=Inf\nstep=200 loss=2 grad_norm=2')
  assert.equal(points.length, 3)
  assert.deepEqual(points[1].anomalies, [
    { metric: 'loss', type: 'NaN', raw: 'NaN' },
    { metric: 'gradNorm', type: 'Inf', raw: 'Inf' },
  ])
})

test('detects loss spikes and gradient explosions', () => {
  const run = { id: 'run-a', name: 'run.log', color: '#6d5dfc', points: [
    { step: 0, loss: 1, gradNorm: 1 },
    { step: 1, loss: 1.1, gradNorm: 1.1 },
    { step: 2, loss: 3, gradNorm: 1.2 },
    { step: 3, loss: 3.1, gradNorm: 1.3 },
    { step: 4, loss: 3.2, gradNorm: 10 },
  ] }
  const events = detectAnomalies([run], { spikeFactor: 2, explosionFactor: 5, madFactor: 6 })
  assert.ok(events.some((event) => event.type === 'spike' && event.metric === 'loss' && event.step === 2))
  assert.ok(events.some((event) => event.type === 'gradient-explosion' && event.metric === 'gradNorm' && event.step === 4))
  assert.equal(events.some((event) => event.type === 'spike' && event.metric === 'gradNorm' && event.step === 4), false)
})

test('disabled detection returns no events', () => {
  const run = { id: 'run-a', name: 'run.log', points: [{ step: 0, loss: 1, gradNorm: 1 }] }
  assert.deepEqual(detectAnomalies([run], { enabled: false }), [])
})
