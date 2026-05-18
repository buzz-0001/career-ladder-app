-- PostgreSQL 初期スキーマ（Supabase）

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'self',
  employee_id VARCHAR(100),
  department VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id VARCHAR(200) PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  employee_name VARCHAR(200) NOT NULL,
  month VARCHAR(10) NOT NULL,
  level INT NOT NULL,
  role VARCHAR(20) NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT false,
  goal TEXT,
  challenge TEXT,
  review_period TEXT,
  admin_challenge TEXT,
  team_opinion TEXT,
  feedback TEXT,
  updated_at VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_scores (
  evaluation_id VARCHAR(200) NOT NULL,
  item_id VARCHAR(200) NOT NULL,
  score VARCHAR(20) NOT NULL,
  PRIMARY KEY (evaluation_id, item_id),
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evaluations_employee_role_month
  ON evaluations (employee_id, role, month DESC);

CREATE INDEX IF NOT EXISTS idx_evaluations_updated_at
  ON evaluations (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluation_scores_evaluation_id
  ON evaluation_scores (evaluation_id);
