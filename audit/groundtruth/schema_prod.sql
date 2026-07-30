--
-- PostgreSQL database dump
--

\restrict w9uxI0xxWhQrHx9fcxxQlAxWI6SdG2XGJ6pgmJHc039oX9JJmb4esQ5jlbbwKwy

-- Dumped from database version 17.10 (9f6157c)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgboss; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgboss;


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: job_state; Type: TYPE; Schema: pgboss; Owner: -
--

CREATE TYPE pgboss.job_state AS ENUM (
    'created',
    'retry',
    'active',
    'completed',
    'cancelled',
    'failed'
);


--
-- Name: create_queue(text, json); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.create_queue(queue_name text, options json) RETURNS void
    LANGUAGE plpgsql
    AS $_$
    DECLARE
      table_name varchar := 'j' || encode(sha224(queue_name::bytea), 'hex');
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
      INSERT INTO pgboss.queue (
        name,
        policy,
        retry_limit,
        retry_delay,
        retry_backoff,
        expire_seconds,
        retention_minutes,
        dead_letter,
        partition_name
      )
      VALUES (
        queue_name,
        options->>'policy',
        (options->>'retryLimit')::int,
        (options->>'retryDelay')::int,
        (options->>'retryBackoff')::bool,
        (options->>'expireInSeconds')::int,
        (options->>'retentionMinutes')::int,
        options->>'deadLetter',
        table_name
      )
      ON CONFLICT DO NOTHING
      RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', table_name);

      EXECUTE format('ALTER TABLE pgboss.%1$I ADD PRIMARY KEY (name, id)', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i1 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''created'' AND policy = ''short''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i2 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''active'' AND policy = ''singleton''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i3 ON pgboss.%1$I (name, state, COALESCE(singleton_key, '''')) WHERE state <= ''active'' AND policy = ''stately''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i4 ON pgboss.%1$I (name, singleton_on, COALESCE(singleton_key, '''')) WHERE state <> ''cancelled'' AND singleton_on IS NOT NULL', table_name);
      EXECUTE format('CREATE INDEX %1$s_i5 ON pgboss.%1$I (name, start_after) INCLUDE (priority, created_on, id) WHERE state < ''active''', table_name);

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', table_name, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', table_name, queue_name);
    END;
    $_$;


--
-- Name: delete_queue(text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.delete_queue(queue_name text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      table_name varchar;
    BEGIN
      WITH deleted as (
        DELETE FROM pgboss.queue
        WHERE name = queue_name
        RETURNING partition_name
      )
      SELECT partition_name from deleted INTO table_name;

      EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', table_name);
    END;
    $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: archive; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.archive (
    id uuid NOT NULL,
    name text NOT NULL,
    priority integer NOT NULL,
    data jsonb,
    state pgboss.job_state NOT NULL,
    retry_limit integer NOT NULL,
    retry_count integer NOT NULL,
    retry_delay integer NOT NULL,
    retry_backoff boolean NOT NULL,
    start_after timestamp with time zone NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval NOT NULL,
    created_on timestamp with time zone NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    archived_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text
)
PARTITION BY LIST (name);


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'intake.poll'::text))
);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = '__pgboss__send-it'::text))
);


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'bizdev.renewals'::text))
);


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'portal.claims.reminders'::text))
);


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'ar.schedules'::text))
);


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'attendance.alerts'::text))
);


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'pnl.allocate.cron'::text))
);


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'cashflow.snapshot'::text))
);


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'xero.ar.sync'::text))
);


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'xero.bills.sync'::text))
);


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'pnl.allocate'::text))
);


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = 'ar.dunning'::text))
);


--
-- Name: queue; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue (
    name text NOT NULL,
    policy text,
    retry_limit integer,
    retry_delay integer,
    retry_backoff boolean,
    expire_seconds integer,
    retention_minutes integer,
    dead_letter text,
    partition_name text,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedule; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.schedule (
    name text NOT NULL,
    cron text NOT NULL,
    timezone text,
    data jsonb,
    options jsonb,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.subscription (
    event text NOT NULL,
    name text NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: version; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.version (
    version integer NOT NULL,
    maintained_on timestamp with time zone,
    cron_on timestamp with time zone,
    monitored_on timestamp with time zone
);


--
-- Name: asset_issuances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_issuances (
    id integer NOT NULL,
    employee_id text NOT NULL,
    category text DEFAULT 'Uniform'::text,
    item_desc text NOT NULL,
    issue_date date NOT NULL,
    replacement_due date,
    cost numeric(12,2),
    returned boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: asset_issuances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.asset_issuances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: asset_issuances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.asset_issuances_id_seq OWNED BY public.asset_issuances.id;


--
-- Name: attendance_alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_alert_rules (
    id integer NOT NULL,
    project_id text,
    rule_type text NOT NULL,
    threshold numeric(10,2),
    recipients jsonb DEFAULT '[]'::jsonb,
    channels jsonb DEFAULT '["email"]'::jsonb,
    active boolean DEFAULT true
);


--
-- Name: attendance_alert_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_alert_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_alert_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_alert_rules_id_seq OWNED BY public.attendance_alert_rules.id;


--
-- Name: attendance_alerts_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_alerts_log (
    id integer NOT NULL,
    rule_id integer,
    employee_id text,
    project_id text,
    alert_date date,
    channel text,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: attendance_alerts_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_alerts_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_alerts_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_alerts_log_id_seq OWNED BY public.attendance_alerts_log.id;


--
-- Name: attendance_parser_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_parser_profiles (
    id integer NOT NULL,
    client_id text,
    contract_id text,
    name text NOT NULL,
    format_type text DEFAULT 'csv'::text NOT NULL,
    input_mode text DEFAULT 'full_ledger'::text NOT NULL,
    column_map jsonb DEFAULT '{}'::jsonb,
    date_format text DEFAULT 'DD/MM/YYYY'::text,
    employee_match_strategy text DEFAULT 'exact_id'::text,
    sender_pattern text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: attendance_parser_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_parser_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_parser_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_parser_profiles_id_seq OWNED BY public.attendance_parser_profiles.id;


--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_records (
    id integer NOT NULL,
    employee_id text NOT NULL,
    date date NOT NULL,
    status text NOT NULL,
    marked_by text NOT NULL,
    remarks text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    site text,
    dept text,
    project_id text,
    source text DEFAULT 'manual'::text,
    intake_message_id integer,
    hours numeric(8,2),
    ot_hours numeric(8,2),
    raw_row jsonb,
    CONSTRAINT attendance_records_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'unexcused'::text, 'half_day'::text, 'leave'::text, 'ot'::text])))
);


--
-- Name: attendance_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_records_id_seq OWNED BY public.attendance_records.id;


--
-- Name: banks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banks (
    id integer NOT NULL,
    name text NOT NULL,
    short_name text,
    swift_code text,
    is_hbl boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: banks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.banks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: banks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.banks_id_seq OWNED BY public.banks.id;


--
-- Name: bd_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bd_leads (
    id integer NOT NULL,
    company text NOT NULL,
    contact_name text,
    email text,
    phone text,
    source text,
    industry text,
    est_headcount integer,
    stage text DEFAULT 'cold'::text NOT NULL,
    owner_email text,
    next_action_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bd_leads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bd_leads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bd_leads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bd_leads_id_seq OWNED BY public.bd_leads.id;


--
-- Name: bd_outreach_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bd_outreach_log (
    id integer NOT NULL,
    lead_id integer,
    channel text NOT NULL,
    direction text DEFAULT 'outbound'::text,
    subject text,
    sent_at timestamp with time zone DEFAULT now(),
    outcome text
);


--
-- Name: bd_outreach_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bd_outreach_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bd_outreach_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bd_outreach_log_id_seq OWNED BY public.bd_outreach_log.id;


--
-- Name: bd_renewals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bd_renewals (
    id integer NOT NULL,
    contract_id text NOT NULL,
    renewal_date date NOT NULL,
    reminder_90_sent boolean DEFAULT false,
    reminder_60_sent boolean DEFAULT false,
    reminder_30_sent boolean DEFAULT false,
    status text DEFAULT 'upcoming'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: bd_renewals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bd_renewals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bd_renewals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bd_renewals_id_seq OWNED BY public.bd_renewals.id;


--
-- Name: benefit_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benefit_policies (
    id integer NOT NULL,
    contract_id text NOT NULL,
    benefit_type text NOT NULL,
    cap_amount numeric(12,2),
    cap_period text DEFAULT 'annual'::text,
    cycle_anchor text DEFAULT 'employment_date'::text,
    effective_from date DEFAULT CURRENT_DATE,
    effective_to date
);


--
-- Name: benefit_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.benefit_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: benefit_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.benefit_policies_id_seq OWNED BY public.benefit_policies.id;


--
-- Name: benefit_utilization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benefit_utilization (
    id integer NOT NULL,
    employee_id text NOT NULL,
    contract_id text,
    benefit_type text DEFAULT 'medical'::text NOT NULL,
    cycle_start date NOT NULL,
    cycle_end date NOT NULL,
    cap_amount numeric(12,2) NOT NULL,
    used_amount numeric(12,2) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: benefit_utilization_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.benefit_utilization_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: benefit_utilization_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.benefit_utilization_id_seq OWNED BY public.benefit_utilization.id;


--
-- Name: bill_approval_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_approval_steps (
    id integer NOT NULL,
    bill_id text NOT NULL,
    step_number integer NOT NULL,
    approver_email text NOT NULL,
    approver_name text,
    token_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    comment text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bill_approval_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_approval_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_approval_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_approval_steps_id_seq OWNED BY public.bill_approval_steps.id;


--
-- Name: bill_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_documents (
    id integer NOT NULL,
    bill_id text NOT NULL,
    file_id integer,
    ocr_status text DEFAULT 'pending'::text,
    ocr_json jsonb,
    ocr_confidence numeric(5,4),
    verified_by text,
    verified_at timestamp with time zone
);


--
-- Name: bill_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_documents_id_seq OWNED BY public.bill_documents.id;


--
-- Name: bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bills (
    id text NOT NULL,
    type text,
    vendor text,
    date date,
    client text,
    contract_id text,
    site text,
    purpose text,
    bill_type text,
    amount numeric DEFAULT 0,
    gst numeric DEFAULT 0,
    total numeric DEFAULT 0,
    status text DEFAULT 'Draft'::text,
    note text,
    items jsonb,
    image_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    contract text,
    bu text,
    invoice_no text,
    created_by text,
    billable boolean DEFAULT true,
    period_month integer,
    period_year integer,
    paid_at timestamp with time zone,
    paid_by text,
    bill_category text DEFAULT 'official'::text,
    payment_method text,
    payment_account text,
    wht_amount numeric(12,2) DEFAULT 0,
    gst_exempt boolean DEFAULT false,
    project_id text,
    budget_line_id integer,
    match_status text DEFAULT 'unmatched'::text,
    matched_by text,
    matched_at timestamp with time zone,
    xero_invoice_id text,
    xero_synced_at timestamp with time zone,
    tracking_category text,
    import_status text,
    invoiced_in text,
    vendor_bank_account text,
    vendor_bank_name text,
    xero_contact_name text,
    vendor_bank_code text,
    excluded_from_sync boolean DEFAULT false,
    approval_status text DEFAULT 'draft'::text,
    approval_submitted_by text,
    approval_submitted_at timestamp with time zone,
    approval_focal_account text,
    approval_completed_at timestamp with time zone
);


--
-- Name: cashflow_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashflow_snapshots (
    id integer NOT NULL,
    week_start date NOT NULL,
    expected_inflows numeric(16,2) DEFAULT 0,
    committed_outflows numeric(16,2) DEFAULT 0,
    net_position numeric(16,2) DEFAULT 0,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cashflow_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cashflow_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cashflow_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cashflow_snapshots_id_seq OWNED BY public.cashflow_snapshots.id;


--
-- Name: claim_manual_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_manual_overrides (
    id integer NOT NULL,
    employee_id text NOT NULL,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    ot1_hours numeric(8,2) DEFAULT 0,
    ot2_hours numeric(8,2) DEFAULT 0,
    ot3_hours numeric(8,2) DEFAULT 0,
    expense_amount numeric(12,2) DEFAULT 0,
    medical_amount numeric(12,2) DEFAULT 0,
    mode text NOT NULL,
    reason text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    before_snapshot jsonb,
    after_snapshot jsonb,
    dry_run boolean DEFAULT false,
    applied boolean DEFAULT true
);


--
-- Name: claim_manual_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claim_manual_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_manual_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claim_manual_overrides_id_seq OWNED BY public.claim_manual_overrides.id;


--
-- Name: claims_approval_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims_approval_cycles (
    id integer NOT NULL,
    cycle_month date NOT NULL,
    client_id integer,
    manager_email text NOT NULL,
    manager_name text,
    sent_at timestamp with time zone,
    responded_at timestamp with time zone,
    response text,
    claims_count integer DEFAULT 0,
    total_value numeric(12,2) DEFAULT 0,
    reminder_sent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: claims_approval_cycles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claims_approval_cycles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claims_approval_cycles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claims_approval_cycles_id_seq OWNED BY public.claims_approval_cycles.id;


--
-- Name: claims_inbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims_inbox (
    id integer NOT NULL,
    received_at timestamp with time zone NOT NULL,
    sender_email text NOT NULL,
    subject text,
    message_id text,
    message_hash text NOT NULL,
    raw_body text,
    parsed_data jsonb,
    employee_id text,
    claim_month date,
    claim_type text,
    ot_hours_1x numeric(6,2),
    ot_hours_2x numeric(6,2),
    ot_hours_3x numeric(6,2),
    ot_hours numeric(6,2),
    claim_amount numeric(12,2),
    line_manager_name text,
    line_manager_email text,
    attachment_filename text,
    status text DEFAULT 'PENDING'::text,
    approval_cycle_id integer,
    created_at timestamp with time zone DEFAULT now(),
    synopsis text,
    body_parsed boolean DEFAULT false,
    match_remark text,
    employee_name text,
    payroll_month integer,
    payroll_year integer,
    pushed_at timestamp with time zone
);


--
-- Name: claims_inbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claims_inbox_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claims_inbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claims_inbox_id_seq OWNED BY public.claims_inbox.id;


--
-- Name: client_business_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_business_units (
    id integer NOT NULL,
    client_id text NOT NULL,
    bu_code character varying(50) NOT NULL,
    bu_name character varying(200) NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_business_units_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_business_units_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_business_units_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_business_units_id_seq OWNED BY public.client_business_units.id;


--
-- Name: client_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_departments (
    id integer NOT NULL,
    client_id text NOT NULL,
    bu_id integer,
    location_id integer,
    name character varying(200) NOT NULL,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_departments_id_seq OWNED BY public.client_departments.id;


--
-- Name: client_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_invoices (
    id integer NOT NULL,
    invoice_number text NOT NULL,
    client text NOT NULL,
    contract text,
    period_month integer,
    period_year integer,
    po_number text,
    due_date date,
    line_items jsonb DEFAULT '[]'::jsonb,
    subtotal numeric(14,2) DEFAULT 0,
    service_charges numeric(12,2) DEFAULT 0,
    sales_tax numeric(12,2) DEFAULT 0,
    wht numeric(12,2) DEFAULT 0,
    grand_total numeric(14,2) DEFAULT 0,
    notes text,
    status text DEFAULT 'Draft'::text,
    xero_invoice_id text,
    xero_url text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    po_id integer,
    contract_id text,
    region text,
    bu text,
    sent_at timestamp with time zone,
    payment_received_at timestamp with time zone,
    dunning_stage text
);


--
-- Name: client_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_invoices_id_seq OWNED BY public.client_invoices.id;


--
-- Name: client_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_locations (
    id integer NOT NULL,
    client_id text NOT NULL,
    contract_id text,
    name character varying(200) NOT NULL,
    province character varying(100),
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_locations_id_seq OWNED BY public.client_locations.id;


--
-- Name: client_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_otps (
    id integer NOT NULL,
    email text NOT NULL,
    otp text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_otps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_otps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_otps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_otps_id_seq OWNED BY public.client_otps.id;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id text NOT NULL,
    name text NOT NULL,
    hq text,
    ntn text,
    strn text,
    industry text,
    contacts jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    asil_bu text
);


--
-- Name: cmms_client_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cmms_client_users (
    id integer NOT NULL,
    email text NOT NULL,
    name text,
    site text NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cmms_client_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cmms_client_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cmms_client_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cmms_client_users_id_seq OWNED BY public.cmms_client_users.id;


--
-- Name: cmms_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cmms_sites (
    id integer NOT NULL,
    site_name text NOT NULL,
    client_name text,
    categories text[] DEFAULT '{}'::text[] NOT NULL,
    default_assignee_email text,
    default_assignee_name text,
    cc_email text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cmms_sites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cmms_sites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cmms_sites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cmms_sites_id_seq OWNED BY public.cmms_sites.id;


--
-- Name: contract_bid_actuals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_bid_actuals (
    id integer NOT NULL,
    contract_id text NOT NULL,
    bid_item_id integer NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    actual_qty numeric(10,2) DEFAULT 0,
    actual_unit_price numeric(12,2) DEFAULT 0,
    actual_total numeric(14,2) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: contract_bid_actuals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_bid_actuals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_bid_actuals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_bid_actuals_id_seq OWNED BY public.contract_bid_actuals.id;


--
-- Name: contract_bid_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_bid_items (
    id integer NOT NULL,
    contract_id text NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'Consumable'::text,
    unit text DEFAULT 'unit'::text,
    bid_qty numeric(10,2) DEFAULT 0,
    bid_unit_price numeric(12,2) DEFAULT 0,
    bid_total numeric(14,2) DEFAULT 0,
    frequency text DEFAULT 'Monthly'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: contract_bid_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_bid_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_bid_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_bid_items_id_seq OWNED BY public.contract_bid_items.id;


--
-- Name: contract_budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_budget_lines (
    id integer NOT NULL,
    contract_id text NOT NULL,
    project_id text,
    category text NOT NULL,
    name text NOT NULL,
    monthly_cap numeric(14,2),
    annual_cap numeric(14,2),
    effective_from date,
    effective_to date,
    active boolean DEFAULT true
);


--
-- Name: contract_budget_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_budget_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_budget_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_budget_lines_id_seq OWNED BY public.contract_budget_lines.id;


--
-- Name: contract_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_policies (
    id integer NOT NULL,
    contract_id text NOT NULL,
    project_id text,
    billing_model text DEFAULT 'headcount_rate'::text NOT NULL,
    attendance_input_mode text DEFAULT 'full_ledger'::text NOT NULL,
    standard_month_days integer DEFAULT 30,
    ot_allowed boolean DEFAULT true,
    ot_monthly_cap_hours numeric(10,2),
    ot_client_managed boolean DEFAULT false,
    ot_divisor_days integer DEFAULT 26,
    ot_divisor_hours integer DEFAULT 8,
    service_charge_pct numeric(6,4) DEFAULT 0.18,
    medical_annual_cap numeric(12,2),
    medical_cycle_anchor text DEFAULT 'employment_date'::text,
    credit_days integer DEFAULT 30,
    invoice_frequency text DEFAULT 'monthly'::text,
    invoice_day_of_month integer DEFAULT 1,
    po_required boolean DEFAULT false,
    challans_required jsonb DEFAULT '[]'::jsonb,
    reminder_cadence jsonb DEFAULT '[]'::jsonb,
    edu_cess_enabled boolean DEFAULT false,
    bonus_accrual_months integer DEFAULT 12,
    gratuity_accrual_months integer DEFAULT 12,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    created_at timestamp with time zone DEFAULT now(),
    income_tax_wht_pct numeric(5,2),
    use_calendar_working_days boolean DEFAULT true,
    working_days_override integer,
    sales_tax_rate numeric(6,4),
    sales_tax_exempt boolean DEFAULT false
);


--
-- Name: contract_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_policies_id_seq OWNED BY public.contract_policies.id;


--
-- Name: contract_rate_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_rate_cards (
    id integer NOT NULL,
    contract_id text NOT NULL,
    project_id text,
    role_title text,
    billing_basis text DEFAULT 'monthly'::text,
    bill_rate numeric(12,2),
    cost_rate numeric(12,2),
    effective_from date NOT NULL,
    effective_to date
);


--
-- Name: contract_rate_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_rate_cards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_rate_cards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_rate_cards_id_seq OWNED BY public.contract_rate_cards.id;


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id text NOT NULL,
    client_id text,
    contract_name text,
    location text,
    service_type text,
    headcount integer DEFAULT 0,
    status text DEFAULT 'Active'::text,
    start_date date,
    end_date date,
    costs jsonb DEFAULT '{}'::jsonb,
    financials jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    end_of_service text DEFAULT 'Gratuity'::text,
    region_province text,
    allied_focal_email text,
    client_focal_name text,
    client_focal_email text,
    monthly_spend_cap numeric(14,2),
    total_liability_cap numeric(14,2),
    credit_days integer DEFAULT 30
);


--
-- Name: cost_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_allocations (
    id integer NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    contract_id text,
    project_id text,
    budget_line_id integer,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cost_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cost_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cost_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cost_allocations_id_seq OWNED BY public.cost_allocations.id;


--
-- Name: delivery_challans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_challans (
    id text NOT NULL,
    bill_id text NOT NULL,
    challan_no text,
    client text,
    vendor text,
    contract text,
    site text,
    items jsonb DEFAULT '[]'::jsonb,
    total numeric(12,2) DEFAULT 0,
    delivery_date date,
    notes text,
    printed_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dunning_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dunning_log (
    id integer NOT NULL,
    invoice_id text,
    stage text NOT NULL,
    sent_at timestamp with time zone DEFAULT now(),
    recipient text
);


--
-- Name: dunning_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dunning_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dunning_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dunning_log_id_seq OWNED BY public.dunning_log.id;


--
-- Name: employee_advances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_advances (
    id integer NOT NULL,
    employee_id text NOT NULL,
    type text DEFAULT 'Advance'::text,
    reason text,
    total_amount numeric(12,2) NOT NULL,
    installments integer DEFAULT 1,
    installment_amt numeric(12,2) NOT NULL,
    paid_installments integer DEFAULT 0,
    remaining numeric(12,2) NOT NULL,
    status text DEFAULT 'Active'::text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_advances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_advances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_advances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_advances_id_seq OWNED BY public.employee_advances.id;


--
-- Name: employee_change_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_change_requests (
    id integer NOT NULL,
    employee_id text,
    employee_name text,
    field_name text,
    field_label text,
    old_value text,
    new_value text,
    status text DEFAULT 'Pending'::text,
    submitted_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by text,
    notes text
);


--
-- Name: employee_change_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_change_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_change_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_change_requests_id_seq OWNED BY public.employee_change_requests.id;


--
-- Name: employee_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_claims (
    id integer NOT NULL,
    intake_message_id integer,
    employee_id text,
    claim_type text NOT NULL,
    period_month integer,
    period_year integer,
    claimed_items jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'received'::text NOT NULL,
    focal_email text,
    focal_token_hash text,
    focal_approved_at timestamp with time zone,
    focal_rejected_at timestamp with time zone,
    compliance_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    focal_comment text,
    payroll_run_id integer,
    contract_id text
);


--
-- Name: employee_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_claims_id_seq OWNED BY public.employee_claims.id;


--
-- Name: employee_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_documents (
    id integer NOT NULL,
    employee_id text NOT NULL,
    doc_type text NOT NULL,
    doc_name text,
    issue_date date,
    expiry_date date,
    issuing_authority text,
    doc_no text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_documents_id_seq OWNED BY public.employee_documents.id;


--
-- Name: employee_gratuity_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_gratuity_ledger (
    id integer NOT NULL,
    employee_id text NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    accrual numeric(12,2) DEFAULT 0,
    cumulative numeric(12,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_gratuity_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_gratuity_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_gratuity_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_gratuity_ledger_id_seq OWNED BY public.employee_gratuity_ledger.id;


--
-- Name: employee_leave_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_leave_balances (
    id integer NOT NULL,
    employee_id text NOT NULL,
    year integer NOT NULL,
    leave_type text NOT NULL,
    entitled numeric NOT NULL,
    used numeric DEFAULT 0 NOT NULL
);


--
-- Name: employee_leave_balances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_leave_balances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_leave_balances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_leave_balances_id_seq OWNED BY public.employee_leave_balances.id;


--
-- Name: employee_leaves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_leaves (
    id integer NOT NULL,
    employee_id text NOT NULL,
    leave_type text NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    days numeric NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_via text DEFAULT 'office'::text,
    internal_approver text,
    internal_decided_at timestamp with time zone,
    client_focal_email text,
    client_decided_at timestamp with time zone,
    action_token_hash text,
    created_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_leaves_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_leaves_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_leaves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_leaves_id_seq OWNED BY public.employee_leaves.id;


--
-- Name: employee_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_messages (
    id integer NOT NULL,
    employee_id text NOT NULL,
    channel text DEFAULT 'email'::text,
    subject text,
    body text,
    sender text,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_messages_id_seq OWNED BY public.employee_messages.id;


--
-- Name: employee_pf_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_pf_ledger (
    id integer NOT NULL,
    employee_id text NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    ee_contribution numeric(12,2) DEFAULT 0,
    er_contribution numeric(12,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    entry_type text DEFAULT 'monthly'::text,
    narration text,
    reference_no text,
    withdrawal_amount numeric(12,2) DEFAULT 0
);


--
-- Name: employee_pf_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_pf_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_pf_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_pf_ledger_id_seq OWNED BY public.employee_pf_ledger.id;


--
-- Name: employee_warnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_warnings (
    id integer NOT NULL,
    employee_id text NOT NULL,
    warning_type text DEFAULT 'written'::text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    issued_by text NOT NULL,
    issued_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'issued'::text NOT NULL,
    ack_file_id integer,
    ack_note text,
    acknowledged_at timestamp with time zone
);


--
-- Name: employee_warnings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_warnings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_warnings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_warnings_id_seq OWNED BY public.employee_warnings.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id text NOT NULL,
    bu text,
    active text DEFAULT 'Yes'::text,
    client text,
    client_bu text,
    dept text,
    designation text,
    location text,
    province text,
    name text NOT NULL,
    father_name text,
    mother_name text,
    cnic text,
    cnic_issue date,
    cnic_expiry date,
    place_of_birth text,
    eobi_no text,
    religion text,
    marital_status text,
    dob date,
    doj date,
    primary_contact text,
    emergency_contact text,
    email text,
    present_address text,
    permanent_address text,
    salary numeric DEFAULT 0,
    spouse_name text,
    spouse_age text,
    spouse_cnic text,
    child1_name text,
    child1_age text,
    child1_id text,
    child2_name text,
    child2_age text,
    child2_id text,
    medical_type text,
    medical_maternity text,
    total_medical_coverage numeric,
    bank_name text,
    bank_account text,
    account_title text,
    nok_name text,
    nok_relation text,
    nok_contact text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    contract_date date,
    insurance_policy_no text,
    id_card_status text DEFAULT 'Pending'::text,
    contract_name text,
    region text,
    contract_id text,
    last_working_day date,
    line_manager_name text,
    line_manager_email text,
    sessi_no text,
    shirt_size text,
    trouser_size text,
    safety_shoe_size text,
    last_ppe_issue_date date,
    last_uniform_issue_date date,
    gate_pass_expiry date,
    payroll_cycle_type text DEFAULT 'Monthly'::text,
    site text,
    project_id text,
    supervisor_email character varying(255),
    client_focal_emails text,
    claim_authority text,
    photo_file_id integer
);


--
-- Name: hcm_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hcm_users (
    id integer NOT NULL,
    google_id text NOT NULL,
    email text NOT NULL,
    name text,
    avatar text,
    role text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone DEFAULT now(),
    permissions jsonb
);


--
-- Name: hcm_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hcm_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hcm_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hcm_users_id_seq OWNED BY public.hcm_users.id;


--
-- Name: holiday_calendar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holiday_calendar (
    id integer NOT NULL,
    holiday_date date NOT NULL,
    name text NOT NULL,
    holiday_type text DEFAULT 'gazetted'::text NOT NULL,
    province text,
    ot_multiplier numeric(4,2) DEFAULT 3
);


--
-- Name: holiday_calendar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.holiday_calendar_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: holiday_calendar_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.holiday_calendar_id_seq OWNED BY public.holiday_calendar.id;


--
-- Name: inbox_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_rules (
    id integer NOT NULL,
    sender_pattern text NOT NULL,
    subject_pattern text,
    event_type text NOT NULL,
    client_id text,
    priority text DEFAULT 'normal'::text,
    auto_action text DEFAULT 'log_only'::text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inbox_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_rules_id_seq OWNED BY public.inbox_rules.id;


--
-- Name: intake_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intake_messages (
    id integer NOT NULL,
    channel text DEFAULT 'imap'::text NOT NULL,
    mailbox text,
    message_uid text,
    from_address text,
    subject text,
    received_at timestamp with time zone,
    body_text text,
    attachments jsonb DEFAULT '[]'::jsonb,
    classification text DEFAULT 'unknown'::text,
    status text DEFAULT 'new'::text NOT NULL,
    error text,
    ack_sent_at timestamp with time zone,
    ack_reference text,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: intake_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.intake_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intake_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.intake_messages_id_seq OWNED BY public.intake_messages.id;


--
-- Name: inventory_issuance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_issuance (
    id integer NOT NULL,
    item_id integer,
    employee_id text,
    employee_name text,
    quantity integer DEFAULT 1,
    issue_date date,
    expiry_date date,
    return_date date,
    status text DEFAULT 'Issued'::text,
    condition_out text DEFAULT 'New'::text,
    condition_in text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_issuance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_issuance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_issuance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_issuance_id_seq OWNED BY public.inventory_issuance.id;


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id integer NOT NULL,
    name text NOT NULL,
    category text,
    description text,
    unit text DEFAULT 'piece'::text,
    has_expiry boolean DEFAULT false,
    expiry_months integer,
    min_stock integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_items_id_seq OWNED BY public.inventory_items.id;


--
-- Name: inventory_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_stock (
    id integer NOT NULL,
    item_id integer,
    quantity integer NOT NULL,
    unit_cost numeric(12,2),
    supplier text,
    receipt_no text,
    po_number text,
    received_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_stock_id_seq OWNED BY public.inventory_stock.id;


--
-- Name: invoice_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_attachments (
    id integer NOT NULL,
    invoice_id text NOT NULL,
    attachment_type text NOT NULL,
    filing_id integer,
    file_id integer
);


--
-- Name: invoice_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_attachments_id_seq OWNED BY public.invoice_attachments.id;


--
-- Name: invoice_receipt_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_receipt_lines (
    id integer NOT NULL,
    receipt_id integer NOT NULL,
    invoice_id integer NOT NULL,
    cash_received numeric(14,2) DEFAULT 0,
    income_tax_wht numeric(14,2) DEFAULT 0,
    sales_tax_withheld_by_client numeric(14,2) DEFAULT 0,
    sales_tax_self_paid numeric(14,2) DEFAULT 0
);


--
-- Name: invoice_receipt_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_receipt_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_receipt_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_receipt_lines_id_seq OWNED BY public.invoice_receipt_lines.id;


--
-- Name: invoice_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_receipts (
    id integer NOT NULL,
    client text NOT NULL,
    receipt_date date NOT NULL,
    bank_ref text,
    total_cash numeric(14,2) DEFAULT 0,
    total_income_tax_wht numeric(14,2) DEFAULT 0,
    total_sales_tax_withheld numeric(14,2) DEFAULT 0,
    total_sales_tax_self_paid numeric(14,2) DEFAULT 0,
    posted_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoice_receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_receipts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_receipts_id_seq OWNED BY public.invoice_receipts.id;


--
-- Name: invoice_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_schedules (
    id integer NOT NULL,
    contract_id text NOT NULL,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    due_to_generate_date date,
    status text DEFAULT 'upcoming'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoice_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_schedules_id_seq OWNED BY public.invoice_schedules.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id text NOT NULL,
    client text NOT NULL,
    contract text,
    period text,
    po_number text,
    due_date date,
    payroll_ids jsonb DEFAULT '[]'::jsonb,
    bill_ids jsonb DEFAULT '[]'::jsonb,
    subtotal numeric(12,2) DEFAULT 0,
    svc_charges numeric(12,2) DEFAULT 0,
    sales_tax numeric(12,2) DEFAULT 0,
    wht numeric(12,2) DEFAULT 0,
    grand_total numeric(12,2) DEFAULT 0,
    status text DEFAULT 'Draft'::text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: maintenance_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_tickets (
    id text NOT NULL,
    site text NOT NULL,
    category text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    reported_by text NOT NULL,
    assigned_to text,
    is_minor_petty_cash boolean DEFAULT false,
    petty_cash_amount numeric DEFAULT 0,
    photo_file_id integer,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    due_date date,
    billable_to_client text DEFAULT 'tbd'::text,
    raised_via text DEFAULT 'staff'::text,
    cc_email text
);


--
-- Name: monthly_attendance_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_attendance_overrides (
    id integer NOT NULL,
    employee_id text NOT NULL,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    present_days numeric(6,2),
    ot2_hours numeric(8,2) DEFAULT 0,
    ot3_hours numeric(8,2) DEFAULT 0,
    opd numeric(12,2) DEFAULT 0,
    expense numeric(12,2) DEFAULT 0,
    arrears numeric(12,2) DEFAULT 0,
    special_allowance numeric(12,2) DEFAULT 0,
    fuel_mobile numeric(12,2) DEFAULT 0,
    other_deduction numeric(12,2) DEFAULT 0,
    source text DEFAULT 'monthly_hub_import'::text,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: monthly_attendance_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.monthly_attendance_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: monthly_attendance_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.monthly_attendance_overrides_id_seq OWNED BY public.monthly_attendance_overrides.id;


--
-- Name: onboarding_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_runs (
    id integer NOT NULL,
    contract_id text NOT NULL,
    lead_id integer,
    status text DEFAULT 'in_progress'::text,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);


--
-- Name: onboarding_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.onboarding_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: onboarding_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.onboarding_runs_id_seq OWNED BY public.onboarding_runs.id;


--
-- Name: onboarding_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_tasks (
    id integer NOT NULL,
    run_id integer NOT NULL,
    task_key text NOT NULL,
    task_label text NOT NULL,
    blocking boolean DEFAULT false,
    owner_email text,
    due_date date,
    status text DEFAULT 'pending'::text,
    completed_at timestamp with time zone
);


--
-- Name: onboarding_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.onboarding_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: onboarding_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.onboarding_tasks_id_seq OWNED BY public.onboarding_tasks.id;


--
-- Name: onboarding_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_templates (
    id integer NOT NULL,
    service_type text,
    task_key text NOT NULL,
    task_label text NOT NULL,
    sort_order integer DEFAULT 0,
    blocking boolean DEFAULT false,
    default_owner_role text
);


--
-- Name: onboarding_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.onboarding_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: onboarding_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.onboarding_templates_id_seq OWNED BY public.onboarding_templates.id;


--
-- Name: ops_inbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_inbox_events (
    id integer NOT NULL,
    intake_message_id integer,
    event_type text NOT NULL,
    client_id text,
    contract_id text,
    priority text DEFAULT 'normal'::text,
    summary text,
    linked_entity_type text,
    linked_entity_id text,
    status text DEFAULT 'open'::text,
    actioned_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ops_inbox_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ops_inbox_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ops_inbox_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ops_inbox_events_id_seq OWNED BY public.ops_inbox_events.id;


--
-- Name: ot_rate_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ot_rate_rules (
    id integer NOT NULL,
    day_type text NOT NULL,
    multiplier numeric(4,2) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    source_reference text
);


--
-- Name: ot_rate_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ot_rate_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ot_rate_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ot_rate_rules_id_seq OWNED BY public.ot_rate_rules.id;


--
-- Name: ot_utilization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ot_utilization (
    id integer NOT NULL,
    project_id text,
    contract_id text,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    ot_hours numeric(10,2) DEFAULT 0,
    ot_amount numeric(14,2) DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ot_utilization_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ot_utilization_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ot_utilization_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ot_utilization_id_seq OWNED BY public.ot_utilization.id;


--
-- Name: payment_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_batches (
    id text NOT NULL,
    batch_type text NOT NULL,
    year integer,
    month integer,
    source_bill_id text,
    bank_id integer,
    bank_name text,
    payment_date date,
    reference_no text,
    total_amount numeric(14,2) DEFAULT 0,
    employee_count integer DEFAULT 0,
    notes text,
    status text DEFAULT 'Pending'::text,
    xero_ref text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    client text,
    contract_name text
);


--
-- Name: payment_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_ledger (
    id integer NOT NULL,
    batch_id text NOT NULL,
    employee_id text,
    employee_name text,
    payment_type text NOT NULL,
    amount numeric(12,2) DEFAULT 0,
    reference text,
    bank_name text,
    bank_account text,
    billable boolean DEFAULT true,
    xero_account_code text DEFAULT '200'::text,
    xero_ref text,
    status text DEFAULT 'Pending'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payment_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_ledger_id_seq OWNED BY public.payment_ledger.id;


--
-- Name: payment_status_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_status_change_log (
    id integer NOT NULL,
    invoice_id integer,
    invoice_number text,
    from_status text,
    to_status text NOT NULL,
    changed_by text,
    changed_at timestamp with time zone DEFAULT now(),
    summarized_at timestamp with time zone
);


--
-- Name: payment_status_change_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_status_change_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_status_change_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_status_change_log_id_seq OWNED BY public.payment_status_change_log.id;


--
-- Name: payroll_run_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_run_rows (
    id integer NOT NULL,
    run_id integer NOT NULL,
    employee_id text NOT NULL,
    paid_days numeric(8,2),
    working_days numeric(8,2),
    ot2_hours numeric(8,2) DEFAULT 0,
    ot3_hours numeric(8,2) DEFAULT 0,
    inputs jsonb DEFAULT '{}'::jsonb,
    computed jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payroll_run_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_run_rows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_run_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_run_rows_id_seq OWNED BY public.payroll_run_rows.id;


--
-- Name: payroll_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_runs (
    id integer NOT NULL,
    contract_id text NOT NULL,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    computed_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by text,
    invoice_id text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payroll_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_runs_id_seq OWNED BY public.payroll_runs.id;


--
-- Name: payroll_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_transactions (
    id integer NOT NULL,
    employee_id text,
    month integer NOT NULL,
    year integer NOT NULL,
    basic numeric DEFAULT 0,
    hra numeric DEFAULT 0,
    conv numeric DEFAULT 0,
    med numeric DEFAULT 0,
    ot numeric DEFAULT 0,
    opd numeric DEFAULT 0,
    reimb numeric DEFAULT 0,
    gross numeric DEFAULT 0,
    wht numeric DEFAULT 0,
    eobi_ee numeric DEFAULT 370,
    eobi_er numeric DEFAULT 1850,
    sessi_ee numeric DEFAULT 0,
    sessi_er numeric DEFAULT 0,
    pf_ee numeric DEFAULT 0,
    adv numeric DEFAULT 0,
    net numeric DEFAULT 0,
    status text DEFAULT 'Draft'::text,
    paid_on date,
    created_at timestamp with time zone DEFAULT now(),
    locked boolean DEFAULT false,
    locked_by text,
    locked_at timestamp with time zone,
    paid_days numeric(5,2),
    special_allowance numeric(12,2) DEFAULT 0,
    fuel_mobile numeric(12,2) DEFAULT 0,
    other_deduction numeric(12,2) DEFAULT 0,
    advance_deduction numeric(12,2) DEFAULT 0,
    loan_deduction numeric(12,2) DEFAULT 0,
    bonus_amount numeric(12,2) DEFAULT 0,
    arrears numeric(12,2) DEFAULT 0,
    medical_ee numeric(12,2),
    medical_sp numeric(12,2),
    medical_ch1 numeric(12,2),
    medical_ch2 numeric(12,2),
    service_charges numeric(12,2) DEFAULT 0,
    sales_tax numeric(12,2) DEFAULT 0,
    total_invoice numeric(12,2) DEFAULT 0,
    created_by text,
    ot2_hrs numeric(8,2) DEFAULT 0,
    ot3_hrs numeric(8,2) DEFAULT 0,
    opd_claim numeric(12,2) DEFAULT 0,
    reimbursement numeric(12,2) DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: payroll_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_transactions_id_seq OWNED BY public.payroll_transactions.id;


--
-- Name: petty_cash_funds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.petty_cash_funds (
    id integer NOT NULL,
    site text NOT NULL,
    monthly_threshold numeric DEFAULT 0 NOT NULL,
    finance_emails text[] DEFAULT '{}'::text[] NOT NULL,
    low_alert_sent_at timestamp with time zone,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: petty_cash_funds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.petty_cash_funds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: petty_cash_funds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.petty_cash_funds_id_seq OWNED BY public.petty_cash_funds.id;


--
-- Name: petty_cash_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.petty_cash_ledger (
    id integer NOT NULL,
    site text NOT NULL,
    entry_type text NOT NULL,
    amount numeric NOT NULL,
    ticket_id text,
    notes text,
    entered_by text NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT petty_cash_ledger_entry_type_check CHECK ((entry_type = ANY (ARRAY['allocation'::text, 'spend'::text, 'replenishment'::text])))
);


--
-- Name: petty_cash_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.petty_cash_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: petty_cash_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.petty_cash_ledger_id_seq OWNED BY public.petty_cash_ledger.id;


--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;


--
-- Name: portal_claim_approver_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_claim_approver_packs (
    id integer NOT NULL,
    period_id integer NOT NULL,
    approver_email text NOT NULL,
    invite_token_hash text,
    invite_sent_at timestamp with time zone,
    reminder_count integer DEFAULT 0,
    last_reminder_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: portal_claim_approver_packs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_claim_approver_packs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_claim_approver_packs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_claim_approver_packs_id_seq OWNED BY public.portal_claim_approver_packs.id;


--
-- Name: portal_claim_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_claim_attachments (
    id integer NOT NULL,
    submission_id integer NOT NULL,
    item_id integer,
    filename text NOT NULL,
    mime_type text,
    content_base64 text,
    byte_size integer,
    uploaded_at timestamp with time zone DEFAULT now(),
    retain_until date NOT NULL,
    category text DEFAULT 'other'::text
);


--
-- Name: portal_claim_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_claim_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_claim_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_claim_attachments_id_seq OWNED BY public.portal_claim_attachments.id;


--
-- Name: portal_claim_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_claim_batches (
    id integer NOT NULL,
    period_id integer NOT NULL,
    filler_email text NOT NULL,
    invite_token_hash text,
    invite_sent_at timestamp with time zone,
    invite_opened_at timestamp with time zone,
    invite_delivered boolean DEFAULT true,
    reminder_count integer DEFAULT 0,
    last_reminder_at timestamp with time zone,
    status text DEFAULT 'invited'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: portal_claim_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_claim_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_claim_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_claim_batches_id_seq OWNED BY public.portal_claim_batches.id;


--
-- Name: portal_claim_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_claim_items (
    id integer NOT NULL,
    submission_id integer NOT NULL,
    claim_type text NOT NULL,
    claim_date date,
    ot_hours numeric(8,2),
    ot_multiplier text,
    ot_multiplier_factor numeric(4,2),
    amount numeric(12,2),
    description text,
    expense_type text,
    patient_name text,
    time_from text,
    time_to text,
    nature text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: portal_claim_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_claim_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_claim_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_claim_items_id_seq OWNED BY public.portal_claim_items.id;


--
-- Name: portal_claim_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_claim_periods (
    id integer NOT NULL,
    campaign_month integer NOT NULL,
    campaign_year integer NOT NULL,
    claim_month integer NOT NULL,
    claim_year integer NOT NULL,
    settlement_month integer NOT NULL,
    settlement_year integer NOT NULL,
    fill_open_at timestamp with time zone NOT NULL,
    fill_close_at timestamp with time zone NOT NULL,
    approve_close_at timestamp with time zone NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: portal_claim_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_claim_periods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_claim_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_claim_periods_id_seq OWNED BY public.portal_claim_periods.id;


--
-- Name: portal_claim_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_claim_submissions (
    id integer NOT NULL,
    period_id integer NOT NULL,
    batch_id integer,
    employee_id text NOT NULL,
    filler_email text NOT NULL,
    approver_email text,
    status text DEFAULT 'invited'::text NOT NULL,
    channel text DEFAULT 'portal'::text NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    approver_comment text,
    approved_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: portal_claim_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_claim_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_claim_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_claim_submissions_id_seq OWNED BY public.portal_claim_submissions.id;


--
-- Name: portal_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_otps (
    id integer NOT NULL,
    phone text NOT NULL,
    otp text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    channel text DEFAULT 'sms'::text,
    destination text,
    employee_id text
);


--
-- Name: portal_otps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_otps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_otps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_otps_id_seq OWNED BY public.portal_otps.id;


--
-- Name: procurement_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_requests (
    id integer NOT NULL,
    intake_message_id integer,
    client_id text,
    contract_id text,
    project_id text,
    description text,
    requested_items jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'new'::text,
    linked_bill_id text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: procurement_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procurement_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procurement_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procurement_requests_id_seq OWNED BY public.procurement_requests.id;


--
-- Name: project_client_focals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_client_focals (
    id integer NOT NULL,
    project_id text,
    site text,
    department text,
    client text,
    contract_id text,
    focal_emails text[] DEFAULT '{}'::text[] NOT NULL,
    supervisor_email text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: project_client_focals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_client_focals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_client_focals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_client_focals_id_seq OWNED BY public.project_client_focals.id;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id text NOT NULL,
    contract_id text NOT NULL,
    client_id text NOT NULL,
    name text NOT NULL,
    site_code text,
    city text,
    province text,
    is_critical_fm boolean DEFAULT false,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: public_holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_holidays (
    id integer NOT NULL,
    holiday_date date NOT NULL,
    name text NOT NULL,
    multiplier numeric(3,1) DEFAULT 3 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: public_holidays_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_holidays_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_holidays_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_holidays_id_seq OWNED BY public.public_holidays.id;


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id integer NOT NULL,
    po_number character varying(120) NOT NULL,
    client_name character varying(200) NOT NULL,
    contract_id text,
    contract_name character varying(200),
    bu_name character varying(200),
    po_value numeric(18,2) DEFAULT 0 NOT NULL,
    po_date date,
    po_expiry date,
    allocation_method character varying(20) DEFAULT 'fifo'::character varying,
    priority integer DEFAULT 100,
    notes text,
    status character varying(30) DEFAULT 'active'::character varying,
    created_by character varying(120),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_orders_id_seq OWNED BY public.purchase_orders.id;


--
-- Name: report_dispatch_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_dispatch_log (
    id integer NOT NULL,
    subscription_id integer,
    report_date date NOT NULL,
    sent_to text[],
    status text NOT NULL,
    error text,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: report_dispatch_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_dispatch_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: report_dispatch_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_dispatch_log_id_seq OWNED BY public.report_dispatch_log.id;


--
-- Name: report_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_subscriptions (
    id integer NOT NULL,
    site text NOT NULL,
    report_type text DEFAULT 'daily_attendance'::text NOT NULL,
    recipients text[] NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: report_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: report_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_subscriptions_id_seq OWNED BY public.report_subscriptions.id;


--
-- Name: response_sla_tracker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_sla_tracker (
    id integer NOT NULL,
    intake_message_id integer,
    category text NOT NULL,
    sla_hours integer DEFAULT 48 NOT NULL,
    owner_email text,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    status text DEFAULT 'within_sla'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: response_sla_tracker_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.response_sla_tracker_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: response_sla_tracker_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.response_sla_tracker_id_seq OWNED BY public.response_sla_tracker.id;


--
-- Name: service_log_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_log_entries (
    id integer NOT NULL,
    project_id text,
    service_order_id text,
    line_id integer,
    entry_date date NOT NULL,
    amount numeric(14,2) NOT NULL,
    description text,
    status text DEFAULT 'pending'::text,
    invoiced_month text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: service_log_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_log_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_log_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_log_entries_id_seq OWNED BY public.service_log_entries.id;


--
-- Name: service_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_order_lines (
    id integer NOT NULL,
    service_order_id text NOT NULL,
    line_number text,
    name text NOT NULL,
    unit text DEFAULT 'MON'::text,
    quantity numeric(12,2) DEFAULT 1,
    rate numeric(14,2),
    total_amount numeric(14,2),
    is_manpower_dependent boolean DEFAULT false,
    roles jsonb DEFAULT '[]'::jsonb
);


--
-- Name: service_order_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_order_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_order_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_order_lines_id_seq OWNED BY public.service_order_lines.id;


--
-- Name: service_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_orders (
    id text NOT NULL,
    contract_id text NOT NULL,
    project_id text,
    so_number text,
    name text NOT NULL,
    period_type text DEFAULT 'monthly'::text,
    total_value numeric(14,2),
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: site_escalation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_escalation_rules (
    id integer NOT NULL,
    site text NOT NULL,
    priority text NOT NULL,
    hours_open numeric NOT NULL,
    escalate_to_name text,
    escalate_to_email text NOT NULL,
    escalate_to_phone text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    basis text DEFAULT 'hours_open'::text
);


--
-- Name: site_escalation_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.site_escalation_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: site_escalation_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.site_escalation_rules_id_seq OWNED BY public.site_escalation_rules.id;


--
-- Name: so_deductions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.so_deductions (
    id integer NOT NULL,
    service_order_id text NOT NULL,
    line_id integer,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    type text NOT NULL,
    employee_id text,
    days_absent numeric(6,2),
    amount numeric(14,2) NOT NULL,
    source text DEFAULT 'attendance_ledger'::text,
    approved_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: so_deductions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.so_deductions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: so_deductions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.so_deductions_id_seq OWNED BY public.so_deductions.id;


--
-- Name: statutory_filings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statutory_filings (
    id integer NOT NULL,
    authority text NOT NULL,
    period_month integer,
    period_year integer,
    status text DEFAULT 'draft'::text,
    total_amount numeric(14,2),
    line_count integer,
    cpr_reference text,
    challan_file_id integer,
    deposit_date date,
    file_ref integer,
    generated_by text,
    filed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: statutory_filings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.statutory_filings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: statutory_filings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.statutory_filings_id_seq OWNED BY public.statutory_filings.id;


--
-- Name: statutory_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statutory_ledger (
    id integer NOT NULL,
    employee_id text,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    authority text NOT NULL,
    employee_share numeric(12,2) DEFAULT 0,
    employer_share numeric(12,2) DEFAULT 0,
    taxable_base numeric(14,2),
    regulation_id integer,
    payroll_transaction_id integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: statutory_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.statutory_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: statutory_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.statutory_ledger_id_seq OWNED BY public.statutory_ledger.id;


--
-- Name: supervisor_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supervisor_teams (
    id integer NOT NULL,
    supervisor_email text NOT NULL,
    employee_id text NOT NULL,
    site text,
    client text,
    contract_id text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: supervisor_teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supervisor_teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supervisor_teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supervisor_teams_id_seq OWNED BY public.supervisor_teams.id;


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: tax_regulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_regulations (
    id integer NOT NULL,
    authority text NOT NULL,
    rule_type text NOT NULL,
    jurisdiction text,
    rules jsonb NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    source_reference text,
    created_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tax_regulations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tax_regulations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tax_regulations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tax_regulations_id_seq OWNED BY public.tax_regulations.id;


--
-- Name: ticket_escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_escalations (
    id integer NOT NULL,
    ticket_id text NOT NULL,
    rule_id integer NOT NULL,
    escalated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ticket_escalations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_escalations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_escalations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_escalations_id_seq OWNED BY public.ticket_escalations.id;


--
-- Name: uploaded_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_files (
    id integer NOT NULL,
    kind text NOT NULL,
    ref_id text,
    filename text,
    mime text,
    size_bytes integer,
    data bytea NOT NULL,
    uploaded_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: uploaded_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.uploaded_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: uploaded_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.uploaded_files_id_seq OWNED BY public.uploaded_files.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    name text,
    role text DEFAULT 'staff'::text,
    google_id text,
    avatar text,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_contract_pnl_monthly; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_contract_pnl_monthly AS
 WITH costs AS (
         SELECT cost_allocations.contract_id,
            cost_allocations.period_year,
            cost_allocations.period_month,
            sum(cost_allocations.amount) AS total_cost
           FROM public.cost_allocations
          GROUP BY cost_allocations.contract_id, cost_allocations.period_year, cost_allocations.period_month
        ), revenue AS (
         SELECT client_invoices.contract_id,
            client_invoices.period_year,
            client_invoices.period_month,
            sum(client_invoices.grand_total) AS total_revenue
           FROM public.client_invoices
          WHERE (client_invoices.status <> ALL (ARRAY['Void'::text, 'Voided'::text]))
          GROUP BY client_invoices.contract_id, client_invoices.period_year, client_invoices.period_month
        ), periods AS (
         SELECT costs_1.contract_id,
            costs_1.period_year,
            costs_1.period_month
           FROM costs costs_1
        UNION
         SELECT revenue_1.contract_id,
            revenue_1.period_year,
            revenue_1.period_month
           FROM revenue revenue_1
        )
 SELECT c.id AS contract_id,
    c.contract_name,
    c.client_id,
    p.period_year,
    p.period_month,
    COALESCE(costs.total_cost, (0)::numeric) AS total_cost,
    COALESCE(revenue.total_revenue, (0)::numeric) AS total_revenue,
    (COALESCE(revenue.total_revenue, (0)::numeric) - COALESCE(costs.total_cost, (0)::numeric)) AS margin_abs,
        CASE
            WHEN (COALESCE(revenue.total_revenue, (0)::numeric) > (0)::numeric) THEN round((((COALESCE(revenue.total_revenue, (0)::numeric) - COALESCE(costs.total_cost, (0)::numeric)) / revenue.total_revenue) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS margin_pct
   FROM (((periods p
     JOIN public.contracts c ON ((c.id = p.contract_id)))
     LEFT JOIN costs ON (((costs.contract_id = p.contract_id) AND (costs.period_year = p.period_year) AND (costs.period_month = p.period_month))))
     LEFT JOIN revenue ON (((revenue.contract_id = p.contract_id) AND (revenue.period_year = p.period_year) AND (revenue.period_month = p.period_month))));


--
-- Name: vendor_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_payments (
    id integer NOT NULL,
    vendor_id integer,
    payment_date date,
    amount numeric(12,2),
    wht_rate numeric(5,2),
    wht_amount numeric(12,2),
    net_payment numeric(12,2),
    description text,
    bill_ref text,
    category text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: vendor_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_payments_id_seq OWNED BY public.vendor_payments.id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id integer NOT NULL,
    name text NOT NULL,
    category text,
    ntn text,
    strn text,
    cnic text,
    address text,
    contact_person text,
    phone text,
    email text,
    bank_name text,
    bank_account text,
    account_title text,
    is_filer boolean DEFAULT true,
    is_active boolean DEFAULT true,
    payment_terms text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendors_id_seq OWNED BY public.vendors.id;


--
-- Name: wafi_claims_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wafi_claims_items (
    id integer NOT NULL,
    session_id integer,
    tab_name text NOT NULL,
    row_number integer NOT NULL,
    employee_id text,
    employee_code_raw text,
    employee_name_raw text,
    employee_name_db text,
    name_similarity numeric(4,3),
    claim_date date,
    claim_type text,
    ot_hours numeric(8,2),
    ot_multiplier text,
    ot_multiplier_factor numeric(4,2),
    ot_payout numeric(12,2),
    expense_type text,
    description text,
    raw_amount numeric(12,2),
    location text,
    department text,
    line_manager text,
    patient_name text,
    payroll_transaction_id integer,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    day_type text
);


--
-- Name: wafi_claims_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wafi_claims_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wafi_claims_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wafi_claims_items_id_seq OWNED BY public.wafi_claims_items.id;


--
-- Name: wafi_claims_reprocess_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wafi_claims_reprocess_queue (
    gmail_message_id text NOT NULL,
    queued_at timestamp with time zone DEFAULT now()
);


--
-- Name: wafi_claims_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wafi_claims_sessions (
    id integer NOT NULL,
    received_at timestamp with time zone NOT NULL,
    sender_email text NOT NULL,
    subject text,
    gmail_message_id text,
    gmail_thread_id text,
    attachment_filename text,
    location_name text,
    claim_month date,
    processing_status text DEFAULT 'VALIDATING'::text,
    label_applied text,
    validation_errors jsonb DEFAULT '[]'::jsonb,
    total_ot_rows integer DEFAULT 0,
    total_expense_rows integer DEFAULT 0,
    total_medical_rows integer DEFAULT 0,
    is_revision boolean DEFAULT false,
    supersedes_session_id integer,
    qc_email_sent boolean DEFAULT false,
    confirm_email_sent boolean DEFAULT false,
    pushed_to_payroll boolean DEFAULT false,
    payroll_month date,
    created_at timestamp with time zone DEFAULT now(),
    name_warnings jsonb DEFAULT '[]'::jsonb,
    email_summary text,
    is_first_time_sender boolean DEFAULT false,
    verified_at timestamp with time zone,
    verified_by text,
    gmail_draft_id text,
    settlement_month date,
    override_note text,
    file_hash character varying(64)
);


--
-- Name: wafi_claims_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wafi_claims_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wafi_claims_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wafi_claims_sessions_id_seq OWNED BY public.wafi_claims_sessions.id;


--
-- Name: wafi_focal_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wafi_focal_points (
    id integer NOT NULL,
    email text NOT NULL,
    name text,
    location text,
    role text DEFAULT 'claimed_by'::text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: wafi_focal_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wafi_focal_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wafi_focal_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wafi_focal_points_id_seq OWNED BY public.wafi_focal_points.id;


--
-- Name: xero_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xero_connections (
    id integer NOT NULL,
    tenant_id text NOT NULL,
    tenant_name text,
    access_token text,
    refresh_token text,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: xero_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.xero_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: xero_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.xero_connections_id_seq OWNED BY public.xero_connections.id;


--
-- Name: xero_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xero_sync_log (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    direction text NOT NULL,
    status text NOT NULL,
    xero_id text,
    error text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: xero_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.xero_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: xero_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.xero_sync_log_id_seq OWNED BY public.xero_sync_log.id;


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 FOR VALUES IN ('intake.poll');


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 FOR VALUES IN ('__pgboss__send-it');


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae FOR VALUES IN ('bizdev.renewals');


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c FOR VALUES IN ('portal.claims.reminders');


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 FOR VALUES IN ('ar.schedules');


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 FOR VALUES IN ('attendance.alerts');


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd FOR VALUES IN ('pnl.allocate.cron');


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab FOR VALUES IN ('cashflow.snapshot');


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 FOR VALUES IN ('xero.ar.sync');


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 FOR VALUES IN ('xero.bills.sync');


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc FOR VALUES IN ('pnl.allocate');


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 FOR VALUES IN ('ar.dunning');


--
-- Name: asset_issuances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_issuances ALTER COLUMN id SET DEFAULT nextval('public.asset_issuances_id_seq'::regclass);


--
-- Name: attendance_alert_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alert_rules ALTER COLUMN id SET DEFAULT nextval('public.attendance_alert_rules_id_seq'::regclass);


--
-- Name: attendance_alerts_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alerts_log ALTER COLUMN id SET DEFAULT nextval('public.attendance_alerts_log_id_seq'::regclass);


--
-- Name: attendance_parser_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_parser_profiles ALTER COLUMN id SET DEFAULT nextval('public.attendance_parser_profiles_id_seq'::regclass);


--
-- Name: attendance_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records ALTER COLUMN id SET DEFAULT nextval('public.attendance_records_id_seq'::regclass);


--
-- Name: banks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banks ALTER COLUMN id SET DEFAULT nextval('public.banks_id_seq'::regclass);


--
-- Name: bd_leads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_leads ALTER COLUMN id SET DEFAULT nextval('public.bd_leads_id_seq'::regclass);


--
-- Name: bd_outreach_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_outreach_log ALTER COLUMN id SET DEFAULT nextval('public.bd_outreach_log_id_seq'::regclass);


--
-- Name: bd_renewals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_renewals ALTER COLUMN id SET DEFAULT nextval('public.bd_renewals_id_seq'::regclass);


--
-- Name: benefit_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benefit_policies ALTER COLUMN id SET DEFAULT nextval('public.benefit_policies_id_seq'::regclass);


--
-- Name: benefit_utilization id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benefit_utilization ALTER COLUMN id SET DEFAULT nextval('public.benefit_utilization_id_seq'::regclass);


--
-- Name: bill_approval_steps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_approval_steps ALTER COLUMN id SET DEFAULT nextval('public.bill_approval_steps_id_seq'::regclass);


--
-- Name: bill_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_documents ALTER COLUMN id SET DEFAULT nextval('public.bill_documents_id_seq'::regclass);


--
-- Name: cashflow_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflow_snapshots ALTER COLUMN id SET DEFAULT nextval('public.cashflow_snapshots_id_seq'::regclass);


--
-- Name: claim_manual_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_manual_overrides ALTER COLUMN id SET DEFAULT nextval('public.claim_manual_overrides_id_seq'::regclass);


--
-- Name: claims_approval_cycles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_approval_cycles ALTER COLUMN id SET DEFAULT nextval('public.claims_approval_cycles_id_seq'::regclass);


--
-- Name: claims_inbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_inbox ALTER COLUMN id SET DEFAULT nextval('public.claims_inbox_id_seq'::regclass);


--
-- Name: client_business_units id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_business_units ALTER COLUMN id SET DEFAULT nextval('public.client_business_units_id_seq'::regclass);


--
-- Name: client_departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments ALTER COLUMN id SET DEFAULT nextval('public.client_departments_id_seq'::regclass);


--
-- Name: client_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_invoices ALTER COLUMN id SET DEFAULT nextval('public.client_invoices_id_seq'::regclass);


--
-- Name: client_locations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_locations ALTER COLUMN id SET DEFAULT nextval('public.client_locations_id_seq'::regclass);


--
-- Name: client_otps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_otps ALTER COLUMN id SET DEFAULT nextval('public.client_otps_id_seq'::regclass);


--
-- Name: cmms_client_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmms_client_users ALTER COLUMN id SET DEFAULT nextval('public.cmms_client_users_id_seq'::regclass);


--
-- Name: cmms_sites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmms_sites ALTER COLUMN id SET DEFAULT nextval('public.cmms_sites_id_seq'::regclass);


--
-- Name: contract_bid_actuals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_bid_actuals ALTER COLUMN id SET DEFAULT nextval('public.contract_bid_actuals_id_seq'::regclass);


--
-- Name: contract_bid_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_bid_items ALTER COLUMN id SET DEFAULT nextval('public.contract_bid_items_id_seq'::regclass);


--
-- Name: contract_budget_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_budget_lines ALTER COLUMN id SET DEFAULT nextval('public.contract_budget_lines_id_seq'::regclass);


--
-- Name: contract_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_policies ALTER COLUMN id SET DEFAULT nextval('public.contract_policies_id_seq'::regclass);


--
-- Name: contract_rate_cards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_rate_cards ALTER COLUMN id SET DEFAULT nextval('public.contract_rate_cards_id_seq'::regclass);


--
-- Name: cost_allocations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_allocations ALTER COLUMN id SET DEFAULT nextval('public.cost_allocations_id_seq'::regclass);


--
-- Name: dunning_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dunning_log ALTER COLUMN id SET DEFAULT nextval('public.dunning_log_id_seq'::regclass);


--
-- Name: employee_advances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances ALTER COLUMN id SET DEFAULT nextval('public.employee_advances_id_seq'::regclass);


--
-- Name: employee_change_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_change_requests ALTER COLUMN id SET DEFAULT nextval('public.employee_change_requests_id_seq'::regclass);


--
-- Name: employee_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_claims ALTER COLUMN id SET DEFAULT nextval('public.employee_claims_id_seq'::regclass);


--
-- Name: employee_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_documents ALTER COLUMN id SET DEFAULT nextval('public.employee_documents_id_seq'::regclass);


--
-- Name: employee_gratuity_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_gratuity_ledger ALTER COLUMN id SET DEFAULT nextval('public.employee_gratuity_ledger_id_seq'::regclass);


--
-- Name: employee_leave_balances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_balances ALTER COLUMN id SET DEFAULT nextval('public.employee_leave_balances_id_seq'::regclass);


--
-- Name: employee_leaves id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves ALTER COLUMN id SET DEFAULT nextval('public.employee_leaves_id_seq'::regclass);


--
-- Name: employee_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_messages ALTER COLUMN id SET DEFAULT nextval('public.employee_messages_id_seq'::regclass);


--
-- Name: employee_pf_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pf_ledger ALTER COLUMN id SET DEFAULT nextval('public.employee_pf_ledger_id_seq'::regclass);


--
-- Name: employee_warnings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_warnings ALTER COLUMN id SET DEFAULT nextval('public.employee_warnings_id_seq'::regclass);


--
-- Name: hcm_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcm_users ALTER COLUMN id SET DEFAULT nextval('public.hcm_users_id_seq'::regclass);


--
-- Name: holiday_calendar id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holiday_calendar ALTER COLUMN id SET DEFAULT nextval('public.holiday_calendar_id_seq'::regclass);


--
-- Name: inbox_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_rules ALTER COLUMN id SET DEFAULT nextval('public.inbox_rules_id_seq'::regclass);


--
-- Name: intake_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intake_messages ALTER COLUMN id SET DEFAULT nextval('public.intake_messages_id_seq'::regclass);


--
-- Name: inventory_issuance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_issuance ALTER COLUMN id SET DEFAULT nextval('public.inventory_issuance_id_seq'::regclass);


--
-- Name: inventory_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items ALTER COLUMN id SET DEFAULT nextval('public.inventory_items_id_seq'::regclass);


--
-- Name: inventory_stock id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stock ALTER COLUMN id SET DEFAULT nextval('public.inventory_stock_id_seq'::regclass);


--
-- Name: invoice_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_attachments ALTER COLUMN id SET DEFAULT nextval('public.invoice_attachments_id_seq'::regclass);


--
-- Name: invoice_receipt_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receipt_lines ALTER COLUMN id SET DEFAULT nextval('public.invoice_receipt_lines_id_seq'::regclass);


--
-- Name: invoice_receipts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receipts ALTER COLUMN id SET DEFAULT nextval('public.invoice_receipts_id_seq'::regclass);


--
-- Name: invoice_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_schedules ALTER COLUMN id SET DEFAULT nextval('public.invoice_schedules_id_seq'::regclass);


--
-- Name: monthly_attendance_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_attendance_overrides ALTER COLUMN id SET DEFAULT nextval('public.monthly_attendance_overrides_id_seq'::regclass);


--
-- Name: onboarding_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_runs ALTER COLUMN id SET DEFAULT nextval('public.onboarding_runs_id_seq'::regclass);


--
-- Name: onboarding_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_tasks ALTER COLUMN id SET DEFAULT nextval('public.onboarding_tasks_id_seq'::regclass);


--
-- Name: onboarding_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_templates ALTER COLUMN id SET DEFAULT nextval('public.onboarding_templates_id_seq'::regclass);


--
-- Name: ops_inbox_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_inbox_events ALTER COLUMN id SET DEFAULT nextval('public.ops_inbox_events_id_seq'::regclass);


--
-- Name: ot_rate_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ot_rate_rules ALTER COLUMN id SET DEFAULT nextval('public.ot_rate_rules_id_seq'::regclass);


--
-- Name: ot_utilization id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ot_utilization ALTER COLUMN id SET DEFAULT nextval('public.ot_utilization_id_seq'::regclass);


--
-- Name: payment_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_ledger ALTER COLUMN id SET DEFAULT nextval('public.payment_ledger_id_seq'::regclass);


--
-- Name: payment_status_change_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_status_change_log ALTER COLUMN id SET DEFAULT nextval('public.payment_status_change_log_id_seq'::regclass);


--
-- Name: payroll_run_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_run_rows ALTER COLUMN id SET DEFAULT nextval('public.payroll_run_rows_id_seq'::regclass);


--
-- Name: payroll_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs ALTER COLUMN id SET DEFAULT nextval('public.payroll_runs_id_seq'::regclass);


--
-- Name: payroll_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_transactions ALTER COLUMN id SET DEFAULT nextval('public.payroll_transactions_id_seq'::regclass);


--
-- Name: petty_cash_funds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_funds ALTER COLUMN id SET DEFAULT nextval('public.petty_cash_funds_id_seq'::regclass);


--
-- Name: petty_cash_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_ledger ALTER COLUMN id SET DEFAULT nextval('public.petty_cash_ledger_id_seq'::regclass);


--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);


--
-- Name: portal_claim_approver_packs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_approver_packs ALTER COLUMN id SET DEFAULT nextval('public.portal_claim_approver_packs_id_seq'::regclass);


--
-- Name: portal_claim_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_attachments ALTER COLUMN id SET DEFAULT nextval('public.portal_claim_attachments_id_seq'::regclass);


--
-- Name: portal_claim_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_batches ALTER COLUMN id SET DEFAULT nextval('public.portal_claim_batches_id_seq'::regclass);


--
-- Name: portal_claim_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_items ALTER COLUMN id SET DEFAULT nextval('public.portal_claim_items_id_seq'::regclass);


--
-- Name: portal_claim_periods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_periods ALTER COLUMN id SET DEFAULT nextval('public.portal_claim_periods_id_seq'::regclass);


--
-- Name: portal_claim_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_submissions ALTER COLUMN id SET DEFAULT nextval('public.portal_claim_submissions_id_seq'::regclass);


--
-- Name: portal_otps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_otps ALTER COLUMN id SET DEFAULT nextval('public.portal_otps_id_seq'::regclass);


--
-- Name: procurement_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests ALTER COLUMN id SET DEFAULT nextval('public.procurement_requests_id_seq'::regclass);


--
-- Name: project_client_focals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_client_focals ALTER COLUMN id SET DEFAULT nextval('public.project_client_focals_id_seq'::regclass);


--
-- Name: public_holidays id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays ALTER COLUMN id SET DEFAULT nextval('public.public_holidays_id_seq'::regclass);


--
-- Name: purchase_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders ALTER COLUMN id SET DEFAULT nextval('public.purchase_orders_id_seq'::regclass);


--
-- Name: report_dispatch_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_dispatch_log ALTER COLUMN id SET DEFAULT nextval('public.report_dispatch_log_id_seq'::regclass);


--
-- Name: report_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.report_subscriptions_id_seq'::regclass);


--
-- Name: response_sla_tracker id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_sla_tracker ALTER COLUMN id SET DEFAULT nextval('public.response_sla_tracker_id_seq'::regclass);


--
-- Name: service_log_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_log_entries ALTER COLUMN id SET DEFAULT nextval('public.service_log_entries_id_seq'::regclass);


--
-- Name: service_order_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_lines ALTER COLUMN id SET DEFAULT nextval('public.service_order_lines_id_seq'::regclass);


--
-- Name: site_escalation_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_escalation_rules ALTER COLUMN id SET DEFAULT nextval('public.site_escalation_rules_id_seq'::regclass);


--
-- Name: so_deductions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_deductions ALTER COLUMN id SET DEFAULT nextval('public.so_deductions_id_seq'::regclass);


--
-- Name: statutory_filings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_filings ALTER COLUMN id SET DEFAULT nextval('public.statutory_filings_id_seq'::regclass);


--
-- Name: statutory_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_ledger ALTER COLUMN id SET DEFAULT nextval('public.statutory_ledger_id_seq'::regclass);


--
-- Name: supervisor_teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_teams ALTER COLUMN id SET DEFAULT nextval('public.supervisor_teams_id_seq'::regclass);


--
-- Name: tax_regulations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_regulations ALTER COLUMN id SET DEFAULT nextval('public.tax_regulations_id_seq'::regclass);


--
-- Name: ticket_escalations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_escalations ALTER COLUMN id SET DEFAULT nextval('public.ticket_escalations_id_seq'::regclass);


--
-- Name: uploaded_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files ALTER COLUMN id SET DEFAULT nextval('public.uploaded_files_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vendor_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_payments ALTER COLUMN id SET DEFAULT nextval('public.vendor_payments_id_seq'::regclass);


--
-- Name: vendors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors ALTER COLUMN id SET DEFAULT nextval('public.vendors_id_seq'::regclass);


--
-- Name: wafi_claims_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_items ALTER COLUMN id SET DEFAULT nextval('public.wafi_claims_items_id_seq'::regclass);


--
-- Name: wafi_claims_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_sessions ALTER COLUMN id SET DEFAULT nextval('public.wafi_claims_sessions_id_seq'::regclass);


--
-- Name: wafi_focal_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_focal_points ALTER COLUMN id SET DEFAULT nextval('public.wafi_focal_points_id_seq'::regclass);


--
-- Name: xero_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xero_connections ALTER COLUMN id SET DEFAULT nextval('public.xero_connections_id_seq'::regclass);


--
-- Name: xero_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xero_sync_log ALTER COLUMN id SET DEFAULT nextval('public.xero_sync_log_id_seq'::regclass);


--
-- Name: archive archive_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.archive
    ADD CONSTRAINT archive_pkey PRIMARY KEY (name, id);


--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (name, id);


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84
    ADD CONSTRAINT j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_pkey PRIMARY KEY (name, id);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey PRIMARY KEY (name, id);


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae
    ADD CONSTRAINT j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_pkey PRIMARY KEY (name, id);


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c
    ADD CONSTRAINT j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_pkey PRIMARY KEY (name, id);


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270
    ADD CONSTRAINT j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_pkey PRIMARY KEY (name, id);


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95
    ADD CONSTRAINT j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_pkey PRIMARY KEY (name, id);


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd
    ADD CONSTRAINT j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_pkey PRIMARY KEY (name, id);


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab
    ADD CONSTRAINT jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_pkey PRIMARY KEY (name, id);


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7
    ADD CONSTRAINT jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_pkey PRIMARY KEY (name, id);


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592
    ADD CONSTRAINT jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_pkey PRIMARY KEY (name, id);


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc
    ADD CONSTRAINT jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_pkey PRIMARY KEY (name, id);


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53
    ADD CONSTRAINT jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_pkey PRIMARY KEY (name, id);


--
-- Name: queue queue_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_pkey PRIMARY KEY (name);


--
-- Name: schedule schedule_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_pkey PRIMARY KEY (name);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (event, name);


--
-- Name: version version_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.version
    ADD CONSTRAINT version_pkey PRIMARY KEY (version);


--
-- Name: asset_issuances asset_issuances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_issuances
    ADD CONSTRAINT asset_issuances_pkey PRIMARY KEY (id);


--
-- Name: attendance_alert_rules attendance_alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alert_rules
    ADD CONSTRAINT attendance_alert_rules_pkey PRIMARY KEY (id);


--
-- Name: attendance_alerts_log attendance_alerts_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alerts_log
    ADD CONSTRAINT attendance_alerts_log_pkey PRIMARY KEY (id);


--
-- Name: attendance_parser_profiles attendance_parser_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_parser_profiles
    ADD CONSTRAINT attendance_parser_profiles_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_employee_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_employee_id_date_key UNIQUE (employee_id, date);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: banks banks_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_name_key UNIQUE (name);


--
-- Name: banks banks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_pkey PRIMARY KEY (id);


--
-- Name: bd_leads bd_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_leads
    ADD CONSTRAINT bd_leads_pkey PRIMARY KEY (id);


--
-- Name: bd_outreach_log bd_outreach_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_outreach_log
    ADD CONSTRAINT bd_outreach_log_pkey PRIMARY KEY (id);


--
-- Name: bd_renewals bd_renewals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_renewals
    ADD CONSTRAINT bd_renewals_pkey PRIMARY KEY (id);


--
-- Name: benefit_policies benefit_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benefit_policies
    ADD CONSTRAINT benefit_policies_pkey PRIMARY KEY (id);


--
-- Name: benefit_utilization benefit_utilization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benefit_utilization
    ADD CONSTRAINT benefit_utilization_pkey PRIMARY KEY (id);


--
-- Name: bill_approval_steps bill_approval_steps_bill_id_step_number_approver_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_approval_steps
    ADD CONSTRAINT bill_approval_steps_bill_id_step_number_approver_email_key UNIQUE (bill_id, step_number, approver_email);


--
-- Name: bill_approval_steps bill_approval_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_approval_steps
    ADD CONSTRAINT bill_approval_steps_pkey PRIMARY KEY (id);


--
-- Name: bill_documents bill_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_documents
    ADD CONSTRAINT bill_documents_pkey PRIMARY KEY (id);


--
-- Name: bills bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);


--
-- Name: cashflow_snapshots cashflow_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashflow_snapshots
    ADD CONSTRAINT cashflow_snapshots_pkey PRIMARY KEY (id);


--
-- Name: claim_manual_overrides claim_manual_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_manual_overrides
    ADD CONSTRAINT claim_manual_overrides_pkey PRIMARY KEY (id);


--
-- Name: claims_approval_cycles claims_approval_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_approval_cycles
    ADD CONSTRAINT claims_approval_cycles_pkey PRIMARY KEY (id);


--
-- Name: claims_inbox claims_inbox_message_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_inbox
    ADD CONSTRAINT claims_inbox_message_hash_key UNIQUE (message_hash);


--
-- Name: claims_inbox claims_inbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_inbox
    ADD CONSTRAINT claims_inbox_pkey PRIMARY KEY (id);


--
-- Name: client_business_units client_business_units_client_id_bu_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_business_units
    ADD CONSTRAINT client_business_units_client_id_bu_code_key UNIQUE (client_id, bu_code);


--
-- Name: client_business_units client_business_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_business_units
    ADD CONSTRAINT client_business_units_pkey PRIMARY KEY (id);


--
-- Name: client_departments client_departments_client_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments
    ADD CONSTRAINT client_departments_client_id_name_key UNIQUE (client_id, name);


--
-- Name: client_departments client_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments
    ADD CONSTRAINT client_departments_pkey PRIMARY KEY (id);


--
-- Name: client_invoices client_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_invoices
    ADD CONSTRAINT client_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: client_invoices client_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_invoices
    ADD CONSTRAINT client_invoices_pkey PRIMARY KEY (id);


--
-- Name: client_locations client_locations_client_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_locations
    ADD CONSTRAINT client_locations_client_id_name_key UNIQUE (client_id, name);


--
-- Name: client_locations client_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_locations
    ADD CONSTRAINT client_locations_pkey PRIMARY KEY (id);


--
-- Name: client_otps client_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_otps
    ADD CONSTRAINT client_otps_pkey PRIMARY KEY (id);


--
-- Name: clients clients_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_name_key UNIQUE (name);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: cmms_client_users cmms_client_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmms_client_users
    ADD CONSTRAINT cmms_client_users_email_key UNIQUE (email);


--
-- Name: cmms_client_users cmms_client_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmms_client_users
    ADD CONSTRAINT cmms_client_users_pkey PRIMARY KEY (id);


--
-- Name: cmms_sites cmms_sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmms_sites
    ADD CONSTRAINT cmms_sites_pkey PRIMARY KEY (id);


--
-- Name: cmms_sites cmms_sites_site_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmms_sites
    ADD CONSTRAINT cmms_sites_site_name_key UNIQUE (site_name);


--
-- Name: contract_bid_actuals contract_bid_actuals_contract_id_bid_item_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_bid_actuals
    ADD CONSTRAINT contract_bid_actuals_contract_id_bid_item_id_month_year_key UNIQUE (contract_id, bid_item_id, month, year);


--
-- Name: contract_bid_actuals contract_bid_actuals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_bid_actuals
    ADD CONSTRAINT contract_bid_actuals_pkey PRIMARY KEY (id);


--
-- Name: contract_bid_items contract_bid_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_bid_items
    ADD CONSTRAINT contract_bid_items_pkey PRIMARY KEY (id);


--
-- Name: contract_budget_lines contract_budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_budget_lines
    ADD CONSTRAINT contract_budget_lines_pkey PRIMARY KEY (id);


--
-- Name: contract_policies contract_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_policies
    ADD CONSTRAINT contract_policies_pkey PRIMARY KEY (id);


--
-- Name: contract_rate_cards contract_rate_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_rate_cards
    ADD CONSTRAINT contract_rate_cards_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: cost_allocations cost_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_allocations
    ADD CONSTRAINT cost_allocations_pkey PRIMARY KEY (id);


--
-- Name: delivery_challans delivery_challans_challan_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challans
    ADD CONSTRAINT delivery_challans_challan_no_key UNIQUE (challan_no);


--
-- Name: delivery_challans delivery_challans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_challans
    ADD CONSTRAINT delivery_challans_pkey PRIMARY KEY (id);


--
-- Name: dunning_log dunning_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dunning_log
    ADD CONSTRAINT dunning_log_pkey PRIMARY KEY (id);


--
-- Name: employee_advances employee_advances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances
    ADD CONSTRAINT employee_advances_pkey PRIMARY KEY (id);


--
-- Name: employee_change_requests employee_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_change_requests
    ADD CONSTRAINT employee_change_requests_pkey PRIMARY KEY (id);


--
-- Name: employee_claims employee_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_claims
    ADD CONSTRAINT employee_claims_pkey PRIMARY KEY (id);


--
-- Name: employee_documents employee_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_pkey PRIMARY KEY (id);


--
-- Name: employee_gratuity_ledger employee_gratuity_ledger_employee_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_gratuity_ledger
    ADD CONSTRAINT employee_gratuity_ledger_employee_id_month_year_key UNIQUE (employee_id, month, year);


--
-- Name: employee_gratuity_ledger employee_gratuity_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_gratuity_ledger
    ADD CONSTRAINT employee_gratuity_ledger_pkey PRIMARY KEY (id);


--
-- Name: employee_leave_balances employee_leave_balances_employee_id_year_leave_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_balances
    ADD CONSTRAINT employee_leave_balances_employee_id_year_leave_type_key UNIQUE (employee_id, year, leave_type);


--
-- Name: employee_leave_balances employee_leave_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leave_balances
    ADD CONSTRAINT employee_leave_balances_pkey PRIMARY KEY (id);


--
-- Name: employee_leaves employee_leaves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves
    ADD CONSTRAINT employee_leaves_pkey PRIMARY KEY (id);


--
-- Name: employee_messages employee_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_messages
    ADD CONSTRAINT employee_messages_pkey PRIMARY KEY (id);


--
-- Name: employee_pf_ledger employee_pf_ledger_employee_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pf_ledger
    ADD CONSTRAINT employee_pf_ledger_employee_id_month_year_key UNIQUE (employee_id, month, year);


--
-- Name: employee_pf_ledger employee_pf_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pf_ledger
    ADD CONSTRAINT employee_pf_ledger_pkey PRIMARY KEY (id);


--
-- Name: employee_warnings employee_warnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_warnings
    ADD CONSTRAINT employee_warnings_pkey PRIMARY KEY (id);


--
-- Name: employees employees_cnic_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_cnic_key UNIQUE (cnic);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: hcm_users hcm_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcm_users
    ADD CONSTRAINT hcm_users_email_key UNIQUE (email);


--
-- Name: hcm_users hcm_users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcm_users
    ADD CONSTRAINT hcm_users_google_id_key UNIQUE (google_id);


--
-- Name: hcm_users hcm_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcm_users
    ADD CONSTRAINT hcm_users_pkey PRIMARY KEY (id);


--
-- Name: holiday_calendar holiday_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holiday_calendar
    ADD CONSTRAINT holiday_calendar_pkey PRIMARY KEY (id);


--
-- Name: inbox_rules inbox_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_rules
    ADD CONSTRAINT inbox_rules_pkey PRIMARY KEY (id);


--
-- Name: intake_messages intake_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intake_messages
    ADD CONSTRAINT intake_messages_pkey PRIMARY KEY (id);


--
-- Name: inventory_issuance inventory_issuance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_issuance
    ADD CONSTRAINT inventory_issuance_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_stock inventory_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_pkey PRIMARY KEY (id);


--
-- Name: invoice_attachments invoice_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_attachments
    ADD CONSTRAINT invoice_attachments_pkey PRIMARY KEY (id);


--
-- Name: invoice_receipt_lines invoice_receipt_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receipt_lines
    ADD CONSTRAINT invoice_receipt_lines_pkey PRIMARY KEY (id);


--
-- Name: invoice_receipts invoice_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receipts
    ADD CONSTRAINT invoice_receipts_pkey PRIMARY KEY (id);


--
-- Name: invoice_schedules invoice_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_schedules
    ADD CONSTRAINT invoice_schedules_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: maintenance_tickets maintenance_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_pkey PRIMARY KEY (id);


--
-- Name: monthly_attendance_overrides monthly_attendance_overrides_employee_id_period_month_perio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_attendance_overrides
    ADD CONSTRAINT monthly_attendance_overrides_employee_id_period_month_perio_key UNIQUE (employee_id, period_month, period_year);


--
-- Name: monthly_attendance_overrides monthly_attendance_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_attendance_overrides
    ADD CONSTRAINT monthly_attendance_overrides_pkey PRIMARY KEY (id);


--
-- Name: onboarding_runs onboarding_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_runs
    ADD CONSTRAINT onboarding_runs_pkey PRIMARY KEY (id);


--
-- Name: onboarding_tasks onboarding_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_tasks
    ADD CONSTRAINT onboarding_tasks_pkey PRIMARY KEY (id);


--
-- Name: onboarding_templates onboarding_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_templates
    ADD CONSTRAINT onboarding_templates_pkey PRIMARY KEY (id);


--
-- Name: ops_inbox_events ops_inbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_inbox_events
    ADD CONSTRAINT ops_inbox_events_pkey PRIMARY KEY (id);


--
-- Name: ot_rate_rules ot_rate_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ot_rate_rules
    ADD CONSTRAINT ot_rate_rules_pkey PRIMARY KEY (id);


--
-- Name: ot_utilization ot_utilization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ot_utilization
    ADD CONSTRAINT ot_utilization_pkey PRIMARY KEY (id);


--
-- Name: payment_batches payment_batches_batch_type_year_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_batches
    ADD CONSTRAINT payment_batches_batch_type_year_month_key UNIQUE (batch_type, year, month);


--
-- Name: payment_batches payment_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_batches
    ADD CONSTRAINT payment_batches_pkey PRIMARY KEY (id);


--
-- Name: payment_ledger payment_ledger_batch_id_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_ledger
    ADD CONSTRAINT payment_ledger_batch_id_employee_id_key UNIQUE (batch_id, employee_id);


--
-- Name: payment_ledger payment_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_ledger
    ADD CONSTRAINT payment_ledger_pkey PRIMARY KEY (id);


--
-- Name: payment_status_change_log payment_status_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_status_change_log
    ADD CONSTRAINT payment_status_change_log_pkey PRIMARY KEY (id);


--
-- Name: payroll_run_rows payroll_run_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_run_rows
    ADD CONSTRAINT payroll_run_rows_pkey PRIMARY KEY (id);


--
-- Name: payroll_runs payroll_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_pkey PRIMARY KEY (id);


--
-- Name: payroll_transactions payroll_transactions_employee_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_transactions
    ADD CONSTRAINT payroll_transactions_employee_id_month_year_key UNIQUE (employee_id, month, year);


--
-- Name: payroll_transactions payroll_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_transactions
    ADD CONSTRAINT payroll_transactions_pkey PRIMARY KEY (id);


--
-- Name: petty_cash_funds petty_cash_funds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_funds
    ADD CONSTRAINT petty_cash_funds_pkey PRIMARY KEY (id);


--
-- Name: petty_cash_funds petty_cash_funds_site_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_funds
    ADD CONSTRAINT petty_cash_funds_site_key UNIQUE (site);


--
-- Name: petty_cash_ledger petty_cash_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.petty_cash_ledger
    ADD CONSTRAINT petty_cash_ledger_pkey PRIMARY KEY (id);


--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);


--
-- Name: portal_claim_approver_packs portal_claim_approver_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_approver_packs
    ADD CONSTRAINT portal_claim_approver_packs_pkey PRIMARY KEY (id);


--
-- Name: portal_claim_approver_packs portal_claim_approver_packs_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_approver_packs
    ADD CONSTRAINT portal_claim_approver_packs_uniq UNIQUE (period_id, approver_email);


--
-- Name: portal_claim_attachments portal_claim_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_attachments
    ADD CONSTRAINT portal_claim_attachments_pkey PRIMARY KEY (id);


--
-- Name: portal_claim_batches portal_claim_batches_period_filler_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_batches
    ADD CONSTRAINT portal_claim_batches_period_filler_uniq UNIQUE (period_id, filler_email);


--
-- Name: portal_claim_batches portal_claim_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_batches
    ADD CONSTRAINT portal_claim_batches_pkey PRIMARY KEY (id);


--
-- Name: portal_claim_items portal_claim_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_items
    ADD CONSTRAINT portal_claim_items_pkey PRIMARY KEY (id);


--
-- Name: portal_claim_periods portal_claim_periods_campaign_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_periods
    ADD CONSTRAINT portal_claim_periods_campaign_uniq UNIQUE (campaign_month, campaign_year);


--
-- Name: portal_claim_periods portal_claim_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_periods
    ADD CONSTRAINT portal_claim_periods_pkey PRIMARY KEY (id);


--
-- Name: portal_claim_submissions portal_claim_submissions_period_emp_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_submissions
    ADD CONSTRAINT portal_claim_submissions_period_emp_uniq UNIQUE (period_id, employee_id);


--
-- Name: portal_claim_submissions portal_claim_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_submissions
    ADD CONSTRAINT portal_claim_submissions_pkey PRIMARY KEY (id);


--
-- Name: portal_otps portal_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_otps
    ADD CONSTRAINT portal_otps_pkey PRIMARY KEY (id);


--
-- Name: procurement_requests procurement_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_pkey PRIMARY KEY (id);


--
-- Name: project_client_focals project_client_focals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_client_focals
    ADD CONSTRAINT project_client_focals_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: public_holidays public_holidays_holiday_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays
    ADD CONSTRAINT public_holidays_holiday_date_key UNIQUE (holiday_date);


--
-- Name: public_holidays public_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays
    ADD CONSTRAINT public_holidays_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: report_dispatch_log report_dispatch_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_dispatch_log
    ADD CONSTRAINT report_dispatch_log_pkey PRIMARY KEY (id);


--
-- Name: report_dispatch_log report_dispatch_log_subscription_id_report_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_dispatch_log
    ADD CONSTRAINT report_dispatch_log_subscription_id_report_date_key UNIQUE (subscription_id, report_date);


--
-- Name: report_subscriptions report_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_subscriptions
    ADD CONSTRAINT report_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: response_sla_tracker response_sla_tracker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_sla_tracker
    ADD CONSTRAINT response_sla_tracker_pkey PRIMARY KEY (id);


--
-- Name: service_log_entries service_log_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_log_entries
    ADD CONSTRAINT service_log_entries_pkey PRIMARY KEY (id);


--
-- Name: service_order_lines service_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_lines
    ADD CONSTRAINT service_order_lines_pkey PRIMARY KEY (id);


--
-- Name: service_orders service_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_pkey PRIMARY KEY (id);


--
-- Name: site_escalation_rules site_escalation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_escalation_rules
    ADD CONSTRAINT site_escalation_rules_pkey PRIMARY KEY (id);


--
-- Name: so_deductions so_deductions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_deductions
    ADD CONSTRAINT so_deductions_pkey PRIMARY KEY (id);


--
-- Name: statutory_filings statutory_filings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_filings
    ADD CONSTRAINT statutory_filings_pkey PRIMARY KEY (id);


--
-- Name: statutory_ledger statutory_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_ledger
    ADD CONSTRAINT statutory_ledger_pkey PRIMARY KEY (id);


--
-- Name: supervisor_teams supervisor_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_teams
    ADD CONSTRAINT supervisor_teams_pkey PRIMARY KEY (id);


--
-- Name: supervisor_teams supervisor_teams_supervisor_email_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_teams
    ADD CONSTRAINT supervisor_teams_supervisor_email_employee_id_key UNIQUE (supervisor_email, employee_id);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (key);


--
-- Name: tax_regulations tax_regulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_regulations
    ADD CONSTRAINT tax_regulations_pkey PRIMARY KEY (id);


--
-- Name: ticket_escalations ticket_escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_escalations
    ADD CONSTRAINT ticket_escalations_pkey PRIMARY KEY (id);


--
-- Name: ticket_escalations ticket_escalations_ticket_id_rule_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_escalations
    ADD CONSTRAINT ticket_escalations_ticket_id_rule_id_key UNIQUE (ticket_id, rule_id);


--
-- Name: uploaded_files uploaded_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendor_payments vendor_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_payments
    ADD CONSTRAINT vendor_payments_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: wafi_claims_items wafi_claims_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_items
    ADD CONSTRAINT wafi_claims_items_pkey PRIMARY KEY (id);


--
-- Name: wafi_claims_reprocess_queue wafi_claims_reprocess_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_reprocess_queue
    ADD CONSTRAINT wafi_claims_reprocess_queue_pkey PRIMARY KEY (gmail_message_id);


--
-- Name: wafi_claims_sessions wafi_claims_sessions_gmail_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_sessions
    ADD CONSTRAINT wafi_claims_sessions_gmail_message_id_key UNIQUE (gmail_message_id);


--
-- Name: wafi_claims_sessions wafi_claims_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_sessions
    ADD CONSTRAINT wafi_claims_sessions_pkey PRIMARY KEY (id);


--
-- Name: wafi_focal_points wafi_focal_points_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_focal_points
    ADD CONSTRAINT wafi_focal_points_email_key UNIQUE (email);


--
-- Name: wafi_focal_points wafi_focal_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_focal_points
    ADD CONSTRAINT wafi_focal_points_pkey PRIMARY KEY (id);


--
-- Name: xero_connections xero_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xero_connections
    ADD CONSTRAINT xero_connections_pkey PRIMARY KEY (id);


--
-- Name: xero_sync_log xero_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xero_sync_log
    ADD CONSTRAINT xero_sync_log_pkey PRIMARY KEY (id);


--
-- Name: archive_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX archive_i1 ON pgboss.archive USING btree (archived_on);


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i1 ON pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i2 ON pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i3 ON pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i4 ON pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_i5 ON pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i1 ON pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i2 ON pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i3 ON pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i4 ON pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_i5 ON pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i1 ON pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i2 ON pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i3 ON pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i4 ON pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_i5 ON pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i1 ON pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i2 ON pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i3 ON pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i4 ON pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_i5 ON pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i1 ON pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i2 ON pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i3 ON pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i4 ON pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_i5 ON pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i1 ON pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i2 ON pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i3 ON pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i4 ON pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_i5 ON pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i1 ON pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i2 ON pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i3 ON pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i4 ON pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_i5 ON pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i1 ON pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i2 ON pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i3 ON pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i4 ON pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_i5 ON pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i1 ON pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i2 ON pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i3 ON pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i4 ON pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_i5 ON pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i1 ON pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i2 ON pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i3 ON pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i4 ON pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_i5 ON pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i1 ON pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i2 ON pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i3 ON pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i4 ON pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_i5 ON pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: benefit_utilization_employee_id_benefit_type_cycle_start_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX benefit_utilization_employee_id_benefit_type_cycle_start_unique ON public.benefit_utilization USING btree (employee_id, benefit_type, cycle_start);


--
-- Name: bill_approval_steps_bill_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_approval_steps_bill_id_idx ON public.bill_approval_steps USING btree (bill_id);


--
-- Name: claim_manual_overrides_period_year_period_month_employee_id_ind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claim_manual_overrides_period_year_period_month_employee_id_ind ON public.claim_manual_overrides USING btree (period_year, period_month, employee_id);


--
-- Name: contract_policies_contract_id_project_id_effective_from_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_policies_contract_id_project_id_effective_from_index ON public.contract_policies USING btree (contract_id, project_id, effective_from);


--
-- Name: cost_allocations_contract_id_period_year_period_month_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cost_allocations_contract_id_period_year_period_month_index ON public.cost_allocations USING btree (contract_id, period_year, period_month);


--
-- Name: idx_att_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_att_date ON public.attendance_records USING btree (date);


--
-- Name: idx_att_emp_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_att_emp_date ON public.attendance_records USING btree (employee_id, date);


--
-- Name: idx_att_marked_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_att_marked_by ON public.attendance_records USING btree (marked_by, date);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_date ON public.attendance_records USING btree (employee_id, date);


--
-- Name: idx_bills_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bills_client ON public.bills USING btree (client);


--
-- Name: idx_bills_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bills_created_by ON public.bills USING btree (created_by);


--
-- Name: idx_bills_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bills_status ON public.bills USING btree (status);


--
-- Name: idx_chgreq_empid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chgreq_empid ON public.employee_change_requests USING btree (employee_id);


--
-- Name: idx_chgreq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chgreq_status ON public.employee_change_requests USING btree (status);


--
-- Name: idx_claims_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_emp ON public.claims_inbox USING btree (employee_id);


--
-- Name: idx_claims_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_month ON public.claims_inbox USING btree (claim_month);


--
-- Name: idx_claims_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_status ON public.claims_inbox USING btree (status);


--
-- Name: idx_client_departments_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_departments_client ON public.client_departments USING btree (client_id);


--
-- Name: idx_client_locations_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_locations_client ON public.client_locations USING btree (client_id);


--
-- Name: idx_client_otps_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_otps_email ON public.client_otps USING btree (email, used);


--
-- Name: idx_cmms_sites_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmms_sites_active ON public.cmms_sites USING btree (active);


--
-- Name: idx_contracts_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_client_id ON public.contracts USING btree (client_id);


--
-- Name: idx_contracts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_status ON public.contracts USING btree (status);


--
-- Name: idx_employees_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_active ON public.employees USING btree (active);


--
-- Name: idx_employees_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_client ON public.employees USING btree (client);


--
-- Name: idx_employees_contract_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_contract_id ON public.employees USING btree (contract_id);


--
-- Name: idx_employees_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_location ON public.employees USING btree (location);


--
-- Name: idx_gratuity_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gratuity_emp ON public.employee_gratuity_ledger USING btree (employee_id);


--
-- Name: idx_leaves_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leaves_status ON public.employee_leaves USING btree (status);


--
-- Name: idx_maint_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maint_due ON public.maintenance_tickets USING btree (due_date, status);


--
-- Name: idx_maint_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maint_site ON public.maintenance_tickets USING btree (site, status);


--
-- Name: idx_payroll_emp_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_emp_month ON public.payroll_transactions USING btree (employee_id, month, year);


--
-- Name: idx_payroll_month_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_month_year ON public.payroll_transactions USING btree (month, year);


--
-- Name: idx_pcf_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcf_contract ON public.project_client_focals USING btree (contract_id);


--
-- Name: idx_pcf_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcf_site ON public.project_client_focals USING btree (site);


--
-- Name: idx_pcf_supervisor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcf_supervisor ON public.project_client_focals USING btree (supervisor_email);


--
-- Name: idx_petty_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_petty_site ON public.petty_cash_ledger USING btree (site, entry_date);


--
-- Name: idx_pf_emp_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pf_emp_month ON public.employee_pf_ledger USING btree (employee_id, month, year);


--
-- Name: idx_sup_team_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sup_team_email ON public.supervisor_teams USING btree (supervisor_email) WHERE (active = true);


--
-- Name: idx_wafi_items_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wafi_items_active ON public.wafi_claims_items USING btree (active);


--
-- Name: idx_wafi_items_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wafi_items_date ON public.wafi_claims_items USING btree (claim_date);


--
-- Name: idx_wafi_items_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wafi_items_employee ON public.wafi_claims_items USING btree (employee_id);


--
-- Name: idx_wafi_items_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wafi_items_session ON public.wafi_claims_items USING btree (session_id);


--
-- Name: idx_wafi_sessions_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wafi_sessions_received ON public.wafi_claims_sessions USING btree (received_at DESC);


--
-- Name: idx_wafi_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wafi_sessions_status ON public.wafi_claims_sessions USING btree (processing_status);


--
-- Name: idx_warnings_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warnings_emp ON public.employee_warnings USING btree (employee_id);


--
-- Name: intake_messages_classification_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intake_messages_classification_index ON public.intake_messages USING btree (classification);


--
-- Name: intake_messages_mailbox_message_uid_unique_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX intake_messages_mailbox_message_uid_unique_index ON public.intake_messages USING btree (mailbox, message_uid) WHERE (message_uid IS NOT NULL);


--
-- Name: intake_messages_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intake_messages_status_index ON public.intake_messages USING btree (status);


--
-- Name: ot_utilization_project_id_period_year_period_month_unique_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ot_utilization_project_id_period_year_period_month_unique_index ON public.ot_utilization USING btree (project_id, period_year, period_month);


--
-- Name: payroll_run_rows_run_id_employee_id_unique_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payroll_run_rows_run_id_employee_id_unique_index ON public.payroll_run_rows USING btree (run_id, employee_id);


--
-- Name: payroll_runs_contract_id_period_month_period_year_unique_index; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payroll_runs_contract_id_period_month_period_year_unique_index ON public.payroll_runs USING btree (contract_id, period_month, period_year);


--
-- Name: portal_claim_attachments_retain_until_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_claim_attachments_retain_until_index ON public.portal_claim_attachments USING btree (retain_until);


--
-- Name: portal_claim_attachments_submission_id_category_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_claim_attachments_submission_id_category_index ON public.portal_claim_attachments USING btree (submission_id, category);


--
-- Name: portal_claim_attachments_submission_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_claim_attachments_submission_id_index ON public.portal_claim_attachments USING btree (submission_id);


--
-- Name: portal_claim_items_submission_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_claim_items_submission_id_index ON public.portal_claim_items USING btree (submission_id);


--
-- Name: portal_claim_submissions_approver_email_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_claim_submissions_approver_email_index ON public.portal_claim_submissions USING btree (approver_email);


--
-- Name: portal_claim_submissions_channel_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_claim_submissions_channel_index ON public.portal_claim_submissions USING btree (channel);


--
-- Name: portal_claim_submissions_period_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_claim_submissions_period_id_status_index ON public.portal_claim_submissions USING btree (period_id, status);


--
-- Name: projects_client_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_client_id_index ON public.projects USING btree (client_id);


--
-- Name: projects_contract_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_contract_id_index ON public.projects USING btree (contract_id);


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84_pkey;


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey;


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae_pkey;


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c_pkey;


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270_pkey;


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95_pkey;


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd_pkey;


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab_pkey;


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7_pkey;


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592_pkey;


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc_pkey;


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53_pkey;


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j39097eb588872977f537af2757335040ca048ad26dfece3838c7da84
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j419714b57d6063b614a831c69b7f76e4de0c2f4b0c52c12ad331bbae
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j4f33edad0492afaf71f4bd08da7eace9fb3a6857610115c3dc5a471c
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j58a4b2f143c1ef87e08bdb2eb00c9964dc319a273ea53aa1a8404270
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j5f8d82fd2992fe417d8f2e44e991a6bf7a990989612bee4d29601e95
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j6473c5238ea22ae7945a7b824b814ce69e9a08085ac177728d61b1dd
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jadc3c4acb487bfff27e1c3a73787918ad3c838327a05b3a8d8d5e2ab
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb0fa731cb977d362fae7c33bbb46c88305a9e2d7b66249e8cbcdc7c7
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jb90ae353f30fb04b0eaea78c08d21156040d99a172ff08eea4632592
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jcba7f860a415c6340df496c93eb08d08b6ea4c819f4ef0e0af4cf9bc
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.jdceafcce313f630eef9d9b47ea38065559453e18b25afef234a16c53
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: queue queue_dead_letter_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_dead_letter_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name);


--
-- Name: schedule schedule_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: subscription subscription_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: attendance_alert_rules attendance_alert_rules_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alert_rules
    ADD CONSTRAINT attendance_alert_rules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: attendance_alerts_log attendance_alerts_log_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_alerts_log
    ADD CONSTRAINT attendance_alerts_log_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.attendance_alert_rules(id) ON DELETE SET NULL;


--
-- Name: attendance_parser_profiles attendance_parser_profiles_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_parser_profiles
    ADD CONSTRAINT attendance_parser_profiles_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: attendance_parser_profiles attendance_parser_profiles_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_parser_profiles
    ADD CONSTRAINT attendance_parser_profiles_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: attendance_records attendance_records_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: bd_outreach_log bd_outreach_log_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_outreach_log
    ADD CONSTRAINT bd_outreach_log_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.bd_leads(id) ON DELETE CASCADE;


--
-- Name: bd_renewals bd_renewals_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_renewals
    ADD CONSTRAINT bd_renewals_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: benefit_policies benefit_policies_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benefit_policies
    ADD CONSTRAINT benefit_policies_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: benefit_utilization benefit_utilization_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benefit_utilization
    ADD CONSTRAINT benefit_utilization_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: benefit_utilization benefit_utilization_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benefit_utilization
    ADD CONSTRAINT benefit_utilization_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: bill_approval_steps bill_approval_steps_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_approval_steps
    ADD CONSTRAINT bill_approval_steps_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bill_documents bill_documents_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_documents
    ADD CONSTRAINT bill_documents_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bills bills_budget_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_budget_line_id_fkey FOREIGN KEY (budget_line_id) REFERENCES public.contract_budget_lines(id) ON DELETE SET NULL;


--
-- Name: bills bills_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: claim_manual_overrides claim_manual_overrides_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_manual_overrides
    ADD CONSTRAINT claim_manual_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: claims_inbox claims_inbox_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_inbox
    ADD CONSTRAINT claims_inbox_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: client_departments client_departments_bu_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments
    ADD CONSTRAINT client_departments_bu_id_fkey FOREIGN KEY (bu_id) REFERENCES public.client_business_units(id) ON DELETE SET NULL;


--
-- Name: client_departments client_departments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments
    ADD CONSTRAINT client_departments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_departments client_departments_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments
    ADD CONSTRAINT client_departments_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.client_locations(id) ON DELETE SET NULL;


--
-- Name: client_locations client_locations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_locations
    ADD CONSTRAINT client_locations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_locations client_locations_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_locations
    ADD CONSTRAINT client_locations_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: contract_bid_actuals contract_bid_actuals_bid_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_bid_actuals
    ADD CONSTRAINT contract_bid_actuals_bid_item_id_fkey FOREIGN KEY (bid_item_id) REFERENCES public.contract_bid_items(id) ON DELETE CASCADE;


--
-- Name: contract_budget_lines contract_budget_lines_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_budget_lines
    ADD CONSTRAINT contract_budget_lines_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_budget_lines contract_budget_lines_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_budget_lines
    ADD CONSTRAINT contract_budget_lines_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: contract_policies contract_policies_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_policies
    ADD CONSTRAINT contract_policies_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_policies contract_policies_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_policies
    ADD CONSTRAINT contract_policies_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: contract_rate_cards contract_rate_cards_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_rate_cards
    ADD CONSTRAINT contract_rate_cards_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_rate_cards contract_rate_cards_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_rate_cards
    ADD CONSTRAINT contract_rate_cards_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: cost_allocations cost_allocations_budget_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_allocations
    ADD CONSTRAINT cost_allocations_budget_line_id_fkey FOREIGN KEY (budget_line_id) REFERENCES public.contract_budget_lines(id) ON DELETE SET NULL;


--
-- Name: cost_allocations cost_allocations_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_allocations
    ADD CONSTRAINT cost_allocations_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: cost_allocations cost_allocations_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_allocations
    ADD CONSTRAINT cost_allocations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: employee_claims employee_claims_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_claims
    ADD CONSTRAINT employee_claims_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: employee_claims employee_claims_intake_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_claims
    ADD CONSTRAINT employee_claims_intake_message_id_fkey FOREIGN KEY (intake_message_id) REFERENCES public.intake_messages(id) ON DELETE SET NULL;


--
-- Name: employee_claims employee_claims_payroll_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_claims
    ADD CONSTRAINT employee_claims_payroll_run_id_fkey FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id) ON DELETE SET NULL;


--
-- Name: employee_warnings employee_warnings_ack_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_warnings
    ADD CONSTRAINT employee_warnings_ack_file_id_fkey FOREIGN KEY (ack_file_id) REFERENCES public.uploaded_files(id);


--
-- Name: employees employees_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: inbox_rules inbox_rules_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_rules
    ADD CONSTRAINT inbox_rules_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: inventory_issuance inventory_issuance_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_issuance
    ADD CONSTRAINT inventory_issuance_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT;


--
-- Name: inventory_stock inventory_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: invoice_attachments invoice_attachments_filing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_attachments
    ADD CONSTRAINT invoice_attachments_filing_id_fkey FOREIGN KEY (filing_id) REFERENCES public.statutory_filings(id) ON DELETE SET NULL;


--
-- Name: invoice_receipt_lines invoice_receipt_lines_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receipt_lines
    ADD CONSTRAINT invoice_receipt_lines_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.invoice_receipts(id) ON DELETE CASCADE;


--
-- Name: invoice_schedules invoice_schedules_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_schedules
    ADD CONSTRAINT invoice_schedules_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: maintenance_tickets maintenance_tickets_photo_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_photo_file_id_fkey FOREIGN KEY (photo_file_id) REFERENCES public.uploaded_files(id);


--
-- Name: monthly_attendance_overrides monthly_attendance_overrides_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_attendance_overrides
    ADD CONSTRAINT monthly_attendance_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: onboarding_runs onboarding_runs_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_runs
    ADD CONSTRAINT onboarding_runs_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: onboarding_runs onboarding_runs_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_runs
    ADD CONSTRAINT onboarding_runs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.bd_leads(id) ON DELETE SET NULL;


--
-- Name: onboarding_tasks onboarding_tasks_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_tasks
    ADD CONSTRAINT onboarding_tasks_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.onboarding_runs(id) ON DELETE CASCADE;


--
-- Name: ops_inbox_events ops_inbox_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_inbox_events
    ADD CONSTRAINT ops_inbox_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: ops_inbox_events ops_inbox_events_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_inbox_events
    ADD CONSTRAINT ops_inbox_events_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: ops_inbox_events ops_inbox_events_intake_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_inbox_events
    ADD CONSTRAINT ops_inbox_events_intake_message_id_fkey FOREIGN KEY (intake_message_id) REFERENCES public.intake_messages(id) ON DELETE CASCADE;


--
-- Name: ot_utilization ot_utilization_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ot_utilization
    ADD CONSTRAINT ot_utilization_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: ot_utilization ot_utilization_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ot_utilization
    ADD CONSTRAINT ot_utilization_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: payroll_run_rows payroll_run_rows_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_run_rows
    ADD CONSTRAINT payroll_run_rows_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.payroll_runs(id) ON DELETE CASCADE;


--
-- Name: payroll_runs payroll_runs_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: payroll_transactions payroll_transactions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_transactions
    ADD CONSTRAINT payroll_transactions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: portal_claim_approver_packs portal_claim_approver_packs_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_approver_packs
    ADD CONSTRAINT portal_claim_approver_packs_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.portal_claim_periods(id) ON DELETE CASCADE;


--
-- Name: portal_claim_attachments portal_claim_attachments_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_attachments
    ADD CONSTRAINT portal_claim_attachments_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.portal_claim_items(id) ON DELETE SET NULL;


--
-- Name: portal_claim_attachments portal_claim_attachments_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_attachments
    ADD CONSTRAINT portal_claim_attachments_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.portal_claim_submissions(id) ON DELETE CASCADE;


--
-- Name: portal_claim_batches portal_claim_batches_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_batches
    ADD CONSTRAINT portal_claim_batches_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.portal_claim_periods(id) ON DELETE CASCADE;


--
-- Name: portal_claim_items portal_claim_items_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_items
    ADD CONSTRAINT portal_claim_items_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.portal_claim_submissions(id) ON DELETE CASCADE;


--
-- Name: portal_claim_submissions portal_claim_submissions_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_submissions
    ADD CONSTRAINT portal_claim_submissions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.portal_claim_batches(id) ON DELETE SET NULL;


--
-- Name: portal_claim_submissions portal_claim_submissions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_submissions
    ADD CONSTRAINT portal_claim_submissions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: portal_claim_submissions portal_claim_submissions_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_claim_submissions
    ADD CONSTRAINT portal_claim_submissions_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.portal_claim_periods(id) ON DELETE CASCADE;


--
-- Name: procurement_requests procurement_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: procurement_requests procurement_requests_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: procurement_requests procurement_requests_intake_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_intake_message_id_fkey FOREIGN KEY (intake_message_id) REFERENCES public.intake_messages(id) ON DELETE SET NULL;


--
-- Name: procurement_requests procurement_requests_linked_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_linked_bill_id_fkey FOREIGN KEY (linked_bill_id) REFERENCES public.bills(id) ON DELETE SET NULL;


--
-- Name: procurement_requests procurement_requests_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: projects projects_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: projects projects_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: report_dispatch_log report_dispatch_log_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_dispatch_log
    ADD CONSTRAINT report_dispatch_log_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.report_subscriptions(id);


--
-- Name: response_sla_tracker response_sla_tracker_intake_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_sla_tracker
    ADD CONSTRAINT response_sla_tracker_intake_message_id_fkey FOREIGN KEY (intake_message_id) REFERENCES public.intake_messages(id) ON DELETE CASCADE;


--
-- Name: service_log_entries service_log_entries_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_log_entries
    ADD CONSTRAINT service_log_entries_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.service_order_lines(id) ON DELETE SET NULL;


--
-- Name: service_log_entries service_log_entries_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_log_entries
    ADD CONSTRAINT service_log_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: service_log_entries service_log_entries_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_log_entries
    ADD CONSTRAINT service_log_entries_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE SET NULL;


--
-- Name: service_order_lines service_order_lines_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_lines
    ADD CONSTRAINT service_order_lines_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE CASCADE;


--
-- Name: service_orders service_orders_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: service_orders service_orders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: so_deductions so_deductions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_deductions
    ADD CONSTRAINT so_deductions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: so_deductions so_deductions_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_deductions
    ADD CONSTRAINT so_deductions_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.service_order_lines(id) ON DELETE SET NULL;


--
-- Name: so_deductions so_deductions_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_deductions
    ADD CONSTRAINT so_deductions_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE CASCADE;


--
-- Name: statutory_ledger statutory_ledger_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_ledger
    ADD CONSTRAINT statutory_ledger_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: statutory_ledger statutory_ledger_regulation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_ledger
    ADD CONSTRAINT statutory_ledger_regulation_id_fkey FOREIGN KEY (regulation_id) REFERENCES public.tax_regulations(id) ON DELETE SET NULL;


--
-- Name: supervisor_teams supervisor_teams_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_teams
    ADD CONSTRAINT supervisor_teams_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: ticket_escalations ticket_escalations_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_escalations
    ADD CONSTRAINT ticket_escalations_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.site_escalation_rules(id);


--
-- Name: ticket_escalations ticket_escalations_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_escalations
    ADD CONSTRAINT ticket_escalations_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.maintenance_tickets(id);


--
-- Name: vendor_payments vendor_payments_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_payments
    ADD CONSTRAINT vendor_payments_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: wafi_claims_items wafi_claims_items_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_items
    ADD CONSTRAINT wafi_claims_items_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: wafi_claims_items wafi_claims_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wafi_claims_items
    ADD CONSTRAINT wafi_claims_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.wafi_claims_sessions(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict w9uxI0xxWhQrHx9fcxxQlAxWI6SdG2XGJ6pgmJHc039oX9JJmb4esQ5jlbbwKwy

