/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

const AXIS = { ticks: { color: "#9fb8ae" }, grid: { color: "rgba(255,255,255,.06)" }, border: { display: false } };

export function WeeklyRepsChart({ labels, values }: { labels: string[]; values: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ label: "Reps", data: values, backgroundColor: "#b7f34a", borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 36 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item: any) => `${item.formattedValue} reps` } } },
        scales: { x: { ...AXIS, grid: { display: false } }, y: { ...AXIS, beginAtZero: true, ticks: { ...AXIS.ticks, precision: 0 } } },
      },
    });
    return () => chart.destroy();
  }, [labels, values]);
  return <div className="insights-chart"><canvas ref={canvasRef} role="img" aria-label="Team reps recorded per week" /></div>;
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
          borderColor: "#b7f34a",
          borderWidth: 2,
          tension: .3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#b7f34a",
          pointBorderColor: "#0c2119",
          pointBorderWidth: 2,
        }],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item: any) => `Best ${item.formattedValue} ${unit}` } } },
        scales: { x: { ...AXIS, grid: { display: false } }, y: { ...AXIS, ticks: { ...AXIS.ticks, callback: (value: any) => `${Number(Number(value).toFixed(2))} ${unit}` } } },
      },
    });
    return () => chart.destroy();
  }, [label, unit, labels, values]);
  return <div className="insights-chart small"><canvas ref={canvasRef} role="img" aria-label={`${label} best per week`} /></div>;
}
