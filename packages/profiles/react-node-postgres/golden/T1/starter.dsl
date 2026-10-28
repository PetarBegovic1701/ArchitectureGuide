workspace "Starter: React + Express + PostgreSQL" "A React app calls one Node.js REST API, which owns one PostgreSQL schema. The smallest complete full-stack design." {
  !identifiers hierarchical

  model {
    actor_customer = person "Customer" ""
    starter = softwareSystem "Starter: React + Express + PostgreSQL" {
      app_shop = container "Shop" "" "" {
        route_home = component "Home" "" ""
      }
      svc_shop_api = container "Shop API" "" "" {
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
      }
      db_shop_db = container "Shop DB" "" "" "Database" {
        schema_public = component "public" "" "" "Database"
      }
    }

    actor_customer -> starter.app_shop "calls: uses"
    starter.app_shop -> starter.svc_shop_api "calls: REST /api" "http"
    starter.svc_shop_api -> starter.db_shop_db.schema_public "migrates"
    starter.svc_shop_api -> starter.db_shop_db.schema_public "reads"
    starter.svc_shop_api -> starter.db_shop_db.schema_public "writes"
  }

  views {
    systemContext starter "Context" {
      include *
      autolayout lr
    }
    container starter "Containers" {
      include *
      autolayout lr
    }
    component starter.app_shop "app_shop-components" {
      include *
      autolayout lr
    }
    component starter.svc_shop_api "svc_shop_api-components" {
      include *
      autolayout lr
    }
    component starter.db_shop_db "db_shop_db-components" {
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
