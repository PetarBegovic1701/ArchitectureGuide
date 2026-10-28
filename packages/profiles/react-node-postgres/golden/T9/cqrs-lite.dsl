workspace "CQRS-lite on PostgreSQL" "Commands change the write tables; a projector keeps read models (projection tables and materialized views) up to date; queries read only the read models." {
  !identifiers hierarchical

  model {
    actor_customer = person "Customer" ""
    cqrs_lite = softwareSystem "CQRS-lite on PostgreSQL" {
      svc_orders = container "Orders" "" "" {
        ctl_commands = component "Commands" "" ""
        ctl_queries = component "Queries" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
        uc_place_order = component "Place order" "" ""
        uc_read_views = component "Read views" "" ""
      }
      wrk_projector = container "Projector" "Keep Order summary, Sales by day up to date" ""
      db_orders_db = container "Orders DB" "" "" "Database" {
        jobs_changes = component "changes" "" "" "Queue"
        schema_app = component "app" "" "" "Database"
        tbl_order_summary = component "Order summary" "" "" "Database"
        tbl_orders = component "orders" "" "" "Database"
        view_sales_by_day = component "Sales by day" "" "" "Database"
      }
    }

    actor_customer -> cqrs_lite.svc_orders "calls" "http"
    cqrs_lite.svc_orders.ctl_commands -> cqrs_lite.svc_orders.uc_place_order "calls"
    cqrs_lite.svc_orders.ctl_queries -> cqrs_lite.svc_orders.uc_read_views "calls"
    cqrs_lite.svc_orders -> cqrs_lite.db_orders_db.schema_app "migrates"
    cqrs_lite.svc_orders.uc_place_order -> cqrs_lite.db_orders_db.jobs_changes "enqueues: project"
    cqrs_lite.svc_orders.uc_place_order -> cqrs_lite.db_orders_db.tbl_orders "writes"
    cqrs_lite.svc_orders.uc_read_views -> cqrs_lite.db_orders_db.tbl_order_summary "reads"
    cqrs_lite.svc_orders.uc_read_views -> cqrs_lite.db_orders_db.view_sales_by_day "reads"
    cqrs_lite.wrk_projector -> cqrs_lite.db_orders_db.jobs_changes "processes"
    cqrs_lite.wrk_projector -> cqrs_lite.db_orders_db.tbl_orders "reads"
    cqrs_lite.wrk_projector -> cqrs_lite.db_orders_db.tbl_order_summary "writes"
  }

  views {
    systemContext cqrs_lite "Context" {
      include *
      autolayout lr
    }
    container cqrs_lite "Containers" {
      include *
      autolayout lr
    }
    component cqrs_lite.svc_orders "svc_orders-components" {
      include *
      autolayout lr
    }
    component cqrs_lite.db_orders_db "db_orders_db-components" {
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
