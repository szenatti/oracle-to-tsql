-- Test file: Oracle 12c+ features and silent semantic differences
-- Covers identity columns and sequence defaults, a pre-12c sequence trigger, a row-level
-- trigger, bare NUMBER and TIMESTAMP(9) precision, case- and trailing-space-sensitive keys,
-- UNIQUE on a nullable column, FETCH FIRST, conversion-error defaults, date arithmetic,
-- ADD_MONTHS and GREATEST edge cases, MERGE ... DELETE WHERE, SELECT ... FOR UPDATE,
-- a global temporary table, a database link behind a synonym, and a caller that
-- handles a subprogram's exception and carries on

-- ============================================================
-- 1. Tables: identity column, sequence default, precision, unique keys
-- ============================================================

CREATE TABLE customers (
    customer_id     NUMBER GENERATED ALWAYS AS IDENTITY,
    customer_code   VARCHAR2(20)  NOT NULL,   -- 'ABC' and 'abc' are different customers
    tax_file_number VARCHAR2(11),             -- optional, but unique when present
    credit_limit    NUMBER,                   -- no precision: holds values such as 1234.56
    last_login      TIMESTAMP(9),
    created_on      DATE DEFAULT SYSDATE NOT NULL,
    CONSTRAINT pk_customers PRIMARY KEY (customer_id),
    CONSTRAINT uq_customers_code UNIQUE (customer_code),
    CONSTRAINT uq_customers_tfn UNIQUE (tax_file_number)
);

CREATE SEQUENCE order_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE orders (
    order_id     NUMBER DEFAULT order_seq.NEXTVAL NOT NULL,
    customer_id  NUMBER NOT NULL,
    status       VARCHAR2(10) DEFAULT 'NEW' NOT NULL,
    amount       NUMBER(12,2),
    ordered_at   DATE DEFAULT SYSDATE NOT NULL,
    shipped_at   DATE,
    updated_by   VARCHAR2(128),
    CONSTRAINT pk_orders PRIMARY KEY (order_id),
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
    CONSTRAINT chk_orders_shipped CHECK (shipped_at IS NULL OR shipped_at >= ordered_at)
);

-- Pre-12c pattern: a BEFORE INSERT row trigger assigns the key from a sequence
CREATE SEQUENCE order_audit_seq;

CREATE TABLE order_audit (
    audit_id    NUMBER NOT NULL,
    order_id    NUMBER,
    old_status  VARCHAR2(10),
    new_status  VARCHAR2(10),
    changed_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT pk_order_audit PRIMARY KEY (audit_id)
);

CREATE OR REPLACE TRIGGER trg_order_audit_id
BEFORE INSERT ON order_audit
FOR EACH ROW
WHEN (NEW.audit_id IS NULL)
BEGIN
    :NEW.audit_id := order_audit_seq.NEXTVAL;
END;
/

-- Row-level trigger that reads :OLD and :NEW
CREATE OR REPLACE TRIGGER trg_orders_status
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status <> OLD.status)
BEGIN
    INSERT INTO order_audit (order_id, old_status, new_status)
    VALUES (:OLD.order_id, :OLD.status, :NEW.status);
END;
/

-- ============================================================
-- 2. Session-scoped staging and a remote table
-- ============================================================

CREATE GLOBAL TEMPORARY TABLE tmp_order_import (
    customer_code VARCHAR2(20),
    amount_text   VARCHAR2(40),
    ordered_text  VARCHAR2(20)
) ON COMMIT DELETE ROWS;

-- finance_link is an existing database link to the finance database
CREATE OR REPLACE SYNONYM fin_invoices FOR invoices@finance_link;

-- ============================================================
-- 3. Queries whose results change silently in SQL Server
-- ============================================================

-- Case-sensitive lookup: returns only the customer stored as 'abc'
SELECT customer_id FROM customers WHERE customer_code = 'abc';

-- Trailing spaces are significant for VARCHAR2: 'ABC ' does not match 'ABC'
SELECT COUNT(*) FROM customers WHERE customer_code = 'ABC ';

-- Oracle 12c row limiting: ties included, and a limit without ORDER BY
SELECT order_id, amount FROM orders ORDER BY amount DESC FETCH FIRST 5 ROWS WITH TIES;
SELECT order_id FROM orders FETCH FIRST 10 ROWS ONLY;

-- Date subtraction returns fractional days; + 1/24 adds one hour
SELECT order_id,
       shipped_at - ordered_at                  AS days_to_ship,
       ROUND((shipped_at - ordered_at) * 24, 1) AS hours_to_ship,
       ordered_at + 1/24                        AS sla_deadline
FROM   orders
WHERE  shipped_at IS NOT NULL;

-- Weekday number depends on NLS_TERRITORY (1 = Sunday for AMERICA)
SELECT order_id FROM orders WHERE TO_CHAR(ordered_at, 'D') IN ('1', '7');

-- Month-end arithmetic and NULL-sensitive GREATEST
SELECT customer_id,
       ADD_MONTHS(TRUNC(created_on, 'MM') - 1, 1) AS review_date,      -- stays on the last day of the month
       GREATEST(credit_limit, 1000)               AS effective_limit   -- NULL when credit_limit is NULL
FROM   customers;

-- Bulk load: a bad amount must fail, a bad date falls back to a default
INSERT INTO orders (customer_id, amount, ordered_at)
SELECT c.customer_id,
       TO_NUMBER(t.amount_text),
       TO_DATE(t.ordered_text DEFAULT '1900-01-01' ON CONVERSION ERROR, 'YYYY-MM-DD')
FROM   tmp_order_import t
JOIN   customers c ON c.customer_code = t.customer_code;

-- ============================================================
-- 4. MERGE with a conditional update and DELETE WHERE
-- ============================================================

MERGE INTO orders o
USING (SELECT order_id, invoice_status FROM fin_invoices) src
ON (o.order_id = src.order_id)
WHEN MATCHED THEN
    UPDATE SET o.status = src.invoice_status, o.updated_by = USER
    WHERE o.status <> 'CANCELLED'
    DELETE WHERE o.status = 'VOID';

-- ============================================================
-- 5. Pessimistic locking
-- ============================================================

-- Lock one order, failing at once if another session holds it
DECLARE
    v_amount orders.amount%TYPE;
BEGIN
    SELECT amount INTO v_amount FROM orders WHERE order_id = 42 FOR UPDATE NOWAIT;
    UPDATE orders SET amount = v_amount * 1.1 WHERE order_id = 42;
    COMMIT;
END;
/

-- Work queue: claim new orders, skipping rows that other sessions have locked
DECLARE
    CURSOR c_new IS
        SELECT order_id FROM orders WHERE status = 'NEW' FOR UPDATE SKIP LOCKED;
BEGIN
    FOR r IN c_new LOOP
        UPDATE orders SET status = 'PICKED' WHERE CURRENT OF c_new;
    END LOOP;
    COMMIT;
END;
/

-- ============================================================
-- 6. Caller handles a subprogram's exception and carries on
-- ============================================================

-- The second UPDATE fails chk_orders_shipped when p_ship_date is before ordered_at.
-- Oracle keeps the first UPDATE (status = 'SHIPPED') because the caller handles the error.
CREATE OR REPLACE PROCEDURE ship_order (p_order_id IN NUMBER, p_ship_date IN DATE) IS
BEGIN
    UPDATE orders SET status = 'SHIPPED' WHERE order_id = p_order_id;
    UPDATE orders SET shipped_at = p_ship_date WHERE order_id = p_order_id;
END;
/

CREATE OR REPLACE PROCEDURE ship_picked_orders (p_ship_date IN DATE) IS
BEGIN
    FOR r IN (SELECT order_id FROM orders WHERE status = 'PICKED') LOOP
        BEGIN
            ship_order(r.order_id, p_ship_date);
        EXCEPTION
            WHEN OTHERS THEN
                INSERT INTO order_audit (order_id, old_status, new_status)
                VALUES (r.order_id, 'PICKED', 'SHIP_ERR');
        END;
    END LOOP;
    COMMIT;
END;
/
