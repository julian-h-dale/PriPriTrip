resource "azurerm_service_plan" "application" {
  name                = "asp-${var.app_name}-${var.environment}"
  resource_group_name = azurerm_resource_group.application.name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1" # Consumption (serverless)
  tags                = var.tags
}

resource "azurerm_linux_function_app" "application" {
  name                       = "func-${var.app_name}-${var.environment}"
  resource_group_name        = azurerm_resource_group.application.name
  location                   = var.location
  service_plan_id            = azurerm_service_plan.application.id
  storage_account_name       = azurerm_storage_account.application.name
  storage_account_access_key = azurerm_storage_account.application.primary_access_key
  tags                       = var.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    application_stack {
      python_version = "3.11"
    }

    cors {
      allowed_origins = [
        "https://${azurerm_static_web_app.application.default_host_name}",
        "https://trip.pripri.juliandale.cloud",
        "http://localhost:3000",
      ]
    }
  }

  app_settings = {
    FUNCTIONS_WORKER_RUNTIME       = "python"
    SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
    APP_PASSWORD                   = var.app_password
    TOKEN_SECRET                   = var.token_secret
    MAPS_API_KEY                   = var.maps_api_key
    STORAGE_ACCOUNT                = azurerm_storage_account.application.name
    STORAGE_TRIP_CONTAINER         = "trip"
    STORAGE_DOCS_CONTAINER         = "documents"
    STORAGE_MEMORIES_CONTAINER     = "memories"
  }
}

# Allow the Function App managed identity to read/write blobs (trip.json, etc.)
resource "azurerm_role_assignment" "function_blob_contributor" {
  scope                = azurerm_storage_account.application.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_function_app.application.identity[0].principal_id
}

# Allow the Function App managed identity to generate user-delegation SAS tokens
# (required for resolve_document_sas_urls when no connection string is available)
resource "azurerm_role_assignment" "function_blob_delegator" {
  scope                = azurerm_storage_account.application.id
  role_definition_name = "Storage Blob Delegator"
  principal_id         = azurerm_linux_function_app.application.identity[0].principal_id
}
