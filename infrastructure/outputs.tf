output "resource_group_name" {
  description = "Name of the Azure resource group"
  value       = azurerm_resource_group.application.name
}

output "swa_url" {
  description = "Default URL of the Static Web App (frontend)"
  value       = "https://${azurerm_static_web_app.application.default_host_name}"
}
