CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PROJECT_OWNER', 'REVIEWER', 'ADMIN', 'RISK_ACCEPTANCE_AUTHORITY')),
  is_active INTEGER NOT NULL DEFAULT 1,
  force_password_change INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
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
  missingness_threshold REAL NOT NULL,
  parity_tolerance REAL NOT NULL,
  readiness_threshold REAL NOT NULL,
  retrieval_high_threshold REAL NOT NULL,
  retrieval_medium_threshold REAL NOT NULL,
  hybrid_weight REAL NOT NULL,
  bm25_k1 REAL NOT NULL,
  bm25_b REAL NOT NULL,
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
  enabled INTEGER NOT NULL DEFAULT 1,
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
  is_active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  assigned_reviewer_id TEXT NOT NULL REFERENCES users(id),
  deployment_autonomy TEXT NOT NULL CHECK (deployment_autonomy IN ('advisory', 'automated_action')),
  affects_academic_standing INTEGER NOT NULL DEFAULT 0,
  data_sensitivity TEXT NOT NULL CHECK (data_sensitivity IN ('low', 'medium', 'high')),
  uses_synthetic_data INTEGER NOT NULL DEFAULT 0,
  uses_third_party_wrapper INTEGER NOT NULL DEFAULT 0,
  is_low_risk_admin_script INTEGER NOT NULL DEFAULT 0,
  target_user_population TEXT NOT NULL,
  workflow_state TEXT NOT NULL DEFAULT 'Draft',
  is_demo INTEGER NOT NULL DEFAULT 0,
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
  missingness_pct REAL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, artefact_id)
);

CREATE TABLE IF NOT EXISTS fairness_checks (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  cohorts_json TEXT NOT NULL,
  max_gap REAL,
  tolerance_used REAL NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
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
  is_demo INTEGER NOT NULL DEFAULT 0,
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
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  action_type TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  triggered_by TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

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
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER IF NOT EXISTS audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit log is append-only; UPDATE is prohibited.');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'Audit log is append-only; DELETE is prohibited.');
END;

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
  needs_two_hop INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id TEXT PRIMARY KEY,
  run_by TEXT,
  settings_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  per_case_json TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 1,
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

