import { useId } from "react";
import { sampleAthlete } from "./product-demo";

type SampleMetric = (typeof sampleAthlete.metrics)[number];

/** Presentation only: all observations come from the existing sample profile. */
export function CoachMetricChart({ id, metric }: { id: string; metric: SampleMetric }) {
  const titleId = useId();
  const descriptionId = useId();
  const sessions = metric.key === "training";
  const min = sessions ? 0 : Math.floor(Math.min(...metric.values) * 10) / 10;
  const max = sessions ? 4 : Math.ceil((Math.max(...metric.values) + 0.025) * 10) / 10;
  const x = (index: number) => 38 + index * (208 / Math.max(metric.values.length - 1, 1));
  const y = (value: number) => 116 - ((value - min) / Math.max(max - min, 0.1)) * 88;
  const format = (value: number) => sessions ? String(value) : value.toFixed(metric.key === "dribbling" ? 2 : 1);
  const ticks = [min, (min + max) / 2, max];
  const unit = sessions ? "sessions" : metric.unit;
  const checkpoint = sessions ? "Checkpoint" : "Assessment";
  const observations = metric.values.map((value, index) => `${checkpoint} ${index + 1}: ${format(value)} ${unit}`).join(". ");

  return (
    <figure id={id} className="pd-metric-chart" data-metric={metric.key}>
      <figcaption>
        <strong>{metric.label} trend</strong>
        <span>Latest <b>{metric.value}</b> {metric.unit}</span>
      </figcaption>
      <svg viewBox="0 0 282 148" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>{`${metric.label}: four sample ${sessions ? "checkpoints" : "assessments"}`}</title>
        <desc id={descriptionId}>{observations}.{sessions ? " Target: 4 sessions." : ""}</desc>
        {ticks.map(tick => (
          <g key={tick} className="pd-metric-grid">
            <line x1="38" x2="246" y1={y(tick)} y2={y(tick)} />
            <text x="30" y={y(tick) + 3} textAnchor="end">{format(tick)}</text>
          </g>
        ))}
        {sessions && <g className="pd-metric-target"><line x1="38" x2="246" y1={y(4)} y2={y(4)} /><text x="246" y="16" textAnchor="end">Target 4</text></g>}
        <polyline className="pd-metric-trend" points={metric.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
        {metric.values.map((value, index) => (
          <g key={index} className="pd-metric-point" data-latest={index === metric.values.length - 1}>
            <circle cx={x(index)} cy={y(value)} r={index === metric.values.length - 1 ? 4 : 3} />
            <text
              x={x(index) + (index === 0 ? 8 : index === metric.values.length - 1 ? -8 : 0)}
              y={y(value) - 10}
              textAnchor={index === 0 ? "start" : index === metric.values.length - 1 ? "end" : "middle"}
            >{format(value)}</text>
            <text x={x(index)} y="136" textAnchor="middle" className="pd-metric-checkpoint">{sessions ? "C" : "A"}{index + 1}</text>
          </g>
        ))}
      </svg>
      <p>{sessions ? "C1–C4 · Sample checkpoints" : `A1–A4 · Sample assessments · ${metric.unit}`}</p>
    </figure>
  );
}
