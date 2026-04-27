variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}

variable "app_name" {
  description = "Application name used in resource naming (lowercase, no hyphens)"
  type        = string
  default     = "pripritrip"
}

variable "environment" {
  description = "Deployment environment name (e.g. prod, staging)"
  type        = string
}

variable "location" {
  description = "Azure region for application resources"
  type        = string
  default     = "centralus"
}

variable "app_password" {
  description = "Application password checked on POST /api/auth"
  type        = string
  sensitive   = true
  default     = "honeymoon"
}

variable "token_secret" {
  description = "HMAC salt used to sign session tokens"
  type        = string
  sensitive   = true
}

variable "maps_api_key" {
  description = "Google Maps API key returned to the client on successful auth"
  type        = string
  sensitive   = true
  default     = ""
}

variable "tags" {
  description = "Tags applied to all provisioned resources"
  type        = map(string)
  default     = {}
}
