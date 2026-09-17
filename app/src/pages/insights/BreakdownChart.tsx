import { useEffect, useId, useRef } from "react";
import Chart from "chart.js/auto";

export interface BreakdownSlice { key: string; label: string; value: number; color?: string }
const COLORS = ["#b7f34a", "#45d17a", "#ffbd59", "#4bd7e8", "#829b91", "#baacda", "#e2c688", "#d689a3"];
export function sliceColor(slice: BreakdownSlice, index: number) { return slice.color || COLORS[index % COLORS.length]; }

/** Chart interactions and the visible table invoke the same filter action. */
export function BreakdownChart({ title, slices, selected, onSelect, note, unit = "players" }: {
  title: string; slices: BreakdownSlice[]; selected?: string; onSelect?: (key: string) => void; note?: string; unit?: string;
}) {
  const id = useId(), canvas = useRef<HTMLCanvasElement>(null);
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  useEffect(() => {
    if (!canvas.current || !total) return;
    const chart = new Chart(canvas.current, {
      type: "doughnut",
      data: { labels: slices.map(slice => slice.label), datasets: [{ data: slices.map(slice => slice.value), backgroundColor: slices.map(sliceColor), borderColor: "#0c2119", borderWidth: 3, hoverOffset: onSelect ? 5 : 0 }] },
      options: { maintainAspectRatio: false, cutout: "76%", animation: false,
        onClick: (_event, elements) => { if (elements[0] && onSelect) onSelect(slices[elements[0].index].key); },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => `${item.label}: ${item.formattedValue} ${unit}` } } },
      },
    });
    return () => chart.destroy();
  }, [slices, total, onSelect, unit]);
  return <section className="insights-card insights-breakdown" aria-labelledby={id}>
    <div className="insights-section-title"><h2 id={id}>{title}</h2>{selected && <button type="button" className="insights-text-button" onClick={() => onSelect?.("")}>Clear filter</button>}</div>
    <div className="insights-breakdown-body">
      <div className={`insights-donut${total ? "" : " empty"}`} aria-hidden="true"><canvas ref={canvas} /><div><strong>{total.toLocaleString()}</strong><span>{unit}</span></div></div>
      <table className="insights-breakdown-table"><caption className="insights-sr-only">{title} breakdown{onSelect ? "; select a category to filter players" : ""}</caption>
        <thead className="insights-sr-only"><tr><th scope="col">Category</th><th scope="col">{unit}</th><th scope="col">Share</th></tr></thead>
        <tbody>{slices.map((slice, index) => <tr key={slice.key} className={selected === slice.key ? "selected" : undefined}>
          <th scope="row">{onSelect ? <button type="button" aria-pressed={selected === slice.key} onClick={() => onSelect(selected === slice.key ? "" : slice.key)}><i aria-hidden="true" style={{ background: sliceColor(slice, index) }} />{slice.label}</button> : <span><i aria-hidden="true" style={{ background: sliceColor(slice, index) }} />{slice.label}</span>}</th>
          <td>{slice.value.toLocaleString()}</td><td>{total ? `${Math.round(slice.value / total * 100)}%` : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {note && <p className="insights-note">{note}</p>}
    {!total && <p className="insights-note">No matching {unit} in this scope.</p>}
  </section>;
}

export interface ChartSeries { label: string; values: (number | null)[]; color?: string }
export function ActivityChart({ title, labels, series, unit, note, rowLabel = "Week beginning" }: { title: string; labels: string[]; series: ChartSeries[]; unit: string; note?: string; rowLabel?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null), id = useId();
  const measured = series.some(row => row.values.some(value => value !== null));
  useEffect(() => {
    if (!canvas.current || !measured) return;
    const chart = new Chart(canvas.current, { type: "bar", data: { labels, datasets: series.map((row, index) => ({ label: row.label, data: row.values, backgroundColor: row.color || COLORS[index], borderRadius: 4, maxBarThickness: 30 })) },
      options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: series.length > 1, labels: { color: "#c8d8cf", boxWidth: 10 } }, tooltip: { callbacks: { label: item => `${item.dataset.label}: ${item.formattedValue} ${unit}` } } },
        scales: { x: { ticks: { color: "#9fb8ae", maxRotation: 0, autoSkip: true, maxTicksLimit: 9 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: "#9fb8ae", precision: 0 }, grid: { color: "rgba(255,255,255,.06)" } } },
      },
    }); return () => chart.destroy();
  }, [labels, series, measured, unit]);
  return <section className="insights-card" aria-labelledby={id}><div className="insights-section-title"><h2 id={id}>{title}</h2><span>{unit}</span></div>
    {measured ? <div className="insights-chart"><canvas ref={canvas} aria-hidden="true" /></div> : <div className="insights-uncollected"><span className="material-symbols-outlined" aria-hidden="true">schedule</span><strong>Not collected</strong><p>This period has no measured {unit}.</p></div>}
    {note && <p className="insights-note">{note}</p>}
    <details className="insights-data-table"><summary>View chart data</summary><div className="insights-table-wrap"><table className="insights-table"><caption className="insights-sr-only">{title}</caption><thead><tr><th scope="col">{rowLabel}</th>{series.map(row => <th scope="col" key={row.label}>{row.label} ({unit})</th>)}</tr></thead><tbody>{labels.map((label, index) => <tr key={`${label}:${index}`}><th scope="row">{label}</th>{series.map(row => <td key={row.label}>{row.values[index] === null || row.values[index] === undefined ? "Not collected" : row.values[index]!.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
