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

variable "tags" {
  description = "Tags applied to all provisioned resources"
  type        = map(string)
  default     = {}
}
