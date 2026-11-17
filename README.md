# AI Development Lifecycle and Responsible Deployment Readiness Assistant

A full-stack university AI-governance platform modelling a 6-stage AI development lifecycle, enforcing server-side readiness checks via a forward-chaining production rule engine, grounding policy guidance via from-scratch BM25 and TF-IDF cosine hybrid retrieval, comparing against a regex/checklist baseline on an independent 36-case demonstration benchmark, and maintaining an accountable, hash-chained audit trail.

> **Demonstration Notice:** Seeded users, projects, policy clauses, exceptions, and benchmark results are marked `DEMO` (`is_demo = true`) and are **not** real institutional approvals or governance decisions.

---

## 1. Architecture Overview

- **Backend**: TypeScript + Express REST API (`server.ts`, `server/`) with Auto-generated OpenAPI 3.0.3 specification (`/api/openapi.json`) and interactive documentation (`/api/docs`).
- **Database**: Dual adapter (`server/db.ts`) supporting **SQLite** (`node:sqlite`, local development only) and **PostgreSQL 16** (`pg`, production deployment via `DATABASE_URL`).
- **Frontend**: React 19 + Vite + Tailwind CSS v4 (`src/`) communicating exclusively with the documented REST API. Charts and the interactive Knowledge Graph are rendered using accessible inline SVG.
- **Zero External AI / LLM APIs**: All rule evaluation, scoring, and policy retrieval run deterministically on the server.

### Core Modules (`server/`)
- `knowledge.ts`: 6-stage lifecycle ontology, 21 artefacts (stage weights normalized to `1.0`), risks (`acceptable_under_policy` flags), governance requirements, and JSON-LD builder.
- `ruleEngine.ts`: Genuine forward-chaining engine (`R1`–`R12`) with working memory, dependency chaining (`R10` depends on derived `gate_open(stage)` and `high_risk_open`), conflict detection/resolution, and execution traces.
- `scoring.ts`: Stage readiness $R_s$, binary gate $G_s$, effective gate (checking in-date approved exceptions), and `"Score high but gate locked"` detection.
- `retrieval.ts`: From-scratch tokenization, stop-word removal, suffix stemming, BM25 ($k_1, b$), TF-IDF cosine similarity, `[0, 1]` normalization, hybrid weighting, confidence routing (`High`/`Medium`/`Low`), and 2-hop related clause retrieval.
- `workflow.ts`: Server-enforced state machine (`Draft` → `Automated Check Passed` / `Exception Requested` → `Exception-Based Review Eligible` → `Reviewer Sign-Off` → `Cleared for Controlled Release`), separation of duties, formal risk acceptance rules, and scheduled expiry checks.
- `audit.ts`: Hash-chained append-only audit log with SHA-256 verification.
- `baseline.ts` & `evaluation.ts`: Regex keyword + static checklist baseline vs Governance Engine benchmark across 36 independent ground-truth cases (`n = 36`: 12 normal, 12 edge, 12 incomplete).
- `reports.ts`: Server-side PDF governance report generator (`pdfkit`), CSV formula-safe exporter, and OpenAPI spec.

See [`docs/TECHNICAL_DOCUMENTATION.md`](docs/TECHNICAL_DOCUMENTATION.md) for detailed architecture, database schema, scoring/retrieval math, and deployment specifications.

---

## 2. Demonstration Credentials

Registration is restricted to Administrators (`ADMIN`). Use these seeded demonstration accounts to explore every role:

| Role | Email | Password | Capabilities |
|---|---|---|---|
| **ADMIN** | `admin@univ-ai.edu` | `AdminGov!2026` | Manage users, rules, settings, policy corpus, verify audit chain, run self-tests |
| **PROJECT_OWNER** | `maya.patel@univ-ai.edu` | `OwnerMaya!2026` | Create projects, edit evidence & fairness metrics on own projects, request exceptions |
| **PROJECT_OWNER** | `liam.chen@univ-ai.edu` | `OwnerLiam!2026` | Create/edit own projects (owns the synthetic-data edge project) |
| **REVIEWER** | `dr.sara.okafor@univ-ai.edu` | `ReviewSara!2026` | View all projects, verify artefacts, approve/reject exceptions, record sign-off |
| **REVIEWER** | `prof.david.kim@univ-ai.edu` | `ReviewDavid!2026` | Independent reviewer for assigned projects |
| **RISK_ACCEPTANCE_AUTHORITY** | `raa.helen.grant@univ-ai.edu` | `RiskHelen!2026` | Only role allowed to formally accept policy-eligible risks |

---

## 3. Local Setup & Running

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables (optional for local SQLite dev)
cp .env.example .env

# 3. Seed demo data (also runs automatically if DB is empty on startup)
npm run seed

# 4. Run full-stack development server on port 3000
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## 4. Running Automated Tests

```bash
npm test
```

This executes `tests/unit.test.ts` and `tests/integration.test.ts` covering:
- Scoring ($R_s \ge \text{threshold}$ with $G_s = 0$ keeps release locked)
- Forward-chaining dependencies (`R10`), conflict detection, exception scope, and expiry
- Formal risk acceptance rules (`acceptable_under_policy`, role isolation, expiry)
- BM25, TF-IDF cosine, hybrid normalization, 2-hop retrieval, and low-confidence routing
- Server-enforced RBAC, ownership isolation, CSRF protection, PDF generation, and audit concurrency (30 parallel writes with zero sequence gaps or forks)

---

## 5. Production Deployment with Docker & PostgreSQL

```bash
docker compose up --build
```

### Audit-Log Integrity (PostgreSQL vs SQLite)
- **PostgreSQL deployments** enforce database-level role separation: the ordinary application role cannot `INSERT`, `UPDATE`, or `DELETE` `audit_logs` directly. Writes go through the `SECURITY DEFINER` function `append_audit_entry(...)` which locks `audit_chain_head` (`SELECT ... FOR UPDATE`), enforces `UNIQUE(seq_num)` and `UNIQUE(prev_hash)`, and triggers block `UPDATE`, `DELETE`, and `TRUNCATE`.
- **SQLite** is for local development only and enforces append-only triggers (`BEFORE UPDATE`, `BEFORE DELETE`) plus serialized `BEGIN IMMEDIATE` transactions, without separate database user roles.
- Note: A database administrator with full superuser privileges could alter database objects; running **Verify audit chain** recomputes every SHA-256 hash and detects any tampering or fork.
