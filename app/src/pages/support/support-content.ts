// Contact details and question anchors for the support page. App Store Connect's
// Support URL points at /support, and support replies deep-link to the question
// anchors (for example /support#delete-account): do not rename them.

export const SUPPORT_EMAIL = "nolanj@posetek.net";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("PoseTek support")}`;

/** Oldest iOS the app runs on (IPHONEOS_DEPLOYMENT_TARGET in the iOS project). */
export const MINIMUM_IOS_VERSION = "16.2";

export type SupportQuestionId =
  | "requirements"
  | "create-account"
  | "forgot-password"
  | "camera"
  | "analysis"
  | "delete-account"
  | "parents"
  | "coaches-and-clubs";

export const SUPPORT_QUESTIONS: ReadonlyArray<{ id: SupportQuestionId; question: string }> = [
  { id: "requirements", question: "What do I need to use PoseTek?" },
  { id: "create-account", question: "How do I create an account or join my team?" },
  { id: "forgot-password", question: "I forgot my password" },
  { id: "camera", question: "The camera won't open or record" },
  { id: "analysis", question: "My video wasn't analyzed, or a result looks wrong" },
  { id: "delete-account", question: "How do I delete my account or my data?" },
  { id: "parents", question: "I'm a parent or guardian" },
  { id: "coaches-and-clubs", question: "I'm a coach or run a club" },
];
