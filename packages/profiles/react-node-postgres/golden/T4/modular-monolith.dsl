workspace "NestJS modular monolith" "One deployable split into modules. Each module owns its own schema and offers a public API; other modules never touch its tables." {
  !identifiers hierarchical

  model {
    actor_api_client = person "API client" ""
    modular_monolith = softwareSystem "NestJS modular monolith" {
      svc_shop = container "Shop" "" "" {
        mod_billing = component "Billing" "" ""
        mod_catalog = component "Catalog" "" ""
        mod_orders = component "Orders" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
      }
      db_shop_db = container "Shop DB" "" "" "Database" {
        schema_billing = component "billing" "" "" "Database"
        schema_catalog = component "catalog" "" "" "Database"
        schema_orders = component "orders" "" "" "Database"
      }
    }

    actor_api_client -> modular_monolith.svc_shop "calls" "http"
    modular_monolith.svc_shop.mod_billing -> modular_monolith.svc_shop.mod_orders "depends on: public API"
    modular_monolith.svc_shop.mod_billing -> modular_monolith.db_shop_db.schema_billing "writes"
    modular_monolith.svc_shop.mod_catalog -> modular_monolith.db_shop_db.schema_catalog "writes"
    modular_monolith.svc_shop.mod_orders -> modular_monolith.svc_shop.mod_catalog "depends on: public API"
    modular_monolith.svc_shop.mod_orders -> modular_monolith.db_shop_db.schema_orders "writes"
    modular_monolith.svc_shop -> modular_monolith.db_shop_db.schema_billing "migrates"
    modular_monolith.svc_shop -> modular_monolith.db_shop_db.schema_catalog "migrates"
    modular_monolith.svc_shop -> modular_monolith.db_shop_db.schema_orders "migrates"
  }

  views {
    systemContext modular_monolith "Context" {
      include *
      autolayout lr
    }
    container modular_monolith "Containers" {
      include *
      autolayout lr
    }
    component modular_monolith.svc_shop "svc_shop-components" {
      include *
      autolayout lr
    }
    component modular_monolith.db_shop_db "db_shop_db-components" {
      include *
      autolayout lr
    }
    styles {
      element "Person" {
        shape Person
      }
      element "Database" {
        shape Cylinder
      }
      element "Queue" {
        shape Pipe
      }
      element "External" {
        background #999999
        color #ffffff
      }
    }
  }
}
