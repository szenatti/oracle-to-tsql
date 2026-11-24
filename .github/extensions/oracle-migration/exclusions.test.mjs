import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyName, analyzeSources, parseOverrides } from "./exclusions.mjs";

const tierOf = (name) => classifyName(name)?.tier ?? null;

test("names that are commented out automatically", () => {
    for (const name of [
        "ORDERS_BAK", "orders_bkp", "ORDERS_BACKUP", "ORDERS_BAK2", "ORDERS_BAK_1", "ORDERS_OLD", "ORDERS_COPY_1",
        "BAK_ORDERS", "TMP_ORDERS", "ZZ_ORDERS",
        "ORDERS_20211014", "ORDERS_14102021", "ORDERS_10142021", "ORDERS_14OCT2021", "ORDERS_2021_10_14",
        "ORDERS_14_OCT_2021", "ORDERS_20211014_1530", "ORDERS_202110141530", "ORDERS_20211014_BAK", "ORDERS_20211014_V2",
        "BIN$k1Jx9Q2pTgW5n8bQ==$0", "SYS_EXPORT_SCHEMA_01", "MLOG$_ORDERS", "PLAN_TABLE",
    ]) {
        assert.equal(tierOf(name), "exclude", name);
    }
});

test("ambiguous names are only flagged", () => {
    for (const name of [
        "ORDERS_NEW", "ORDER_HOLD", "ORDERS_ARCHIVE", "SENSOR_TEMP", "ORDERS_COPY", "X_PRODUCT_SUPPLIER", "TEMP_ORDERS",
        "SALES_202110", "SALES_2021", "SALES_OCT2021", "SALES_Q1_2021", "SALES_2021Q1", "SALES_FY21", "SALES_2021_10",
        "ORDERS_2", "ORDERS_01", "ORDERS_V2", "ORDERSBAK", "ORDERS20211014", "ERR$_ORDERS",
    ]) {
        assert.equal(tierOf(name), "flag", name);
    }
});

test("ordinary names and digit codes are left alone", () => {
    for (const name of [
        "ORDERS", "ORDER_LINES", "OLD", "HOUSEHOLD", "THRESHOLD", "FEEDBACK",
        "ACCOUNT_10000001", "ORDERS_12345678", "COUNTRY_ISO_3166", "ROUTE_66",
    ]) {
        assert.equal(tierOf(name), null, name);
    }
});

const run = (sql, overrides) => analyzeSources([{ relPath: "t.sql", content: sql }], overrides);
const decisions = (r) => {
    const f = r.files["t.sql"] || { excluded: [], flagged: [], included: [] };
    return {
        excluded: [...new Set(f.excluded.map((e) => e.object))],
        flagged: f.flagged.map((e) => e.object),
        included: f.included.map((e) => e.object),
    };
};

test("dynamic SQL keeps a table, a comment does not", () => {
    const sql = `
CREATE TABLE a_bak (id NUMBER);
CREATE TABLE b_bak (id NUMBER);
-- old report read a_bak
CREATE OR REPLACE PROCEDURE p AS
BEGIN
    EXECUTE IMMEDIATE 'DELETE FROM b_bak';
END;
/`;
    assert.deepEqual(decisions(run(sql)), { excluded: ["A_BAK"], flagged: ["B_BAK"], included: [] });
});

test("a chain of copies is kept when the last copy is still used", () => {
    const sql = `
CREATE TABLE orders (id NUMBER);
CREATE TABLE orders_bak AS SELECT * FROM orders;
CREATE TABLE orders_bak2 AS SELECT * FROM orders_bak;
CREATE VIEW v AS SELECT id FROM orders_bak2;`;
    assert.deepEqual(decisions(run(sql)).flagged, ["ORDERS_BAK", "ORDERS_BAK2"]);
});

test("overrides win over the patterns and are audited", () => {
    const overrides = parseOverrides(JSON.stringify({
        include: [{ name: "HR.ORDERS_BAK", reason: "Still loaded nightly" }],
        exclude: [{ name: "cust_load", reason: "One-off 2019 load" }, { name: "MISSING_TABLE", reason: "x" }],
        extraPatterns: [{ pattern: "_CR[0-9]{4,}$", tier: "exclude", reason: "Change-request copy" }],
    }));
    assert.deepEqual(overrides.errors, []);
    const r = run(`
CREATE TABLE hr.orders_bak (id NUMBER);
CREATE TABLE cust_load (id NUMBER);
CREATE TABLE orders_cr1234 (id NUMBER);`, overrides);
    assert.deepEqual(decisions(r), { excluded: ["CUST_LOAD", "ORDERS_CR1234"], flagged: [], included: ["HR.ORDERS_BAK"] });
    assert.equal(r.totals.overridesApplied, 2);
    assert.match(r.overrides.unmatched[0], /MISSING_TABLE/);
});

test("invalid override entries are reported, not thrown", () => {
    const o = parseOverrides(JSON.stringify({
        include: [{ name: "A" }],
        exclude: [{ name: "A", reason: "r" }],
        extraPatterns: [{ pattern: "(", tier: "exclude", reason: "r" }, { pattern: "X", tier: "auto", reason: "r" }],
    }));
    assert.equal(o.errors.length, 4);
    assert.equal(parseOverrides("{ not json").errors.length, 1);
    assert.equal(parseOverrides("null").errors.length, 1);
    assert.deepEqual(parseOverrides('{"include": {}}').errors, ['"include" must be an array']);
    assert.deepEqual(parseOverrides('\uFEFF{"include": []}').errors, []);
});

test("sample 07 gives the documented results", () => {
    const path = fileURLToPath(new URL("../../../samples/07_backup_and_dated_tables.sql", import.meta.url));
    const r = analyzeSources([{ relPath: "t.sql", content: readFileSync(path, "utf-8") }]);
    const d = decisions(r);
    assert.deepEqual(d.excluded, [
        "SHIPMENTS_BAK", "SHIPMENTS_20211014", "CARRIERS_BKP_2021_10_14", "TMP_SHIPMENT_LOAD", "SHIPMENTS_NEW",
        "BIN$k1Jx9Q2pTgW5n8bQ==$0",
    ]);
    assert.deepEqual(d.flagged, ["TMP_SHIPMENT_CART", "SHIPMENTS_OLD", "SHIPMENT_HOLD", "SHIPMENTS_ARCHIVE", "SHIPMENT_STATS_202110"]);
    const bak = r.files["t.sql"].excluded.filter((e) => e.object === "SHIPMENTS_BAK").map((e) => e.statement);
    assert.deepEqual(bak, ["CREATE TABLE … AS SELECT", "CREATE INDEX", "COMMENT ON TABLE", "GRANT"]);
    assert.equal(r.files["t.sql"].excluded.at(-1).id, "EX-010");
});
