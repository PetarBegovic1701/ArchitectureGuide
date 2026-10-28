workspace "Transactional outbox on PostgreSQL" "The service writes its data and the events about it to an outbox table in one transaction. A relay publishes the outbox rows; consumers react to them." {
  !identifiers hierarchical

  model {
    actor_customer = person "Customer" ""
    outbox = softwareSystem "Transactional outbox on PostgreSQL" {
      svc_orders = container "Orders" "" "" {
        ctl_orders_routes = component "Orders routes" "" ""
        mw_auth_middleware = component "Auth middleware" "Read the session cookie; Reject calls without a valid session" ""
        uc_change_and_record_event = component "Change and record event" "" ""
      }
      wrk_notifications = container "Notifications" "" ""
      wrk_outbox_relay = container "Outbox relay" "Read unsent outbox rows in order; Publish them; Mark them sent" ""
      db_orders_db = container "Orders DB" "" "" "Database" {
        jobs_events = component "events" "" "" "Queue"
        schema_orders = component "orders" "" "" "Database"
        tbl_orders = component "orders" "" "" "Database"
        tbl_outbox = component "outbox" "Events not yet sent: order.placed, order.paid" "" "Database"
      }
    }

    actor_customer -> outbox.svc_orders "calls" "http"
    outbox.svc_orders.ctl_orders_routes -> outbox.svc_orders.uc_change_and_record_event "calls"
    outbox.svc_orders -> outbox.db_orders_db.schema_orders "migrates"
    outbox.svc_orders.uc_change_and_record_event -> outbox.db_orders_db.tbl_orders "writes"
    outbox.svc_orders.uc_change_and_record_event -> outbox.db_orders_db.tbl_outbox "writes"
    outbox.wrk_notifications -> outbox.db_orders_db.jobs_events "processes"
    outbox.wrk_outbox_relay -> outbox.db_orders_db.jobs_events "enqueues: order.placed, order.paid"
    outbox.wrk_outbox_relay -> outbox.db_orders_db.tbl_outbox "reads"
    outbox.wrk_outbox_relay -> outbox.db_orders_db.tbl_outbox "writes: mark sent"
  }

  views {
    systemContext outbox "Context" {
      include *
      autolayout lr
    }
    container outbox "Containers" {
      include *
      autolayout lr
    }
    component outbox.svc_orders "svc_orders-components" {
      include *
      autolayout lr
    }
    component outbox.db_orders_db "db_orders_db-components" {
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
