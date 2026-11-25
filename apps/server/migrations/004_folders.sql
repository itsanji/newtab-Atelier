-- Folders: an item of kind 'folder' holds links of the same category. folder_id is not a foreign key on
-- purpose: a link whose folder is deleted, moved or not yet pushed simply shows at the top of its category.
alter table items drop constraint items_kind_check;
alter table items add constraint items_kind_check check (kind in ('link', 'note', 'todo', 'folder'));
alter table items add column folder_id uuid;
