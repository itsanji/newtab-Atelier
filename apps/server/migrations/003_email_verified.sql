-- Password sign-ups do not verify the address. The first magic-link or Google sign-in does.
alter table users add column email_verified_at timestamptz;
update users set email_verified_at = created_at where password_hash is null;
