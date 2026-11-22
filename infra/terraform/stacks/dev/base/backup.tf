# ---------------------------------------------------------------------------
# Backup tier 3: out of country, out of provider, encrypted in-country.
#
# Tiers 1 and 2 (PITR and geo-redundant backup to UAE Central) are properties of the
# Flexible Server in modules/postgres. This file is the tier that survives the loss of
# the provider or the country -- the failure mode that stopped being hypothetical when
# two of three AWS UAE availability zones went down together and data resident only in
# mec1-az2 became unrecoverable.
#
# Residency is preserved by encrypting client-side with a key that never leaves this
# region's Key Vault: the remote provider stores ciphertext it cannot read, and
# restores only ever target a UAE region. "No personal data leaves the UAE in readable
# form" therefore stays literally true.
# ---------------------------------------------------------------------------

resource "azurerm_key_vault_key" "backup" {
  name         = "backup-encryption-key"
  key_vault_id = azurerm_key_vault.main.id
  key_type     = "RSA"
  key_size     = 4096
  key_opts     = ["decrypt", "encrypt", "wrapKey", "unwrapKey"]

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true # losing this key makes every tier-3 backup unreadable
  }
}

# Out-of-country, out-of-provider destination for the nightly encrypted dump. Empty
# until a destination exists; the dump is ciphertext by the time it leaves the region.
resource "azurerm_key_vault_secret" "offsite_backup_target" {
  count        = local.offsite_backup_bucket_url == "" ? 0 : 1
  name         = "offsite-backup-target"
  value        = local.offsite_backup_bucket_url
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [azurerm_role_assignment.operators_key_vault]
}

# ---------------------------------------------------------------------------
# STUB -- NOT YET WRITTEN, and named rather than quietly omitted:
#
#  1. A Container Apps Job on a nightly cron that runs pg_dump, encrypts with the key
#     above, and writes to the off-provider target with object-lock / immutability set.
#     It needs its own identity (Key Vault Crypto User on this one key, the owner
#     connection string) -- it must not borrow the migration job's.
#  2. A scheduled restore drill: restore last night's dump into an ephemeral Postgres,
#     assert row counts and a few integrity invariants, and record the elapsed time --
#     because an untested backup is a hypothesis, and the measured restore time IS the
#     RTO rather than an estimate of it.
#  3. Alert rules that fire on ABSENCE, which is the failure nobody notices:
#       - backup job did not run in 26 hours
#       - restore drill failed or has not succeeded in 35 days
#     A silently-stopped backup is strictly worse than no backup, because it buys
#     false confidence.
#
# See docs/05-deployment.md for the RPO/RTO table these controls are sized against.
# ---------------------------------------------------------------------------
