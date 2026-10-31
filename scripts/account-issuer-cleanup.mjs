import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// PR #135 operator procedure. Better Auth 1.7.2 added account.issuer
// (NOT NULL, no default) and account_issuer_accountId_uidx; 1.7.3+ removed
// both, and its writes fail against them. Diffing a fresh 1.7.2 schema with a
// fresh 1.7.7 one shows these are the only two differences.
//
// Run with the app STOPPED, against a restored copy first. Without --apply it
// only reports. --apply drops exactly the index and the column in one
// transaction, and commits only if integrity, foreign keys, row counts and
// every other schema object are unchanged. Output names tables and counts,
// never row values. Rollback is restoring the pre-cleanup backup; commit
// 71cc417 also re-adds the column itself on boot when it is missing.
const INDEX = 'account_issuer_accountId_uidx';

export function cleanupAccountIssuer(file, { apply = false } = {}) {
  if (!fs.existsSync(file)) throw Error(`No database at ${file}`);
  const wal = `${file}-wal`;
  if (apply && fs.existsSync(wal) && fs.statSync(wal).size > 0)
    throw Error('Write-ahead log is not empty: stop the app (or checkpoint) before --apply');
  const db = new DatabaseSync(file, { readOnly: !apply });
  try {
    const one = sql => db.prepare(sql).get();
    const all = sql => db.prepare(sql).all();
    const report = { file, sqlite: one('SELECT sqlite_version() AS v').v, applied: false };
    if (!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account'")) return { ...report, state: 'no_account_table' };
    const columns = () => all('PRAGMA table_info(account)').map(c => c.name);
    if (!columns().includes('issuer')) return { ...report, state: 'already_clean' };

    const refusals = [];
    const integrity = () => all('PRAGMA integrity_check').map(r => r.integrity_check);
    if (integrity().join() !== 'ok') refusals.push('integrity_check_failed');
    if (all('PRAGMA foreign_key_check').length) refusals.push('foreign_key_violations');
    const issuerIndexes = all('PRAGMA index_list(account)').map(i => i.name)
      .filter(name => all(`PRAGMA index_info("${name}")`).some(c => c.name === 'issuer'));
    if (issuerIndexes.join() !== INDEX) refusals.push(`unexpected_issuer_indexes:${issuerIndexes.join('|') || 'none'}`);
    // Triggers and views are the other objects that make DROP COLUMN fail or misbehave.
    if (all("SELECT name FROM sqlite_master WHERE type IN ('trigger','view') AND sql LIKE '%issuer%'").length)
      refusals.push('issuer_referenced_by_trigger_or_view');
    // Only email-and-password accounts exist on this server. Another provider
    // may need issuer to tell accounts apart; dropping it is not reviewed for that.
    const providers = all('SELECT providerId AS provider, COUNT(*) AS n FROM account GROUP BY providerId');
    if (providers.some(p => p.provider !== 'credential')) refusals.push('non_credential_accounts_present');
    if (one('SELECT COUNT(*) AS n FROM (SELECT 1 FROM account GROUP BY providerId, accountId HAVING COUNT(*) > 1)').n)
      refusals.push('duplicate_provider_account_ids');

    const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(t => t.name);
    // FTS shadow tables can be large; their counts are not needed to prove the change.
    const counts = () => Object.fromEntries(tables.filter(t => !/_fts(_|$)/.test(t))
      .map(t => [t, one(`SELECT COUNT(*) AS n FROM "${t}"`).n]));
    const otherSchema = () => crypto.createHash('sha256').update(JSON.stringify(
      all(`SELECT type, name, sql FROM sqlite_master WHERE name NOT IN ('account', '${INDEX}') ORDER BY type, name`))).digest('hex');
    const before = { counts: counts(), otherSchemaSha256: otherSchema(), accountColumns: columns() };
    Object.assign(report, { state: refusals.length ? 'refused' : 'needs_cleanup', refusals, providers, before });
    if (!apply || refusals.length) return report;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`DROP INDEX "${INDEX}"`);
      db.exec('ALTER TABLE account DROP COLUMN issuer');
      const after = { counts: counts(), otherSchemaSha256: otherSchema(), accountColumns: columns() };
      const expected = before.accountColumns.filter(c => c !== 'issuer');
      const problems = [];
      if (integrity().join() !== 'ok') problems.push('integrity_check_failed_after');
      if (all('PRAGMA foreign_key_check').length) problems.push('foreign_key_violations_after');
      if (JSON.stringify(after.counts) !== JSON.stringify(before.counts)) problems.push('row_counts_changed');
      if (after.otherSchemaSha256 !== before.otherSchemaSha256) problems.push('other_schema_changed');
      if (JSON.stringify(after.accountColumns) !== JSON.stringify(expected)) problems.push('account_columns_unexpected');
      if (problems.length) throw Error(`Rolled back: ${problems.join(', ')}`);
      db.exec('COMMIT');
      return { ...report, state: 'cleaned', applied: true, after };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, flag] = process.argv.slice(2);
  if (!file || (flag && flag !== '--apply')) {
    console.error('usage: node account-issuer-cleanup.mjs <app.sqlite> [--apply]');
    process.exit(2);
  }
  try {
    const result = cleanupAccountIssuer(file, { apply: flag === '--apply' });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.state === 'refused' ? 1 : 0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
