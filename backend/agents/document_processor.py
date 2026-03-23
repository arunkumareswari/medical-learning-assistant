# backend/agents/document_processor.py
import pdfplumber
from pathlib import Path
from typing import List, Dict
import hashlib
from datetime import datetime

class DocumentProcessorAgent:
    """Process PDF medical books and store in Pinecone"""
    
    def __init__(self, pinecone_db, mysql_db):
        self.pinecone_db = pinecone_db
        self.mysql_db = mysql_db
        self.chunk_size = 1000
        self.chunk_overlap = 200
    
    async def process_book(self, file_path: str, book_title: str) -> Dict:
        """Process a PDF book and store in vector DB"""
        
        # Generate book ID
        book_id = self._generate_book_id(book_title)
        
        # Extract pages from PDF
        print(f"📖 Extracting text from {book_title}...")
        pages = self._extract_pages_from_pdf(file_path)
        
        if not pages:
            raise Exception("Failed to extract text from PDF")
        
        # Create chunks
        print(f"✂️ Chunking text...")
        chunks = self._create_chunks(pages, book_id)
        
        # Store in Pinecone
        print(f"💾 Storing {len(chunks)} chunks in Pinecone...")
        stored_count = self.pinecone_db.add_chunks(book_id, chunks)
        
        # Store metadata in MySQL
        print(f"📝 Storing metadata in MySQL...")
        self._store_book_metadata(book_id, book_title, file_path, len(chunks))
        
        return {
            'book_id': book_id,
            'title': book_title,
            'total_chunks': stored_count,
            'status': 'success'
        }
    
    def _extract_pages_from_pdf(self, file_path: str) -> List[Dict]:
        """Extract text from PDF page by page"""
        pages = []
        
        try:
            with pdfplumber.open(file_path) as pdf:
                total_pages = len(pdf.pages)
                print(f"📄 Processing {total_pages} pages...")
                
                for i, page in enumerate(pdf.pages):
                    if i % 10 == 0:
                        print(f"   Page {i+1}/{total_pages}...")
                    
                    page_text = page.extract_text()
                    if page_text and page_text.strip():
                        pages.append({
                            'text': page_text.strip(),
                            'page_num': i + 1
                        })
            
            return pages
            
        except Exception as e:
            print(f"Error extracting PDF: {e}")
            return []
    
    def _create_chunks(self, pages: List[Dict], book_id: str) -> List[Dict]:
        """Split text into overlapping chunks while maintaining page number"""
        chunks = []
        chunk_index = 0
        
        for page in pages:
            text = page['text']
            page_num = page['page_num']
            start = 0
            
            while start < len(text):
                end = start + self.chunk_size
                chunk_text = text[start:end]
                
                # Don't create tiny chunks at the end
                if len(chunk_text) < 100 and len(chunks) > 0:
                    break
                
                chunks.append({
                    'text': chunk_text,
                    'chunk_index': chunk_index,
                    'page_num': page_num,
                    'book_id': book_id
                })
                
                chunk_index += 1
                start = end - self.chunk_overlap
        
        return chunks
    
    def _store_book_metadata(self, book_id: str, title: str, file_path: str, chunk_count: int):
        """Store book metadata in MySQL"""
        with self.mysql_db.get_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO medical_books (book_id, title, file_path, total_chunks, upload_date, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    total_chunks = %s,
                    upload_date = %s,
                    status = %s
            """, (book_id, title, file_path, chunk_count, datetime.now(), 'indexed', 
                  chunk_count, datetime.now(), 'indexed'))
            
            conn.commit()
    
    def _generate_book_id(self, title: str) -> str:
        """Generate unique book ID from title"""
        return hashlib.md5(title.encode()).hexdigest()[:16]