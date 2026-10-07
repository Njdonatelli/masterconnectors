-- 091_sso_policy.sql — enterprise SSO policy columns + the `infosec` role.
--
-- SSO support spec: allowed-domain provisioning, JIT toggle, group-role mode,
-- configurable groups claim, and a branded login label, all stored per
-- connection so a second IdP can have its own policy without a redeploy.
--
-- Reversible: DROP COLUMN IF EXISTS on rollback; the role seed deletes itself.
-- Nothing here changes the fail-closed defaults: a connection that has no
-- rows, no domains, and no mappings admits nobody beyond its configured
-- default-role least-privilege grant, and `enabled` still defaults FALSE.

ALTER TABLE aisoc_sso_connections ADD COLUMN IF NOT EXISTS allowed_email_domains TEXT NOT NULL DEFAULT '';
ALTER TABLE aisoc_sso_connections ADD COLUMN IF NOT EXISTS jit_provisioning BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE aisoc_sso_connections ADD COLUMN IF NOT EXISTS group_role_mode TEXT NOT NULL DEFAULT 'first_login_only'
    CHECK (group_role_mode IN ('first_login_only', 'authoritative'));
ALTER TABLE aisoc_sso_connections ADD COLUMN IF NOT EXISTS groups_claim TEXT NOT NULL DEFAULT '';
ALTER TABLE aisoc_sso_connections ADD COLUMN IF NOT EXISTS login_label TEXT NOT NULL DEFAULT '';

-- The `infosec` role: security analyst / incident handler. It is seeded per
-- tenant in the application layer (the tenant set is dynamic), but the
-- canonical definition lives in `app.core.security.ROLE_PERMISSIONS`; this
-- seed covers tenants that predate the role so their admins can assign it
-- through the RBAC endpoints immediately.
INSERT INTO roles (tenant_id, name, description, is_system)
SELECT t.id, 'infosec',
       'Security analyst / incident handler: triage, case handling, detections, threat intel, sanitized exports. No user/role/SSO/system management.',
       TRUE
  FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;
