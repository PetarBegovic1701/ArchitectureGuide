workspace "Multi-tenant SaaS" "Many customers (tenants) share one deployment. Each request is tied to a tenant, and PostgreSQL keeps tenants apart: with row-level security on shared tables, or with one schema per tenant." {
  !identifiers hierarchical

  model {
    actor_tenant_user = person "Tenant user" ""
    multi_tenant = softwareSystem "Multi-tenant SaaS" {
      svc_saas_api = container "SaaS API" "" "" {
        ctl_project_routes = component "Project routes" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
        mw_tenant_resolver = component "Tenant resolver" "Find the tenant of the session; SET app.tenant_id for the transaction" ""
      }
      db_saas_db = container "SaaS DB" "" "" "Database" {
        schema_app = component "app" "Every table has tenant_id and a row-level security policy" "" "Database"
        schema_control = component "control" "Tenants, plans, users" "" "Database"
      }
    }

    actor_tenant_user -> multi_tenant.svc_saas_api "calls" "https"
    multi_tenant.svc_saas_api.ctl_project_routes -> multi_tenant.db_saas_db.schema_app "reads"
    multi_tenant.svc_saas_api.ctl_project_routes -> multi_tenant.db_saas_db.schema_app "writes"
    multi_tenant.svc_saas_api.mw_tenant_resolver -> multi_tenant.db_saas_db.schema_control "reads"
    multi_tenant.svc_saas_api -> multi_tenant.db_saas_db.schema_app "migrates"
    multi_tenant.svc_saas_api -> multi_tenant.db_saas_db.schema_control "migrates"
  }

  views {
    systemContext multi_tenant "Context" {
      include *
      autolayout lr
    }
    container multi_tenant "Containers" {
      include *
      autolayout lr
    }
    component multi_tenant.svc_saas_api "svc_saas_api-components" {
      include *
      autolayout lr
    }
    component multi_tenant.db_saas_db "db_saas_db-components" {
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
