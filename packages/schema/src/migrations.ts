/**
 * Forward migrations. Each entry upgrades a document from version N to N+1.
 * Version 1 is the first version, so the table is empty; keep the scaffolding
 * so the first breaking change has an obvious home.
 */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {};

export function migrate(doc: Record<string, unknown>, from: number): Record<string, unknown> {
  let current = doc;
  for (let v = from; migrations[v]; v++) {
    current = { ...migrations[v]!(current), schemaVersion: v + 1 };
  }
  return current;
}
