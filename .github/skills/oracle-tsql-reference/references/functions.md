# Function Mapping

Merged from the previous tables in `copilot-instructions.md` and `@oracle-to-tsql`. Rows with **Refs** were added or corrected; "verified" means reproduced on SQL Server 2022. Oracle's general rule applies throughout: a string function whose result is `''` returns **NULL** in Oracle (see [semantic-differences §1](./semantic-differences.md#1-empty-string--null)).

## NULL handling

| Oracle | T-SQL | ⚠️ Gotcha |
|--------|-------|-----------|
| `NVL(a, b)` | `COALESCE(a, b)` | For string `a`: `COALESCE(CASE WHEN DATALENGTH(a) = 0 THEN NULL ELSE a END, b)`. |
| `NVL2(a, b, c)` | `IIF(a IS NOT NULL, b, c)` or `CASE WHEN a IS NOT NULL THEN b ELSE c END` | For string `a`: test `DATALENGTH(a) > 0`. |
| `DECODE(a, b, c, d, e, f)` | `CASE a WHEN b THEN c WHEN d THEN e ELSE f END` | If any search value is NULL: `CASE WHEN a IS NULL THEN … WHEN a = b THEN …`. See [semantic-differences §5](./semantic-differences.md#5-decode-matches-null). |
| `NULLIF(a, b)` | `NULLIF(a, b)` | ⚠️ Never `NULLIF(x, N'')` for empty strings: SQL Server ignores trailing spaces, so `NULLIF(N' ', N'')` is NULL. **Refs**: [NULLIF](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/nullif-transact-sql) · [String comparison](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/string-comparison-assignment) |

## String functions

| Oracle | T-SQL | ⚠️ Gotcha |
|--------|-------|-----------|
| `\|\|` | `CONCAT()` | Not `+`: it propagates NULL. |
| `SUBSTR(s, p, n)` | `SUBSTRING(s, p, n)` | ⚠️ `p = 0`: Oracle treats it as 1, SQL Server returns one character fewer (verified `SUBSTRING(N'abc', 0, 2)` → `'a'`). Use `SUBSTRING(s, 1, n)`. Negative `p` counts from the end in Oracle: `SUBSTRING(s, LEN(s + N'x') - 1 + p + 1, n)`. **Refs**: [Oracle SUBSTR](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/SUBSTR.html) · [SUBSTRING](https://learn.microsoft.com/en-us/sql/t-sql/functions/substring-transact-sql) |
| `INSTR(s, sub)` | `CHARINDEX(sub, s)` | Argument order is reversed. |
| `INSTR(s, sub, pos)` | `CHARINDEX(sub, s, pos)` | Negative `pos` (search backwards) has no equivalent. |
| `INSTR(s, sub, pos, nth)` | Custom logic | No native nth-occurrence support. |
| `LENGTH(s)` | `LEN(s)` | ⚠️ `LEN` ignores trailing spaces (verified `LEN(N'ab  ')` → 2). For Oracle's count use `LEN(s + N'x') - 1`. Never use `LEN(x) = 0` as an emptiness test. **Refs**: [LEN](https://learn.microsoft.com/en-us/sql/t-sql/functions/len-transact-sql) |
| `LENGTHB(s)` | `DATALENGTH(s)` | Byte counts differ between UTF-8 (Oracle `AL32UTF8`) and UTF-16 (`NVARCHAR`). |
| `LPAD(s, n, c)` | `CASE WHEN LEN(s + N'x') - 1 >= n THEN LEFT(s, n) ELSE RIGHT(REPLICATE(c, n) + s, n) END` | ⚠️ When `s` is longer than `n`, Oracle keeps the **leftmost** `n` characters; `RIGHT(REPLICATE(c, n) + s, n)` alone keeps the rightmost (verified `'def'` instead of `'abc'`). **Refs**: [Oracle LPAD](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/LPAD.html) |
| `RPAD(s, n, c)` | `LEFT(s + REPLICATE(c, n), n)` | |
| `TRIM(s)` / `LTRIM` / `RTRIM` | `TRIM(s)` (2017+) / `LTRIM` / `RTRIM` | ⚠️ A spaces-only input trims to `''`: Oracle returns NULL, SQL Server returns `''` (verified). Wrap with the `DATALENGTH` empty-to-NULL check when the result feeds a NULL test. |
| `REPLACE(s, a)` (two arguments) | `REPLACE(s, a, N'')` | Oracle removes `a` when the replacement is omitted; T-SQL needs three arguments. **Refs**: [Oracle REPLACE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/REPLACE.html) |
| `REPLACE(s, a, b)` | `REPLACE(s, a, b)` | Same behaviour (apart from the `''` → NULL rule). |
| `TRANSLATE(s, from, to)` | `TRANSLATE(s, from, to)` (2017+) | ⚠️ Oracle removes characters of `from` that have no counterpart in a shorter `to`; SQL Server requires equal lengths (verified error 9828). Use `TRANSLATE` for the paired part and nested `REPLACE(…, ch, N'')` for removed characters. **Refs**: [Oracle TRANSLATE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TRANSLATE.html) · [TRANSLATE](https://learn.microsoft.com/en-us/sql/t-sql/functions/translate-transact-sql) |
| `UPPER` / `LOWER` | `UPPER` / `LOWER` | |
| `INITCAP(s)` | Custom function | No native equivalent. |
| `LISTAGG(col, sep)` | `STRING_AGG(CAST(CASE WHEN DATALENGTH(col) = 0 THEN NULL ELSE col END AS NVARCHAR(MAX)), sep)` | ⚠️ Oracle skips `''` (NULL). Cast to `NVARCHAR(MAX)`: without it, results over 8000 bytes fail (verified error 9829). `LISTAGG(DISTINCT …)` → aggregate a `SELECT DISTINCT` subquery. **Refs**: [STRING_AGG](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-agg-transact-sql) |
| `LISTAGG(col, sep) WITHIN GROUP (ORDER BY x)` | `STRING_AGG(…, sep) WITHIN GROUP (ORDER BY x)` | Supported wherever `STRING_AGG` is (SQL Server 2017+; verified) — an earlier note said 2022+. Apply the same `DATALENGTH` and `NVARCHAR(MAX)` handling. **Refs**: [STRING_AGG](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-agg-transact-sql) |
| `REGEXP_LIKE(s, p)` | `s LIKE pattern` when the pattern is simple | No native regex before SQL Server 2025; use CLR or the application layer. |
| `REGEXP_REPLACE` / `REGEXP_SUBSTR` / `REGEXP_INSTR` / `REGEXP_COUNT` | Nested `REPLACE`, `SUBSTRING` + `PATINDEX`, or CLR | No native regex. |

## Date and time functions

| Oracle | T-SQL | ⚠️ Gotcha |
|--------|-------|-----------|
| `SYSDATE` | `GETDATE()` or `SYSDATETIME()` | `SYSDATETIME()` returns `DATETIME2`. |
| `SYSTIMESTAMP` | `SYSDATETIMEOFFSET()` | |
| `SYS_EXTRACT_UTC(SYSTIMESTAMP)` | `SYSUTCDATETIME()` | Reversed from the SQL Server→Oracle mapping. **Refs**: [SYSUTCDATETIME](https://learn.microsoft.com/en-us/sql/t-sql/functions/sysutcdatetime-transact-sql) · [oracle/skills date functions](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md) |
| `CURRENT_DATE` / `LOCALTIMESTAMP` | `GETDATE()` / `SYSDATETIME()` | Oracle uses the session time zone; SQL Server has none. Add a `-- MIGRATION NOTE:`. |
| `EXTRACT(YEAR\|MONTH\|DAY FROM d)` | `YEAR(d)` / `MONTH(d)` / `DAY(d)` or `DATEPART(…)` | **Refs**: [DATEPART](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql) |
| `TRUNC(d)` | `CAST(d AS DATE)` | |
| `TRUNC(d, 'MM')` | `DATETRUNC(MONTH, d)` (2022+) or `DATEADD(MONTH, DATEDIFF(MONTH, 0, d), 0)` | |
| `TRUNC(d, 'YYYY')` | `DATEFROMPARTS(YEAR(d), 1, 1)` | |
| `TRUNC(d, 'IW')` (ISO week start) | `DATEADD(DAY, -((DATEPART(WEEKDAY, d) + @@DATEFIRST - 2) % 7), CAST(d AS DATE))` | Independent of `@@DATEFIRST` (verified). |
| `ADD_MONTHS(d, n)` | `CASE WHEN CAST(d AS DATE) = EOMONTH(d) THEN EOMONTH(DATEADD(MONTH, n, d)) ELSE DATEADD(MONTH, n, d) END` | ⚠️ Oracle keeps month-end dates at month-end; `DATEADD` doesn't (verified `2024-02-29` + 1 month → `2024-03-29` vs Oracle `2024-03-31`). `EOMONTH` returns `DATE`, so add any time part back. **Refs**: [Oracle ADD_MONTHS](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/ADD_MONTHS.html) · [EOMONTH](https://learn.microsoft.com/en-us/sql/t-sql/functions/eomonth-transact-sql) |
| `MONTHS_BETWEEN(d1, d2)` | `DATEDIFF(MONTH, d2, d1)` | ⚠️ Oracle returns fractional months; `DATEDIFF` returns an integer count of boundaries. |
| `LAST_DAY(d)` | `EOMONTH(d)` | `EOMONTH` returns `DATE` without a time part. |
| `NEXT_DAY(d, 'MONDAY')` | `DATEADD(DAY, ((iso_target - iso(d) + 6) % 7) + 1, d)`, where `iso(d) = (DATEPART(WEEKDAY, d) + @@DATEFIRST - 2) % 7 + 1` and Monday = 1 | Returns the first matching day strictly after `d`, like Oracle (verified). Oracle day names depend on `NLS_DATE_LANGUAGE`. **Refs**: [Oracle NEXT_DAY](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/NEXT_DAY.html) |
| `d + n` | `DATEADD(DAY, n, d)` for whole days; `DATEADD(SECOND, CAST(ROUND(n * 86400, 0) AS INT), d)` for fractions | ⚠️ `DATEADD` truncates fractions. See [semantic-differences §9](./semantic-differences.md#9-date-arithmetic-and-fractional-days). |
| `d2 - d1` | `DATEDIFF_BIG(SECOND, d1, d2) / 86400.0` | ⚠️ `DATEDIFF(DAY, …)` counts midnights crossed. See [semantic-differences §9](./semantic-differences.md#9-date-arithmetic-and-fractional-days). |
| `TO_DATE(s, fmt)` | `CONVERT(DATETIME2(0), s, style)` — see the style table below | ⚠️ Not `TRY_CONVERT`: Oracle raises an error on bad input. See [semantic-differences §7](./semantic-differences.md#7-conversion-errors-vs-try_-functions). |
| `TO_DATE(s DEFAULT x ON CONVERSION ERROR, fmt)` | `COALESCE(TRY_CONVERT(DATETIME2(0), s, style), CONVERT(DATETIME2(0), x, style))` | **Refs**: [Oracle TO_DATE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_DATE.html) · [TRY_CONVERT](https://learn.microsoft.com/en-us/sql/t-sql/functions/try-convert-transact-sql) |
| `TO_TIMESTAMP(s, fmt)` | `CONVERT(DATETIME2(p), s, style)` | Same error rule as `TO_DATE`. |
| `TO_CHAR(d, fmt)` | `CONVERT(VARCHAR(n), d, style)` when a style matches; otherwise `FORMAT(d, '<.NET format>', 'en-US')` | `FORMAT` is CLR-based and slower in set-based queries; always pass an explicit culture. **Refs**: [CAST and CONVERT](https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql) · [FORMAT](https://learn.microsoft.com/en-us/sql/t-sql/functions/format-transact-sql) |
| `TO_CHAR(d, 'D')` | `(DATEPART(WEEKDAY, d) + @@DATEFIRST - 2) % 7 + 1` (ISO) | ⚠️ Depends on `NLS_TERRITORY` vs `@@DATEFIRST`. See [semantic-differences §16](./semantic-differences.md#16-weekday-numbering). |
| `TO_NUMBER(s)` | `CAST(s AS DECIMAL(p,s))` using the target type | ⚠️ Not `TRY_CAST(s AS DECIMAL(18,2))`: that returns NULL on bad input and rounds to 2 decimals. `DEFAULT x ON CONVERSION ERROR` → `COALESCE(TRY_CAST(…), x)`. **Refs**: [Oracle TO_NUMBER](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_NUMBER.html) |
| `TO_CHAR(n, fmt)` | `FORMAT(n, '<.NET format>', 'en-US')` or `CONVERT(VARCHAR(n), n)` | |
| `ROUND(d, fmt)` | Custom `DATEADD` / `DATEDIFF` logic | |

### Oracle date formats → `CONVERT` styles

Verified on SQL Server 2022 for both `TO_CHAR` (formatting) and `TO_DATE` (parsing). An invalid string raises error 241, like Oracle.

| Oracle format | Style | Example |
|---------------|-------|---------|
| `YYYY-MM-DD` | `23` | `2024-01-05` |
| `YYYY-MM-DD HH24:MI:SS` | `120` | `2024-01-05 14:03:09` |
| `YYYY-MM-DD"T"HH24:MI:SS` | `126` | `2024-01-05T14:03:09` |
| `YYYYMMDD` | `112` | `20240105` |
| `DD/MM/YYYY` | `103` | `05/01/2024` |
| `MM/DD/YYYY` | `101` | `01/05/2024` |
| `DD.MM.YYYY` | `104` | `05.01.2024` |
| `HH24:MI:SS` | `108` | `14:03:09` |

**Refs**: [CAST and CONVERT (date and time styles)](https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql) · Style-code idea reversed from [oracle/skills — CONVERT with style codes](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md)

### Oracle → .NET format strings (for `FORMAT()`)

| Oracle | .NET | Example |
|--------|------|---------|
| `YYYY` | `yyyy` | 2024 |
| `MM` | `MM` | 01 |
| `DD` | `dd` | 15 |
| `HH24` | `HH` | 14 |
| `HH` / `HH12` | `hh` | 02 |
| `MI` | `mm` | 30 |
| `SS` | `ss` | 45 |
| `FF` / `FF3` | `fff` | 123 |
| `DAY` | `dddd` | Monday |
| `DY` | `ddd` | Mon |
| `MON` | `MMM` | Jan |
| `MONTH` | `MMMM` | January |
| `AM` / `PM` | `tt` | PM |

## Numeric functions

| Oracle | T-SQL | ⚠️ Gotcha |
|--------|-------|-----------|
| `MOD(a, b)` | `CASE WHEN b = 0 THEN a ELSE a % b END` | ⚠️ Oracle returns `a` when `b` is 0; `%` raises error 8134 (verified). The sign follows the dividend in both (verified `-7 % 3` → `-1`). **Refs**: [Oracle MOD](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/MOD.html) |
| `TRUNC(n, d)` | `ROUND(n, d, 1)` | Third argument `1` truncates. |
| `GREATEST(a, b, c)` | `CASE WHEN a IS NULL OR b IS NULL OR c IS NULL THEN NULL ELSE (SELECT MAX(v) FROM (VALUES (a), (b), (c)) AS t(v)) END` | ⚠️ SQL Server ignores NULL arguments; Oracle returns NULL. 2022+: `GREATEST(a, b, c)` inside the same NULL guard. See [semantic-differences §10](./semantic-differences.md#10-greatest--least-with-null). |
| `LEAST(a, b, c)` | Same pattern with `MIN` / `LEAST` | Same as `GREATEST`. |
| `CEIL(n)` | `CEILING(n)` | |
| `POWER` / `ABS` / `FLOOR` / `SIGN` | Same | |

## Aggregate functions

| Oracle | T-SQL | ⚠️ Gotcha |
|--------|-------|-----------|
| `LISTAGG` | `STRING_AGG` | See [String functions](#string-functions). |
| `MEDIAN(col)` | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY col) OVER (PARTITION BY …)` | Window function in SQL Server; use `DISTINCT` or `TOP 1` per group. |
| `RATIO_TO_REPORT(col) OVER ()` | `col * 1.0 / SUM(col) OVER ()` | |

## Session and identity functions

| Oracle | T-SQL | ⚠️ Gotcha |
|--------|-------|-----------|
| `USER` | `SUSER_SNAME()` (login) or `USER_NAME()` (database user) | Oracle returns the session user who logged on; pick the matching SQL Server identity. **Refs**: [Oracle USER](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/USER.html) · [SUSER_SNAME](https://learn.microsoft.com/en-us/sql/t-sql/functions/suser-sname-transact-sql) |
| `SYS_GUID()` | `NEWID()` | Byte-order caution in [data-types.md](./data-types.md#binary-lob-and-guid-types). |
| `ORA_HASH` / `STANDARD_HASH` | `CHECKSUM` / `HASHBYTES` | Different algorithms, so values differ. For cross-platform comparison see [oracle-data-profiling](../../oracle-data-profiling/SKILL.md). |
