create sequence change_seq;

create table users (
  id uuid primary key,
  email text not null unique,
  password_hash text,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table workspaces (
  id uuid primary key,
  name text not null,
  emoji text,
  owner_id uuid not null references users,
  sort_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  updated_by uuid,
  version bigint not null
);

create table workspace_members (
  id uuid primary key,
  workspace_id uuid not null references workspaces,
  user_id uuid references users,
  email text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version bigint not null,
  unique (workspace_id, email)
);

create table categories (
  id uuid primary key,
  workspace_id uuid not null references workspaces,
  name text not null,
  emoji text,
  sort_key text not null,
  tab_group jsonb,
  share_token text unique,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  updated_by uuid,
  version bigint not null
);

create table items (
  id uuid primary key,
  category_id uuid not null references categories,
  kind text not null check (kind in ('link', 'note', 'todo')),
  sort_key text not null,
  title text not null,
  url text,
  favicon_url text,
  note text,
  body jsonb,
  done boolean not null default false,
  restored boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  updated_by uuid,
  version bigint not null
);

create table reminders (
  id uuid primary key,
  item_id uuid not null references items,
  user_id uuid not null references users,
  remind_at timestamptz not null,
  reminded_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  updated_by uuid,
  version bigint not null
);

create table magic_links (
  id uuid primary key,
  email text not null,
  token_hash text not null unique,
  poll_hash text not null,
  expires_at timestamptz not null,
  verified_user_id uuid,
  consumed_at timestamptz
);

create table oauth_codes (
  code_hash text primary key,
  user_id uuid not null,
  expires_at timestamptz not null
);

create table oauth_states (
  state text primary key,
  redirect_uri text not null,
  client_state text not null,
  expires_at timestamptz not null
);

create index workspaces_version on workspaces (version);
create index workspace_members_version on workspace_members (version);
create index categories_version on categories (version);
create index items_version on items (version);
create index reminders_version on reminders (version);

create index categories_workspace_id on categories (workspace_id);
create index items_category_id on items (category_id);
create index reminders_item_id on reminders (item_id);
create index workspace_members_workspace_id on workspace_members (workspace_id);
create index workspace_members_user_id on workspace_members (user_id);
create index workspace_members_email on workspace_members (email);
