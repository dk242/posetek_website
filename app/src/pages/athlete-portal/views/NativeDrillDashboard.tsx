import { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import type { Drill } from '../lib/drills';
import { attemptLabel, resultLabel } from '../../../lib/result-values';
import { dateText, displayValue, formatValue, metricRaw, sessionsFor } from '../lib/metrics';
import type { Row } from '../player/execution';
import { NativeIcon } from '../player/native-ui';
import { NATIVE_DRILL_ICONS, NATIVE_TIME_RANGES, nativeChartPoints, nativeSupportingPoints, nativeDashboardRows, nativeDashboardMetrics } from '../player/native-results';
import TechniqueAnalysis from '../player/TechniqueAnalysis';
import '../player/native-results.css';

export default function NativeDrillDashboard({ drill, reps, onOpenRep, playerId, preview = false }: { drill: Drill; reps: Row[]; onOpenRep: (folder: string, repId: string) => void; playerId?: string | null; preview?: boolean }) {
  const [range, setRange] = useState('all'), [selected, setSelected] = useState<string | null>(null), [technique, setTechnique] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const filtered = useMemo(() => nativeDashboardRows(reps, range), [reps, range]);
  const sessions = useMemo(() => sessionsFor(filtered), [filtered]);
  const selectedSession = sessions.find(session => session.folder === selected);
  const displayed = selectedSession?.items || filtered;
  const points = useMemo(() => nativeChartPoints(drill, filtered, selected), [drill, filtered, selected]);
  const supporting = useMemo(() => nativeSupportingPoints(drill, filtered, selected), [drill, filtered, selected]);
  const metrics = nativeDashboardMetrics(drill, displayed);
  useEffect(() => { setSelected(null); setTechnique(false); }, [drill.key]);
  useEffect(() => {
    if (!canvas.current || !points.length || !drill.metric) return;
    const chart = new Chart(canvas.current, {
      type: 'line', data: { datasets: [{ label: selectedSession ? 'Measured rep' : 'Session average', data: points.map((point, x) => ({ x, y: displayValue(point.value, drill)! })), borderColor: '#7cff18', backgroundColor: '#7cff1815', fill: true, tension: .2, pointRadius: selectedSession ? 5 : 4, pointBackgroundColor: '#7cff18', pointBorderColor: '#ffffffb3', pointBorderWidth: 1.5, order: 0 },
        { label: 'Measured rep', data: supporting.map(point => ({ x: point.x, y: displayValue(point.value, drill)! })), showLine: false, pointRadius: 3, pointBackgroundColor: '#7cff1873', pointBorderWidth: 0, order: 1 }] },
      options: { maintainAspectRatio: false, animation: false, onClick: (_event, elements) => { const element = elements[0]; const point = element && (element.datasetIndex === 1 ? supporting[element.index] : points[element.index]); if (point && !selectedSession) setSelected(point.folder); }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => points[Math.round(items[0]?.parsed.x || 0)]?.label || '', label: item => `${item.dataset.label}: ${item.parsed.y?.toFixed(1)} ${drill.unit}` } } }, scales: { x: { type: 'linear', min: -.35, max: Math.max(.35, points.length - .65), ticks: { stepSize: 1, color: '#ffffff80', font: { size: 10 }, maxRotation: 0, callback: value => Number.isInteger(Number(value)) ? points[Number(value)]?.label || '' : '' }, grid: { color: '#ffffff0a' } }, y: { beginAtZero: true, ticks: { color: '#ffffff80', font: { size: 10 }, callback: value => `${value} ${drill.unit}` }, grid: { color: '#ffffff12' } } } },
    });
    return () => chart.destroy();
  }, [drill, points, supporting, selectedSession]);
  const metricIcon = (label: string) => /angle/i.test(label) ? 'angle' : /time|out|back|turn/i.test(label) ? 'stopwatch' : /trend/i.test(label) ? 'chart.line.uptrend.xyaxis' : /height/i.test(label) ? 'arrow.up.to.line' : /distance/i.test(label) ? 'ruler' : /reps|videos|sessions/i.test(label) ? 'number' : 'speedometer';
  return <section className="native-dashboard">
    <header className="native-dashboard-title"><NativeIcon name={NATIVE_DRILL_ICONS[drill.key]} size={22} /><h1>{drill.label}</h1><small>{reps.length} attempts</small></header>
    <section className="portal-card native-chart-card"><header><h2>{selectedSession ? `Session ${selectedSession.number}` : drill.title}</h2>{selectedSession ? <button className="text-button" onClick={() => setSelected(null)}>All sessions</button> : <label className="native-range"><NativeIcon name="calendar" size={13} /><select aria-label="Result time range" value={range} onChange={event => { setRange(event.target.value); setSelected(null); }}>{NATIVE_TIME_RANGES.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>}</header>
      {drill.metric && points.length ? <div className="native-result-chart"><canvas ref={canvas} role="img" aria-label={`${drill.title}. ${selectedSession ? 'Measured values by rep.' : 'Session averages. Select a session below for individual reps.'}`} /></div> : <div className="native-chart-empty"><NativeIcon name={drill.metric ? 'chart.xyaxis.line' : 'video.fill'} size={38} /><p>{drill.metric ? 'No measured chart data in this period' : 'Open a session to watch its saved recording.'}</p></div>}
      {drill.metric && points.length > 0 && <p className="native-chart-caption">{selectedSession ? 'Measured reps in this session' : 'Average measured result per session · select a session to inspect its reps'}</p>}
    </section>
    <div className="native-dashboard-metrics" aria-label="Performance summary">{metrics.map(metric => <article key={metric.label}><NativeIcon name={metricIcon(metric.label)} size={17} /><strong>{metric.value}</strong><small>{metric.label}</small></article>)}</div>
    {drill.key === 'shooting' && playerId && <><button className="native-technique-entry" onClick={() => setTechnique(value => !value)} aria-expanded={technique}><NativeIcon name="figure.soccer" size={24} /><span><strong>Technique Analysis</strong><small>Review kicks and saved left/right comparisons</small></span><NativeIcon name="chevron.right" size={14} /></button>{technique && <TechniqueAnalysis playerId={playerId} reps={reps} preview={preview} onReplay={rep => onOpenRep(String(rep.sessionFolder || `session${rep.sessionNumber || 1}`), String(rep.id))} />}</>}
    <section className="portal-card native-latest-sessions"><header><h2>Latest Sessions</h2><small>{sessions.length} sessions</small></header>{sessions.length ? sessions.map(session => <article key={session.folder} className={session.folder === selected ? 'is-selected' : ''}>
      <button className="native-select-session" aria-pressed={session.folder === selected} onClick={() => setSelected(value => value === session.folder ? null : session.folder)}><NativeIcon name="calendar" size={19} /><span><strong>Session {session.number}</strong><small>{dateText(session.date)} · {session.items.length} {session.items.length === 1 ? 'rep' : 'reps'}</small></span></button>
      <button className="native-open-session" aria-label={`Open Session ${session.number}`} onClick={() => onOpenRep(session.folder, String(session.items[0].id))}><NativeIcon name="play.circle.fill" size={22} /><NativeIcon name="chevron.right" size={12} /></button>
      {session.folder === selected && <div className="native-session-reps">{session.items.map(rep => <button key={String(rep.id)} onClick={() => onOpenRep(session.folder, String(rep.id))}><span>{attemptLabel(rep, session.items)}</span><strong>{drill.metric ? formatValue(metricRaw(rep, drill), drill) : 'View recording'}</strong>{resultLabel(rep) && <small>{resultLabel(rep)}</small>}<NativeIcon name="chevron.right" size={12} /></button>)}</div>}
    </article>) : <div className="native-chart-empty"><NativeIcon name="video.slash" size={30} /><p>{reps.length ? 'No sessions in this period.' : 'No sessions recorded yet.'}</p></div>}</section>
    <p className="native-platform-note"><NativeIcon name="iphone" size={16} /> Record new sessions in the PoseTek mobile app.</p>
  </section>;
}
