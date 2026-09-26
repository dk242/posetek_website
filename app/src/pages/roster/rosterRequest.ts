/** A response can update roster state only for its own request and account. */
export function isCurrentRosterRequest(request: number, latest: number, startedUid: string, currentUid?: string): boolean {
  return request === latest && startedUid === currentUid;
}
