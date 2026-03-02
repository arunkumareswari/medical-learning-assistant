# backend/database/mysql_db.py
import mysql.connector
from mysql.connector import pooling
from contextlib import contextmanager
import json
from datetime import datetime, timedelta
import uuid

class MySQLDatabase:
    """MySQL database handler for metadata and caching"""
    
    def __init__(self, config):
        """
        config = {
            'host': 'localhost',
            'user': 'root',
            'password': 'your_password',
            'database': 'medical_learning_db',
            'pool_size': 5
        }
        """
        print(f"Connecting to MySQL: {config['host']}/{config['database']}")
        
        self.pool = pooling.MySQLConnectionPool(
            pool_name="medical_pool",
            pool_size=config.get('pool_size', 5),
            host=config['host'],
            user=config['user'],
            password=config['password'],
            database=config['database']
        )
        
        print("MySQL connection pool created")
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections"""
        conn = self.pool.get_connection()
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    # ===== BOOKS MANAGEMENT =====
    def add_book(self, book_data):
        """Add a new medical book"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            query = """
                INSERT INTO medical_books 
                (book_id, title, authors, edition, total_pages, file_path, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            book_id = str(uuid.uuid4())
            cursor.execute(query, (
                book_id,
                book_data['title'],
                book_data.get('authors', ''),
                book_data.get('edition', ''),
                book_data.get('total_pages', 0),
                book_data['file_path'],
                'processing'
            ))
            return book_id
    
    def update_book_status(self, book_id, status, total_chunks=None):
        """Update book processing status"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if total_chunks:
                query = """
                    UPDATE medical_books 
                    SET status = %s, total_chunks = %s, upload_date = NOW()
                    WHERE book_id = %s
                """
                cursor.execute(query, (status, total_chunks, book_id))
            else:
                query = """
                    UPDATE medical_books 
                    SET status = %s 
                    WHERE book_id = %s
                """
                cursor.execute(query, (status, book_id))
    
    def get_all_books(self):
        """Get all books"""
        with self.get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM medical_books ORDER BY upload_date DESC")
            return cursor.fetchall()
    
    def get_book_by_id(self, book_id):
        """Get a specific book"""
        with self.get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM medical_books WHERE book_id = %s", (book_id,))
            return cursor.fetchone()
    
    # ===== QUERY LOGS =====
    def log_query(self, query_data):
        """Log user query"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            query = """
                INSERT INTO query_logs 
                (query_id, user_id, query_text, query_type, used_web_search, response_time_ms)
                VALUES (%s, %s, %s, %s, %s, %s)
            """
            query_id = str(uuid.uuid4())
            cursor.execute(query, (
                query_id,
                query_data.get('user_id', 'anonymous'),
                query_data['query_text'],
                query_data.get('query_type', ''),
                query_data.get('used_web_search', False),
                query_data.get('response_time_ms', 0)
            ))
            return query_id
    
    # ===== WEB SEARCH CACHE =====
    def get_cached_search(self, query_hash):
        """Get cached web search results"""
        with self.get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            query = """
                SELECT * FROM web_cache 
                WHERE query_hash = %s 
                AND expires_at > NOW()
            """
            cursor.execute(query, (query_hash,))
            result = cursor.fetchone()
            
            if result:
                # Parse JSON
                result['results_json'] = json.loads(result['results_json'])
                if result.get('credibility_scores'):
                    result['credibility_scores'] = json.loads(result['credibility_scores'])
            
            return result
    
    def cache_search_results(self, query_hash, query_text, results, ttl_days=7):
        """Cache web search results"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            expires_at = datetime.now() + timedelta(days=ttl_days)
            
            # Extract credibility scores
            credibility_scores = {}
            if 'results' in results:
                credibility_scores = {
                    r.get('url', ''): r.get('credibility_score', 0)
                    for r in results.get('results', [])
                }
            
            query = """
                INSERT INTO web_cache 
                (cache_id, query_hash, query_text, results_json, credibility_scores, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                results_json = VALUES(results_json),
                credibility_scores = VALUES(credibility_scores),
                expires_at = VALUES(expires_at)
            """
            
            cursor.execute(query, (
                str(uuid.uuid4()),
                query_hash,
                query_text,
                json.dumps(results),
                json.dumps(credibility_scores),
                expires_at
            ))
    
    def cleanup_expired_cache(self):
        """Remove expired cache entries"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM web_cache WHERE expires_at < NOW()")
            return cursor.rowcount