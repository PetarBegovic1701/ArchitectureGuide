workspace "Hexagonal Node service" "The domain is in the middle and depends on nothing. Use cases call ports (interfaces); adapters implement them for HTTP and the database." {
  !identifiers hierarchical

  model {
    actor_api_client = person "API client" ""
    hexagonal_service = softwareSystem "Hexagonal Node service" {
      svc_orders = container "Orders" "" "" {
        ctl_order_http_adapter = component "Order HTTP adapter" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
        uc_place_order = component "Place order" "" ""
        dom_order = component "Order" "Keep order totals and states valid" ""
        port_order_repository_port = component "Order repository port" "" ""
        repo_order_repository_prisma = component "Order repository (prisma)" "" ""
      }
      db_database = container "Database" "" "" "Database" {
        schema_orders = component "orders" "" "" "Database"
        tbl_orders = component "orders" "" "" "Database"
      }
    }

    actor_api_client -> hexagonal_service.svc_orders "calls" "http"
    hexagonal_service.svc_orders.ctl_order_http_adapter -> hexagonal_service.svc_orders.uc_place_order "calls"
    hexagonal_service.svc_orders.repo_order_repository_prisma -> hexagonal_service.svc_orders.port_order_repository_port "implements"
    hexagonal_service.svc_orders.repo_order_repository_prisma -> hexagonal_service.db_database.tbl_orders "reads"
    hexagonal_service.svc_orders.repo_order_repository_prisma -> hexagonal_service.db_database.tbl_orders "writes"
    hexagonal_service.svc_orders -> hexagonal_service.db_database.schema_orders "migrates"
    hexagonal_service.svc_orders.uc_place_order -> hexagonal_service.svc_orders.dom_order "depends on"
    hexagonal_service.svc_orders.uc_place_order -> hexagonal_service.svc_orders.port_order_repository_port "uses port"
  }

  views {
    systemContext hexagonal_service "Context" {
      include *
      autolayout lr
    }
    container hexagonal_service "Containers" {
      include *
      autolayout lr
    }
    component hexagonal_service.svc_orders "svc_orders-components" {
      include *
      autolayout lr
    }
    component hexagonal_service.db_database "db_database-components" {
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
