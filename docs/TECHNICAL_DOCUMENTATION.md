# Technical Documentation — AI Development Lifecycle & Responsible Deployment Readiness Assistant

## 1. System Architecture

The application is a modular full-stack web system built with:
- **Server Runtime**: Node.js 22 + Express (`server.ts`, `server/app.ts`) serving both the REST API (`/api/*`) and the React client (`dist/` in production or Vite middleware in development) on port `3000`.
- **Database Layer**: Unified `DbClient` (`server/db.ts`) supporting:
  - **SQLite** (`node:sqlite`, `server/migrations/001_sqlite.sql`) for single-instance local development.
  - **PostgreSQL 16** (`pg`, `server/migrations/001_postgres.sql`, `postgres_init.sql`) for production deployment via `DATABASE_URL`.
- **Client UI**: React 19 + TypeScript + Tailwind CSS v4 (`src/`) communicating exclusively over authenticated JSON/multipart REST APIs. All visualisations (Stage Readiness chart, Risk Distribution chart, Evaluation F1 chart, and interactive Knowledge Graph) use accessible inline SVG paired with text summaries.
- **Zero External LLMs**: No generative AI or external model inference APIs are called. All readiness verdicts, scoring, rule traces, and policy retrieval run deterministically on the server.

---

## 2. Data Model & Schema

Core relational tables (`server/migrations/001_sqlite.sql` and `001_postgres.sql`):
- `users`: `id`, `email`, `full_name`, `role` (`ADMIN`, `PROJECT_OWNER`, `REVIEWER`, `RISK_ACCEPTANCE_AUTHORITY`), `password_hash` (`bcryptjs`), `is_active`, `force_password_change`, `failed_login_attempts`, `locked_until`, `is_demo`.
- `sessions`: server-stored HttpOnly session tokens (`id`, `user_id`, `csrf_token`, `expires_at`).
- `projects`: AI project metadata (`deployment_autonomy`, `affects_academic_standing`, `data_sensitivity`, `uses_synthetic_data`, `uses_third_party_wrapper`, `is_low_risk_admin_script`, `workflow_state`, `owner_id`, `assigned_reviewer_id`).
- `project_evidence`: 21 evidence rows per project (`artefact_id`, `status`, `notes`, `file_name`, `file_checksum`, `external_link`, `expiry_date`, `missingness_pct`).
- `fairness_checks`: Stage 3 subgroup metric array, computed `max_gap`, `tolerance_used`, and `passed` flag.
- `exceptions`: scoped, time-bound exception requests (`target_type`, `target_id`, `rationale`, `expiry_date`, `status`, `reviewer_id`, `reviewer_comment`).
- `risk_acceptances`: formal risk acceptance records created exclusively by `RISK_ACCEPTANCE_AUTHORITY` (`risk_id`, `approver_id`, `rationale`, `scope`, `expiry_date`, `status`).
- `review_comments`: immutable reviewer and owner review history notes.
- `rules`: editable rule activation records (`R1`–`R12`).
- `policy_clauses`: 38 original university & reference policy clauses (`clause_id`, `source`, `section_number`, `title`, `text`, `tags_json`, `related_clause_ids_json`, `is_active`).
- `assessment_runs`: persisted deterministic execution traces (`result_json`, `overall_readiness`, `release_locked`).
- `benchmark_cases` & `evaluation_runs`: 36 independent benchmark cases (`n = 36`: 12 normal, 12 edge, 12 incomplete) and evaluation metrics.
- `audit_chain_head` & `audit_logs`: gapless, hash-chained append-only audit log (`seq_num`, `prev_hash`, `entry_hash`).

---

## 3. Algorithms

### 3.1 Forward-Chaining Production Rule Engine (`server/ruleEngine.ts`)
1. **Working Memory Initialization**: Loads all 21 artefact statuses (`Not submitted`, `Submitted but unverified`, `Verified`, `Unclear`, `Expired`), project risk attributes, Stage 3 fairness parity check pass/fail, Stage 1 schema missingness threshold comparison, and non-expired approved exceptions / active formal risk acceptances.
2. **Iterative Rule Chaining**: Evaluates enabled rules (`BLOCKING` -> `EXCEPTION` -> `WARNING` -> `INFO`, ordered by priority descending) up to `MAX_ITERATIONS = 50`:
   - Derives facts (`gate_open(stage)`, `effective_gate_open(stage)`, `high_risk_open`, `stage_complete(stage)`, `stage_needs_review(stage)`).
   - Rule `R10` (`Automated Readiness Clearance Derivation`) chains strictly on derived facts (`stage_complete(1..6)`, absence of `gate_open(stage)`, zero reliance on exceptions, and `high_risk_open = false`).
3. **Conflict Detection & Scoped Exception Resolution**:
   - Detects conflicts where both a `BLOCKING` rule and an `EXCEPTION` rule fire on the same stage (e.g., `R2` vs `R8`, `R4` vs `R9`).
   - An approved, in-date exception only overrides a blocking rule if the exception explicitly names the blocking rule ID or one of the blocker's exact `targetArtefacts` (e.g., an `R8` exception for `provenance_log` never clears `R2` for `dataset_datasheet`).

### 3.2 Readiness Scoring & Gate Model (`server/scoring.ts`)
- **Stage Readiness ($R_s$)**:
  $$R_s = \sum_{a \in \text{Stage}(s)} w_a \cdot v_a$$
  where $\sum w_a = 1.00$ per stage and $v_a = 1$ iff artefact $a$ is `Verified` and in-date.
- **Stage Gate ($G_s$)**: $G_s = 1$ iff every blocking artefact in Stage $s$ is `Verified` and in-date and no rule-level gate blocks Stage $s$.
- **Effective Gate ($\text{effective } G_s$)**: Accounts for active, in-date approved exceptions for review eligibility only; release clearance still requires $G_s = 1$.
- **Score High but Gate Locked**: Explicitly flagged whenever $R_s \ge \text{readiness\_threshold}$ while $G_s = 0$.

### 3.3 Grounded Hybrid Policy Retrieval (`server/retrieval.ts`)
Implemented from scratch without external NLP libraries:
1. **Preprocessing**: Lowercase normalization, punctuation stripping, stop-word filtering, and deterministic suffix stemming.
2. **BM25**: Computes IDF and length-normalized TF scores with configurable `bm25_k1` (default `1.5`) and `bm25_b` (default `0.75`).
3. **TF-IDF Cosine Similarity**: Computes TF-IDF document and query vectors and their cosine similarity.
4. **Min-Max Normalization & Hybrid Fusion**: Normalizes BM25 and TF-IDF scores independently to $[0, 1]$ across active clauses (with zero-guard when $\max = 0$), then blends via:
   $$\text{hybrid} = w \cdot \text{BM25}_{\text{norm}} + (1 - w) \cdot \text{TFIDF}_{\text{norm}}$$
5. **Confidence & Two-Hop Linking**: Classifies top matches into `High`, `Medium`, or `Low` confidence (`needsHumanInspection = true` on `Low`), records matched terms, and resolves `related_clause_ids` up to 2 hops.

---

## 4. Security, Accountability & Deployment

- **Authentication & Sessions**: `bcryptjs` password hashing (`10` rounds), `HttpOnly`, `SameSite=Lax` cookies, per-session `X-CSRF-Token` validation on state-changing routes, login rate-limiting + lockout, and Helmet security headers.
- **Server-Enforced RBAC & Separation of Duties**:
  - `PROJECT_OWNER` can edit only own projects and cannot set `Verified`.
  - `REVIEWER` cannot verify artefacts, decide exceptions, or sign off on projects they own, and cannot overwrite owner evidence notes/links/measurements.
  - `RISK_ACCEPTANCE_AUTHORITY` is the only role permitted to create formal risk acceptances (only for `acceptable_under_policy = true` risks).
- **Workflow State Machine (`server/workflow.ts`)**: Rejects skipped stages, checks expiry before every transition, and keeps release locked while any high risk or effective gate remains open.
- **Audit Immutability**:
  - **PostgreSQL**: Ordinary app DB role (`ai_gov_app`) has `SELECT`-only access on `audit_logs` and writes strictly via `SECURITY DEFINER` function `append_audit_entry(...)` using `SELECT ... FOR UPDATE` on `audit_chain_head`, `UNIQUE(seq_num)`, `UNIQUE(prev_hash)`, and `UPDATE`/`DELETE`/`TRUNCATE` triggers.
  - **SQLite (dev only)**: Uses `BEGIN IMMEDIATE` serialized transactions and `BEFORE UPDATE`/`BEFORE DELETE` abort triggers.
- **Deployment**: Run `docker compose up --build` (configured in `Dockerfile`, `docker-compose.yml`, and `postgres_init.sql`).
