resource "azurerm_log_analytics_workspace" "application" {
  name                = "log-${var.app_name}-${var.environment}"
  resource_group_name = azurerm_resource_group.application.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_application_insights" "application" {
  name                = "appi-${var.app_name}-${var.environment}"
  resource_group_name = azurerm_resource_group.application.name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.application.id
  application_type    = "web"
  tags                = var.tags
}
