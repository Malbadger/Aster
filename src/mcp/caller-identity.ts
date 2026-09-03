/**
 * Resolve the coordinating model at the MCP trust boundary.
 *
 * Desktop provider bridges set ASTER_COORDINATOR_MODEL on the process that
 * hosts MCP. A model-authored tool argument is retained only as a fallback for
 * external MCP clients that do not have an Aster phase identity.
 */
export function assertDelegationCaller(
  targetModel: string,
  suppliedCaller?: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const authoritative = environment.ASTER_COORDINATOR_MODEL?.trim();
  const effective = authoritative || suppliedCaller?.trim() || undefined;
  if (effective === targetModel) {
    throw new Error('Refused recursive delegation to the calling model. Choose a different model.');
  }
  return effective;
}
