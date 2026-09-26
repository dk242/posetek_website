export type IndependentCoachIntent = { uid: string; email: string; firstName: string; lastName: string };

/** Resume only for the Auth identity that started this signup. Keep intent on a failed write. */
export async function finishIndependentCoachSignup(
  intent: IndependentCoachIntent,
  steps: {
    currentUid: () => string | undefined;
    remember: (intent: IndependentCoachIntent) => void;
    writeProfile: (intent: IndependentCoachIntent) => Promise<unknown>;
    clear: () => void;
    verify: () => Promise<unknown>;
  },
): Promise<{ verificationSent: boolean }> {
  if (steps.currentUid() !== intent.uid) throw new Error("Sign in with the original account to finish signup.");
  steps.remember(intent);
  await steps.writeProfile(intent);
  if (steps.currentUid() !== intent.uid) throw new Error("Sign in with the original account to finish signup.");
  steps.clear();
  try { await steps.verify(); return { verificationSent: true }; }
  catch { return { verificationSent: false }; }
}
