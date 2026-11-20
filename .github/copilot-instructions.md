# Oracle to T-SQL Migration Project

## Project Overview

This project migrates Oracle SQL (PL/SQL) code to Microsoft SQL Server T-SQL. Oracle SQL files are placed in `oracle-sql/` and processed through a 5-phase pipeline: **evaluate → convert → validate → optimize → Power BI M-language**.

**Target Platform**: Microsoft SQL Server 2019+ (compatible with Azure SQL Database where noted)

## Directory Structure

```
oracle-sql/          → Drop Oracle SQL files here (source input, read-only)
tsql-output/         → Converted T-SQL files (generated output)
pbi-output/          → Power Query M files for Power BI (generated output)
migration-reports/   → Consolidated migration reports (one per source file)
samples/             → Sample Oracle files for testing the pipeline
.github/skills/      → Conversion references loaded on demand (see below)
```

## Custom Agents

| Agent | Purpose | When to use |
|-------|---------|-------------|
| `@oracle-evaluator` | Assess migration complexity and risks | Before converting — understand what you're dealing with |
| `@oracle-to-tsql` | Convert Oracle SQL to T-SQL | After evaluation — produce the T-SQL output |
| `@tsql-validator` | Validate correctness and semantic equivalence | After conversion — catch bugs before deployment |
| `@performance-analyzer` | Analyze performance and optimize | After validation — ensure production readiness |
| `@m-language-converter` | Convert T-SQL to Power Query M | When Power BI reports must move from Oracle to SQL Server |
| `@migration-orchestrator` | Batch process multiple files | When migrating many files at once |

## Workflow

1. **Drop** Oracle SQL files into `oracle-sql/`
2. **Evaluate** with `@oracle-evaluator` to assess complexity and identify issues
3. **Convert** with `@oracle-to-tsql` to generate T-SQL equivalents
4. **Validate** with `@tsql-validator` to verify correctness
5. **Optimize** with `@performance-analyzer` to ensure performance
6. **Power BI** with `@m-language-converter` when reports need Power Query M

For batch operations: `@migration-orchestrator migrate all`

---

## Reference Skills

The detailed mapping tables and patterns live in skills, so they load only when needed. Agents must read the relevant reference files rather than relying on memory.

| Skill | Contents | Read when |
|-------|----------|-----------|
| [oracle-tsql-reference](skills/oracle-tsql-reference/SKILL.md) | [Semantic differences](skills/oracle-tsql-reference/references/semantic-differences.md), [data types](skills/oracle-tsql-reference/references/data-types.md), [functions](skills/oracle-tsql-reference/references/functions.md), [syntax and PL/SQL](skills/oracle-tsql-reference/references/syntax-and-plsql.md), [conversion patterns](skills/oracle-tsql-reference/references/conversion-patterns.md), [sources](skills/oracle-tsql-reference/references/sources.md) | Evaluating, converting, validating or optimizing any file |
| [oracle-data-profiling](skills/oracle-data-profiling/SKILL.md) | Oracle profiling queries that settle data-dependent mappings; paired Oracle/T-SQL reconciliation queries | A mapping depends on the data, or data has been loaded |

Power BI M-language rules live in `@m-language-converter` and `.github/instructions/pbi-output.instructions.md`.

---

## ⚠️ Critical Semantic Rules (always apply)

These cause **silent behavioural changes**: the code runs without errors but returns different results. Each rule links to its details, examples and sources in [semantic-differences.md](skills/oracle-tsql-reference/references/semantic-differences.md).

1. **Empty string is NULL in Oracle** (🔴). Convert with `CASE WHEN DATALENGTH(x) = 0 THEN NULL ELSE x END`. Never use `NULLIF(x, N'')`, `x = N''`, `x <> N''` or `LEN(x) = 0`: SQL Server pads trailing spaces, so they also treat `' '` as empty. Oracle `IS NOT NULL` → `DATALENGTH(x) > 0`. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#1-empty-string--null) · [Oracle Nulls](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Nulls.html) · [SQL Server string comparison](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/string-comparison-assignment)
2. **Trailing spaces** (🔴). Oracle compares `VARCHAR2` without padding (`'a ' <> 'a'`); SQL Server pads, so `=`, `GROUP BY`, joins and `UNIQUE` treat them as equal. Profile key and join columns. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#2-trailing-spaces-in-string-comparisons) · [Oracle comparison rules](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Type-Comparison-Rules.html)
3. **Case sensitivity** (🔴). Oracle's default comparison is case-sensitive; SQL Server's default collation `SQL_Latin1_General_CP1_CI_AS` isn't. Decide and record the target collation; use a `_CS_` or `_BIN2` collation where case must matter. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#3-case-sensitivity-and-collation) · [Collation and Unicode support](https://learn.microsoft.com/en-us/sql/relational-databases/collations/collation-and-unicode-support)
4. **UNIQUE and NULL** (🔴). Oracle allows many NULLs in a unique key; SQL Server allows one. Nullable single column → filtered unique index (`WHERE col IS NOT NULL`); nullable composite key → indexed view excluding all-NULL rows. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#4-unique-constraints-and-null) · [Oracle constraints](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/constraint.html) · [SQL Server unique constraints](https://learn.microsoft.com/en-us/sql/relational-databases/tables/unique-constraints-and-check-constraints)
5. **DECODE matches NULL** (🔴). Use `CASE WHEN x IS NULL`, never `CASE x WHEN NULL`. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#5-decode-matches-null)
6. **Bare `NUMBER`** (🔴). Never map it to `DECIMAL(18,0)` (it rounds fractions). Profile it; if unknown use `DECIMAL(38,10)` with a `-- MIGRATION WARNING:`. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#6-number-without-precision) · [Oracle NUMBER](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [SSMA type mapping](https://learn.microsoft.com/en-us/sql/ssma/oracle/project-settings-type-mapping-oracletosql)
7. **Conversion errors** (🔴). `TO_DATE` / `TO_NUMBER` fail on bad input; `TRY_CONVERT` / `TRY_CAST` return NULL. Use `CONVERT` / `CAST`, and `TRY_` only where Oracle used `DEFAULT … ON CONVERSION ERROR` or `VALIDATE_CONVERSION`. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#7-conversion-errors-vs-try_-functions) · [Oracle TO_DATE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_DATE.html) · [TRY_CONVERT](https://learn.microsoft.com/en-us/sql/t-sql/functions/try-convert-transact-sql)
8. **`DATE` includes time** (🟡). Default to `DATETIME2(0)`. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#8-oracle-date-includes-time)
9. **Date arithmetic** (🟡). `d2 - d1` → `DATEDIFF_BIG(SECOND, d1, d2) / 86400.0`, because `DATEDIFF(DAY, …)` counts midnights. `DATEADD` truncates fractional days such as `+ 1/24`. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#9-date-arithmetic-and-fractional-days) · [DATEDIFF](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-transact-sql) · [DATEADD](https://learn.microsoft.com/en-us/sql/t-sql/functions/dateadd-transact-sql)
10. **`GREATEST` / `LEAST`** (🟡). Oracle returns NULL if any argument is NULL; SQL Server ignores NULL arguments. Add a NULL guard. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#10-greatest--least-with-null) · [SQL Server GREATEST](https://learn.microsoft.com/en-us/sql/t-sql/functions/logical-functions-greatest-transact-sql)
11. **Concatenation** (🟡). Use `CONCAT()`, not `+`, which propagates NULL. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#11-string-concatenation-with-null)
12. **NULL sort order** (🟡). Oracle sorts NULLs last for ascending order; SQL Server sorts them first. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#12-null-sort-order)
13. **Integer division** (🟡). SQL Server `5 / 2 = 2`; cast to `DECIMAL`. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#13-integer-division)
14. **Division by zero** (🟡). SQL Server raises error 8134 for integer, decimal and float alike — it never returns NULL by default. Oracle `BINARY_DOUBLE` returns infinity instead. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#14-division-by-zero) · [SET ANSI_WARNINGS](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-ansi-warnings-transact-sql)
15. **ROWNUM before ORDER BY** (🟡). Oracle assigns `ROWNUM` before sorting; preserve that or fix it deliberately with a note. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#15-rownum-is-assigned-before-order-by)
16. **Weekday numbers** (🟡). `TO_CHAR(d, 'D')` depends on `NLS_TERRITORY`, `DATEPART(WEEKDAY, d)` on `@@DATEFIRST`. Use `(DATEPART(WEEKDAY, d) + @@DATEFIRST - 2) % 7 + 1` (ISO). [Details](skills/oracle-tsql-reference/references/semantic-differences.md#16-weekday-numbering) · [Oracle format models](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Format-Models.html) · [SET DATEFIRST](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-datefirst-transact-sql)
17. **Transactions** (🟡). SQL Server autocommits; an inner `COMMIT` only decrements `@@TRANCOUNT`. Procedures that own their transaction use `SET XACT_ABORT ON` and the `@@TRANCOUNT` pattern; keep `XACT_ABORT` OFF where Oracle callers handle a subprogram's exception and carry on. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#17-transactions-and-error-handling) · [SET XACT_ABORT](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-xact-abort-transact-sql) · [Oracle unhandled exceptions](https://docs.oracle.com/en/database/oracle/oracle-database/19/lnpls/unhandled-exceptions.html)
18. **Read consistency** (🟡). Oracle readers never block writers. Recommend `READ_COMMITTED_SNAPSHOT ON`; never add `NOLOCK`. `SELECT … FOR UPDATE` needs lock hints inside an explicit transaction. [Details](skills/oracle-tsql-reference/references/semantic-differences.md#18-read-consistency-and-blocking) · [Row versioning guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide)

---

## Coding Standards

### General
- Target **SQL Server 2019+** unless otherwise specified
- Use `NVARCHAR` over `VARCHAR` for Unicode support unless confirmed ASCII-only
- Use schema-qualified object names: `[dbo].[TableName]`
- Include `GO` batch separators between DDL statements
- Use `SET ANSI_NULLS ON` and `SET QUOTED_IDENTIFIER ON` at the start of each file (filtered and indexed-view unique keys also require them)
- State the target collation; add `COLLATE` to columns that must stay case-sensitive

### Procedures and Functions
- Include `SET NOCOUNT ON` as the first statement
- Use `BEGIN TRY` / `BEGIN CATCH` for all error handling
- Use `THROW` over `RAISERROR` for new code
- Use `CREATE OR ALTER` (SQL Server 2016 SP1+)
- Use `@@TRANCOUNT` checks before `BEGIN TRANSACTION` to avoid nested transaction issues
- Add `SET XACT_ABORT ON` to procedures that own their transaction ([template](skills/oracle-tsql-reference/references/conversion-patterns.md#transactions-and-error-handling))

### Type Conversions
- Prefer `COALESCE` over `ISNULL` (ANSI compliance, multi-argument support)
- Use `DATETIME2` over `DATETIME` (better precision and range)
- Use `CONVERT` / `CAST` where the Oracle code would raise an error; use `TRY_CAST` / `TRY_CONVERT` only where the Oracle code tolerated bad input (`DEFAULT … ON CONVERSION ERROR`, `VALIDATE_CONVERSION`, or an exception handler that substitutes a value)
- Map `NUMBER(1)` to `SMALLINT` by default: `TINYINT` can't hold Oracle's −9…−1. Use `BIT` when a `CHECK (col IN (0,1))` exists, and `TINYINT` only when profiling shows no negatives ([data types](skills/oracle-tsql-reference/references/data-types.md#numeric-types))

### Migration Annotations
- `-- MIGRATION NOTE:` — Documents non-trivial conversions or behavioral differences
- `-- MIGRATION WARNING:` — Flags areas needing human review or testing
- `-- MIGRATION TODO:` — Marks incomplete items requiring additional work
- Preserve original Oracle comments — they often contain business logic context

### What NOT to Use (deprecated or problematic)
- ❌ `SET ROWCOUNT` — use `TOP` instead
- ❌ `*=` / `=*` joins — use `LEFT JOIN` / `RIGHT JOIN`
- ❌ `DATETIME` — use `DATETIME2`
- ❌ `NTEXT` / `TEXT` / `IMAGE` — use `NVARCHAR(MAX)` / `VARBINARY(MAX)`
- ❌ `sp_rename` for constraint names in migration — use `DROP` + `CREATE`
- ❌ `NOLOCK` hints as a blanket fix — use RCSI instead
- ❌ `NULLIF(x, N'')`, `x = N''`, `x <> N''` or `LEN(x) = 0` to emulate Oracle's empty-string rule — use `DATALENGTH`
- ❌ `DECIMAL(18,0)` for a bare Oracle `NUMBER` — profile it first

---

## Sources

Rules cite the Oracle Database 19c documentation and Microsoft Learn. The full list, with provenance and licensing notes, is in [sources.md](skills/oracle-tsql-reference/references/sources.md). Microsoft's tool for this migration direction is [SSMA for Oracle](https://learn.microsoft.com/en-us/sql/ssma/oracle/sql-server-migration-assistant-for-oracle-oracletosql).
