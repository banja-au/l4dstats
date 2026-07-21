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

variable "container_max_instances" {
  description = "Maximum concurrent parser Containers; consumed by the Wrangler application deployment."
  type        = number
  default     = 10

  validation {
    condition     = var.container_max_instances >= 1 && var.container_max_instances <= 50 && floor(var.container_max_instances) == var.container_max_instances
    error_message = "container_max_instances must be an integer between 1 and 50"
  }
}

variable "container_instance_type" {
  description = "Cloudflare parser Container instance type; consumed by the Wrangler application deployment."
  type        = string
  default     = "standard-3"

  validation {
    condition     = contains(["standard-2", "standard-3", "standard-4"], var.container_instance_type)
    error_message = "container_instance_type must be standard-2, standard-3, or standard-4"
  }
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
