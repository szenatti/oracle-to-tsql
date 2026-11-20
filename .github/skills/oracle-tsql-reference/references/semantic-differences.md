# Silent Semantic Differences

These differences compile without errors but return different results. Check every converted object against this list. The always-on summary is in [copilot-instructions.md](../../../copilot-instructions.md).

| # | Difference | Risk |
|---|------------|------|
| 1 | [Empty string is NULL in Oracle](#1-empty-string--null) | 🔴 |
| 2 | [Trailing spaces in string comparisons](#2-trailing-spaces-in-string-comparisons) | 🔴 |
| 3 | [Case sensitivity and collation](#3-case-sensitivity-and-collation) | 🔴 |
| 4 | [UNIQUE constraints and NULL](#4-unique-constraints-and-null) | 🔴 |
| 5 | [DECODE matches NULL](#5-decode-matches-null) | 🔴 |
| 6 | [`NUMBER` without precision](#6-number-without-precision) | 🔴 |
| 7 | [Conversion errors vs `TRY_` functions](#7-conversion-errors-vs-try_-functions) | 🔴 |
| 8 | [Oracle `DATE` includes time](#8-oracle-date-includes-time) | 🟡 |
| 9 | [Date arithmetic and fractional days](#9-date-arithmetic-and-fractional-days) | 🟡 |
| 10 | [`GREATEST` / `LEAST` with NULL](#10-greatest--least-with-null) | 🟡 |
| 11 | [String concatenation with NULL](#11-string-concatenation-with-null) | 🟡 |
| 12 | [NULL sort order](#12-null-sort-order) | 🟡 |
| 13 | [Integer division](#13-integer-division) | 🟡 |
| 14 | [Division by zero](#14-division-by-zero) | 🟡 |
| 15 | [ROWNUM is assigned before ORDER BY](#15-rownum-is-assigned-before-order-by) | 🟡 |
| 16 | [Weekday numbering](#16-weekday-numbering) | 🟡 |
| 17 | [Transactions and error handling](#17-transactions-and-error-handling) | 🟡 |
| 18 | [Read consistency and blocking](#18-read-consistency-and-blocking) | 🟡 |

---

## 1. Empty string = NULL

Oracle stores a zero-length character value as NULL; SQL Server keeps `''` as a real value. Oracle only nulls `''` — a spaces-only value such as `' '` is a real value in both databases.

| Expression | Oracle | SQL Server |
|-----------|--------|------------|
| `'' IS NULL` | `TRUE` | `FALSE` |
| `' ' IS NULL` | `FALSE` | `FALSE` |
| `LENGTH('')` | `NULL` | `LEN('') = 0` |
| `NVL('', 'default')` | `'default'` | `COALESCE('', 'default') = ''` |
| `WHERE name = ''` | No rows | Rows with `''` **and** spaces-only values (see [§2](#2-trailing-spaces-in-string-comparisons)) |
| `INSERT INTO t VALUES ('')` | Inserts `NULL` | Inserts `''` |

**Pattern**: use `DATALENGTH`, which counts trailing spaces, to turn only true empty strings into NULL. Never use `NULLIF(x, N'')`, `x = N''`, `x <> N''` or `LEN(x) = 0` — SQL Server's trailing-space padding makes them treat `' '` as empty.

```sql
-- Oracle: NVL(first_name, 'Unknown')
-- T-SQL:  COALESCE(CASE WHEN DATALENGTH(first_name) = 0 THEN NULL ELSE first_name END, N'Unknown')

-- Oracle: WHERE first_name IS NOT NULL
-- T-SQL:  WHERE DATALENGTH(first_name) > 0                 -- excludes NULL and '', keeps ' '

-- Oracle: WHERE first_name IS NULL
-- T-SQL:  WHERE first_name IS NULL OR DATALENGTH(first_name) = 0

-- Oracle: LISTAGG(sport, ',')
-- T-SQL:  STRING_AGG(CASE WHEN DATALENGTH(sport) = 0 THEN NULL ELSE sport END, N',')
```

| Input | `NULLIF(x, N'')` ❌ | `CASE WHEN DATALENGTH(x) = 0 THEN NULL ELSE x END` ✅ | Oracle |
|-------|--------------------|----------------------------------------------------|--------|
| `''` | NULL | NULL | NULL |
| `' '` | NULL | `' '` | `' '` |
| `'   '` | NULL | `'   '` | `'   '` |
| `'Sport'` | `'Sport'` | `'Sport'` | `'Sport'` |

`CHAR(n)` / `NCHAR(n)` columns: SQL Server pads a stored `''` to `n` spaces, so `DATALENGTH` can no longer detect it. Convert `''` to NULL during the data load instead (Oracle already stores it as NULL).

**Refs**: [Oracle — Nulls](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Nulls.html) · [SQL Server — String comparison](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/string-comparison-assignment) · [DATALENGTH](https://learn.microsoft.com/en-us/sql/t-sql/functions/datalength-transact-sql) · [LEN](https://learn.microsoft.com/en-us/sql/t-sql/functions/len-transact-sql). Verified on SQL Server 2022.

---

## 2. Trailing spaces in string comparisons

Oracle compares `VARCHAR2` / `NVARCHAR2` values with **nonpadded** semantics: `'a ' > 'a'`. It pads only when both sides are `CHAR`/`NCHAR` or literals. SQL Server pads the shorter string before comparing, for every string type, so `N'a ' = N'a'`.

| Operation | Oracle (`VARCHAR2`) | SQL Server (verified) |
|-----------|---------------------|-----------------------|
| `'a ' = 'a'` | FALSE | TRUE |
| `GROUP BY` / `DISTINCT` over `'a'` and `'a '` | 2 groups | 1 group |
| `UNIQUE` index containing `'a'` and `'a '` | Allowed | Error 2627 on load |
| `JOIN ON x.code = y.code` | Exact match only | Also matches trailing-space variants |
| `LIKE 'a '` | — | Not padded: only matches values with the space |

**What to do**
- Profile string keys and join columns for values that differ only by trailing spaces ([oracle-data-profiling](../../oracle-data-profiling/SKILL.md), check P2).
- If none exist, no code change is needed. Note the profiling result in the report.
- If they exist and the difference matters, agree a cleanup (usually `RTRIM`) with the data owner before loading, or compare `DATALENGTH` as well: `a.code = b.code AND DATALENGTH(a.code) = DATALENGTH(b.code)`.

**Refs**: [Oracle — Data Type Comparison Rules (blank-padded and nonpadded semantics)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Type-Comparison-Rules.html) · [SQL Server — String comparison (ANSI padding)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/string-comparison-assignment)

---

## 3. Case sensitivity and collation

Oracle's default comparison is **binary** (case- and accent-sensitive) unless `NLS_COMP` / `NLS_SORT` or a column collation says otherwise. SQL Server's default installation collation `SQL_Latin1_General_CP1_CI_AS` is **case-insensitive**.

| Operation | Oracle (default) | SQL Server `…_CI_AS` (verified) |
|-----------|------------------|---------------------------------|
| `'ABC' = 'abc'` | FALSE | TRUE |
| `UNIQUE` index containing `'a'` and `'A'` | Allowed | Error 2627 on load |
| `GROUP BY` / `DISTINCT` / joins | Case-sensitive | Case-insensitive |
| `ORDER BY` | Binary (uppercase before lowercase) | Dictionary order |

**What to do**
- Decide the target collation before converting. Record it in the evaluation report.
- To preserve Oracle behaviour, use a case-sensitive collation for the database or for key columns, for example `Latin1_General_100_CS_AS_SC` or `Latin1_General_100_BIN2`: `customer_code NVARCHAR(20) COLLATE Latin1_General_100_CS_AS_SC NOT NULL`.
- If you keep a case-insensitive collation, profile unique and join columns for case-only duplicates first ([oracle-data-profiling](../../oracle-data-profiling/SKILL.md), check P1).
- Oracle code that already does `UPPER(col) = UPPER(:x)` keeps its meaning under either collation.

**Refs**: [Oracle — Data Type Comparison Rules (binary collation is the default)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Type-Comparison-Rules.html) · [SQL Server — Collation and Unicode support](https://learn.microsoft.com/en-us/sql/relational-databases/collations/collation-and-unicode-support) · [Set or change the column collation](https://learn.microsoft.com/en-us/sql/relational-databases/collations/set-or-change-the-column-collation) · Topic reversed from [oracle/skills — SQL Server to Oracle, pitfall 6](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md)

---

## 4. UNIQUE constraints and NULL

Oracle allows any number of NULLs in a single-column unique key. For composite keys, rows whose key columns are **all** NULL never conflict, while rows with some NULLs conflict if their non-null values match. SQL Server's `UNIQUE` constraint allows only **one** NULL (verified: error 2627 on the second NULL).

| Oracle constraint | T-SQL equivalent (verified) |
|-------------------|-----------------------------|
| `UNIQUE (col)` on a nullable column | `CREATE UNIQUE INDEX ux_t_col ON dbo.t (col) WHERE col IS NOT NULL;` |
| `UNIQUE (a, b)` with nullable columns | Unique clustered index on a schema-bound view that excludes all-NULL rows (below) |
| `UNIQUE` on `NOT NULL` columns | Plain `UNIQUE` constraint |

```sql
-- Composite key where any column can be NULL (Oracle semantics)
CREATE VIEW dbo.v_t_ab_unique WITH SCHEMABINDING AS
    SELECT a, b FROM dbo.t WHERE a IS NOT NULL OR b IS NOT NULL;
GO
CREATE UNIQUE CLUSTERED INDEX ux_v_t_ab_unique ON dbo.v_t_ab_unique (a, b);
-- Requires SET ANSI_NULLS ON and SET QUOTED_IDENTIFIER ON (the standard file header).
```

Error numbers change: a filtered or view index raises **2601** (unique index) instead of **2627** (unique constraint). Handle both where Oracle caught `DUP_VAL_ON_INDEX`.

**Refs**: [Oracle — Constraints (unique constraints and nulls)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/constraint.html) · [Oracle — Nulls (compound keys)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Nulls.html) · [SQL Server — Unique constraints (one NULL per column)](https://learn.microsoft.com/en-us/sql/relational-databases/tables/unique-constraints-and-check-constraints) · [Create filtered indexes](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/create-filtered-indexes) · [Create indexed views](https://learn.microsoft.com/en-us/sql/relational-databases/views/create-indexed-views)

---

## 5. DECODE matches NULL

`DECODE` treats two NULLs as equal; `CASE x WHEN NULL` never matches.

```sql
-- Oracle:  DECODE(status, NULL, 'Unknown', status)
-- WRONG:   CASE status WHEN NULL THEN 'Unknown' ELSE status END   -- never matches NULL
-- CORRECT: CASE WHEN status IS NULL THEN 'Unknown' ELSE status END
```

**Refs**: [Oracle — Nulls (DECODE treats nulls as equal)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Nulls.html)

---

## 6. `NUMBER` without precision

A bare Oracle `NUMBER` stores decimal values at maximum range and precision (up to 38 significant digits). Mapping it to `DECIMAL(18,0)` silently rounds fractions (verified: `3.14159` → `3`). SSMA's default for this case is `FLOAT(53)`, which is approximate.

**Rule**: profile the column ([oracle-data-profiling](../../oracle-data-profiling/SKILL.md), check P6) and choose `DECIMAL(p,s)` from the observed maximum integer digits and scale. If profiling isn't possible, use `DECIMAL(38,10)` with a `-- MIGRATION WARNING:`. Use `FLOAT(53)` only for genuinely approximate values. See [data-types.md](./data-types.md#numeric-types) for the full numeric mapping.

**Refs**: [Oracle — Data Types (NUMBER)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [SSMA for Oracle — default type mapping (`number` → `float[53]`)](https://learn.microsoft.com/en-us/sql/ssma/oracle/project-settings-type-mapping-oracletosql) · [SQL Server — decimal and numeric](https://learn.microsoft.com/en-us/sql/t-sql/data-types/decimal-and-numeric-transact-sql)

---

## 7. Conversion errors vs `TRY_` functions

Oracle `TO_DATE`, `TO_NUMBER` and `CAST` raise an error on invalid input unless the code says `DEFAULT … ON CONVERSION ERROR` (12.2+). `TRY_CONVERT` / `TRY_CAST` return NULL instead (verified: `TRY_CONVERT(DATETIME2, '2024-13-45')` → NULL). Using them by default turns bad data into silent NULLs.

| Oracle | T-SQL |
|--------|-------|
| `TO_DATE(s, 'YYYY-MM-DD')` | `CONVERT(DATETIME2(0), s, 23)` — fails like Oracle (error 241) |
| `TO_DATE(s DEFAULT '1900-01-01' ON CONVERSION ERROR, 'YYYY-MM-DD')` | `COALESCE(TRY_CONVERT(DATETIME2(0), s, 23), CONVERT(DATETIME2(0), '1900-01-01', 23))` |
| `TO_NUMBER(s)` | `CAST(s AS DECIMAL(p,s))` with the target column's type |
| `VALIDATE_CONVERSION(s AS NUMBER)` | `CASE WHEN s IS NULL OR TRY_CAST(s AS DECIMAL(38,10)) IS NOT NULL THEN 1 ELSE 0 END` (Oracle returns 1 for NULL input) |

**Refs**: [Oracle — TO_DATE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_DATE.html) · [TO_NUMBER](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_NUMBER.html) · [VALIDATE_CONVERSION](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/VALIDATE_CONVERSION.html) · [SQL Server — TRY_CONVERT (returns NULL on failure)](https://learn.microsoft.com/en-us/sql/t-sql/functions/try-convert-transact-sql) · [CAST and CONVERT (styles)](https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql)

---

## 8. Oracle `DATE` includes time

Oracle `DATE` stores year to second. Mapping it to T-SQL `DATE` drops the time.

```sql
-- Oracle DATE         = 2024-01-15 14:30:00
-- T-SQL DATE          = 2024-01-15            (time lost)
-- T-SQL DATETIME2(0)  = 2024-01-15 14:30:00   (correct)
```

**Rule**: default to `DATETIME2(0)`. Use `DATE` only when profiling shows no time parts ([oracle-data-profiling](../../oracle-data-profiling/SKILL.md), check P7).

**Refs**: [Oracle — Data Types (DATE)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [SQL Server — datetime2](https://learn.microsoft.com/en-us/sql/t-sql/data-types/datetime2-transact-sql)

---

## 9. Date arithmetic and fractional days

- Oracle `date2 - date1` returns **fractional days**. `DATEDIFF(DAY, d1, d2)` counts **midnight boundaries crossed** (verified: two minutes across midnight → `1`).
- Oracle `date + n` accepts fractions (`+ 1/24` adds one hour). `DATEADD` **truncates** a fractional `number` (verified: `DATEADD(DAY, 1.0/24, d)` returns `d` unchanged).
- Oracle `TIMESTAMP - TIMESTAMP` returns an `INTERVAL DAY TO SECOND`, not a number.

| Oracle | T-SQL |
|--------|-------|
| `d2 - d1` (days, fractional) | `DATEDIFF_BIG(SECOND, d1, d2) / 86400.0` |
| `TRUNC(d2) - TRUNC(d1)` (whole calendar days) | `DATEDIFF(DAY, d1, d2)` |
| `(d2 - d1) * 24` (hours) | `DATEDIFF_BIG(SECOND, d1, d2) / 3600.0` |
| `d + n` (whole days) | `DATEADD(DAY, n, d)` |
| `d + n` (fractional days, e.g. `1/24`) | `DATEADD(SECOND, CAST(ROUND(n * 86400, 0) AS INT), d)` |

**Refs**: [Oracle — Data Types (datetime/interval arithmetic)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [SQL Server — DATEDIFF (boundaries crossed)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-transact-sql) · [DATEDIFF_BIG](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-big-transact-sql) · [DATEADD (truncates fractions)](https://learn.microsoft.com/en-us/sql/t-sql/functions/dateadd-transact-sql)

---

## 10. `GREATEST` / `LEAST` with NULL

Oracle scalar functions, including `GREATEST` and `LEAST`, return NULL when an argument is NULL. SQL Server 2022 `GREATEST`/`LEAST` **ignore** NULL arguments, and so does the pre-2022 `(SELECT MAX(v) FROM (VALUES …))` workaround (verified: `GREATEST(1, NULL, 3)` → `3`).

```sql
-- Oracle: GREATEST(a, b, c)
-- T-SQL:  CASE WHEN a IS NULL OR b IS NULL OR c IS NULL THEN NULL
--              ELSE (SELECT MAX(v) FROM (VALUES (a), (b), (c)) AS t(v)) END
--         -- SQL Server 2022+: replace the subquery with GREATEST(a, b, c)
```

Skip the NULL guard only when every argument is `NOT NULL`.

**Refs**: [Oracle — About SQL Functions (nulls in SQL functions)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/About-SQL-Functions.html) · [Oracle — GREATEST](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/GREATEST.html) · [SQL Server — GREATEST (NULL arguments are ignored)](https://learn.microsoft.com/en-us/sql/t-sql/functions/logical-functions-greatest-transact-sql)

---

## 11. String concatenation with NULL

Oracle `||` ignores NULL operands; T-SQL `+` returns NULL if any operand is NULL.

```sql
-- Oracle:  'Hello' || NULL || 'World'        = 'HelloWorld'
-- T-SQL:   'Hello' + NULL + 'World'          = NULL
-- T-SQL:   CONCAT('Hello', NULL, 'World')    = 'HelloWorld'   -- use CONCAT
```

**Refs**: [Oracle — Nulls (all operators except concatenation return null)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Nulls.html) · [SQL Server — CONCAT](https://learn.microsoft.com/en-us/sql/t-sql/functions/concat-transact-sql)

---

## 12. NULL sort order

Oracle: `NULLS LAST` is the default for ascending order and `NULLS FIRST` for descending. SQL Server treats NULL as the lowest value (first ascending, last descending).

```sql
-- Oracle: ORDER BY col            (NULLs last)
-- T-SQL:  ORDER BY CASE WHEN col IS NULL THEN 1 ELSE 0 END, col
-- Oracle: ORDER BY col DESC       (NULLs first)
-- T-SQL:  ORDER BY CASE WHEN col IS NULL THEN 0 ELSE 1 END, col DESC
```

**Refs**: [Oracle — SELECT (order_by_clause)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/SELECT.html) · [SQL Server — ORDER BY clause](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql)

---

## 13. Integer division

Oracle `NUMBER` division keeps decimals: `5 / 2 = 2.5`. SQL Server integer division truncates: `5 / 2 = 2`.

```sql
-- Fix: CAST(a AS DECIMAL(18,4)) / b   or   a * 1.0 / b
```

**Refs**: [SQL Server — / (Divide)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/divide-transact-sql)

---

## 14. Division by zero

Oracle `NUMBER` division by zero raises `ORA-01476`. `BINARY_FLOAT` / `BINARY_DOUBLE` follow IEEE rules and return infinity or NaN. SQL Server raises error **8134** for integer, decimal **and float** division by zero with the default `ANSI_WARNINGS`/`ARITHABORT ON` (verified: `1.0E0/0` → 8134), and has no infinity or NaN values.

**Rule**: no change needed for `NUMBER`. Where Oracle `BINARY_DOUBLE` code relies on infinity or NaN results, add an explicit `CASE WHEN divisor = 0 …` and add a `-- MIGRATION WARNING:`.

**Refs**: [Oracle — ORA-01476](https://docs.oracle.com/en/error-help/db/ora-01476/) · [Oracle — Data Types (floating-point infinity and NaN)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html) · [SQL Server — SET ANSI_WARNINGS](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-ansi-warnings-transact-sql) · [SET ARITHABORT](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-arithabort-transact-sql)

---

## 15. ROWNUM is assigned before ORDER BY

```sql
-- Oracle: does NOT return the top 5 salaries — it takes 5 arbitrary rows, then sorts them
SELECT * FROM employees WHERE ROWNUM <= 5 ORDER BY salary DESC;
```

Keep that meaning (`TOP 5` without `ORDER BY`, then sort) or fix the bug deliberately and say so in a `-- MIGRATION NOTE:`. For Oracle 12c `FETCH FIRST`, see [syntax-and-plsql.md](./syntax-and-plsql.md#query-syntax).

**Refs**: [Oracle — ROWNUM pseudocolumn](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/ROWNUM-Pseudocolumn.html) · [SQL Server — TOP](https://learn.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql)

---

## 16. Weekday numbering

Oracle `TO_CHAR(d, 'D')` depends on the session's `NLS_TERRITORY` (Sunday = 1 for `AMERICA`, Monday = 1 for most of Europe). SQL Server `DATEPART(WEEKDAY, d)` depends on `@@DATEFIRST` (default 7 for `us_english` — Monday returns 2, verified).

**Rule**: find out which territory the Oracle application ran under, then use a setting-independent expression:

```sql
-- ISO weekday (Monday = 1 … Sunday = 7) regardless of @@DATEFIRST — verified with DATEFIRST 1 and 7
(DATEPART(WEEKDAY, d) + @@DATEFIRST - 2) % 7 + 1
```

**Refs**: [Oracle — Format Models (`D` depends on NLS territory)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Format-Models.html) · [SQL Server — SET DATEFIRST](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-datefirst-transact-sql) · [DATEPART](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql)

---

## 17. Transactions and error handling

- Oracle keeps a transaction open until `COMMIT` / `ROLLBACK`; SQL Server autocommits each statement unless a transaction is open.
- A `COMMIT` inside an Oracle procedure commits the whole transaction, including the caller's work. In SQL Server, `COMMIT` inside a nested transaction only decrements `@@TRANCOUNT`.
- Oracle rolls back a failed SQL statement as a unit (statement-level atomicity). When a stored subprogram exits with an unhandled exception, PL/SQL does **not** roll back its earlier changes; the invoker decides.
- With `SET XACT_ABORT OFF` (default), a SQL Server error may roll back only the failing statement while the transaction continues (verified: the first insert survived a duplicate-key error). With `XACT_ABORT ON`, the transaction becomes uncommittable and must be rolled back (verified: error 3930 on further writes).

**Rule**: procedures that own their transaction use `SET XACT_ABORT ON`, the `@@TRANCOUNT` pattern and `XACT_STATE()` in `CATCH`. Where the Oracle caller handles a subprogram's exception and carries on, keep `XACT_ABORT` OFF in that call path so the subprogram's earlier changes survive, as they do in Oracle (verified). Both templates are in [conversion-patterns.md](./conversion-patterns.md#transactions-and-error-handling).

**Refs**: [Oracle — Transactions (statement-level atomicity)](https://docs.oracle.com/en/database/oracle/oracle-database/19/cncpt/transactions.html) · [Oracle — Unhandled exceptions](https://docs.oracle.com/en/database/oracle/oracle-database/19/lnpls/unhandled-exceptions.html) · [SQL Server — SET XACT_ABORT](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-xact-abort-transact-sql) · [COMMIT TRANSACTION (nested transactions)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/commit-transaction-transact-sql)

---

## 18. Read consistency and blocking

Oracle readers and writers don't block each other (multiversion read consistency). SQL Server `READ COMMITTED` uses locks unless `READ_COMMITTED_SNAPSHOT` is ON. It is ON by default in Azure SQL Database, but not in SQL Server.

**Rule**: recommend `ALTER DATABASE … SET READ_COMMITTED_SNAPSHOT ON` for migrated databases. Never add `NOLOCK` to emulate Oracle reads — it allows dirty reads, which Oracle never does. For `SELECT … FOR UPDATE`, see [conversion-patterns.md](./conversion-patterns.md#locking-select--for-update).

**Refs**: [Oracle — Data Concurrency and Consistency](https://docs.oracle.com/en/database/oracle/oracle-database/19/cncpt/data-concurrency-and-consistency.html) · [SQL Server — Transaction locking and row versioning guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide) · Topic reversed from [oracle/skills — SQL Server to Oracle, best practice 6 and pitfall 2](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md)
