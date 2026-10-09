import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLogText, previewLogText, samplePoints, validateRegexRule, validateRegexRules } from './parseLog.js'

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

test('exact mode parses Step N/total dictionary logs without fuzzy config matches', () => {
  const rules = {
    step: 'Step\\s+(\\d+)\\s*/\\s*\\d+',
    loss: '["\']Loss/train_loss["\']\\s*:\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?|NaN|Inf)',
    gradNorm: '["\']grad_norm["\']\\s*:\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?|NaN|Inf)',
  }
  const text = [
    '  "max_grad_norm": 1.0,',
    "Step 1/2: {'grad_norm': 1.5, 'Loss/train_loss': 2.5}",
    "Step 2/2: {'grad_norm': 1.25, 'Loss/train_loss': 2.25}",
  ].join('\n')
  assert.deepEqual(parseLogText(text, 'exact.log', { mode: 'exact', regexRules: rules }), [
    { step: 1, loss: 2.5, gradNorm: 1.5 },
    { step: 2, loss: 2.25, gradNorm: 1.25 },
  ])
})

test('exact mode preserves NaN and Inf anomalies and skips lines without an explicit step', () => {
  const rules = { step: 'step=(\\d+)', loss: 'loss=([^\\s]+)', gradNorm: 'grad_norm=([^\\s]+)' }
  const points = parseLogText('loss=1 grad_norm=2\nstep=4 loss=NaN grad_norm=Inf', 'exact-anomaly.log', { mode: 'exact', regexRules: rules })
  assert.deepEqual(points, [{ step: 4, loss: null, gradNorm: null, anomalies: [{ metric: 'loss', type: 'NaN', raw: 'NaN' }, { metric: 'gradNorm', type: 'Inf', raw: 'Inf' }] }])
})

test('exact rule validation requires one capture and preview reports matching coverage', () => {
  assert.equal(validateRegexRule('step=\\d+').valid, false)
  assert.equal(validateRegexRule('step=(\\d+)').valid, true)
  assert.equal(validateRegexRules({ step: 'step=(\\d+)', loss: '', gradNorm: '' }).length, 1)
  const preview = previewLogText('step=1 loss=2 grad_norm=3\nstep=2 loss=1 grad_norm=2', { step: 'step=(\\d+)', loss: 'loss=([0-9.]+)', gradNorm: 'grad_norm=([0-9.]+)' })
  assert.equal(preview.matchedRows, 2)
  assert.deepEqual(preview.fieldMatches, { step: 2, loss: 2, gradNorm: 2 })
  assert.deepEqual(preview.stepRange, [1, 2])
  assert.equal(preview.duplicateSteps, 0)
})

test('preview counts field matches independently from valid combined rows', () => {
  const preview = previewLogText('step=1 loss=2\nloss=3', { step: 'step=(\\d+)', loss: 'loss=([0-9.]+)', gradNorm: '' })
  assert.equal(preview.matchedRows, 1)
  assert.deepEqual(preview.fieldMatches, { step: 1, loss: 2, gradNorm: 0 })
})
