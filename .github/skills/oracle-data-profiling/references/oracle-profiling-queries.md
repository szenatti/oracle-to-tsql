# Oracle Profiling Queries

Run these on the **Oracle source** (12c or later; `HR` and the table and column names are examples). Each check says which mapping it decides and links the rule it supports. Rule sources are in [sources.md](../../oracle-tsql-reference/references/sources.md).

## Dictionary queries

Columns whose mapping depends on the data:

```sql
SELECT c.table_name, c.column_name, c.data_type, c.data_precision, c.data_scale,
       c.char_length, c.char_used, c.nullable
FROM   all_tab_columns c
JOIN   all_tables t ON t.owner = c.owner AND t.table_name = c.table_name
WHERE  c.owner = 'HR'
AND    (   c.data_type IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR', 'DATE',
                           'BINARY_FLOAT', 'BINARY_DOUBLE')
        OR c.data_type LIKE 'TIMESTAMP%'
        OR (c.data_type = 'NUMBER' AND (c.data_precision IS NULL OR c.data_precision <= 4)))
ORDER  BY c.table_name, c.column_id;
```

`DATA_PRECISION IS NULL` with `DATA_SCALE IS NULL` is a bare `NUMBER`; with `DATA_SCALE = 0` it is `INTEGER`. Both need check P6.

Unique keys and unique indexes (for P1, P2 and P4):

```sql
SELECT i.table_name, i.index_name, c.constraint_type,
       LISTAGG(ic.column_name, ', ') WITHIN GROUP (ORDER BY ic.column_position) AS key_columns
FROM   all_indexes i
JOIN   all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name
LEFT JOIN all_constraints c ON c.index_owner = i.owner AND c.index_name = i.index_name
                           AND c.constraint_type IN ('P', 'U')
WHERE  i.table_owner = 'HR'
AND    i.uniqueness = 'UNIQUE'
GROUP  BY i.table_name, i.index_name, c.constraint_type
ORDER  BY i.table_name, i.index_name;
```

**Refs**: [ALL_TAB_COLUMNS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_TAB_COLUMNS.html) · [ALL_CONSTRAINTS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/ALL_CONSTRAINTS.html)

---

## P1 — Case-only duplicates

Decides: whether a case-insensitive SQL Server collation would merge distinct values or break a `UNIQUE` key ([semantic-differences §3](../../oracle-tsql-reference/references/semantic-differences.md#3-case-sensitivity-and-collation)).

```sql
SELECT UPPER(customer_code)          AS folded_value,
       COUNT(*)                      AS row_count,
       COUNT(DISTINCT customer_code) AS spellings
FROM   hr.customers
WHERE  customer_code IS NOT NULL
GROUP  BY UPPER(customer_code)
HAVING COUNT(DISTINCT customer_code) > 1
FETCH FIRST 20 ROWS ONLY;
```

Any rows → use a case-sensitive collation for that column (or the database), or clean the data first.

## P2 — Trailing-space duplicates

Decides: whether SQL Server's padded comparison would merge values or break a `UNIQUE` key ([semantic-differences §2](../../oracle-tsql-reference/references/semantic-differences.md#2-trailing-spaces-in-string-comparisons)).

```sql
SELECT RTRIM(customer_code)          AS trimmed_value,   -- NULL here: the values were spaces only
       COUNT(*)                      AS row_count,
       COUNT(DISTINCT customer_code) AS variants
FROM   hr.customers
WHERE  customer_code IS NOT NULL
GROUP  BY RTRIM(customer_code)
HAVING COUNT(DISTINCT customer_code) > 1;
```

To check P1 and P2 together for a case-insensitive target, group by `UPPER(RTRIM(customer_code))`.

## P3 — Spaces-only values

Decides: whether converted `= N''`, `NULLIF(x, N'')` or `LEN(x) = 0` logic would misfire ([semantic-differences §1](../../oracle-tsql-reference/references/semantic-differences.md#1-empty-string--null)). In Oracle, `RTRIM` of a spaces-only value is `''`, which is NULL.

```sql
SELECT COUNT(*) AS spaces_only_rows
FROM   hr.customers
WHERE  customer_code IS NOT NULL
AND    RTRIM(customer_code) IS NULL;
```

## P4 — NULLs in unique keys

Decides: plain `UNIQUE` vs filtered unique index vs indexed view ([semantic-differences §4](../../oracle-tsql-reference/references/semantic-differences.md#4-unique-constraints-and-null)).

```sql
-- Single-column key: more than 1 → filtered unique index (WHERE col IS NOT NULL)
SELECT COUNT(*) AS null_rows FROM hr.customers WHERE tax_file_number IS NULL;

-- Composite key (a, b): more than 1 all-NULL row → indexed view that excludes all-NULL rows
SELECT COUNT(*) AS all_null_rows FROM hr.contracts WHERE region_code IS NULL AND contract_ref IS NULL;
```

Use the filtered index or indexed view whenever the column is nullable, even if the count is 0 today; the count only tells you whether the current data would fail to load.

## P5 — Small `NUMBER(p)` range

Decides: `BIT`, `TINYINT` or `SMALLINT` for `NUMBER(1)`–`NUMBER(4)` ([data-types.md](../../oracle-tsql-reference/references/data-types.md#numeric-types)).

```sql
SELECT MIN(is_active) AS min_value, MAX(is_active) AS max_value,
       COUNT(DISTINCT is_active) AS distinct_values
FROM   hr.employees;
```

Only 0 and 1 (with a `CHECK`) → `BIT`; 0–255 → `TINYINT`; anything negative → `SMALLINT`.

## P6 — Bare `NUMBER` precision and scale

Decides: `DECIMAL(p,s)` instead of a lossy default ([semantic-differences §6](../../oracle-tsql-reference/references/semantic-differences.md#6-number-without-precision)).

```sql
SELECT COUNT(credit_limit)                                    AS non_null_rows,
       MIN(credit_limit)                                      AS min_value,
       MAX(credit_limit)                                      AS max_value,
       MAX(LENGTH(TO_CHAR(TRUNC(ABS(credit_limit)))))         AS max_integer_digits,
       MAX(CASE WHEN credit_limit <> TRUNC(credit_limit)
                THEN LENGTH(TO_CHAR(ABS(credit_limit) - TRUNC(ABS(credit_limit)))) - 1
           END)                                               AS max_scale,
       SUM(CASE WHEN credit_limit <> TRUNC(credit_limit) THEN 1 ELSE 0 END) AS fractional_rows
FROM   hr.customers;
```

Choose `DECIMAL(max_integer_digits + max_scale + headroom, max_scale)`. No fractional rows and ≤ 18 digits → `BIGINT`. A `max_scale` near 38–40 means computed values such as `1/3`: round to an agreed scale or use `FLOAT(53)`.

## P7 — Time parts and BC dates in `DATE`

Decides: `DATE` vs `DATETIME2(0)` ([semantic-differences §8](../../oracle-tsql-reference/references/semantic-differences.md#8-oracle-date-includes-time)).

```sql
SELECT SUM(CASE WHEN ordered_at <> TRUNC(ordered_at) THEN 1 ELSE 0 END) AS rows_with_time,
       SUM(CASE WHEN ordered_at < DATE '0001-01-01' THEN 1 ELSE 0 END)   AS bc_dates,
       MIN(ordered_at) AS min_value,
       MAX(ordered_at) AS max_value
FROM   hr.orders;
```

## P8 — `TIMESTAMP` digits beyond 100 ns

Decides: whether `DATETIME2(7)` will round `TIMESTAMP(8)` / `TIMESTAMP(9)` values ([data-types.md](../../oracle-tsql-reference/references/data-types.md#date-and-time-types)).

```sql
SELECT SUM(CASE WHEN MOD(TO_NUMBER(TO_CHAR(last_login, 'FF9')), 100) <> 0 THEN 1 ELSE 0 END)
           AS rows_losing_precision
FROM   hr.customers
WHERE  last_login IS NOT NULL;
```

## P9 — Infinity and NaN

Decides: whether `BINARY_FLOAT` / `BINARY_DOUBLE` data can load into `REAL` / `FLOAT` at all ([data-types.md](../../oracle-tsql-reference/references/data-types.md#numeric-types)).

```sql
SELECT COUNT(*) AS non_finite_rows
FROM   hr.metrics
WHERE  score IS NAN OR score IS INFINITE;
```

**Refs**: [Oracle — Floating-point conditions](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Floating-Point-Conditions.html)

## P10 — UTF-16 length for `NVARCHAR(n)`

Decides: `NVARCHAR(n)` size when the Oracle column uses `CHAR` length semantics or holds supplementary characters such as emoji ([data-types.md](../../oracle-tsql-reference/references/data-types.md#string-types)). `LENGTH2` counts UCS-2 code points, the same unit as `NVARCHAR` byte-pairs. It doesn't accept `CLOB`, which maps to `NVARCHAR(MAX)` anyway.

```sql
SELECT MAX(LENGTH2(customer_name)) AS max_utf16_units,   -- minimum n for NVARCHAR(n)
       MAX(LENGTH(customer_name))  AS max_characters,
       MAX(LENGTHB(customer_name)) AS max_bytes
FROM   hr.customers;
```

**Refs**: [Oracle — LENGTH, LENGTHB, LENGTH2](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/LENGTH.html) · [SQL Server — nchar and nvarchar (byte-pairs)](https://learn.microsoft.com/en-us/sql/t-sql/data-types/nchar-and-nvarchar-transact-sql)

---

## Schema-wide string profiler

Runs P1, P2 and P3 for every character column in a schema and prints only the columns with findings. It scans each column three times, so run it off-peak or narrow the column list.

```sql
SET SERVEROUTPUT ON SIZE UNLIMITED
DECLARE
    c_owner       CONSTANT VARCHAR2(128) := 'HR';
    v_sql         VARCHAR2(4000);
    v_case_dupes  NUMBER;
    v_trail_dupes NUMBER;
    v_spaces_only NUMBER;
BEGIN
    FOR c IN (SELECT tc.table_name, tc.column_name
              FROM   all_tab_columns tc
              JOIN   all_tables t ON t.owner = tc.owner AND t.table_name = tc.table_name
              WHERE  tc.owner = c_owner
              AND    tc.data_type IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR')
              ORDER  BY tc.table_name, tc.column_id)
    LOOP
        v_sql := 'SELECT '
              || '(SELECT COUNT(*) FROM (SELECT 1 FROM {t} WHERE {c} IS NOT NULL '
              ||     'GROUP BY UPPER({c}) HAVING COUNT(DISTINCT {c}) > 1)), '
              || '(SELECT COUNT(*) FROM (SELECT 1 FROM {t} WHERE {c} IS NOT NULL '
              ||     'GROUP BY RTRIM({c}) HAVING COUNT(DISTINCT {c}) > 1)), '
              || '(SELECT COUNT(*) FROM {t} WHERE {c} IS NOT NULL AND RTRIM({c}) IS NULL) '
              || 'FROM dual';
        v_sql := REPLACE(REPLACE(v_sql,
                     '{t}', DBMS_ASSERT.ENQUOTE_NAME(c_owner, FALSE) || '.'
                            || DBMS_ASSERT.ENQUOTE_NAME(c.table_name, FALSE)),
                     '{c}', DBMS_ASSERT.ENQUOTE_NAME(c.column_name, FALSE));
        EXECUTE IMMEDIATE v_sql INTO v_case_dupes, v_trail_dupes, v_spaces_only;
        IF v_case_dupes + v_trail_dupes + v_spaces_only > 0 THEN
            DBMS_OUTPUT.PUT_LINE(c.table_name || '.' || c.column_name
                || '  case_duplicate_groups=' || v_case_dupes
                || '  trailing_space_duplicate_groups=' || v_trail_dupes
                || '  spaces_only_rows=' || v_spaces_only);
        END IF;
    END LOOP;
END;
/
```

**Refs**: [Oracle — DBMS_ASSERT](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_ASSERT.html) · [Oracle — EXECUTE IMMEDIATE](https://docs.oracle.com/en/database/oracle/oracle-database/19/lnpls/EXECUTE-IMMEDIATE-statement.html)
