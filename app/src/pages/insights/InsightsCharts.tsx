/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { CHART_AXIS, CHART_THEME } from "./chartTheme";

const AXIS = CHART_AXIS;

export function WeeklyRepsChart({ labels, values }: { labels: string[]; values: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ label: "Recording documents", data: values, backgroundColor: CHART_THEME.accent, borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 36 }] },
      options: {
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item: any) => `${item.formattedValue} recording documents` } } },
        scales: { x: { ...AXIS, grid: { display: false } }, y: { ...AXIS, beginAtZero: true, ticks: { ...AXIS.ticks, precision: 0 } } },
      },
    });
    return () => chart.destroy();
  }, [labels, values]);
  return <div className="insights-chart"><canvas ref={canvasRef} role="img" aria-label="Team recording documents per week" /></div>;
}

export function MetricTrendChart({ label, unit, labels, values }: { label: string; unit: string; labels: string[]; values: (number | null)[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label,
          data: values,
          spanGaps: true,
          borderColor: CHART_THEME.accent,
          borderWidth: 2,
          tension: .3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: CHART_THEME.accent,
          pointBorderColor: CHART_THEME.surface,
          pointBorderWidth: 2,
        }],
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item: any) => `Best ${item.formattedValue} ${unit}` } } },
        scales: { x: { ...AXIS, grid: { display: false } }, y: { ...AXIS, ticks: { ...AXIS.ticks, callback: (value: any) => `${Number(Number(value).toFixed(2))} ${unit}` } } },
      },
    });
    return () => chart.destroy();
  }, [label, unit, labels, values]);
  return <div className="insights-chart small"><canvas ref={canvasRef} role="img" aria-label={`${label} best per week`} /></div>;
}
