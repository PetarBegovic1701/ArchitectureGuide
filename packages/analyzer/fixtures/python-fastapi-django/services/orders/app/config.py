from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://shop:shop@localhost:5432/shop"
    catalog_url: str = "http://localhost:8001"
    broker_url: str = "redis://localhost:6379/0"


settings = Settings()
