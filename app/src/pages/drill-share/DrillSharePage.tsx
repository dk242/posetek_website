export default function DrillSharePage({ drill }: { drill: "broadJump" | "changeOfDirection" | "dribbling" }) {
  return <div className="pt-drill" data-drill={drill} data-porting="in-progress" />;
}
