workspace "React + Node backend-for-frontend" "The React app talks to one Node BFF. The BFF holds the session, combines calls to the backend services, and shapes data for the screens." {
  !identifiers hierarchical

  model {
    actor_customer = person "Customer" ""
    bff = softwareSystem "React + Node backend-for-frontend" {
      app_web = container "Web" "" ""
      bff_web_bff = container "Web BFF" "" "" {
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
      }
      svc_catalog_service = container "Catalog service" "" ""
      svc_orders_service = container "Orders service" "" ""
      db_services_db = container "Services DB" "" "" "Database" {
        schema_catalog = component "catalog" "" "" "Database"
        schema_orders = component "orders" "" "" "Database"
      }
    }

    actor_customer -> bff.app_web "calls: uses"
    bff.app_web -> bff.bff_web_bff "calls: one call per screen" "http"
    bff.bff_web_bff -> bff.svc_catalog_service "calls" "http"
    bff.bff_web_bff -> bff.svc_orders_service "calls" "http"
    bff.svc_catalog_service -> bff.db_services_db.schema_catalog "migrates"
    bff.svc_catalog_service -> bff.db_services_db.schema_catalog "reads"
    bff.svc_catalog_service -> bff.db_services_db.schema_catalog "writes"
    bff.svc_orders_service -> bff.db_services_db.schema_orders "migrates"
    bff.svc_orders_service -> bff.db_services_db.schema_orders "reads"
    bff.svc_orders_service -> bff.db_services_db.schema_orders "writes"
  }

  views {
    systemContext bff "Context" {
      include *
      autolayout lr
    }
    container bff "Containers" {
      include *
      autolayout lr
    }
    component bff.bff_web_bff "bff_web_bff-components" {
      include *
      autolayout lr
    }
    component bff.db_services_db "db_services_db-components" {
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
