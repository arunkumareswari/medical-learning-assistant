# backend/agents/synthesis.py
from groq import Groq
import google.generativeai as genai
import asyncio
from typing import List, Dict, AsyncGenerator

# Tool-specific system prompts for Medical College Exam Prep
TOOL_PROMPTS = {
    "default": "You are a helpful and intelligent AI assistant, acting like ChatGPT or Claude. Answer the user's questions clearly, naturally, and comprehensively. You can use the provided context from textbooks or PubMed if relevant, but answer conversationally.",
    "study": "You are an expert medical professor helping a university medical student prepare for their semester exams using the provided textbooks.\n\nCRITICAL EXAM STRUCTURE RULES:\n\n1. If it's a LONG ESSAY (10-15 Marks) question (or if just a disease name or symptom is typed, default to this):\n- Write approx 800-1200 words (5000-8000 characters).\n- COMPULSORY STRUCTURE:\n  * Definition\n  * Etiology\n  * Pathophysiology\n  * Clinical features\n  * Investigations\n  * Management\n  * Complications\n  * [Diagram] (Explicitly mention where and what diagram should be drawn, this is very important).\n\n2. If it's a SHORT NOTE (5 Marks) question (the user must specify '5 marks' or 'short note'):\n- Write exactly 1-1.5 pages (300-500 words, 2000-3500 characters).\n- STRUCTURE:\n  * Short intro\n  * Headings and bullet points\n  * [Small diagram] (if possible)\n- Must be perfectly straight to the point.\n\nABSOLUTE RULE: You MUST use the 15-mark or 5-mark structure above for EVERY answer in this mode. Even if the user makes a typo (e.g. 'ance' instead of 'acne'), assume the closest medical term and provide the full structured essay. NEVER provide a short, conversational answer in this mode. ALWAYS base your clinical facts EXCLUSIVELY on the provided textbook context. ALWAYS explicitly append your exact source at the end (e.g., [Source: Harrison's Principles, Page 45]).",
    "websearch": "You are an advanced medical research assistant. The user is looking for the latest information, research, and clinical trials. Base your answer heavily on the provided PubMed research context. Synthesize the findings clearly, emphasize recent developments, and always cite your sources using [PubMed: PMID] at the end of the text.",
    "clinical": "You are a senior medical consultant helping a medical student analyze an Outpatient (OPD) clinical case. The student will provide patient details (age, sex, symptoms, history). Provide a structured clinical assessment.\n\nSTRUCTURE YOUR RESPONSE AS FOLLOWS (Keep it practical, concise and clinical):\n1. 🩺 SUMMARY: Brief 1-2 line summary of the patient presentation.\n2. 🎯 SUSPECTED DIAGNOSIS: The most likely diagnosis based on the clinical picture.\n3. ⚖️ DIFFERENTIAL DIAGNOSIS: 3-4 other possible conditions to rule out, with brief reasons.\n4. 🔬 RECOMMENDED INVESTIGATIONS: Key lab tests, imaging, or physical exams required to confirm.\n5. 💊 MANAGEMENT PLAN: Initial treatment, prescribed medications, and lifestyle advice.\n\nMaintain a professional, educational tone."
}

class SynthesisAgent:
    """Multi-provider synthesis agent supporting Groq and Gemini"""
    
    def __init__(self, groq_api_key: str, gemini_api_key: str = None):
        self.groq_client = Groq(api_key=groq_api_key)
        self.gemini_api_key = gemini_api_key
        if gemini_api_key:
            genai.configure(api_key=gemini_api_key)
    
    async def generate_answer(self, query: str, textbook_results: List[Dict], pubmed_results: List[Dict], persona: str = 'student', history: List[Dict] = [], provider: str = 'groq', model: str = 'llama-3.3-70b-versatile', tool: str = 'default') -> str:
        """Generate answer using selected provider, model, and tool"""
        
        # Format contexts
        textbook_context = self._format_textbook_context(textbook_results)
        pubmed_context = self._format_pubmed_context(pubmed_results)
        
        # Get tool-specific system prompt
        system_prompt = TOOL_PROMPTS.get(tool, TOOL_PROMPTS["default"])
        
        # Build context
        context_prompt = f"""USE THESE SOURCES FOR THE CURRENT QUERY:
TEXTBOOKS: {textbook_context}
PUBMED RESEARCH: {pubmed_context}

USER QUERY: {query}"""

        if provider == 'gemini' and self.gemini_api_key:
            answer = await self._generate_gemini(system_prompt, history, context_prompt, model)
        else:
            answer = await self._generate_groq(system_prompt, history, context_prompt, model)
        
        return answer
    
    async def generate_answer_stream(self, query, textbook_results, pubmed_results, persona='student', history=[], provider='groq', model='llama-3.3-70b-versatile', tool='default'):
        """Stream answer chunks from LLM"""
        textbook_context = self._format_textbook_context(textbook_results)
        pubmed_context = self._format_pubmed_context(pubmed_results)
        system_prompt = TOOL_PROMPTS.get(tool, TOOL_PROMPTS["default"])
        context_prompt = f"""USE THESE SOURCES FOR THE CURRENT QUERY:
TEXTBOOKS: {textbook_context}
PUBMED RESEARCH: {pubmed_context}

USER QUERY: {query}"""

        if provider == 'gemini' and self.gemini_api_key:
            async for chunk in self._stream_gemini(system_prompt, history, context_prompt, model):
                yield chunk
        else:
            async for chunk in self._stream_groq(system_prompt, history, context_prompt, model):
                yield chunk
        # Disclaimer removed by user request
    
    async def _generate_groq(self, system_prompt: str, history: List[Dict], context_prompt: str, model: str) -> str:
        """Generate using Groq"""
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history[-10:]:
            messages.append(msg)
        messages.append({"role": "user", "content": context_prompt})
        
        response = self.groq_client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.6,
            max_tokens=2000
        )
        return response.choices[0].message.content
    
    async def _stream_groq(self, system_prompt, history, context_prompt, model, temperature=0.1):
        """Stream using Groq"""
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history[-10:]:
            messages.append(msg)
        messages.append({"role": "user", "content": context_prompt})
        stream = self.groq_client.chat.completions.create(
            model=model, messages=messages, temperature=temperature, max_tokens=2000, stream=True
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content
    
    async def _generate_gemini(self, system_prompt: str, history: List[Dict], context_prompt: str, model: str) -> str:
        """Generate using Gemini (run blocking call in thread executor)"""
        try:
            gemini_model = genai.GenerativeModel(
                model_name=model,
                system_instruction=system_prompt
            )
            
            gemini_history = []
            for msg in history[-10:]:
                role = "user" if msg["role"] == "user" else "model"
                gemini_history.append({"role": role, "parts": [msg["content"]]})
            
            chat = gemini_model.start_chat(history=gemini_history)
            
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(None, chat.send_message, context_prompt)
            return response.text
        except Exception as e:
            print(f"❌ Gemini error: {type(e).__name__}: {e}")
            raise
    
    async def _stream_gemini(self, system_prompt, history, context_prompt, model):
        """Stream using Gemini (collect chunks in executor, yield async)"""
        try:
            gemini_model = genai.GenerativeModel(model_name=model, system_instruction=system_prompt)
            gemini_history = []
            for msg in history[-10:]:
                role = "user" if msg["role"] == "user" else "model"
                gemini_history.append({"role": role, "parts": [msg["content"]]})
            chat = gemini_model.start_chat(history=gemini_history)
            
            # Gemini streaming is blocking — collect all chunks in a thread executor
            def _collect_stream():
                chunks = []
                for chunk in chat.send_message(context_prompt, stream=True):
                    if chunk.text:
                        chunks.append(chunk.text)
                return chunks
            
            loop = asyncio.get_event_loop()
            print(f"🤖 Calling Gemini model: {model}")
            chunks = await loop.run_in_executor(None, _collect_stream)
            print(f"✅ Gemini returned {len(chunks)} chunks")
            
            for chunk in chunks:
                yield chunk
                await asyncio.sleep(0.01)
        except Exception as e:
            print(f"❌ Gemini streaming error: {type(e).__name__}: {e}")
            # Re-raise so main.py can send SSE model_error event to frontend
            raise
    
    def _format_textbook_context(self, results: List[Dict]) -> str:
        if not results:
            return "No textbook information available."
        context = ""
        for i, result in enumerate(results[:3], 1):
            context += f"\n{i}. From '{result['book_title']}':\n"
            context += f"   {result['text'][:300]}...\n"
        return context
    
    def _format_pubmed_context(self, results: List[Dict]) -> str:
        if not results:
            return "No recent research available."
        context = ""
        for i, result in enumerate(results[:3], 1):
            context += f"\n{i}. {result['title']}\n"
            context += f"   {result['snippet']}\n"
            context += f"   Authors: {result['metadata'].get('authors', 'N/A')}\n"
            context += f"   Year: {result['metadata'].get('year', 'N/A')}\n"
        return context

    def _get_system_prompt(self, tool: str) -> str:
        """Get system prompt for a given tool"""
        return TOOL_PROMPTS.get(tool, TOOL_PROMPTS["default"])

    def _build_context_prompt(self, query: str, textbook_results: List[Dict], pubmed_results: List[Dict]) -> str:
        """Build the context prompt string from search results"""
        textbook_context = self._format_textbook_context(textbook_results)
        pubmed_context = self._format_pubmed_context(pubmed_results)
        return f"""USE THESE SOURCES FOR THE CURRENT QUERY:
TEXTBOOKS: {textbook_context}
PUBMED RESEARCH: {pubmed_context}

USER QUERY: {query}"""