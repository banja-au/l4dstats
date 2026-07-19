variable "cloudflare_account_id" {
  description = "Cloudflare account containing the hosted application."
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Isolated deployment environment."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "r2_location" {
  description = "R2 placement hint; this is not a Container residency guarantee."
  type        = string
  default     = "wnam"

  validation {
    condition     = contains(["apac", "eeur", "enam", "weur", "wnam", "oc"], var.r2_location)
    error_message = "r2_location must be a supported Cloudflare location hint"
  }
}

variable "queue_delivery_paused" {
  description = "Emergency switch for preventing new parser dispatch."
  type        = bool
  default     = false
}

variable "production_zone" {
  description = "Cloudflare zone used for hosted custom domains."
  type        = string
  default     = "l4dstats.gg"
}

variable "developer_hostname" {
  description = "Developer portal custom hostname."
  type        = string
  default     = "developers.l4dstats.gg"
}
