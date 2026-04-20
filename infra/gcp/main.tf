terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
  default     = "staging"
}

variable "deepgram_api_key_secret_name" {
  description = "Secret Manager name for Deepgram API key"
  type        = string
}

variable "twilio_secret_name" {
  description = "Secret Manager name for Twilio credentials"
  type        = string
}

variable "mcp_endpoint_secret_name" {
  description = "Secret Manager name for MCP endpoint"
  type        = string
}

variable "docker_image_url" {
  description = "Artifact Registry image URL for voice-agent-kit"
  type        = string
}

variable "min_instances" {
  description = "Minimum instances (0 for cost optimization, 1+ for low latency)"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum instances"
  type        = number
  default     = 10
}

variable "cpu" {
  description = "CPU allocation (1-4)"
  type        = number
  default     = 1
}

variable "memory" {
  description = "Memory in MiB (256-8192)"
  type        = number
  default     = 512
}

variable "timeout" {
  description = "Request timeout in seconds (max 3600)"
  type        = number
  default     = 300
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Cloud Run service
resource "google_cloud_run_service" "voice_agent_kit" {
  name     = "voice-agent-kit-${var.environment}"
  location = var.region

  template {
    spec {
      container_concurrency = 80
      timeout_seconds       = var.timeout
      service_account_name  = google_service_account.cloud_run_sa.email

      containers {
        image = var.docker_image_url
        ports {
          name           = "http1"
          container_port = 3000
        }

        env {
          name  = "NODE_ENV"
          value = var.environment == "production" ? "production" : "development"
        }
        env {
          name  = "PORT"
          value = "3000"
        }

        # Secrets from Secret Manager
        env {
          name = "DEEPGRAM_API_KEY"
          value_source {
            secret_key_ref {
              name = var.deepgram_api_key_secret_name
              key  = "latest"
            }
          }
        }
        env {
          name = "TWILIO_ACCOUNT_SID"
          value_source {
            secret_key_ref {
              name = var.twilio_secret_name
              key  = "TWILIO_ACCOUNT_SID"
            }
          }
        }
        env {
          name = "TWILIO_AUTH_TOKEN"
          value_source {
            secret_key_ref {
              name = var.twilio_secret_name
              key  = "TWILIO_AUTH_TOKEN"
            }
          }
        }
        env {
          name = "MCP_ENDPOINT"
          value_source {
            secret_key_ref {
              name = var.mcp_endpoint_secret_name
              key  = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "${var.cpu}"
            memory = "${var.memory}Mi"
          }
        }

        startup_probe {
          http_get {
            path = "/health"
          }
          initial_delay_seconds = 10
          timeout_seconds       = 5
          failure_threshold     = 3
        }

        liveness_probe {
          http_get {
            path = "/health"
          }
          initial_delay_seconds = 30
          timeout_seconds       = 5
          failure_threshold     = 3
          period_seconds        = 60
        }
      }
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale"      = "${var.max_instances}"
        "autoscaling.knative.dev/minScale"      = "${var.min_instances}"
        "run.googleapis.com/sessionAffinity"    = "true"
        "run.googleapis.com/sessionAffinityCookieTtlSec" = "3600"
        "run.googleapis.com/startup-cpu-boost"  = "true"
        "run.googleapis.com/cpu-throttling"     = "false"
      }
      labels = {
        app        = "voice-agent-kit"
        environment = var.environment
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [google_secret_manager_secret_iam_member.secret_access]
}

# IAM for Cloud Run to access secrets
resource "google_service_account" "cloud_run_sa" {
  account_id   = "voice-agent-kit-${var.environment}"
  display_name = "Voice Agent Kit Cloud Run Service Account"
}

resource "google_secret_manager_secret_iam_member" "secret_access" {
  for_each = toset([
    var.deepgram_api_key_secret_name,
    var.twilio_secret_name,
    var.mcp_endpoint_secret_name
  ])

  secret_id  = each.key
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Cloud Run IAM - allow unauthenticated invocations
resource "google_cloud_run_service_iam_binding" "public" {
  location = google_cloud_run_service.voice_agent_kit.location
  service  = google_cloud_run_service.voice_agent_kit.name
  role     = "roles/run.invoker"
  members  = ["allUsers"]
}

# Cloud Monitoring dashboard
resource "google_monitoring_dashboard" "voice_agent_kit" {
  dashboard_json = jsonencode({
    displayName = "Voice Agent Kit - ${var.environment}"
    gridLayout = {
      columns = 2
      widgets = [
        {
          title = "Request Count"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${google_cloud_run_service.voice_agent_kit.name}\" AND metric.type=\"run.googleapis.com/request_count\""
                }
              }
            }]
          }
        },
        {
          title = "Response Latency (ms)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${google_cloud_run_service.voice_agent_kit.name}\" AND metric.type=\"run.googleapis.com/response_latencies\""
                }
              }
            }]
          }
        },
        {
          title = "CPU Utilization"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${google_cloud_run_service.voice_agent_kit.name}\" AND metric.type=\"run.googleapis.com/container/cpu/utilizations\""
                }
              }
            }]
          }
        },
        {
          title = "Memory Utilization"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${google_cloud_run_service.voice_agent_kit.name}\" AND metric.type=\"run.googleapis.com/container/memory/utilizations\""
                }
              }
            }]
          }
        }
      ]
    }
  })
}

# Cloud Monitoring alert policy for high error rate
resource "google_monitoring_alert_policy" "high_error_rate" {
  display_name = "Voice Agent Kit High Error Rate - ${var.environment}"
  combiner     = "OR"

  conditions {
    display_name = "Error rate > 5 req/s"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${google_cloud_run_service.voice_agent_kit.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.\"response_code\"=~\"^5..$\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = []
}

# Cloud Monitoring alert policy for high latency
resource "google_monitoring_alert_policy" "high_latency" {
  display_name = "Voice Agent Kit High Latency - ${var.environment}"
  combiner     = "OR"

  conditions {
    display_name = "P95 latency > 800ms"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${google_cloud_run_service.voice_agent_kit.name}\" AND metric.type=\"run.googleapis.com/response_latencies\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 800
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
    }
  }

  notification_channels = []
}

output "service_url" {
  value = google_cloud_run_service.voice_agent_kit.status[0].url
}

output "service_name" {
  value = google_cloud_run_service.voice_agent_kit.name
}

output "service_account_email" {
  value = google_service_account.cloud_run_sa.email
}
