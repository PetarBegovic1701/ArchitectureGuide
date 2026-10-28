workspace "Type-safe monorepo" "One repository: the React app and the Node service share an API contract (tRPC router types or an OpenAPI document with zod schemas), so a breaking API change fails the build. Drizzle maps the tables." {
  !identifiers hierarchical

  model {
    actor_customer = person "Customer" ""
    type_safe_monorepo = softwareSystem "Type-safe monorepo" {
      app_web = container "Web" "" "" {
        apic_trpc_client = component "tRPC client" "" ""
        qcache_server_state_cache = component "Server-state cache" "" ""
        route_orders = component "Orders" "" ""
      }
      svc_api = container "API" "" "" {
        ctl_order_procedures = component "Order procedures" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
      }
      api_app_router_types = container "App router (types)" "Request and response shapes (zod)" ""
      db_app_db = container "App DB" "" "" "Database" {
        schema_public = component "public" "" "" "Database"
      }
    }

    actor_customer -> type_safe_monorepo.app_web "calls" "https"
    type_safe_monorepo.app_web.apic_trpc_client -> type_safe_monorepo.svc_api "calls" "https"
    type_safe_monorepo.app_web.apic_trpc_client -> type_safe_monorepo.api_app_router_types "depends on"
    type_safe_monorepo.svc_api.ctl_order_procedures -> type_safe_monorepo.api_app_router_types "depends on"
    type_safe_monorepo.svc_api.ctl_order_procedures -> type_safe_monorepo.db_app_db.schema_public "reads"
    type_safe_monorepo.svc_api.ctl_order_procedures -> type_safe_monorepo.db_app_db.schema_public "writes"
    type_safe_monorepo.app_web.qcache_server_state_cache -> type_safe_monorepo.app_web.apic_trpc_client "fetches via"
    type_safe_monorepo.app_web.route_orders -> type_safe_monorepo.app_web.qcache_server_state_cache "uses state"
    type_safe_monorepo.svc_api -> type_safe_monorepo.db_app_db.schema_public "migrates"
  }

  views {
    systemContext type_safe_monorepo "Context" {
      include *
      autolayout lr
    }
    container type_safe_monorepo "Containers" {
      include *
      autolayout lr
    }
    component type_safe_monorepo.app_web "app_web-components" {
      include *
      autolayout lr
    }
    component type_safe_monorepo.svc_api "svc_api-components" {
      include *
      autolayout lr
    }
    component type_safe_monorepo.db_app_db "db_app_db-components" {
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
