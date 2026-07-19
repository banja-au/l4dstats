locals {
  prefix = "l4dstats-${var.environment}"
}

resource "cloudflare_r2_bucket" "temporary_demos" {
  account_id    = var.cloudflare_account_id
  name          = "${local.prefix}-temporary"
  location      = var.r2_location
  storage_class = "Standard"
}

resource "cloudflare_r2_bucket_lifecycle" "temporary_demos" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.temporary_demos.name

  rules = [{
    id      = "delete-abandoned-raw-demos"
    enabled = true
    conditions = {
      prefix = "uploads/"
    }
    delete_objects_transition = {
      condition = {
        type    = "Age"
        max_age = 86400
      }
    }
  }]
}

resource "cloudflare_r2_bucket" "derived_artifacts" {
  account_id    = var.cloudflare_account_id
  name          = "${local.prefix}-artifacts"
  location      = var.r2_location
  storage_class = "Standard"
}

resource "cloudflare_queue" "analysis_dead_letter" {
  account_id = var.cloudflare_account_id
  queue_name = "${local.prefix}-analysis-dlq"
  settings = {
    message_retention_period = 86400
  }
}

resource "cloudflare_queue" "analysis" {
  account_id = var.cloudflare_account_id
  queue_name = "${local.prefix}-analysis"
  settings = {
    delivery_paused          = var.queue_delivery_paused
    message_retention_period = 86400
  }
}
