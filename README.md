# Oracle to T-SQL Migration Toolkit

A GitHub Copilot-powered toolkit for migrating Oracle SQL/PL/SQL code to Microsoft SQL Server T-SQL. Uses custom agents, instructions, and extensions to evaluate, convert, validate, and optimize your SQL migration — with full support for batch processing across many files.

![Demo](docs/demo-preview.gif)

> 📺 Watch the [full demo video](docs/demo-fast.mp4) for a complete walkthrough of the migration pipeline.

## Quick Start

1. **Copy sample files** (or drop your own Oracle SQL files) into `oracle-sql/`:
   ```bash
   cp samples/*.sql oracle-sql/
   ```
   This works in bash, zsh and PowerShell. In Windows `cmd.exe`, use `copy samples\*.sql oracle-sql\`.
2. **Run the full pipeline**: `@migration-orchestrator migrate all`
3. **Check status**: `@migration-orchestrator status`
4. **Review results** in `tsql-output/` and `migration-reports/`

> See [samples/README.md](samples/README.md) for detailed testing instructions.

## Documentation MCP Servers

The agents check behaviour they're unsure about against official documentation through two MCP servers. They work without them, but anything they couldn't check is marked `-- MIGRATION WARNING: unverified`. Rules for using them: [Verifying assumptions](.github/skills/oracle-tsql-reference/SKILL.md#verifying-assumptions).

| Server | Covers | Setup |
|--------|--------|-------|
| [Microsoft Learn MCP](https://learn.microsoft.com/en-us/training/support/mcp) | SQL Server, Azure SQL, T-SQL | Hosted; nothing to install |
| [Oracle Database Documentation MCP](https://github.com/oracle/mcp/blob/main/src/oracle-db-doc-mcp-server/README.md) | Oracle SQL and PL/SQL | Local Python server with a documentation index you build once |

Register them in your user configuration so every workspace can use them. This repo doesn't ship an MCP configuration, because the Oracle server path is machine-specific.

### Install the Oracle server

Needs Python 3.13+ and [uv](https://docs.astral.sh/uv/). Index the documentation for the Oracle version you migrate from; the rules in this repo cite 19c. Everything goes under `.oracle` in your home folder.

macOS / Linux:

```bash
git clone https://github.com/oracle/mcp.git ~/.oracle/mcp-src
cd ~/.oracle/mcp-src/src/oracle-db-doc-mcp-server
uv sync --locked --no-dev

curl -L -o ~/.oracle/oracle-database_19.zip \
  https://docs.oracle.com/en/database/oracle/oracle-database/19/zip/oracle-database_19.zip
.venv/bin/python3 oracle-db-doc-mcp-server.py idx -path ~/.oracle/oracle-database_19.zip
```

Windows (PowerShell):

```powershell
git clone https://github.com/oracle/mcp.git "$HOME\.oracle\mcp-src"
Set-Location "$HOME\.oracle\mcp-src\src\oracle-db-doc-mcp-server"
uv sync --locked --no-dev

curl.exe -L -o "$HOME\.oracle\oracle-database_19.zip" `
  https://docs.oracle.com/en/database/oracle/oracle-database/19/zip/oracle-database_19.zip
.\.venv\Scripts\python.exe oracle-db-doc-mcp-server.py idx -path "$HOME\.oracle\oracle-database_19.zip"
```

Use `curl.exe`, not `curl`: in Windows PowerShell 5.1, `curl` is an alias for `Invoke-WebRequest`. The server has been tested on macOS only.

The index is stored in `.oracle/oracle-db-doc-mcp-server/` under your home folder (`~` on macOS/Linux, `%USERPROFILE%` on Windows). Building it takes several minutes; run `idx` again to refresh it. The official Docker image (`ghcr.io/oracle/mcp/oracle-db-doc`) builds in the 26ai index, which doesn't match 19c sources.

If your package index doesn't have every version in `uv.lock` yet (common with corporate mirrors), keep the current script and install the previous lock, which pins FastMCP 3.4.10. Don't run scripts older than commit `aa3294b`: their searches fail with a SQLite "objects created in a thread" error. The steps check the previous lock out into a temporary git worktree, so no file is rewritten by the shell.

macOS / Linux:

```bash
cd ~/.oracle/mcp-src
git fetch --depth 50 origin main
git worktree add ~/.oracle/mcp-prev 6ea29c1
uv export --project ~/.oracle/mcp-prev/src/oracle-db-doc-mcp-server --locked --no-dev --no-emit-project -o ~/.oracle/requirements-prev.txt
git worktree remove ~/.oracle/mcp-prev

cd src/oracle-db-doc-mcp-server
python3.13 -m venv .venv
.venv/bin/pip install --require-hashes -r ~/.oracle/requirements-prev.txt
```

Windows (PowerShell):

```powershell
Set-Location "$HOME\.oracle\mcp-src"
git fetch --depth 50 origin main
git worktree add "$HOME\.oracle\mcp-prev" 6ea29c1
uv export --project "$HOME\.oracle\mcp-prev\src\oracle-db-doc-mcp-server" --locked --no-dev --no-emit-project -o "$HOME\.oracle\requirements-prev.txt"
git worktree remove "$HOME\.oracle\mcp-prev"

Set-Location src\oracle-db-doc-mcp-server
py -3.13 -m venv .venv
.\.venv\Scripts\pip.exe install --require-hashes -r "$HOME\.oracle\requirements-prev.txt"
```

### Register both servers

VS Code (Copilot) and Copilot CLI read the same user file: `~/.copilot/mcp-config.json` on macOS/Linux, `%USERPROFILE%\.copilot\mcp-config.json` on Windows, or `mcp-config.json` in `COPILOT_HOME` if you set it. In VS Code you can also run **Chat: Open Customizations** → **MCP Servers** → **Add Server** → **Global** → **Copilot Global**. Add both servers under `mcpServers`.

macOS / Linux:

```json
{
  "mcpServers": {
    "microsoft-learn": { "type": "http", "url": "https://learn.microsoft.com/api/mcp", "tools": ["*"] },
    "oracle-db-doc": {
      "type": "stdio",
      "command": "${HOME}/.oracle/mcp-src/src/oracle-db-doc-mcp-server/.venv/bin/python3",
      "args": ["${HOME}/.oracle/mcp-src/src/oracle-db-doc-mcp-server/oracle-db-doc-mcp-server.py", "mcp"],
      "tools": ["*"]
    }
  }
}
```

Windows:

```json
{
  "mcpServers": {
    "microsoft-learn": { "type": "http", "url": "https://learn.microsoft.com/api/mcp", "tools": ["*"] },
    "oracle-db-doc": {
      "type": "stdio",
      "command": "${USERPROFILE}\\.oracle\\mcp-src\\src\\oracle-db-doc-mcp-server\\.venv\\Scripts\\python.exe",
      "args": ["${USERPROFILE}\\.oracle\\mcp-src\\src\\oracle-db-doc-mcp-server\\oracle-db-doc-mcp-server.py", "mcp"],
      "tools": ["*"]
    }
  }
}
```

Backslashes are doubled because the file is JSON. If the `${HOME}` or `${USERPROFILE}` reference isn't expanded on your setup, write the full path instead.

## Project Structure

```
samples/                 ← Sample Oracle SQL files for testing (7 files, 🟢→🔴)
oracle-sql/              ← Drop Oracle SQL files here (source, read-only)
tsql-output/             ← Converted T-SQL output (auto-generated)
migration-reports/       ← Evaluation, validation & performance reports
migration-exclusions.json ← Project decisions on backup, dated and leftover tables
.github/
  ├── copilot-instructions.md          ← Always-on project rules and critical semantic rules
  ├── skills/
  │   ├── oracle-tsql-reference/       ← On-demand mapping tables, patterns, exclusion rules and sources
  │   └── oracle-data-profiling/       ← Oracle profiling and post-load reconciliation queries
  ├── instructions/
  │   ├── oracle-sql.instructions.md   ← Context for Oracle files
  │   ├── tsql-output.instructions.md  ← Standards for T-SQL output
  │   └── migration-reports.instructions.md
  ├── agents/
  │   ├── oracle-evaluator.md          ← @oracle-evaluator agent
  │   ├── oracle-to-tsql.md            ← @oracle-to-tsql agent
  │   ├── tsql-validator.md            ← @tsql-validator agent
  │   ├── performance-analyzer.md      ← @performance-analyzer agent
  │   └── migration-orchestrator.md    ← @migration-orchestrator agent
  └── extensions/
      └── oracle-migration/
          ├── extension.mjs            ← Custom tools (scan, status, batch, state, exclusions)
          ├── exclusions.mjs           ← Backup / dated / leftover table detection
          └── exclusions.test.mjs      ← Tests: node --test .github/extensions/oracle-migration/exclusions.test.mjs
```

## Backup, Dated and Leftover Tables

Oracle schemas collect one-off copies, such as `ORDERS_BAK`, `ORDERS_20211014`, `TMP_ORDERS` and `BIN$…` recycle-bin tables. The pipeline converts them but **comments them out** instead of creating them, together with their indexes, grants, comments and DML. Each one is recorded in the migration report.

- **Commented out:** clear backup words and prefixes, full dates, scratch tables and Oracle system leftovers.
- **Kept and flagged for a decision:** ambiguous names (`_NEW`, `_ARCHIVE`, `_HOLD`, `_TEMP`, `X_`, `_202110`), global temporary tables, and any match that kept code still uses.
- **Recorded:** every commented-out statement, for any reason, has a `-- MIGRATION EXCLUDED [EX-nnn]:` marker in `tsql-output/` and a row in section 1.8 of its report. The validator checks that markers and rows match.
- **Overridden:** project decisions go in [`migration-exclusions.json`](migration-exclusions.json) (`include`, `exclude` and `extraPatterns`, each with a reason). Commit it so the team shares the decisions.

Full rules, date formats and the override format: [object-exclusions.md](.github/skills/oracle-tsql-reference/references/object-exclusions.md). Sample: [07_backup_and_dated_tables.sql](samples/07_backup_and_dated_tables.sql).

## Migration Pipeline

```mermaid
flowchart LR
    A["📂 Drop SQL files\noracle-sql/"] --> B["🔍 Evaluate\n@oracle-evaluator"]
    B --> C["🔄 Convert\n@oracle-to-tsql"]
    C --> D["✅ Validate\n@tsql-validator"]
    D --> E["⚡ Analyze\n@performance-analyzer"]

    B -->|report| R1["migration-reports/\nevaluation-*.md"]
    C -->|output| R2["tsql-output/\n*.sql"]
    D -->|report| R3["migration-reports/\nvalidation-*.md"]
    E -->|report| R4["migration-reports/\nperformance-*.md"]
```

## Custom Agents

| Agent | Purpose | Example Usage |
|-------|---------|---------------|
| `@oracle-evaluator` | Assess migration complexity and risks | `@oracle-evaluator evaluate oracle-sql/pkg_orders.sql` |
| `@oracle-to-tsql` | Convert Oracle SQL → T-SQL | `@oracle-to-tsql convert oracle-sql/pkg_orders.sql` |
| `@tsql-validator` | Validate converted T-SQL correctness | `@tsql-validator validate tsql-output/pkg_orders.sql` |
| `@performance-analyzer` | Performance analysis and optimization | `@performance-analyzer analyze tsql-output/pkg_orders.sql` |
| `@migration-orchestrator` | Batch orchestration with parallel sub-agents | `@migration-orchestrator migrate all` |

## Custom Tools

### Discovery & Status
| Tool | Description |
|------|-------------|
| `scan_oracle_files` | Discovers Oracle SQL files, returns structured JSON with metadata and excluded/flagged table counts |
| `get_object_exclusions` | Backup, dated and leftover tables to comment out (`EX-` rows) and look-alikes kept for a decision (`FL-` rows) |
| `migration_status` | Per-file status across all phases (pending/in_progress/done/failed) |
| `list_migration_reports` | Lists all generated reports with type classification |
| `generate_consolidated_report` | Merges all per-phase reports into a single consolidated report per file |
| `init_migration_project` | Creates project directories and initializes state |

### Batch Orchestration
| Tool | Description |
|------|-------------|
| `generate_batch_plan` | Generates dispatch plan with sub-agent prompts per file+phase |
| `claim_work_item` | Locks a file+phase as in_progress before dispatching |
| `complete_work_item` | Marks file+phase as done after sub-agent succeeds |
| `fail_work_item` | Records failure with error message for retry |
| `reset_work_item` | Resets a file+phase to pending for retry |

## Workflow

### Single File (use individual agents)

```
@oracle-evaluator evaluate oracle-sql/my_proc.sql
@oracle-to-tsql convert oracle-sql/my_proc.sql
@tsql-validator validate tsql-output/my_proc.sql
@performance-analyzer analyze tsql-output/my_proc.sql
```

### Batch Migration (use orchestrator with parallel sub-agents)

```
@migration-orchestrator evaluate all
@migration-orchestrator convert all
@migration-orchestrator migrate all    ← full 4-phase pipeline
@migration-orchestrator status
@migration-orchestrator retry failed
```

The orchestrator dispatches one sub-agent per file (up to 5 in parallel), tracks state via the extension, and aggregates results.

```mermaid
flowchart TB
    O["@migration-orchestrator\nscan → plan → dispatch → collect"]
    O --> S1["sub-agent 1\nfile_a.sql"]
    O --> S2["sub-agent 2\nfile_b.sql"]
    O --> S3["sub-agent 3\nfile_c.sql"]
    O --> SN["sub-agent N\nfile_n.sql"]

    S1 --> P1["evaluate → convert → validate → analyze"]
    S2 --> P2["evaluate → convert → validate → analyze"]
    S3 --> P3["evaluate → convert → validate → analyze"]
    SN --> PN["evaluate → convert → validate → analyze"]
```

### Work Item State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: scan_oracle_files
    pending --> in_progress: claim_work_item
    in_progress --> done: complete_work_item
    in_progress --> failed: fail_work_item
    failed --> pending: reset_work_item
    done --> pending: reset_work_item
```

## Supported Oracle File Types

| Extension | Description |
|-----------|-------------|
| `.sql` | General SQL scripts |
| `.pls` | PL/SQL source |
| `.pks` | Package specification |
| `.pkb` | Package body |
| `.trg` | Trigger |
| `.vw` | View |
| `.fnc` | Function |
| `.prc` | Procedure |
| `.typ` | Type definition |
