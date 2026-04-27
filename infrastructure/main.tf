terraform {
  required_version = ">= 1.9"

  backend "azurerm" {
    resource_group_name  = "terraform-infrastructure"
    storage_account_name = "priprinotetfstate"
    container_name       = "tfstate"
    key                  = "priPriTrip.tfstate"
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

locals {
  resource_group_name = "rsg-${var.app_name}-${var.environment}"
}

resource "azurerm_resource_group" "application" {
  name     = local.resource_group_name
  location = var.location
  tags     = var.tags
}
