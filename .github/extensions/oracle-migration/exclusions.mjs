// Detects backup, dated and leftover tables in Oracle sources so they can be commented out
// instead of created. The rules are documented in
// .github/skills/oracle-tsql-reference/references/object-exclusions.md — keep the two in sync.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const OVERRIDES_FILE = "migration-exclusions.json";

const AUTO_WORDS = new Map([
    ...["BAK", "BKP", "BACKUP", "BK", "BCK", "BKUP", "OLD", "ORIG", "SAVE"].map((w) => [w, "Backup table"]),
    ["TMP", "Scratch table"],
    ...["DUP", "DUPS", "CLONE", "RESTORE", "BEFORE", "AFTER"].map((w) => [w, "Copy of another table"]),
    ...["DROP", "TODELETE", "DEPRECATED", "OBSOLETE", "UNUSED", "DONOTUSE"].map((w) => [w, "Marked for deletion"]),
]);
const FLAG_WORDS = new Set([
    "NEW", "COPY", "PREV", "SAV", "ARCH", "ARCHIVE", "HOLD", "DEL", "TEST", "TEMP",
    "SNAP", "SNAPSHOT", "PRE", "POST", "FIX", "MIG", "CONV",
]);
const AUTO_PREFIXES = new Map([
    ...["BAK", "BKP", "BACKUP", "OLD"].map((w) => [w, "Backup table"]),
    ["TMP", "Scratch table"],
    ...["ZZ", "ZZZ"].map((w) => [w, "Marked for deletion"]),
]);
const FLAG_PREFIXES = new Set(["TEMP", "TEST", "X"]);
const SYSTEM_RULES = [
    [/^BIN\$/, "BIN$ (recycle bin)"],
    [/^SYS_(EXPORT|IMPORT)_/, "SYS_EXPORT_/SYS_IMPORT_ (Data Pump job table)"],
    [/^MLOG\$_/, "MLOG$_ (materialized view log)"],
    [/^RUPD\$_/, "RUPD$_ (materialized view log)"],
    [/^DR\$/, "DR$ (Oracle Text index table)"],
    [/^CMP[34]\$/, "CMP3$/CMP4$ (compression advisor)"],
    [/^(PLAN_TABLE|TOAD_PLAN_TABLE|CHAINED_ROWS|EXCEPTIONS)$/, "Oracle utility table"],
];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const TIER_RANK = { flag: 1, exclude: 2 };

// ── Dates ──

function daysIn(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function validDate(y, m, d, minYear = 1900) {
    return y >= minYear && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}
function validTime(s) {
    if (!/^\d{4}(\d{2})?$/.test(s)) return false;
    return +s.slice(0, 2) < 24 && +s.slice(2, 4) < 60 && (s.length === 4 || +s.slice(4, 6) < 60);
}
const year2 = (yy) => 2000 + +yy;
const monthOf = (mon) => MONTHS.indexOf(mon) + 1;

// YYYYMMDD, DDMMYYYY or MMDDYYYY, YYYYMMDDHHMM[SS], DDMONYYYY, DDMONYY
function isFullDateToken(t) {
    if (/^\d{8}$/.test(t)) {
        const [a, b, c] = [+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8)];
        const [p, q, y] = [+t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 8)];
        return validDate(a, b, c) || validDate(y, q, p) || validDate(y, p, q);
    }
    if (/^\d{12}(\d{2})?$/.test(t)) {
        return validDate(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8)) && validTime(t.slice(8));
    }
    const m = /^(\d{2})([A-Z]{3})(\d{4}|\d{2})$/.exec(t);
    if (m && monthOf(m[2])) {
        return validDate(m[3].length === 4 ? +m[3] : year2(m[3]), monthOf(m[2]), +m[1]);
    }
    return false;
}

// YYYYMM or YYMMDD, year, MONYYYY, MONYY, YYYYMON, quarters, fiscal years, YYYYDDD
function isPeriodToken(t) {
    if (/^\d{6}$/.test(t)) {
        const ym = validDate(+t.slice(0, 4), +t.slice(4, 6), 1, 1990);
        return ym || validDate(year2(t.slice(0, 2)), +t.slice(2, 4), +t.slice(4, 6));
    }
    if (/^\d{4}$/.test(t)) return +t >= 1990 && +t <= 2099;
    if (/^\d{7}$/.test(t)) return +t.slice(0, 4) >= 1990 && +t.slice(0, 4) <= 2099 && +t.slice(4) >= 1 && +t.slice(4) <= 366;
    let m = /^([A-Z]{3})(\d{4}|\d{2})$/.exec(t);
    if (m && monthOf(m[1])) return true;
    m = /^(\d{4})([A-Z]{3})$/.exec(t);
    if (m && monthOf(m[2])) return true;
    return /^(\d{4}Q[1-4]|Q[1-4]\d{4}|FY\d{2}|FY\d{4})$/.test(t);
}

const isYear = (t) => /^\d{4}$/.test(t) && +t >= 1900 && +t <= 2099;
const isYear2or4 = (t) => /^\d{2}$/.test(t) || isYear(t);
const isNum = (t, len) => new RegExp(`^\\d{${len}}$`).test(t);

// Multi-token dates such as 2021_10_14, 14_OCT_2021, Q1_2021, OCT_2021, with an optional time token.
function matchDateAt(tokens, end) {
    const at = (k) => tokens[end - k];
    const avail = end - 1;
    const full3 = (a, b, c) =>
        (isYear(a) && isNum(b, 2) && isNum(c, 2) && validDate(+a, +b, +c)) ||
        (isNum(a, 2) && isNum(b, 2) && isYear(c) && (validDate(+c, +b, +a) || validDate(+c, +a, +b))) ||
        (isNum(a, 2) && monthOf(b) > 0 && isYear2or4(c) && validDate(c.length === 4 ? +c : year2(c), monthOf(b), +a)) ||
        (isYear(a) && monthOf(b) > 0 && isNum(c, 2) && validDate(+a, monthOf(b), +c));
    if (avail >= 4 && validTime(at(1)) && full3(at(4), at(3), at(2))) return { len: 4, kind: "full" };
    if (avail >= 3 && full3(at(3), at(2), at(1))) return { len: 3, kind: "full" };
    if (avail >= 2 && validTime(at(1)) && isFullDateToken(at(2))) return { len: 2, kind: "full" };
    if (avail >= 1 && isFullDateToken(at(1))) return { len: 1, kind: "full" };
    if (avail >= 2) {
        const [a, b] = [at(2), at(1)];
        if (
            (isYear(a) && isNum(b, 2) && +b >= 1 && +b <= 12) ||
            (isNum(a, 2) && +a >= 1 && +a <= 12 && isYear(b)) ||
            (monthOf(a) > 0 && isYear2or4(b)) ||
            (isYear(a) && monthOf(b) > 0) ||
            (/^Q[1-4]$/.test(a) && isYear(b)) ||
            (isYear(a) && /^Q[1-4]$/.test(b)) ||
            (a === "FY" && isYear2or4(b))
        ) return { len: 2, kind: "period" };
    }
    if (avail >= 1 && isPeriodToken(at(1))) return { len: 1, kind: "period" };
    return null;
}

// ── Name rules ──

/**
 * Classifies a bare table name. Returns null, or { tier: "exclude" | "flag", rule, category }.
 */
export function classifyName(rawName) {
    const name = rawName.toUpperCase();
    for (const [re, label] of SYSTEM_RULES) {
        if (re.test(name)) return { tier: "exclude", rule: label, category: "Oracle system or tool object" };
    }
    if (/^ERR\$_/.test(name)) return { tier: "flag", rule: "ERR$_ (DML error log)", category: "Error-logging table" };

    const tokens = name.split("_").filter(Boolean);
    const hits = [];
    const hit = (tier, rule, category) => hits.push({ tier, rule, category });

    let end = tokens.length;
    const counters = [];
    for (let changed = true; changed && end > 1; ) {
        changed = false;
        const d = matchDateAt(tokens, end);
        if (d) {
            const suffix = "_" + tokens.slice(end - d.len, end).join("_");
            if (d.kind === "full") hit("exclude", `date ${suffix}`, "Dated snapshot");
            else hit("flag", `period ${suffix}`, "Period table");
            end -= d.len;
            changed = true;
        } else if (/^(\d{1,3}|V\d{1,3})$/.test(tokens[end - 1])) {
            counters.unshift(tokens[end - 1]);
            end--;
            changed = true;
        }
    }

    const last = tokens[end - 1];
    const numbered = /^([A-Z]+?)(\d{1,3})$/.exec(last);
    if (end > 1 && AUTO_WORDS.has(last)) {
        hit("exclude", `_${last}`, AUTO_WORDS.get(last));
    } else if (end > 1 && last === "COPY" && counters.some((c) => /^\d/.test(c))) {
        hit("exclude", `_COPY_${counters[0]}`, "Copy of another table");
    } else if (end > 1 && numbered && (AUTO_WORDS.has(numbered[1]) || numbered[1] === "COPY")) {
        hit("exclude", `_${last}`, AUTO_WORDS.get(numbered[1]) || "Copy of another table");
    } else if (end > 1 && (FLAG_WORDS.has(last) || (numbered && FLAG_WORDS.has(numbered[1])))) {
        hit("flag", `_${last}`, "Possible leftover table");
    } else if (counters.length && !hits.length && /^(\d|0\d{1,2}|V\d{1,3})$/.test(counters[counters.length - 1])) {
        hit("flag", `_${counters.join("_")}`, "Numbered copy");
    }

    if (tokens.length >= 2) {
        if (AUTO_PREFIXES.has(tokens[0])) hit("exclude", `${tokens[0]}_`, AUTO_PREFIXES.get(tokens[0]));
        else if (FLAG_PREFIXES.has(tokens[0])) hit("flag", `${tokens[0]}_`, "Possible leftover table");
    }

    // No underscore before the marker, e.g. ORDERSBAK or ORDERS20211014
    const tail = tokens[tokens.length - 1] || "";
    const glued = /^[A-Z][A-Z0-9$#]*?(BAK|BKP|BACKUP)\d*$/.exec(tail);
    if (!hits.length && glued && tail !== glued[1]) hit("flag", `…${glued[1]} (no underscore)`, "Possible backup table");
    const gluedDate = /^[A-Z][A-Z$#]+(\d{8})$/.exec(tail);
    if (!hits.length && gluedDate && isFullDateToken(gluedDate[1])) hit("flag", `…${gluedDate[1]} (no underscore)`, "Possible dated snapshot");

    if (!hits.length) return null;
    const top = Math.max(...hits.map((h) => TIER_RANK[h.tier]));
    const best = hits.filter((h) => TIER_RANK[h.tier] === top);
    return {
        tier: best[0].tier,
        rule: best.map((h) => h.rule).join(" + "),
        category: best[0].category,
    };
}

// ── Lexer and statement splitter ──

const isIdentChar = (c) => c !== undefined && /[A-Za-z0-9_$#]/.test(c);

/**
 * Blanks comments (in both outputs) and string literals (in `code` only), keeping offsets and newlines.
 */
export function lex(text) {
    const code = text.split("");
    const withStrings = text.split("");
    const blank = (arr, a, b) => {
        for (let k = a; k < b && k < arr.length; k++) if (arr[k] !== "\n" && arr[k] !== "\r") arr[k] = " ";
    };
    const n = text.length;
    let i = 0;
    while (i < n) {
        const c = text[i];
        const d = text[i + 1];
        if (c === "-" && d === "-") {
            let j = text.indexOf("\n", i);
            if (j < 0) j = n;
            blank(code, i, j);
            blank(withStrings, i, j);
            i = j;
        } else if (c === "/" && d === "*") {
            let j = text.indexOf("*/", i + 2);
            j = j < 0 ? n : j + 2;
            blank(code, i, j);
            blank(withStrings, i, j);
            i = j;
        } else if ((c === "q" || c === "Q") && d === "'" && !isIdentChar(text[i - 1])) {
            const open = text[i + 2];
            const close = { "[": "]", "{": "}", "(": ")", "<": ">" }[open] || open;
            let j = text.indexOf(close + "'", i + 3);
            j = j < 0 ? n : j + 2;
            blank(code, i + 2, j - 1);
            i = j;
        } else if (c === "'") {
            let j = i + 1;
            while (j < n && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
            blank(code, i + 1, j);
            i = j + 1;
        } else if (c === '"') {
            const j = text.indexOf('"', i + 1);
            i = j < 0 ? n : j + 1;
        } else {
            i++;
        }
    }
    return { code: code.join(""), withStrings: withStrings.join("") };
}

const PLSQL_START = /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|LIBRARY)\b|DECLARE\b|BEGIN\b)/i;
const SQLPLUS_START = /^(?:@|(?:SET|PROMPT|SPOOL|WHENEVER|REM|REMARK|COLUMN|DEFINE|UNDEFINE|SHOW|EXEC|EXECUTE|CONNECT|CONN|DISCONNECT|PAUSE|ACCEPT|VARIABLE|VAR|PRINT|BREAK|COMPUTE|CLEAR|TTITLE|BTITLE)\b)/i;

/**
 * Splits lexed code into statements. PL/SQL units end at a "/" line; SQL*Plus commands at end of line;
 * everything else at ";".
 */
export function splitStatements(code, withStrings = code) {
    const lineStarts = [0];
    for (let k = 0; k < code.length; k++) if (code[k] === "\n") lineStarts.push(k + 1);
    const lineOf = (offset) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    };
    const eol = (k) => {
        const j = code.indexOf("\n", k);
        return j < 0 ? code.length : j;
    };

    const statements = [];
    const n = code.length;
    let i = 0;
    while (i < n) {
        while (i < n && /\s/.test(code[i])) i++;
        if (i >= n) break;
        const head = code.slice(i, i + 200);
        let end;
        let next;
        if (/^\/[ \t\r]*(\n|$)/.test(head)) {
            i = eol(i);
            continue;
        } else if (PLSQL_START.test(head)) {
            const re = /^[ \t]*\/[ \t\r]*$/gm;
            re.lastIndex = i;
            const m = re.exec(code);
            end = m ? m.index : n;
            next = m ? m.index + m[0].length : n;
        } else if (SQLPLUS_START.test(head)) {
            end = eol(i);
            next = end;
        } else {
            const j = code.indexOf(";", i);
            end = j < 0 ? n : j;
            next = j < 0 ? n : j + 1;
        }
        statements.push({
            start: i,
            startLine: lineOf(i),
            endLine: lineOf(Math.max(i, end - 1)),
            text: code.slice(i, end),
            textWithStrings: withStrings.slice(i, end),
            isPlsql: PLSQL_START.test(head),
        });
        i = next;
    }
    return statements;
}

// ── Statement targets ──

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z][A-Za-z0-9_$#]*)`;
const QN = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?(?:@[A-Za-z0-9_$#.]+)?`;
const TARGET_RULES = [
    ["CREATE TABLE", String.raw`^CREATE\s+(?:(?<temp>GLOBAL|PRIVATE)\s+TEMPORARY\s+|(?:SHARDED|DUPLICATED|IMMUTABLE|BLOCKCHAIN)\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<target>${QN})`],
    ["CREATE INDEX", String.raw`^CREATE\s+(?:UNIQUE\s+|BITMAP\s+|MULTIVALUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?${QN}\s+ON\s+(?<target>${QN})`],
    ["ALTER TABLE", String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?<target>${QN})`],
    ["COMMENT ON TABLE", String.raw`^COMMENT\s+ON\s+TABLE\s+(?<target>${QN})`],
    ["COMMENT ON COLUMN", String.raw`^COMMENT\s+ON\s+COLUMN\s+(?<target>${IDENT}(?:\s*\.\s*${IDENT})?)\s*\.\s*${IDENT}\s+IS\b`],
    ["GRANT", String.raw`^GRANT\s+[\s\S]+?\s+ON\s+(?:TABLE\s+)?(?<target>${QN})\s+TO\b`],
    ["CREATE SYNONYM", String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PUBLIC\s+)?SYNONYM\s+${QN}\s+FOR\s+(?<target>${QN})`],
    ["INSERT", String.raw`^INSERT\s+INTO\s+(?<target>${QN})`],
    ["UPDATE", String.raw`^UPDATE\s+(?<target>${QN})`],
    ["DELETE", String.raw`^DELETE\s+(?:FROM\s+)?(?<target>${QN})`],
    ["MERGE", String.raw`^MERGE\s+INTO\s+(?<target>${QN})`],
    ["TRUNCATE TABLE", String.raw`^TRUNCATE\s+TABLE\s+(?<target>${QN})`],
    ["DROP TABLE", String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?<target>${QN})`],
    ["ANALYZE TABLE", String.raw`^ANALYZE\s+TABLE\s+(?<target>${QN})`],
].map(([kind, src]) => [kind, new RegExp(src, "i")]);
const TRIGGER_START = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?TRIGGER\b/i;
const TRIGGER_ON = new RegExp(String.raw`\bON\s+(?<target>${QN})`, "i");

const normIdent = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toUpperCase());

export function parseName(raw) {
    const ids = raw.replace(/@.*$/, "").match(new RegExp(IDENT, "g"));
    return ids.length >= 2
        ? { schema: normIdent(ids[0]), name: normIdent(ids[1]) }
        : { schema: null, name: normIdent(ids[0]) };
}

function detectTarget(stmt) {
    const text = stmt.text;
    for (const [kind, re] of TARGET_RULES) {
        const m = re.exec(text);
        if (!m) continue;
        const target = { kind, ...parseName(m.groups.target) };
        if (kind === "CREATE TABLE") {
            target.temporary = m.groups.temp ? m.groups.temp.toUpperCase() : null;
            const as = /\bAS\s*\(?\s*SELECT\b/i.exec(text);
            if (as) {
                const rest = text.slice(as.index);
                const from = new RegExp(String.raw`\bFROM\s+(?<base>${QN})`, "i").exec(rest);
                target.ctas = {
                    base: from ? parseName(from.groups.base) : null,
                    selectStar: new RegExp(String.raw`^AS\s*\(?\s*SELECT\s+(?:DISTINCT\s+)?(?:${IDENT}\s*\.\s*)?\*\s+FROM\b`, "i").test(rest),
                };
            }
        }
        return target;
    }
    if (TRIGGER_START.test(text)) {
        const header = text.split(/\b(?:DECLARE|BEGIN|COMPOUND\s+TRIGGER|CALL)\b/i)[0];
        const m = TRIGGER_ON.exec(header);
        if (m) return { kind: "CREATE TRIGGER", ...parseName(m.groups.target) };
    }
    return null;
}

const sameObject = (a, b) =>
    a.name.toUpperCase() === b.name.toUpperCase() &&
    (!a.schema || !b.schema || a.schema.toUpperCase() === b.schema.toUpperCase());

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function mentions(text, name) {
    const quoted = new RegExp(`"${escapeRe(name)}"`);
    if (name !== name.toUpperCase()) return quoted.test(text);
    return quoted.test(text) || new RegExp(`(?<![A-Za-z0-9_$#])${escapeRe(name)}(?![A-Za-z0-9_$#])`, "i").test(text);
}
const display = (o) => (o.schema ? `${o.schema}.${o.name}` : o.name);

// ── Overrides ──

export function emptyOverrides() {
    return { found: false, include: [], exclude: [], extraPatterns: [], errors: [] };
}

/**
 * Parses migration-exclusions.json content. Never throws; problems are returned in `errors`.
 */
export function parseOverrides(json) {
    const result = { ...emptyOverrides(), found: true };
    let data;
    try {
        // Windows editors and PowerShell 5.1 often save UTF-8 with a byte-order mark
        data = JSON.parse(json.replace(/^\uFEFF/, ""));
    } catch (e) {
        result.errors.push(`${OVERRIDES_FILE} is not valid JSON: ${e.message}`);
        return result;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        result.errors.push(`${OVERRIDES_FILE} must contain a JSON object`);
        return result;
    }
    for (const key of ["include", "exclude", "extraPatterns"]) {
        if (data[key] !== undefined && !Array.isArray(data[key])) {
            result.errors.push(`"${key}" must be an array`);
            data[key] = [];
        }
    }
    for (const list of ["include", "exclude"]) {
        for (const [k, entry] of (data[list] || []).entries()) {
            if (!entry || typeof entry.name !== "string" || !entry.name.trim()) {
                result.errors.push(`${list}[${k}]: "name" is required`);
                continue;
            }
            if (!entry.reason) result.errors.push(`${list}[${k}] (${entry.name}): "reason" is required`);
            const parsed = parseName(entry.name.trim());
            result[list].push({ ...entry, ...parsed, action: list });
        }
    }
    for (const inc of result.include) {
        if (result.exclude.some((exc) => sameObject(inc, exc) && !!inc.schema === !!exc.schema)) {
            result.errors.push(`${display(inc)} is in both "include" and "exclude"`);
        }
    }
    for (const [k, entry] of (data.extraPatterns || []).entries()) {
        if (!entry || typeof entry.pattern !== "string") {
            result.errors.push(`extraPatterns[${k}]: "pattern" is required`);
            continue;
        }
        if (!["exclude", "flag"].includes(entry.tier)) {
            result.errors.push(`extraPatterns[${k}] (${entry.pattern}): "tier" must be "exclude" or "flag"`);
            continue;
        }
        if (!entry.reason) result.errors.push(`extraPatterns[${k}] (${entry.pattern}): "reason" is required`);
        try {
            result.extraPatterns.push({ ...entry, re: new RegExp(entry.pattern, "i") });
        } catch (e) {
            result.errors.push(`extraPatterns[${k}]: invalid regular expression: ${e.message}`);
        }
    }
    return result;
}

export async function loadOverrides(cwd) {
    const path = join(cwd, OVERRIDES_FILE);
    if (!existsSync(path)) return emptyOverrides();
    return parseOverrides(await readFile(path, "utf-8"));
}

// ── Analysis ──

/**
 * Finds excluded and flagged tables across all source files.
 * @param {{relPath: string, content: string}[]} files
 */
export function analyzeSources(files, overrides = emptyOverrides()) {
    const all = [];
    for (const f of files) {
        const { code, withStrings } = lex(f.content);
        for (const s of splitStatements(code, withStrings)) {
            s.relPath = f.relPath;
            s.target = detectTarget(s);
            all.push(s);
        }
    }
    const tableDefs = all.filter((s) => s.target?.kind === "CREATE TABLE");
    const usedOverrides = new Set();

    const candidates = [];
    for (const stmt of tableDefs) {
        const t = stmt.target;
        const override = [...overrides.include, ...overrides.exclude].find((o) => sameObject(o, t));
        const builtin = classifyName(t.name);
        const extra = overrides.extraPatterns.find((p) => p.re.test(t.name));
        if (!override && !builtin && !extra) continue;
        if (override) usedOverrides.add(override);

        const matches = [];
        if (builtin) matches.push({ ...builtin, source: "built-in" });
        if (extra) matches.push({ tier: extra.tier, rule: `/${extra.pattern}/`, category: extra.reason || "Project pattern", source: "project pattern" });
        const top = matches.length ? Math.max(...matches.map((m) => TIER_RANK[m.tier])) : 0;
        const best = matches.filter((m) => TIER_RANK[m.tier] === top);
        const c = {
            stmt,
            relPath: stmt.relPath,
            schema: t.schema,
            name: t.name,
            object: display(t),
            lines: [stmt.startLine, stmt.endLine],
            statement: t.ctas ? "CREATE TABLE … AS SELECT" : t.temporary ? `CREATE ${t.temporary} TEMPORARY TABLE` : "CREATE TABLE",
            tier: best[0]?.tier || null,
            rule: best.map((m) => `${m.tier === "exclude" ? "auto" : "flag"}: ${m.rule}`).join(" + "),
            category: best[0]?.category || "Override",
            evidence: [],
            override: override ? { action: override.action, reason: override.reason || "", by: override.by || "", date: override.date || "" } : null,
            dependants: [],
            references: [],
        };
        if (t.ctas?.base) c.evidence.push(`CTAS from ${display(t.ctas.base)}${t.ctas.selectStar ? " (SELECT *)" : ""}`);

        const base = t.ctas?.base;
        if (c.tier === "flag" && t.ctas?.selectStar && base && !sameObject(base, t) && tableDefs.some((d) => sameObject(d.target, base))) {
            c.tier = "exclude";
            c.category = "Copy of another table";
            c.rule = `promoted (CTAS SELECT * copy of ${display(base)}) from ${c.rule}`;
        }
        if (override) c.decision = override.action === "include" ? "included" : "excluded";
        else c.decision = c.tier === "exclude" ? "excluded" : "flagged";
        if (!override && c.decision === "excluded" && t.temporary) {
            c.decision = "flagged";
            c.keptBecause = `${t.temporary} TEMPORARY table — usually used by application code`;
        }
        candidates.push(c);
    }

    for (const c of candidates) {
        c.dependants = all.filter((s) => s !== c.stmt && s.target && s.target.kind !== "CREATE TABLE" && sameObject(s.target, c));
    }

    // Demote excluded tables that kept code still uses, until nothing changes.
    for (let changed = true; changed; ) {
        changed = false;
        const excludedStmts = new Set(
            candidates.filter((c) => c.decision === "excluded").flatMap((c) => [c.stmt, ...c.dependants]),
        );
        for (const c of candidates) {
            c.references = all.filter(
                (s) => s !== c.stmt && !c.dependants.includes(s) && !excludedStmts.has(s) && mentions(s.textWithStrings, c.name),
            );
            if (c.decision === "excluded" && !c.override && c.references.length) {
                c.decision = "flagged";
                c.keptBecause = `referenced by kept code: ${c.references.slice(0, 3).map(describeStmt).join("; ")}${c.references.length > 3 ? "; …" : ""}`;
                changed = true;
            }
        }
    }

    return buildReport(files, all, candidates, overrides, usedOverrides);
}

function describeStmt(s) {
    const kind = s.target?.kind || firstWords(s.text);
    return `${kind} at ${s.relPath}:${s.startLine}`;
}
function firstWords(text) {
    const m = /^\s*(CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PACKAGE\s+BODY|\w+)\s+[^\s(]+|\w+)/i.exec(text);
    return m ? m[1].replace(/\s+/g, " ") : "statement";
}

function buildReport(files, all, candidates, overrides, usedOverrides) {
    const pad = (n) => String(n).padStart(3, "0");
    const byFile = {};
    for (const f of files) {
        const rows = [];
        for (const c of candidates.filter((c) => c.decision === "excluded")) {
            const stmts = [c.stmt, ...c.dependants].filter((s) => s.relPath === f.relPath);
            for (const s of stmts) {
                const isDef = s === c.stmt;
                rows.push({
                    line: s.startLine,
                    object: c.object,
                    statement: isDef ? c.statement : s.target.kind,
                    sourceLines: [s.startLine, s.endLine],
                    reason: isDef ? c.category : `Depends on ${c.object}`,
                    rule: isDef ? (c.override ? `override: exclude — ${c.override.reason}` : c.rule) : "dependant",
                    evidence: isDef ? c.evidence.join("; ") : c.relPath === f.relPath ? "" : `${c.object} is defined in ${c.relPath}`,
                    warning: isDef && c.override && c.references.length
                        ? `Excluded by override but referenced by kept code: ${c.references.map(describeStmt).join("; ")}`
                        : undefined,
                });
            }
        }
        rows.sort((a, b) => a.line - b.line);
        const excluded = rows.map(({ line, ...r }, k) => ({ id: `EX-${pad(k + 1)}`, ...r }));

        const flagged = candidates
            .filter((c) => c.decision === "flagged" && c.relPath === f.relPath)
            .sort((a, b) => a.lines[0] - b.lines[0])
            .map((c, k) => ({
                id: `FL-${pad(k + 1)}`,
                object: c.object,
                sourceLines: c.lines,
                rule: c.rule,
                keptBecause: c.keptBecause || "ambiguous name — a person decides",
                usedBy: c.references.map(describeStmt),
                evidence: c.evidence.join("; "),
                dependants: c.dependants.map(describeStmt),
            }));

        const included = candidates
            .filter((c) => c.decision === "included" && c.relPath === f.relPath)
            .map((c) => ({ object: c.object, sourceLines: c.lines, rule: c.rule || "none", override: c.override }));

        if (excluded.length || flagged.length || included.length) {
            byFile[f.relPath] = {
                excluded,
                flagged,
                included,
                excludedObjects: candidates.filter((c) => c.decision === "excluded" && c.relPath === f.relPath).length,
            };
        }
    }

    const unmatched = [...overrides.include, ...overrides.exclude]
        .filter((o) => !usedOverrides.has(o))
        .map((o) => `${o.action}: ${display(o)} — no CREATE TABLE found in oracle-sql/`);

    const sum = (key) => Object.values(byFile).reduce((s, r) => s + (key === "excludedObjects" ? r.excludedObjects : r[key].length), 0);
    return {
        totals: {
            excludedObjects: sum("excludedObjects"),
            excludedStatements: sum("excluded"),
            flaggedObjects: sum("flagged"),
            overridesApplied: usedOverrides.size,
        },
        overrides: { file: OVERRIDES_FILE, found: overrides.found, errors: overrides.errors, unmatched },
        files: byFile,
        statementsScanned: all.length,
    };
}
