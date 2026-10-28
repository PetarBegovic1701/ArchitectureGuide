workspace "Feature-Sliced React app" "The React code is split into layers (pages, widgets, features, entities, shared) and slices. Code only imports from layers below it." {
  !identifiers hierarchical

  model {
    fsd_app = softwareSystem "Feature-Sliced React app" {
      app_web = container "Web" "" "" {
        apic_api_client = component "API client" "" ""
        feat_cart = component "Cart" "" ""
        feat_checkout = component "Checkout" "" ""
        feat_home_page = component "Home page" "" ""
        feat_product = component "Product" "" ""
        feat_search = component "Search" "" ""
        feat_storefront = component "Storefront" "" ""
        feat_ui_kit = component "UI kit" "" ""
        feat_user = component "User" "" ""
        qcache_server_state_cache = component "Server-state cache" "" ""
      }
    }

    fsd_app.app_web.feat_cart -> fsd_app.app_web.feat_user "depends on"
    fsd_app.app_web.feat_checkout -> fsd_app.app_web.feat_product "depends on"
    fsd_app.app_web.feat_home_page -> fsd_app.app_web.feat_storefront "depends on"
    fsd_app.app_web.feat_product -> fsd_app.app_web.feat_ui_kit "depends on"
    fsd_app.app_web.feat_product -> fsd_app.app_web.apic_api_client "fetches via"
    fsd_app.app_web.feat_product -> fsd_app.app_web.qcache_server_state_cache "uses state"
    fsd_app.app_web.feat_search -> fsd_app.app_web.feat_user "depends on"
    fsd_app.app_web.feat_storefront -> fsd_app.app_web.feat_cart "depends on"
    fsd_app.app_web.feat_storefront -> fsd_app.app_web.feat_checkout "depends on"
    fsd_app.app_web.feat_storefront -> fsd_app.app_web.feat_search "depends on"
    fsd_app.app_web.feat_user -> fsd_app.app_web.feat_ui_kit "depends on"
    fsd_app.app_web.feat_user -> fsd_app.app_web.apic_api_client "fetches via"
  }

  views {
    systemContext fsd_app "Context" {
      include *
      autolayout lr
    }
    container fsd_app "Containers" {
      include *
      autolayout lr
    }
    component fsd_app.app_web "app_web-components" {
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
