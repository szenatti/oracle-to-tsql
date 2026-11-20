# Data Type Mapping

Merged from the previous tables in `copilot-instructions.md` and `@oracle-to-tsql`. Rows with **Refs** were added or corrected. Where profiling decides the mapping, see the [oracle-data-profiling](../../oracle-data-profiling/SKILL.md) skill.

## Numeric types

| Oracle | T-SQL | Notes |
|--------|-------|-------|
| `NUMBER` (no precision or scale) | `DECIMAL(p,s)` chosen from profiling; `DECIMAL(38,10)` + `-- MIGRATION WARNING:` if unknown | ⚠️ Not `DECIMAL(18,0)`: it rounds fractions (verified `3.14159` → `3`). SSMA's default is `FLOAT(53)`, which is approximate. Profiling check P6. **Refs**: [Oracle Data Types](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [SSMA type mapping](https://learn.microsoft.com/en-us/sql/ssma/oracle/project-settings-type-mapping-oracletosql) · [decimal](https://learn.microsoft.com/en-us/sql/t-sql/data-types/decimal-and-numeric-transact-sql) |
| `NUMBER(1)` | `SMALLINT`; `BIT` if a `CHECK (col IN (0,1))` exists; `TINYINT` only if profiling shows no negatives | ⚠️ `NUMBER(1)` holds −9…9 but `TINYINT` holds 0…255 (verified: `CAST(-1 AS TINYINT)` → error 220). The `CHECK (0,1)` signal is the reverse of the SQL Server→Oracle `BIT` mapping. **Refs**: [Oracle Data Types](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [int, smallint, tinyint](https://learn.microsoft.com/en-us/sql/t-sql/data-types/int-bigint-smallint-and-tinyint-transact-sql) · [oracle/skills type table](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md) |
| `NUMBER(p)`, p = 2–4 | `SMALLINT` | Same negative-value reason as `NUMBER(1)`. |
| `NUMBER(p)`, p = 5–9 | `INT` | |
| `NUMBER(p)`, p = 10–18 | `BIGINT` | `NUMBER(10)` can exceed `INT`. |
| `NUMBER(p)`, p = 19–38 | `DECIMAL(p,0)` | `NUMBER(19)` can exceed `BIGINT`. |
| `NUMBER(p,s)`, 0 ≤ s ≤ p | `DECIMAL(p,s)` | |
| `NUMBER(p,s)` with s < 0 (e.g. `NUMBER(5,-2)`) | `DECIMAL(p - s, 0)` | Oracle rounds to 10^−s on insert; reproduce with `ROUND(x, s)` in the load or a trigger. **Refs**: [Oracle Data Types (scale)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) |
| `NUMBER(p,s)` with s > p (e.g. `NUMBER(3,5)`) | `DECIMAL(s,s)` | SQL Server requires scale ≤ precision. |
| `FLOAT(b)` | `FLOAT(53)` | Oracle `FLOAT` is a `NUMBER` subtype; consider `DECIMAL` for money. **Refs**: [SSMA type mapping](https://learn.microsoft.com/en-us/sql/ssma/oracle/project-settings-type-mapping-oracletosql) |
| `BINARY_FLOAT` | `REAL` | SQL Server has no infinity or NaN (verified: `TRY_CAST('Infinity' AS FLOAT)` → NULL). Profiling check P9. |
| `BINARY_DOUBLE` | `FLOAT(53)` | Same as above. |
| `PLS_INTEGER` / `BINARY_INTEGER` / `SIMPLE_INTEGER` | `INT` | PL/SQL only. |

## String types

| Oracle | T-SQL | Notes |
|--------|-------|-------|
| `VARCHAR2(n [BYTE\|CHAR])`, n ≤ 4000 | `NVARCHAR(n)` | Prefer `NVARCHAR` for Unicode; `VARCHAR(n)` if confirmed ASCII. With `CHAR` semantics, supplementary characters (e.g. emoji) take 2 UTF-16 byte-pairs each, so size from profiling (`LENGTH2`, check P10). **Refs**: [Oracle Data Types (BYTE/CHAR)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [nchar and nvarchar (byte-pairs)](https://learn.microsoft.com/en-us/sql/t-sql/data-types/nchar-and-nvarchar-transact-sql) |
| `VARCHAR2(n)`, n > 4000 (`MAX_STRING_SIZE = EXTENDED`, up to 32767) | `NVARCHAR(MAX)` | `NVARCHAR(n)` stops at 4000. **Refs**: [Oracle Data Types (extended data types)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [nchar and nvarchar](https://learn.microsoft.com/en-us/sql/t-sql/data-types/nchar-and-nvarchar-transact-sql) |
| `VARCHAR2(n)` in an `AL32UTF8` database (alternative) | `VARCHAR(n)` with a `_UTF8` collation (SQL Server 2019+) | Keeps byte-length semantics close to Oracle. **Refs**: [Collation and Unicode support (UTF-8)](https://learn.microsoft.com/en-us/sql/relational-databases/collations/collation-and-unicode-support) |
| `NVARCHAR2(n)` | `NVARCHAR(n)`; `NVARCHAR(MAX)` above 4000 | |
| `CHAR(n)` / `NCHAR(n)` | `CHAR(n)` / `NCHAR(n)` | Padded comparisons; SQL Server stores `''` as `n` spaces (Oracle stores NULL) — convert to NULL during the load. See [semantic-differences §1–2](./semantic-differences.md#1-empty-string--null). |
| `CLOB` / `NCLOB` / `LONG` | `NVARCHAR(MAX)` | `LONG` is deprecated in Oracle. |

## Date and time types

| Oracle | T-SQL | Notes |
|--------|-------|-------|
| `DATE` | `DATETIME2(0)` | ⚠️ Oracle `DATE` includes time. Use `DATE` only if profiling (check P7) shows no time parts. Oracle allows BC dates; `DATETIME2` starts at 0001-01-01. |
| `TIMESTAMP(p)`, p ≤ 7 (default p = 6) | `DATETIME2(p)` | |
| `TIMESTAMP(8)` / `TIMESTAMP(9)` | `DATETIME2(7)` | ⚠️ Rounds to 100 ns (verified `.123456789` → `.1234568`). Profiling check P8. **Refs**: [Oracle Data Types (precision 0–9)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [datetime2 (100 ns)](https://learn.microsoft.com/en-us/sql/t-sql/data-types/datetime2-transact-sql) |
| `TIMESTAMP(p) WITH TIME ZONE` | `DATETIMEOFFSET(min(p,7))` | Oracle can store a region name (e.g. `Australia/Perth`); `DATETIMEOFFSET` keeps only the offset. Store the region separately if it's used. **Refs**: [datetimeoffset](https://learn.microsoft.com/en-us/sql/t-sql/data-types/datetimeoffset-transact-sql) |
| `TIMESTAMP(p) WITH LOCAL TIME ZONE` | `DATETIMEOFFSET(min(p,7))`, or `DATETIME2` in UTC converted with `AT TIME ZONE` on read | Oracle normalizes to the database time zone and shows values in the session time zone. **Refs**: [Oracle Data Types](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [SSMA type mapping](https://learn.microsoft.com/en-us/sql/ssma/oracle/project-settings-type-mapping-oracletosql) · [AT TIME ZONE](https://learn.microsoft.com/en-us/sql/t-sql/queries/at-time-zone-transact-sql) |
| `INTERVAL YEAR TO MONTH` | `INT` (months) | No direct equivalent. Add a `-- MIGRATION NOTE:`. |
| `INTERVAL DAY TO SECOND` | `BIGINT` (seconds) or `DECIMAL(18,6)` for fractions | No direct equivalent. Add a `-- MIGRATION NOTE:`. |

## Binary, LOB and GUID types

| Oracle | T-SQL | Notes |
|--------|-------|-------|
| `BLOB` | `VARBINARY(MAX)` | |
| `RAW(n)` | `VARBINARY(n)`; `VARBINARY(MAX)` above 8000 | |
| `RAW(16)` holding `SYS_GUID()` values | `BINARY(16)` to keep bytes as-is, or `UNIQUEIDENTIFIER` | ⚠️ `UNIQUEIDENTIFIER` displays the first three groups byte-swapped (verified: `0x00112233…` → `33221100-5544-7766-…`), so text comparisons with Oracle `RAWTOHEX` differ. New values: `SYS_GUID()` → `NEWID()` (or `NEWSEQUENTIALID()` as a column default). **Refs**: [Oracle SYS_GUID](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/SYS_GUID.html) · [uniqueidentifier](https://learn.microsoft.com/en-us/sql/t-sql/data-types/uniqueidentifier-transact-sql) · [NEWID](https://learn.microsoft.com/en-us/sql/t-sql/functions/newid-transact-sql) · [NEWSEQUENTIALID](https://learn.microsoft.com/en-us/sql/t-sql/functions/newsequentialid-transact-sql) |
| `LONG RAW` | `VARBINARY(MAX)` | Deprecated in Oracle. |
| `BFILE` | `VARBINARY(MAX)` | External file becomes inline storage. |

## Other types

| Oracle | T-SQL | Notes |
|--------|-------|-------|
| `BOOLEAN` (PL/SQL; SQL column type from 23ai) | `BIT` | Write `IF @flag = 1`, not `IF @flag`. **Refs**: [Oracle 23ai new features — BOOLEAN](https://docs.oracle.com/en/database/oracle/oracle-database/23/nfcoa/appdev_sql.html) |
| `XMLTYPE` | `XML` | |
| `JSON` (21c+) or `CLOB … IS JSON` | `NVARCHAR(MAX)` + `CHECK (ISJSON(col) = 1)` | **Refs**: [ISJSON](https://learn.microsoft.com/en-us/sql/t-sql/functions/isjson-transact-sql) |
| `SDO_GEOMETRY` | `geometry` / `geography` | Reversed from the SQL Server→Oracle spatial mapping. **Refs**: [Spatial data](https://learn.microsoft.com/en-us/sql/relational-databases/spatial/spatial-data-sql-server) · [oracle/skills type table](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md) |
| `ROWID` / `UROWID` | Remove — use the primary key | Add a `-- MIGRATION NOTE:`. |
| `%TYPE` | Explicit type | Look up the real column type. |
| `%ROWTYPE` | Explicit columns | Declare individual variables or use a table variable. |
| Object types, nested tables, `VARRAY` | Child tables, table variables or JSON | Requires redesign; flag as 🔴 in evaluation. |
