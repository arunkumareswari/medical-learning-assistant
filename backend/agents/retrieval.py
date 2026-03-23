# backend/agents/retrieval.py
from typing import List, Dict

class RetrievalAgent:
    """Search textbooks using Pinecone"""
    
    def __init__(self, pinecone_db, mysql_db):
        self.pinecone_db = pinecone_db
        self.mysql_db = mysql_db
    
    async def search_textbooks(self, query: str, n_results: int = 5) -> List[Dict]:
        """Search for relevant chunks in textbooks"""
        
        # Search Pinecone
        results = self.pinecone_db.search(query, n_results=n_results)
        
        # Format results with book metadata
        formatted_results = []
        
        for result in results:
            book_id = result['metadata']['book_id']
            
            # Get book title from MySQL
            book_title = self._get_book_title(book_id)
            
            formatted_results.append({
                'text': result['text'],
                'book_title': book_title,
                'book_id': book_id,
                'chunk_index': result['metadata']['chunk_index'],
                'page_num': result['metadata'].get('page_num', None),
                'relevance_score': 1 - result['distance'] if result['distance'] else 1.0
            })
        
        return formatted_results
    
    def _get_book_title(self, book_id: str) -> str:
        """Get book title from MySQL"""
        try:
            book = self.mysql_db.get_book_by_id(book_id)
            return book['title'] if book else 'Unknown Book'
        except Exception as e:
            print(f"Error getting book title: {e}")
            return 'Unknown Book'