# VPC Network and Connector — enables Cloud Run to reach Memorystore Redis
# Memorystore requires VPC access; Cloud Run uses a Serverless VPC connector

resource "google_compute_network" "main" {
  name                    = "calangoflux-vpc-${var.environment}"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  name          = "calangoflux-subnet-${var.environment}"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.main.id
}

# Serverless VPC Access connector for Cloud Run → Memorystore
resource "google_vpc_access_connector" "connector" {
  name          = var.vpc_connector_name
  region        = var.region
  ip_cidr_range = var.vpc_connector_cidr
  network       = google_compute_network.main.name

  # Smallest instance size to minimize cost
  min_instances = 2
  max_instances = 3
  machine_type  = "e2-micro"
}

# Firewall rule: allow VPC connector to reach Redis port
resource "google_compute_firewall" "allow_redis" {
  name    = "allow-redis-from-connector-${var.environment}"
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["6379"]
  }

  source_ranges = [var.vpc_connector_cidr]
  target_tags   = ["redis"]
}
