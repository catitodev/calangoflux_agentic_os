# Google Artifact Registry — Docker repository for container images
# Stores IronClaw, PicoClaw, OpenClaw, CalangoVallum, and Admin Dashboard images

resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = var.artifact_registry_repository
  description   = "CalangoFlux Agentic OS container images"
  format        = "DOCKER"

  # Cleanup policy: retain last 3 versions per image (Requirement 13.4)
  cleanup_policies {
    id     = "keep-last-3"
    action = "KEEP"

    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  labels = {
    environment = var.environment
    managed-by  = "terraform"
  }
}

# IAM: Allow Cloud Run service account to pull images
resource "google_artifact_registry_repository_iam_member" "cloud_run_reader" {
  location   = google_artifact_registry_repository.docker.location
  repository = google_artifact_registry_repository.docker.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.cloud_run.email}"
}
