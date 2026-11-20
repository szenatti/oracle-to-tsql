---
name: oracle-tsql-reference
description: Oracle SQL and PL/SQL to SQL Server T-SQL conversion reference. Data type, function and syntax mappings, PL/SQL constructs, conversion patterns (identity columns, sequences, MERGE, triggers, transactions, locking, database links, synonyms, temporary tables) and silent semantic differences (empty strings, trailing spaces, collation, UNIQUE and NULL, numeric and timestamp precision, conversion errors, date arithmetic). Use when evaluating, converting, validating or optimizing Oracle code migrated to SQL Server 2019+ or Azure SQL.
---

# Oracle → T-SQL Conversion Reference

Detailed conversion rules used by `@oracle-evaluator`, `@oracle-to-tsql`, `@tsql-validator` and `@performance-analyzer`. The always-on summary lives in [copilot-instructions.md](../../copilot-instructions.md); this skill holds the full tables and patterns so they load only when needed.

## How to use

1. **Always read [semantic-differences.md](./references/semantic-differences.md) first.** It lists behaviour changes that compile cleanly but return different results.
2. Read only the reference files for constructs present in the source:

| Construct in the Oracle source | Read |
|---|---|
| Column, variable and parameter types | [data-types.md](./references/data-types.md) |
| Built-in functions (`NVL`, `DECODE`, `TO_DATE`, `TO_CHAR`, `SUBSTR`, `LISTAGG`, `GREATEST`, …) | [functions.md](./references/functions.md) |
| Query syntax (`DUAL`, `ROWNUM`, `FETCH FIRST`, `CONNECT BY`, `(+)`), PL/SQL blocks, exceptions, cursors, packages, `DBMS_*` packages | [syntax-and-plsql.md](./references/syntax-and-plsql.md) |
| Identity columns and sequences, `MERGE`, triggers, transactions and error handling, `FOR UPDATE` locking, schemas, database links, synonyms, temporary tables, hierarchical queries, pagination, `RETURNING INTO`, dynamic SQL | [conversion-patterns.md](./references/conversion-patterns.md) |

3. When a conversion changes behaviour, say so in a `-- MIGRATION NOTE:` or `-- MIGRATION WARNING:` comment, naming the rule you applied.
4. If no rule covers a construct, check the official documentation listed in [sources.md](./references/sources.md) rather than guessing.
5. If column-level facts decide the mapping (fractional values in `NUMBER`, time parts in `DATE`, case-only duplicates), use the [oracle-data-profiling](../oracle-data-profiling/SKILL.md) skill to generate the Oracle queries that settle it.

## Conventions

- Target is SQL Server 2019+; rules that need SQL Server 2022+ say so.
- Each rule that was added or corrected cites its sources inline (**Refs**). The full list and provenance are in [sources.md](./references/sources.md).
- "Verified" means the SQL Server behaviour was reproduced on SQL Server 2022 (`SQL_Latin1_General_CP1_CI_AS`). Oracle behaviour is cited from the Oracle Database 19c documentation.
