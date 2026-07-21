output "temporary_demo_bucket" {
  value = cloudflare_r2_bucket.temporary_demos.name
}

output "derived_artifact_bucket" {
  value = cloudflare_r2_bucket.derived_artifacts.name
}

output "analysis_queue" {
  value = cloudflare_queue.analysis.queue_name
}

output "container_max_instances" {
  description = "Maximum parser Container concurrency for the Wrangler deployment."
  value       = var.container_max_instances
}

output "container_instance_type" {
  description = "Parser Container compute tier for the Wrangler deployment."
  value       = var.container_instance_type
}

output "analysis_dead_letter_queue" {
  value = cloudflare_queue.analysis_dead_letter.queue_name
}
