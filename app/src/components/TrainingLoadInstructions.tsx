/** The reviewer-set load is part of the prescription, never inferred from scores. */
import "./training-load.css";
export default function TrainingLoadInstructions({ block }: { block: { trainingPolicyVersion?: string; loadingInstructions?: string } }) {
  if (typeof block.loadingInstructions === "string" && block.loadingInstructions.trim()) return <span className="training-load-instructions"><strong>Coach-set loading:</strong> {block.loadingInstructions}</span>;
  return null;
}
