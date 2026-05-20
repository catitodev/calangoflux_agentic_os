# Outputs — values consumed by Cloud Run service configs and CI/CD

output "redis_host" {
  description = "Memorystore Redis instance host IP"
  value       = google_redis_instance.message_bus.host
}

output "redis_port" {
  description = "Memorystore Redis instance port"
  value       = google_redis_instance.message_bus.port
}

output "vpc_connector_name" {
  description = "VPC connector name for Cloud Run service annotations"
  value       = google_vpc_access_connector.connector.name
}

output "vpc_connector_id" {
  description = "VPC connector full resource ID"
  value       = google_vpc_access_connector.connector.id
}

output "artifact_registry_url" {
  description = "Docker registry URL for pushing/pulling images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "cloud_run_service_account_email" {
  description = "Service account email used by Cloud Run services"
  value       = google_service_account.cloud_run.email
}

output "secret_ids" {
  description = "Map of secret names to their Secret Manager resource IDs"
  value       = { for k, v in google_secret_manager_secret.secrets : k => v.secret_id }
}
