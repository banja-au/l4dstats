output "temporary_demo_bucket" {
  value = cloudflare_r2_bucket.temporary_demos.name
}

output "derived_artifact_bucket" {
  value = cloudflare_r2_bucket.derived_artifacts.name
}

output "analysis_queue" {
  value = cloudflare_queue.analysis.queue_name
}

output "analysis_dead_letter_queue" {
  value = cloudflare_queue.analysis_dead_letter.queue_name
}
