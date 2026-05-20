# Google Memorystore Redis — Message Bus backend
# Basic tier, 1GB — cost-optimized for Developer Program credits

resource "google_redis_instance" "message_bus" {
  name           = "calangoflux-redis-${var.environment}"
  tier           = var.redis_tier
  memory_size_gb = var.redis_memory_size_gb
  region         = var.region
  redis_version  = var.redis_version

  # Connect via VPC for Cloud Run access
  authorized_network = google_compute_network.main.id
  connect_mode       = "DIRECT_PEERING"

  # Redis configuration for Streams workload
  redis_configs = {
    "maxmemory-policy" = "noeviction"
    "notify-keyspace-events" = ""
  }

  labels = {
    environment = var.environment
    service     = "message-bus"
    managed-by  = "terraform"
  }

  lifecycle {
    prevent_destroy = false
  }
}
