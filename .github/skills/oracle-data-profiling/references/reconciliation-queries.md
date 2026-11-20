# Reconciliation Queries (after the data load)

Paired Oracle and T-SQL queries that prove the loaded data matches the source. Run them in order — row counts, then column profiles, then row hashes — and record mismatches as validation findings. The T-SQL side was run on SQL Server 2022. Cross-platform hash equality was checked against SHA-256 values computed from the canonical UTF-8 strings.

## R1 — Row counts

Oracle (generates one statement per table; remove the final `UNION ALL` and run the output):

```sql
SELECT 'SELECT ''' || table_name || ''' AS table_name, COUNT(*) AS row_count FROM "'
       || owner || '"."' || table_name || '" UNION ALL' AS stmt
FROM   all_tables
WHERE  owner = 'HR'
ORDER  BY table_name;
```

T-SQL:

```sql
DECLARE @sql NVARCHAR(MAX);
SELECT @sql = STRING_AGG(CAST(
           N'SELECT N''' + REPLACE(s.name + N'.' + t.name, N'''', N'''''')
           + N''' AS table_name, COUNT_BIG(*) AS row_count FROM '
           + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) AS NVARCHAR(MAX)), N' UNION ALL ')
FROM   sys.tables AS t
JOIN   sys.schemas AS s ON s.schema_id = t.schema_id
WHERE  s.name = N'dbo';
EXEC sys.sp_executesql @sql;
```

Compare table names case-insensitively; Oracle names are usually uppercase.

## R2 — Column profiles

Compute the same measures on both sides. Each measure accounts for a known semantic difference:

| Measure | Oracle | T-SQL | Why |
|---------|--------|-------|-----|
| Non-null strings | `COUNT(col)` | `COUNT_BIG(CASE WHEN DATALENGTH(col) > 0 THEN 1 END)` | `''` is NULL in Oracle ([§1](../../oracle-tsql-reference/references/semantic-differences.md#1-empty-string--null)) |
| Total string length | `SUM(LENGTH2(col))` | `SUM(CAST(DATALENGTH(col) AS BIGINT)) / 2` for `NVARCHAR` | `LEN` ignores trailing spaces; both count UTF-16 units |
| Numeric totals | `SUM(col)`, `MIN(col)`, `MAX(col)` | Same | Exact for `DECIMAL`; a rounded total points at a lossy type ([§6](../../oracle-tsql-reference/references/semantic-differences.md#6-number-without-precision)) |
| Date range | `TO_CHAR(MIN(col), 'YYYY-MM-DD HH24:MI:SS')` | `CONVERT(VARCHAR(19), MIN(col), 120)` | Same text form on both sides |
| Distinct values | `COUNT(DISTINCT col)` | `COUNT(DISTINCT CASE WHEN DATALENGTH(col) > 0 THEN col COLLATE Latin1_General_100_BIN2 END)` | Excludes `''` (NULL in Oracle) and removes case-insensitive merging; trailing-space variants still merge ([§2](../../oracle-tsql-reference/references/semantic-differences.md#2-trailing-spaces-in-string-comparisons)) |

Example (Oracle):

```sql
SELECT COUNT(*)                                          AS row_count,
       COUNT(customer_code)                              AS code_not_null,
       SUM(LENGTH2(customer_code))                       AS code_utf16_units,
       COUNT(DISTINCT customer_code)                     AS code_distinct,
       SUM(credit_limit)                                 AS credit_sum,
       TO_CHAR(MIN(created_on), 'YYYY-MM-DD HH24:MI:SS') AS created_min,
       TO_CHAR(MAX(created_on), 'YYYY-MM-DD HH24:MI:SS') AS created_max
FROM   hr.customers;
```

Example (T-SQL):

```sql
SELECT COUNT_BIG(*)                                                   AS row_count,
       COUNT_BIG(CASE WHEN DATALENGTH(customer_code) > 0 THEN 1 END)  AS code_not_null,
       SUM(CAST(DATALENGTH(customer_code) AS BIGINT)) / 2             AS code_utf16_units,
       COUNT(DISTINCT CASE WHEN DATALENGTH(customer_code) > 0
                           THEN customer_code COLLATE Latin1_General_100_BIN2 END) AS code_distinct,
       SUM(credit_limit)                                              AS credit_sum,
       CONVERT(VARCHAR(19), MIN(created_on), 120)                     AS created_min,
       CONVERT(VARCHAR(19), MAX(created_on), 120)                     AS created_max
FROM   dbo.customers;
```

## R3 — Row hashes

Build the same canonical text for each row on both sides, hash its UTF-8 bytes with SHA-256, and compare by primary key. Start with a key range, then compare the table fingerprint.

| Column type | Oracle canonical form | T-SQL canonical form |
|-------------|-----------------------|----------------------|
| String | `NVL(col, '~')` (`NVARCHAR2`: `NVL(TO_CHAR(col), '~')`) | `CASE WHEN DATALENGTH(col) > 0 THEN col ELSE N'~' END` |
| `NUMBER(p,s)` → `DECIMAL(p,s)` | `NVL(TO_CHAR(col, 'FM9999999999999999999999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,'''), '~')` — one `0` after the point per scale digit | `COALESCE(CONVERT(VARCHAR(50), col), '~')` |
| Integer | `NVL(TO_CHAR(col), '~')` | `COALESCE(CONVERT(VARCHAR(20), col), '~')` |
| `DATE` → `DATETIME2(0)` | `NVL(TO_CHAR(col, 'YYYY-MM-DD HH24:MI:SS'), '~')` | `COALESCE(CONVERT(VARCHAR(19), col, 120), '~')` |
| Separator between columns | `CHR(31)` | `NCHAR(31)` |

Requirements:
- The Oracle database character set must be `AL32UTF8`, so `STANDARD_HASH` hashes UTF-8 bytes. Check it with `SELECT value FROM nls_database_parameters WHERE parameter = 'NLS_CHARACTERSET'`.
- The canonical string must fit in `VARCHAR2` (4000 bytes, or 32767 with extended data types). Hash `CLOB` columns separately.
- SQL Server 2019+ is needed for UTF-8 collations.

Oracle:

```sql
SELECT customer_id,
       LOWER(RAWTOHEX(STANDARD_HASH(
             NVL(customer_code, '~') || CHR(31)
          || NVL(TO_CHAR(credit_limit, 'FM9999999999999999999999999990.00',
                         'NLS_NUMERIC_CHARACTERS=''.,'''), '~') || CHR(31)
          || NVL(TO_CHAR(created_on, 'YYYY-MM-DD HH24:MI:SS'), '~'),
          'SHA256'))) AS row_hash
FROM   hr.customers
WHERE  customer_id BETWEEN 1 AND 1000
ORDER  BY customer_id;
```

T-SQL (the `_UTF8` collation turns the text into UTF-8 bytes before hashing):

```sql
SELECT customer_id,
       LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', CAST(
             CONCAT(CASE WHEN DATALENGTH(customer_code) > 0 THEN customer_code ELSE N'~' END, NCHAR(31),
                    COALESCE(CONVERT(VARCHAR(50), credit_limit), '~'), NCHAR(31),
                    COALESCE(CONVERT(VARCHAR(19), created_on, 120), '~'))
             COLLATE Latin1_General_100_BIN2_UTF8 AS VARCHAR(MAX))), 2)) AS row_hash
FROM   dbo.customers
WHERE  customer_id BETWEEN 1 AND 1000
ORDER  BY customer_id;
```

Table fingerprint — sum of the first 4 hash bytes per row. Compare one number per table, then drill down by key range when they differ:

```sql
-- Oracle
SELECT SUM(TO_NUMBER(SUBSTR(RAWTOHEX(STANDARD_HASH(<canonical expression>, 'SHA256')), 1, 8), 'XXXXXXXX'))
FROM   hr.customers;

-- T-SQL
SELECT SUM(CAST(CAST(SUBSTRING(HASHBYTES('SHA2_256',
           CAST(<canonical expression> COLLATE Latin1_General_100_BIN2_UTF8 AS VARCHAR(MAX))), 1, 4)
           AS BINARY(4)) AS BIGINT))
FROM   dbo.customers;
```

**Refs**: [Oracle STANDARD_HASH](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/STANDARD_HASH.html) · [Oracle RAWTOHEX](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/RAWTOHEX.html) · [SQL Server HASHBYTES](https://learn.microsoft.com/en-us/sql/t-sql/functions/hashbytes-transact-sql) · [UTF-8 collations](https://learn.microsoft.com/en-us/sql/relational-databases/collations/collation-and-unicode-support) · Approach adapted from [oracle/skills — Migration data validation](https://github.com/oracle/skills/blob/main/db/migrations/migration-data-validation.md) (UPL 1.0)

## R4 — Spot checks

- Compare the rows with the minimum and maximum key, date and amount on both sides.
- Re-run R3 for the 100 most important rows (largest amounts, most recent dates).
- For every column flagged by profiling checks P1–P3, compare the affected values explicitly.
