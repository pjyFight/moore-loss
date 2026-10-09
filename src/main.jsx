import React, { useDeferredValue, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { buildComparisons, COMPARISON_MODES, formatErrorFixed, formatValue } from './utils/compare'
import { DEFAULT_REGEX_RULES, parseLogText, previewLogText, samplePoints, validateRegexRules } from './utils/parseLog'
import { anomalyColor, detectAnomalies } from './utils/anomalies'
import { exportChartsToSvg } from './utils/exportCharts'
import { getIntegerStepTicks, getYDomain } from './utils/chartDomain'
import { buildSampleRules, findSampleValues, SAMPLE_RULE_FIELDS } from './utils/sampleRules'

const COLORS = ['#6d5dfc', '#17b992', '#e76f51', '#f2a93b']

const EMPTY_SAMPLE_DRAFT = {
  step: { sampleText: '', sampleValue: '', occurrence: 0 },
  loss: { sampleText: '', sampleValue: '', occurrence: 0 },
  gradNorm: { sampleText: '', sampleValue: '', occurrence: 0 },
}

const SAMPLE_EXAMPLE_DRAFT = {
  step: { sampleText: 'Step 1/100', sampleValue: '1', occurrence: 0 },
  loss: { sampleText: "'Loss/train_loss': 2.6480863", sampleValue: '2.6480863', occurrence: 0 },
  gradNorm: { sampleText: "'grad_norm': 1.4609375", sampleValue: '1.4609375', occurrence: 0 },
}

const MODE_LABELS = {
  absolute: { en: 'Comparison absolute', zh: '绝对值对比' },
  relative_abs: { en: 'Comparison relative absolute', zh: '相对绝对值对比' },
  normal: { en: 'Comparison normal', zh: '普通对比' },
  relative_normal: { en: 'Comparison relative normal', zh: '相对普通对比' },
}

const I18N = {
  en: {
    language: '中文', languageLabel: 'Switch to Chinese', export: 'Export SVG', github: 'GitHub',
    eyebrow: 'TRAINING TRACE WORKBENCH', title: 'Compare training traces', intro: 'Pull loss and gradient norm signals out of messy logs, then see where runs separate.',
    sources: 'SOURCES', uploadLogs: 'Upload logs', dropLogs: 'Drop training logs', browse: 'or click to browse files', formats: 'JSON, JSONL, CSV or text logs', multiHint: 'Select up to 4 files at once', parsedPoints: 'parsed points · local file',
    parser: 'PARSER RULES', parseFields: 'Parse fields', reset: 'Reset', parserHelp: 'Paste one example and select the value to extract, or switch to regex for full control.', parserMode: 'Parsing mode', sampleMode: 'By example', regexMode: 'Regex', sampleHelp: 'Paste one representative fragment and tell the tool which value to extract. It will generalize the pattern for the rest of the log.', exampleRule: 'Load example inputs', exampleLine: 'Example text', targetValue: 'Value to extract', chooseOccurrence: 'Choose occurrence', foundInExample: 'Found in example', generatedRule: 'Generated rule', stepRegex: 'Step regex', lossRegex: 'Loss regex', gradRegex: 'Grad norm regex', exactHelp: 'Use one capture group (...) for the value. Exact mode requires an explicit Step and at least one metric on the same line.', applyRules: 'Apply rules', testRules: 'Test rules', testComplete: 'Rule test complete', preview: 'LIVE PREVIEW', previewFile: 'Preview file', matchedRows: 'Matched rows', validPoints: 'Valid points', matchedStep: 'Step matches', matchedLoss: 'Loss matches', matchedGrad: 'Grad norm matches', stepRange: 'Step range', duplicates: 'Duplicate steps', previewEmpty: 'Upload a text log to preview matches.', previewNoMatch: 'No rows matched all required fields.', rulesApplied: 'Rules applied', rulesNotApplied: 'Draft only — apply to update charts.', sampleMissing: 'Add an example and a value to generate this rule.',
    chooseValue: 'Click a number below, or enter the value to extract.', selectedValue: 'Selected value', sampleRowHelp: 'Use a short fragment around each value. In the real log, Step and the metric must appear on the same line; other numbers may change.', sampleRequired: 'Configure Step and at least one metric. Leave unused metric examples empty.', appliedMode: 'Charts use', previewUpdating: 'Updating preview…', previewSource: 'Source line', needsRule: 'Needs parsing rule', uploadKept: 'File kept. Configure an example and apply it to extract values.', noMetricSample: 'Add a Loss or Grad norm example.', noMatchingRows: 'No valid rows matched. Charts have not changed.',
    configuration: 'CONFIGURATION', shapeView: 'Shape the view', metric: 'Metric', loss: 'Loss', gradNorm: 'Grad norm', sampling: 'Sampling step', steps: 'steps', comparisonMode: 'Comparison mode',
    ready: 'Ready to upload', startLogs: 'Start with your training logs', uploadOne: 'Upload a log to view its loss or grad norm curve. Add more logs to compare each run against a selected baseline.', singleRun: 'Single run view.', uploadSecond: 'Upload another file to unlock step-by-step comparison.', baseline: 'Baseline', setBaseline: 'Set as baseline', vs: 'vs',
    comparison: 'COMPARISON', traceOverview: 'TRACE OVERVIEW', byStep: 'by training step', points: 'points', stepDifference: 'STEP DIFFERENCE', bothPlots: 'All charts use the same full step range', samplingAverage: 'Sampling averages each step bucket', noSharedSteps: 'No shared steps with valid values for this metric.', pairStats: 'Comparison statistics',
    meanError: 'Mean error', meanSquare: 'Mean square error', maxError: 'Max error', minError: 'Min error', acrossShared: 'across shared steps', squaredAverage: 'squared difference average', absoluteMagnitude: 'absolute magnitude', minimumError: 'minimum error value',
    readingCharts: 'Reading the charts.', chartFirst: 'The first panel preserves every uploaded run.', chartSecond: 'Each following panel compares the baseline with one other run.', relativeDenominator: 'Relative modes use the selected baseline as the denominator, matching TrainingLogParser; relative views include a 2% reference line.',
    hoverZoom: 'Hover for values · use buttons to zoom', trainingStep: 'training step', difference: 'difference', noValues: 'No values to display.', file: 'file', anomalySection: 'ANOMALIES', anomalyDetection: 'Anomaly detection', anomalyEnabled: 'Enable anomaly detection', spikeFactor: 'Spike factor', explosionFactor: 'Explosion ×', threshold: 'Error threshold', thresholdHelp: 'Red line on the difference chart; relative modes use the same 0.05 ratio (5%).', anomalyEvents: 'Anomaly events', noAnomalies: 'No anomalies detected', eventStep: 'Step', eventRun: 'Run', eventMetric: 'Metric', eventType: 'Type', eventValue: 'Value',
  },
  zh: {
    language: 'EN', languageLabel: '切换到英文', export: '导出 SVG', github: 'GitHub',
    eyebrow: '训练曲线工作台', title: '对比训练曲线', intro: '从训练日志中提取 loss 和 grad norm，观察不同运行之间的差异。',
    sources: '数据源', uploadLogs: '上传日志', dropLogs: '拖入训练日志', browse: '或点击选择文件', formats: 'JSON、JSONL、CSV 或文本日志', multiHint: '一次最多选择 4 个文件', parsedPoints: '个解析点 · 本地文件',
    parser: '解析规则', parseFields: '解析字段', reset: '重置', parserHelp: '粘贴一条示例并选出要提取的值，或切换到正则模式自行控制。', parserMode: '解析模式', sampleMode: '按示例', regexMode: '正则', sampleHelp: '粘贴一段代表性日志，并告诉工具要提取哪个值；工具会自动泛化出整类日志的匹配规则。', exampleRule: '载入示例输入', exampleLine: '示例文本', targetValue: '要提取的值', chooseOccurrence: '选择第几处', foundInExample: '示例中已找到', generatedRule: '自动生成规则', stepRegex: 'Step 正则', lossRegex: 'Loss 正则', gradRegex: 'Grad norm 正则', exactHelp: '使用一个捕获组 (...) 提取数值。正则模式要求同一行有明确 Step，且至少有一个指标。', applyRules: '应用规则', testRules: '测试规则', testComplete: '规则测试完成', preview: '实时预览', previewFile: '预览文件', matchedRows: '匹配行数', validPoints: '有效点', matchedStep: 'Step 命中', matchedLoss: 'Loss 命中', matchedGrad: 'Grad norm 命中', stepRange: 'Step 范围', duplicates: '重复 Step', previewEmpty: '上传文本日志后，可预览匹配结果。', previewNoMatch: '没有行同时匹配必要字段。', rulesApplied: '规则已应用', rulesNotApplied: '草稿规则尚未应用到图表。', sampleMissing: '请填写示例文本和要提取的值。',
    chooseValue: '点击下方数值，或填写要提取的值。', selectedValue: '已选取值', sampleRowHelp: '每个示例只保留目标值附近的短片段。实际日志中 Step 和指标需在同一行，其他数值可以变化。', sampleRequired: '填写 Step 和至少一个指标；不用的指标示例留空即可。', appliedMode: '当前图表使用', previewUpdating: '正在更新预览…', previewSource: '原始日志行', needsRule: '待配置解析规则', uploadKept: '文件已保留，请填写示例并应用规则以提取数值。', noMetricSample: '请至少填写 Loss 或 Grad norm 示例。', noMatchingRows: '没有匹配到有效记录，图表保持不变。',
    configuration: '配置', shapeView: '调整视图', metric: '指标', loss: 'Loss', gradNorm: 'Grad norm', sampling: '采样步长', steps: '步', comparisonMode: '对比方式',
    ready: '等待上传', startLogs: '从训练日志开始', uploadOne: '上传一个日志即可查看 loss 或 grad norm 曲线；继续上传文件，可将每个运行与选定基准进行对比。', singleRun: '单文件视图。', uploadSecond: '再上传一个文件以开启逐步对比。', baseline: '基准文件', setBaseline: '设为基准', vs: '对比',
    comparison: '对比', traceOverview: '曲线总览', byStep: '按训练步数', points: '个点', stepDifference: '步级差值', bothPlots: '所有图使用相同的完整步数范围', samplingAverage: '采样会对每个步长桶取平均', noSharedSteps: '当前指标没有可对齐的有效共同步数。', pairStats: '对比统计',
    meanError: '平均误差', meanSquare: '均方误差', maxError: '最大误差', minError: '最小误差', acrossShared: '覆盖共同步数', squaredAverage: '差值平方的平均', absoluteMagnitude: '绝对值大小', minimumError: '误差最小值',
    readingCharts: '图表说明。', chartFirst: '第一张图保留所有已上传运行的原始曲线。', chartSecond: '后续每张图展示基准文件与一个其他文件的逐步对比。', relativeDenominator: '相对模式使用选定基准作为分母，与 TrainingLogParser 一致；相对视图包含 2% 参考线。',
    hoverZoom: '悬停查看数值 · 使用按钮缩放', trainingStep: '训练步数', difference: '差值', noValues: '暂无可展示的数据。', file: '文件', anomalySection: '异常检测', anomalyDetection: '异常检测', anomalyEnabled: '启用异常检测', spikeFactor: '突增倍数', explosionFactor: '爆炸倍数', threshold: '误差阈值', thresholdHelp: '差值图中的红线；相对模式使用相同的 0.05 比例（5%）。', anomalyEvents: '异常事件', noAnomalies: '未检测到异常', eventStep: '步数', eventRun: '运行', eventMetric: '指标', eventType: '类型', eventValue: '数值',
  },
}

const modeLabel = (mode, language) => MODE_LABELS[mode]?.[language] ?? MODE_LABELS[mode]?.en ?? mode
const anomalyLabel = (type, language) => ({ NaN: language === 'zh' ? 'NaN' : 'NaN', Inf: language === 'zh' ? 'Inf' : 'Inf', spike: language === 'zh' ? '突增' : 'Spike', 'gradient-explosion': language === 'zh' ? '梯度爆炸' : 'Gradient explosion' }[type] ?? type)

function Icon({ name, size = 18 }) {
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>,
    chart: <><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 4-6"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></>,
    github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.7-1.6 6.7-7A5.4 5.4 0 0 0 19.3 4 5 5 0 0 0 19.2.5S17.9.1 15 2.1a13.4 13.4 0 0 0-6 0C6.1.1 4.8.5 4.8.5A5 5 0 0 0 4.7 4a5.4 5.4 0 0 0-1.4 3.5c0 5.4 3.4 6.6 6.7 7A4.8 4.8 0 0 0 9 18v4"/><path d="M9 18c-4.5 2-5-2-7-2"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    x: <><path d="m6 6 12 12"/><path d="M18 6 6 18"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function LineChart({ series, onChartRef, chartLabel, yTitle, formatAxis = (value) => formatValue(value, 3), gradientId, signed = false, isDifference = false, zeroBaseline = false, language = 'en', anomalyMarkers = [], threshold = null, valueScale = 1, xDomain, emptyMessage }) {
  const ui = I18N[language]
  const width = 920
  const height = 390
  // Leave enough room for large percentage labels such as "34.40%".
  // With an 18px axis font, a 64px left gutter clips the leading digit.
  const pad = { top: 28, right: 26, bottom: 58, left: 108 }
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const svgRef = useRef(null)
  const [zoom, setZoom] = useState(null)
  const [hoverStep, setHoverStep] = useState(null)
  const [hoverPosition, setHoverPosition] = useState(null)
  const allPoints = series.flatMap((item) => item.points)
  if (!allPoints.length) {
    return <div className="chart-empty" role="status">{emptyMessage ?? ui.noValues}</div>
  }
  const plotSeries = series.map((item) => ({ ...item, points: item.points.map((point) => ({ ...point, value: point.value * valueScale })) }))
  const plotPoints = plotSeries.flatMap((item) => item.points)
  const labels = plotPoints.map((point) => point.step)
  const values = plotPoints.map((point) => point.value)
  const fullMin = xDomain?.[0] ?? Math.min(...labels)
  const fullMax = xDomain?.[1] ?? Math.max(...labels)
  const xMin = zoom?.[0] ?? fullMin
  const xMax = zoom?.[1] ?? fullMax
  const thresholdValue = isDifference && Number.isFinite(threshold) ? threshold * valueScale : null
  const [yMin, yMax] = getYDomain(values, { zeroBaseline, signed, threshold: thresholdValue })
  const x = (value) => pad.left + ((value - xMin) / Math.max(xMax - xMin, 1)) * innerWidth
  const y = (value) => pad.top + (1 - (value - yMin) / Math.max(yMax - yMin, 1e-12)) * innerHeight
  const pathFor = (points) => points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.step).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ')
  const ticks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4)
  const xTicks = getIntegerStepTicks(xMin, xMax, 11, innerWidth)
  const visibleSeries = plotSeries.map((item) => ({ ...item, points: item.points.filter((point) => point.step >= xMin && point.step <= xMax) })).filter((item) => item.points.length)
  const hoverX = hoverStep === null ? null : x(hoverStep)
  const hoverValues = hoverStep === null ? [] : plotSeries.filter((item) => !item.baseline).map((item) => ({ ...item, displayLabel: isDifference ? ui.difference : item.label, point: item.points.find((point) => point.step === hoverStep) }))
  const readPoint = (event) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    const svgX = ((event.clientX - rect.left) / rect.width) * width
    const svgY = ((event.clientY - rect.top) / rect.height) * height
    if (svgX < pad.left || svgX > width - pad.right || svgY < pad.top || svgY > height - pad.bottom) return null
    const step = xMin + ((svgX - pad.left) / innerWidth) * (xMax - xMin)
    return { step: labels.reduce((closest, candidate) => Math.abs(candidate - step) < Math.abs(closest - step) ? candidate : closest, labels[0]), xPercent: (svgX / width) * 100, yPercent: (svgY / height) * 100 }
  }
  const zoomAt = (factor, center = (xMin + xMax) / 2) => {
    const fullRange = Math.max(fullMax - fullMin, 1)
    const currentRange = Math.max(xMax - xMin, 1)
    const nextRange = Math.min(fullRange, Math.max(fullRange / 100, currentRange * factor))
    if (nextRange >= fullRange * .999) return setZoom(null)
    const ratio = (center - xMin) / currentRange
    const nextMin = Math.min(fullMax - nextRange, Math.max(fullMin, center - ratio * nextRange))
    setZoom([nextMin, nextMin + nextRange])
  }
  return (
    <div className="chart-frame">
      <div className="chart-toolbar"><span>{ui.hoverZoom}</span><span className="chart-toolbar-actions"><button type="button" onClick={() => zoomAt(.75)} aria-label="Zoom in">＋</button><button type="button" onClick={() => zoomAt(1.35)} aria-label="Zoom out">−</button><button type="button" onClick={() => setZoom(null)} aria-label={ui.reset}>{ui.reset}</button></span></div>
      {!isDifference && <div className="chart-legend" aria-label={language === 'zh' ? '文件图例' : 'File legend'}>{series.filter((item) => !item.baseline && item.points.length).map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.label}</span>)}</div>}
      <svg ref={(node) => { svgRef.current = node; onChartRef?.(node) }} className="trace-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={chartLabel} onMouseMove={(event) => { const point = readPoint(event); setHoverStep(point?.step ?? null); setHoverPosition(point) }} onMouseLeave={() => { setHoverStep(null); setHoverPosition(null) }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d5dfc" stopOpacity="0.06"/><stop offset="1" stopColor="#6d5dfc" stopOpacity="0"/></linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} fill="#ffffff" rx="16" />
        {ticks.map((tick) => <g key={`y-${tick}`}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#e9ebf1" strokeWidth="1"/><text x={pad.left - 12} y={y(tick) + 4} textAnchor="end" className="axis-label">{formatAxis(tick)}</text></g>)}
        {xTicks.map((tick, index) => <g key={`x-${tick}`}><line x1={x(tick)} x2={x(tick)} y1={pad.top} y2={height - pad.bottom} stroke="#f1f2f6" strokeWidth="1"/><text x={x(tick)} y={height - pad.bottom + 26} textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'} className="axis-label">{tick.toLocaleString()}</text></g>)}
        <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="#cdd1db" />
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} stroke="#cdd1db" />
        <text x={pad.left} y="18" className="axis-title">{yTitle}</text>
        <text x={width - pad.right} y={height - 8} textAnchor="end" className="axis-title">{ui.trainingStep}</text>
        {visibleSeries.map((item, seriesIndex) => <g key={item.id}>
          {seriesIndex === 0 && <path d={`${pathFor(item.points)} L ${x(item.points.at(-1).step)} ${height - pad.bottom} L ${x(item.points[0].step)} ${height - pad.bottom} Z`} fill={`url(#${gradientId})`} opacity="0.65" />}
          <path d={pathFor(item.points)} fill="none" stroke={item.color} strokeWidth={item.baseline ? "1.5" : "3"} strokeDasharray={item.baseline ? "6 6" : undefined} strokeLinecap="round" strokeLinejoin="round" />
          {!item.baseline && item.points.filter((_, index) => index % Math.max(1, Math.floor(item.points.length / 12)) === 0).map((point) => <circle key={`${item.id}-${point.step}`} cx={x(point.step)} cy={y(point.value)} r="3.6" fill="#fff" stroke={item.color} strokeWidth="2" />)}
        </g>)}
        {anomalyMarkers.filter((event) => event.step >= xMin && event.step <= xMax).map((event) => {
          const source = plotSeries.find((item) => item.id === event.runId)
          const point = source?.points.find((item) => item.step === event.step)
          const markerY = Number.isFinite(event.value) && point ? y(event.value * valueScale) : pad.top + 10
          return <g key={event.id}><line x1={x(event.step)} x2={x(event.step)} y1={pad.top} y2={height - pad.bottom} stroke={anomalyColor(event.type)} strokeDasharray="3 5" opacity=".55" /><circle cx={x(event.step)} cy={markerY} r="6" fill={anomalyColor(event.type)} stroke="#fff" strokeWidth="2"><title>{`${event.label} · step ${event.step}`}</title></circle></g>
        })}
        {thresholdValue !== null && <g className="threshold-line"><line x1={pad.left} x2={width - pad.right} y1={y(thresholdValue)} y2={y(thresholdValue)} stroke="#d14d5c" strokeWidth="2" strokeDasharray="8 6" /><text x={width - pad.right - 4} y={y(thresholdValue) - 8} textAnchor="end" className="threshold-label">{ui.threshold} {formatAxis(thresholdValue)}</text>{signed && <><line x1={pad.left} x2={width - pad.right} y1={y(-thresholdValue)} y2={y(-thresholdValue)} stroke="#d14d5c" strokeWidth="2" strokeDasharray="8 6" /><text x={width - pad.right - 4} y={y(-thresholdValue) + 17} textAnchor="end" className="threshold-label">−{formatAxis(thresholdValue)}</text></>}</g>}
        {hoverX !== null && <g className="chart-hover"><line x1={hoverX} x2={hoverX} y1={pad.top} y2={height - pad.bottom} stroke="#6d5dfc" strokeDasharray="4 4" opacity=".65" />{hoverValues.filter((item) => item.point).map((item) => <circle key={item.id} cx={hoverX} cy={y(item.point.value)} r="5" fill="#fff" stroke={item.color} strokeWidth="2.5" />)}</g>}
      </svg>
      {hoverStep !== null && hoverValues.length > 0 && <div className="chart-tooltip" style={{ left: `${Math.min(94, Math.max(6, hoverPosition?.xPercent ?? 50))}%`, top: `calc(36px + ${Math.min(72, Math.max(6, hoverPosition?.yPercent ?? 35))}%)`, transform: `translateX(-50%) ${((hoverPosition?.yPercent ?? 35) > 58) ? 'translateY(-110%)' : 'translateY(12px)'}` }}><strong>{language === 'zh' ? '步数' : 'step'} {hoverStep.toLocaleString()}</strong>{hoverValues.map((item) => <span key={item.id}><i style={{ background: item.color }} /><span className="tooltip-run-name" title={item.displayLabel}>{item.displayLabel}:</span> <b>{item.point ? formatAxis(item.point.value) : '—'}</b></span>)}</div>}
    </div>
  )
}

function Dropzone({ onFiles, language }) {
  const ui = I18N[language]
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const readFiles = (files) => { if (files?.length) onFiles([...files]) }
  return <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); readFiles(event.dataTransfer.files) }}>
    <input ref={inputRef} type="file" multiple accept=".log,.txt,.json,.jsonl,.csv" onChange={(event) => { readFiles(event.target.files); event.target.value = '' }} />
    <button type="button" className="dropzone-trigger" onClick={() => inputRef.current?.click()}>
      <span className="dropzone-icon"><Icon name="upload" size={20} /></span>
      <span><strong>{ui.dropLogs}</strong><span>{ui.browse}</span><span>{ui.formats}</span><span>{ui.multiHint}</span></span>
    </button>
  </div>
}

function RunRow({ run, index, onRemove, onSetBaseline, isBaseline, language }) {
  const ui = I18N[language]
  return <div className={`run-row ${isBaseline ? 'is-baseline' : ''}`}>
    <span className="run-swatch" style={{ background: run.color ?? COLORS[index] }} />
    <div className="run-copy"><strong title={run.name}>{run.name}</strong><span>{run.parseError ? ui.needsRule : `${run.points.length} ${ui.parsedPoints}`}</span></div>
    <label className="baseline-choice" title={isBaseline ? ui.baseline : ui.setBaseline}>
      <input type="radio" name="baseline-run" checked={isBaseline} onChange={() => onSetBaseline(run.id)} aria-label={`${isBaseline ? ui.baseline : ui.setBaseline}: ${run.name}`} />
      <span>{isBaseline ? ui.baseline : ui.setBaseline}</span>
    </label>
    <button className="icon-button" onClick={() => onRemove(run.id)} aria-label={`Remove ${run.name}`}><Icon name="x" size={16} /></button>
  </div>
}

const sampleFieldLabel = (field, ui) => field === 'step' ? 'Step' : field === 'loss' ? ui.loss : ui.gradNorm

function sampleErrorLabel(error, language) {
  if (language !== 'zh') return error.message
  return ({
    'missing-sample': '请填写示例文本。',
    'missing-sample-text': '请填写示例文本。',
    'missing-sample-value': '请选取或填写要提取的数值。',
    'value-not-found': '示例中未找到这个完整数值，请重新选取。',
    'invalid-sample-value': '只能选择完整数字、NaN 或 Inf。',
    'occurrence-out-of-range': '选取位置不存在，请重新选择。',
    'missing-metric': '请至少填写 Loss 或 Grad norm 示例。',
  })[error.code] ?? '无法从此示例生成规则，请检查文本和选取值。'
}

function SampleField({ field, draft, result, onChange, language }) {
  const ui = I18N[language]
  const label = sampleFieldLabel(field, ui)
  const tokens = useMemo(() => findSampleValues(draft.sampleText), [draft.sampleText])
  const selected = result?.valid && !result.skipped ? result.occurrences?.[result.selectedOccurrence] : null
  const showError = Boolean(draft.sampleText || draft.sampleValue) && result?.errors?.length > 0
  return <section className="sample-field-card" aria-label={`${label} ${ui.sampleMode}`}>
    <div className="sample-field-title"><strong>{label}</strong></div>
    <label className="field-label" htmlFor={`sample-${field}-text`}>{ui.exampleLine}</label>
    <textarea id={`sample-${field}-text`} className="sample-text-input" rows="2" spellCheck={false} value={draft.sampleText} placeholder={field === 'step' ? 'Step 1/100' : field === 'loss' ? "'Loss/train_loss': 2.64" : "'grad_norm': 1.4609375"} onChange={(event) => onChange(field, { sampleText: event.target.value, occurrence: 0 })} />
    {tokens.length > 0 && <div className="sample-candidates"><span>{ui.chooseValue}</span><div>{tokens.map((token) => <button type="button" key={token.start} aria-label={`${label}: ${token.value} (${token.occurrence + 1})`} aria-pressed={selected?.start === token.start} className={selected?.start === token.start ? 'is-selected' : ''} onClick={() => onChange(field, { sampleValue: token.value, occurrence: token.occurrence })}>{token.value}</button>)}</div></div>}
    <label className="field-label" htmlFor={`sample-${field}-value`}>{ui.targetValue}</label>
    <input id={`sample-${field}-value`} className="rule-input" aria-invalid={showError || undefined} value={draft.sampleValue} placeholder={field === 'step' ? '1' : field === 'loss' ? '2.64' : '1.4609375'} onChange={(event) => onChange(field, { sampleValue: event.target.value, occurrence: 0 })} />
    {selected && <div className="sample-selection" aria-label={`${label} ${ui.selectedValue}`}>{draft.sampleText.slice(0, selected.start)}<mark>{draft.sampleText.slice(selected.start, selected.end)}</mark>{draft.sampleText.slice(selected.end)}</div>}
    {showError && <p className="preview-error" role="status">{sampleErrorLabel(result.errors[0], language)}</p>}
    {selected && <details className="generated-rule-details"><summary>{ui.generatedRule}</summary><code className="generated-rule">{result.source}</code></details>}
  </section>
}

function App() {
  const [runs, setRuns] = useState([])
  const [language, setLanguage] = useState('en')
  const [metric, setMetric] = useState('loss')
  const [mode, setMode] = useState('absolute')
  const [sampleStep, setSampleStep] = useState(1)
  const [error, setError] = useState('')
  const [parserMode, setParserMode] = useState('sample')
  const [activeParserMode, setActiveParserMode] = useState('sample')
  const [parserRules, setParserRules] = useState(DEFAULT_REGEX_RULES)
  const [draftParserRules, setDraftParserRules] = useState(DEFAULT_REGEX_RULES)
  const [sampleDraft, setSampleDraft] = useState(EMPTY_SAMPLE_DRAFT)
  const [parserError, setParserError] = useState('')
  const [parserNotice, setParserNotice] = useState('')
  const [previewRunId, setPreviewRunId] = useState(null)
  const [comparisonThreshold, setComparisonThreshold] = useState(0.05)
  const [anomalyOptions, setAnomalyOptions] = useState({ enabled: true, spikeFactor: 2, explosionFactor: 5, madFactor: 6 })
  const [baselineId, setBaselineId] = useState(null)
  const rawChartRef = useRef(null)
  const errorChartRefs = useRef({})
  const comparisonRuns = useMemo(() => runs.map((run, index) => ({ ...run, color: run.color ?? COLORS[index % COLORS.length], points: samplePoints(run.points, sampleStep) })), [runs, sampleStep])
  const baselineRun = comparisonRuns.find((run) => run.id === baselineId) ?? comparisonRuns[0]
  const comparisonPairs = useMemo(() => buildComparisons(comparisonRuns, metric, mode, baselineRun?.id), [comparisonRuns, metric, mode, baselineRun?.id])
  const modeConfig = COMPARISON_MODES[mode]
  const ui = I18N[language]
  const differenceScale = modeConfig.relative ? 100 : 1
  const differenceAxisFormat = (value) => modeConfig.relative ? `${value.toFixed(2)}%` : formatValue(value, 2)
  const rawSeries = useMemo(() => comparisonRuns.map((run) => ({ id: run.id, label: run.name, color: run.color, points: run.points.flatMap((point) => Number.isFinite(point[metric]) ? [{ step: point.step, value: point[metric] }] : []) })), [comparisonRuns, metric])
  const previewRun = runs.find((run) => run.id === previewRunId) ?? runs[0]
  const generatedSampleRules = useMemo(() => buildSampleRules(sampleDraft, { requireStep: true, requireMetric: true }), [sampleDraft])
  const previewRules = parserMode === 'sample' ? generatedSampleRules.rules : draftParserRules
  const deferredPreviewRules = useDeferredValue(previewRules)
  const previewPending = deferredPreviewRules !== previewRules
  const draftValidationErrors = parserMode === 'sample'
    ? generatedSampleRules.errors.map((item) => `${item.field ? `${sampleFieldLabel(item.field, ui)}: ` : ''}${sampleErrorLabel(item, language)}`)
    : validateRegexRules(draftParserRules)
  const parserPreview = useMemo(() => {
    if (!previewRun?.rawText) return null
    return previewLogText(previewRun.rawText, deferredPreviewRules)
  }, [previewRun, deferredPreviewRules])
  const stepDomain = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const series of rawSeries) {
      for (const point of series.points) {
        min = Math.min(min, point.step)
        max = Math.max(max, point.step)
      }
    }
    return Number.isFinite(min) ? [min, max] : undefined
  }, [rawSeries])
  const anomalies = useMemo(() => detectAnomalies(comparisonRuns, anomalyOptions), [comparisonRuns, anomalyOptions])
  const visibleAnomalies = useMemo(() => anomalies.filter((event) => event.metric === metric), [anomalies, metric])
  const anomalyCounts = useMemo(() => visibleAnomalies.reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] ?? 0) + 1 }), {}), [visibleAnomalies])

  const parseOptionsFor = (nextMode, nextRules) => ({ regexRules: nextRules, ...(['sample', 'regex'].includes(nextMode) ? { mode: 'exact' } : {}) })

  const rulesForMode = (nextMode = parserMode) => nextMode === 'sample' ? generatedSampleRules.rules : draftParserRules

  const applyParserConfig = (nextMode = parserMode, nextRules = rulesForMode(nextMode)) => {
    const validationErrors = nextMode === 'sample' ? draftValidationErrors : validateRegexRules(nextRules)
    if (validationErrors.length) {
      setParserError(validationErrors[0])
      setParserNotice('')
      return false
    }
    try {
      const failures = []
      let parsedRunCount = 0
      const updated = runs.map((run) => {
        if (!run.rawText) return run
        try {
          const points = parseLogText(run.rawText, run.name, parseOptionsFor(nextMode, nextRules))
          parsedRunCount += 1
          return { ...run, points, parseError: null }
        } catch (failure) {
          failures.push(`${run.name}: ${failure.message}`)
          return { ...run, parseError: failure.message }
        }
      })
      if (runs.length && !parsedRunCount) {
        setParserError(failures.join('\n') || ui.noMatchingRows)
        setParserNotice('')
        return false
      }
      setParserMode(nextMode)
      setActiveParserMode(nextMode)
      setParserRules(nextRules)
      if (nextMode !== 'sample') setDraftParserRules(nextRules)
      setRuns(updated)
      if (!updated.some((run) => run.points.some((point) => Number.isFinite(point[metric]))) && updated.some((run) => run.points.some((point) => Number.isFinite(point[metric === 'loss' ? 'gradNorm' : 'loss'])))) setMetric(metric === 'loss' ? 'gradNorm' : 'loss')
      setParserError(failures.join('\n'))
      setParserNotice(`${I18N[language].rulesApplied}${runs.length ? ` · ${parsedRunCount}/${runs.length}` : ''}`)
      return true
    } catch (parseError) {
      setParserError(parseError.message)
      setParserNotice('')
      return false
    }
  }

  const testParserConfig = () => {
    const validationErrors = draftValidationErrors
    if (validationErrors.length) {
      setParserError(validationErrors[0])
      setParserNotice('')
      return
    }
    const preview = previewRun?.rawText ? previewLogText(previewRun.rawText, rulesForMode()) : null
    if (preview && !preview.matchedRows) {
      setParserError(ui.noMatchingRows)
      setParserNotice('')
      return
    }
    setParserError('')
    const previewMessage = preview ? ` · ${preview.matchedRows} ${ui.validPoints}` : ''
    setParserNotice(`${ui.testComplete}${previewMessage}`)
  }

  const handleParserModeChange = (nextMode) => {
    if (nextMode === 'regex' && parserMode === 'sample' && generatedSampleRules.valid) setDraftParserRules(generatedSampleRules.rules)
    setParserMode(nextMode)
    setParserError('')
    setParserNotice(I18N[language].rulesNotApplied)
  }

  const handleRuleChange = (key, value) => {
    setDraftParserRules((current) => ({ ...current, [key]: value }))
    setParserError('')
    setParserNotice(I18N[language].rulesNotApplied)
  }

  const updateSampleField = (field, changes) => {
    setSampleDraft((current) => ({ ...current, [field]: { ...current[field], ...changes } }))
    setParserError('')
    setParserNotice(I18N[language].rulesNotApplied)
  }

  const removeRun = (id) => {
    setRuns((current) => current.filter((run) => run.id !== id))
    if (id === baselineRun?.id) setBaselineId(null)
  }

  const handleFiles = async (files) => {
    setError('')
    const parsedRuns = []
    const uploadErrors = []
    for (const [index, file] of files.slice(0, 4).entries()) {
      try {
        const rawText = await file.text()
        let points = []
        let parseError = null
        try { points = parseLogText(rawText, file.name, parseOptionsFor(activeParserMode, parserRules)) } catch (failure) {
          parseError = failure.message
          uploadErrors.push(`${file.name}: ${ui.uploadKept}`)
        }
        parsedRuns.push({ id: `${file.name}-${file.lastModified}-${file.size}`, name: file.name, source: 'file', rawText, points, parseError, color: COLORS[index % COLORS.length] })
      } catch (failure) { uploadErrors.push(`${file.name}: ${failure.message}`) }
    }
    if (uploadErrors.length) setError(uploadErrors.join('\n'))
    if (parsedRuns.length) setRuns((current) => {
      const combined = new Map(current.map((run) => [run.id, run]))
      parsedRuns.forEach((run) => combined.set(run.id, run))
      return [...combined.values()].slice(-4).map((run, index) => ({ ...run, color: COLORS[index] }))
    })
  }

  const resetParserRules = () => {
    setSampleDraft(EMPTY_SAMPLE_DRAFT)
    setParserError('')
    setParserNotice('')
    applyParserConfig('sample', DEFAULT_REGEX_RULES)
  }
  const exportChart = () => {
    const charts = [rawChartRef.current, ...Object.values(errorChartRefs.current)].filter((chart) => chart?.isConnected)
    if (!charts.length) return
    const svg = exportChartsToSvg(charts, { title: `Moore Loss · ${metric} · ${mode}` })
    if (!svg) return
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `moore-loss-${metric}-${mode}.svg`; anchor.click(); URL.revokeObjectURL(url)
  }

  const relativeBaseline = 0.02
  const baselineSeriesFor = (comparison) => mode === 'relative_normal'
    ? [
        { id: 'baseline-positive', label: '+2% baseline', color: '#b54b53', baseline: true, points: comparison.labels.map((step) => ({ step, value: relativeBaseline })) },
        { id: 'baseline-negative', label: '−2% baseline', color: '#b54b53', baseline: true, points: comparison.labels.map((step) => ({ step, value: -relativeBaseline })) },
      ]
    : mode === 'relative_abs'
      ? [{ id: 'baseline-positive', label: '+2% baseline', color: '#b54b53', baseline: true, points: comparison.labels.map((step) => ({ step, value: relativeBaseline })) }]
      : []

  return <div className="app-shell">
    <header className="topbar">
      <a href="." className="brand"><span className="brand-mark">M</span><span>Moore <em>Loss</em></span></a>
      <div className="topbar-actions"><button className="ghost-button language-toggle" onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} aria-label={ui.languageLabel}>{ui.language}</button><button className="ghost-button" onClick={exportChart} disabled={!rawSeries.some((series) => series.points.length)}><Icon name="download" size={15} /> {ui.export}</button><a className="ghost-button" href="https://github.com" target="_blank" rel="noreferrer"><Icon name="github" size={15} /> {ui.github}</a></div>
    </header>

    <main className="page">
      <section className="intro">
        <div><p className="eyebrow">{ui.eyebrow}</p><h1>{ui.title}</h1><p className="intro-copy">{ui.intro}</p></div>
      </section>

      <section className="app-grid">
        <aside className="control-rail">
          <div className="rail-header"><div><span className="section-kicker">01 / {ui.sources}</span><h2>{ui.uploadLogs}</h2></div><span className="count-badge">{runs.length}/4</span></div>
          <Dropzone onFiles={handleFiles} language={language} />
          {runs.length > 0 ? <div className="run-list" role="group" aria-label={ui.baseline}>{runs.map((run, index) => <RunRow key={run.id} run={run} index={index} isBaseline={baselineRun?.id === run.id} onSetBaseline={setBaselineId} language={language} onRemove={removeRun} />)}</div> : null}
          {error && <div className="error-message">{error}</div>}
          <div className="rail-divider" />
          <div className="rail-header"><div><span className="section-kicker">02 / {ui.parser}</span><h2>{ui.parseFields}</h2></div><button className="text-button" onClick={resetParserRules}>{ui.reset}</button></div>
          <p className="parser-help">{ui.parserHelp}</p>
          <div className="parser-mode-switcher" role="group" aria-label={ui.parserMode}>
            <button type="button" aria-pressed={parserMode === 'sample'} className={`parser-mode-button ${parserMode === 'sample' ? 'is-active' : ''}`} onClick={() => handleParserModeChange('sample')}>{ui.sampleMode}</button>
            <button type="button" aria-pressed={parserMode === 'regex'} className={`parser-mode-button ${parserMode === 'regex' ? 'is-active' : ''}`} onClick={() => handleParserModeChange('regex')}>{ui.regexMode}</button>
          </div>
          <p className="parser-active-mode">{ui.appliedMode}: <strong>{activeParserMode === 'regex' ? ui.regexMode : ui.sampleMode}</strong></p>
          {parserMode === 'sample' && <div className="sample-parser">
            <p className="parser-exact-help">{ui.sampleHelp}</p>
            <p className="parser-exact-help">{ui.sampleRequired} {ui.sampleRowHelp}</p>
            <button type="button" className="text-button example-rule-button" onClick={() => { setSampleDraft(SAMPLE_EXAMPLE_DRAFT); setParserError(''); setParserNotice(I18N[language].rulesNotApplied) }}>{ui.exampleRule}</button>
            {SAMPLE_RULE_FIELDS.map((field) => <SampleField key={field} field={field} draft={sampleDraft[field]} result={generatedSampleRules.results[field]} onChange={updateSampleField} language={language} />)}
          </div>}
          {parserMode === 'regex' && <div className="regex-parser">
            <p className="parser-exact-help">{ui.exactHelp}</p>
            <label className="field-label" htmlFor="step-regex">{ui.stepRegex}</label>
            <input id="step-regex" className="rule-input" value={draftParserRules.step ?? ''} onChange={(event) => handleRuleChange('step', event.target.value)} />
            <label className="field-label" htmlFor="loss-regex">{ui.lossRegex}</label>
            <input id="loss-regex" className="rule-input" value={draftParserRules.loss ?? ''} onChange={(event) => handleRuleChange('loss', event.target.value)} />
            <label className="field-label" htmlFor="grad-regex">{ui.gradRegex}</label>
            <input id="grad-regex" className="rule-input" value={draftParserRules.gradNorm ?? ''} onChange={(event) => handleRuleChange('gradNorm', event.target.value)} />
          </div>}
          <div className="parser-actions"><button type="button" className="secondary-button" onClick={testParserConfig}>{ui.testRules}</button><button type="button" className="primary-button" disabled={draftValidationErrors.length > 0 || (runs.length > 0 && (!parserPreview?.matchedRows || previewPending))} onClick={() => applyParserConfig(parserMode, rulesForMode())}>{ui.applyRules}</button></div>
          {parserError && <div className="error-message">{parserError}</div>}
          {parserNotice && !parserError && <div className="parser-notice">{parserNotice}</div>}
          <div className="parser-preview">
            <div className="parser-preview-head"><span className="section-kicker">{ui.preview}</span>{runs.length > 1 && <select aria-label={ui.previewFile} value={previewRun?.id ?? ''} onChange={(event) => setPreviewRunId(event.target.value)}><option value="">{ui.previewFile}</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}</select>}</div>
            {previewPending ? <p className="preview-empty">{ui.previewUpdating}</p> : !parserPreview ? <p className="preview-empty">{ui.previewEmpty}</p> : <>
              <div className="preview-stats"><span>{ui.matchedRows}<b>{parserPreview.matchedRows}</b></span><span>{ui.validPoints}<b>{parserPreview.matchedRows}</b></span><span>{ui.matchedStep}<b>{parserPreview.fieldMatches.step}</b></span><span>{ui.matchedLoss}<b>{parserPreview.fieldMatches.loss}</b></span><span>{ui.matchedGrad}<b>{parserPreview.fieldMatches.gradNorm}</b></span><span>{ui.duplicates}<b>{parserPreview.duplicateSteps}</b></span></div>
              <p className="preview-range">{ui.stepRange}: {parserPreview.stepRange ? `${parserPreview.stepRange[0].toLocaleString()} → ${parserPreview.stepRange[1].toLocaleString()}` : '—'}</p>
              {parserPreview.errors.length > 0 && <p className="preview-error">{parserPreview.errors[0]}</p>}
              {!parserPreview.errors.length && !parserPreview.matchedRows && <p className="preview-error">{ui.previewNoMatch}</p>}
              {parserPreview.sampleRows?.length > 0 && <div className="preview-samples">{parserPreview.sampleRows.slice(0, 3).map(({ source, point }) => <div className="preview-sample" key={`${point.step}-${source}`}><span title={source}>{ui.previewSource}: {source}</span><code>step={point.step} · loss={point.loss ?? '—'} · grad={point.gradNorm ?? '—'}</code></div>)}</div>}
            </>}
          </div>
          <div className="rail-divider" />
          <div className="rail-header"><div><span className="section-kicker">03 / {ui.configuration}</span><h2>{ui.shapeView}</h2></div></div>
          <label className="field-label" htmlFor="metric">{ui.metric}</label>
          <div className="select-wrap"><select id="metric" value={metric} onChange={(event) => setMetric(event.target.value)}><option value="loss">{ui.loss}</option><option value="gradNorm">{ui.gradNorm}</option></select><Icon name="chevron" size={15} /></div>
          <label className="field-label" htmlFor="sample-step">{ui.sampling} <span>{sampleStep.toLocaleString()}</span></label>
          <input id="sample-step" className="range-input" type="range" min="1" max="5000" step="1" value={sampleStep} onChange={(event) => setSampleStep(Number(event.target.value))} />
          <div className="step-input-row"><input aria-label={ui.sampling} type="number" min="1" max="5000" value={sampleStep} onChange={(event) => setSampleStep(Math.min(5000, Math.max(1, Math.trunc(Number(event.target.value)) || 1)))} /><span>{ui.steps}</span></div>
          <fieldset className="mode-fieldset">
            <legend className="field-label">{ui.comparisonMode}</legend>
            <div className="mode-switcher">{Object.entries(COMPARISON_MODES).map(([key, value]) => <label key={key} className={`mode-option ${mode === key ? 'is-active' : ''}`}>
              <input type="radio" name="comparison-mode" value={key} checked={mode === key} onChange={() => setMode(key)} aria-label={modeLabel(key, language)} />
              <span className="mode-option-copy"><span className="mode-option-label">{modeLabel(key, language)}</span><span className="mode-option-formula">{value.helper}</span></span>
            </label>)}</div>
          </fieldset>
          <p className="mode-helper">{language === 'zh' ? 'A = 选定基准 · B = 各对比文件 · ' : 'A = selected baseline · B = each comparison run · '}{modeConfig.helper}</p>
          <div className="threshold-config"><label className="field-label" htmlFor="comparison-threshold">{ui.threshold} <span>{comparisonThreshold.toFixed(2)}</span></label><input id="comparison-threshold" className="threshold-input" type="number" min="0" max="1000000" step="0.01" value={comparisonThreshold} onChange={(event) => setComparisonThreshold(Math.max(0, Number(event.target.value) || 0))} /><p className="threshold-help">{ui.thresholdHelp}</p></div>
          <div className="anomaly-config">
            <div className="section-kicker">05 / {ui.anomalySection}</div>
            <label className="anomaly-toggle"><input type="checkbox" checked={anomalyOptions.enabled} onChange={(event) => setAnomalyOptions((current) => ({ ...current, enabled: event.target.checked }))} />{ui.anomalyEnabled}</label>
            <div className="anomaly-fields"><label><span>{ui.spikeFactor}</span><input type="number" min="1.1" max="20" step="0.1" value={anomalyOptions.spikeFactor} onChange={(event) => setAnomalyOptions((current) => ({ ...current, spikeFactor: Math.max(1.1, Number(event.target.value) || 2) }))} /></label><label><span>{ui.explosionFactor}</span><input type="number" min="2" max="50" step="0.5" value={anomalyOptions.explosionFactor} onChange={(event) => setAnomalyOptions((current) => ({ ...current, explosionFactor: Math.max(2, Number(event.target.value) || 5) }))} /></label></div>
          </div>
        </aside>

        <div className="workspace">
          <div className="workspace-head"><div><span className="section-kicker">04 / {ui.comparison}</span><h2>{metric === 'loss' ? ui.loss : ui.gradNorm} · {runs.length === 0 ? ui.ready : runs.length > 1 ? modeLabel(mode, language) : ui.singleRun}</h2></div></div>
          {runs.length === 0 ? <section className="workspace-empty" role="status">
            <span className="empty-state-icon"><Icon name="file" size={28} /></span>
            <h3>{ui.startLogs}</h3>
            <p>{ui.uploadOne}</p>
          </section> : <>
          <div className="chart-stack">
            <section className="chart-section raw-chart-section"><div className="chart-section-head"><div><span className="chart-kicker">{ui.traceOverview}</span><h3>{metric === 'loss' ? ui.loss : ui.gradNorm} {ui.byStep}</h3></div><span className="chart-chip">{rawSeries.reduce((total, item) => total + item.points.length, 0)} {ui.points}</span></div><LineChart series={rawSeries} xDomain={stepDomain} zeroBaseline anomalyMarkers={visibleAnomalies} onChartRef={(node) => { rawChartRef.current = node }} language={language} chartLabel={`${metric === 'loss' ? ui.loss : ui.gradNorm} curves`} yTitle={metric === 'loss' ? ui.loss : ui.gradNorm} gradientId="rawFade" /></section>
            {comparisonPairs.map(({ baseline, candidate, comparison: pairComparison }, pairIndex) => {
              const pairId = `${baseline.id}-${candidate.id}`
              const pairSeries = [...pairComparison.errorSeries, ...baselineSeriesFor(pairComparison)]
              return <section className="chart-section comparison-chart-section" key={pairId}>
                <div className="chart-section-head"><div><span className="chart-kicker">{ui.stepDifference}</span><h3>{modeLabel(mode, language)} · {baseline.name} {ui.vs} {candidate.name}</h3></div><span className="chart-chip">{modeConfig.helper}</span></div>
                <LineChart series={pairSeries} xDomain={stepDomain} threshold={comparisonThreshold} valueScale={differenceScale} onChartRef={(node) => { if (node) errorChartRefs.current[pairId] = node; else delete errorChartRefs.current[pairId] }} language={language} chartLabel={`${modeLabel(mode, language)} · ${baseline.name} ${ui.vs} ${candidate.name}`} yTitle={modeLabel(mode, language)} formatAxis={differenceAxisFormat} gradientId={`errorFade-${pairIndex}`} signed={modeConfig.signed} isDifference emptyMessage={ui.noSharedSteps} />
                {pairComparison.labels.length > 0 && <div className="pair-summary"><span className="pair-summary-label">{ui.pairStats}</span><div className="summary-grid"><article className="summary-card primary"><span className="summary-label">{ui.meanError}</span><strong className="summary-big summary-error-value">{formatErrorFixed(pairComparison.errorStats.mean, mode)}</strong><span className="summary-muted">{ui.acrossShared}</span></article><article className="summary-card"><span className="summary-label">{ui.meanSquare}</span><strong className="summary-big summary-error-value">{formatErrorFixed(pairComparison.errorStats.meanSquare, mode)}</strong><span className="summary-muted">{ui.squaredAverage}</span></article><article className="summary-card"><span className="summary-label">{ui.maxError}</span><strong className="summary-big summary-error-value">{formatErrorFixed(pairComparison.errorStats.max, mode)}</strong><span className="summary-muted">{ui.absoluteMagnitude}</span></article><article className="summary-card"><span className="summary-label">{ui.minError}</span><strong className="summary-big summary-error-value">{formatErrorFixed(pairComparison.errorStats.min, mode)}</strong><span className="summary-muted">{ui.minimumError}</span></article></div></div>}
              </section>
            })}
          </div>
          <section className={`anomaly-panel ${visibleAnomalies.length ? 'has-events' : 'is-clear'}`}>
            <div className="anomaly-panel-head"><div><span className="chart-kicker">{ui.anomalySection}</span><h3>{ui.anomalyEvents}</h3></div><div className="anomaly-counts"><span>{visibleAnomalies.length}</span>{Object.entries(anomalyCounts).map(([type, count]) => <span key={type} className={`anomaly-chip anomaly-${type}`}>{anomalyLabel(type, language)} {count}</span>)}</div></div>
            {visibleAnomalies.length ? <div className="anomaly-table-wrap"><table className="anomaly-table"><thead><tr><th>{ui.eventStep}</th><th>{ui.eventRun}</th><th>{ui.eventMetric}</th><th>{ui.eventType}</th><th>{ui.eventValue}</th></tr></thead><tbody>{visibleAnomalies.slice(0, 20).map((event) => <tr key={event.id}><td>{event.step.toLocaleString()}</td><td title={event.runName}>{event.runName}</td><td>{event.metric === 'loss' ? ui.loss : ui.gradNorm}</td><td><span className="event-type" style={{ '--event-color': anomalyColor(event.type) }}>{anomalyLabel(event.type, language)}</span></td><td>{typeof event.value === 'string' ? event.value : formatValue(event.value, 4)}</td></tr>)}</tbody></table>{visibleAnomalies.length > 20 && <div className="anomaly-more">+ {visibleAnomalies.length - 20} more</div>}</div> : <p className="anomaly-clear">{ui.noAnomalies}</p>}
          </section>
          {runs.length > 1 && <div className="chart-foot"><span>{ui.bothPlots}</span><span>{ui.samplingAverage}</span></div>}
          {runs.length > 1 ? <div className="workspace-note"><span className="note-line" /><p><strong>{ui.readingCharts}</strong> {ui.chartFirst} {ui.chartSecond} {ui.relativeDenominator}</p></div> : <div className="single-run-note"><strong>{ui.singleRun}</strong> {ui.uploadSecond}</div>}
          </>}
        </div>
      </section>
    </main>
    <footer className="footer"><span>{language === 'zh' ? 'Moore Loss 是一个用于训练诊断的纯前端工具。' : 'Moore Loss is a static client-side tool for reproducible training diagnostics.'}</span><a href="https://github.com" target="_blank" rel="noreferrer">{language === 'zh' ? '在 GitHub 查看源码' : 'Source on GitHub'} <Icon name="chevron" size={14} /></a></footer>
  </div>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
