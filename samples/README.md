# Sample Oracle SQL Files

These are sample Oracle SQL files for testing the migration toolkit. They cover increasing complexity levels:

| File | Complexity | What It Tests |
|------|-----------|---------------|
| `01_datatypes_table.sql` | 🟢 Simple | All major Oracle data types, SEQUENCE, constraints, indexes |
| `02_function_conversions.sql` | 🟡 Moderate | NVL, DECODE, string/date functions, ROWNUM, DUAL, LISTAGG, MINUS |
| `03_plsql_procedure.sql` | 🟡 Moderate | Cursor FOR LOOP, %TYPE, exception handling, DBMS_OUTPUT |
| `04_tricky_patterns.sql` | 🔴 Critical | CONNECT BY, (+) joins, empty-string=NULL, RETURNING INTO, BULK COLLECT |
| `05_package_conversion.sql` | 🔴 Critical | Full package spec+body, REF CURSOR, session state, initialization block |
| `06_oracle12c_semantics.sql` | 🔴 Critical | Identity columns, sequence defaults and triggers, bare `NUMBER` / `TIMESTAMP(9)`, case- and trailing-space-sensitive keys, nullable `UNIQUE`, `FETCH FIRST`, conversion-error defaults, date arithmetic, `ADD_MONTHS` / `GREATEST` edge cases, `MERGE … DELETE WHERE`, `FOR UPDATE NOWAIT` / `SKIP LOCKED`, global temporary table, database link synonym, caller-handled exceptions |
| `07_backup_and_dated_tables.sql` | 🟡 Moderate | Backup, dated, scratch and recycle-bin tables to comment out with their dependent statements; look-alikes to keep and flag |

The expected conversions for sample 06 are documented, with sources, in the [oracle-tsql-reference](../.github/skills/oracle-tsql-reference/SKILL.md) skill.

### Expected results for sample 07

| Table | Decision | Why |
|-------|----------|-----|
| `SHIPMENTS_BAK` (+ index, comment, grant) | Commented out — EX-001…004 | `_BAK` |
| `SHIPMENTS_20211014` | Commented out — EX-005 | Full date |
| `CARRIERS_BKP_2021_10_14` (+ insert) | Commented out — EX-006, EX-007 | Separated date and `_BKP` |
| `TMP_SHIPMENT_LOAD` | Commented out — EX-008 | `TMP_` |
| `SHIPMENTS_NEW` | Commented out — EX-009 | `_NEW` is ambiguous, but it's a `SELECT *` copy of `SHIPMENTS` |
| `"BIN$k1Jx9Q2pTgW5n8bQ==$0"` | Commented out — EX-010 | Recycle bin |
| `TMP_SHIPMENT_CART` | Kept, flagged — FL-001 | Global temporary table |
| `SHIPMENTS_OLD` | Kept, flagged — FL-002 | `_OLD`, but view `v_shipment_history` reads it |
| `SHIPMENT_HOLD`, `SHIPMENTS_ARCHIVE` | Kept, flagged — FL-003, FL-004 | Ambiguous words; `purge_shipments` uses both |
| `SHIPMENT_STATS_202110` | Kept, flagged — FL-005 | Monthly table |
| `SHIPMENTS` | Converted | Live table |

Sample 06 also gets one flag: its `TMP_ORDER_IMPORT` matches `TMP_`, but it's a global temporary table.

## How to Test

### Step 1: Copy samples to the input folder

```bash
cp samples/*.sql oracle-sql/
```

This works in bash, zsh and PowerShell. In Windows `cmd.exe`, use `copy samples\*.sql oracle-sql\`.

### Step 2: Run the full migration pipeline

Using the batch orchestrator (processes all files in parallel):

```
@migration-orchestrator migrate all
```

Or run each phase individually:

```
@migration-orchestrator evaluate all
@migration-orchestrator convert all
@migration-orchestrator validate all
@migration-orchestrator analyze all
```

### Step 3: Check status

```
@migration-orchestrator status
```

### Step 4: Review results

- **Evaluation reports**: `migration-reports/evaluation-*.md`
- **Converted T-SQL**: `tsql-output/*.sql`
- **Validation reports**: `migration-reports/validation-*.md`
- **Performance reports**: `migration-reports/performance-*.md`

### Step 5: Clean up (optional)

To reset and start fresh:

macOS / Linux:

```bash
rm oracle-sql/*.sql tsql-output/*.sql migration-reports/*.md
rm -f migration-reports/.migration-state.json
```

Windows (PowerShell):

```powershell
Remove-Item oracle-sql\*.sql, tsql-output\*.sql, migration-reports\*.md -ErrorAction SilentlyContinue
Remove-Item migration-reports\.migration-state.json -Force -ErrorAction SilentlyContinue
```

## Single File Testing

To test one file at a time with individual agents:

```bash
# Copy one file
cp samples/04_tricky_patterns.sql oracle-sql/

# Run each phase
@oracle-evaluator evaluate oracle-sql/04_tricky_patterns.sql
@oracle-to-tsql convert oracle-sql/04_tricky_patterns.sql
@tsql-validator validate tsql-output/04_tricky_patterns.sql
@performance-analyzer analyze tsql-output/04_tricky_patterns.sql
```
