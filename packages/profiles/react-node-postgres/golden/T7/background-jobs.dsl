workspace "Background jobs on PostgreSQL" "The API saves the request and enqueues a job in the same transaction. A worker process runs slow or failure-prone work, with retries." {
  !identifiers hierarchical

  model {
    actor_customer = person "Customer" ""
    ext_e_mail_provider = softwareSystem "E-mail provider" "" "External"
    background_jobs = softwareSystem "Background jobs on PostgreSQL" {
      svc_shop_api = container "Shop API" "" "" {
        ctl_order_routes = component "Order routes" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
        uc_place_order = component "Place order" "" ""
      }
      wrk_worker = container "Worker" "Send confirmation email; Generate invoice PDF" ""
      db_shop_db = container "Shop DB" "" "" "Database" {
        jobs_jobs = component "jobs" "" "" "Queue"
        schema_public = component "public" "" "" "Database"
      }
    }

    actor_customer -> background_jobs.svc_shop_api "calls" "http"
    background_jobs.svc_shop_api.ctl_order_routes -> background_jobs.svc_shop_api.uc_place_order "calls"
    background_jobs.svc_shop_api -> background_jobs.db_shop_db.schema_public "migrates"
    background_jobs.svc_shop_api.uc_place_order -> background_jobs.db_shop_db.jobs_jobs "enqueues"
    background_jobs.svc_shop_api.uc_place_order -> background_jobs.db_shop_db.schema_public "writes"
    background_jobs.wrk_worker -> ext_e_mail_provider "calls" "http"
    background_jobs.wrk_worker -> background_jobs.db_shop_db.jobs_jobs "processes"
    background_jobs.wrk_worker -> background_jobs.db_shop_db.schema_public "reads"
  }

  views {
    systemContext background_jobs "Context" {
      include *
      autolayout lr
    }
    container background_jobs "Containers" {
      include *
      autolayout lr
    }
    component background_jobs.svc_shop_api "svc_shop_api-components" {
      include *
      autolayout lr
    }
    component background_jobs.db_shop_db "db_shop_db-components" {
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
