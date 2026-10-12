CREATE TABLE cplayout_users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (length(username) BETWEEN 1 AND 100),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  roles text[] NOT NULL CHECK (roles <@ ARRAY['operator','admin','support']::text[] AND cardinality(roles) > 0),
  disabled boolean NOT NULL DEFAULT false,
  access_revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cplayout_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES cplayout_users(id),
  csrf_token text NOT NULL,
  access_revision bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cplayout_sessions_user ON cplayout_sessions(user_id);
CREATE TABLE cplayout_workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  document text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cplayout_memberships (
  user_id uuid NOT NULL REFERENCES cplayout_users(id),
  workspace_id uuid NOT NULL REFERENCES cplayout_workspaces(id),
  permissions text[] NOT NULL CHECK (permissions <@ ARRAY['field:read','field:write','catalog:write','catalog:archive']::text[]),
  policy_revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, workspace_id)
);
CREATE TABLE cplayout_command_receipts (
  workspace_id uuid NOT NULL REFERENCES cplayout_workspaces(id),
  command_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES cplayout_users(id),
  request_hash char(64) NOT NULL,
  response_document text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, command_id)
);
CREATE TABLE cplayout_archives (
  workspace_id uuid NOT NULL REFERENCES cplayout_workspaces(id),
  entity_kind text NOT NULL CHECK (entity_kind IN ('customer','project')),
  entity_id text NOT NULL,
  archived_by uuid NOT NULL REFERENCES cplayout_users(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entity_kind, entity_id)
);
CREATE TABLE cplayout_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES cplayout_users(id),
  workspace_id uuid REFERENCES cplayout_workspaces(id),
  action text NOT NULL,
  entity_id text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
