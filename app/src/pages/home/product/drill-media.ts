export type DemoDrillId = "DRB-006" | "PAS-001";
export type DrillMediaAsset = { name: string; video: string; poster: string };

/** Public website derivatives of the approved catalog assets; see media/provenance.json. */
export const drillMedia: Record<DemoDrillId, DrillMediaAsset> = {
  "DRB-006": {
    name: "Figure-8 dribble",
    video: new URL("./media/figure-8.mp4", import.meta.url).href,
    poster: new URL("./media/figure-8.jpg", import.meta.url).href,
  },
  "PAS-001": {
    name: "Wall pass rhythm",
    video: new URL("./media/wall-pass.mp4", import.meta.url).href,
    poster: new URL("./media/wall-pass.jpg", import.meta.url).href,
  },
};
