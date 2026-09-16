import type { ReactElement } from "react";
import type { MovementDemoProps } from "./MovementDemo";
import type { PoseDemoData, PoseSequence } from "../pose-demo";

export function PoseDemo(props: MovementDemoProps): ReactElement;
export interface MovementNodes {
  canvas: HTMLCanvasElement;
  playButton: HTMLButtonElement;
  playIcon: HTMLElement;
  scrubber: HTMLInputElement;
  timer: HTMLElement;
  phaseChip: HTMLElement;
  telemetryPhase?: HTMLElement | null;
  measurementLabel?: HTMLElement | null;
  measurementValue?: HTMLElement | null;
  measurementUnit?: HTMLElement | null;
  measurementCaption?: HTMLElement | null;
  scan?: HTMLElement | null;
}
export interface MovementController {
  togglePlay(): void;
  scrub(frame: string | number): void;
  selectDrill(key: string): void;
  stepSequence(direction: number): void;
  setActive(active: boolean): void;
  destroy(): void;
}
export function createMovementController(data: PoseDemoData, nodes: MovementNodes, changed: (index: number) => void, active?: boolean): MovementController | null;
export function measurementForFrame(sequence: PoseSequence | object, frame: number, fps?: number): { label: string; value: string; unit: string; caption: string };
export function calibrationGridLines(grid: { homography: number[]; xRange: number[]; yRange: number[]; stepMeters: number } | undefined): number[][][];
