from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Product",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("name", models.CharField(max_length=200)),
                ("price_cents", models.IntegerField()),
            ],
        ),
        migrations.CreateModel(
            name="Review",
            fields=[("id", models.BigAutoField(primary_key=True))],
            options={"db_table": "product_reviews"},
        ),
    ]
