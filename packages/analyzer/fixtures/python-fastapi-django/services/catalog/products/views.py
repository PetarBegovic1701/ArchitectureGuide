from rest_framework import generics, serializers

from products.models import Product, Review


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ["id", "name", "price_cents"]


class ProductList(generics.ListCreateAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer


class ProductDetail(generics.RetrieveAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer


def add_review(product_id: int, text: str) -> None:
    Review.objects.create(product_id=product_id, text=text)
