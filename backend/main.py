# backend/main.py
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from pathlib import Path
import json
import asyncio
from typing import List, Optional

# Import agents
from backend.agents.document_processor import DocumentProcessorAgent
from backend.agents.retrieval import RetrievalAgent
from backend.agents.pubmed_search import PubMedSearchAgent
from backend.agents.synthesis import SynthesisAgent
from backend.database.mysql_db import MySQLDatabase
from backend.database.pinecone_db import PineconeVectorDB
from backend.config import get_settings

# Settings
settings = get_settings()

# FastAPI app
app = FastAPI(
    title="MedRAG - Medical Research Assistant",
    description="Multi-Agent RAG System with Textbooks + PubMed",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MySQL Config
mysql_config = {
    'host': settings.mysql_host,
    'user': settings.mysql_user,
    'password': settings.mysql_password,
    'database': settings.mysql_database,
    'pool_size': settings.mysql_pool_size
}

# Initialize databases
mysql_db = MySQLDatabase(config=mysql_config)
pinecone_db = PineconeVectorDB(api_key=settings.pinecone_api_key)

# Initialize agents
document_processor = DocumentProcessorAgent(
    pinecone_db=pinecone_db,
    mysql_db=mysql_db
)

retrieval_agent = RetrievalAgent(
    pinecone_db=pinecone_db,
    mysql_db=mysql_db
)

pubmed_search = PubMedSearchAgent(mysql_db=mysql_db)

synthesis_agent = SynthesisAgent(
    groq_api_key=settings.groq_api_key,
    gemini_api_key=settings.gemini_api_key
)

# Upload directory
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# ===== REQUEST MODELS =====
class QueryRequest(BaseModel):
    query: str
    search_mode: str = 'hybrid'
    persona: str = 'student'
    history: List[dict] = []
    provider: str = 'groq'
    model: str = 'llama-3.3-70b-versatile'
    tool: str = 'default'

# ===== STARTUP =====
@app.on_event("startup")
async def startup_event():
    """Startup tasks"""
    print("Starting MedRAG Medical Assistant...")
    print(f"MySQL: {settings.mysql_host}/{settings.mysql_database}")
    print(f"Pinecone: Connected")
    print(f"Groq API: Configured")
    
    # Cleanup expired cache
    try:
        deleted = mysql_db.cleanup_expired_cache()
        print(f"Cleaned up {deleted} expired cache entries")
    except:
        print("Cache cleanup skipped")
    
    print("System ready!\n")

# ===== HEALTH CHECK =====
@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "online",
        "service": "MedRAG Medical Research Assistant",
        "version": "2.0.0",
        "endpoints": {
            "query": "/ask-question-stream",
            "upload": "/upload-book",
            "stats": "/stats",
            "books": "/books"
        }
    }

# ===== STREAMING QUERY ENDPOINT =====
@app.post("/ask-question-stream")
async def ask_question_stream(request: QueryRequest):
    """
    Stream AI response using Server-Sent Events (SSE)
    """
    
    async def event_generator():
        try:
            # 1. Intent check for conversational queries
            # Use a fast LLM model to determine if the query is conversational or medical
            intent_prompt = "You are a routing agent. Determine if the user's input is purely CONVERSATIONAL (such as greetings, 'how are you', 'how ary you', 'thanks') or if it is a MEDICAL/RESEARCH question that requires searching databases. Reply with EXACTLY one word: CONVERSATIONAL or MEDICAL. Input: " + request.query
            
            is_conversational = False
            if request.tool == 'default':
                is_conversational = True
            else:
                try:
                    # Run the sync call in thread to avoid blocking loop
                    loop = asyncio.get_event_loop()
                    def _check_intent():
                        return synthesis_agent.groq_client.chat.completions.create(
                            model='llama-3.1-8b-instant',
                            messages=[{"role": "user", "content": intent_prompt}],
                            temperature=0,
                            max_tokens=10
                        )
                    intent_response = await loop.run_in_executor(None, _check_intent)
                    intent = intent_response.choices[0].message.content.strip().upper()
                    if "CONVERSATIONAL" in intent:
                        is_conversational = True
                except Exception as e:
                    print(f"Intent check failed: {e}")

            if is_conversational:
                # Bypass searching, just respond directly
                if request.tool == 'default':
                    system_prompt = """You are MedRAG Assistant, a friendly and empathetic mini-doctor. You act like ChatGPT.

RULE 1: For simple conversational greetings (e.g., 'hi', 'how are you?'):
Reply normally, briefly, and politely. DO NOT use emojis. DO NOT use the symptom structure.

RULE 2: For SYMPTOMS (e.g., 'I have a headache' or 'my stomach hurts'):
Keep it extremely concise and friendly. Use only 1 or 2 essential emojis (like 🧠 or ⚠️), no heavy emoji use.
Always format your answer EXACTLY like this structure:

[Friendly empathetic opening sentence]

Common Reasons
[3-5 very brief bullet points]

What You Can Do Now
[3-5 brief, actionable tips]

Important
[When to see a doctor]

Tell me:
[Ask EXACTLY 1 or 2 short follow-up questions to diagnose further, like "Is the pain on one side?" or "Since when?"]"""
                else:
                    system_prompt = "You are MedRAG, a friendly medical research assistant. Reply concisely and warmly."
                context_prompt = f"User message: {request.query}"
                
                # Use a slightly higher temperature for friendliness in General Chat
                temperature = 0.6 if request.tool == 'default' else 0.1
                
                async for chunk in synthesis_agent._stream_groq(system_prompt, request.history, context_prompt, 'llama-3.3-70b-versatile', temperature=temperature):
                    yield f"data: {json.dumps(chunk)}\n\n"
                    await asyncio.sleep(0.01)
                    
                yield f"event: sources\ndata: {json.dumps({'textbooks': [], 'web': []})}\n\n"
                yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"
                return

            # 2. Search textbooks + PubMed based on selected mode
            force_pubmed = request.tool in ['websearch']
            
            async def safe_textbook_search():
                if request.search_mode == 'pubmed' and not force_pubmed:
                    return [] # Skip textbooks if strictly pubmed mode
                try:
                    return await retrieval_agent.search_textbooks(query=request.query, n_results=5)
                except Exception as e:
                    print(f"Textbook search error: {e}")
                    return []
                    
            async def safe_pubmed_search():
                if request.search_mode == 'textbook' and not force_pubmed:
                    return {'results': []} # Skip pubmed if strictly textbooks mode
                return await pubmed_search.search(
                    query=request.query,
                    max_results=5 if not force_pubmed else 10
                )
            
            textbook_results, pubmed_data = await asyncio.gather(
                safe_textbook_search(),
                safe_pubmed_search()
            )
            pubmed_results = pubmed_data.get('results', [])

            
            # 3. Stream AI response
            try:
                async for chunk in synthesis_agent.generate_answer_stream(
                    query=request.query,
                    textbook_results=textbook_results,
                    pubmed_results=pubmed_results,
                    persona=request.persona,
                    history=request.history,
                    provider=request.provider,
                    model=request.model,
                    tool=request.tool
                ):
                    yield f"data: {json.dumps(chunk)}\n\n"
                    await asyncio.sleep(0.01)

            except Exception as gemini_err:
                # Detect quota/rate-limit errors
                err_str = str(gemini_err)
                is_quota = '429' in err_str or 'quota' in err_str.lower() or 'ResourceExhausted' in type(gemini_err).__name__
                error_type = 'quota' if is_quota else 'error'

                print(f"⚠️ Provider error ({error_type}): {gemini_err}")

                # Notify frontend about model failure
                yield f"event: model_error\ndata: {json.dumps({'type': error_type, 'failed_model': request.model, 'failed_provider': request.provider, 'fallback': 'groq', 'fallback_model': 'llama-3.3-70b-versatile'})}\n\n"

                # Fallback — stream from Groq instead
                print("⚠️ Falling back to Groq llama-3.3-70b-versatile")
                async for chunk in synthesis_agent._stream_groq(
                    system_prompt=synthesis_agent._get_system_prompt(request.tool),
                    history=request.history,
                    context_prompt=synthesis_agent._build_context_prompt(request.query, textbook_results, pubmed_results),
                    model='llama-3.3-70b-versatile'
                ):
                    yield f"data: {json.dumps(chunk)}\n\n"
                    await asyncio.sleep(0.01)
            
            # 4. Send sources
            
            unique_textbooks = []
            seen_titles = set()
            for r in textbook_results:
                if r['book_title'] not in seen_titles:
                    unique_textbooks.append({
                        'title': r['book_title'],
                        'text': r['text'][:200],
                        'chunk_index': r.get('chunk_index', None),
                        'page_num': r.get('page_num', None)
                    })
                seen_titles.add(r['book_title'])
                if len(unique_textbooks) >= 2:
                    break

            sources_data = {
                "textbooks": unique_textbooks,
                "web": [
                    {
                        **r,
                        'url': r.get('url', f"https://pubmed.ncbi.nlm.nih.gov/{r.get('pmid', '')}/"),
                        'pmid': r.get('pmid', '')
                    }
                    for r in pubmed_results[:3]
                ]
            }
            
            yield f"event: sources\ndata: {json.dumps(sources_data)}\n\n"
            
            # 5. Log query
            try:
                mysql_db.log_query({
                    'user_id': 'anonymous',
                    'query_text': request.query,
                    'query_type': request.tool,
                    'used_web_search': True,
                    'response_time_ms': 0
                })
            except Exception as e:
                print(f"Log error: {e}")
            
            # 6. Done
            yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"
            
        except Exception as e:
            print(f"Stream error: {e}")
            yield f"event: error\ndata: {json.dumps(str(e))}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# ===== NON-STREAMING ENDPOINT (FALLBACK) =====
@app.post("/ask-question")
async def ask_question(request: QueryRequest):
    """
    Non-streaming query endpoint (fallback)
    """
    try:
        # 1. Search textbooks
        textbook_results = []
        try:
            textbook_results = await retrieval_agent.search_textbooks(
                query=request.query,
                n_results=5
            )
        except Exception as e:
            print(f"Textbook search error: {e}")
        
        # 2. Search PubMed
        force_pubmed = request.manual_web_search or request.tool in ['research', 'websearch']
        pubmed_results = await pubmed_search.search(
            query=request.query,
            max_results=5 if not force_pubmed else 10
        )
        
        # 3. Generate answer
        answer = await synthesis_agent.generate_answer(
            query=request.query,
            textbook_results=textbook_results,
            pubmed_results=pubmed_results['results'],
            persona=request.persona,
            history=request.history,
            provider=request.provider,
            model=request.model,
            tool=request.tool
        )
        
        # 4. Log query
        try:
            mysql_db.log_query({
                'user_id': 'anonymous',
                'query_text': request.query,
                'query_type': request.tool,
                'used_web_search': True,
                'response_time_ms': 0
            })
        except Exception as e:
            print(f"Log error: {e}")
        
        return {
            "answer": answer,
            "sources": {
                "textbooks": [
                    {'title': r['book_title'], 'text': r['text'][:200]}
                    for r in textbook_results[:3]
                ],
                "web": pubmed_results['results'][:3]
            },
            "used_web_search": True,
            "model_used": f"{request.provider}/{request.model}"
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error processing query: {str(e)}")

# ===== BOOK UPLOAD =====
@app.post("/upload-book")
async def upload_book(
    file: UploadFile = File(...),
    title: str = None
):
    """Upload and process a medical textbook PDF"""
    
    # Validate PDF
    if not file.filename.endswith('.pdf'):
        raise HTTPException(400, "Only PDF files are allowed")
    
    try:
        # Save file
        file_path = UPLOAD_DIR / file.filename
        
        with file_path.open("wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        print(f"📁 Saved: {file.filename}")
        
        # Process document
        result = await document_processor.process_book(
            file_path=str(file_path),
            book_title=title or file.filename
        )
        
        return {
            "status": "success",
            "message": "Book uploaded and indexed successfully",
            "data": result
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error processing book: {str(e)}")

# ===== GET ALL BOOKS =====
@app.get("/books")
async def get_books():
    """Get all uploaded books"""
    try:
        books = mysql_db.get_all_books()
        return {"books": books}
    except Exception as e:
        raise HTTPException(500, f"Error fetching books: {str(e)}")

# ===== DELETE BOOK =====
@app.delete("/books/{book_id}")
async def delete_book(book_id: str):
    """Delete a book and its vectors"""
    try:
        # Delete from Pinecone
        pinecone_db.delete_book(book_id)
        
        # Delete from MySQL
        with mysql_db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM medical_books WHERE book_id = %s", (book_id,))
        
        return {
            "status": "success",
            "message": f"Book {book_id} deleted successfully"
        }
        
    except Exception as e:
        raise HTTPException(500, f"Error deleting book: {str(e)}")

# ===== STATISTICS =====
@app.get("/stats")
async def get_stats():
    """Get system statistics"""
    try:
        pinecone_stats = pinecone_db.get_stats()
        
        with mysql_db.get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            
            cursor.execute("SELECT COUNT(*) as total FROM medical_books WHERE status = 'indexed'")
            total_books = cursor.fetchone()['total']
            
            cursor.execute("SELECT COUNT(*) as total FROM query_logs")
            total_queries = cursor.fetchone()['total']
            
            cursor.execute("SELECT COUNT(*) as total FROM web_cache WHERE expires_at > NOW()")
            cached_searches = cursor.fetchone()['total']
        
        return {
            'total_books': total_books,
            'total_queries': total_queries,
            'cached_web_searches': cached_searches,
            'pinecone_vectors': pinecone_stats.get('total_vector_count', 0)
        }
        
    except Exception as e:
        print(f"Stats error: {e}")
        return {
            'total_books': 0,
            'total_queries': 0,
            'cached_web_searches': 0,
            'pinecone_vectors': 0
        }

# ===== HEALTH CHECK FOR AGENTS =====
@app.get("/health")
async def health_check():
    """Detailed health check"""
    
    health = {
        "status": "healthy",
        "mysql": False,
        "pinecone": False,
        "groq": False
    }
    
    # Check MySQL
    try:
        with mysql_db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            health["mysql"] = True
    except:
        health["status"] = "degraded"
    
    # Check Pinecone
    try:
        pinecone_db.get_stats()
        health["pinecone"] = True
    except:
        health["status"] = "degraded"
    
    # Groq API (we can't test without making a call)
    health["groq"] = bool(settings.groq_api_key)
    
    return health

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )