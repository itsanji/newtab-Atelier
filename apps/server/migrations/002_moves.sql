-- A category moved to another workspace, or an item moved to a category in another workspace.
-- Pull reports these as gone to members who could see the source but cannot see the destination.
create table row_moves (
  id bigserial primary key,
  table_name text not null check (table_name in ('categories', 'items')),
  row_id uuid not null,
  from_workspace_id uuid not null references workspaces,
  version bigint not null
);

create index row_moves_version on row_moves (version);
