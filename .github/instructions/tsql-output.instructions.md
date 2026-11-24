---
applyTo: "tsql-output/**"
---

# T-SQL Output File Instructions

When working with files in the `tsql-output/` directory, these are **converted T-SQL files** generated from Oracle SQL source files.

## Context

- Each file here corresponds to a source file in `oracle-sql/` with the same relative path and name
- These files should be valid T-SQL targeting Microsoft SQL Server 2019+ (or as specified)
- They should preserve the original business logic while using T-SQL idioms

## T-SQL Output Standards

### File Header
Every converted file must start with a header block:

```sql
/*
 * Source: oracle-sql/<original_filename>.sql
 * Converted: <date>
 * Description: <brief description of what this object does>
 * Source Oracle version: <from the evaluation, e.g. 19c>
 * Target collation: <e.g. SQL_Latin1_General_CP1_CI_AS (default) or a case-sensitive collation>
 * Migration Notes: <any critical notes about behavioral differences>
 */
```

### Stored Procedures and Functions

```sql
SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE [dbo].[procedure_name]
    @param1 NVARCHAR(100),
    @param2 INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;   -- only in procedures that own their transaction; see the transactions pattern
    BEGIN TRY
        -- Converted logic here
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
```

Use the transaction templates in [conversion-patterns.md](../skills/oracle-tsql-reference/references/conversion-patterns.md#transactions-and-error-handling). Leave `XACT_ABORT` off where the Oracle caller handles this procedure's exceptions and carries on.

### Tables

```sql
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[table_name]') AND type = N'U')
BEGIN
    CREATE TABLE [dbo].[table_name] (
        -- columns
    );
END;
GO
```

## Migration Notes Format

Use inline comments for migration annotations:

```sql
-- MIGRATION NOTE: Oracle NVL replaced with COALESCE for ANSI compliance
-- MIGRATION NOTE: CONNECT BY hierarchy replaced with recursive CTE
-- MIGRATION NOTE: Autonomous transaction simulated with separate connection pattern
-- MIGRATION WARNING: Oracle DECODE with NULL comparison - behavior may differ, verify logic
-- MIGRATION TODO: Oracle DBMS_OUTPUT calls converted to PRINT - review if logging framework needed
-- MIGRATION EXCLUDED [EX-001]: backup table SHIPMENTS_BAK (auto: _BAK) — not created. To restore, remove the leading "-- " from the lines below.
-- MIGRATION WARNING [FL-001]: SHIPMENTS_OLD looks like a backup (auto: _OLD) but is kept: referenced by v_shipment_history
```

### Commented-out code

Statements are commented out, never deleted. Backup, dated and leftover tables (with their indexes, grants, comments and DML) are commented out, and so is code with no T-SQL equivalent. Every commented-out statement:
- starts with a `-- MIGRATION EXCLUDED [EX-nnn]:` marker line;
- has every line, including `GO`, prefixed with `-- ` (no `/* … */`);
- has a matching row in section 1.8 of the migration report.

Rules: [object-exclusions.md](../skills/oracle-tsql-reference/references/object-exclusions.md).

## Quality Requirements

- Must compile without errors on SQL Server 2019+
- Must use schema-qualified names (`[dbo].[object_name]`)
- Must include `GO` batch separators between DDL statements
- Must use `SET NOCOUNT ON` in all procedures
- Must use `BEGIN TRY/CATCH` for error handling
- Must preserve original business logic semantics
- Must not use deprecated T-SQL features (`SET ROWCOUNT`, `*=` joins, etc.)
- Must emulate Oracle's empty-string rule with `DATALENGTH`, never `NULLIF(x, N'')` or `LEN(x) = 0`
- Must use a filtered unique index (or indexed view) for `UNIQUE` keys on nullable columns
- Must keep Oracle's conversion failures: `CONVERT` / `CAST`, with `TRY_` functions only where Oracle used `DEFAULT … ON CONVERSION ERROR`
- Must convert row-level triggers to set-based triggers over `inserted` / `deleted`
- Must not create backup, dated or leftover tables, and must not contain commented-out code without a `MIGRATION EXCLUDED` marker and a report row

Rules, examples and sources: [oracle-tsql-reference](../skills/oracle-tsql-reference/SKILL.md).
