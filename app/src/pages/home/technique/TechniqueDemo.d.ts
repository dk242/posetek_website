import type { ReactElement } from "react";

export interface TechniqueDemoProps {
  /** Set false when the containing section is inactive; playback pauses. */
  active?: boolean;
}

export default function TechniqueDemo(props: TechniqueDemoProps): ReactElement;
