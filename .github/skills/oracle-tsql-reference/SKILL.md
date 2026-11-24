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
4. If no rule covers a construct, check the official documentation rather than guessing. Follow [Verifying assumptions](#verifying-assumptions).
5. If column-level facts decide the mapping (fractional values in `NUMBER`, time parts in `DATE`, case-only duplicates), use the [oracle-data-profiling](../oracle-data-profiling/SKILL.md) skill to generate the Oracle queries that settle it.

## Verifying assumptions

Two documentation MCP servers let agents check a behaviour against official docs instead of memory. Setup is in the [README](../../../README.md#documentation-mcp-servers).

| Side | MCP server | Tools |
|---|---|---|
| SQL Server, Azure SQL, T-SQL | Microsoft Learn (`https://learn.microsoft.com/api/mcp`) | `microsoft_docs_search`, `microsoft_docs_fetch`, `microsoft_code_sample_search` |
| Oracle SQL and PL/SQL | Oracle Database Documentation (`oracle-db-doc`, local index of the 19c docs) | `search_oracle_database_documentation` |

1. **The reference files come first.** Look a behaviour up only when:
   - no rule here covers it;
   - it depends on the SQL Server version, compatibility level or Azure SQL, or on the source Oracle version;
   - it would be raised as a 🔴 finding.
2. **Check the side you're assuming about.** Use Learn for T-SQL behaviour and the Oracle server for Oracle behaviour. A semantic difference needs both.
   - The Oracle server matches keywords, not meaning. Search with Oracle's own terms and names (`DECODE`, `nonpadded comparison semantics VARCHAR2`, `character value with a length of zero`), not questions.
   - Its results have no URLs. Find the matching `docs.oracle.com` page (usually under `sqlrf/` or `lnpls/`) to cite.
3. **Match the Oracle version.** The local index holds the 19c docs. If the source Oracle version recorded in Part 1 of the migration report is different, confirm on that version's `docs.oracle.com` page.
4. **If the docs disagree with a reference file, keep the reference rule.** Add a `-- MIGRATION WARNING:` that cites the page, and list the proposed reference change under the report's Consolidated Action Items. Don't switch approach silently.
5. **Cite links, not text.** Put the `learn.microsoft.com` or `docs.oracle.com` URL in the note or report. Paraphrase; never paste documentation text into output.
6. **If a server isn't available, carry on.** Use the reference files and mark the point `-- MIGRATION WARNING: unverified — <what to check>`.

## Conventions

- Target is SQL Server 2019+; rules that need SQL Server 2022+ say so.
- Each rule that was added or corrected cites its sources inline (**Refs**). The full list and provenance are in [sources.md](./references/sources.md).
- "Verified" means the SQL Server behaviour was reproduced on SQL Server 2022 (`SQL_Latin1_General_CP1_CI_AS`). Oracle behaviour is cited from the Oracle Database 19c documentation.
