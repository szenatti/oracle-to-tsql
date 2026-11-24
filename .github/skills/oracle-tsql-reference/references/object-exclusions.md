# Backup, Dated and Leftover Tables

Oracle schemas collect one-off copies: backups (`ORDERS_BAK`), dated snapshots (`ORDERS_20211014`), scratch tables (`TMP_ORDERS`) and Oracle's own leftovers (`BIN$…`). Converting them recreates the clutter in SQL Server. These rules decide which `CREATE TABLE` statements (including `CREATE TABLE … AS SELECT`) are **commented out** instead of created.

Every table that matches a rule ends up with one decision:

| Decision | What happens | ID |
|---|---|---|
| **Excluded** | Converted, then commented out with its dependent statements | `EX-nnn` per commented statement |
| **Flagged** | Converted and kept, with a `-- MIGRATION WARNING:`; a person decides | `FL-nnn` per table |
| **Included** | Kept because [`migration-exclusions.json`](#project-overrides) says so | — |

In Copilot CLI the extension applies these rules for you (see [Tool support](#tool-support)); agents confirm its results. In VS Code, apply them by reading the source.

## How names are matched

The bare table name is matched case-insensitively; schema and quotes are ignored. The name is split on `_`. Trailing dates and counters are read first, then the last remaining word, then the first word. When several rules match, the stronger result wins (excluded beats flagged).

## Commented out automatically

| Pattern | Category |
|---|---|
| Suffix `_BAK`, `_BKP`, `_BACKUP`, `_BK`, `_BCK`, `_BKUP`, `_OLD`, `_ORIG`, `_SAVE` | Backup table |
| Prefix `BAK_`, `BKP_`, `BACKUP_`, `OLD_` | Backup table |
| Suffix `_TMP`; prefix `TMP_` | Scratch table |
| Suffix `_DUP`, `_DUPS`, `_CLONE`, `_RESTORE`, `_BEFORE`, `_AFTER` | Copy of another table |
| Suffix `_DROP`, `_TODELETE`, `_DEPRECATED`, `_OBSOLETE`, `_UNUSED`, `_DONOTUSE`; prefix `ZZ_`, `ZZZ_` | Marked for deletion |
| A backup word with a number: `_BAK2`, `_BAK_1`, `_OLD2`, `_COPY1`, `_COPY_1` | Backup or copy |
| A [full date](#dates), alone or next to other markers: `_20211014`, `_20211014_BAK`, `_BAK_20211014`, `_20211014_V2` | Dated snapshot |
| `BIN$…` (recycle bin), `SYS_EXPORT_…`/`SYS_IMPORT_…` (Data Pump), `MLOG$_…`/`RUPD$_…` (materialized view logs), `DR$…` (Oracle Text), `CMP3$…`/`CMP4$…` (compression advisor), `PLAN_TABLE`, `TOAD_PLAN_TABLE`, `CHAINED_ROWS`, `EXCEPTIONS` | Oracle system or tool object |

The [guards](#guards-kept-even-when-the-name-matches) can still keep these.

## Flagged only

| Pattern | Real table it might be |
|---|---|
| `_NEW` | The live table after a rename swap |
| `_COPY` (no number), `_PREV` | `DOCUMENT_COPY`, `ADDRESS_PREV` |
| `_SAV` | Savings (banking) |
| `_ARCH`, `_ARCHIVE` | An archive purge jobs still write to |
| `_HOLD`, `_DEL` | Hold status; delivery; trigger-filled deleted-row audit |
| `_TEST`, `_TEMP`; prefix `TEMP_`, `TEST_` | `LAB_TEST`, temperature readings |
| Prefix `X_` | Cross-reference table |
| `_SNAP`, `_SNAPSHOT`, `_PRE`, `_POST`, `_FIX`, `_MIG`, `_CONV` | Reporting snapshot or processing stage |
| A flag word with a number: `_NEW2`, `_TEST1` | As above |
| Number alone: one digit, zero-padded or versioned (`_2`, `_01`, `_V2`) | `_V2` is often the current version |
| A [period](#dates): `_202110`, `_2021`, `_OCT2021`, `_Q1_2021`, `_FY21` | Monthly or yearly table still read by views |
| No underscore: `ORDERSBAK`, `ORDERS20211014` | Names that only end in those letters |
| Prefix `ERR$_` | DML error log the application still uses |

## Dates

**Full date → commented out.**
- 8 digits that form a valid date as `YYYYMMDD`, `DDMMYYYY` or `MMDDYYYY`, with a year from 1900 to 2099.
- `YYYYMMDDHHMM` or `YYYYMMDDHHMMSS`.
- `DDMONYYYY` or `DDMONYY` (`14OCT2021`).
- Separated: `YYYY_MM_DD`, `DD_MM_YYYY`, `MM_DD_YYYY`, `DD_MON_YYYY`, `YYYY_MON_DD`.
- Any of those followed by a time: `_20211014_1530`, `_2021_10_14_153000`.

**Period → flagged.** `YYYYMM` or `YYMMDD` (6 digits), a year from 1990 to 2099, `YYYYDDD` (Julian), `MONYYYY`, `MONYY`, `YYYYMON`, `MON_YYYY`, `YYYY_MM`, `MM_YYYY`, `Q1_2021`, `2021Q1`, `FY21`, `FY_2021`.

Digits that don't form a date are ignored: `ACCOUNT_10000001`, `ORDERS_12345678`, `COUNTRY_ISO_3166`, `ROUTE_66`.

## Guards: kept even when the name matches

An automatic match is **flagged instead** when:

1. **It's a temporary table.** `CREATE GLOBAL TEMPORARY TABLE` and `CREATE PRIVATE TEMPORARY TABLE` are usually used by application code.
2. **Kept code uses it.** Any statement other than the table's own `CREATE` and its [dependent statements](#dependent-statements) that names it:
   - views, procedures, functions, packages, and triggers on other tables;
   - foreign keys (`REFERENCES`) from kept tables;
   - `CREATE TABLE … AS SELECT` of a kept table;
   - DML inside PL/SQL, and dynamic SQL strings (`EXECUTE IMMEDIATE 'DELETE FROM orders_bak'`).

   Comments don't count, and neither do statements that are themselves commented out. Re-check until nothing changes: in a chain of copies, if the last copy is used, the whole chain is kept.
3. **An override includes it.**

## Promotion: flagged → commented out

A flagged name is commented out when it was made with `CREATE TABLE x AS SELECT * FROM base` and `base` is created in the sources (for example `SHIPMENTS_NEW AS SELECT * FROM SHIPMENTS`). The guards still apply. For other flagged tables, the [Oracle catalog check](../../oracle-data-profiling/references/oracle-profiling-queries.md#p11--leftover-table-usage) shows whether anything depends on the table or still changes it.

## Dependent statements

These are commented out with the table, each with its own `EX-` ID:
- `CREATE INDEX … ON`, `ALTER TABLE`, `COMMENT ON TABLE` and `COMMENT ON COLUMN`;
- `GRANT … ON`, `CREATE SYNONYM … FOR`, and `CREATE TRIGGER … ON` the table;
- top-level `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `DROP` and `ANALYZE` that target it.

A dependent statement in another file is commented out in that file and recorded in that file's report, with a note naming the file that defines the table.

Tables made by `RENAME` or `ALTER TABLE … RENAME TO` have no `CREATE TABLE`, so the extension can't see them. Apply the name rules to the new name yourself.

## Project overrides

`migration-exclusions.json` at the repository root holds the project's decisions. Commit it, so the team shares them and reviews changes in pull requests.

```json
{
  "include": [
    { "name": "HR.ORDER_HOLD", "reason": "Live hold-status table", "by": "jsmith", "date": "2026-11-24" }
  ],
  "exclude": [
    { "name": "SALES.CUST_TEMP_LOAD", "reason": "One-off 2019 load", "by": "jsmith", "date": "2026-11-24" }
  ],
  "extraPatterns": [
    { "pattern": "_CR[0-9]{4,}$", "tier": "exclude", "reason": "Change-request copies" }
  ]
}
```

- **Names** are `TABLE` or `SCHEMA.TABLE`, case-insensitive. A `TABLE` entry matches it in any schema.
- **`reason` is required** on every entry; it's copied into the report as the audit trail.
- **Precedence:** `include`/`exclude` by name beat everything. Otherwise the built-in rules and `extraPatterns` are combined, and the stronger tier wins.
- **`exclude` skips the guards.** If kept code still uses the table, the report row carries a warning naming that code.
- **`extraPatterns`** are case-insensitive regular expressions tested against the bare name. `tier` is `"exclude"` or `"flag"`. Use them for project habits no generic rule can catch, such as initials or ticket numbers (`_JS`, `_CR1234`).
- **Errors don't stop the run.** Invalid JSON, a missing `reason`, a name in both lists, a bad regular expression, or a name that matches no `CREATE TABLE` are reported and the entry is ignored. Record them under the report's Consolidated Action Items.
- **When someone decides a flagged table,** add it to `include` or `exclude` so later runs give the same answer.

## Commenting out

Every statement the pipeline comments out gets a marker in the T-SQL and a row in the report. That includes these tables and **anything else** commented out for another reason, such as an Oracle feature with no SQL Server equivalent. Never comment out code silently.

1. **Convert first, then comment.** Comment out the converted T-SQL, so restoring it gives working code. Prefix every line with `-- `, including `GO`. Don't use `/* … */`: it breaks if the code contains `*/`, and a block can't wrap a `GO`.
2. **Put the marker line first:**
   `-- MIGRATION EXCLUDED [EX-nnn]: <reason> <object> (<rule>) — not created. To restore, remove the leading "-- " from the lines below.`
3. **Code with no T-SQL equivalent:** comment out the original Oracle text and say what replaces it:
   `-- MIGRATION EXCLUDED [EX-nnn]: unsupported — DBMS_JOB.SUBMIT has no SQL Server equivalent; Oracle source kept below. Re-implement as a SQL Server Agent job.`
4. **IDs are per file.** Detected statements are numbered `EX-001` upwards in source order. The converter numbers anything else it comments out after the last detected ID. Keep the IDs the evaluation assigned.

```sql
-- MIGRATION EXCLUDED [EX-001]: backup table SHIPMENTS_BAK (auto: _BAK) — not created. To restore, remove the leading "-- " from the lines below.
-- SELECT * INTO [dbo].[shipments_bak] FROM [dbo].[shipments];
-- GO
-- MIGRATION EXCLUDED [EX-002]: depends on SHIPMENTS_BAK — not created. To restore, remove the leading "-- " from the lines below.
-- CREATE INDEX [ix_shipments_bak_carrier] ON [dbo].[shipments_bak] ([carrier_code]);
-- GO
```

A flagged table is converted normally, with a warning above it:

```sql
-- MIGRATION WARNING [FL-002]: SHIPMENTS_OLD looks like a backup (auto: _OLD) but is kept: referenced by v_shipment_history. Confirm, then record the decision in migration-exclusions.json.
```

## Recording in the migration report

Section **1.8 Excluded and Commented-Out Code** of `migration-reports/migration-<file>.md` lists every row. The template is in [oracle-evaluator.md](../../../agents/oracle-evaluator.md#4-generate-report). Each phase updates it during the run:

| Phase | Updates |
|---|---|
| Evaluate | Writes every `EX-` row, `FL-` row, included-by-override row and override error |
| Convert | Fills in **Output lines** and adds a row for anything else it commented out |
| Validate | Fills in **Verified**. Markers and rows must match one to one, and no live statement may reference an excluded table; a mismatch is a 🔴 finding |
| Finalize | Adds the counts to the executive summary, and turns each `FL-` row and override error into a Consolidated Action Item |

The batch evaluation summary lists every excluded object across files, because the data load needs that list.

## Data migration

Skip excluded tables in the data load and in the [reconciliation queries](../../oracle-data-profiling/references/reconciliation-queries.md). Load flagged tables until someone decides.

## Tool support

In Copilot CLI, the `oracle-migration` extension applies these rules in `exclusions.mjs`:
- `scan_oracle_files` returns counts per file;
- `get_object_exclusions` returns the `EX-`/`FL-` rows;
- `generate_batch_plan` puts each file's rows into the evaluate, convert and validate prompts.

The extension rules and this page must stay in sync. Run `node --test .github/extensions/oracle-migration/exclusions.test.mjs` after changing either.
