/** Read existing invitation fields without changing the admission contract. */
export function playerSignup(data: unknown): { registered: boolean; signupCode: string | null } {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const registered = record.registered === true || Boolean(record.userUID) || Boolean(record.authenticationUID);
  const code = [record.signupCode, record.code].find(value => typeof value === "string" && value.trim());
  return { registered, signupCode: registered || typeof code !== "string" ? null : code.trim() };
}
