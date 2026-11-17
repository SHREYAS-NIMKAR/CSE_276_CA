-- PostgreSQL database-level privilege separation for audit-log integrity (Section 15D)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'localdev_app_pw';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ai_governance TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- Grant normal CRUD on application tables, but NOT audit_logs / audit_chain_head
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
GRANT CREATE ON SCHEMA public TO app_user;
