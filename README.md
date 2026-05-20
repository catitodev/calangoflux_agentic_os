<div align="center">

<img src="calango_logo_nova.png" alt="CalangoFlux Logo" width="200"/>

# CalangoFlux Agentic OS

**Sistema operacional multi-agente containerizado**  
*Substitui n8n/Make por agentes autônomos de IA em sandboxes isolados*

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.83+-orange?logo=rust)](https://www.rust-lang.org)
[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?logo=go)](https://go.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Google Cloud](https://img.shields.io/badge/Google%20Cloud-Run-4285F4?logo=googlecloud)](https://cloud.google.com/run)
[![Tests](https://img.shields.io/badge/Tests-331%20passing-brightgreen?logo=checkmarx)](https://github.com/catitodev/calangoflux_agentic_os/actions)

[🇧🇷 Português](#sobre) · [📖 Docs](#arquitetura) · [🚀 Deploy](#deploy) · [🤝 Contribuir](#contribuindo)

</div>

---

## Sobre

O **CalangoFlux Agentic OS** é o produto SaaS core da [CalangoFlux](https://github.com/catitodev) — uma plataforma de automação inteligente para autônomos, pequenos negócios, coletivos e ONGs no Brasil.

Em vez de workflows visuais frágeis (n8n, Make), o sistema roda **agentes autônomos de IA** em containers imutáveis com isolamento WASM, comunicação via message bus e segurança zero-trust interna.

> 🌿 Desenvolvido na Serra Macaense, RJ, Brasil — por Catito (biólogo, agroecologista, dev fullstack & web3)

---

## ✨ Diferenciais

| | CalangoFlux Agentic OS | n8n / Make |
|---|---|---|
| **Isolamento** | WASM sandbox por agente | Processo compartilhado |
| **Segurança** | Zero-trust + SHIELD + CHAIN | Sem auditoria imutável |
| **Auto-correção** | HEALER via Gemini | Manual |
| **Deploy** | Atômico com rollback | Manual |
| **Custo** | Google Cloud free tier | Pago por execução |

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                IRONCLAW (Agent OS — Rust)            │
├─────────────────────────────────────────────────────┤
│  [Sandbox 1]   [Sandbox 2]   [Sandbox 3]            │
│   PicoClaw      OpenClaw      Gemini 4              │
│  (Router/Go)   (Ações/TS)   (Cérebro/API)          │
│                                                     │
│  [Sandbox 4: CalangoVallum]                         │
│   SHIELD (monitor) | SPEAR (test) | CHAIN (audit)  │
│   HEALER (auto-fix via Gemini)                      │
├─────────────────────────────────────────────────────┤
│  API Gateway (gRPC + REST + JWT)                    │
│  Message Bus (Redis Streams)                        │
│  Credential Vault (Google Secret Manager)           │
│  Agent Registry (health checks, lifecycle)          │
├─────────────────────────────────────────────────────┤
│  CalangoBot (público) │ Dashboard admin (owner)     │
└─────────────────────────────────────────────────────┘
          ☁️ Google Cloud Run + Vertex AI
```

### Componentes

<details>
<summary><strong>🦀 IronClaw — Agent OS Runtime (Rust)</strong></summary>

- **WASM Sandboxing** via wasmtime com fuel metering e epoch interruption
- **Credential Vault** — tokens com TTL 5min, nunca expõe chaves brutas
- **API Gateway** — gRPC + REST, JWT auth, rate limiting 60 req/min
- **Message Bus** — Redis Streams, at-least-once delivery, fila local (1000 msgs)
- **Agent Registry** — health checks 30s, lifecycle state machine, kill switch

</details>

<details>
<summary><strong>🛡️ CalangoVallum — Security Module (Rust)</strong></summary>

- **SHIELD** — monitora todas as mensagens em tempo real (<500ms latência), detecta exposição de credenciais (`sk-`, `AKIA`, `ghp_`, Bearer tokens) e anomalias (>2 desvios padrão da baseline 24h)
- **SPEAR** — testes adversariais automáticos a cada 6h: prompt injection, credential leakage, resource exhaustion, unauthorized actions — em sandbox clonado sem afetar produção
- **CHAIN** — audit trail **imutável** via SHA-256 hash chain: cada entrada contém o hash da anterior, qualquer adulteração é detectável. Persiste no Supabase com latência <2s. Registra toda mensagem, evento de lifecycle e violação de segurança
- **HEALER** — detecta falha → Gemini analisa logs + últimas 10 mensagens → gera fix → testa em sandbox (5 queries) → deploy atômico ou rollback. Rate limit: 3 tentativas/agente/hora

</details>

<details>
<summary><strong>🐹 PicoClaw — Task Router (Go)</strong></summary>

- Ultra-leve: **<10MB RAM**, **<1s startup**
- Classifica intent: `conversation`, `research`, `action`, `analysis`, `internal`
- Load balancing round-robin entre instâncias
- Fallback automático + retry queue (5s delay)

</details>

<details>
<summary><strong>🟦 OpenClaw — Action Executor (TypeScript)</strong></summary>

- **20+ ferramentas**: web search, email, Telegram, LinkedIn, Instagram, Slack, WhatsApp, DB, Calendar, PDF, Translate...
- Retry com exponential backoff (1s → 4s → 16s), timeout 30s
- Gemini client: rate limiting 15 req/min, context window 50 msgs, circuit breaker
- Deploy manager: atomic deploy + rollback automático

</details>

<details>
<summary><strong>⚛️ Admin Dashboard (React + TypeScript)</strong></summary>

- Monitoramento em tempo real de todos os agentes
- Kill switch por agente (termina em 5s)
- Audit trail (últimas 100 entradas do CHAIN)
- Gestão de leads com histórico de conversas
- Configuração em runtime sem redeploy

</details>

---

## 🗂️ Estrutura do Projeto

```
calangoflux_agentic_os/
├── ironclaw/          # Agent OS Runtime (Rust)
├── calango-vallum/    # Security Module (Rust)
├── picoclaw/          # Task Router (Go)
├── openclaw/          # Action Executor (TypeScript)
├── admin-dashboard/   # Admin SPA (React)
├── shared/proto/      # gRPC schemas
├── infra/
│   ├── cloud-run/     # Cloud Run service YAMLs
│   ├── terraform/     # IaC (Memorystore, Secret Manager, Artifact Registry)
│   └── supabase/      # PostgreSQL migrations
├── docker-compose.yml # Desenvolvimento local
├── LICENSE            # Apache-2.0
└── NOTICE             # Atribuição obrigatória
```

---

## 🚀 Deploy

### Pré-requisitos

- [Rust 1.83+](https://rustup.rs)
- [Go 1.22+](https://go.dev/dl)
- [Node.js 20+](https://nodejs.org)
- [Docker](https://docs.docker.com/get-docker)
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
- [Terraform 1.5+](https://developer.hashicorp.com/terraform/install)

### Desenvolvimento local

```bash
# Clone o repositório
git clone https://github.com/catitodev/calangoflux_agentic_os.git
cd calangoflux_agentic_os

# Suba todos os serviços com Docker Compose
docker compose up --build

# Serviços disponíveis:
# IronClaw:        http://localhost:8080
# CalangoVallum:   http://localhost:8081
# PicoClaw:        http://localhost:8082
# OpenClaw:        http://localhost:8083
# Admin Dashboard: http://localhost:8084
```

### Testes

```bash
# Rust (IronClaw + CalangoVallum)
cargo test --workspace

# TypeScript (OpenClaw)
cd openclaw && npm install && npx vitest run

# Go (PicoClaw)
cd picoclaw && go test ./...
```

### Deploy no Google Cloud

```bash
# 1. Configure as variáveis
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
# Edite terraform.tfvars com seu project_id

# 2. Provisione a infraestrutura
cd infra/terraform
terraform init && terraform apply

# 3. Build e push das imagens
export PROJECT_ID=seu-projeto
docker build -f ironclaw/Dockerfile -t gcr.io/$PROJECT_ID/ironclaw:latest .
docker push gcr.io/$PROJECT_ID/ironclaw:latest
# (repita para cada serviço)

# 4. Deploy no Cloud Run
gcloud run services replace infra/cloud-run/ironclaw.yaml --region=us-central1
```

---

## 🔒 Segurança

O CalangoFlux Agentic OS foi projetado com **segurança como princípio central**:

- 🔐 **Zero-trust interno** — CalangoVallum valida toda comunicação inter-agente
- 🏖️ **WASM Sandbox** — cada agente isolado com limites de CPU, memória e host calls
- 🔑 **Credential Vault** — chaves nunca expostas; apenas tokens com TTL 5min
- 📋 **CHAIN — Audit Trail Imutável** — SHA-256 hash chain, qualquer adulteração é detectável
- 🛡️ **SHIELD** — detecta exposição de credenciais em tempo real (<500ms)
- 🧪 **SPEAR** — testes adversariais automáticos a cada 6 horas

### 📋 CHAIN — Audit Trail Imutável

O **CHAIN Agent** é o coração da rastreabilidade do sistema. Cada evento gera uma entrada com:

```
entry_hash = SHA-256(timestamp + actor + action_type + payload_hash + previous_hash)
```

Isso forma uma **cadeia imutável**: qualquer modificação em qualquer entrada invalida todos os hashes subsequentes, tornando adulterações imediatamente detectáveis.

**O que é registrado:**
- Toda mensagem inter-agente (sender, destination, tipo, timestamp)
- Eventos de lifecycle (AgentStarted, AgentStopped, AgentRestarted)
- Violações de segurança detectadas pelo SHIELD
- Acessos ao Credential Vault
- Mudanças de configuração
- Eventos de deploy

**Verificação de integridade:**
```rust
// Verifica toda a cadeia re-computando os hashes
chain_agent.verify_integrity().await?;
```

---

## 📊 Status

| Componente | Testes | Status |
|---|---|---|
| IronClaw | 109 ✅ | Produção-ready |
| CalangoVallum | 86 ✅ | Produção-ready |
| OpenClaw | 135 ✅ | Produção-ready |
| PicoClaw | 21 ✅ | Produção-ready |
| Admin Dashboard | — | MVP |
| CalangoBot | — | MVP |

**Total: 331 testes passando**

---

## 🛠️ Stack

<div align="center">

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)

</div>

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Fork o repositório
2. Crie uma branch: `git checkout -b feat/minha-feature`
3. Commit: `git commit -m 'feat: adiciona minha feature'`
4. Push: `git push origin feat/minha-feature`
5. Abra um Pull Request

Ao contribuir, você concorda que sua contribuição será licenciada sob Apache-2.0 e que o crédito ao projeto original (CalangoFlux / catitodev) deve ser mantido conforme o arquivo [NOTICE](NOTICE).

---

## 📄 Licença

Distribuído sob a **Apache License 2.0**. Veja [LICENSE](LICENSE) para detalhes.

**Uso comercial é permitido**, desde que:
- A licença Apache-2.0 seja incluída na distribuição
- O arquivo [NOTICE](NOTICE) seja preservado (atribuição ao CalangoFlux / catitodev)
- Modificações sejam indicadas nos arquivos alterados

---

<div align="center">

Feito com 🌿 na Serra Macaense, RJ, Brasil

**[CalangoFlux](https://github.com/catitodev)** · [Reportar Bug](https://github.com/catitodev/calangoflux_agentic_os/issues) · [Solicitar Feature](https://github.com/catitodev/calangoflux_agentic_os/issues)

</div>
