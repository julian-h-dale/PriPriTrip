# Storage account name: no hyphens, max 24 chars → st<appname><env>
resource "azurerm_storage_account" "application" {
  name                     = "st${replace(var.app_name, "-", "")}${var.environment}"
  resource_group_name      = azurerm_resource_group.application.name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = var.tags
}

resource "azurerm_storage_container" "trip" {
  name                  = "trip"
  storage_account_name  = azurerm_storage_account.application.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "documents" {
  name                  = "documents"
  storage_account_name  = azurerm_storage_account.application.name
  container_access_type = "private"
}
