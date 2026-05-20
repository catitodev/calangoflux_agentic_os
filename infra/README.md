# Infrastructure — CalangoFlux Agentic OS

This directory contains infrastructure-as-code configurations for deploying
CalangoFlux Agentic OS on Google Cloud.

## Structure

```
infra/
├── terraform/         # Terraform IaC for all Google Cloud resources
│   ├── main.tf        # Provider config, backend
│   ├── variables.tf   # Input variables
│   ├── memorystore.tf # Google Memorystore Redis (basic, 1GB)
│   ├── secret-manager.tf # Secret Manager secrets + IAM
│   ├── artifact-registry.tf # Docker repository
│   ├── vpc.tf         # VPC + connector for Cloud Run ↔ Redis
│   ├── outputs.tf     # Redis host, VPC connector, registry URL
│   └── terraform.tfvars.example # Example variable values
├── cloud-run/         # Cloud Run service definitions
├── memorystore/       # (legacy) Redis notes
├── artifact-registry/ # (legacy) Registry notes
├── secret-manager/    # (legacy) Secret Manager notes
└── supabase/          # PostgreSQL migrations and seed data
```

## Target Environment

- **Google Cloud Run**: Serverless containers (scale-to-zero)
- **Google Memorystore**: Redis for Message Bus (Basic tier, 1GB)
- **Google Secret Manager**: Credential Vault backend
- **Google Artifact Registry**: Container image storage
- **Supabase**: PostgreSQL for state (external)
- **Google AI Studio**: Gemini 4 API (free tier)

## Cost Budget

Target: ≤ $50 USD/month using Developer Program credits + free tiers.

| Resource | Tier | Estimated Cost |
|----------|------|---------------|
| Memorystore Redis | Basic, 1GB | ~$35/month |
| Cloud Run | Scale-to-zero | Free tier (2M requests) |
| Secret Manager | Per-access | Free tier (10K accesses) |
| Artifact Registry | Storage | Free tier (0.5GB) |
| VPC Connector | e2-micro × 2 | ~$10/month |
| Google AI Studio | Free tier | $0 |

## Getting Started

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project values

terraform init
terraform plan
terraform apply
```
