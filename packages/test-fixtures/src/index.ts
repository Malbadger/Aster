/**
 * @law/test-fixtures — TEST-ONLY deterministic fixtures.
 *
 * Every artifact this package produces is labeled as a fixture so it can never
 * be mistaken for a live provider, credential, or real evidence (04 Forbidden
 * actions). Production code must not import from this package.
 */
export const FIXTURE_LABEL = "Aster-TEST-FIXTURE" as const;

/** Marks a value as fixture-origin for assertions and output labeling. */
export interface FixtureTagged {
  readonly __fixture: typeof FIXTURE_LABEL;
}

export function tagFixture<T extends object>(value: T): T & FixtureTagged {
  return { ...value, __fixture: FIXTURE_LABEL };
}
