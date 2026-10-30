import os

INSTALLED_APPS = ["rest_framework", "products"]
ROOT_URLCONF = "catalog.urls"
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "shop"),
    }
}
