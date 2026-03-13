# backend/database/pinecone_db.py
from pinecone import Pinecone, ServerlessSpec
from sentence_transformers import SentenceTransformer
import time
from typing import List, Dict

class PineconeVectorDB:
    """Pinecone vector database for medical textbooks"""
    
    def __init__(self, api_key: str, environment: str = "us-east-1"):
        """Initialize Pinecone"""
        self.pc = Pinecone(api_key=api_key)
        self.index_name = "medical-textbooks"
        self.dimension = 384  # all-MiniLM-L6-v2 dimension
        
        # Lazy loaded resources
        self._embedder = None
        self._index = None
        
        print(f"🌲 Pinecone initialized (Lazy Mode)")
    
    def _get_embedder(self):
        """Lazy load the sentence transformer model"""
        if self._embedder is None:
            print("🚀 Loading AI Model ('all-MiniLM-L6-v2')...")
            start_time = time.time()
            self._embedder = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
            print(f"✅ Model loaded in {time.time() - start_time:.2f} seconds")
        return self._embedder

    def _get_index(self):
        """Lazy satisfy Pinecone index connection"""
        if self._index is None:
            print(f"🔗 Establishing connection to Pinecone index '{self.index_name}'...")
            self._create_index_if_not_exists()
            self._index = self.pc.Index(self.index_name)
            print("✅ Connection established")
        return self._index

    def _create_index_if_not_exists(self):
        """Create Pinecone index if it doesn't exist"""
        existing_indexes = [index.name for index in self.pc.list_indexes()]
        
        if self.index_name not in existing_indexes:
            print(f"✨ Creating Pinecone index: {self.index_name}")
            
            self.pc.create_index(
                name=self.index_name,
                dimension=self.dimension,
                metric='cosine',
                spec=ServerlessSpec(
                    cloud='aws',
                    region='us-east-1'
                )
            )
            
            # Wait for index to be ready
            print("⌛ Waiting for index to be ready...")
            while not self.pc.describe_index(self.index_name).status['ready']:
                time.sleep(1)
            
            print("🚀 Pinecone index ready!")
        else:
            print(f"📚 Using existing Pinecone index: '{self.index_name}'")
    
    def add_chunks(self, book_id: str, chunks: List[Dict]) -> int:
        """Add document chunks to Pinecone"""
        embedder = self._get_embedder()
        index = self._get_index()
        vectors = []
        
        print(f"Generating embeddings for {len(chunks)} chunks...")
        
        for chunk in chunks:
            # Generate embedding
            embedding = embedder.encode(chunk['text']).tolist()
            
            # Create unique vector ID
            vector_id = f"{book_id}_chunk_{chunk['chunk_index']}"
            
            # Prepare metadata
            metadata = {
                'book_id': book_id,
                'text': chunk['text'][:1000],  # Pinecone metadata limit
                'chunk_index': chunk['chunk_index']
            }
            
            vectors.append({
                'id': vector_id,
                'values': embedding,
                'metadata': metadata
            })
        
        # Upsert in batches of 100
        print(f"Uploading to Pinecone...")
        batch_size = 100
        total_uploaded = 0
        
        for i in range(0, len(vectors), batch_size):
            batch = vectors[i:i + batch_size]
            index.upsert(vectors=batch)
            total_uploaded += len(batch)
            print(f"   Uploaded {total_uploaded}/{len(vectors)} vectors...")
        
        print(f"Successfully uploaded {len(vectors)} vectors!")
        return len(vectors)
    
    def search(self, query_text: str, n_results: int = 5, book_id: str = None) -> List[Dict]:
        """Search for similar documents"""
        embedder = self._get_embedder()
        index = self._get_index()
        
        # Generate query embedding
        query_embedding = embedder.encode(query_text).tolist()
        
        # Build filter
        filter_dict = {'book_id': book_id} if book_id else None
        
        # Search
        results = index.query(
            vector=query_embedding,
            top_k=n_results,
            include_metadata=True,
            filter=filter_dict
        )
        
        # Format results
        formatted_results = []
        
        for match in results['matches']:
            formatted_results.append({
                'id': match['id'],
                'text': match['metadata'].get('text', ''),
                'distance': 1 - match['score'],  # Convert similarity to distance
                'metadata': {
                    'book_id': match['metadata'].get('book_id', ''),
                    'chunk_index': match['metadata'].get('chunk_index', 0)
                }
            })
        
        return formatted_results
    
    def delete_book(self, book_id: str):
        """Delete all vectors for a specific book"""
        index = self._get_index()
        print(f"Deleting book {book_id} from Pinecone...")
        index.delete(filter={'book_id': book_id})
        print(f"Book deleted!")
    
    def get_stats(self) -> Dict:
        """Get index statistics"""
        index = self._get_index()
        stats = index.describe_index_stats()
        return {
            'total_vector_count': stats.total_vector_count,
            'dimension': stats.dimension
        }