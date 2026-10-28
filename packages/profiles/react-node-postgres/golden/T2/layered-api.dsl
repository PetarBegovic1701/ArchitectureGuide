workspace "Layered Node API" "Each entity gets a route handler, a use case and a repository. Requests go down the layers, never around them." {
  !identifiers hierarchical

  model {
    actor_api_client = person "API client" ""
    layered_api = softwareSystem "Layered Node API" {
      svc_orders_api = container "Orders API" "" "" {
        ctl_customer_routes = component "Customer routes" "" ""
        ctl_order_routes = component "Order routes" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
        uc_customer_service = component "Customer service" "" ""
        uc_order_service = component "Order service" "" ""
        repo_customer_repository = component "Customer repository" "" ""
        repo_order_repository = component "Order repository" "" ""
      }
      db_database = container "Database" "" "" "Database" {
        schema_app = component "app" "" "" "Database"
        tbl_customers = component "customers" "" "" "Database"
        tbl_orders = component "orders" "" "" "Database"
      }
    }

    actor_api_client -> layered_api.svc_orders_api "calls" "http"
    layered_api.svc_orders_api.ctl_customer_routes -> layered_api.svc_orders_api.uc_customer_service "calls"
    layered_api.svc_orders_api.ctl_order_routes -> layered_api.svc_orders_api.uc_order_service "calls"
    layered_api.svc_orders_api.repo_customer_repository -> layered_api.db_database.tbl_customers "reads"
    layered_api.svc_orders_api.repo_customer_repository -> layered_api.db_database.tbl_customers "writes"
    layered_api.svc_orders_api.repo_order_repository -> layered_api.db_database.tbl_orders "reads"
    layered_api.svc_orders_api.repo_order_repository -> layered_api.db_database.tbl_orders "writes"
    layered_api.svc_orders_api -> layered_api.db_database.schema_app "migrates"
    layered_api.svc_orders_api.uc_customer_service -> layered_api.svc_orders_api.repo_customer_repository "calls"
    layered_api.svc_orders_api.uc_order_service -> layered_api.svc_orders_api.repo_order_repository "calls"
  }

  views {
    systemContext layered_api "Context" {
      include *
      autolayout lr
    }
    container layered_api "Containers" {
      include *
      autolayout lr
    }
    component layered_api.svc_orders_api "svc_orders_api-components" {
      include *
      autolayout lr
    }
    component layered_api.db_database "db_database-components" {
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
