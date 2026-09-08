import { useEffect, useRef, useState } from "react";

export default function SignupStatus({ registered, signupCode, playerName }: {
  registered: boolean;
  signupCode: string | null;
  playerName: string;
}) {
  type Feedback = "idle" | "copying" | "copied" | "failed";
  const [result, setResult] = useState<{ code: string | null; status: Feedback }>({ code: null, status: "idle" });
  const feedback = result.code === signupCode ? result.status : "idle";
  const attempt = useRef(0);

  useEffect(() => () => { attempt.current += 1; }, [signupCode, registered]);

  useEffect(() => {
    if (feedback !== "copied") return;
    const timer = window.setTimeout(() => setResult({ code: signupCode, status: "idle" }), 2500);
    return () => window.clearTimeout(timer);
  }, [feedback, signupCode]);

  async function copyCode() {
    if (!signupCode) return;
    const currentAttempt = ++attempt.current;
    setResult({ code: signupCode, status: "copying" });
    try {
      await navigator.clipboard.writeText(signupCode);
      if (currentAttempt === attempt.current) setResult({ code: signupCode, status: "copied" });
    } catch {
      if (currentAttempt === attempt.current) setResult({ code: signupCode, status: "failed" });
    }
  }

  if (registered) return null;
  return (
    <div className="admin-signup">
      <span className="admin-chip warn">Awaiting signup</span>
      {signupCode ? (
        <>
          <code className="admin-signup-code" aria-label={`Signup code for ${playerName}`}>{signupCode}</code>
          <button
            className="quiet-button small admin-copy-code"
            type="button"
            aria-label={`Copy signup code for ${playerName}`}
            disabled={feedback === "copying"}
            onClick={() => void copyCode()}
          >
            <span className="material-symbols-outlined" aria-hidden="true">{feedback === "copied" ? "check" : "content_copy"}</span>
            {feedback === "copied" ? "Copied" : "Copy"}
          </button>
        </>
      ) : <span className="admin-code-unavailable">Code unavailable</span>}
      <span className={feedback === "failed" ? "admin-copy-error" : "admin-sr-only"} role="status">
        {feedback === "failed" ? "Couldn’t copy. Select the code to copy it manually." : feedback === "copied" ? "Signup code copied." : ""}
      </span>
    </div>
  );
}
