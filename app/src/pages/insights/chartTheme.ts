export const CHART_THEME = {
  accent: "#b7f34a",
  good: "#63d88b",
  warning: "#e8b85f",
  danger: "#ef7d7d",
  neutral: "#8ca19a",
  text: "#9db1a7",
  textStrong: "#dce8e1",
  grid: "rgba(157,177,167,.16)",
  surface: "#0c1d16",
  series: ["#b7f34a", "#63d88b", "#e8b85f", "#79b8d1", "#8ca19a", "#aa9bd1"],
} as const;

const STATUS_COLORS: Record<string, string> = {
  fullyTested: CHART_THEME.good,
  full: CHART_THEME.good,
  partiallyTested: CHART_THEME.warning,
  partial: CHART_THEME.warning,
  noSuccessfulTests: CHART_THEME.danger,
  noRecordedTests: CHART_THEME.neutral,
  none: CHART_THEME.neutral,
  completed: CHART_THEME.good,
  inProgress: CHART_THEME.accent,
  endedEarly: CHART_THEME.warning,
  abandoned: CHART_THEME.danger,
  returning: CHART_THEME.good,
  active: CHART_THEME.accent,
  inactive: CHART_THEME.neutral,
  notCollected: "#62766e",
};

export function chartColor(key: string, index: number) {
  return STATUS_COLORS[key] || CHART_THEME.series[index % CHART_THEME.series.length];
}

export const CHART_AXIS = {
  ticks: { color: CHART_THEME.text },
  grid: { color: CHART_THEME.grid },
  border: { display: false },
};
