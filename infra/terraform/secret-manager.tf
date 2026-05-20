# Google Secret Manager — Credential Vault backend
# Stores API keys and secrets accessed by IronClaw's CredentialVault

resource "google_secret_manager_secret" "secrets" {
  for_each  = var.secrets
  secret_id = "${each.key}-${var.environment}"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    managed-by  = "terraform"
  }
}

# IAM: Allow Cloud Run service account to access secrets
resource "google_secret_manager_secret_iam_member" "cloud_run_access" {
  for_each  = google_secret_manager_secret.secrets
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Service account for Cloud Run services
resource "google_service_account" "cloud_run" {
  account_id   = "calangoflux-run-${var.environment}"
  display_name = "CalangoFlux Cloud Run Service Account (${var.environment})"
}

# Grant minimal permissions to the service account
resource "google_project_iam_member" "cloud_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}
