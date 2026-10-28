workspace "Realtime updates" "The browser keeps a WebSocket open to a realtime gateway. Services signal changes with PostgreSQL NOTIFY; the gateway pushes them to the clients. Durable work still goes through a job queue." {
  !identifiers hierarchical

  model {
    actor_customer = person "Customer" ""
    realtime = softwareSystem "Realtime updates" {
      app_web = container "Web" "" "" {
        apic_api_client = component "API client" "" ""
        qcache_server_state_cache = component "Server-state cache" "" ""
        route_order_status = component "Order status" "" ""
      }
      svc_orders_api = container "Orders API" "" "" {
        ctl_order_routes = component "Order routes" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
      }
      wrk_worker = container "Worker" "" ""
      ws_realtime_gateway = container "Realtime gateway" "Authenticate socket connections; Push change signals to rooms" ""
      db_shop_db = container "Shop DB" "" "" "Database" {
        chan_order_changed = component "order_changed" "" "" "Queue"
        jobs_jobs = component "jobs" "" "" "Queue"
        schema_public = component "public" "" "" "Database"
      }
    }

    actor_customer -> realtime.app_web "calls" "https"
    realtime.app_web.apic_api_client -> realtime.svc_orders_api "calls" "https"
    realtime.app_web -> realtime.ws_realtime_gateway "calls: subscribe" "websocket"
    realtime.svc_orders_api.ctl_order_routes -> realtime.db_shop_db.jobs_jobs "enqueues"
    realtime.svc_orders_api.ctl_order_routes -> realtime.db_shop_db.chan_order_changed "notifies"
    realtime.svc_orders_api.ctl_order_routes -> realtime.db_shop_db.schema_public "writes"
    realtime.app_web.qcache_server_state_cache -> realtime.app_web.apic_api_client "fetches via"
    realtime.app_web.route_order_status -> realtime.app_web.qcache_server_state_cache "uses state"
    realtime.svc_orders_api -> realtime.db_shop_db.schema_public "migrates"
    realtime.wrk_worker -> realtime.db_shop_db.jobs_jobs "processes"
    realtime.ws_realtime_gateway -> realtime.db_shop_db.chan_order_changed "listens"
  }

  views {
    systemContext realtime "Context" {
      include *
      autolayout lr
    }
    container realtime "Containers" {
      include *
      autolayout lr
    }
    component realtime.app_web "app_web-components" {
      include *
      autolayout lr
    }
    component realtime.svc_orders_api "svc_orders_api-components" {
      include *
      autolayout lr
    }
    component realtime.db_shop_db "db_shop_db-components" {
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
