# Sources and Provenance

Rules in this skill are paraphrased and linked, not copied. Oracle and Microsoft documentation is copyrighted by its owners. Content adapted from `oracle/skills` is used under the [Universal Permissive License 1.0](https://github.com/oracle/skills/blob/main/LICENSE.txt).

## Where the rules came from

| Source | How it was used |
|--------|-----------------|
| [Oracle Database 19c SQL Language Reference](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/) | Oracle-side semantics: nulls, comparison rules (nonpadded `VARCHAR2`, binary collation), data types, constraints, function behaviour, `SELECT` row limiting and `FOR UPDATE`, `MERGE`, `CREATE TABLE` identity and temporary tables. |
| [Oracle Database 19c PL/SQL Language Reference](https://docs.oracle.com/en/database/oracle/oracle-database/19/lnpls/) | Triggers and unhandled-exception behaviour. |
| [Oracle Database 19c Concepts](https://docs.oracle.com/en/database/oracle/oracle-database/19/cncpt/transactions.html) | Statement-level atomicity and read consistency. |
| [oracle/skills — Migrating SQL Server to Oracle](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md) | **Reverse direction.** Used as a topic checklist and reversed: identity columns, `FETCH FIRST`/`TOP`, `SYS_REFCURSOR` result sets, type mappings (`BIT`, GUID, spatial), date functions and `CONVERT` styles, linked servers and synonyms, temp tables, `SET` options, `NOLOCK`/read consistency, `MERGE`, schemas vs databases, case sensitivity. It also suggests Oracle needs `PIVOT` rewritten, though Oracle has had `PIVOT` since 11g. |
| [oracle/skills — Migration data validation](https://github.com/oracle/skills/blob/main/db/migrations/migration-data-validation.md) | Validation approach (row counts → aggregates → hashes → sampling) adapted for Oracle → SQL Server in the [oracle-data-profiling](../../oracle-data-profiling/SKILL.md) skill. |
| [SSMA for Oracle](https://learn.microsoft.com/en-us/sql/ssma/oracle/sql-server-migration-assistant-for-oracle-oracletosql) and its [default type mappings](https://learn.microsoft.com/en-us/sql/ssma/oracle/project-settings-type-mapping-oracletosql) | Microsoft's tool for this direction; used to cross-check type mappings (`NUMBER`, `TIMESTAMP WITH LOCAL TIME ZONE`, `FLOAT`). |
| [Microsoft — Oracle to SQL Server migration guide](https://learn.microsoft.com/en-us/sql/sql-server/migrate/guides/oracle-to-sql-server) | Overall process reference. |
| [Transact-SQL reference](https://learn.microsoft.com/en-us/sql/t-sql/language-reference) | SQL Server-side semantics. Individual pages are linked next to each rule. |

## Verification

The SQL Server behaviours marked "verified" were reproduced on SQL Server 2022 with the default `SQL_Latin1_General_CP1_CI_AS` collation. They cover string padding, collation, `UNIQUE` and NULL, `DECIMAL` rounding, `TRY_CONVERT`, `DATEDIFF`/`DATEADD`, `GREATEST`, `TINYINT` range, `STRING_AGG` limits, GUID byte order, `CONVERT` styles, `XACT_ABORT`, `MERGE`, triggers and lock hints. Oracle behaviour is cited from the Oracle 19c documentation and wasn't executed.

Agents can also look behaviour up through the Microsoft Learn and Oracle Database Documentation MCP servers ([Verifying assumptions](../SKILL.md#verifying-assumptions)). Those lookups check rules against the same official documentation; they aren't a separate source and don't count as "verified". A rule changes only when someone updates these reference files and cites the page. The Oracle server searches a local index of the 19c documentation, so it doesn't cover features added in later releases.

## Version-dependent Oracle features

The evaluator records the source Oracle version because these features change the conversion:

| Feature | Minimum Oracle version | Source |
|---------|------------------------|--------|
| Identity columns, `FETCH FIRST` / `OFFSET` row limiting, `DEFAULT seq.NEXTVAL` | 12.1 | [Oracle 12.1 New Features](https://docs.oracle.com/database/121/NEWFT/chapter12101.htm) |
| `DEFAULT … ON CONVERSION ERROR`, `VALIDATE_CONVERSION` | 12.2 | [Oracle 12.2 New Features](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/newft/new-features.html) |
| Private temporary tables | 18c | [Oracle 18c New Features](https://docs.oracle.com/en/database/oracle/oracle-database/18/newft/new-features.html) |
| SQL `BOOLEAN` columns, `IF [NOT] EXISTS` DDL | 23ai | [Oracle 23ai New Features — SQL](https://docs.oracle.com/en/database/oracle/oracle-database/23/nfcoa/appdev_sql.html) |
