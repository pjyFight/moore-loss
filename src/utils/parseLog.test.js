import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLogText, samplePoints } from './parseLog.js'

test('custom regex rules parse text logs by their first capture group', () => {
  const points = parseLogText(
    '[iter=10] train=0.91 | g=2.4\n[iter=20] train=0.72 | g=1.9',
    'custom.log',
    {
      regexRules: {
        step: 'iter=(\\d+)',
        loss: 'train=([0-9.]+)',
        gradNorm: 'g=([0-9.]+)',
      },
    },
  )
  assert.deepEqual(points, [
    { step: 10, loss: 0.91, gradNorm: 2.4 },
    { step: 20, loss: 0.72, gradNorm: 1.9 },
  ])
})

test('default rules continue to parse the bundled log style', () => {
  const points = parseLogText('step=0 loss=1.0 grad_norm=2.0\nstep=100 loss=0.5 grad_norm=1.2')
  assert.equal(points.length, 2)
  assert.equal(points[1].loss, 0.5)
  assert.equal(points[1].gradNorm, 1.2)
})

test('custom regex rules preserve non-finite values for anomaly detection', () => {
  const points = parseLogText('iter=1 train=NaN grad=Inf', 'custom-anomaly.log', { regexRules: { step: 'iter=(\\d+)', loss: 'train=([^\\s]+)', gradNorm: 'grad=([^\\s]+)' } })
  assert.deepEqual(points[0].anomalies, [
    { metric: 'loss', type: 'NaN', raw: 'NaN' },
    { metric: 'gradNorm', type: 'Inf', raw: 'Inf' },
  ])
})

test('CSV keeps non-finite metric rows for anomaly detection', () => {
  const points = parseLogText('step,loss,grad_norm\n0,1,1\n100,NaN,Inf', 'anomaly.csv')
  assert.equal(points.length, 2)
  assert.equal(points[1].anomalies.length, 2)
})

test('sampling step 1 keeps every original measurement unchanged', () => {
  const points = parseLogText('step=5 loss=0.4 grad_norm=1.2\nstep=6 loss=0.6 grad_norm=1.8')
  assert.deepEqual(samplePoints(points, 1), points)
  assert.equal(samplePoints(points, 1).length, 2)
})
