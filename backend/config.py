# backend/config.py
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional

class Settings(BaseSettings):
    """Application settings from environment variables"""
    
    # MySQL Configuration
    mysql_host: str = "localhost"
    mysql_user: str = "root"
    mysql_password: str
    mysql_database: str = "medical_learning_db"
    mysql_pool_size: int = 5
    
    # Pinecone Configuration
    pinecone_api_key: str
    pinecone_environment: str = "us-east-1"
    
    # LLM APIs
    groq_api_key: str
    gemini_api_key: Optional[str] = None
    
    # Google Search (Optional)
    google_search_api_key: Optional[str] = None
    google_search_cx: Optional[str] = None
    
    # Application Settings
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    chunk_size: int = 1000
    chunk_overlap: int = 200
    cache_ttl_days: int = 7
    
    class Config:
        env_file = ".env"
        case_sensitive = False

@lru_cache()
def get_settings():
    """Get cached settings instance"""
    return Settings()