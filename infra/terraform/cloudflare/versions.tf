terraform {
  required_version = "~> 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.22.0"
    }
  }

  # CI supplies the R2 S3 backend settings. The state bucket is the sole
  # one-time bootstrap resource and must not contain application data.
  backend "s3" {}
}

provider "cloudflare" {}
