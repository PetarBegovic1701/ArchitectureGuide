from django.db import models


class Product(models.Model):
    name = models.CharField(max_length=200)
    price_cents = models.IntegerField()


class Review(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    text = models.TextField()

    class Meta:
        db_table = "product_reviews"
