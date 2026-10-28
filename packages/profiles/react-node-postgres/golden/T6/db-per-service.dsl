workspace "Node services, database per service" "A gateway in front of independent services. Each service has its own database on a shared PostgreSQL server; slow or follow-up work goes through a job queue." {
  !identifiers hierarchical

  model {
    actor_client = person "Client" ""
    db_per_service = softwareSystem "Node services, database per service" {
      svc_orders_service = container "Orders service" "" ""
      svc_payments_service = container "Payments service" "" ""
      svc_shipping_service = container "Shipping service" "" ""
      auth_identity_provider = container "Identity provider" "" ""
      gw_api_gateway = container "API gateway" "" "nginx"
      db_orders_db = container "Orders DB" "" "" "Database" {
        jobs_orders_jobs = component "Orders jobs" "" "" "Queue"
      }
      db_payments_db = container "Payments DB" "" "" "Database"
      db_shipping_db = container "Shipping DB" "" "" "Database"
    }

    actor_client -> db_per_service.gw_api_gateway "calls" "http"
    db_per_service.gw_api_gateway -> db_per_service.auth_identity_provider "authenticates with"
    db_per_service.gw_api_gateway -> db_per_service.svc_orders_service "calls" "http"
    db_per_service.gw_api_gateway -> db_per_service.svc_payments_service "calls" "http"
    db_per_service.gw_api_gateway -> db_per_service.svc_shipping_service "calls" "http"
    db_per_service.svc_orders_service -> db_per_service.db_orders_db.jobs_orders_jobs "enqueues"
    db_per_service.svc_orders_service -> db_per_service.db_orders_db "migrates"
    db_per_service.svc_orders_service -> db_per_service.db_orders_db "reads"
    db_per_service.svc_orders_service -> db_per_service.db_orders_db "writes"
    db_per_service.svc_payments_service -> db_per_service.db_payments_db "migrates"
    db_per_service.svc_payments_service -> db_per_service.db_orders_db.jobs_orders_jobs "processes"
    db_per_service.svc_payments_service -> db_per_service.db_payments_db "reads"
    db_per_service.svc_payments_service -> db_per_service.db_payments_db "writes"
    db_per_service.svc_shipping_service -> db_per_service.db_shipping_db "migrates"
    db_per_service.svc_shipping_service -> db_per_service.db_shipping_db "reads"
    db_per_service.svc_shipping_service -> db_per_service.db_shipping_db "writes"
  }

  views {
    systemContext db_per_service "Context" {
      include *
      autolayout lr
    }
    container db_per_service "Containers" {
      include *
      autolayout lr
    }
    component db_per_service.db_orders_db "db_orders_db-components" {
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
