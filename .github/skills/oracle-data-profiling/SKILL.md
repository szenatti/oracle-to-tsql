---
name: oracle-data-profiling
description: Generate Oracle-side data profiling queries before converting an Oracle schema to SQL Server, and paired Oracle and T-SQL reconciliation queries after the data is loaded. Finds data that SQL Server treats differently (case-only and trailing-space duplicates, spaces-only strings, several NULLs in UNIQUE keys, fractional values in NUMBER columns, time parts in DATE columns, sub-100ns TIMESTAMP precision, negative small integers, infinity and NaN), then checks row counts, column aggregates and row hashes. Use when choosing type mappings or collation, or when validating migrated data.
---

# Oracle Data Profiling and Reconciliation

Some mapping decisions can't be made from DDL alone. Examples: whether a bare `NUMBER` holds decimals, or whether a `UNIQUE` column contains values that only differ by case. This skill gives you the queries that settle them, and the checks that prove the loaded data matches.

## When to use

| Situation | Use |
|-----------|-----|
| `@oracle-evaluator` finds a decision that depends on data (see the table below) | Add the matching profiling queries to the report's **1.7 Data Profiling** section |
| Choosing the target collation | P1–P3 on unique and join columns |
| Data has been loaded into SQL Server | [reconciliation-queries.md](./references/reconciliation-queries.md) |

| Decision | Check |
|----------|-------|
| Case-insensitive collation on unique or join columns | P1 case-only duplicates |
| Unique or join columns may differ only by trailing spaces | P2 trailing-space duplicates |
| Strings that would equal `''` in SQL Server | P3 spaces-only values |
| `UNIQUE` on nullable columns | P4 NULLs in unique keys |
| `NUMBER(1)`–`NUMBER(4)`: `BIT`, `TINYINT` or `SMALLINT` | P5 range and distinct values |
| Bare `NUMBER` / `INTEGER` columns | P6 integer digits and scale |
| `DATE` → `DATE` or `DATETIME2(0)` | P7 time parts and BC dates |
| `TIMESTAMP(8)` / `TIMESTAMP(9)` | P8 sub-100 ns digits |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | P9 infinity and NaN |
| `NVARCHAR(n)` sizing with `CHAR` semantics | P10 UTF-16 length |
| A flagged backup, dated or leftover table: exclude or keep | P11 leftover table usage |

## Workflow

1. Run the dictionary queries in [oracle-profiling-queries.md](./references/oracle-profiling-queries.md#dictionary-queries) to list candidate columns and unique keys. Replace `HR` with the source schema.
2. For each candidate, generate the matching check (P1–P11) with real table and column names. For many string columns, use the [schema-wide string profiler](./references/oracle-profiling-queries.md#schema-wide-string-profiler).
3. The evaluator can't connect to Oracle. Put the queries in the report and mark the affected mappings **pending profiling**, with the default safe choice from [data-types.md](../oracle-tsql-reference/references/data-types.md).
4. After a DBA runs them, record the results and finalize the mappings.
5. After the data load, run the paired queries in [reconciliation-queries.md](./references/reconciliation-queries.md) and record any mismatches as validation findings.

Profiling queries scan whole tables. Run them against a copy or off-peak, and restrict them to key columns where possible.

## Attribution

The reconciliation approach (row counts → column aggregates → row hashes → sampling) is adapted from [oracle/skills — Migration data validation](https://github.com/oracle/skills/blob/main/db/migrations/migration-data-validation.md), used under the [UPL 1.0](https://github.com/oracle/skills/blob/main/LICENSE.txt) and rewritten for the Oracle → SQL Server direction. Rule sources are in [sources.md](../oracle-tsql-reference/references/sources.md).
