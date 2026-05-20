variable "project_id" {
  description = "Google Cloud project ID"
  type        = string
}

variable "region" {
  description = "Google Cloud region for resource deployment"
  type        = string
  default     = "us-central1"
}

variable "redis_tier" {
  description = "Memorystore Redis tier (BASIC or STANDARD_HA)"
  type        = string
  default     = "BASIC"
}

variable "redis_memory_size_gb" {
  description = "Memorystore Redis memory size in GB"
  type        = number
  default     = 1
}

variable "redis_version" {
  description = "Redis version for Memorystore"
  type        = string
  default     = "REDIS_7_0"
}

variable "artifact_registry_repository" {
  description = "Name of the Artifact Registry Docker repository"
  type        = string
  default     = "calangoflux"
}

variable "vpc_connector_name" {
  description = "Name of the VPC connector for Cloud Run to Memorystore"
  type        = string
  default     = "calangoflux-connector"
}

variable "vpc_connector_cidr" {
  description = "CIDR range for the VPC connector"
  type        = string
  default     = "10.8.0.0/28"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "secrets" {
  description = "Map of secret names to create in Secret Manager"
  type        = map(string)
  default = {
    "gemini-api-key"       = "Google AI Studio API key"
    "supabase-url"         = "Supabase project URL"
    "supabase-anon-key"    = "Supabase anonymous key"
    "supabase-service-key" = "Supabase service role key"
    "jwt-secret"           = "JWT signing secret for API Gateway"
    "telegram-bot-token"   = "Telegram bot token for alerts"
  }
}
