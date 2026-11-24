-- Test file: backup, dated and leftover tables
-- Covers tables that should be commented out instead of created (backup suffixes and
-- prefixes, dated snapshots, scratch tables, an Oracle recycle-bin object, a CTAS copy
-- with an ambiguous name) and look-alikes that must be kept and flagged for a decision
-- (a global temporary table, a backup that a view still reads, ambiguous words, a
-- monthly table). Expected results are listed in samples/README.md.

-- ============================================================
-- 1. The live table
-- ============================================================

CREATE TABLE shipments (
    shipment_id   NUMBER(10)    NOT NULL,
    carrier_code  VARCHAR2(10)  NOT NULL,
    status        VARCHAR2(10)  DEFAULT 'OPEN' NOT NULL,
    shipped_on    DATE,
    CONSTRAINT pk_shipments PRIMARY KEY (shipment_id)
);

CREATE INDEX ix_shipments_carrier ON shipments (carrier_code);

-- ============================================================
-- 2. Leftovers: should be commented out
-- ============================================================

-- Copy taken before the 2021 carrier clean-up (ticket OPS-118)
CREATE TABLE shipments_bak AS SELECT * FROM shipments;
CREATE INDEX ix_shipments_bak_carrier ON shipments_bak (carrier_code);
COMMENT ON TABLE shipments_bak IS 'Backup before carrier clean-up';
GRANT SELECT ON shipments_bak TO reporting_role;

-- Dated snapshot (YYYYMMDD) and a backup with a separated date after the word
CREATE TABLE shipments_20211014 AS SELECT * FROM shipments WHERE status = 'OPEN';
CREATE TABLE carriers_bkp_2021_10_14 (
    carrier_code  VARCHAR2(10) NOT NULL,
    carrier_name  VARCHAR2(100)
);
INSERT INTO carriers_bkp_2021_10_14 (carrier_code, carrier_name) VALUES ('DHL', 'DHL Express');

-- Scratch table used once for a data load
CREATE TABLE tmp_shipment_load (
    shipment_id  NUMBER(10),
    raw_line     VARCHAR2(4000)
);

-- Copy with an ambiguous name, made with SELECT * from a live table
CREATE TABLE shipments_new AS SELECT * FROM shipments;

-- Dropped table still in the recycle bin, captured by a schema export
CREATE TABLE "BIN$k1Jx9Q2pTgW5n8bQ==$0" (
    shipment_id  NUMBER(10)
);

-- ============================================================
-- 3. Look-alikes: must be kept and flagged
-- ============================================================

-- Global temporary table that the application uses every session
CREATE GLOBAL TEMPORARY TABLE tmp_shipment_cart (
    shipment_id  NUMBER(10),
    added_on     DATE
) ON COMMIT DELETE ROWS;

-- Backup that a report view still reads
CREATE TABLE shipments_old AS SELECT * FROM shipments;

CREATE OR REPLACE VIEW v_shipment_history AS
SELECT shipment_id, status, shipped_on FROM shipments
UNION ALL
SELECT shipment_id, status, shipped_on FROM shipments_old;

-- Ambiguous words: a live hold queue and an archive the purge job writes to
CREATE TABLE shipment_hold (
    shipment_id  NUMBER(10) NOT NULL,
    hold_reason  VARCHAR2(200)
);

CREATE TABLE shipments_archive (
    shipment_id  NUMBER(10) NOT NULL,
    archived_on  DATE DEFAULT SYSDATE
);

-- Monthly table (YYYYMM)
CREATE TABLE shipment_stats_202110 (
    carrier_code  VARCHAR2(10),
    shipments     NUMBER(10)
);

CREATE OR REPLACE PROCEDURE purge_shipments (p_before IN DATE) AS
BEGIN
    INSERT INTO shipments_archive (shipment_id, archived_on)
    SELECT shipment_id, SYSDATE FROM shipments WHERE shipped_on < p_before;

    DELETE FROM shipment_hold
     WHERE shipment_id IN (SELECT shipment_id FROM shipments WHERE shipped_on < p_before);

    DELETE FROM shipments WHERE shipped_on < p_before;
    COMMIT;
END purge_shipments;
/
