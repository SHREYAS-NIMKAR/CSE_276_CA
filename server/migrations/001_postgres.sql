-- PostgreSQL schema with database-level role separation and concurrency-safe hash-chained audit log

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PROJECT_OWNER', 'REVIEWER', 'ADMIN', 'RISK_ACCEPTANCE_AUTHORITY')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  identifier TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  first_failure_at TEXT NOT NULL,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  missingness_threshold DOUBLE PRECISION NOT NULL,
  parity_tolerance DOUBLE PRECISION NOT NULL,
  readiness_threshold DOUBLE PRECISION NOT NULL,
  retrieval_high_threshold DOUBLE PRECISION NOT NULL,
  retrieval_medium_threshold DOUBLE PRECISION NOT NULL,
  hybrid_weight DOUBLE PRECISION NOT NULL,
  bm25_k1 DOUBLE PRECISION NOT NULL,
  bm25_b DOUBLE PRECISION NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BLOCKING', 'EXCEPTION', 'WARNING', 'INFO')),
  priority INTEGER NOT NULL,
  stage INTEGER NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('High', 'Medium', 'Low')),
  supported_governance_req TEXT NOT NULL,
  condition_summary TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_clauses (
  clause_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  section_number TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  related_clause_ids_json TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  assigned_reviewer_id TEXT NOT NULL REFERENCES users(id),
  deployment_autonomy TEXT NOT NULL CHECK (deployment_autonomy IN ('advisory', 'automated_action')),
  affects_academic_standing BOOLEAN NOT NULL DEFAULT FALSE,
  data_sensitivity TEXT NOT NULL CHECK (data_sensitivity IN ('low', 'medium', 'high')),
  uses_synthetic_data BOOLEAN NOT NULL DEFAULT FALSE,
  uses_third_party_wrapper BOOLEAN NOT NULL DEFAULT FALSE,
  is_low_risk_admin_script BOOLEAN NOT NULL DEFAULT FALSE,
  target_user_population TEXT NOT NULL,
  workflow_state TEXT NOT NULL DEFAULT 'Draft',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artefact_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Not submitted', 'Submitted', 'Verified', 'Unclear')),
  notes TEXT NOT NULL DEFAULT '',
  file_name TEXT,
  file_path TEXT,
  file_size INTEGER,
  file_checksum TEXT,
  external_link TEXT,
  expiry_date TEXT,
  missingness_pct DOUBLE PRECISION,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, artefact_id)
);

CREATE TABLE IF NOT EXISTS fairness_checks (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  cohorts_json TEXT NOT NULL,
  max_gap DOUBLE PRECISION,
  tolerance_used DOUBLE PRECISION NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('rule', 'artefact')),
  target_id TEXT NOT NULL,
  rationale TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Expired')),
  reviewer_id TEXT REFERENCES users(id),
  reviewer_comment TEXT,
  reviewed_at TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_acceptances (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_id TEXT NOT NULL,
  approver_id TEXT NOT NULL REFERENCES users(id),
  rationale TEXT NOT NULL,
  scope TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Expired', 'Revoked')),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  action_type TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  triggered_by TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Hash-chained append-only audit log with single chain-head lock row
CREATE TABLE IF NOT EXISTS audit_chain_head (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_seq_num INTEGER NOT NULL,
  last_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  seq_num INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  user_id TEXT,
  user_email TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  project_id TEXT,
  details TEXT NOT NULL,
  rationale TEXT,
  expiry_date TEXT,
  source_ip TEXT,
  prev_hash TEXT UNIQUE NOT NULL,
  entry_hash TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO audit_chain_head (id, last_seq_num, last_hash)
VALUES (1, 0, 'GENESIS')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit log is append-only; % is prohibited.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update_delete ON audit_logs;
CREATE TRIGGER audit_no_update_delete
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

DROP TRIGGER IF EXISTS audit_no_truncate ON audit_logs;
CREATE TRIGGER audit_no_truncate
BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- Controlled SECURITY DEFINER function for atomic concurrency-safe audit writes
CREATE OR REPLACE FUNCTION append_audit_entry(
  p_created_at TEXT,
  p_user_id TEXT,
  p_user_email TEXT,
  p_user_role TEXT,
  p_action TEXT,
  p_project_id TEXT,
  p_details TEXT,
  p_rationale TEXT,
  p_expiry_date TEXT,
  p_source_ip TEXT,
  p_is_demo BOOLEAN,
  p_entry_hash_override TEXT DEFAULT NULL
)
RETURNS TABLE(seq_num INTEGER, prev_hash TEXT, entry_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_seq INTEGER;
  v_last_hash TEXT;
  v_next_seq INTEGER;
  v_hash TEXT;
BEGIN
  SELECT last_seq_num, last_hash INTO v_last_seq, v_last_hash
  FROM audit_chain_head
  WHERE id = 1
  FOR UPDATE;

  v_next_seq := v_last_seq + 1;
  v_hash := COALESCE(
    p_entry_hash_override,
    encode(
      sha256(
        convert_to(
          v_next_seq::text || '|' || p_created_at || '|' || COALESCE(p_user_id, '') || '|' ||
          COALESCE(p_user_role, '') || '|' || p_action || '|' || COALESCE(p_project_id, '') || '|' ||
          p_details || '|' || COALESCE(p_rationale, '') || '|' || COALESCE(p_expiry_date, '') || '|' ||
          COALESCE(p_source_ip, '') || '|' || v_last_hash,
          'UTF8'
        )
      ),
      'hex'
    )
  );

  INSERT INTO audit_logs (
    seq_num, created_at, user_id, user_email, user_role, action, project_id,
    details, rationale, expiry_date, source_ip, prev_hash, entry_hash, is_demo
  ) VALUES (
    v_next_seq, p_created_at, p_user_id, p_user_email, p_user_role, p_action, p_project_id,
    p_details, p_rationale, p_expiry_date, p_source_ip, v_last_hash, v_hash, p_is_demo
  );

  UPDATE audit_chain_head
  SET last_seq_num = v_next_seq, last_hash = v_hash
  WHERE id = 1;

  RETURN QUERY SELECT v_next_seq, v_last_hash, v_hash;
END;
$$;

CREATE TABLE IF NOT EXISTS benchmark_cases (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('normal', 'edge', 'incomplete')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  assumptions_json TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL,
  evidence_snapshot_json TEXT NOT NULL,
  ground_truth_missing_json TEXT NOT NULL,
  ground_truth_gates_json TEXT NOT NULL,
  ground_truth_clauses_json TEXT NOT NULL,
  needs_two_hop BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id TEXT PRIMARY KEY,
  run_by TEXT,
  settings_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  per_case_json TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_activity (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_visits (
  id TEXT PRIMARY KEY,
  visited_at TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer TEXT,
  user_id TEXT,
  user_email TEXT
);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('PROJECT_OWNER', 'REVIEWER', 'RISK_ACCEPTANCE_AUTHORITY')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  source_ip TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

