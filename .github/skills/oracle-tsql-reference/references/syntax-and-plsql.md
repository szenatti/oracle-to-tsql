# Syntax and PL/SQL Mapping

Merged from the previous tables in `copilot-instructions.md` and `@oracle-to-tsql`. Rows with **Refs** were added or corrected.

## Query syntax

| Oracle | T-SQL | ⚠️ Gotcha |
|--------|-------|-----------|
| `SELECT … FROM DUAL` | `SELECT …` (no `FROM`) | |
| `MINUS` | `EXCEPT` | |
| `ROWNUM` | `ROW_NUMBER() OVER (ORDER BY …)` | ⚠️ `ROWNUM` is assigned before `ORDER BY`. See [semantic-differences §15](./semantic-differences.md#15-rownum-is-assigned-before-order-by). |
| `WHERE ROWNUM <= N` | `TOP (N)` | |
| `FETCH FIRST N ROWS ONLY` (12c+) **with** `ORDER BY` | `TOP (N)` or `OFFSET 0 ROWS FETCH NEXT N ROWS ONLY` | **Refs**: [Oracle SELECT (row_limiting_clause)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/SELECT.html) · [TOP](https://learn.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql) |
| `FETCH FIRST N ROWS ONLY` **without** `ORDER BY` | `TOP (N)` | ⚠️ T-SQL `OFFSET … FETCH` requires `ORDER BY` (verified syntax error 102). Both return arbitrary rows. **Refs**: [ORDER BY clause (OFFSET-FETCH)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) |
| `FETCH FIRST N ROWS WITH TIES` | `TOP (N) WITH TIES` + same `ORDER BY` | `WITH TIES` requires `ORDER BY`. **Refs**: [TOP](https://learn.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql) |
| `FETCH FIRST N PERCENT ROWS ONLY` | `TOP (N) PERCENT` | **Refs**: [TOP](https://learn.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql) · reversed from [oracle/skills — TOP N → FETCH FIRST](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md) |
| `OFFSET M ROWS FETCH NEXT N ROWS ONLY` | Same syntax; `ORDER BY` required | |
| `CONNECT BY` / `START WITH` | Recursive CTE | See [conversion-patterns.md](./conversion-patterns.md#hierarchical-query-connect-by--recursive-cte). |
| `LEVEL` | CTE level counter | |
| `SYS_CONNECT_BY_PATH` | String accumulation in the CTE | |
| `CONNECT_BY_ROOT` | Anchor value carried through the CTE | |
| `CONNECT_BY_ISLEAF` | `NOT EXISTS` subquery | |
| `ORDER SIBLINGS BY` | Sort on a path column built in the CTE | No direct equivalent. |
| `(+)` outer join | `LEFT JOIN` / `RIGHT JOIN` | ⚠️ Filters on the outer-joined table must move to the `ON` clause. |
| `PIVOT` / `UNPIVOT` | `PIVOT` / `UNPIVOT` | Similar but different syntax. Oracle has supported `PIVOT` since 11g, so no rewrite to conditional aggregation is needed. |
| `MODEL` clause | No equivalent | Requires a complete rewrite. |
| Oracle hints `/*+ … */` | `OPTION (…)` or `WITH (…)` | Different hint system; drop most hints and re-tune. |
| `SELECT … FOR UPDATE [NOWAIT \| WAIT n \| SKIP LOCKED]` | Table hints inside an explicit transaction | See [conversion-patterns.md](./conversion-patterns.md#locking-select--for-update). |
| `CREATE TABLE IF NOT EXISTS` / `DROP … IF EXISTS` (23ai) | `IF OBJECT_ID(N'dbo.t', N'U') IS NULL CREATE TABLE …` / `DROP TABLE IF EXISTS dbo.t` (2016+) | **Refs**: [Oracle 23ai new features — IF [NOT] EXISTS](https://docs.oracle.com/en/database/oracle/oracle-database/23/nfcoa/appdev_sql.html) · [DROP TABLE](https://learn.microsoft.com/en-us/sql/t-sql/statements/drop-table-transact-sql) |

## PL/SQL → T-SQL

| Oracle PL/SQL | T-SQL | ⚠️ Gotcha |
|---------------|-------|-----------|
| `CREATE OR REPLACE PROCEDURE` | `CREATE OR ALTER PROCEDURE` (2016 SP1+) | |
| `p_name IN NUMBER` | `@p_name INT` | `@` prefix; no `IN` keyword. |
| `p_name OUT VARCHAR2` | `@p_name NVARCHAR(100) OUTPUT` | |
| `p_name IN OUT NUMBER` | `@p_name INT OUTPUT` | |
| `p_result OUT SYS_REFCURSOR` | Return a result set with a final `SELECT` | Callers read the result set instead of a cursor parameter. Reversed from [oracle/skills — stored procedure structure](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md). |
| `v_name VARCHAR2(100) := 'x';` | `DECLARE @v_name NVARCHAR(100) = N'x';` | |
| `:=` | `SET @var = value` or `SELECT @var = value` | |
| `v_name table.col%TYPE` | `DECLARE @v_name <actual type>` | Look up the real type; add `-- MIGRATION NOTE: was table.col%TYPE`. |
| `SELECT … INTO v FROM …` | `SELECT @v = … FROM …` | ⚠️ No exception when 0 or >1 rows. Check `@@ROWCOUNT` (below). |
| `CURSOR c IS SELECT …` | `DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT …` | Prefer a set-based rewrite. |
| `FOR rec IN c LOOP … END LOOP` | `OPEN` / `FETCH` / `WHILE @@FETCH_STATUS = 0` / `CLOSE` / `DEALLOCATE` | Prefer a set-based rewrite. |
| `UPDATE … WHERE CURRENT OF c` | Set-based `UPDATE` with the cursor's predicate | |
| `BULK COLLECT INTO` | Table variable or temp table | |
| `FORALL` | One set-based DML statement | |
| `EXECUTE IMMEDIATE` | `EXEC sp_executesql` | Use `QUOTENAME` for identifiers. |
| `RETURNING … INTO` | `OUTPUT` clause into a table variable | See [conversion-patterns.md](./conversion-patterns.md#returning-into--output). |
| `DBMS_OUTPUT.PUT_LINE` | `PRINT` | Or `RAISERROR(@msg, 0, 1) WITH NOWAIT` to flush immediately. |
| `RAISE_APPLICATION_ERROR(-20xxx, msg)` | `THROW 5xxxx, msg, 1;` | Error numbers must be ≥ 50000. |
| `EXCEPTION WHEN NO_DATA_FOUND` | `IF @@ROWCOUNT = 0` straight after the `SELECT` | No direct equivalent. |
| `EXCEPTION WHEN TOO_MANY_ROWS` | `IF @@ROWCOUNT > 1` or `SELECT TOP (2)` | |
| `EXCEPTION WHEN DUP_VAL_ON_INDEX` | `ERROR_NUMBER() IN (2627, 2601)` in `CATCH` | 2601 comes from unique indexes, including the filtered ones in [semantic-differences §4](./semantic-differences.md#4-unique-constraints-and-null). |
| `EXCEPTION WHEN OTHERS` | `BEGIN CATCH … END CATCH` | |
| `SQLERRM` / `SQLCODE` | `ERROR_MESSAGE()` / `ERROR_NUMBER()` | |
| `SQL%ROWCOUNT` | `@@ROWCOUNT` | ⚠️ Read immediately — the next statement resets it. |
| `PRAGMA AUTONOMOUS_TRANSACTION` | No equivalent | See [Autonomous transactions](#autonomous-transactions). |
| No `SET` options in PL/SQL | `SET NOCOUNT ON;` and, in procedures that own a transaction, `SET XACT_ABORT ON;` | Reversed from [oracle/skills best practice 3](https://github.com/oracle/skills/blob/main/db/migrations/migrate-sqlserver-to-oracle.md). See [conversion-patterns.md](./conversion-patterns.md#transactions-and-error-handling). |

### Procedures, functions and variables

```sql
-- Oracle:
-- CREATE OR REPLACE PROCEDURE proc_name (p_id IN NUMBER, p_name OUT VARCHAR2) IS
-- BEGIN ... END;

-- T-SQL:
-- CREATE OR ALTER PROCEDURE dbo.proc_name
--     @p_id INT,
--     @p_name NVARCHAR(100) OUTPUT
-- AS BEGIN
--     SET NOCOUNT ON;
--     BEGIN TRY ... END TRY
--     BEGIN CATCH THROW; END CATCH
-- END;

-- Oracle:
-- CREATE OR REPLACE FUNCTION func_name (p_id NUMBER) RETURN VARCHAR2 IS
--     v_result VARCHAR2(100);
-- BEGIN ... RETURN v_result; END;

-- T-SQL:
-- CREATE OR ALTER FUNCTION dbo.func_name (@p_id INT)
-- RETURNS NVARCHAR(100)
-- AS BEGIN
--     DECLARE @v_result NVARCHAR(100);
--     ... RETURN @v_result;
-- END;
```

### Exception handling

```sql
-- Oracle:
-- BEGIN
--     SELECT salary INTO v_salary FROM employees WHERE employee_id = p_id;
-- EXCEPTION
--     WHEN NO_DATA_FOUND THEN v_salary := 0;
--     WHEN DUP_VAL_ON_INDEX THEN RAISE_APPLICATION_ERROR(-20001, 'Duplicate');
--     WHEN OTHERS THEN RAISE;
-- END;

-- T-SQL: NO_DATA_FOUND / TOO_MANY_ROWS are row-count checks, not errors
-- BEGIN TRY
--     SELECT @v_salary = salary FROM dbo.employees WHERE employee_id = @p_id;
--     IF @@ROWCOUNT = 0 SET @v_salary = 0;          -- NO_DATA_FOUND
-- END TRY
-- BEGIN CATCH
--     IF ERROR_NUMBER() IN (2627, 2601)             -- DUP_VAL_ON_INDEX
--         THROW 50001, N'Duplicate', 1;
--     THROW;                                        -- WHEN OTHERS THEN RAISE
-- END CATCH;
```

### Cursors

```sql
-- Oracle:
-- FOR rec IN (SELECT id, name FROM t) LOOP
--     DBMS_OUTPUT.PUT_LINE(rec.name);
-- END LOOP;

-- T-SQL (prefer a set-based rewrite when possible):
-- DECLARE @id INT, @name NVARCHAR(100);
-- DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT id, name FROM dbo.t;
-- OPEN cur;
-- FETCH NEXT FROM cur INTO @id, @name;
-- WHILE @@FETCH_STATUS = 0
-- BEGIN
--     PRINT @name;
--     FETCH NEXT FROM cur INTO @id, @name;
-- END;
-- CLOSE cur;
-- DEALLOCATE cur;
```

### Autonomous transactions

`PRAGMA AUTONOMOUS_TRANSACTION` commits independently of the caller. T-SQL has no equivalent. Options, in order of preference:

1. Restructure to avoid it (for example, log after the main transaction ends, or return the log rows to the caller).
2. Use a table variable to hold the log rows, since table variables keep their data after `ROLLBACK`, then insert them after the rollback.
3. Use a loopback linked server call or a CLR procedure with its own connection.
4. Queue the work with Service Broker.

Always add a `-- MIGRATION WARNING:` — this needs architectural review.

## Package conversion

| Oracle package | T-SQL equivalent | ⚠️ Gotcha |
|----------------|------------------|-----------|
| `CREATE PACKAGE` spec | `CREATE SCHEMA` | The schema provides the namespace. |
| `CREATE PACKAGE BODY` | Individual `CREATE PROCEDURE` / `FUNCTION` | One object per package member. |
| Package constants | Local variables in each procedure, or a config table | No shared constants. |
| Package variables | No equivalent | ⚠️ Session state is lost. Use a state table or `sp_set_session_context`. |
| Package initialization block | No equivalent | Must be called explicitly. |
| Private procedures | Schema member with a `_` prefix | All schema members are public. |
| `TYPE … IS TABLE OF` | Table variable, table type or temp table | |
| `TYPE … IS RECORD` | Table variable or individual variables | |
| `REF CURSOR` return | Procedure returning a result set | |
| `GRANT EXECUTE ON package` | `GRANT EXECUTE ON SCHEMA::name` | |

## DBMS and UTL package replacements

| Oracle | T-SQL |
|--------|-------|
| `DBMS_OUTPUT.PUT_LINE` | `PRINT`, or `RAISERROR(@msg, 0, 1) WITH NOWAIT` |
| `DBMS_LOB.GETLENGTH` | `DATALENGTH()` |
| `DBMS_LOB.SUBSTR(lob, n, pos)` | `SUBSTRING(@lob, pos, n)` |
| `DBMS_SQL` | `sp_executesql` |
| `DBMS_SCHEDULER` / `DBMS_JOB` | SQL Server Agent jobs |
| `DBMS_CRYPTO` | `HASHBYTES`, `ENCRYPTBYKEY` |
| `DBMS_METADATA` | `sys.sql_modules`, `OBJECT_DEFINITION()` |
| `DBMS_LOCK.SLEEP` | `WAITFOR DELAY` |
| `DBMS_RANDOM` | `NEWID()`, `RAND()`, `CRYPT_GEN_RANDOM()` |
| `DBMS_APPLICATION_INFO` | `sp_set_session_context` (2016+) |
| `UTL_FILE` | SSIS, CLR, or `xp_cmdshell` + `OPENROWSET` |
| `UTL_HTTP` | CLR, SSIS, the application layer, `sp_OACreate` (OLE Automation, disabled by default), or [`sp_invoke_external_rest_endpoint`](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-invoke-external-rest-endpoint-transact-sql) in Azure SQL |
| `UTL_MAIL` | Database Mail (`sp_send_dbmail`) |
| `RAISE_APPLICATION_ERROR(-20001, msg)` | `THROW 50001, msg, 1;` |
