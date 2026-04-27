output "resource_group_name" {
  description = "Name of the Azure resource group"
  value       = azurerm_resource_group.application.name
}

output "swa_url" {
  description = "Default URL of the Static Web App (frontend)"
  value       = "https://${azurerm_static_web_app.application.default_host_name}"
}

output "function_app_url" {
  description = "Default hostname of the Function App — use as VITE_API_URL"
  value       = "https://${azurerm_linux_function_app.application.default_hostname}"
}

output "storage_account_name" {
  description = "Storage account name — used to pre-populate local.settings.json"
  value       = azurerm_storage_account.application.name
}
